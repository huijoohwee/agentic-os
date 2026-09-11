import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync,
  rmSync, symlinkSync, readlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStorage, applyStorage, runStorage } from '../bin/agentic-os-storage.mjs';
import { observeQuarantineManifest } from '../src/cleanup-manifest.mjs';
import { acquireOperationLock, finishOperationLock } from '../src/git.mjs';

const NOW = Date.parse('2026-09-11T00:00:00Z');
const LIMITS = { byteCeiling: 512 * 1024 * 1024, entryCeiling: 25000 };
const git = (root, args, input) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
  input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-storage-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'gc.auto', '0']);
  writeFileSync(join(root, 'file'), 'source\n'); git(root, ['add', '.']); git(root, ['commit', '-qm', 'base']);
  const plan = kind => planStorage({ cwd: root, kind }, NOW);
  const apply = (p, options = {}) => applyStorage(p, { authorization: `agentic-os:storage:${p.planDigest}`,
    stopped: true, now: NOW, ...options });
  return { root, plan, apply };
}
function quarantine(s) {
  const id = 'a'.repeat(64), q = join(s.root, '.git/agentic-os-cleanup-quarantine', id);
  const projection = join(q, 'projection'), registration = join(q, 'registration');
  mkdirSync(join(projection, 'node_modules/pkg'), { recursive: true }); mkdirSync(registration);
  writeFileSync(join(projection, 'source.txt'), 'authored work remains\n');
  writeFileSync(join(projection, 'node_modules/pkg/index.js'), 'export const x = "compressible";\n'.repeat(100000));
  chmodSync(join(projection, 'node_modules/pkg/index.js'), 0o755);
  symlinkSync('pkg/index.js', join(projection, 'node_modules/executable'));
  writeFileSync(join(registration, 'HEAD'), 'recovery metadata\n');
  const manifest = observeQuarantineManifest(projection, LIMITS);
  writeFileSync(join(q, 'operation.json'), JSON.stringify({ schema: 'agentic-os/worktree-quarantine-operation/v1',
    eligibility: { cleanupPlanDigest: id, projectionManifestDigest: manifest.digest,
      projectionBytes: manifest.bytes, projectionEntries: manifest.entries } }));
  return { id, q, projection, manifest,
    plan: () => planStorage({ cwd: s.root, kind: 'dependencies', quarantine: id }, NOW) };
}
test('Git compaction retains reachable, reflog-only and unreachable loose/packed objects and recovery pack', t => {
  const s = fixture(t), root = s.root;
  const base = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'file'), 'reflog-only commit');
  git(root, ['commit', '-qam', 'reflog evidence']);
  const reflogOnly = git(root, ['rev-parse', 'HEAD']);
  git(root, ['reset', '--hard', base]);
  const peer = join(root, 'peer'); git(root, ['worktree', 'add', '-qb', 'peer', peer]);
  const loose = git(root, ['hash-object', '-w', '--stdin'], 'unreachable loose bytes');
  const packed = git(root, ['hash-object', '-w', '--stdin'], 'unreachable packed bytes');
  git(root, ['pack-objects', join(root, '.git/objects/pack/pack')], `${packed}\n`);
  git(root, ['prune-packed']);
  const plan = s.plan('git'), refs = git(root, ['show-ref']);
  const receipt = s.apply(plan);
  assert.equal(receipt.objectIdsPreserved, true); assert.equal(receipt.refsPreserved, true);
  assert.equal(git(root, ['show-ref']), refs);
  assert.equal(git(root, ['cat-file', '-p', loose]), 'unreachable loose bytes');
  assert.equal(git(root, ['cat-file', '-p', packed]), 'unreachable packed bytes');
  assert.equal(git(root, ['cat-file', '-t', reflogOnly]), 'commit');
  assert.ok(existsSync(join(receipt.backupDirectory, 'worktrees/peer/HEAD')));
  assert.ok(existsSync(receipt.backupDirectory)); assert.ok(existsSync(receipt.receiptPath));
  assert.equal(s.plan('git').before.objectDigest, plan.before.objectDigest);
  assert.equal(s.apply(plan, { now: NOW + 3600001 }).replayed, true);
});
test('invalid consent, expiration, modified plans and busy clones refuse before compaction', t => {
  const s = fixture(t), plan = s.plan('git');
  assert.throws(() => s.apply(plan, { authorization: 'guess' }), /authorization/);
  assert.throws(() => s.apply(plan, { stopped: false }), /authorization/);
  assert.throws(() => s.apply(plan, { now: NOW + 3600000 }), /expired/);
  assert.throws(() => s.apply({ ...plan, target: s.root }), /binding/);
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', s.root);
  try { assert.throws(() => s.apply(plan), /busy/); }
  finally { finishOperationLock(lock, { label: 'test', result: null }); }
  assert.ok(!existsSync(join(s.root, '.git/agentic-os-storage', plan.planDigest)));
});
test('new objects invalidate a plan, partial operations stay intact, and active Git locks block', t => {
  const s = fixture(t), stale = s.plan('git');
  git(s.root, ['hash-object', '-w', '--stdin'], 'new recovery data');
  assert.throws(() => s.apply(stale), /plan-drift/);
  const plan = s.plan('git'), partial = join(s.root, '.git/agentic-os-storage', plan.planDigest);
  mkdirSync(partial, { recursive: true }); writeFileSync(join(partial, 'evidence'), 'preserve');
  assert.throws(() => s.apply(plan), /partial-operation-retained/);
  assert.equal(readFileSync(join(partial, 'evidence'), 'utf8'), 'preserve');
  writeFileSync(join(s.root, '.git/index.lock'), 'other writer');
  assert.throws(() => s.apply(plan), /git-writer/);
});
test('APFS dependency compression preserves original projection manifest, modes, symlinks and receipt bytes',
  { skip: process.platform !== 'darwin' }, t => {
    const s = fixture(t), q = quarantine(s), plan = q.plan();
    const original = readFileSync(join(q.q, 'operation.json'));
    const receipt = s.apply(plan);
    assert.equal(receipt.contentPreserved, true);
    assert.deepEqual(observeQuarantineManifest(q.projection, LIMITS), q.manifest);
    assert.deepEqual(readFileSync(join(q.q, 'operation.json')), original);
    assert.equal(readlinkSync(join(q.projection, 'node_modules/executable')), 'pkg/index.js');
    assert.ok(receipt.afterAllocatedBytes <= receipt.beforeAllocatedBytes);
    assert.equal(s.apply(plan).replayed, true);
  });
