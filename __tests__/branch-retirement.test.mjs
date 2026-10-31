import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyBranchRetirement, planBranchRetirement } from '../src/branch-retirement.mjs';
import { createRepositoryProfile, RETAIN_ALL_CLEANUP } from '../src/governance.mjs';
import { commonDir, headSha, remoteRefSha } from '../src/git.mjs';

const NOW = 1_798_000_000_000;
const REPOSITORY = 'github.com/owner/project';
const MERGED_AT = '2026-10-30T12:00:00.000Z';
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(cwd, path, value) {
  writeFileSync(join(cwd, path), value);
  git(cwd, 'add', path); git(cwd, '-c', 'user.name=Fixture', '-c',
    'user.email=fixture@example.invalid', 'commit', '-m', value);
  return git(cwd, 'rev-parse', 'HEAD');
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-branch-retirement-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git'), repo = join(root, 'repo');
  mkdirSync(repo); git(repo, 'init', '-b', 'main');
  const mainOid = commit(repo, 'main.txt', 'main');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  git(repo, 'fetch', 'origin'); mkdirSync(join(commonDir(repo), 'agentic-os'), { mode: 0o700 });
  const profile = createRepositoryProfile({ repository: REPOSITORY,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    capabilities: ['governed-branch-retirement'],
    branchRetirement: { localBranch: 'retire-merged', remoteBranch: 'retire-merged',
      remoteTrackingRef: 'prune-absent' } });
  const pullRequests = new Map();
  const provider = { id: 'github', observePullRequests: ({ branch }) => ({ complete: true,
    observedAt: NOW, pullRequests: pullRequests.get(branch) ?? [] }), observeBranchProtection: () => false };
  return { root, repo, remote, mainOid, profile, provider, pullRequests };
}
function merged(profile, branch, oid, overrides = {}) {
  return { number: 41, state: 'MERGED', headSha: oid, headBranch: branch,
    baseBranch: 'main', headRepository: profile.repository, baseRepository: profile.repository,
    mergedAt: MERGED_AT, ...overrides };
}
function publishBranch(state, branch = 'feature/one') {
  git(state.repo, 'switch', '-c', branch);
  const oid = commit(state.repo, `${branch.replaceAll('/', '-')}.txt`, branch);
  git(state.repo, 'push', 'origin', branch); git(state.repo, 'switch', 'main');
  git(state.repo, 'fetch', 'origin');
  state.pullRequests.set(branch, [merged(state.profile, branch, oid)]);
  return oid;
}
function options(state, clock = () => NOW) {
  return { cwd: state.repo, profile: state.profile, provider: state.provider, now: clock };
}

test('branch retirement is retain-by-default and non-retain profiles require capability', () => {
  const retained = createRepositoryProfile({ repository: REPOSITORY,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } } });
  assert.deepEqual(retained.cleanup, RETAIN_ALL_CLEANUP);
  assert.equal(Object.hasOwn(retained, 'branchRetirement'), false);
  assert.throws(() => createRepositoryProfile({ repository: REPOSITORY,
    canonical: retained.canonical, adapters: retained.adapters,
    branchRetirement: { localBranch: 'retire-merged', remoteBranch: 'retain',
      remoteTrackingRef: 'retain' } }), /require governed-branch-retirement/u);
  assert.throws(() => createRepositoryProfile({ repository: REPOSITORY,
    canonical: retained.canonical, adapters: retained.adapters,
    capabilities: ['governed-branch-retirement'],
    branchRetirement: { localBranch: 'delete', remoteBranch: 'retain',
      remoteTrackingRef: 'retain' } }), /unsupported effect/u);
});

