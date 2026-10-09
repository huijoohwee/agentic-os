import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transition,
  legalEvents,
  orderingMode,
  TRANSITIONS,
  STATES,
  REFUSALS,
  PROOF_KINDS,
  successorLineage,
} from '../src/lane-state.mjs';
import { governanceDigest } from '../src/governance.mjs';

function reservationPathRelease(overrides = {}) {
  const body = {
    schema: 'agentic-os/reservation-path-release/v1',
    path: 'src/feature.mjs',
    laneHead: '1'.repeat(40),
    protectedHead: '2'.repeat(40),
    lanePathEntry: { mode: '100644', type: 'blob', oid: '3'.repeat(40) },
    protectedPathEntry: { mode: '100644', type: 'blob', oid: '4'.repeat(40) },
    bytesDiffer: true,
    ...overrides,
  };
  return { ...body, digest: governanceDigest(body) };
}

function successorRecord(reservationPathReleases) {
  return {
    ref: 'agent/device/successor',
    handoff: {
      schema: 'agentic-os-lane-successor/v1',
      predecessorRef: 'agent/device/predecessor',
      predecessorHead: '5'.repeat(40),
      ...(reservationPathReleases === undefined ? {} : { reservationPathReleases }),
    },
  };
}

test('unimplemented restack and ejection events are refused', () => {
  assert.equal(transition('queued', 'eject', {}).reason, REFUSALS.ILLEGAL);
  assert.equal(transition('published', 'restack', {}).reason, REFUSALS.ILLEGAL);
});

test('provision relies on the exact ref and external claim boundary for exclusion', () => {
  const facts = { baseFetched: true, openLanes: 500, wipCap: 0, scopeTaken: true };
  assert.equal(transition('planned', 'provision', facts).ok, true);
});

