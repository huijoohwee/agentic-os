import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureRecovery, inventoryRecovery, recoveryLocation } from '../bin/agentic-os-storage-recovery.mjs';
import { planStorage, applyStorage, runStorage } from '../bin/agentic-os-storage.mjs';
import { digest, storageManifest } from '../bin/agentic-os-storage-files.mjs';
import { acquireOperationLock, finishOperationLock } from '../src/git.mjs';
import { acquireDirectoryLock } from '../src/file-integrity.mjs';

const NOW = Date.parse('2026-09-11T12:00:00Z');
const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function fixture(t) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-recovery-'))), root = join(workspace, 'repo');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(root); git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'gc.auto', '0']); git(root, ['commit', '--allow-empty', '-qm', 'base']);
  const store = join(workspace, 'store'), common = join(root, '.git');
  return { workspace, root, common, store,
    configure: (path = store) => configureRecovery({ cwd: root, store: path }),
    plan: (operation, extra = {}) => planStorage({ cwd: root, kind: 'recovery-relocation', operation, ...extra }, NOW),
    apply: (plan, extra = {}) => applyStorage(plan, { authorization: `agentic-os:storage:${plan.planDigest}`,
      stopped: true, now: NOW, ...extra }),
  };
}
// A portable completed archive fixture uses the production v1 receipt format and a real tar extraction manifest.
function archive(s) {
  const target = join(s.root, 'retired-output'); mkdirSync(target);
  writeFileSync(join(target, 'run'), '#!/bin/sh\nexit 0\n'); chmodSync(join(target, 'run'), 0o755);
  symlinkSync('run', join(target, 'alias')); linkSync(join(target, 'run'), join(target, 'hardlink'));
  const before = { checkoutHead: git(s.root, ['rev-parse', 'HEAD']), artifactManifest: storageManifest(target) };
  const draft = { schema: 'agentic-os/storage-plan/v1', root: s.root, common: s.common,
    kind: 'artifact-archive', quarantine: null, target, issuedAt: NOW - 86400000, expiresAt: NOW - 82800000,
    artifact: 'retired-output', before, beforeAllocatedBytes: 8192 };
  const operation = digest(draft), plan = { ...draft, planDigest: operation };
  const directory = join(s.common, 'agentic-os-storage', operation); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const source = join(directory, 'artifact.tar.gz');
  execFileSync('tar', ['-czpf', source, '-C', s.root, 'retired-output']);
  writeJson(join(directory, 'plan.json'), plan);
  writeJson(join(directory, 'verified.json'), { archive: source, manifest: before.artifactManifest });
  writeJson(join(directory, 'receipt.json'), { schema: 'agentic-os/storage-receipt/v1', planDigest: operation,
    kind: plan.kind, target, archived: true, contentPreserved: true, backupDirectory: directory,
    completedAt: new Date(NOW - 86300000).toISOString() });
  rmSync(target, { recursive: true }); return { operation, directory, source, plan };
}
function moved(s, a, options) { s.configure(); const plan = s.plan(a.operation); return { plan, result: s.apply(plan, options) }; }
function restorePlan(s, a, destination = join(s.workspace, 'restored')) {
  return s.plan(a.operation, { kind: 'recovery-restore', destination });
}
test('private configuration is idempotent, portable, and refuses nonignored or tracked Git storage', t => {
  const s = fixture(t), config = s.configure();
  assert.equal(lstatSync(s.store).mode & 0o777, 0o700);
  assert.equal(s.configure().replayed, true);
  assert.equal(s.configure().cloneId, config.cloneId);
  assert.throws(() => s.configure(join(s.workspace, 'other')), /configuration-conflict/);
  assert.ok(!existsSync(join(s.workspace, 'other')));
  const g = fixture(t), inside = join(g.root, '.store');
  assert.throws(() => g.configure(inside), /not-ignored/); assert.ok(!existsSync(inside));
  writeFileSync(join(g.root, '.gitignore'), '/.store/__recovery_probe__\n');
  assert.throws(() => g.configure(inside), /not-ignored/); assert.ok(!existsSync(inside));
  writeFileSync(join(g.root, '.gitignore'), '/.store/\n');
  g.configure(inside);
  assert.equal(git(g.root, ['status', '--porcelain']), '?? .gitignore');
  git(g.root, ['add', '-f', '.store/store.json']);
  assert.throws(() => inventoryRecovery({ cwd: g.root }), /store-tracked/);
});
test('configuration refuses aliases, unsafe permissions, unknown contents and Git internals', t => {
  for (const kind of ['alias', 'permissions', 'contents', 'git']) {
    const s = fixture(t); let target = s.store;
    if (kind === 'alias') symlinkSync(s.workspace, target);
    if (kind === 'permissions') { mkdirSync(target); chmodSync(target, 0o755); }
    if (kind === 'contents') { mkdirSync(target, { mode: 0o700 }); writeFileSync(join(target, 'keep'), 'authored'); }
    if (kind === 'git') target = join(s.common, 'store');
    assert.throws(() => s.configure(target), /alias|private-directory|unrecognized|store-location/);
    if (kind === 'contents') assert.equal(readFileSync(join(target, 'keep'), 'utf8'), 'authored');
  }
});
test('inventory is read-only, retains unknown operations and refuses missing configured directories', t => {
  const s = fixture(t);
  assert.deepEqual(inventoryRecovery({ cwd: s.root }).operations, []);
  assert.ok(!existsSync(join(s.common, 'agentic-os-storage')));
  const a = archive(s); s.configure();
  const partial = join(s.common, 'agentic-os-storage', 'b'.repeat(64)); mkdirSync(partial);
  writeFileSync(join(partial, 'original'), 'recover me');
  const inventory = inventoryRecovery({ cwd: s.root });
  assert.equal(inventory.operations.find(x => x.operation === a.operation).state, 'retained-local');
  assert.equal(inventory.operations.find(x => x.operation === 'b'.repeat(64)).state, 'retained-unclassified');
  rmSync(join(s.store, 'records'), { recursive: true });
  assert.throws(() => inventoryRecovery({ cwd: s.root })); assert.ok(!existsSync(join(s.store, 'records')));
  assert.equal(readFileSync(join(partial, 'original'), 'utf8'), 'recover me');
});
test('archive relocation preserves receipts, verifies native extraction, and restores a separate copy', t => {
  const s = fixture(t), a = archive(s), original = readFileSync(a.source);
  const receipts = ['plan.json', 'receipt.json', 'verified.json'].map(name => [name, readFileSync(join(a.directory, name))]);
  const { plan, result } = moved(s, a);
  assert.equal(result.sourceRemoved, true); assert.ok(!existsSync(a.source));
  for (const [name, bytes] of receipts) assert.deepEqual(readFileSync(join(a.directory, name)), bytes);
  const location = recoveryLocation(s.common, a.operation);
  assert.deepEqual(readFileSync(location.payload), original);
  assert.equal(inventoryRecovery({ cwd: s.root }).operations[0].state, 'retained-central');
  assert.equal(s.apply(plan, { now: NOW + 7200000 }).replayed, true);
  const restored = s.apply(restorePlan(s, a));
  assert.equal(restored.verification.format, 'tar-gzip');
  assert.deepEqual(restored.verification.restoredManifest, a.plan.before.artifactManifest);
  assert.deepEqual(readFileSync(restored.payload), original);
  assert.ok(!existsSync(a.plan.target));
  assert.throws(() => s.apply(restorePlan(s, a, join(s.workspace, 'restored'))), /restore-destination/);
});
test('real Git recovery keeps every unreachable object and historical metadata after relocation and restore', t => {
  const s = fixture(t);
  const unreachable = git(s.root, ['hash-object', '-w', '--stdin'], 'unreachable recovery bytes');
  for (let i = 0; i < 135; i++) git(s.root, ['hash-object', '-w', '--stdin'], `${i} recoverable\n`.repeat(200));
  const initial = planStorage({ cwd: s.root, kind: 'git' }, NOW), original = s.apply(initial);
  assert.ok(original.backupDirectory);
  const before = storageManifest(original.backupDirectory);
  const { result } = moved(s, { operation: initial.planDigest });
  assert.equal(result.sourceRemoved, true);
  assert.equal(git(s.root, ['cat-file', '-p', unreachable]), 'unreachable recovery bytes');
  const restored = s.apply(restorePlan(s, { operation: initial.planDigest }));
  assert.deepEqual(storageManifest(restored.payload), before);
  assert.equal(restored.verification.objectDigest, initial.before.objectDigest);
  assert.ok(existsSync(join(restored.payload, 'HEAD')));
  assert.equal(s.apply(initial).recoveryLocation.recordId, result.recordId);
});
test('authorization, expiry, modified plans and clone/store locks refuse before relocation', t => {
  const s = fixture(t), a = archive(s); s.configure(); const plan = s.plan(a.operation);
  for (const options of [{ authorization: 'guess' }, { stopped: false }, { now: NOW + 3600000 }])
    assert.throws(() => s.apply(plan, options), /authorization|expired/);
  assert.throws(() => s.apply({ ...plan, source: s.root }), /plan-binding/);
  for (const lock of [acquireOperationLock('agentic-os-worktree-cleanup', s.root),
    acquireDirectoryLock(join(s.store, 'operation.lock'))]) {
    try { assert.throws(() => s.apply(plan), /busy/); }
    finally { finishOperationLock(lock, { label: 'test' }); }
  }
  assert.ok(existsSync(a.source)); assert.ok(!existsSync(join(a.directory, 'relocation-plan.json')));
});
test('source or receipt drift blocks removal and leaves all surviving recovery data', t => {
  for (const target of ['payload', 'receipt']) {
    const s = fixture(t), a = archive(s); s.configure(); const plan = s.plan(a.operation);
    assert.throws(() => s.apply(plan, { progress(message) {
      if (!message.startsWith('Catalog is durable')) return;
      if (target === 'payload') writeFileSync(a.source, 'changed source');
      else writeJson(join(a.directory, 'receipt.json'), {});
    } }), /drift|binding/);
    assert.ok(existsSync(a.source)); assert.equal(readdirSync(join(s.store, 'records')).length, 1);
    assert.ok(!existsSync(join(a.directory, 'relocation.json')));
  }
});
test('interrupted verified publication resumes only with exact consent and the original journal', t => {
  const s = fixture(t), a = archive(s); s.configure(); const plan = s.plan(a.operation);
  assert.throws(() => s.apply(plan, { progress(message) {
    if (message.startsWith('Catalog is durable')) throw Error('simulated interruption');
  } }), /simulated interruption/);
  assert.ok(existsSync(a.source)); assert.throws(() => s.apply(plan), /partial-operation/);
  assert.throws(() => s.apply(plan, { resume: true, stopped: false }), /authorization/);
  const receipt = s.apply(plan, { resume: true });
  assert.equal(receipt.sourceRemoved, true); assert.equal(readdirSync(join(s.store, 'staging')).length, 0);
});
test('partial copying is retained and cannot resume deletion', t => {
  const s = fixture(t), a = archive(s); s.configure(); const plan = s.plan(a.operation);
  assert.throws(() => s.apply(plan, { progress() { throw Error('copy interrupted'); } }), /copy interrupted/);
  assert.throws(() => s.apply(plan, { resume: true }), /partial-operation/);
  assert.ok(existsSync(a.source)); assert.equal(readdirSync(join(s.store, 'staging')).length, 1);
});
test('equal immutable payloads are shared across clones with independent provenance records', t => {
  const s = fixture(t), a = archive(s), other = fixture(t), b = archive(other);
  copyFileSync(a.source, b.source);
  moved(s, a); other.configure(s.store);
  const plan = other.plan(b.operation), result = other.apply(plan);
  assert.equal(result.sourceRemoved, true);
  assert.equal(readdirSync(join(s.store, 'payloads')).length, 1);
  assert.equal(readdirSync(join(s.store, 'records')).length, 2);
  assert.notEqual(recoveryLocation(s.common, a.operation).recordId, recoveryLocation(other.common, b.operation).recordId);
});
test('changed central data, source aliases and corrupted journals never authorize cleanup or restore', t => {
  const s = fixture(t), a = archive(s); moved(s, a);
  const location = recoveryLocation(s.common, a.operation); writeFileSync(location.payload, 'corrupt');
  assert.throws(() => restorePlan(s, a), /payload-drift/);
  const other = fixture(t), b = archive(other); other.configure();
  rmSync(b.source); symlinkSync(join(other.root, '.git/HEAD'), b.source);
  assert.throws(() => other.plan(b.operation), /source-type/);
  const j = fixture(t), c = archive(j); j.configure(); const plan = j.plan(c.operation);
  writeJson(join(c.directory, 'relocation-plan.json'), {});
  assert.throws(() => j.apply(plan, { resume: true }), /journal-drift/); assert.ok(existsSync(c.source));
});
test('bad archives fail native verification before the original is removed', t => {
  const s = fixture(t), a = archive(s); writeFileSync(a.source, 'not a tar archive'); s.configure();
  assert.throws(() => s.apply(s.plan(a.operation)));
  assert.equal(readFileSync(a.source, 'utf8'), 'not a tar archive');
  assert.equal(readdirSync(join(s.store, 'records')).length, 0);
});
test('CLI validates new argument combinations and emits usable configuration and inventory', t => {
  const s = fixture(t), cli = realpathSync(new URL('../bin/agentic-os-storage.mjs', import.meta.url));
  const run = args => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
  assert.equal(run(['configure', `--repository=${s.root}`, `--store=${s.store}`]).store, s.store);
  assert.deepEqual(run(['inventory', `--repository=${s.root}`]).operations, []);
  for (const args of [['configure', `--repository=${s.root}`], ['inventory', '--repository'],
    ['plan', `--repository=${s.root}`, '--kind=git', `--store=${s.store}`],
    ['plan', `--repository=${s.root}`, '--kind=recovery-relocation', '--operation=../escape'],
    ['inventory', `--repository=${s.root}`, '--delete']]) assert.throws(() => runStorage(args));
});
