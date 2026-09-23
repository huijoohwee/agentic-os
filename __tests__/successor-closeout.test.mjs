import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile, RETAIN_ALL_CLEANUP } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { successorIntegrationProof } from '../src/patch-identity.mjs';
import { planUserCleanup, applyUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const NOW = Date.parse('2026-09-14T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args,
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-successor-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root'), target = join(parent, 'old'), next = join(parent, 'next');
  mkdirSync(root); git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  const repository = 'example/GameXR', oldRef = 'agent/device/old', nextRef = 'agent/device/next';
  const profile = createRepositoryProfile({ repository: `github.com/${repository}`,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: ['test'], capabilities: ['integration-method:squash'],
    cleanup: { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, '.gitignore'), 'runtime/\n');
  writeFileSync(join(root, 'starter.py'), 'speed = 1\n');
  writeFileSync(join(root, 'scene.py'), 'draw()\n');
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); ensureRepositoryTrust(root, profile, { allowCreate: true });
  git(root, 'worktree', 'add', '--quiet', '-b', oldRef, target);
  writeFileSync(join(target, 'starter.py'), 'speed = 2\n');
  writeFileSync(join(target, 'scene.py'), 'draw_rover()\n');
  git(target, 'add', '.'); git(target, 'commit', '--quiet', '-m', 'old implementation');
  const oldHead = git(target, 'rev-parse', 'HEAD');
  git(root, 'worktree', 'add', '--quiet', '-b', nextRef, next, oldHead);
  writeFileSync(join(next, 'starter.py'), 'speed = 3\n');
  git(next, 'add', '.'); git(next, 'commit', '--quiet', '-m', 'reviewed replacement');
  const reviewedHead = git(next, 'rev-parse', 'HEAD');
  git(root, 'merge', '--squash', '--quiet', nextRef); git(root, 'commit', '--quiet', '-m', 'accepted review');
  const merge = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', merge);
  git(root, 'remote', 'add', 'origin', `https://github.com/${repository}.git`);
  git(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-recovery');
  mkdirSync(join(target, 'runtime')); writeFileSync(join(target, 'runtime/notes.txt'), 'preserve me');
  const pr = 12, workflow = '.github/workflows/ci.yml';
  const pull = { number: pr, merged: true, state: 'closed', merged_at: '2026-09-13T00:00:00Z',
    merge_commit_sha: merge, html_url: `https://github.com/${repository}/pull/${pr}`,
    base: { ref: 'main', repo: { full_name: repository } },
    head: { sha: reviewedHead, ref: nextRef, repo: { full_name: repository } } };
  const check = { name: 'test', id: 123, head_sha: reviewedHead,
    app: { id: 15368, slug: 'github-actions' }, status: 'completed', conclusion: 'success',
    completed_at: '2026-09-12T23:59:00Z',
    details_url: `https://github.com/${repository}/actions/runs/456/job/123` };
  const run = { id: 456, head_sha: reviewedHead, head_branch: nextRef,
    repository: { full_name: repository }, head_repository: { full_name: repository },
    event: 'pull_request', path: workflow, run_attempt: 1, status: 'completed', conclusion: 'success' };
  const api = path => {
    if (path.endsWith(`/pulls/${pr}`)) return structuredClone(pull);
    if (path.includes('/check-runs?')) return { total_count: 1, check_runs: [structuredClone(check)] };
    if (path.endsWith('/actions/runs/456')) return structuredClone(run);
    assert.fail(`unexpected provider read: ${path}`);
  };
  const input = { cwd: root, target, pr, requiredChecks: ['test'], workflow, recovery: true,
    successor: { predecessorRef: oldRef, predecessorHead: oldHead, replacedPaths: ['starter.py'] } };
  const options = { api, now: () => NOW, observeRemote: () => `${merge}\trefs/heads/main` };
  return { root, target, profile, oldRef, oldHead, reviewedHead, merge, input, options, check };
}

test('reviewed successor closes a clean predecessor while preserving recovery bytes and branch', t => {
  const s = fixture(t);
  const proof = successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    ['starter.py'], { cwd: s.root });
  assert.equal(proof.kind, 'reviewed-successor');
  assert.equal(proof.pathCount, 2);
  const plan = planUserCleanup(s.input, s.options);
  assert.deepEqual(plan.integration, proof);
  const before = inspectCompletionStatus(s.root, s.oldRef, { protectedBranch: 'main' }, s.profile,
    { successor: { ...s.input.successor, reviewedHead: s.reviewedHead, merge: s.merge } });
  assert.equal(before.integration.kind, 'reviewed-successor');
  const receipt = applyUserCleanup(plan, { cwd: s.root, ...s.options,
    authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true });
  assert.equal(existsSync(s.target), false);
  assert.equal(git(s.root, 'rev-parse', s.oldRef), s.oldHead);
  assert.equal(readFileSync(join(receipt.projectionQuarantinePath, 'runtime/notes.txt'), 'utf8'), 'preserve me');
  assert.equal(receipt.providerAuthority, false);
  const after = inspectCompletionStatus(s.root, s.oldRef, { protectedBranch: 'main' }, s.profile,
    { successor: { ...s.input.successor, reviewedHead: s.reviewedHead, merge: s.merge } });
  assert.equal(after.closeout.missionState, 'source_complete');
  assert.equal(after.lane.mounted, false);
  assert.equal(after.integration.kind, 'reviewed-successor');
  const replay = applyUserCleanup(plan, { cwd: s.root, ...s.options,
    authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true,
    now: () => NOW + 900001 });
  assert.equal(replay.replayed, true);
  writeFileSync(join(s.root, 'later.txt'), 'later change\n');
  git(s.root, 'add', '.'); git(s.root, 'commit', '--quiet', '-m', 'later main edit');
  assert.deepEqual(successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    ['starter.py'], { cwd: s.root }), proof);
});

test('successor rejects omitted replacements, failed checks, changed target and unreviewed ancestry', t => {
  const s = fixture(t);
  assert.equal(successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    [], { cwd: s.root }), null);
  assert.equal(successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    ['scene.py'], { cwd: s.root }), null);
  assert.equal(successorIntegrationProof(s.merge, s.reviewedHead, s.oldHead,
    ['starter.py'], { cwd: s.root }), null);
  s.check.conclusion = 'failure';
  assert.throws(() => planUserCleanup(s.input, s.options), /check-not-successful/);
  s.check.conclusion = 'success';
  assert.throws(() => planUserCleanup({ ...s.input, successor: { ...s.input.successor,
    predecessorHead: s.reviewedHead } }, s.options), /successor-target-drift/);
  assert.equal(validateCommandArguments('release-common', ['complete', `--ref=${s.oldRef}`,
    '--via-pr=12', '--replaced=starter.py', '--stopped']), null);
  assert.ok(validateCommandArguments('release-common', ['complete', `--ref=${s.oldRef}`,
    '--via-pr=12', '--replaced=starter.py']));
});
