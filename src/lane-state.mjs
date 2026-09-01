/**
 * ADLC lane state machine. Pure: no I/O, no git, no clock, no network.
 *
 * Executable copy of docs/LANE.md. A new scenario is a row in TRANSITIONS,
 * never a new controller/adapter/evidence/store quadruple.
 */

import { validateRepositoryProfile } from './governance.mjs';

export const PROVIDER_CAPABILITIES = Object.freeze({
  PULL_REQUEST: 'protected-integration:pull-request',
  MERGE_QUEUE: 'tested-protected-ordering:merge-queue',
  STRICT: 'required-check-policy:strict',
  LINEAR_HISTORY: 'history:linear',
  SQUASH: 'integration-method:squash',
});
export const QUEUE_POLICY = Object.freeze({ merge_method: 'SQUASH' });
export const RULESET_SCOPE = Object.freeze({
  APPLICABLE: 'proven-applicable',
  INAPPLICABLE: 'proven-inapplicable',
  UNKNOWN: 'unknown',
});
const MERGE_METHODS = Object.freeze(['merge', 'rebase', 'squash']);

function refConditionMatch(value, defaultBranch, protectedBranch) {
  const protectedRef = `refs/heads/${protectedBranch}`;
  if (value === protectedRef || value === '~ALL') return true;
  if (value === '~DEFAULT_BRANCH')
    return typeof defaultBranch === 'string' && defaultBranch.length > 0
      ? defaultBranch === protectedBranch : null;
  if (typeof value === 'string') {
    if (/^refs\/heads\/[^*?[\\]+$/u.test(value)) return false;
    const boundaries = ['*', '?', '[', '\\'].map((marker) => value.indexOf(marker))
      .filter((index) => index >= 0);
    const firstPatternMarker = boundaries.length > 0 ? Math.min(...boundaries) : 0;
    const literalPrefix = value.slice(0, firstPatternMarker);
    if (literalPrefix.length > 0 && !protectedRef.startsWith(literalPrefix)) return false;
  }
  return null;
}

/** Prove whether an active branch ruleset governs the configured canonical branch. */
export function rulesetScope(entry, defaultBranch = null, protectedBranch) {
  if (typeof protectedBranch !== 'string' || protectedBranch.length === 0)
    throw new TypeError('ruleset matching requires an explicit canonical branch');
  if (entry?.enforcement !== 'active') return typeof entry?.enforcement === 'string'
    ? RULESET_SCOPE.INAPPLICABLE : RULESET_SCOPE.UNKNOWN;
  if (entry?.target !== 'branch') return typeof entry?.target === 'string'
    ? RULESET_SCOPE.INAPPLICABLE : RULESET_SCOPE.UNKNOWN;
  const include = entry.conditions?.ref_name?.include;
  const exclude = entry.conditions?.ref_name?.exclude;
  if (!Array.isArray(include) || include.length === 0 || !Array.isArray(exclude))
    return RULESET_SCOPE.UNKNOWN;
  const included = include.map((value) => refConditionMatch(
    value, defaultBranch, protectedBranch));
  const excluded = exclude.map((value) => refConditionMatch(
    value, defaultBranch, protectedBranch));
  const inclusion = included.includes(true) ? true : included.includes(null) ? null : false;
  const exclusion = excluded.includes(true) ? true : excluded.includes(null) ? null : false;
  if (inclusion === false || exclusion === true) return RULESET_SCOPE.INAPPLICABLE;
  return inclusion === true && exclusion === false
    ? RULESET_SCOPE.APPLICABLE : RULESET_SCOPE.UNKNOWN;
}

export function rulesetApplies(entry, defaultBranch = null, protectedBranch) {
  return rulesetScope(entry, defaultBranch, protectedBranch) === RULESET_SCOPE.APPLICABLE;
}

/** Pure policy projection from a validated, provider-neutral repository profile. */
export function providerPolicy(value) {
  const profile = validateRepositoryProfile(value);
  const capabilities = new Set(profile.capabilities);
  const mergeQueueRequired = capabilities.has(PROVIDER_CAPABILITIES.MERGE_QUEUE);
  const strictRequired = capabilities.has(PROVIDER_CAPABILITIES.STRICT);
  if (mergeQueueRequired && (strictRequired
    || !capabilities.has(PROVIDER_CAPABILITIES.PULL_REQUEST)))
    throw new TypeError('merge queue requires pull-request integration and conflicts with strict checks');
  if ((mergeQueueRequired || strictRequired) && profile.requiredChecks.length === 0)
    throw new TypeError('merge queue and strict-check policy require at least one required check');
  if (!profile.canonical.localRef.startsWith('refs/heads/')
    || !profile.canonical.remoteRef.startsWith('refs/remotes/')) {
    throw new TypeError('provider policy requires fully qualified branch and remote-tracking refs');
  }
  return Object.freeze({
    profileDigest: profile.profileDigest,
    protectedBranch: profile.canonical.localRef.slice('refs/heads/'.length),
    protectedRef: profile.canonical.remoteRef,
    requiredChecks: Object.freeze([...profile.requiredChecks]),
    pullRequestRequired: capabilities.has(PROVIDER_CAPABILITIES.PULL_REQUEST),
    mergeQueueRequired,
    strict: mergeQueueRequired ? false : strictRequired ? true : null,
    linearHistoryRequired: capabilities.has(PROVIDER_CAPABILITIES.LINEAR_HISTORY),
    squashOnlyRequired: capabilities.has(PROVIDER_CAPABILITIES.SQUASH),
    retainOnMergeRequired: Object.values(profile.cleanup).every((effect) => effect === 'retain'),
  });
}

export function providerAdapterRequired(policy) {
  return policy.pullRequestRequired || policy.mergeQueueRequired || policy.strict !== null
    || policy.linearHistoryRequired || policy.squashOnlyRequired || policy.requiredChecks.length > 0;
}

export function queuePolicyMatches(parameters, policy) {
  if (policy.squashOnlyRequired) return parameters?.merge_method === 'SQUASH';
  if (policy.linearHistoryRequired)
    return ['REBASE', 'SQUASH'].includes(parameters?.merge_method);
  return true;
}

export function pullRequestPolicyMatches(parameters, policy) {
  const methods = parameters?.allowed_merge_methods;
  if (!policy.squashOnlyRequired && !policy.linearHistoryRequired) return true;
  if (!Array.isArray(methods) || methods.length === 0) return false;
  const allowed = new Set(policy.squashOnlyRequired ? ['squash'] : ['rebase', 'squash']);
  return new Set(methods).size === methods.length && methods.every((method) => allowed.has(method));
}

function repositoryMergeMethods(merge) {
  return MERGE_METHODS.filter((method) => ({
    merge: merge?.allow_merge_commit,
    rebase: merge?.allow_rebase_merge,
    squash: merge?.allow_squash_merge,
  })[method] === true);
}

function ruleMergeMethods(parameters) {
  const methods = parameters?.allowed_merge_methods;
  return Array.isArray(methods) && methods.length > 0
    && new Set(methods).size === methods.length
    && methods.every((method) => MERGE_METHODS.includes(method)) ? methods : [];
}

/** Effective integration methods are the intersection of every active authority constraint. */
export function effectivePullRequestMethods(merge, rules = [], {
  linearHistoryRequired = false,
} = {}) {
  let effective = repositoryMergeMethods(merge);
  for (const rule of rules) {
    const allowed = new Set(ruleMergeMethods(rule.parameters));
    effective = effective.filter((method) => allowed.has(method));
  }
  if (linearHistoryRequired) effective = effective.filter((method) => method !== 'merge');
  return effective;
}

export function effectivePullRequestPolicyMatches(methods, policy) {
  if (methods.length === 0) return false;
  if (policy.squashOnlyRequired) return methods.every((method) => method === 'squash');
  if (policy.linearHistoryRequired)
    return methods.every((method) => ['rebase', 'squash'].includes(method));
  return true;
}

/** Unknown facts block only when they govern a selected or mandatory capability. */
export function providerBlockingReasons(state, policy) {
  const reasons = [];
  const add = (condition, reason) => { if (condition) reasons.push(reason); };
  add(state?.available !== true, 'provider-unavailable');
  add(state?.identityBound !== true, 'repository-identity');
  add(state?.merge?.delete_branch_on_merge !== false, 'retain-on-merge');
  add(policy.pullRequestRequired && (!state?.pullRequestRequired
    || !state.pullRequestPolicySatisfied), 'pull-request');
  add(policy.linearHistoryRequired && !state?.linearHistoryRequired, 'linear-history');
  add(policy.squashOnlyRequired && !(state?.merge?.allow_squash_merge === true
    && state.merge.allow_merge_commit === false
    && state.merge.allow_rebase_merge === false), 'squash-only');
  add(policy.strict !== null && state?.strict !== policy.strict, 'strict-policy');
  add(policy.requiredChecks.some((check) => !state?.requiredChecks?.includes(check)),
    'required-checks');
  const incompleteRulesets = (state?.observationErrors ?? []).some((error) => [
    'rulesets', 'rulesets-pagination-boundary', 'expanded-rulesets', 'ruleset-scope',
  ].includes(error));
  const pullRequestMethodsSelected = policy.pullRequestRequired
    && (policy.squashOnlyRequired || policy.linearHistoryRequired);
  add((policy.mergeQueueRequired || policy.strict !== null || pullRequestMethodsSelected)
    && incompleteRulesets,
    'ruleset-observation');
  add(policy.mergeQueueRequired && !state?.queueEnabled, 'merge-queue');
  add(policy.mergeQueueRequired && !state?.queuePolicySatisfied, 'queue-policy');
  add(policy.mergeQueueRequired && state?.mergeGroupSupported !== true, 'merge-group');
  return [...new Set(reasons)];
}

export const STATES = Object.freeze([
  'planned',
  'active',
  'published',
  'queued',
  'integrated',
]);

export const TERMINAL_STATES = Object.freeze([]);

export const REFUSALS = Object.freeze({
  ILLEGAL: 'blocked-illegal-transition',
  CANONICAL_AUTHORING: 'blocked-canonical-authoring',
  DIRTY: 'blocked-dirty',
  NO_QUEUE: 'blocked-no-queue',
  NOT_PUSHED: 'blocked-not-pushed',
  PROVIDER_HANDOFF: 'blocked-provider-handoff',
  NOT_INTEGRATED: 'blocked-not-integrated',
  BASE_NOT_FETCHED: 'blocked-base-not-fetched',
  NO_COMMITS: 'blocked-no-commits',
});

/**
 * Guard registry. Each guard reads facts and returns null when satisfied or a
 * refusal code when not. Guards never mutate and never look at the state.
 */
const GUARDS = Object.freeze({
  baseFetched: (f) => (f.baseFetched ? null : REFUSALS.BASE_NOT_FETCHED),
  onLaneWorktree: (f) => (f.onCanonicalBranch ? REFUSALS.CANONICAL_AUTHORING : null),
  clean: (f) => (f.dirtyTracked ? REFUSALS.DIRTY : null),
  hasCommits: (f) => (f.laneCommits > 0 ? null : REFUSALS.NO_COMMITS),
  pushed: (f) => (f.pushed ? null : REFUSALS.NOT_PUSHED),
  orderingDelegated: (f) => (isOrderingDelegated(f) ? null : REFUSALS.NO_QUEUE),
  providerHandoff: (f) => (
    f.providerReceipt?.ok === true
    && f.providerReceipt.testedProtectedOrdering === true
    && f.providerReceipt.headSha === f.laneHeadSha
      ? null
      : REFUSALS.PROVIDER_HANDOFF
  ),
  integratedProof: (f) => (isProof(f.integrationProof) ? null : REFUSALS.NOT_INTEGRATED),
});

/**
 * The provider must test the candidate in protected-branch landing order.
 * Auto-merge alone does not provide that capability: its checks can describe a
 * stale base even when require-up-to-date is disabled.
 */
export function orderingMode(facts) {
  return facts.providerObservationComplete === true
    && facts.handoffPolicySatisfied === true
    && facts.queueEnabled
    && facts.queuePolicySatisfied === true
    && facts.requiredChecksSatisfied === true
    && facts.mergeGroupSupported === true
    ? 'merge-queue'
    : 'none';
}

export function isOrderingDelegated(facts) {
  return orderingMode(facts) !== 'none';
}

/** Ordered strongest-first. Squash merges destroy `ancestor`, hence exact content identity. */
export const PROOF_KINDS = Object.freeze([
  'ancestor',
  'exact-tree-projection',
]);

export function isProof(kind) {
  return PROOF_KINDS.includes(kind);
}

/** The whole scenario surface. Absent rows are illegal by construction. */
export const TRANSITIONS = Object.freeze([
  {
    from: 'planned',
    event: 'provision',
    to: 'active',
    guards: ['baseFetched'],
  },
  { from: 'active', event: 'author', to: 'active', guards: ['onLaneWorktree'] },
  {
    from: 'active',
    event: 'publish',
    to: 'published',
    guards: ['onLaneWorktree', 'clean', 'hasCommits', 'pushed'],
  },
  {
    from: 'published',
    event: 'enqueue',
    to: 'queued',
    guards: ['orderingDelegated', 'providerHandoff'],
  },
  { from: 'queued', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  { from: 'published', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  { from: 'active', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
]);

export const DEFAULT_FACTS = Object.freeze({
  baseFetched: false,
  onCanonicalBranch: false,
  dirtyTracked: false,
  laneCommits: 0,
  pushed: false,
  queueEnabled: false,
  providerObservationComplete: false,
  handoffPolicySatisfied: false,
  autoMergeAllowed: false,
  requiredCheckCount: 0,
  strict: null,
  laneHeadSha: null,
  providerReceipt: null,
  integrationProof: null,
});

/**
 * Resolve one transition.
 *
 * @param {string} state current lane state
 * @param {string} event requested event
 * @param {object} facts observed facts, merged over DEFAULT_FACTS
 * @returns {{ok: true, from: string, to: string, event: string}
 *          | {ok: false, from: string, event: string, reason: string, guard: string|null}}
 */
export function transition(state, event, facts = {}) {
  const f = { ...DEFAULT_FACTS, ...facts };
  const row = TRANSITIONS.find((t) => t.from === state && t.event === event);
  if (!row) {
    return { ok: false, from: state, event, reason: REFUSALS.ILLEGAL, guard: null };
  }
  for (const name of row.guards) {
    const reason = GUARDS[name](f);
    if (reason) return { ok: false, from: state, event, reason, guard: name };
  }
  return { ok: true, from: state, to: row.to, event };
}

/** Events legal from a state, ignoring facts. Used by `status` to show next steps. */
export function legalEvents(state) {
  return TRANSITIONS.filter((t) => t.from === state).map((t) => t.event);
}
