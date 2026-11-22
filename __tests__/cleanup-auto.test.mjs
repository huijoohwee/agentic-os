import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { planAutoUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { RECOVERY_MODE, SNAPSHOT_CLEANUP_SCHEMA } from '../bin/agentic-os-cleanup-recovery.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { put } from '../src/lane-records.mjs';

const NOW = Date.parse('2026-11-22T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('cleanup auto argument validation requires exactly one locator', () => {
  assert.equal(validateCommandArguments('cleanup-user', ['auto', '--ref=agent/device/test']), null);
  assert.equal(validateCommandArguments('cleanup', ['auto', '--target=/tmp/example']), null);
  assert.match(validateCommandArguments('cleanup-user', ['auto']), /exactly one/u);
  assert.match(validateCommandArguments('cleanup', ['auto', '--ref=agent/device/test', '--target=/tmp/example']), /exactly one/u);
});

test('cleanup auto resolves an exact recovery lane by ref', (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-cleanup-auto-recovery-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root'), target = join(parent, 'lane');
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  const repository = 'example/GameXR', branch = 'agent/device-0232231d4a19/recovery', pr = 7;
  const profile = createRepositoryProfile({ repository: `github.com/${repository}`,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: ['test'] });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'source.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'remote', 'add', 'origin', `https://github.com/${repository}.git`);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  git(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-recovery');
  git(root, 'worktree', 'add', '--quiet', '-b', branch, target);
  writeFileSync(join(target, 'source.txt'), 'delivered\n');
  git(target, 'add', '.');
  git(target, 'commit', '--quiet', '-m', 'source');
  const head = git(target, 'rev-parse', 'HEAD');
  git(root, 'merge', '--squash', '--quiet', branch);
  git(root, 'commit', '--quiet', '-m', 'merged review');
  const merge = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', merge);
  put({ ref: branch, state: 'published', worktree: target, pr, head }, root);
  const pull = { number: pr, merged: true, state: 'closed', merged_at: '2026-11-21T00:00:00Z',
    merge_commit_sha: merge, html_url: `https://github.com/${repository}/pull/${pr}`,
    base: { ref: 'main', repo: { full_name: repository } }, head: { sha: head, ref: branch, repo: { full_name: repository } } };
  const check = { name: 'test', id: 123, head_sha: head, app: { id: 15368, slug: 'github-actions' },
    status: 'completed', conclusion: 'success', completed_at: '2026-11-21T00:00:00Z',
    details_url: `https://github.com/${repository}/actions/runs/456/job/123` };
  const run = { id: 456, head_sha: head, head_branch: branch, repository: { full_name: repository },
    head_repository: { full_name: repository }, event: 'pull_request', path: '.github/workflows/ci.yml',
    run_attempt: 1, status: 'completed', conclusion: 'success' };
  const api = (path) => {
    if (path.endsWith(`/pulls/${pr}`)) return structuredClone(pull);
    if (path.includes('/check-runs?')) return { total_count: 1, check_runs: [structuredClone(check)] };
    if (path.endsWith('/actions/runs/456')) return structuredClone(run);
    assert.fail(`unexpected provider read: ${path}`);
  };
  const plan = planAutoUserCleanup({ cwd: root, ref: branch }, { api, now: () => NOW, observeRemote: () => `${merge}\trefs/heads/main` });
  assert.equal(plan.mode, RECOVERY_MODE);
  assert.equal(plan.branch, branch);
  assert.equal(plan.targetPath, target);
  assert.equal(plan.pr, pr);
});

test('cleanup auto resolves a detached canonical snapshot target', (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-cleanup-auto-snapshot-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const origin = join(parent, 'origin.git'), root = join(parent, 'root'), target = join(parent, 'snapshot');
  mkdirSync(origin);
  mkdirSync(root);
  git(origin, 'init', '--quiet', '--bare');
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({ repository: 'github.com/example/GameXR',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    cleanup: {
      localBranch: 'retain', remoteBranch: 'retain', remoteTrackingRef: 'retain',
      unreachableObjects: 'retain', worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine',
    },
    capabilities: ['quarantine-worktree-cleanup-opt-in'],
  });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', 'origin', 'main:main');
  git(root, 'fetch', '--quiet', 'origin', 'main:refs/remotes/origin/main');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  git(root, 'worktree', 'add', '--quiet', '--detach', target, 'HEAD');
  const plan = planAutoUserCleanup({ cwd: root, target });
  assert.equal(plan.schema, SNAPSHOT_CLEANUP_SCHEMA);
  assert.equal(plan.mode, 'local-snapshot');
  assert.equal(plan.targetPath, target);
});
