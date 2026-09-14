import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planUserCleanup, applyUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { parseNoCiArguments } from '../bin/agentic-os-cleanup-no-ci.mjs';

const NOW = Date.parse('2026-09-14T02:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args,
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-no-ci-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), target = join(parent, 'lane'); mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'file.txt'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'base');
  const branch = 'agent/device/task'; git(root, 'worktree', 'add', '--quiet', '-b', branch, target);
  writeFileSync(join(target, 'file.txt'), 'done\n'); git(target, 'add', '.'); git(target, 'commit', '--quiet', '-m', 'candidate');
  const head = git(target, 'rev-parse', 'HEAD');
  git(root, 'merge', '--squash', '--quiet', branch); git(root, 'commit', '--quiet', '-m', 'merge');
  const merge = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', 'refs/remotes/origin/main', merge);
  git(root, 'remote', 'add', 'origin', 'https://github.com/example/private.git');
  git(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-no-ci');
  const repository = 'example/private', pr = 7;
  const values = {
    pull: { number: pr, merged: true, state: 'closed', html_url: `https://github.com/${repository}/pull/${pr}`,
      merged_at: '2026-09-13T00:00:00Z', merge_commit_sha: merge,
      base: { ref: 'main', repo: { full_name: repository } },
      head: { sha: head, ref: branch, repo: { full_name: repository } } },
    checks: { total_count: 0, check_runs: [] },
    status: { sha: head, state: 'pending', statuses: [] },
  };
  const api = path => {
    const response = path === `repos/${repository}/pulls/${pr}` ? values.pull
      : path === `repos/${repository}/commits/${head}/check-runs?filter=latest&per_page=100` ? values.checks
        : path === `repos/${repository}/commits/${head}/status` ? values.status : null;
    assert.ok(response, `unexpected provider read: ${path}`); return structuredClone(response);
  };
  const options = { api, observeRemote: () => `${merge}\trefs/heads/main`, now: () => NOW };
  const input = { cwd: root, target, pr, requiredChecks: [], workflow: null, noCI: true };
  return { root, target, values, input, options, plan: () => planUserCleanup(input, options),
    apply: (plan, overrides = {}) => applyUserCleanup(plan, { cwd: root, ...options,
      authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true, ...overrides }) };
}

test('separate no-CI consent quarantines only the exact merged, zero-check lane', t => {
  const s = fixture(t), before = git(s.root, 'show-ref'), plan = s.plan();
  assert.equal(plan.mode, 'explicit-local-user-consent-no-ci');
  assert.deepEqual(plan.review.checks, []); assert.equal(plan.review.noCI, true);
  const receipt = s.apply(plan);
  assert.equal(receipt.result, 'quarantined'); assert.equal(receipt.noCI, true);
  assert.equal(receipt.selectedChecksVerified, false); assert.equal(receipt.providerAuthority, false);
  assert.equal(receipt.protectionProven, false); assert.equal(receipt.claimRetired, false);
  assert.equal(existsSync(s.target), false); assert.equal(git(s.root, 'show-ref'), before);
  assert.equal(s.apply(plan, { now: () => NOW + 900001 }).replayed, true);
});

test('no-CI refuses present checks, legacy statuses, and provider drift', t => {
  const s = fixture(t);
  s.values.checks = { total_count: 1, check_runs: [{}] };
  assert.throws(s.plan, /no-ci-evidence-drift/u);
  s.values.checks = { total_count: 0, check_runs: [] };
  s.values.status.statuses = [{ context: 'legacy', state: 'failure' }];
  assert.throws(s.plan, /no-ci-evidence-drift/u);
  s.values.status.statuses = [];
  const plan = s.plan(); s.values.status.sha = 'a'.repeat(40);
  assert.throws(() => s.apply(plan), /no-ci-evidence-drift/u);
  assert.equal(existsSync(s.target), true);
});

test('no-CI requires distinct local opt-in, exact consent, and profileless repository', t => {
  const s = fixture(t), plan = s.plan();
  assert.throws(() => s.apply(plan, { authorization: null }), /explicit-authorization/u);
  assert.throws(() => s.apply(plan, { stopped: false }), /explicit-authorization/u);
  git(s.root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine');
  assert.throws(s.plan, /local-enrollment/u);
  git(s.root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-no-ci');
  writeFileSync(join(s.root, '.agentic-os.json'), '{}\n');
  assert.throws(() => s.apply(plan), /profile-governed/u);
  assert.equal(existsSync(s.target), true);
});

test('standalone no-CI grammar rejects implicit mode and extra options', () => {
  assert.deepEqual(parseNoCiArguments(['plan', '--target=/tmp/lane', '--pr=7']).operation, 'plan');
  assert.throws(() => parseNoCiArguments(['plan', '--target=/tmp/lane']), /usage/u);
  assert.throws(() => parseNoCiArguments(['apply', '--plan=x', '--authorize=y']), /usage/u);
  assert.throws(() => parseNoCiArguments(['apply', '--plan=x', '--authorize=y', '--stopped', '--force']), /usage/u);
});