test('dependency drift, symlink targets and unrelated paths are rejected', { skip: process.platform !== 'darwin' }, t => {
  const s = fixture(t), q = quarantine(s);
  assert.throws(() => planStorage({ cwd: s.root, kind: 'dependencies', quarantine: '../escape' }, NOW), /quarantine-id/);
  writeFileSync(join(q.projection, 'source.txt'), 'changed authored bytes');
  assert.throws(q.plan, /quarantine-drift/);
  const other = fixture(t), otherQ = quarantine(other);
  rmSync(join(otherQ.projection, 'node_modules'), { recursive: true });
  symlinkSync(join(q.projection, 'node_modules'), join(otherQ.projection, 'node_modules'));
  assert.throws(otherQ.plan, /directory-alias/);
});
test('failure after dependency copy preserves original and blocks unsafe replay', { skip: process.platform !== 'darwin' }, t => {
  const s = fixture(t), q = quarantine(s), plan = q.plan();
  assert.throws(() => s.apply(plan, { progress() {
    writeFileSync(join(q.projection, 'node_modules/pkg/index.js'), 'changed during operation');
  } }), /compressed-content-mismatch/);
  assert.equal(readFileSync(join(q.projection, 'node_modules/pkg/index.js'), 'utf8'), 'changed during operation');
  assert.ok(existsSync(join(s.root, '.git/agentic-os-storage', plan.planDigest)));
});
test('CLI grammar rejects ambiguous, missing and unexpected flags', () => {
  for (const argv of [[], ['delete'], ['plan', '--repository=/tmp', '--kind=git', '--force'],
    ['plan', '--repository=/tmp', '--kind=git', '--kind=dependencies'], ['apply', '--plan=x'],
    ['apply', '--plan=x', '--authorize=x', '--stopped=false']]) assert.throws(() => runStorage(argv));
});
