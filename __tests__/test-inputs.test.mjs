import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionEnvironment, readRegular, safePath, snapshot } from '../bin/agentic-os-test-inputs.mjs';
import { ciArguments } from '../bin/agentic-os-test-ci.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'impact inputs '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'package.json'), '{}\n'); writeFileSync(join(root, 'a.mjs'), 'export const a=1;\n');
  writeFileSync(join(root, '.gitignore'), 'package-lock.json\n');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  return { root, git, base, observe: extra => snapshot({ root, base, ...extra }) };
}
test('committed, staged, unstaged and new paths are included; hidden flags cannot mask bytes', t => {
  const f = fixture(t); f.git('switch', '-qc', 'lane');
  writeFileSync(join(f.root, 'committed.mjs'), '1'); f.git('add', '.'); f.git('commit', '-qm', 'lane');
  writeFileSync(join(f.root, 'staged.mjs'), '2'); f.git('add', '.');
  writeFileSync(join(f.root, 'untracked.mjs'), '3');
  f.git('update-index', '--assume-unchanged', 'a.mjs');
  writeFileSync(join(f.root, 'a.mjs'), 'export const a=2;\n');
  assert.deepEqual(f.observe().changed, ['a.mjs', 'committed.mjs', 'staged.mjs', 'untracked.mjs']);
  assert.throws(() => f.observe({ committed: true }), /dirty-ci/);
});
test('rename/deletion and executable modes are compared against the old tree', t => {
  const f = fixture(t); renameSync(join(f.root, 'a.mjs'), join(f.root, 'b.mjs'));
  chmodSync(join(f.root, 'package.json'), 0o755);
  assert.deepEqual(f.observe().changed, ['a.mjs', 'b.mjs', 'package.json']);
});
test('same-size and restored-time changes invalidate source identity', t => {
  const f = fixture(t), before = f.observe();
  writeFileSync(join(f.root, 'a.mjs'), 'export const a=2;\n'); utimesSync(join(f.root, 'a.mjs'), 1, 1);
  assert.notEqual(f.observe().identity.sourceDigest, before.identity.sourceDigest);
});
test('Git baseline is the merge base and a missing baseline fails', t => {
  const f = fixture(t); f.git('switch', '-qc', 'lane');
  writeFileSync(join(f.root, 'lane.txt'), 'lane'); f.git('add', '.'); f.git('commit', '-qm', 'lane');
  f.git('switch', '-q', 'main'); writeFileSync(join(f.root, 'main.txt'), 'main');
  f.git('add', '.'); f.git('commit', '-qm', 'main'); f.git('switch', '-q', 'lane');
  const observed = f.observe({ base: 'main' });
  assert.equal(observed.identity.baseRevision, f.base); assert.deepEqual(observed.changed, ['lane.txt']);
  assert.throws(() => f.observe({ base: 'missing' }), /blocked-test-git/);
  assert.throws(() => f.observe({ head: 'main' }), /checkout-head/);
});
test('ignored npm inputs bind receipts, while symlinks and escaping paths fail', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'package-lock.json'), '{}');
  assert.ok(f.observe().changed.includes('package-lock.json'));
  for (const path of ['../escape', '/absolute', '.git/config', 'a\\b']) assert.throws(() => safePath(path));
  symlinkSync(join(f.root, 'a.mjs'), join(f.root, 'link.mjs')); assert.throws(() => f.observe(), /blocked-test-file/);
  mkdirSync(join(f.root, 'dir')); symlinkSync(join(f.root, 'dir'), join(f.root, 'alias'));
  assert.throws(() => readRegular(f.root, 'alias/a.mjs'), /non-directory/);
});
test('environment transport labels are removed from execution as well as fingerprints', () => {
  assert.deepEqual(executionEnvironment({ NODE_OPTIONS: '--trace-warnings', npm_lifecycle_event: 'land', _: 'npm' }),
    { NODE_OPTIONS: '--trace-warnings' });
});
test('CI binds PR merge parents, merge groups and push-before to the actual checkout', () => {
  const base = 'a'.repeat(40), head = 'b'.repeat(40), merge = 'c'.repeat(40);
  const pr = { pull_request: { base: { sha: base }, head: { sha: head }, merge_commit_sha: null } };
  assert.deepEqual(ciArguments(pr, 'pull_request', merge, [base, head]),
    ['affected', `--base=${base}`, `--head=${merge}`, '--committed', '--fresh']);
  assert.throws(() => ciArguments(pr, 'pull_request', merge, [head, base]), /merge-parents/);
  assert.ok(ciArguments({ merge_group: { base_sha: base, head_sha: merge } }, 'merge_group', merge).includes(`--base=${base}`));
  assert.ok(ciArguments({ before: base, after: head }, 'push', head).includes(`--head=${head}`));
  assert.throws(() => ciArguments({ before: '0'.repeat(40), after: head }, 'push', head), /revision/);
  assert.throws(() => ciArguments({ before: base, after: merge }, 'push', head), /revision/);
  assert.throws(() => ciArguments({}, 'workflow_dispatch', head), /event/);
});
