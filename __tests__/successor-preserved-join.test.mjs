import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { put, get } from '../src/lane-records.mjs';
import { provision, runPublishedLaneSuccessor } from '../src/worktree.mjs';

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-preserved-join-'));
  const root = join(parent, 'repo'), bare = join(parent, 'remote.git');
  mkdirSync(root);
  const run = (args, cwd = root) => git(args, { cwd });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  run(['add', 'base.txt']); run(['commit', '--quiet', '-m', 'base']);
  const base = run(['rev-parse', 'HEAD']);
  run(['init', '--quiet', '--bare', bare]); run(['remote', 'add', 'origin', bare]);
  const ref = 'agent/test-device/published';
  const lane = provision({ ref, scope: 'published', device: 'test-device', baseSha: base, cwd: root });
  writeFileSync(join(lane.path, 'change.txt'), 'candidate\n');
  run(['add', 'change.txt'], lane.path); run(['commit', '--quiet', '-m', 'candidate'], lane.path);
  const source = run(['rev-parse', 'HEAD'], lane.path), tree = run(['rev-parse', `${source}^{tree}`]);
  const canonical = run(['commit-tree', tree, '-p', base, '-m', 'protected squash']);
  run(['merge', '--quiet', '--ff-only', canonical]);
  run(['push', '--quiet', 'origin', 'main']);
  const commit = (resultTree = tree, parents = [source, canonical]) =>
    run(['commit-tree', resultTree, ...parents.flatMap(p => ['-p', p]), '-m', 'preserved join']);
  const publish = tip => {
    run(['merge', '--quiet', '--ff-only', tip], lane.path);
    run(['push', '--quiet', 'origin', ref]);
    put({ ref, device: 'test-device', scope: 'published', state: 'published',
      base: 'refs/remotes/origin/main', baseSha: base, worktree: lane.path, pr: 17,
      createdAt: new Date(0).toISOString(), head: tip, writePaths: ['change.txt'] }, lane.path);
  };
  const invoke = (tip, expandedWritePaths = null) => runPublishedLaneSuccessor({ cwd: lane.path, predecessorRef: ref,
    scope: 'continued', explicitHead: tip, remote: 'origin', protectedRef: 'refs/remotes/origin/main', out() {},
    expandedWritePaths });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { root, bare, lane, ref, run, base, source, tree, canonical, commit, publish, invoke };
}

test('successor retains exact published refs and bytes across a protected equal-tree join', t => {
  const s = fixture(t), tip = s.commit(); s.publish(tip); s.invoke(tip);
  assert.equal(s.run(['rev-parse', s.ref]), tip);
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse', `refs/heads/${s.ref}`]), tip);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), tip);
  assert.equal(s.run(['status', '--porcelain'], s.lane.path), '');
  const record = get('agent/test-device/continued', s.lane.path);
  assert.deepEqual(record.writePaths, ['change.txt']);
  assert.equal(record.baseSha, s.base);
  assert.equal(record.handoff.predecessorHead, tip);
});

for (const kind of ['changed-result', 'different-parent', 'unprotected-parent', 'three-parents']) {
  test(`successor preserves the lane when a join has ${kind}`, t => {
    const s = fixture(t), baseTree = s.run(['rev-parse', `${s.base}^{tree}`]);
    const side = s.run(['commit-tree', kind === 'different-parent' ? baseTree : s.tree,
      '-p', kind === 'different-parent' ? s.source : s.base, '-m', 'unprotected side']);
    const parents = kind === 'three-parents' ? [s.source, s.canonical, side]
      : kind === 'different-parent' ? [side, s.canonical]
        : [s.source, kind === 'unprotected-parent' ? side : s.canonical];
    const tip = s.commit(kind === 'changed-result' ? baseTree : s.tree, parents); s.publish(tip);
    assert.throws(() => s.invoke(tip), { reason: 'blocked-successor-merge' });
    assert.equal(s.run(['branch', '--show-current'], s.lane.path), s.ref);
    assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), tip);
  });
}

test('equal-tree joins cannot hide outside-scope paths from their parent history', t => {
  const s = fixture(t);
  writeFileSync(join(s.lane.path, 'outside.txt'), 'transient\n');
  s.run(['add', 'outside.txt'], s.lane.path); s.run(['commit', '--quiet', '-m', 'outside'], s.lane.path);
  s.run(['rm', '--quiet', 'outside.txt'], s.lane.path); s.run(['commit', '--quiet', '-m', 'remove'], s.lane.path);
  const tip = s.commit(s.tree, [s.run(['rev-parse', 'HEAD'], s.lane.path), s.canonical]); s.publish(tip);
  assert.throws(() => s.invoke(tip), { reason: 'blocked-write-outside-reservation' });
  assert.equal(s.run(['branch', '--show-current'], s.lane.path), s.ref);
});

test('successor accepts an explicit reservation expansion for published follow-up fixes', t => {
  const s = fixture(t);
  writeFileSync(join(s.lane.path, 'outside.txt'), 'transient\n');
  s.run(['add', 'outside.txt'], s.lane.path); s.run(['commit', '--quiet', '-m', 'outside'], s.lane.path);
  s.run(['rm', '--quiet', 'outside.txt'], s.lane.path); s.run(['commit', '--quiet', '-m', 'remove'], s.lane.path);
  const tip = s.commit(s.tree, [s.run(['rev-parse', 'HEAD'], s.lane.path), s.canonical]); s.publish(tip);
  s.invoke(tip, ['change.txt', 'outside.txt']);
  const record = get('agent/test-device/continued', s.lane.path);
  assert.deepEqual(record.writePaths, ['change.txt', 'outside.txt']);
});

test('preserved joins have a hard 32-commit observation cap', t => {
  const s = fixture(t); let tip = s.source;
  for (let n = 0; n < 33; n++) tip = s.commit(s.tree, [tip, s.canonical]);
  s.publish(tip);
  assert.throws(() => s.invoke(tip), { reason: 'blocked-successor-merge' });
  assert.equal(s.run(['branch', '--show-current'], s.lane.path), s.ref);
});
