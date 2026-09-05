import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quarantineManifest, quarantineManifestBundle, buildCleanRetirementProjection } from '../src/canonical-resources.mjs';
import { CANONICAL_SYNC_LIMITS } from '../src/canonical-sync.mjs';
import { copyWorktreeEntriesToQuarantine, retireCleanProjectionUnderExclusiveContract } from '../src/quarantine.mjs';
import { CanonicalSyncError, createCanonicalArtifacts, finishCanonicalOperation, recordCanonicalFailureEffects } from '../src/canonical-recovery.mjs';
import { acquireDirectoryLock } from '../src/file-integrity.mjs';
import { formatRetainedOperation } from '../bin/agentic-os-report.mjs';

const plan = { planDigest: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64), inventory: [] };
const limits = { ...CANONICAL_SYNC_LIMITS, quarantineManifestBytes: 1_000 };
const copyLimits = { maxEntryBytes: 1_000, maxAggregateBytes: 10_000,
  maxManifestBytes: 1_000, maxManifestChunks: 31, maxAggregateManifestBytes: 16_000_000 };
const exclusiveContract = `agentic-os:canonical-sync:exclusive:${plan.planDigest}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = Array.from({ length: 6 }, (_, index) => ({
  path: `${index}-${'path'.repeat(52)}`, mode: '100644', size: 1, sha256: sha256('x'),
}));

function verifyBundle(bundle, expected) {
  const index = JSON.parse(bundle.index);
  assert.equal(index.schema, 'agentic-os-canonical-sync-quarantine/v2');
  assert.equal(index.planDigest, plan.planDigest);
  assert.equal(index.inventoryDigest, plan.inventoryDigest);
  assert.equal(index.entryCount, expected.length);
  assert.equal(index.chunks.length, bundle.chunks.length);
  let firstSlot = 0;
  const restored = index.chunks.flatMap((record, position) => {
    const bytes = bundle.chunks[position], chunk = JSON.parse(bytes);
    assert.equal(record.name, `manifest-chunk-${position}.json`);
    assert.equal(record.bytes, bytes.length);
    assert.equal(record.sha256, sha256(bytes));
    assert.equal(record.firstSlot, firstSlot);
    assert.equal(chunk.firstSlot, firstSlot);
    assert.equal(chunk.planDigest, plan.planDigest);
    assert.equal(chunk.inventoryDigest, plan.inventoryDigest);
    assert.equal(record.entryCount, chunk.entries.length);
    firstSlot += record.entryCount;
    return chunk.entries;
  });
  assert.equal(firstSlot, expected.length);
  assert.deepEqual(restored, expected.map((entry, slot) => ({ slot: String(slot), ...entry })));
}

test('chunk boundaries preserve every UTF-8 and escaped entry with global slots and digest joins', () => {
  const expected = entries.map((entry, index) => ({ ...entry, path: `${entry.path}/é-"-${index}` }));
  const bundle = quarantineManifestBundle(plan, expected, limits);
  verifyBundle(bundle, expected);
  assert.ok(bundle.chunks.length > 1);
  for (const bytes of [bundle.index, ...bundle.chunks]) assert.ok(bytes.length <= 1_000);
});

test('the exact small-manifest boundary preserves v1 bytes; one byte less rolls over losslessly', () => {
  const legacy = quarantineManifest(plan, entries, 500_000);
  assert.deepEqual(quarantineManifestBundle(plan, entries,
    { ...limits, quarantineManifestBytes: legacy.length }), legacy);
  verifyBundle(quarantineManifestBundle(plan, entries,
    { ...limits, quarantineManifestBytes: legacy.length - 1 }), entries);
});