test('remote retirement requires authorization, uses an exact lease, and retains objects', t => {
  const state = fixture(t), expectedOid = publishBranch(state), beforeMain = remoteRefSha('origin', 'main', state.repo);
  const plan = planBranchRetirement({ effect: 'remote-branch', branch: 'feature/one' }, options(state));
  assert.equal(plan.expectedOid, expectedOid); assert.equal(plan.pullRequest.number, 41);
  assert.deepEqual(plan.providerAdapter, { id: 'github', version: '1' }); assert.equal(plan.providerObservedAt, NOW);
  assert.throws(() => applyBranchRetirement({ planDigest: plan.planDigest, authorization: 'wrong' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-authorization');
  const receipt = applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state));
  assert.equal(receipt.schema, 'agentic-os/branch-retirement-receipt/v1');
  assert.deepEqual(receipt.providerAdapter, plan.providerAdapter); assert.equal(receipt.providerObservedAt, NOW);
  assert.equal(receipt.applyObservedAt, NOW);
  assert.equal(receipt.targetRefAbsentAfter, true); assert.equal(receipt.objectsPruned, false);
  assert.equal(receipt.reflogsPruned, false); assert.equal(remoteRefSha('origin', 'main', state.repo), beforeMain);
  assert.equal(remoteRefSha('origin', 'feature/one', state.repo), null);
  assert.deepEqual(applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state)), receipt);
});

test('GitHub merged timestamps without fractional seconds remain valid provider evidence', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/timestamp');
  state.pullRequests.set('feature/timestamp', [merged(state.profile, 'feature/timestamp', oid,
    { mergedAt: '2026-10-30T12:00:00Z' })]);
  const plan = planBranchRetirement({ effect: 'remote-branch', branch: 'feature/timestamp' }, options(state));
  assert.equal(plan.pullRequest.mergedAt, '2026-10-30T12:00:00Z'); assert.equal(plan.issuedAt, NOW);
});

