import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, symlinkSync, linkSync, statSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile, governanceDigest } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { planUserCleanup, applyUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { RECOVERY_MODE, RECOVERY_LIMITS } from '../bin/agentic-os-cleanup-recovery.mjs';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { inferMergedReviewWorkflow } from '../bin/agentic-os-cleanup-review.mjs';
const NOW = Date.parse('2026-09-14T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, concurrentBase = false, detached = false) {
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
  const originalHead = git(target, 'rev-parse', 'HEAD');
  if (detached) {
    writeFileSync(join(target, 'successor.txt'), 'reviewed successor\n');
    git(target, 'add', '.'); git(target, 'commit', '--quiet', '-m', 'successor');
  }
  const head = git(target, 'rev-parse', 'HEAD');
  if (concurrentBase) {
    writeFileSync(join(root, 'peer.txt'), 'peer work\n'); git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'peer');
  }
  git(root, 'merge', '--squash', '--quiet', branch); git(root, 'commit', '--quiet', '-m', 'merged review');
  const merge = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', 'refs/remotes/origin/main', merge);
  git(root, 'remote', 'add', 'origin', `https://github.com/${repository}.git`);
  git(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-recovery');
  if (detached) git(target, 'switch', '--detach', originalHead);
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
  const input = { cwd: root, target, pr, requiredChecks: ['test'], workflow, recovery: true, detached };
  const options = { api, now: () => NOW, observeRemote: () => `${merge}\trefs/heads/main` };
  const plan = () => planUserCleanup(input, options);
  const apply = (p, overrides = {}) => applyUserCleanup(p, { cwd: root, ...options,
    authorization: `agentic-os:user-cleanup:${p.planDigest}`, stopped: true, ...overrides });
  return { root, target, profile, head, originalHead, merge, branch, input, options, plan, apply, pull, check, checks, run, calls };
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
test('workflow inference shares the pre-merge recovery boundary and ignores post-merge runs', t => {
  const s = fixture(t), infer = () => inferMergedReviewWorkflow({ repository: 'example/GameXR',
    pr: 7, requiredChecks: ['test'] }, s.options);
  s.checks.check_runs.push({ ...s.check, id: 999, conclusion: 'failure',
    completed_at: '2026-09-13T00:00:01Z', details_url: s.check.details_url.replace('/456/job/123', '/999/job/999') });
  s.checks.total_count = 2;
  assert.equal(infer(), s.input.workflow);
  assert.equal(s.plan().review.checks[0].checkId, 123);
  assert.ok(!s.calls.some(path => path.endsWith('/runs/999')), 'post-merge runs cannot alter the historical proof');
  s.checks.check_runs[1] = { ...s.check, id: 124, conclusion: 'failure',
    completed_at: '2026-09-12T23:59:30Z', details_url: s.check.details_url.replace('/123', '/124') };
  assert.throws(infer, /check-not-successful/, 'a later pre-merge failure must still block');
  s.checks.check_runs = [s.check]; s.checks.total_count = 1;
  s.pull.merged_at = 'invalid'; assert.throws(infer, /merged-review/);
  s.pull.merged_at = '2026-09-13T00:00:00Z'; s.check.app.id = 999;
  assert.throws(infer, /check-ambiguous-or-missing/);
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

test('explicit detached ancestor recovery keeps the checked PR head distinct and preserves history and replay', t => {
  const s = fixture(t, true, true), p = s.plan(), refs = git(s.root, 'show-ref');
  assert.notEqual(p.detachedHead, p.head); assert.equal(p.detachedHead, s.originalHead);
  assert.equal(p.review.head, s.head); assert.equal(p.integration.detached.reviewedHead, s.head);
  assert.equal(p.integration.detached.inclusion.kind, 'exact-tree-projection');
  const receipt = s.apply(p);
  assert.equal(receipt.detachedHead, s.originalHead); assert.equal(existsSync(s.target), false);
  assert.equal(git(s.root, 'show-ref'), refs);
  assert.equal(readFileSync(join(receipt.registrationQuarantinePath, 'HEAD'), 'utf8').trim(), s.originalHead);
  assert.equal(readFileSync(join(receipt.projectionQuarantinePath, 'runtime/evidence.txt'), 'utf8'), 'retained local evidence');
  assert.equal(receipt.providerAuthority, false); assert.equal(receipt.claimRetired, false);
  assert.equal(s.apply(p, { now: () => NOW + 900001 }).replayed, true);
});
test('detached cleanup requires explicit recovery and a truly detached target', t => {
  const s = fixture(t);
  assert.throws(() => planUserCleanup({ ...s.input, detached: true }, s.options), /target-not-detached/);
  assert.throws(() => planUserCleanup({ ...s.input, detached: true, recovery: false }, s.options), /detached-recovery-required/);
  git(s.target, 'switch', '--detach', s.head);
  assert.throws(s.plan);
  const p = planUserCleanup({ ...s.input, detached: true }, s.options);
  git(s.target, 'switch', s.branch);
  assert.throws(() => s.apply(p), { reason: 'blocked-target-identity' });
  assert.ok(existsSync(s.target));
});
test('matching detached content without reviewed ancestry is insufficient', t => {
  const s = fixture(t, false, true);
  const sibling = git(s.root, 'commit-tree', `${s.originalHead}^{tree}`, '-p', `${s.originalHead}^`, '-m', 'unreviewed sibling');
  git(s.target, 'switch', '--detach', sibling);
  assert.throws(s.plan, /detached-not-reviewed-ancestor/);
  assert.ok(existsSync(s.target));
});
test('explicit reviewed-equivalent transition quarantines a superseded sibling without claiming integration', t => {
  const s = fixture(t, false, true);
  const sibling = git(s.root, 'commit-tree', `${s.originalHead}^{tree}`, '-p', `${s.originalHead}^`, '-m', 'historical sibling');
  git(s.target, 'switch', '--detach', sibling);
  assert.throws(s.plan, /detached-not-reviewed-ancestor/);
  const p = planUserCleanup({ ...s.input, reviewedEquivalentCommit: s.originalHead }, s.options);
  assert.equal(p.integration.kind, 'reviewed-equivalent-superseded-transition');
  assert.equal(p.integration.pathCount, 1);
  const receipt = s.apply(p);
  assert.equal(receipt.historicalDraft, 'superseded');
  assert.equal(receipt.sourceIntegrated, false);
  assert.equal(receipt.providerAuthority, false);
  assert.equal(receipt.claimRetired, false);
  assert.equal(existsSync(s.target), false);
  assert.equal(s.apply(p, { now: () => NOW + 900001 }).replayed, true);
});
test('reviewed-equivalent mode refuses mismatched transitions and unreviewed commits', t => {
  const s = fixture(t, false, true);
  const unrelated = git(s.root, 'commit-tree', `${s.originalHead}^{tree}`, '-p', `${s.originalHead}^`, '-m', 'unreviewed');
  git(s.target, 'switch', '--detach', unrelated);
  assert.throws(() => planUserCleanup({ ...s.input, reviewedEquivalentCommit: unrelated }, s.options),
    /equivalent-transition/);
  const changed = git(s.root, 'commit-tree', `${s.head}^{tree}`, '-p', `${s.originalHead}^`, '-m', 'other transition');
  git(s.target, 'switch', '--detach', changed);
  assert.throws(() => planUserCleanup({ ...s.input, reviewedEquivalentCommit: s.originalHead }, s.options),
    /equivalent-transition/);
  assert.ok(existsSync(s.target));
  assert.throws(() => planUserCleanup({ ...s.input, recovery: false,
    reviewedEquivalentCommit: s.originalHead }, s.options), /detached-recovery-required/);
});
test('reviewed ancestry cannot hide source content overwritten before merge', t => {
  const s = fixture(t, false, true);
  git(s.target, 'switch', s.branch);
  writeFileSync(join(s.target, 'source.txt'), 'superseded\n'); git(s.target, 'add', '.');
  git(s.target, 'commit', '--quiet', '-m', 'overwrite ancestor');
  s.pull.head.sha = git(s.target, 'rev-parse', 'HEAD'); s.check.head_sha = s.pull.head.sha; s.run.head_sha = s.pull.head.sha;
  writeFileSync(join(s.root, 'source.txt'), 'superseded\n'); git(s.root, 'add', '.');
  git(s.root, 'commit', '--quiet', '-m', 'merge overwrite');
  s.pull.merge_commit_sha = git(s.root, 'rev-parse', 'HEAD');
  git(s.root, 'update-ref', 'refs/remotes/origin/main', s.pull.merge_commit_sha);
  git(s.target, 'switch', '--detach', s.originalHead);
  assert.throws(s.plan, /source-not-integrated/);
});
test('detached target drift and malformed bindings preserve the worktree', t => {
  const s = fixture(t, false, true), p = s.plan();
  const altered = { ...p, detachedHead: null }; const { planDigest, ...body } = altered;
  altered.planDigest = governanceDigest(body);
  assert.throws(() => s.apply(altered), /plan-binding/);
  git(s.target, 'switch', '--detach', s.head);
  assert.throws(() => s.apply(p), { reason: 'blocked-target-identity' });
  assert.ok(existsSync(s.target));
  assert.equal(validateCommandArguments('cleanup-user', ['plan', '--target=/tmp/a', '--pr=1', '--checks=test',
    '--workflow=.github/workflows/ci.yml', '--recovery', '--detached']), null);
});

test('recovery preserves dependency hardlinks and detects writes through retained aliases', t => {
  const s = fixture(t), original = join(s.target, 'runtime/evidence.txt');
  const alias = join(s.target, 'runtime/dependency-binary'); linkSync(original, alias);
  const p = s.plan(), receipt = s.apply(p);
  const preserved = join(receipt.projectionQuarantinePath, 'runtime');
  assert.equal(statSync(join(preserved, 'evidence.txt')).ino, statSync(join(preserved, 'dependency-binary')).ino);
  assert.equal(statSync(join(preserved, 'evidence.txt')).nlink, 2);
  const other = fixture(t), outside = join(other.root, 'runtime'); mkdirSync(outside);
  linkSync(join(other.target, 'runtime/evidence.txt'), join(outside, 'alias'));
  const before = other.plan(); writeFileSync(join(outside, 'alias'), 'changed through alias');
  assert.throws(() => other.apply(before), /inventory|observation/);
  assert.ok(existsSync(other.target));
});


test('completion verifies recovery after canonical and policy changes without granting authority', t => {
  const s = fixture(t), receipt = s.apply(s.plan());
  const status = () => inspectCompletionStatus(s.root, s.branch, { protectedBranch: 'main' }, s.profile);
  assert.equal(status().cleanupVerified, true);
  assert.equal(status().closeout.missionState, 'source_complete');
  assert.equal(status().providerVerified, false);
  writeFileSync(join(s.root, 'later.txt'), 'later independent work\n');
  git(s.root, 'add', '.'); git(s.root, 'commit', '--quiet', '-m', 'advance canonical');
  git(s.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(status().closeout.missionState, 'source_complete');
  // Current policy is retain-all; verified historical recovery remains a completed effect.
  assert.equal(s.profile.cleanup.worktreeProjection, 'retain');
  writeFileSync(join(receipt.projectionPath, 'runtime/evidence.txt'), 'changed after quarantine');
  assert.equal(status().cleanupVerified, false);
  assert.equal(status().closeout.cleanupSatisfied, false);
});

test('retained cleanup does not certify an advanced branch or changed operation metadata', t => {
  const s = fixture(t), receipt = s.apply(s.plan());
  const status = () => inspectCompletionStatus(s.root, s.branch, { protectedBranch: 'main' }, s.profile);
  git(s.root, 'update-ref', `refs/heads/${s.branch}`, s.merge);
  assert.equal(status().cleanupVerified, false);
  git(s.root, 'update-ref', `refs/heads/${s.branch}`, s.head);
  const path = join(receipt.operationPath, 'operation.json'), value = JSON.parse(readFileSync(path));
  value.eligibility.planDigest = '0'.repeat(64);
  writeFileSync(path, JSON.stringify(value));
  assert.equal(status().cleanupVerified, false);
});

test('completion binds a trailing zero-object verification entry to its exact prior head', t => {
  for (const exact of [true, false]) {
    const s = fixture(t), log = git(s.target, 'rev-parse', '--git-path', 'logs/HEAD');
    const prior = exact ? s.head : s.merge;
    writeFileSync(log, readFileSync(log, 'utf8')
      + `${prior} ${'0'.repeat(40)} Fixture <fixture@example.invalid> 1789344000 +0000\n`);
    s.apply(s.plan());
    const status = inspectCompletionStatus(s.root, s.branch, { protectedBranch: 'main' }, s.profile);
    assert.equal(status.cleanupVerified, exact);
    assert.equal(status.closeout.missionState === 'source_complete', exact);
    assert.equal(status.providerVerified, false);
  }
});
