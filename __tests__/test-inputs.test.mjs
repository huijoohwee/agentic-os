import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionEnvironment, readRegular, safePath, snapshot, snapshotReader } from '../bin/agentic-os-test-inputs.mjs';
import { ciEvaluatorAllocation } from '../bin/agentic-os-tests.mjs';
import { ciArguments } from '../bin/agentic-os-test-ci.mjs';
import { consumerSnapshotReader } from '../bin/agentic-os-validation-inputs.mjs';

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
test('test identity ignores unrelated shared refs but binds requested refs', t => {
  const f = fixture(t); f.git('switch', '-qc', 'lane');
  const before = f.observe({ base: 'main' }).identity;
  f.git('update-ref', 'refs/remotes/origin/unrelated-device', f.base);
  const unrelated = f.observe({ base: 'main' }).identity;
  assert.deepEqual(unrelated, before);
  const next = f.git('commit-tree', `${f.base}^{tree}`, '-p', f.base, '-m', 'advance shared base');
  f.git('update-ref', 'refs/heads/main', next, f.base);
  const relevant = f.observe({ base: 'main' }).identity;
  assert.notEqual(relevant.requestedBase, before.requestedBase);
  assert.notEqual(relevant.refsDigest, before.refsDigest);
});
for (const consumer of [false, true]) test(`workflow navigation is separate from executable Git inputs: consumer=${consumer}`, t => {
  const f = fixture(t), observe = consumer ? consumerSnapshotReader({ root: f.root, base: f.base }) : f.observe;
  const before = observe().identity;
  for (const key of ['workflowManifest', ...['owner', 'member', 'ref'].map(kind => `workflow-${kind}-${'a'.repeat(64)}`)])
    f.git('config', `agentic-os.${key}`, '/retained/independent/manifest.json');
  assert.deepEqual(observe().identity, before);
  for (const key of ['core.autocrlf', 'agentic-os.workspaceRoot', 'agentic-os.workflow-policy', 'agentic-os.workflow-owner-other']) {
    const prior = observe().identity.configurationDigest;
    f.git('config', key, 'false');
    assert.notEqual(observe().identity.configurationDigest, prior, key);
  }
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

test('run-local snapshots reuse unchanged file objects but detect restored timestamps, new paths and deletion', t => {
  const f = fixture(t), observe = snapshotReader({ root: f.root, base: f.base });
  const first = observe(), second = observe();
  assert.equal(first.before, second.before);
  assert.equal(first.after.get('a.mjs'), second.after.get('a.mjs'));
  writeFileSync(join(f.root, 'a.mjs'), 'export const a=9;\n'); utimesSync(join(f.root, 'a.mjs'), 1, 1);
  const third = observe();
  assert.notEqual(third.after.get('a.mjs').digest, first.after.get('a.mjs').digest);
  writeFileSync(join(f.root, 'new.mjs'), 'new'); rmSync(join(f.root, 'a.mjs'));
  assert.deepEqual(observe().changed, ['a.mjs', 'new.mjs']);
});


test('CI evaluator allocation requires the exact budgets owner and current provider context', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const revision = 'a'.repeat(40), env = { GITHUB_ACTIONS: 'true', GITHUB_JOB: 'test', GITHUB_SHA: revision,
    GITHUB_REPOSITORY: 'example/owner', GITHUB_WORKFLOW_REF: 'example/owner/.github/workflows/ci.yml@refs/heads/main',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  const result = ciEvaluatorAllocation(workflow, env, revision);
  assert.equal(result.name, 'budgets'); assert.equal(result.status, 'not-observed');
  assert.equal(result.workflowDigest.length, 64);
  for (const key of Object.keys(env)) {
    const bad = { ...env }; delete bad[key];
    assert.throws(() => ciEvaluatorAllocation(workflow, bad, revision), /evaluator-owner/);
  }
  for (const changed of [workflow.replace('run: npm run evals', 'run: true'),
    workflow.replace('    name: budgets', '    name: optional'),
    workflow.replace('    name: budgets', '    name: budgets\n    continue-on-error: true')])
    assert.throws(() => ciEvaluatorAllocation(changed, env, revision), /evaluator-owner/);
  assert.throws(() => ciEvaluatorAllocation(workflow, env, 'b'.repeat(40)), /evaluator-owner/);
});
