/**
 * Pure ADLC lane state machine.
 * This is the executable copy of docs/LANE.md.
 */
import { canonicalJson, validateRepositoryProfile } from './governance.mjs';
import { isLaneRef } from './lane-id.mjs';
export const PROVIDER_CAPABILITIES = Object.freeze({
  PULL_REQUEST: 'protected-integration:pull-request', MERGE_QUEUE: 'tested-protected-ordering:merge-queue',
  SQUASH_PREFERRED: 'integration-method:squash-preferred',
  STRICT: 'required-check-policy:strict', LINEAR_HISTORY: 'history:linear', SQUASH: 'integration-method:squash',
});
export const INTEGRATION_METHOD_POLICY = Object.freeze({
  defaultMethod: 'squash', backupMethod: 'merge', rebaseFallback: 'explicit-revision-bound-provider-choice',
  automaticFallback: false, publishedRefRewrite: false,
});
export const QUEUE_POLICY = Object.freeze({ merge_method: 'SQUASH' });
export const RULESET_SCOPE = Object.freeze({
  APPLICABLE: 'proven-applicable', INAPPLICABLE: 'proven-inapplicable', UNKNOWN: 'unknown',
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
  const include = entry.conditions?.ref_name?.include, exclude = entry.conditions?.ref_name?.exclude;
  if (!Array.isArray(include) || include.length === 0 || !Array.isArray(exclude))
    return RULESET_SCOPE.UNKNOWN;
  const included = include.map((value) => refConditionMatch(value, defaultBranch, protectedBranch));
  const excluded = exclude.map((value) => refConditionMatch(value, defaultBranch, protectedBranch));
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
  const profile = validateRepositoryProfile(value), capabilities = new Set(profile.capabilities);
  if (capabilities.has(PROVIDER_CAPABILITIES.SQUASH_PREFERRED)
    && [PROVIDER_CAPABILITIES.SQUASH, PROVIDER_CAPABILITIES.LINEAR_HISTORY]
      .some((capability) => capabilities.has(capability)))
    throw new TypeError('squash-preferred conflicts with squash-only and linear history');
  if (capabilities.has(PROVIDER_CAPABILITIES.SQUASH_PREFERRED)
    && !capabilities.has(PROVIDER_CAPABILITIES.PULL_REQUEST))
    throw new TypeError('squash-preferred requires pull-request integration');
  const mergeQueueRequired = capabilities.has(PROVIDER_CAPABILITIES.MERGE_QUEUE),
    strictRequired = capabilities.has(PROVIDER_CAPABILITIES.STRICT);
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
    profileDigest: profile.profileDigest, protectedBranch: profile.canonical.localRef.slice('refs/heads/'.length),
    protectedRef: profile.canonical.remoteRef, requiredChecks: Object.freeze([...profile.requiredChecks]),
    pullRequestRequired: capabilities.has(PROVIDER_CAPABILITIES.PULL_REQUEST), mergeQueueRequired,
    strict: mergeQueueRequired ? false : strictRequired ? true : null,
    linearHistoryRequired: capabilities.has(PROVIDER_CAPABILITIES.LINEAR_HISTORY),
    squashOnlyRequired: capabilities.has(PROVIDER_CAPABILITIES.SQUASH),
    squashPreferredRequired: capabilities.has(PROVIDER_CAPABILITIES.SQUASH_PREFERRED),
    retainOnMergeRequired: Object.values(profile.cleanup).every((effect) => effect === 'retain'),
  });
}
export function providerAdapterRequired(policy) {
  return policy.pullRequestRequired || policy.mergeQueueRequired || policy.strict !== null
    || policy.linearHistoryRequired || policy.squashOnlyRequired || policy.squashPreferredRequired
    || policy.requiredChecks.length > 0;
}
export function queuePolicyMatches(parameters, policy) {
  if (policy.squashOnlyRequired || policy.squashPreferredRequired)
    return parameters?.merge_method === 'SQUASH';
  if (policy.linearHistoryRequired)
    return ['REBASE', 'SQUASH'].includes(parameters?.merge_method);
  return true;
}
export function pullRequestPolicyMatches(parameters, policy) {
  const methods = parameters?.allowed_merge_methods;
  if (policy.squashPreferredRequired) return preferredMethods(methods);
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
export function effectivePullRequestMethods(merge, rules = [], { linearHistoryRequired = false } = {}) {
  let effective = repositoryMergeMethods(merge);
  for (const rule of rules) {
    const allowed = new Set(ruleMergeMethods(rule.parameters));
    effective = effective.filter((method) => allowed.has(method));
  }
  if (linearHistoryRequired) effective = effective.filter((method) => method !== 'merge');
  return effective;
}
export function effectivePullRequestPolicyMatches(methods, policy) {
  if (policy.squashPreferredRequired) return preferredMethods(methods);
  if (methods.length === 0) return false;
  if (policy.squashOnlyRequired) return methods.every((method) => method === 'squash');
  if (policy.linearHistoryRequired)
    return methods.every((method) => ['rebase', 'squash'].includes(method));
  return true;
}
function preferredMethods(methods) {
  return Array.isArray(methods) && new Set(methods).size === methods.length
    && methods.every((method) => MERGE_METHODS.includes(method))
    && methods.includes('squash') && methods.includes('merge');
}
/** Read-only method selection; caller must verify authority and re-observe before any effect. */
export function selectIntegrationMethod(profileValue, observation, choice = {}) {
  const profile = validateRepositoryProfile(profileValue), policy = providerPolicy(profile);
  if (!policy.squashPreferredRequired) throw new TypeError('squash-preferred policy is not selected');
  if (observation?.repo !== profile.repository || observation?.policy?.profileDigest !== profile.profileDigest
    || providerBlockingReasons(observation, policy).length > 0
    || !preferredMethods(observation.effectiveMergeMethods) || observation.linearHistoryRequired !== false)
    throw new TypeError('integration policy observation is incomplete or incompatible');
  const { method = 'squash', reason = null, expectedHead, observedHead, expectedBase, observedBase } = choice;
  const oid = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
  if (!oid.test(expectedHead ?? '') || !oid.test(expectedBase ?? '')
    || expectedHead !== observedHead || expectedBase !== observedBase)
    throw new TypeError('integration requires exact current head and base revisions');
  if (!MERGE_METHODS.includes(method)) throw new TypeError('unsupported integration method');
  if (!observation.effectiveMergeMethods.includes(method))
    throw new TypeError('requested integration method is unavailable');
  if (policy.mergeQueueRequired && method !== 'squash')
    throw new TypeError('selected merge queue requires squash');
  if (method !== 'squash' && (typeof reason !== 'string' || !reason.trim()
    || Buffer.byteLength(reason, 'utf8') > 1000 || /[\u0000-\u001f\u007f]/u.test(reason)))
    throw new TypeError('integration fallback requires an explicit bounded reason');
  return Object.freeze({ schema: 'agentic-os/integration-method-selection/v1', authority: false,
    repository: profile.repository, profileDigest: profile.profileDigest,
    headRevision: expectedHead, baseRevision: expectedBase, method,
    reason: method !== 'squash' ? reason.trim() : null });
}
const CHOICE_PREFIX = 'integration-method-choice:v1:';
/** Publish this reference in the predecessor CoordinationRequest.dependentWork before integration. */
export function integrationMethodChoiceReference(value) {
  const keys = ['schema', 'authority', 'repository', 'profileDigest', 'headRevision',
    'baseRevision', 'method', 'reason'];
  if (!value || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))
    || value.schema !== 'agentic-os/integration-method-selection/v1' || value.authority !== false
    || typeof value.repository !== 'string' || !value.repository || /[\u0000-\u0020\u007f]/u.test(value.repository)
    || !/^[0-9a-f]{64}$/u.test(value.profileDigest ?? '')
    || [value.headRevision, value.baseRevision].some((revision) =>
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(revision ?? ''))
    || !MERGE_METHODS.includes(value.method)
    || (value.method === 'squash' ? value.reason !== null
      : typeof value.reason !== 'string' || !value.reason.trim() || value.reason !== value.reason.trim()
        || Buffer.byteLength(value.reason, 'utf8') > 1000 || /[\u0000-\u001f\u007f]/u.test(value.reason)))
    throw new TypeError('invalid revision-bound integration method choice');
  const reference = CHOICE_PREFIX + Buffer.from(canonicalJson(value)).toString('base64url');
  if (reference.length > 4096) throw new TypeError('integration method choice exceeds reference budget');
  return reference;
}
export function readIntegrationMethodChoice(dependentWork = []) {
  if (!Array.isArray(dependentWork)) throw new TypeError('integration method references must be an array');
  const references = dependentWork.filter((entry) => typeof entry === 'string'
    && entry.startsWith('integration-method-choice:'));
  if (references.length === 0) return null;
  if (references.length !== 1 || !references[0].startsWith(CHOICE_PREFIX) || references[0].length > 4096)
    throw new TypeError('integration requires one supported revision-bound method choice');
  let value;
  try { value = JSON.parse(Buffer.from(references[0].slice(CHOICE_PREFIX.length), 'base64url').toString('utf8')); }
  catch { throw new TypeError('invalid integration method choice encoding'); }
  if (integrationMethodChoiceReference(value) !== references[0])
    throw new TypeError('integration method choice encoding must be canonical');
  return Object.freeze(value);
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
  add(policy.squashPreferredRequired && (!preferredMethods(state?.effectiveMergeMethods)
    || state?.merge?.allow_squash_merge !== true || state?.merge?.allow_merge_commit !== true
    || typeof state?.merge?.allow_rebase_merge !== 'boolean' || state?.linearHistoryRequired !== false
    || !Array.isArray(state?.observationErrors)
    || state.observationErrors.includes('classic-protection')), 'squash-preferred');
  add(policy.strict !== null && state?.strict !== policy.strict, 'strict-policy');
  add(policy.requiredChecks.some((check) => !state?.requiredChecks?.includes(check)),
    'required-checks');
  const incompleteRulesets = (state?.observationErrors ?? []).some((error) => [
    'rulesets', 'rulesets-pagination-boundary', 'expanded-rulesets', 'ruleset-scope',
  ].includes(error));
  const pullRequestMethodsSelected = policy.pullRequestRequired
    && (policy.squashOnlyRequired || policy.squashPreferredRequired || policy.linearHistoryRequired);
  add((policy.mergeQueueRequired || policy.strict !== null || pullRequestMethodsSelected)
    && incompleteRulesets,
    'ruleset-observation');
  add(policy.mergeQueueRequired && !state?.queueEnabled, 'merge-queue');
  add(policy.mergeQueueRequired && !state?.queuePolicySatisfied, 'queue-policy');
  add(policy.mergeQueueRequired && state?.mergeGroupSupported !== true, 'merge-group');
  return [...new Set(reasons)];
}
export const STATES = Object.freeze(['planned', 'active', 'published', 'queued', 'integrated']);
export const REFUSALS = Object.freeze({
  ILLEGAL: 'blocked-illegal-transition', CANONICAL_AUTHORING: 'blocked-canonical-authoring',
  DIRTY: 'blocked-dirty', NO_QUEUE: 'blocked-no-queue', NOT_PUSHED: 'blocked-not-pushed',
  PROVIDER_HANDOFF: 'blocked-provider-handoff', NOT_INTEGRATED: 'blocked-not-integrated',
  BASE_NOT_FETCHED: 'blocked-base-not-fetched', NO_COMMITS: 'blocked-no-commits',
  PREDECESSOR: 'blocked-successor-predecessor', DESCENDANT: 'blocked-successor-descendant',
  DESTINATION: 'blocked-successor-destination',
});
/** Pure guard registry: null means satisfied; a code means refused. */
const GUARDS = Object.freeze({
  baseFetched: (f) => (f.baseFetched ? null : REFUSALS.BASE_NOT_FETCHED),
  onLaneWorktree: (f) => (f.onCanonicalBranch ? REFUSALS.CANONICAL_AUTHORING : null),
  clean: (f) => (f.dirtyTracked ? REFUSALS.DIRTY : null),
  hasCommits: (f) => (f.laneCommits > 0 ? null : REFUSALS.NO_COMMITS),
  pushed: (f) => (f.pushed ? null : REFUSALS.NOT_PUSHED),
  orderingDelegated: (f) => (orderingMode(f) !== 'none' ? null : REFUSALS.NO_QUEUE),
  providerHandoff: (f) => f.providerReceipt?.ok === true
    && f.providerReceipt.testedProtectedOrdering === true
    && f.providerReceipt.headSha === f.laneHeadSha ? null : REFUSALS.PROVIDER_HANDOFF,
  integratedProof: (f) => (PROOF_KINDS.includes(f.integrationProof) ? null : REFUSALS.NOT_INTEGRATED),
  predecessorExact: (f) => (f.predecessorExact ? null : REFUSALS.PREDECESSOR),
  descendant: (f) => (f.descendant ? null : REFUSALS.DESCENDANT),
  destinationAbsent: (f) => (f.destinationAbsent ? null : REFUSALS.DESTINATION),
});
/** Require provider tests in protected-branch landing order. */
export function orderingMode(facts) {
  return facts.providerObservationComplete === true
    && facts.handoffPolicySatisfied === true
    && facts.queueEnabled && facts.queuePolicySatisfied === true
    && facts.requiredChecksSatisfied === true && facts.mergeGroupSupported === true
    ? 'merge-queue' : 'none';
}
/** Ordered strongest-first. Squash merges destroy `ancestor`, hence exact content identity. */
export const PROOF_KINDS = Object.freeze(['ancestor', 'exact-tree-projection']);
/** The whole scenario surface. Absent rows are illegal by construction. */
export const TRANSITIONS = Object.freeze([
  { from: 'planned', event: 'provision', to: 'active', guards: ['baseFetched'] },
  { from: 'active', event: 'author', to: 'active', guards: ['onLaneWorktree'] },
  { from: 'active', event: 'publish', to: 'published',
    guards: ['onLaneWorktree', 'clean', 'hasCommits', 'pushed'] },
  { from: 'published', event: 'successor', to: 'published',
    guards: ['onLaneWorktree', 'clean', 'predecessorExact', 'descendant', 'destinationAbsent'] },
  { from: 'published', event: 'enqueue', to: 'queued', guards: ['orderingDelegated', 'providerHandoff'] },
  { from: 'queued', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  { from: 'published', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  { from: 'active', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
]);
const SUCCESSOR_HANDOFF = 'agentic-os-lane-successor/v1';
const successorRefusal = (reason, message) => ({ reason, message });
export function successorLineage(record) {
  const value = record?.handoff;
  if (value?.schema !== SUCCESSOR_HANDOFF) return null;
  const keys = Reflect.ownKeys(value), prototype = Object.getPrototypeOf(value);
  return prototype !== Object.prototype && prototype !== null || keys.length !== 3
    || !keys.includes('schema') || !keys.includes('predecessorRef')
    || !keys.includes('predecessorHead') || !isLaneRef(value.predecessorRef)
    || value.predecessorRef === record.ref
    || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.predecessorHead ?? '') ? false : value;
}
export function successorRecordPlan({ boundRef, successorRef, lanes, explicitHead, protectedRef,
  tip, worktree, device, scope, createdAt }) {
  const boundRecord = lanes[boundRef], targetRecord = lanes[successorRef],
    boundLineage = successorLineage(boundRecord), targetLineage = successorLineage(targetRecord);
  if (boundLineage === false || targetLineage === false) return successorRefusal('blocked-successor-cache-race', 'successor lineage payload is invalid');
  const successorSide = successorRef === boundRef && ['planned', 'active'].includes(boundRecord?.state)
    && Boolean(boundLineage);
  const predecessorSide = successorRef !== boundRef && targetRecord?.state === 'planned'
    && targetLineage?.predecessorRef === boundRef;
  const resuming = successorSide || predecessorSide;
  if (successorRef === boundRef && !successorSide) return successorRefusal('blocked-successor-identity', 'successor scope must create a distinct lane ref');
  const recoveryRecord = successorSide ? boundRecord : predecessorSide ? targetRecord : null,
    lineage = successorSide ? boundLineage : targetLineage,
    predecessorRef = successorSide ? lineage.predecessorRef : boundRef;
  const predecessorRecord = lanes[predecessorRef];
  if (!predecessorRecord) return successorRefusal('blocked-successor-predecessor', 'successor requires predecessor base and write-scope metadata');
  if (!explicitHead && predecessorRecord.state !== 'published') return successorRefusal('blocked-successor-predecessor', 'recorded head requires a published cache projection');
  const expectedHead = explicitHead ?? predecessorRecord.head;
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(expectedHead ?? '') || predecessorRecord.base !== protectedRef
    || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(predecessorRecord.baseSha ?? '')) return successorRefusal('blocked-successor-predecessor', 'published head and base identity are required');
  const plannedRecord = { ref: successorRef, device, scope, state: 'planned', base: predecessorRecord.base,
    baseSha: predecessorRecord.baseSha, worktree, pr: null, createdAt: resuming ? recoveryRecord.createdAt : createdAt,
    writePaths: predecessorRecord.writePaths ?? [], head: tip,
    handoff: { schema: SUCCESSOR_HANDOFF, predecessorRef, predecessorHead: expectedHead } };
  const exact = recoveryRecord?.state === 'active' ? { ...plannedRecord, state: 'active' } : plannedRecord;
  if (resuming && JSON.stringify(recoveryRecord) !== JSON.stringify(exact)) return successorRefusal('blocked-successor-cache-race', 'successor recovery record differs from inherited authority');
  return { resuming, predecessorRef, predecessorRecord, expectedHead, plannedRecord: resuming ? recoveryRecord : plannedRecord };
}
/** Resolve one transition from observed facts. */
export function transition(state, event, facts = {}) {
  const f = facts;
  const row = TRANSITIONS.find((t) => t.from === state && t.event === event);
  if (!row) return { ok: false, from: state, event, reason: REFUSALS.ILLEGAL, guard: null };
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
