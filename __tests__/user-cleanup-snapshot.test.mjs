import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { newRecord, put } from '../src/lane-records.mjs';
import { observeRetainedWorktreeQuarantine } from '../src/cleanup-quarantine.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { applyDetachedMainSnapshotCleanup, planDetachedMainSnapshotCleanup, planLocalWorktreeCleanup, applyLocalWorktreeCleanup } from '../bin/agentic-os-cleanup-recovery.mjs';

const NOW = Date.parse('2026-10-31T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, { local = false } = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-snapshot-cleanup-'))), root = join(parent, 'root'), target = join(parent, 'snapshot');
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main'); git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid'); git(root, 'remote', 'add', 'origin', 'https://github.com/example/private.git');
  const ref = 'agent/fixture/schedule', origin = join(parent, 'origin.git');
  if (local) {
    git(parent, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
    git(root, 'remote', 'set-url', 'origin', origin);
  }
  const profile = createRepositoryProfile({ repository: 'github.com/example/private',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: local ? null : { id: 'github', version: '1' } },
    requiredChecks: [], capabilities: local ? ['retain-all-cleanup'] : [], cleanup: { localBranch: 'retain', remoteBranch: 'retain',
      remoteTrackingRef: 'retain', unreachableObjects: 'retain', worktreeProjection: local ? 'retain' : 'quarantine', worktreeRegistration: local ? 'retain' : 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile)}\n`);
  writeFileSync(join(root, '.gitignore'), '.runtime/\n'); writeFileSync(join(root, 'product.txt'), 'canonical\n');
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'canonical main');
  const head = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', 'refs/remotes/origin/main', head);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  if (local) {
    git(root, 'worktree', 'add', '--quiet', '-b', ref, target, head);
    git(root, 'push', 'origin', 'main', ref);
    const record = newRecord({ ref, device: 'fixture', scope: 'schedule', base: 'refs/remotes/origin/main', baseSha: head, worktree: target });
    put({ ...record, state: 'published', head }, root);
  } else git(root, 'worktree', 'add', '--quiet', '--detach', target, head);
  mkdirSync(join(target, '.runtime')); writeFileSync(join(target, '.runtime/ignored.txt'), 'retained local bytes\n');
  const options = { now: () => NOW, observeRemote: ({ canonical }) => `${canonical}\trefs/heads/main` };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, target, head, options, origin, ref,
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

function localFixture(t) {
  const s = fixture(t, { local: true });
  const plan = (overrides = {}) => planLocalWorktreeCleanup({ cwd: s.root, mode: 'local-integrated', target: s.target,
    ref: s.ref, expectedHead: s.head, now: () => NOW, ...overrides });
  const apply = (p, probe, overrides = {}) => applyLocalWorktreeCleanup(p, { cwd: s.root, stopped: true,
    authorization: `agentic-os:local-integrated-cleanup:${p.planDigest}`, now: () => NOW, ...overrides },
  { createReaderProbe: () => probe });
  return { ...s, plan, apply };
}

test('Git-only consent quarantines one attached lane, retaining exact local and origin refs and recoverable bytes', t => {
  const s = localFixture(t), plan = s.plan(), localRefs = git(s.root, 'show-ref'), originRefs = git(s.origin, 'show-ref');
  const scanned = [];
  const receipt = s.apply(plan, path => scanned.push(path));
  assert.deepEqual(scanned, [s.target, plan.observation.adminPath]);
  assert.equal(receipt.schema, 'agentic-os/local-integrated-cleanup-receipt/v1');
  assert.equal(receipt.ref, s.ref);
  assert.equal(receipt.canonicalRevision, s.head);
  assert.equal(receipt.bytesDeleted, false);
  assert.equal(existsSync(s.target), false);
  assert.equal(readFileSync(join(receipt.projectionPath, '.runtime/ignored.txt'), 'utf8'), 'retained local bytes\n');
  assert.equal(readFileSync(join(receipt.registrationPath, 'HEAD'), 'utf8'), `ref: refs/heads/${s.ref}\n`);
  assert.equal(s.apply(plan, () => assert.fail('replay has no effects')).replayed, true);
  assert.equal(git(s.root, 'show-ref'), localRefs);
  assert.equal(git(s.origin, 'show-ref'), originRefs);
  assert.equal(observeRetainedWorktreeQuarantine(s.root, s.ref, s.head), true);
  renameSync(receipt.projectionPath, s.target);
  renameSync(receipt.registrationPath, plan.observation.adminPath);
  assert.equal(git(s.target, 'symbolic-ref', '--short', 'HEAD'), s.ref);
  assert.equal(git(s.target, 'status', '--porcelain'), '');
  assert.equal(git(s.root, 'show-ref'), localRefs);
});

test('Git-only cleanup rejects unknown lanes, head drift, open readers, wrong consent and origin changes before moving', t => {
  const s = localFixture(t), plan = s.plan();
  assert.throws(() => s.plan({ ref: 'agent/fixture/other' }), /integrated-lane-binding/);
  assert.throws(() => s.plan({ expectedHead: 'f'.repeat(40) }), /snapshot-controller-drift/);
  assert.throws(() => s.apply(plan, () => {}, { authorization: 'agentic-os:other' }), /authorization/);
  assert.throws(() => s.apply(plan, () => {}, { stopped: false }), /authorization/);
  assert.throws(() => s.apply(plan, path => { if (path === plan.observation.adminPath) throw Error('open reader'); }), /open reader/);
  git(s.origin, 'update-ref', '-d', `refs/heads/${s.ref}`);
  assert.throws(() => s.apply(plan, () => {}), /integrated-origin-ref-drift/);
  git(s.root, 'remote', 'set-url', 'origin', 'https://example.invalid/origin');
  assert.throws(s.plan, /integrated-local-origin/);
  assert.equal(existsSync(s.target), true);
  assert.equal(existsSync(plan.observation.adminPath), true);
});

test('Git-only cleanup requires all three target selectors on the unified command', () => {
  const selectors = ['--ref=agent/fixture/schedule', '--target=/tmp/target', `--expected-head=${'1'.repeat(40)}`];
  const command = ['plan', '--mode=local-integrated'];
  assert.equal(validateCommandArguments('cleanup', [...command, ...selectors]), null);
  for (const missing of selectors)
    assert.ok(validateCommandArguments('cleanup', [...command, ...selectors.filter(flag => flag !== missing)]));
  assert.ok(validateCommandArguments('cleanup-user', [...command, ...selectors]));
});
