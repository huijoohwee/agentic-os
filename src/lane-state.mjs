/**
 * ADLC lane state machine. Pure: no I/O, no git, no clock, no network.
 *
 * Executable copy of docs/LANE.md. A new scenario is a row in TRANSITIONS,
 * never a new controller/adapter/evidence/store quadruple.
 */

import { parseLaneRef } from './lane-id.mjs';
import { validateRepositoryProfile } from './governance.mjs';

export const PROVIDER_CAPABILITIES = Object.freeze({
  PULL_REQUEST: 'protected-integration:pull-request',
  MERGE_QUEUE: 'tested-protected-ordering:merge-queue',
  STRICT: 'required-check-policy:strict',
  LINEAR_HISTORY: 'history:linear',
  SQUASH: 'integration-method:squash',
});

const LEGACY_PROVIDER_POLICY = Object.freeze({
  profileDigest: null,
  protectedBranch: 'main',
  protectedRef: 'refs/remotes/origin/main',
  requiredChecks: Object.freeze(['test', 'budgets']),
  pullRequestRequired: true,
  mergeQueueRequired: true,
  strict: false,
  linearHistoryRequired: true,
  squashOnlyRequired: true,
  retainOnMergeRequired: true,
});

/** Pure policy projection from a validated, provider-neutral repository profile. */
export function providerPolicy(value) {
  if (value === undefined) return LEGACY_PROVIDER_POLICY;
  const profile = validateRepositoryProfile(value);
  const capabilities = new Set(profile.capabilities);
  const mergeQueueRequired = capabilities.has(PROVIDER_CAPABILITIES.MERGE_QUEUE);
  const strictRequired = capabilities.has(PROVIDER_CAPABILITIES.STRICT);
  if (mergeQueueRequired && (strictRequired
    || !capabilities.has(PROVIDER_CAPABILITIES.PULL_REQUEST)))
    throw new TypeError('merge queue requires pull-request integration and conflicts with strict checks');
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
  WIP_CAP: 'blocked-wip-cap',
  MAIN_AUTHORING: 'blocked-main-authoring',
  DIRTY: 'blocked-dirty',
  NO_QUEUE: 'blocked-no-queue',
  NOT_PUSHED: 'blocked-not-pushed',
  PROVIDER_HANDOFF: 'blocked-provider-handoff',
  NOT_INTEGRATED: 'blocked-not-integrated',
  SCOPE_TAKEN: 'blocked-scope-taken',
  BASE_NOT_FETCHED: 'blocked-base-not-fetched',
  NO_COMMITS: 'blocked-no-commits',
});

/**
 * Guard registry. Each guard reads facts and returns null when satisfied or a
 * refusal code when not. Guards never mutate and never look at the state.
 */
const GUARDS = Object.freeze({
  wipWithinCap: (f) => (f.openLanes < f.wipCap ? null : REFUSALS.WIP_CAP),
  baseFetched: (f) => (f.baseFetched ? null : REFUSALS.BASE_NOT_FETCHED),
  scopeFree: (f) => (f.scopeTaken ? REFUSALS.SCOPE_TAKEN : null),
  onLaneWorktree: (f) => (f.onCanonicalMain ? REFUSALS.MAIN_AUTHORING : null),
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
    guards: ['wipWithinCap', 'baseFetched', 'scopeFree'],
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
  openLanes: 0,
  wipCap: 3,
  baseFetched: false,
  scopeTaken: false,
  onCanonicalMain: false,
  dirtyTracked: false,
  laneCommits: 0,
  pushed: false,
  queueEnabled: false,
  providerObservationComplete: false,
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

export const CAPS = Object.freeze({ openLanesPerDevice: 3 });
export function lanesForDevice(refs, device) {
  return refs.filter((ref) => parseLaneRef(ref)?.device === device);
}
export function capFacts(refs, device) {
  return { openLanes: lanesForDevice(refs, device).length, wipCap: CAPS.openLanesPerDevice };
}
export function capAdvice(reason) {
  return reason === REFUSALS.WIP_CAP
    ? `at the cap of ${CAPS.openLanesPerDevice} open lanes; land or classify work first`
    : null;
}

/** Events legal from a state, ignoring facts. Used by `status` to show next steps. */
export function legalEvents(state) {
  return TRANSITIONS.filter((t) => t.from === state).map((t) => t.event);
}
