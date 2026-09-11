import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planUserCleanup, applyUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { observeMergedReview, reviewOptions } from '../bin/agentic-os-cleanup-review.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { acquireOperationLock, finishOperationLock } from '../src/git.mjs';
const NOW = Date.parse('2026-09-11T00:00:00Z');
const g = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-user-cleanup-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repository'), target = join(parent, 'author'); mkdirSync(root);
  g(root, 'init', '--quiet', '--initial-branch=main');
  g(root, 'config', 'user.name', 'Fixture'); g(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitignore'), 'runtime/\n.harness\n'); writeFileSync(join(root, 'file.txt'), 'base\n');
  g(root, 'add', '.'); g(root, 'commit', '--quiet', '-m', 'base');
  const branch = 'agent/device/task'; g(root, 'worktree', 'add', '--quiet', '-b', branch, target);
  writeFileSync(join(target, 'file.txt'), 'completed\n'); g(target, 'add', '.'); g(target, 'commit', '--quiet', '-m', 'candidate');
  const head = g(target, 'rev-parse', 'HEAD');
  g(root, 'merge', '--squash', '--quiet', branch); g(root, 'commit', '--quiet', '-m', 'merged review');
  const merge = g(root, 'rev-parse', 'HEAD'); g(root, 'update-ref', 'refs/remotes/origin/main', merge);
  g(root, 'remote', 'add', 'origin', 'https://github.com/example/private.git');
  g(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine');
  mkdirSync(join(target, 'runtime')); writeFileSync(join(target, 'runtime/state.txt'), 'local evidence\n');
  symlinkSync('/nonexistent/retained/harness', join(target, '.harness'));
  const repository = 'example/private', pr = 7, workflow = '.github/workflows/planning.yml';
  const values = {
    pull: { number: pr, merged: true, state: 'closed', html_url: `https://github.com/${repository}/pull/${pr}`,
      merged_at: '2026-09-10T00:00:00Z', merge_commit_sha: merge,
      base: { ref: 'main', repo: { full_name: repository } }, head: { sha: head, ref: branch, repo: { full_name: repository } } },
    checks: { total_count: 1, check_runs: [{ name: 'planning', id: 123, head_sha: head, status: 'completed',
      conclusion: 'success', app: { slug: 'github-actions' }, details_url: `https://github.com/${repository}/actions/runs/456/job/123` }] },
    run: { id: 456, head_sha: head, head_branch: branch, repository: { full_name: repository },
      head_repository: { full_name: repository }, event: 'pull_request', path: workflow, run_attempt: 1,
      status: 'completed', conclusion: 'success' },
  };
  const calls = [], api = path => {
    calls.push(path);
    const value = path === `repos/${repository}/pulls/${pr}` ? values.pull
      : path === `repos/${repository}/commits/${head}/check-runs?filter=latest&per_page=100` ? values.checks
        : path === `repos/${repository}/actions/runs/456` ? values.run : null;
    assert.ok(value, `unexpected provider read: ${path}`); return structuredClone(value);
  };
  const options = { api, observeRemote: () => `${merge}\trefs/heads/main`, now: () => NOW };
  const input = { cwd: root, target, pr, requiredChecks: ['planning'], workflow };
  return { root, target, parent, head, merge, branch, values, calls, input, options,
    plan: () => planUserCleanup(input, options),
    apply: (plan, overrides = {}) => applyUserCleanup(plan, { cwd: root, ...options,
      authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true, ...overrides }) };
}
test('explicit local consent quarantines exact clean merged work and ignored bytes; replay is read-only and unprotected', t => {
  const s = fixture(t), plan = s.plan(), before = g(s.root, 'show-ref');
  const receipt = s.apply(plan);
  assert.equal(receipt.result, 'quarantined'); assert.equal(existsSync(s.target), false);
  assert.equal(receipt.authority, 'explicit-local-user-consent'); assert.equal(receipt.protectionProven, false);
  assert.equal(receipt.providerAuthority, false); assert.equal(receipt.claimRetired, false);
  assert.equal(receipt.bytesDeleted, false); assert.equal(receipt.branchesMutated, false);
  assert.equal(g(s.root, 'show-ref'), before); assert.equal(g(s.root, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(receipt.projectionQuarantinePath, 'runtime/state.txt'), 'utf8'), 'local evidence\n');
  assert.equal(readlinkSync(join(receipt.projectionQuarantinePath, '.harness')), '/nonexistent/retained/harness');
  assert.ok(existsSync(receipt.registrationQuarantinePath));
  assert.equal(s.apply(plan, { now: () => NOW + 900001 }).replayed, true);
  assert.equal(s.calls.some(p => /protection|rulesets|dispatch/.test(p)), false);
});
test('missing exact consent, stop acknowledgement, local enrollment and governed profiles refuse effects', t => {
  const s = fixture(t), plan = s.plan();
  for (const overrides of [{ authorization: null }, { stopped: false }, { authorization: plan.planDigest }])
    assert.throws(() => s.apply(plan, overrides), /explicit-authorization/);
  g(s.root, 'config', '--unset', 'agentic-os.userCleanup');
  assert.throws(() => s.apply(plan), /local-enrollment/);
  g(s.root, 'config', 'agentic-os.userCleanup', 'quarantine');
  writeFileSync(join(s.root, '.agentic-os.json'), '{}\n');
  assert.throws(() => s.apply(plan), /profile-governed/); assert.ok(existsSync(s.target));
});
test('expired plans, changed ignored bytes and changed remote evidence fail before quarantine', t => {
  const s = fixture(t), plan = s.plan();
  assert.throws(() => s.apply(plan, { now: () => NOW + 900000 }), /expired/);
  assert.throws(() => s.apply(plan, { observeRemote: () => `${'a'.repeat(40)}\trefs/heads/main` }), /remote-main-drift/);
  writeFileSync(join(s.target, 'runtime/state.txt'), 'changed owner work\n');
  assert.throws(() => s.apply(plan), /inventory|observation/); assert.ok(existsSync(s.target));
});
test('canonical, aliased, dirty, hidden and foreign worktree targets are not eligible', t => {
  const s = fixture(t);
  assert.throws(() => planUserCleanup({ ...s.input, target: s.root }, s.options), /target-path/);
  const alias = join(s.parent, 'alias'); symlinkSync(s.target, alias);
  assert.throws(() => planUserCleanup({ ...s.input, target: alias }, s.options), /target-path/);
  writeFileSync(join(s.target, 'file.txt'), 'unfinished\n'); assert.throws(s.plan, /target-not-clean/);
  g(s.target, 'update-index', '--assume-unchanged', 'file.txt'); assert.throws(s.plan, /hidden-or-untracked/);
  const other = fixture(t); assert.throws(() => planUserCleanup({ ...s.input, target: other.target }, s.options));
});
test('provider observation binds exact source, check provenance, workflow and complete bounded result sets', t => {
  const s = fixture(t), observe = () => observeMergedReview({ ...s.input, repository: 'example/private' }, s.options);
  const original = structuredClone(s.values);
  for (const mutate of [v => { v.pull.merged = false; }, v => { v.pull.head.repo.full_name = 'fork/private'; },
    v => { v.checks.total_count = 101; }, v => { v.checks.check_runs[0].conclusion = 'failure'; },
    v => { v.checks.check_runs[0].head_sha = 'a'.repeat(40); }, v => { v.checks.check_runs[0].app.slug = 'other'; },
    v => { v.run.path = '.github/workflows/other.yml'; }, v => { v.run.head_sha = 'a'.repeat(40); },
    v => { v.run.event = 'workflow_dispatch'; }, v => { v.run.head_repository.full_name = 'fork/private'; },
    v => { v.checks.check_runs.push(structuredClone(v.checks.check_runs[0])); v.checks.total_count = 2; }]) {
    Object.assign(s.values, structuredClone(original)); mutate(s.values); assert.throws(observe);
  }
  Object.assign(s.values, original); assert.equal(observe().head, s.head);
});
test('a held clone lock or partial journal is not bypassed or automatically repaired', t => {
  const s = fixture(t), plan = s.plan(), lock = acquireOperationLock('agentic-os-worktree-cleanup', s.root);
  try { assert.throws(s.plan, /busy/); assert.throws(() => s.apply(plan), /busy/); }
  finally { finishOperationLock(lock, { label: 'fixture', result: null }); }
  const partial = join(s.root, '.git/agentic-os-cleanup-quarantine', plan.planDigest);
  mkdirSync(partial, { recursive: true, mode: 0o700 }); writeFileSync(join(partial, 'operation.json'), '{}');
  assert.throws(() => s.apply(plan), /metadata|quarantine|private directory/); assert.ok(existsSync(s.target));
});
test('plan bytes and CLI arguments are closed; neither missing profile nor unknown options widen authority', t => {
  const s = fixture(t), plan = s.plan();
  assert.throws(() => s.apply({ ...plan, targetPath: s.root }), /plan-binding/);
  assert.throws(() => s.apply({ ...plan, extra: true }), /shape/);
  assert.throws(() => reviewOptions({ repository: 'x/y', pr: 1, workflow: '../x', requiredChecks: [] }));
  assert.equal(validateCommandArguments('cleanup-user', ['plan', '--target=/tmp/one', '--pr=1', '--checks=planning',
    '--workflow=.github/workflows/planning.yml']), null);
  for (const args of [['apply', '--plan=x', '--authorize=y'], ['apply', '--plan=x', '--authorize=y', '--stopped', '--force'],
    ['plan', '--target=x', '--pr=1', '--checks=planning'], ['remove', '--plan=x']])
    assert.ok(validateCommandArguments('cleanup-user', args));
  const entry = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [entry, 'cleanup-user', 'apply', '--plan=x', '--authorize=y'],
    { cwd: s.root, stdio: ['ignore', 'pipe', 'pipe'] }), e => /missing --stopped/.test(e.stderr.toString()));
});