test('closed or missing pull requests do not qualify for retirement', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/closed');
  state.pullRequests.set('feature/closed', [merged(state.profile, 'feature/closed', oid,
    { state: 'CLOSED', mergedAt: null })]);
  assert.throws(() => planBranchRetirement({ effect: 'remote-branch', branch: 'feature/closed' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-merged-pr');
  state.pullRequests.set('feature/closed', []);
  assert.throws(() => planBranchRetirement({ effect: 'remote-branch', branch: 'feature/closed' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-merged-pr');
});

test('remote deletion lease preserves a branch that changes immediately before push', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/lease');
  git(state.repo, 'switch', '-c', 'advance', 'feature/lease');
  const replacement = commit(state.repo, 'advance.txt', 'replacement');
  git(state.repo, 'push', 'origin', 'advance');
  git(state.repo, 'switch', 'main');
  const hook = join(state.repo, '.git', 'hooks', 'pre-push');
  writeFileSync(hook, `#!/bin/sh\ngit --git-dir=${JSON.stringify(state.remote)} update-ref refs/heads/feature/lease ${replacement} ${oid}\n`);
  chmodSync(hook, 0o700);
  const plan = planBranchRetirement({ effect: 'remote-branch', branch: 'feature/lease' }, options(state));
  const receipt = applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state));
  assert.equal(receipt.writeCompleted, false); assert.equal(receipt.writeResultUnknown, false);
  assert.equal(receipt.targetRefAbsentAfter, false); assert.equal(receipt.targetRefAfterOid, replacement);
  assert.equal(remoteRefSha('origin', 'feature/lease', state.repo), replacement);
});

test('remote retirement refuses open competitors, unmatched heads, and protected refs', t => {
  const state = fixture(t), oid = publishBranch(state);
  state.pullRequests.set('feature/one', [merged(state.profile, 'feature/one', oid),
    merged(state.profile, 'feature/one', oid, { number: 42, state: 'OPEN', mergedAt: null })]);
  assert.throws(() => planBranchRetirement({ effect: 'remote-branch', branch: 'feature/one' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-open-pr');
  state.pullRequests.set('feature/one', [merged(state.profile, 'feature/one', 'f'.repeat(40))]);
  assert.throws(() => planBranchRetirement({ effect: 'remote-branch', branch: 'feature/one' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-merged-pr');
  state.pullRequests.set('feature/one', [merged(state.profile, 'feature/one', oid)]);
  state.provider.observeBranchProtection = () => true;
  assert.throws(() => planBranchRetirement({ effect: 'remote-branch', branch: 'feature/one' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-protected');
  assert.equal(remoteRefSha('origin', 'feature/one', state.repo), oid);
});

test('remote retirement apply refuses a branch head that moved after planning', t => {
  const state = fixture(t), oldOid = publishBranch(state);
  const plan = planBranchRetirement({ effect: 'remote-branch', branch: 'feature/one' }, options(state));
  git(state.repo, 'switch', '-c', 'advance', 'feature/one');
  const newOid = commit(state.repo, 'advance.txt', 'advance');
  git(state.repo, 'push', 'origin', 'advance:feature/one'); git(state.repo, 'switch', 'main');
  state.pullRequests.set('feature/one', [merged(state.profile, 'feature/one', oldOid)]);
  assert.notEqual(newOid, oldOid);
  assert.throws(() => applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state)),
  error => error.reason === 'blocked-branch-retirement-merged-pr');
  assert.equal(remoteRefSha('origin', 'feature/one', state.repo), newOid);
});

test('local branch retirement uses its own plan and receipt and refuses an active worktree', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/local');
  const active = join(state.root, 'active'); git(state.repo, 'worktree', 'add', active, 'feature/local');
  assert.throws(() => planBranchRetirement({ effect: 'local-branch', branch: 'feature/local' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-active-worktree');
  git(state.repo, 'worktree', 'remove', active);
  const plan = planBranchRetirement({ effect: 'local-branch', branch: 'feature/local' }, options(state));
  const receipt = applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state));
  assert.equal(receipt.effect, 'local-branch'); assert.equal(receipt.originalOid, oid);
  assert.equal(receipt.targetRefAbsentAfter, true);
  assert.equal(headSha('refs/remotes/origin/feature/local', state.repo), oid);
  assert.equal(remoteRefSha('origin', 'feature/local', state.repo), oid);
});

test('tracking-ref prune requires live remote absence and preserves the local branch', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/stale');
  git(state.repo, 'fetch', 'origin', 'refs/heads/feature/stale:refs/remotes/origin/feature/stale');
  git(state.repo, 'push', 'origin', '--delete', 'feature/stale');
  git(state.repo, 'update-ref', 'refs/remotes/origin/feature/stale', oid);
  assert.equal(remoteRefSha('origin', 'feature/stale', state.repo), null);
  const plan = planBranchRetirement({ effect: 'remote-tracking-ref', branch: 'feature/stale' }, options(state));
  const receipt = applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state));
  assert.equal(receipt.effect, 'remote-tracking-ref'); assert.equal(receipt.targetRefAbsentAfter, true);
  assert.equal(headSha('refs/heads/feature/stale', state.repo), oid);
  assert.equal(headSha('refs/remotes/origin/feature/stale', state.repo), null);
});

test('tracking-ref prune refuses while its exact remote branch exists', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/present');
  git(state.repo, 'fetch', 'origin', 'refs/heads/feature/present:refs/remotes/origin/feature/present');
  assert.equal(headSha('refs/remotes/origin/feature/present', state.repo), oid);
  assert.throws(() => planBranchRetirement({ effect: 'remote-tracking-ref', branch: 'feature/present' }, options(state)),
    error => error.reason === 'blocked-branch-retirement-remote-present');
});

test('plan expiration and apply-time provider drift fail closed', t => {
  const state = fixture(t), oid = publishBranch(state, 'feature/expired');
  const plan = planBranchRetirement({ effect: 'local-branch', branch: 'feature/expired' }, options(state));
  state.pullRequests.set('feature/expired', [merged(state.profile, 'feature/expired', oid,
    { state: 'OPEN', mergedAt: null })]);
  assert.throws(() => applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state)),
  error => error.reason === 'blocked-branch-retirement-open-pr');
  state.pullRequests.set('feature/expired', [merged(state.profile, 'feature/expired', oid)]);
  assert.throws(() => applyBranchRetirement({ planDigest: plan.planDigest,
    authorization: `agentic-os:branch-retirement:${plan.planDigest}` }, options(state, () => NOW + 900_000)),
  error => error.reason === 'blocked-branch-retirement-expired');
});