test('projection refuses entry, index, chunk-count, and total-byte overflows before effects', () => {
  const reject = (selected, expected = /quarantine-manifest/u, values = entries) => {
    assert.throws(() => quarantineManifestBundle(plan, values, selected), error => expected.test(error.code));
  };
  reject(limits, /entry-limit/u, [{ ...entries[0], path: 'x'.repeat(2_000) }]);
  reject({ ...limits, quarantineManifestChunks: 1 }, /chunk-limit/u);
  reject({ ...limits, aggregateQuarantineManifestBytes: 500 }, /aggregate-limit/u);
  const bundle = quarantineManifestBundle(plan, entries, limits);
  const chunkBytes = bundle.chunks.reduce((sum, bytes) => sum + bytes.length, 0);
  reject({ ...limits, aggregateQuarantineManifestBytes: chunkBytes }, /aggregate-limit/u);
  reject({ ...limits, quarantineManifestBytes: 500 }, /index-limit/u,
    Array.from({ length: 12 }, (_, i) => ({ path: String(i), mode: '100644', size: 0, oid: 'a'.repeat(40) })));
  const base = new Map(entries.map(entry => [entry.path, { ...entry, oid: 'c'.repeat(40), type: 'blob' }]));
  assert.throws(() => buildCleanRetirementProjection(plan, base,
    { ...limits, quarantineManifestChunks: 1 }), /quarantine-manifest-chunk-limit/u);
});

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'agentic-os-manifest-chunks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), storage = join(root, 'storage');
  fs.mkdirSync(source); fs.mkdirSync(storage);
  for (const entry of entries) fs.writeFileSync(join(source, entry.path), 'x');
  const manifest = quarantineManifestBundle(plan, entries, limits);
  const copy = (verify = () => {}, chosen = manifest, ceilings = copyLimits) => copyWorktreeEntriesToQuarantine({
    name: 'manifest-test', entries, verify, sourceRoot: source, storageRoot: storage,
    manifest: chosen, limits: ceilings,
  });
  return { source, storage, manifest, copy };
}

test('invalid copy bundle ceilings fail before allocating a directory or touching source bytes', t => {
  const f = fixture(t);
  for (const bad of [{ ...copyLimits, maxManifestChunks: 1 },
    { ...copyLimits, maxAggregateManifestBytes: 1 }, { ...copyLimits, maxManifestBytes: 1 }]) {
    assert.throws(() => f.copy(undefined, f.manifest, bad));
    assert.deepEqual(fs.readdirSync(f.storage), []);
    for (const entry of entries) assert.equal(fs.readFileSync(join(f.source, entry.path), 'utf8'), 'x');
  }
  for (const aggregate of [1, 0, -1, 1.5]) {
    assert.throws(() => f.copy(undefined, Buffer.from('{"small":true}\n'),
      { ...copyLimits, maxAggregateManifestBytes: aggregate }));
    assert.deepEqual(fs.readdirSync(f.storage), []);
  }
});

test('copy snapshots caller buffers and retains the complete verified bundle after retirement', t => {
  const f = fixture(t), expected = [f.manifest.index, ...f.manifest.chunks].map(Buffer.from);
  const receipt = f.copy((_entry, slot) => {
    if (slot === '0') for (const bytes of [f.manifest.index, ...f.manifest.chunks]) bytes.fill(0);
  });
  assert.deepEqual(fs.readFileSync(receipt.manifestPath), expected[0]);
  for (const [index, bytes] of expected.slice(1).entries())
    assert.deepEqual(fs.readFileSync(join(receipt.path, `manifest-chunk-${index}.json`)), bytes);
  assert.throws(() => retireCleanProjectionUnderExclusiveContract(receipt, { exclusiveContract, inventoryCount: 1 }));
  const retired = retireCleanProjectionUnderExclusiveContract(receipt, { exclusiveContract, inventoryCount: 0 });
  assert.equal(retired.retiredEntryCount, entries.length);
  assert.equal(receipt.verify(), true);
  for (const entry of entries) assert.equal(fs.existsSync(join(f.source, entry.path)), false);
});

for (const damage of ['index-bytes', 'later-chunk-bytes', 'missing', 'replacement', 'symlink', 'extra']) {
  test(`a ${damage} manifest fault prevents every source retirement`, t => {
    const f = fixture(t), receipt = f.copy();
    const target = damage === 'index-bytes' ? receipt.manifestPath
      : join(receipt.path, `manifest-chunk-${f.manifest.chunks.length - 1}.json`);
    if (damage === 'missing') fs.unlinkSync(target);
    else if (damage === 'replacement') { const bytes = fs.readFileSync(target); fs.unlinkSync(target); fs.writeFileSync(target, bytes, { mode: 0o600 }); }
    else if (damage === 'symlink') { fs.unlinkSync(target); fs.symlinkSync(receipt.manifestPath, target); }
    else if (damage === 'extra') fs.writeFileSync(join(receipt.path, 'manifest-chunk-extra.json'), 'foreign bytes');
    else { const bytes = fs.readFileSync(target); bytes[0] ^= 1; fs.writeFileSync(target, bytes); }
    assert.throws(() => retireCleanProjectionUnderExclusiveContract(receipt, { exclusiveContract, inventoryCount: 0 }));
    for (const entry of entries) assert.equal(fs.readFileSync(join(f.source, entry.path), 'utf8'), 'x');
  });
}

