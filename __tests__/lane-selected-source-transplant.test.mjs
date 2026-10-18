import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { put, get } from '../src/lane-records.mjs';
import { applySelectedSourceTransplant, planSelectedSourceTransplant, prepareSelectedSourceTransplant,
  verifySelectedSourceTransplantRecovery } from '../src/lane-selected-source-transplant.mjs';

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }).trim();
const commit = (cwd, message) => { run(cwd, 'add', '--all'); run(cwd, 'commit', '--quiet', '-m', message); return run(cwd, 'rev-parse', 'HEAD'); };

function fixture(t, { divergent = false } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'lane-selected-source-transplant-'));
  const root = join(parent, 'repo'), remote = join(parent, 'remote.git'), lane = join(parent, 'lane'); mkdirSync(root);
  run(root, 'init', '--quiet', '--initial-branch=main');
  for (const [key, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) run(root, 'config', key, value);
  writeFileSync(join(root, 'source.txt'), 'first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\neighth\nninth\ntenth\n'); writeFileSync(join(root, 'base.txt'), 'base\n');
  let base = commit(root, 'base'); run(root, 'init', '--quiet', '--bare', remote); run(root, 'remote', 'add', 'origin', remote); run(root, 'push', '--quiet', '-u', 'origin', 'main');
  const ref = 'agent/test-device/transplant'; run(root, 'worktree', 'add', '--quiet', '-b', ref, lane, base);
  if (divergent) {
    writeFileSync(join(lane, 'source.txt'), 'first\nsecond\nthird\nhistoric fourth\nfifth\nsixth\nseventh\neighth\nninth\ntenth\n');
    base = commit(lane, 'historic source advance');
  }
  writeFileSync(join(lane, 'source.txt'), `source first\nsecond\nthird\n${divergent ? 'historic fourth' : 'fourth'}\nfifth\nsixth\nseventh\neighth\nninth\ntenth\n`); const source = commit(lane, 'selected source');
  writeFileSync(join(root, 'source.txt'), 'first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\neighth\nninth\ntarget tenth\n'); writeFileSync(join(root, 'target.txt'), 'protected\n');
  const target = commit(root, 'protected advance'); run(root, 'push', '--quiet', 'origin', 'main'); run(root, 'fetch', '--quiet', 'origin');
  put({ ref, device: 'test-device', scope: 'transplant', state: 'active', base: 'refs/remotes/origin/main', baseSha: base,
    worktree: realpathSync(lane), pr: null, createdAt: new Date(0).toISOString(), head: source, writePaths: ['source.txt'] }, root);
  t.after(() => rmSync(parent, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));
  return { root, lane, ref, base, source, target };
}

function input(f, override = {}) {
  return { cwd: f.lane, ref: f.ref, expectedHead: f.source, expectedBase: f.base,
    targetRef: 'refs/remotes/origin/main', expectedTarget: f.target, selectedPaths: ['source.txt'], stopped: true, ...override };
}

test('selected source transplant retains the original lane and applies only the verified source delta', t => {
  const f = fixture(t), planned = planSelectedSourceTransplant(input(f));
  assert.equal(planned.candidateHead, null); assert.equal(run(f.lane, 'rev-parse', 'HEAD'), f.source);
  const prepared = prepareSelectedSourceTransplant(planned), receipt = applySelectedSourceTransplant(prepared);
  assert.equal(receipt.schema, 'agentic-os/lane-selected-source-transplant-receipt/v1');
  assert.equal(receipt.previousHead, f.source); assert.equal(receipt.baseHead, f.base); assert.equal(receipt.targetHead, f.target);
  assert.equal(run(f.lane, 'rev-parse', 'HEAD'), receipt.head); assert.equal(run(f.lane, 'show', '-s', '--format=%P', 'HEAD'), f.target);
  assert.equal(run(f.lane, 'diff', '--name-only', f.target, receipt.head), 'source.txt');
  assert.equal(run(f.lane, 'show', `${receipt.head}:source.txt`), 'source first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\neighth\nninth\ntarget tenth');
  assert.equal(run(f.lane, 'show', `${receipt.head}:target.txt`), 'protected');
  assert.equal(run(f.root, 'rev-parse', prepared.oldRef), f.source); assert.equal(run(f.root, 'rev-parse', prepared.deltaRef), prepared.deltaHead);
  assert.equal(run(f.root, 'rev-parse', prepared.candidateRef), receipt.head); assert.equal(run(f.lane, 'status', '--porcelain'), '');
  const record = get(f.ref, f.root); assert.equal(record.head, receipt.head);
  assert.deepEqual(JSON.parse(JSON.stringify(record.handoff)), {
    schema: 'agentic-os-lane-selected-source-transplant/v1', preservedRef: prepared.oldRef, preservedHead: f.source,
    sourceBase: f.base, targetHead: f.target, selectedPaths: ['source.txt'], planDigest: prepared.digest,
  });
  const recovery = { schema: 'agentic-os/workflow-selected-source-recovery/v1', candidateHead: receipt.head,
    planDigest: prepared.digest, priorAllocationHead: f.base,
    ref: f.ref, selectedPaths: ['source.txt'], sourceBase: f.base, sourceHead: f.source, targetHead: f.target };
  assert.equal(verifySelectedSourceTransplantRecovery(f.root, recovery), true);
  for (const change of [{ candidateHead: f.source }, { planDigest: '0'.repeat(64) }, { sourceHead: f.base },
    { selectedPaths: ['base.txt'] }, { targetHead: f.base }])
    assert.throws(() => verifySelectedSourceTransplantRecovery(f.root, { ...recovery, ...change }), /blocked-lane-selected-source-transplant-recovery/);
  assert.equal(applySelectedSourceTransplant(planSelectedSourceTransplant(input(f))).resumed, true);
});

