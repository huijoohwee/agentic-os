import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReservationScopeReleasePlan, applyReservationScopeRelease } from '../src/patch-identity.mjs';
import * as laneRecords from '../src/lane-records.mjs';
import { assertDisjointReservation } from '../src/worktree.mjs';

function fixture(t, { state = 'published', pr = 17, changedReservedPath = false } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-scope-release-'));
  const root = join(parent, 'repo'), lanePath = join(parent, 'lane');
  mkdirSync(root);
  const run = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  mkdirSync(join(root, 'canvas', 'src'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'canvas', 'src', 'App.tsx'), 'export const value = 1;\n');
  writeFileSync(join(root, 'docs', 'base.md'), 'base\n');
  run(['add', '.']);
  run(['commit', '--quiet', '--message', 'base']);
  const base = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', base]);
  const ref = 'agent/device-0232231d4a19/commerce-data-view-embed';
  run(['worktree', 'add', '--quiet', '-b', ref, lanePath, base]);
  if (changedReservedPath) writeFileSync(join(lanePath, 'canvas', 'src', 'App.tsx'), 'export const value = 2;\n');
  writeFileSync(join(lanePath, 'docs', 'commerce.md'), 'commerce reservation\n');
  run(['add', '.'], lanePath);
  run(['commit', '--quiet', '--message', 'published candidate'], lanePath);
  const head = run(['rev-parse', 'HEAD'], lanePath);
  run(['update-ref', `refs/remotes/origin/${ref}`, head]);
  laneRecords.put({ ref, device: 'device-0232231d4a19', scope: 'commerce-data-view-embed',
    state, base: 'refs/remotes/origin/main', baseSha: base,
    worktree: lanePath, pr, createdAt: new Date(0).toISOString(),
    head: state === 'published' ? head : base,
    writePaths: ['canvas/src/App.tsx', 'docs/commerce.md'] }, lanePath);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { root, lanePath, ref, run };
}

const request = (s) => ({ cwd: s.root, ref: s.ref, path: 'canvas/src/App.tsx',
  protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' });

test('release removes only the exact equal-byte claim and returns a retained receipt', (t) => {
  const s = fixture(t), plan = createReservationScopeReleasePlan(request(s));
  assert.equal(plan.authorizesEffects, false);
  assert.deepEqual(plan.resultingWritePaths, ['docs/commerce.md']);
  const receipt = applyReservationScopeRelease({ ...request(s), plan,
    authorization: `agentic-os:scope-release:${plan.planDigest}`, stopped: true });
  assert.equal(receipt.effectsRetained, true);
  assert.equal(receipt.branchBytesChanged, false);
  assert.equal(receipt.worktreeBytesChanged, false);
  assert.equal(receipt.retainedAuthoredBytes, false);
  assert.deepEqual(laneRecords.get(s.ref, s.root).writePaths, ['docs/commerce.md']);
  assert.equal(s.run(['rev-parse', s.ref]), plan.laneHead);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lanePath), plan.laneHead);
  assert.equal(s.run(['status', '--porcelain=v1', '--untracked-files=all'], s.lanePath), '');
});

test('release retains exact authored bytes and frees only the handoff path for a successor reservation', (t) => {
  const s = fixture(t, { changedReservedPath: true }), plan = createReservationScopeReleasePlan(request(s));
  assert.equal(plan.retainedPathEvidence.bytesDiffer, true);
  assert.throws(() => assertDisjointReservation({ cwd: s.root,
    ref: 'agent/device-0232231d4a19/sequence-import-publication-race', writePaths: ['canvas/src/App.tsx'],
    protectedRef: 'refs/remotes/origin/main', records: laneRecords.load(s.root).lanes }),
  { reason: 'blocked-write-scope-overlap' });
  const receipt = applyReservationScopeRelease({ ...request(s), plan,
    authorization: `agentic-os:scope-release:${plan.planDigest}`, stopped: true });
  assert.equal(receipt.retainedAuthoredBytes, true);
  assert.equal(receipt.retainedPathEvidence.lanePathEntry.oid, plan.pathEntry.oid);
  const record = laneRecords.get(s.ref, s.root);
  assert.equal(record.handoff.reservationPathReleases[0].path, 'canvas/src/App.tsx');
  assertDisjointReservation({ cwd: s.root,
    ref: 'agent/device-0232231d4a19/sequence-import-publication-race', writePaths: ['canvas/src/App.tsx'],
    protectedRef: 'refs/remotes/origin/main', records: laneRecords.load(s.root).lanes });
  assert.throws(() => assertDisjointReservation({ cwd: s.root,
    ref: 'agent/device-0232231d4a19/sequence-import-publication-race', writePaths: ['canvas/src'],
    protectedRef: 'refs/remotes/origin/main', records: laneRecords.load(s.root).lanes }),
  { reason: 'blocked-write-scope-overlap' });
  assert.equal(s.run(['show', `${s.ref}:canvas/src/App.tsx`]), 'export const value = 2;');
});

test('active unpublished lane releases a clean claim without adopting its candidate head', (t) => {
  const s = fixture(t, { state: 'active', pr: null }), plan = createReservationScopeReleasePlan(request(s));
  assert.equal(plan.laneState, 'active'); assert.notEqual(plan.laneRecordHead, plan.laneHead);
  const receipt = applyReservationScopeRelease({ ...request(s), plan,
    authorization: `agentic-os:scope-release:${plan.planDigest}`, stopped: true });
  assert.equal(receipt.laneState, 'active');
  assert.deepEqual(laneRecords.get(s.ref, s.root).writePaths, ['docs/commerce.md']);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lanePath), plan.laneHead);
});

test('changed reserved bytes stale the plan and preserve the claim', (t) => {
  const s = fixture(t), plan = createReservationScopeReleasePlan(request(s));
  writeFileSync(join(s.lanePath, 'canvas', 'src', 'App.tsx'), 'unpublished edit\n');
  assert.throws(() => applyReservationScopeRelease({ ...request(s), plan,
    authorization: `agentic-os:scope-release:${plan.planDigest}`, stopped: true }),
  { reason: 'blocked-reservation-path-dirty' });
  assert.deepEqual(laneRecords.get(s.ref, s.root).writePaths,
    ['canvas/src/App.tsx', 'docs/commerce.md']);
});

test('arguments require digest authorization, exact path, and stopped state', async () => {
  const { validateCommandArguments } = await import('../bin/agentic-os-argv.mjs');
  assert.equal(validateCommandArguments('release-common', ['scope-release', 'plan', '--ref=agent/device-0232231d4a19/commerce-data-view-embed', '--path=canvas/src/App.tsx']), null);
  assert.match(validateCommandArguments('release-common', ['scope-release', 'apply', '--plan=x', '--authorize=x']), /missing --stopped/);
});
