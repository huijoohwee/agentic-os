/**
 * ADLC lane state machine. Pure: no I/O, no git, no clock, no network.
 *
 * Executable copy of docs/LANE.md. A new scenario is a row in TRANSITIONS,
 * never a new controller/adapter/evidence/store quadruple.
 */

export const STATES = Object.freeze([
  'planned',
  'active',
  'published',
  'queued',
  'integrated',
  'retired',
]);

export const TERMINAL_STATES = Object.freeze(['retired']);

export const REFUSALS = Object.freeze({
  ILLEGAL: 'blocked-illegal-transition',
  WIP_CAP: 'blocked-wip-cap',
  STACK_DEPTH: 'blocked-stack-depth',
  MAIN_AUTHORING: 'blocked-main-authoring',
  DIRTY: 'blocked-dirty',
  OWNED_UNTRACKED: 'blocked-owned-untracked',
  NO_QUEUE: 'blocked-no-queue',
  NOT_PUSHED: 'blocked-not-pushed',
  NO_PR: 'blocked-no-pr',
  STALE_CHECKS: 'blocked-stale-checks',
  NOT_INTEGRATED: 'blocked-not-integrated',
  RESTACK_EXHAUSTED: 'blocked-restack-exhausted',
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
  stackWithinCap: (f) => (f.stackDepth <= f.stackCap ? null : REFUSALS.STACK_DEPTH),
  baseFetched: (f) => (f.baseFetched ? null : REFUSALS.BASE_NOT_FETCHED),
  scopeFree: (f) => (f.scopeTaken ? REFUSALS.SCOPE_TAKEN : null),
  onLaneWorktree: (f) => (f.onCanonicalMain ? REFUSALS.MAIN_AUTHORING : null),
  clean: (f) => (f.dirtyTracked ? REFUSALS.DIRTY : null),
  hasCommits: (f) => (f.laneCommits > 0 ? null : REFUSALS.NO_COMMITS),
  pushed: (f) => (f.pushed ? null : REFUSALS.NOT_PUSHED),
  orderingDelegated: (f) => (isOrderingDelegated(f) ? null : REFUSALS.NO_QUEUE),
  prOpen: (f) => (f.prOpen ? null : REFUSALS.NO_PR),
  checksNotStale: (f) => (f.checksHeadSha === f.laneHeadSha ? null : REFUSALS.STALE_CHECKS),
  ejectedOnce: (f) => (f.ejections === 1 ? null : REFUSALS.RESTACK_EXHAUSTED),
  integratedProof: (f) => (isProof(f.integrationProof) ? null : REFUSALS.NOT_INTEGRATED),
  noOwnedUntracked: (f) => (f.ownedUntracked ? REFUSALS.OWNED_UNTRACKED : null),
});

/**
 * The real invariant behind `enqueue` is that the *provider* owns landing order,
 * not the author. A merge queue is the strong form: it batches and tests ahead
 * of the protected branch. Auto-merge with require-up-to-date off is the weak
 * form: no batching, but the author still never restacks for ordering.
 *
 * Auto-merge without required checks is not delegation, it is a blind merge, so
 * it does not qualify. Neither does anything while require-up-to-date is on,
 * because that setting is what forces the restack treadmill.
 */
export function orderingMode(facts) {
  if (facts.queueEnabled) return 'merge-queue';
  const delegated = facts.autoMergeAllowed && facts.requiredCheckCount > 0 && facts.strict !== true;
  return delegated ? 'auto-merge' : 'none';
}

export function isOrderingDelegated(facts) {
  return orderingMode(facts) !== 'none';
}

/** Ordered strongest-first. Squash merges destroy `ancestor`, hence the other three. */
export const PROOF_KINDS = Object.freeze([
  'ancestor',
  'source-head-trailer',
  'patch-identity',
  'squash-identity',
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
    guards: ['wipWithinCap', 'stackWithinCap', 'baseFetched', 'scopeFree'],
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
    guards: ['orderingDelegated', 'prOpen', 'checksNotStale'],
  },
  { from: 'published', event: 'restack', to: 'published', guards: ['ejectedOnce'] },
  { from: 'queued', event: 'eject', to: 'published', guards: [] },
  { from: 'queued', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  { from: 'published', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  { from: 'active', event: 'integrate', to: 'integrated', guards: ['integratedProof'] },
  {
    from: 'integrated',
    event: 'reap',
    to: 'retired',
    guards: ['integratedProof', 'noOwnedUntracked'],
  },
]);

export const DEFAULT_FACTS = Object.freeze({
  openLanes: 0,
  wipCap: 3,
  stackDepth: 1,
  stackCap: 3,
  baseFetched: false,
  scopeTaken: false,
  onCanonicalMain: false,
  dirtyTracked: false,
  laneCommits: 0,
  pushed: false,
  queueEnabled: false,
  autoMergeAllowed: false,
  requiredCheckCount: 0,
  strict: null,
  prOpen: false,
  laneHeadSha: null,
  checksHeadSha: null,
  ejections: 0,
  integrationProof: null,
  ownedUntracked: false,
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

/**
 * A queued lane has no `restack` row, so an out-of-date base is the queue's
 * problem. This is asserted by tests, not by prose.
 */
export function canRestack(state) {
  return TRANSITIONS.some((t) => t.from === state && t.event === 'restack');
}