test('a partial chunk publication reports exact retained paths without claiming the index was published', t => {
  const f = fixture(t), original = fs.openSync;
  fs.openSync = function(path, ...args) {
    if (String(path).endsWith('/manifest-chunk-1.json')) throw Object.assign(new Error('injected write refusal'), { code: 'EIO' });
    return original.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  let failure;
  try { assert.throws(() => f.copy(), error => { failure = error; return true; }); }
  finally { fs.openSync = original; syncBuiltinESMExports(); }
  assert.equal(failure.quarantineManifestPublished, false);
  assert.equal(failure.quarantineManifestWriteAttempted, true);
  assert.equal(failure.quarantineManifestWriteResultUnknown, true);
  assert.deepEqual(failure.quarantineManifestPublishedPaths, [join(failure.quarantinePath, 'manifest-chunk-0.json')]);
  assert.equal(failure.quarantineManifestFailedPath, join(failure.quarantinePath, 'manifest-chunk-1.json'));
  assert.equal(fs.existsSync(failure.quarantineManifestPath), false);
  const artifacts = createCanonicalArtifacts(plan);
  recordCanonicalFailureEffects(artifacts, failure);
  assert.deepEqual(artifacts.quarantineManifestPublishedPaths, failure.quarantineManifestPublishedPaths);
  assert.equal(artifacts.quarantineManifestFailedPath, failure.quarantineManifestFailedPath);
  assert.equal(artifacts.quarantineManifestPublished, false);
  assert.equal(artifacts.quarantineManifestWriteResultUnknown, true);
  const lock = acquireDirectoryLock(join(f.storage, 'canonical.lock'));
  const wrapped = new CanonicalSyncError('blocked-after-recovery', { cause: failure.message }, failure);
  assert.throws(() => finishCanonicalOperation(lock, { error: wrapped, artifacts }), error => {
    assert.equal(error, wrapped);
    assert.equal(fs.existsSync(lock.path), false);
    const exact = JSON.parse(formatRetainedOperation(error));
    assert.equal(exact.effectsRetained, true);
    assert.equal(exact.operationCompleted, false);
    assert.deepEqual(exact.artifacts.quarantineManifestPublishedPaths, failure.quarantineManifestPublishedPaths);
    assert.equal(exact.artifacts.quarantineManifestFailedPath, failure.quarantineManifestFailedPath);
    const bounded = JSON.parse(formatRetainedOperation({ ...error, operationArtifacts: {
      ...error.operationArtifacts, recoveryObjectOids: Array(10_000).fill('a'.repeat(64)),
    } }));
    assert.equal(bounded.boundedProjection, true);
    assert.deepEqual(bounded.artifacts.quarantineManifestPublishedPaths, failure.quarantineManifestPublishedPaths);
    assert.equal(bounded.artifacts.quarantineManifestFailedPath, failure.quarantineManifestFailedPath);
    return true;
  });
  for (const [slot, entry] of entries.entries()) {
    assert.equal(fs.readFileSync(join(f.source, entry.path), 'utf8'), 'x');
    assert.equal(fs.readFileSync(join(failure.quarantinePath, String(slot)), 'utf8'), 'x');
  }
});

test('a later verification failure preserves every previously observed quarantine publication fact', t => {
  const f = fixture(t), receipt = f.copy(), artifacts = createCanonicalArtifacts(plan);
  const known = { quarantinePath: receipt.path, quarantineManifestPath: receipt.manifestPath,
    quarantineManifestPublished: true, quarantineManifestPublishedPaths: receipt.manifestPublishedPaths,
    quarantineManifestWriteAttempted: true, quarantineManifestWriteResultUnknown: false,
    quarantineEntryCount: receipt.copied.length, copiedBytes: receipt.copiedBytes,
    quarantineCopyResultUnknown: false, quarantineFailedSlot: null };
  Object.assign(artifacts, known);
  const target = receipt.manifestPublishedPaths.at(-2), bytes = fs.readFileSync(target);
  bytes[0] ^= 1; fs.writeFileSync(target, bytes);
  let failure;
  assert.throws(() => receipt.verify(), error => { failure = error; return true; });
  recordCanonicalFailureEffects(artifacts, failure);
  for (const [key, value] of Object.entries(known)) assert.deepEqual(artifacts[key], value, key);
  assert.equal(artifacts.quarantineManifestFailedPath, target);
  assert.equal(artifacts.effectsRetained, true);
});
