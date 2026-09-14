import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile, governanceDigest } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { planUserCleanup, applyUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { RECOVERY_MODE, RECOVERY_LIMITS } from '../bin/agentic-os-cleanup-recovery.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
const NOW = Date.parse('2026-09-14T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, concurrentBase = false) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-consent-recovery-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root'), target = join(parent, 'lane'); mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  const repository = 'example/GameXR', branch = 'agent/device/recovery', pr = 7;
  const profile = createRepositoryProfile({ repository: `github.com/${repository}`,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: ['test'], capabilities: ['integration-method:squash'] });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, '.gitignore'), 'runtime/\n'); writeFileSync(join(root, 'source.txt'), 'base\n');
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); ensureRepositoryTrust(root, profile, { allowCreate: true });
  git(root, 'worktree', 'add', '--quiet', '-b', branch, target);
  writeFileSync(join(target, 'source.txt'), 'delivered\n'); git(target, 'add', '.'); git(target, 'commit', '--quiet', '-m', 'source');
  const head = git(target, 'rev-parse', 'HEAD');
  if (concurrentBase) {
    writeFileSync(join(root, 'peer.txt'), 'peer work\n'); git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'peer');
  }
  git(root, 'merge', '--squash', '--quiet', branch); git(root, 'commit', '--quiet', '-m', 'merged review');
  const merge = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', 'refs/remotes/origin/main', merge);
  git(root, 'remote', 'add', 'origin', `https://github.com/${repository}.git`);
  git(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-recovery');
  mkdirSync(join(target, 'runtime')); writeFileSync(join(target, 'runtime/evidence.txt'), 'retained local evidence');
  symlinkSync('/unavailable/device/runtime', join(target, 'runtime/link'));
  const workflow = '.github/workflows/ci.yml';
  const pull = { number: pr, merged: true, state: 'closed', merged_at: '2026-09-13T00:00:00Z',
    merge_commit_sha: merge, html_url: `https://github.com/${repository}/pull/${pr}`,
    base: { ref: 'main', repo: { full_name: repository } }, head: { sha: head, ref: branch, repo: { full_name: repository } } };
  const check = { name: 'test', id: 123, head_sha: head, app: { id: 15368, slug: 'github-actions' },
    status: 'completed', conclusion: 'success', completed_at: '2026-09-12T23:59:00Z',
    details_url: `https://github.com/${repository}/actions/runs/456/job/123` };
  const run = { id: 456, head_sha: head, head_branch: branch, repository: { full_name: repository },
    head_repository: { full_name: repository }, event: 'pull_request', path: workflow,
    run_attempt: 1, status: 'completed', conclusion: 'success' };
  const checks = { total_count: 1, check_runs: [check] }, calls = [];
  const api = path => {
    calls.push(path);
    if (path.endsWith(`/pulls/${pr}`)) return structuredClone(pull);
    if (path.includes('/check-runs?')) return structuredClone(checks);
    if (path.endsWith('/actions/runs/456')) return structuredClone(run);
    assert.fail(`unexpected provider effect or read: ${path}`);
  };
  const input = { cwd: root, target, pr, requiredChecks: ['test'], workflow, recovery: true };
  const options = { api, now: () => NOW, observeRemote: () => `${merge}\trefs/heads/main` };
  const plan = () => planUserCleanup(input, options);
  const apply = (p, overrides = {}) => applyUserCleanup(p, { cwd: root, ...options,
    authorization: `agentic-os:user-cleanup:${p.planDigest}`, stopped: true, ...overrides });
  return { root, target, profile, head, merge, branch, input, options, plan, apply, pull, check, checks, run, calls };
}
test('explicit governed recovery preserves retain policy, exact branches, ignored bytes and replay', t => {
  const s = fixture(t), p = s.plan(), refs = git(s.root, 'show-ref');
  assert.equal(p.mode, RECOVERY_MODE); assert.equal(p.integration.kind, 'equal-tree');
  assert.deepEqual(p.recoveryPolicy.limits, RECOVERY_LIMITS);
  const receipt = s.apply(p);
  assert.equal(existsSync(s.target), false); assert.equal(git(s.root, 'show-ref'), refs);
  assert.equal(readlinkSync(join(receipt.projectionQuarantinePath, 'runtime/link')), '/unavailable/device/runtime');
  assert.equal(readFileSync(join(receipt.projectionQuarantinePath, 'runtime/evidence.txt'), 'utf8'), 'retained local evidence');
  assert.equal(JSON.parse(readFileSync(join(s.root, '.agentic-os.json'))).cleanup.worktreeProjection, 'retain');
  assert.equal(receipt.selectedChecksVerified, true);
  for (const name of ['providerAuthority', 'protectionProven', 'claimRetired', 'historicalIntegrationMethodProven',
    'bytesDeleted', 'branchesMutated', 'objectsMutated']) assert.equal(receipt[name], false, name);
  assert.equal(s.apply(p, { now: () => NOW + 900001 }).replayed, true);
  assert.ok(s.calls.every(path => !/rulesets|protection|dispatch/.test(path)));
});
test('concurrent base changes use the existing exact mode/type/blob projection at the actual merge', t => {
  const s = fixture(t, true), p = s.plan();
  assert.notEqual(p.integration.headTree, p.integration.mergeTree);
  assert.equal(p.integration.kind, 'exact-tree-projection'); assert.equal(p.integration.pathCount, 1);
  assert.equal(s.apply(p).result, 'quarantined');
  assert.equal(readFileSync(join(s.root, 'peer.txt'), 'utf8'), 'peer work\n');
});
test('recovery remains opt-in; normal consent, no-CI, wrong trust and missing profile checks fail', t => {
  const s = fixture(t);
  assert.throws(() => planUserCleanup({ ...s.input, recovery: false }, s.options), /local-enrollment/);
  assert.throws(() => planUserCleanup({ ...s.input, noCI: true }, s.options), /incompatible-modes/);
  assert.throws(() => planUserCleanup({ ...s.input, requiredChecks: ['other'] }, s.options), /profile-checks-missing/);
  git(s.root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine');
  assert.throws(s.plan, /local-enrollment/);
  assert.throws(() => planUserCleanup({ ...s.input, recovery: false }, s.options), /profile-governed/);
  git(s.root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-recovery');
  git(s.root, 'remote', 'set-url', 'origin', 'https://github.com/foreign/GameXR.git');
  assert.throws(s.plan, /profile-binding/);
});
test('a merged label cannot cover missing source content, altered checks or later failures', t => {
  const s = fixture(t, true);
  s.check.completed_at = '2026-09-13T00:00:01Z'; assert.throws(s.plan, /check-not-successful/);
  s.check.completed_at = '2026-09-12T23:59:00Z'; s.run.path = '.github/workflows/other.yml';
  assert.throws(s.plan, /check-not-successful/); s.run.path = s.input.workflow;
  s.checks.check_runs.push({ ...s.check, id: 124, conclusion: 'failure', completed_at: '2026-09-12T23:59:30Z',
    details_url: s.check.details_url.replace('/123', '/124') }); s.checks.total_count = 2;
  assert.throws(s.plan, /check-not-successful/);
  s.checks.check_runs = [s.check]; s.checks.total_count = 1;
  writeFileSync(join(s.target, 'source.txt'), 'not integrated\n'); git(s.target, 'add', '.'); git(s.target, 'commit', '--quiet', '-m', 'undelivered');
  s.pull.head.sha = git(s.target, 'rev-parse', 'HEAD'); s.check.head_sha = s.pull.head.sha; s.run.head_sha = s.pull.head.sha;
  assert.throws(s.plan, /source-not-integrated/); assert.ok(existsSync(s.target));
});
test('plan tampering, stale consent, changed ignored data and hidden edits never produce cleanup', t => {
  const s = fixture(t), p = s.plan();
  assert.throws(() => s.apply(p, { stopped: false }), /explicit-authorization/);
  assert.throws(() => s.apply(p, { now: () => NOW + 900000 }), /expired/);
  const forged = structuredClone(p); forged.recoveryPolicy.limits.projectionByteCeiling *= 2;
  const { planDigest, ...body } = forged; forged.planDigest = governanceDigest(body);
  assert.throws(() => s.apply(forged), /policy-drift/);
  writeFileSync(join(s.target, 'runtime/evidence.txt'), 'changed'); assert.throws(() => s.apply(p), /inventory|observation/);
  git(s.target, 'update-index', '--assume-unchanged', 'source.txt'); assert.throws(s.plan, /hidden-or-untracked/);
  assert.ok(existsSync(s.target));
});
test('CLI requires an explicit recovery selection while keeping apply exact and stopped', () => {
  assert.equal(validateCommandArguments('cleanup-user', ['plan', '--target=/tmp/a', '--pr=1', '--checks=test',
    '--workflow=.github/workflows/ci.yml', '--recovery']), null);
  assert.ok(validateCommandArguments('cleanup-user', ['apply', '--plan=x', '--authorize=y', '--recovery', '--stopped']));
});