test('authoring on the canonical branch is refused, not warned', () => {
  const result = transition('active', 'author', { onCanonicalBranch: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSALS.CANONICAL_AUTHORING);
});

test('publish requires a clean tree with commits already pushed', () => {
  const ready = { laneCommits: 2, pushed: true };
  assert.equal(transition('active', 'publish', ready).ok, true);
  assert.equal(transition('active', 'publish', { ...ready, dirtyTracked: true }).reason, REFUSALS.DIRTY);
  assert.equal(transition('active', 'publish', { ...ready, laneCommits: 0 }).reason, REFUSALS.NO_COMMITS);
  assert.equal(transition('active', 'publish', { ...ready, pushed: false }).reason, REFUSALS.NOT_PUSHED);
});

test('published successor requires preserved identity, clean descendant, and absent destination', () => {
  const ready = { predecessorExact: true, descendant: true, destinationAbsent: true };
  assert.equal(transition('published', 'successor', ready).to, 'published');
  assert.equal(transition('planned', 'provision', { baseFetched: true }).to, 'active');
  assert.equal(transition('published', 'successor', { ...ready, dirtyTracked: true }).reason,
    REFUSALS.DIRTY);
  assert.equal(transition('published', 'successor', { ...ready, predecessorExact: false }).reason,
    REFUSALS.PREDECESSOR);
  assert.equal(transition('published', 'successor', { ...ready, descendant: false }).reason,
    REFUSALS.DESCENDANT);
  assert.equal(transition('published', 'successor', { ...ready, destinationAbsent: false }).reason,
    REFUSALS.DESTINATION);
});

test('enqueue requires the provider to own landing order', () => {
  const providerReceipt = { ok: true, testedProtectedOrdering: true, headSha: 'a' };
  const facts = { laneHeadSha: 'a', providerReceipt };
  assert.equal(transition('published', 'enqueue', facts).reason, REFUSALS.NO_QUEUE);
  const capable = { ...facts, providerObservationComplete: true,
    handoffPolicySatisfied: true,
    queueEnabled: true, queuePolicySatisfied: true,
    requiredChecksSatisfied: true,
    mergeGroupSupported: true };
  assert.equal(transition('published', 'enqueue', capable).ok, true);

  const autoMerge = { ...facts, autoMergeAllowed: true };
  assert.equal(transition('published', 'enqueue', autoMerge).reason, REFUSALS.NO_QUEUE);
  assert.equal(orderingMode(autoMerge), 'none');
  assert.equal(orderingMode({ ...capable }), 'merge-queue');
  assert.equal(orderingMode({ ...capable, queuePolicySatisfied: false }), 'none');
  assert.equal(orderingMode({ ...capable, requiredChecksSatisfied: false }), 'none');
  assert.equal(orderingMode({ ...capable, mergeGroupSupported: false }), 'none');
  assert.equal(orderingMode({ ...capable, handoffPolicySatisfied: false }), 'none');
  assert.equal(orderingMode({ ...capable, providerObservationComplete: false }), 'none');
});

test('auto-merge without checks, or with strict on, is not delegation', () => {
  const facts = { laneHeadSha: 'a', autoMergeAllowed: true };
  assert.equal(orderingMode({ ...facts, queueEnabled: true, queuePolicySatisfied: true,
    requiredChecksSatisfied: false, mergeGroupSupported: true }), 'none');
  assert.equal(
    transition('published', 'enqueue', { ...facts, queueEnabled: true,
      queuePolicySatisfied: true, requiredChecksSatisfied: false,
      mergeGroupSupported: true }).reason,
    REFUSALS.NO_QUEUE,
  );
});

test('enqueue refuses an absent, failed, or mismatched provider handoff receipt', () => {
  const facts = { providerObservationComplete: true,
    handoffPolicySatisfied: true,
    queueEnabled: true, queuePolicySatisfied: true,
    requiredChecksSatisfied: true,
    mergeGroupSupported: true, laneHeadSha: 'new' };
  assert.equal(transition('published', 'enqueue', facts).reason, REFUSALS.PROVIDER_HANDOFF);
  assert.equal(transition('published', 'enqueue', {
    ...facts, providerReceipt: { ok: false, testedProtectedOrdering: false, headSha: 'new' },
  }).reason, REFUSALS.PROVIDER_HANDOFF);
  assert.equal(transition('published', 'enqueue', {
    ...facts, providerReceipt: { ok: true, testedProtectedOrdering: true, headSha: 'old' },
  }).reason, REFUSALS.PROVIDER_HANDOFF);
});

test('integration proof is exact and compatibility cleanup is not a lane transition', () => {
  for (const kind of PROOF_KINDS) {
    assert.equal(transition('queued', 'integrate', { integrationProof: kind }).ok, true, kind);
  }
  assert.equal(
    transition('queued', 'integrate', { integrationProof: 'looks-merged' }).reason,
    REFUSALS.NOT_INTEGRATED,
  );
  assert.equal(transition('integrated', 'reap', { integrationProof: 'ancestor' }).reason,
    REFUSALS.ILLEGAL);
});

test('every transition targets a declared state and integrated has no local cleanup event', () => {
  for (const row of TRANSITIONS) {
    assert.ok(STATES.includes(row.from), `unknown from state ${row.from}`);
    assert.ok(STATES.includes(row.to), `unknown to state ${row.to}`);
  }
  assert.deepEqual(legalEvents('integrated'), []);
});

test('an undefined event is refused rather than silently ignored', () => {
  const result = transition('active', 'deploy', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSALS.ILLEGAL);
});

test('successor lineage accepts exact scope-release receipts while retaining strict fields', () => {
  const record = successorRecord([reservationPathRelease()]);
  assert.equal(successorLineage(record), record.handoff);
  const legacy = successorRecord();
  assert.equal(successorLineage(legacy), legacy.handoff);
  assert.equal(successorLineage({ ...record, handoff: { ...record.handoff, extra: true } }), false);
  const normalized = successorRecord([reservationPathRelease()]);
  normalized.handoff = Object.assign(Object.create(null), normalized.handoff);
  normalized.handoff.reservationPathReleases = normalized.handoff.reservationPathReleases
    .map(value => Object.assign(Object.create(null), value));
  assert.equal(successorLineage(normalized), normalized.handoff);
});

test('successor lineage rejects altered, malformed, duplicate, or unbound scope-release evidence', () => {
  const valid = reservationPathRelease();
  const altered = { ...valid, bytesDiffer: false };
  const wrongDigest = { ...valid, digest: '0'.repeat(64) };
  const extraField = { ...valid, note: 'unbound' };
  const invalidPath = reservationPathRelease({ path: '../outside.mjs' });
  const invalidEntry = reservationPathRelease({ lanePathEntry: { mode: '120000', type: 'blob', oid: '3'.repeat(40) } });
  for (const evidence of [altered, wrongDigest, extraField, invalidPath, invalidEntry])
    assert.equal(successorLineage(successorRecord([evidence])), false);
  assert.equal(successorLineage(successorRecord([valid, valid])), false);
  assert.equal(successorLineage(successorRecord(Array(1025).fill(valid))), false);
});

test('successor lineage accepts a receipt proving the released path already matched protected bytes', () => {
  const entry = { mode: '100644', type: 'blob', oid: '6'.repeat(40) };
  const evidence = reservationPathRelease({ path: 'docs/unchanged.md',
    lanePathEntry: { ...entry }, protectedPathEntry: { ...entry }, bytesDiffer: false });
  assert.equal(successorLineage(successorRecord([evidence])).predecessorRef, 'agent/device/predecessor');
});
