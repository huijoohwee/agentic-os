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
} from '../src/lane-state.mjs';

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
