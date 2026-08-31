import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transition,
  legalEvents,
  canRestack,
  orderingMode,
  TRANSITIONS,
  STATES,
  REFUSALS,
  PROOF_KINDS,
} from '../src/lane-state.mjs';

test('a queued lane cannot restack: the queue owns its base', () => {
  assert.equal(canRestack('queued'), false);
  const result = transition('queued', 'restack', { ejections: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSALS.ILLEGAL);
});

test('ejection buys exactly one restack, never two', () => {
  assert.equal(transition('published', 'restack', { ejections: 1 }).ok, true);
  const second = transition('published', 'restack', { ejections: 2 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, REFUSALS.RESTACK_EXHAUSTED);

  const never = transition('published', 'restack', { ejections: 0 });
  assert.equal(never.reason, REFUSALS.RESTACK_EXHAUSTED);
});

test('provision enforces the WIP cap', () => {
  const base = { baseFetched: true, openLanes: 3, wipCap: 3 };
  assert.equal(transition('planned', 'provision', base).reason, REFUSALS.WIP_CAP);
  assert.equal(transition('planned', 'provision', { ...base, openLanes: 2 }).ok, true);
});

test('provision enforces the stack depth cap', () => {
  const facts = { baseFetched: true, stackDepth: 4, stackCap: 3 };
  assert.equal(transition('planned', 'provision', facts).reason, REFUSALS.STACK_DEPTH);
});

test('provision refuses a scope another open lane owns', () => {
  const facts = { baseFetched: true, scopeTaken: true };
  assert.equal(transition('planned', 'provision', facts).reason, REFUSALS.SCOPE_TAKEN);
});

test('authoring on canonical main is refused, not warned', () => {
  const result = transition('active', 'author', { onCanonicalMain: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSALS.MAIN_AUTHORING);
});

test('publish requires a clean tree with commits already pushed', () => {
  const ready = { laneCommits: 2, pushed: true };
  assert.equal(transition('active', 'publish', ready).ok, true);
  assert.equal(transition('active', 'publish', { ...ready, dirtyTracked: true }).reason, REFUSALS.DIRTY);
  assert.equal(transition('active', 'publish', { ...ready, laneCommits: 0 }).reason, REFUSALS.NO_COMMITS);
  assert.equal(transition('active', 'publish', { ...ready, pushed: false }).reason, REFUSALS.NOT_PUSHED);
});

test('enqueue requires the provider to own landing order', () => {
  const facts = { prOpen: true, laneHeadSha: 'a', checksHeadSha: 'a' };
  assert.equal(transition('published', 'enqueue', facts).reason, REFUSALS.NO_QUEUE);
  assert.equal(transition('published', 'enqueue', { ...facts, queueEnabled: true }).ok, true);

  // Auto-merge with checks and require-up-to-date off is the weaker delegation.
  const autoMerge = { ...facts, autoMergeAllowed: true, requiredCheckCount: 2, strict: false };
  assert.equal(transition('published', 'enqueue', autoMerge).ok, true);
  assert.equal(orderingMode(autoMerge), 'auto-merge');
  assert.equal(orderingMode({ ...autoMerge, queueEnabled: true }), 'merge-queue');
});

test('auto-merge without checks, or with strict on, is not delegation', () => {
  const facts = { prOpen: true, laneHeadSha: 'a', checksHeadSha: 'a', autoMergeAllowed: true };
  assert.equal(orderingMode({ ...facts, requiredCheckCount: 0, strict: false }), 'none');
  assert.equal(orderingMode({ ...facts, requiredCheckCount: 2, strict: true }), 'none');
  assert.equal(
    transition('published', 'enqueue', { ...facts, requiredCheckCount: 2, strict: true }).reason,
    REFUSALS.NO_QUEUE,
  );
});

test('enqueue refuses a head whose checks are stale', () => {
  const facts = { queueEnabled: true, prOpen: true, laneHeadSha: 'new', checksHeadSha: 'old' };
  assert.equal(transition('published', 'enqueue', facts).reason, REFUSALS.STALE_CHECKS);
});

test('nothing is deleted without an integration proof', () => {
  assert.equal(transition('integrated', 'reap', {}).reason, REFUSALS.NOT_INTEGRATED);
  for (const kind of PROOF_KINDS) {
    assert.equal(transition('integrated', 'reap', { integrationProof: kind }).ok, true, kind);
  }
  assert.equal(
    transition('integrated', 'reap', { integrationProof: 'looks-merged' }).reason,
    REFUSALS.NOT_INTEGRATED,
  );
});

test('owned untracked state blocks retirement even with a proof', () => {
  const facts = { integrationProof: 'ancestor', ownedUntracked: true };
  assert.equal(transition('integrated', 'reap', facts).reason, REFUSALS.OWNED_UNTRACKED);
});

test('every transition targets a declared state and retired is terminal', () => {
  for (const row of TRANSITIONS) {
    assert.ok(STATES.includes(row.from), `unknown from state ${row.from}`);
    assert.ok(STATES.includes(row.to), `unknown to state ${row.to}`);
  }
  assert.deepEqual(legalEvents('retired'), []);
});

test('an undefined event is refused rather than silently ignored', () => {
  const result = transition('active', 'deploy', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSALS.ILLEGAL);
});