test('selected source transplant rejects incomplete selection and preserves the source lane', t => {
  const f = fixture(t);
  assert.throws(() => planSelectedSourceTransplant(input(f, { selectedPaths: ['base.txt'] })), { reason: 'blocked-lane-selected-source-transplant-selection' });
  assert.equal(run(f.lane, 'rev-parse', 'HEAD'), f.source); assert.equal(run(f.lane, 'status', '--porcelain'), '');
});

test('selected source transplant applies an exact source delta when its parent predates a divergent protected target', t => {
  const f = fixture(t, { divergent: true });
  const receipt = applySelectedSourceTransplant(planSelectedSourceTransplant(input(f)));
  assert.equal(run(f.lane, 'show', `${receipt.head}:source.txt`), 'source first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\neighth\nninth\ntarget tenth');
  assert.equal(run(f.lane, 'show', '-s', '--format=%P', receipt.head), f.target);
  assert.equal(run(f.lane, 'diff', '--name-only', f.target, receipt.head), 'source.txt');
});

test('selected source transplant accepts only an exact readmit advance of the recorded lane head', t => {
  const f = fixture(t), original = get(f.ref, f.root);
  put({ ...original, head: f.base }, f.root);
  const prepared = prepareSelectedSourceTransplant(planSelectedSourceTransplant(input(f)));
  put({ ...get(f.ref, f.root), head: f.source }, f.root);
  const receipt = applySelectedSourceTransplant(prepared);
  assert.equal(receipt.head, run(f.lane, 'rev-parse', 'HEAD'));
  assert.equal(get(f.ref, f.root).head, receipt.head);
  assert.equal(run(f.lane, 'status', '--porcelain'), '');
});

test('selected source transplant restores the bound pre-readmit head when it differs from the delta parent', t => {
  const f = fixture(t, { divergent: true }), original = get(f.ref, f.root), recordHead = run(f.lane, 'rev-parse', `${f.base}^`);
  put({ ...original, head: recordHead }, f.root);
  const prepared = prepareSelectedSourceTransplant(planSelectedSourceTransplant(input(f)));
  assert.notEqual(prepared.recordHead, prepared.expectedBase);
  put({ ...get(f.ref, f.root), head: f.source }, f.root);
  const receipt = applySelectedSourceTransplant(prepared);
  assert.equal(receipt.head, run(f.lane, 'rev-parse', 'HEAD'));
  assert.equal(get(f.ref, f.root).head, receipt.head);
  assert.equal(run(f.lane, 'status', '--porcelain'), '');
});

test('selected source transplant rejects a readmit advance with any other lane-record drift', t => {
  const f = fixture(t), original = get(f.ref, f.root);
  put({ ...original, head: f.base }, f.root);
  const prepared = prepareSelectedSourceTransplant(planSelectedSourceTransplant(input(f)));
  put({ ...get(f.ref, f.root), head: f.source, writePaths: ['other.txt'] }, f.root);
  assert.throws(() => applySelectedSourceTransplant(prepared), { reason: 'blocked-lane-selected-source-transplant-record' });
  assert.equal(run(f.lane, 'rev-parse', 'HEAD'), f.source);
  assert.equal(run(f.lane, 'status', '--porcelain'), '');
});

test('selected source transplant refuses an overlapping target change without moving the lane', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'source.txt'), 'target first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\neighth\nninth\ntarget tenth\n');
  const target = commit(f.root, 'overlapping protected advance'); run(f.root, 'push', '--quiet', 'origin', 'main'); run(f.root, 'fetch', '--quiet', 'origin');
  assert.throws(() => prepareSelectedSourceTransplant(planSelectedSourceTransplant(input(f, { expectedTarget: target }))), { reason: 'blocked-lane-selected-source-transplant-merge' });
  assert.equal(run(f.lane, 'rev-parse', 'HEAD'), f.source); assert.equal(run(f.lane, 'status', '--porcelain'), '');
});
