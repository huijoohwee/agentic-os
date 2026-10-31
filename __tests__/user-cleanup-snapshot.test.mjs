import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { applyDetachedMainSnapshotCleanup, planDetachedMainSnapshotCleanup } from '../bin/agentic-os-cleanup-recovery.mjs';

const NOW = Date.parse('2026-10-31T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-snapshot-cleanup-'))), root = join(parent, 'root'), target = join(parent, 'snapshot');
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main'); git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid'); git(root, 'remote', 'add', 'origin', 'https://github.com/example/private.git');
  const profile = createRepositoryProfile({ repository: 'github.com/example/private',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: [], capabilities: [], cleanup: { localBranch: 'retain', remoteBranch: 'retain',
      remoteTrackingRef: 'retain', unreachableObjects: 'retain', worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile)}\n`);
  writeFileSync(join(root, '.gitignore'), '.runtime/\n'); writeFileSync(join(root, 'product.txt'), 'canonical\n');
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'canonical main');
  const head = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', 'refs/remotes/origin/main', head);
  ensureRepositoryTrust(root, profile, { allowCreate: true }); git(root, 'worktree', 'add', '--quiet', '--detach', target, head);
  mkdirSync(join(target, '.runtime')); writeFileSync(join(target, '.runtime/ignored.txt'), 'retained local bytes\n');
  const options = { now: () => NOW, observeRemote: ({ canonical }) => `${canonical}\trefs/heads/main` };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, target, head, options,
    plan: (overrides = {}) => planDetachedMainSnapshotCleanup({ cwd: root, target, expectedHead: head, now: () => NOW, ...overrides }, options),
    apply: (plan, overrides = {}, runtimeOptions = options) => applyDetachedMainSnapshotCleanup(plan, { cwd: root,
      authorization: `agentic-os:local-snapshot-cleanup:${plan.planDigest}`, stopped: true, now: () => NOW, ...overrides }, runtimeOptions) };
}

test('exact detached main snapshots are quarantined recoverably without ref or object changes; replay is read-only', t => {
  const s = fixture(t), plan = s.plan(), refs = git(s.root, 'show-ref'), objects = git(s.root, 'count-objects', '-v');
  assert.equal(plan.snapshotHead, plan.canonical); assert.equal(plan.targetPath, s.target);
  const receipt = s.apply(plan);
  assert.equal(receipt.result, 'quarantined'); assert.equal(receipt.bytesDeleted, false);
  assert.equal(receipt.providerAuthority, false); assert.equal(receipt.deploymentAuthority, false);
  assert.equal(receipt.branchRefsMutated, false); assert.equal(receipt.objectDatabaseMutated, false);
  assert.equal(existsSync(s.target), false); assert.equal(git(s.root, 'show-ref'), refs);
  assert.equal(git(s.root, 'count-objects', '-v'), objects);
  assert.equal(readFileSync(join(receipt.projectionQuarantinePath, '.runtime/ignored.txt'), 'utf8'), 'retained local bytes\n');
  assert.equal(existsSync(receipt.registrationQuarantinePath), true);
  assert.equal(s.apply(plan, { now: () => NOW + 900001 }).replayed, true);
});

test('snapshot plans require exact consent, stop acknowledgement, current remote state, and an unexpired plan', t => {
  const s = fixture(t), plan = s.plan();
  assert.throws(() => s.apply(plan, { authorization: null }), /snapshot-authorization/);
  assert.throws(() => s.apply(plan, { stopped: false }), /snapshot-authorization/);
  assert.throws(() => s.apply(plan, { now: () => NOW + 900000 }), /snapshot-expired/);
  assert.throws(() => s.apply(plan, {}, { observeRemote: () => `${'a'.repeat(40)}\trefs/heads/main` }), /snapshot-remote-main-drift/);
  assert.equal(existsSync(s.target), true);
});

test('dirty, attached, mismatched, and aliased targets are refused before mutation', t => {
  const s = fixture(t);
  assert.throws(() => s.plan({ expectedHead: 'a'.repeat(40) }), /snapshot-controller/);
  const alias = join(s.parent, 'alias'); execFileSync('ln', ['-s', s.target, alias]);
  assert.throws(() => planDetachedMainSnapshotCleanup({ cwd: s.root, target: alias, expectedHead: s.head }, s.options), /snapshot-target-path/);
  writeFileSync(join(s.target, 'visible.txt'), 'untracked\n');
  assert.throws(s.plan, /snapshot-target-dirty/); assert.equal(existsSync(s.target), true);
  rmSync(join(s.target, 'visible.txt'));
  git(s.target, 'switch', '--quiet', '-c', 'agent/snapshot-test');
  assert.throws(s.plan, /snapshot-target-registration/); assert.equal(existsSync(s.target), true);
});

test('plan and apply argument contracts keep local snapshots on the unified cleanup command', t => {
  assert.equal(validateCommandArguments('cleanup', ['plan', '--mode=local-snapshot', '--target=/tmp/snapshot', `--expected-head=${'a'.repeat(40)}`]), null);
  assert.ok(validateCommandArguments('cleanup-user', ['plan', '--mode=local-snapshot', '--target=/tmp/snapshot', `--expected-head=${'a'.repeat(40)}`]));
  assert.ok(validateCommandArguments('cleanup', ['plan', '--mode=local-snapshot', '--target=/tmp/snapshot']));
});
