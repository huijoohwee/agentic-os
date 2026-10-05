import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumerSnapshotReader } from '../bin/agentic-os-validation-inputs.mjs';

const chunkBytes = 256 * 1024;
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'validation-source-economy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture');
  return { root, git };
}
function countStreamAllocations(run) {
  const original = Buffer.alloc; let allocations = 0;
  Buffer.alloc = function (size, ...args) {
    if (size === chunkBytes) allocations++;
    return original.call(this, size, ...args);
  };
  try { return { value: run(), allocations }; } finally { Buffer.alloc = original; }
}

test('many files share bounded scratch space while preserving complete binary hashes', t => {
  const { root, git } = fixture(t), content = new Map();
  for (let i = 0; i < 96; i++) content.set(`small-${i}.txt`, Buffer.from(`file ${i}\n`));
  const large = Buffer.alloc(chunkBytes * 3 + 17);
  for (let i = 0; i < large.length; i++) large[i] = i % 251;
  content.set('large.bin', large); content.set('after-large.bin', Buffer.from([0, 255, 1, 0, 128]));
  for (const [path, bytes] of content) writeFileSync(join(root, path), bytes);
  const observe = consumerSnapshotReader({ root, base: 'HEAD' });
  const cold = countStreamAllocations(observe);
  assert.equal(cold.allocations, 1, 'allocation count stays constant as file count and length grow');
  assert.equal(cold.value.after.size, content.size);
  assert.equal(cold.value.observedBytes, [...content.values()].reduce((sum, bytes) => sum + bytes.length, 0));
  for (const [path, bytes] of content) assert.equal(cold.value.after.get(path).oid, blob(bytes), path);
  const warm = countStreamAllocations(observe);
  assert.equal(warm.allocations, 0);
  assert.equal(warm.value.identity.sourceDigest, cold.value.identity.sourceDigest);

  // Same-length changes must be rehashed through the scratch buffer, never reused
  // as source evidence merely because the allocation or content length matches.
  const edited = Buffer.from(large); edited[chunkBytes + 1] ^= 255;
  writeFileSync(join(root, 'large.bin'), edited);
  const changed = countStreamAllocations(observe);
  assert.equal(changed.allocations, 0);
  assert.equal(changed.value.after.get('large.bin').oid, blob(edited));
  assert.notEqual(changed.value.identity.sourceDigest, cold.value.identity.sourceDigest);
  assert.equal(cold.value.after.get('large.bin').oid, blob(large), 'earlier snapshots retain their bytes identity');
  const independent = countStreamAllocations(() => consumerSnapshotReader({ root, base: 'HEAD' })());
  assert.equal(independent.allocations, 1, 'readers retain independent bounded scratch storage');
  assert.equal(independent.value.identity.sourceDigest, changed.value.identity.sourceDigest);
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'files');
  assert.deepEqual(consumerSnapshotReader({ root, base: 'HEAD', committed: true })().changed, []);
});

test('empty and symlink-only sources never allocate regular-file scratch storage', t => {
  const { root } = fixture(t), observe = consumerSnapshotReader({ root, base: 'HEAD' });
  const empty = countStreamAllocations(observe);
  assert.equal(empty.allocations, 0); assert.equal(empty.value.observedBytes, 0);
  symlinkSync('missing-target', join(root, 'link'));
  const linked = countStreamAllocations(observe);
  assert.equal(linked.allocations, 0);
  assert.deepEqual(linked.value.after.get('link'), { mode: '120000', oid: blob(Buffer.from('missing-target')),
    digest: createHash('sha256').update('missing-target').digest('hex') });
  writeFileSync(join(root, 'regular'), 'regular bytes');
  assert.equal(countStreamAllocations(observe).allocations, 1, 'first regular read allocates lazily');
});

test('consumer cache evicts retired and missing tracked files while retaining warm identities', t => {
  const { root, git } = fixture(t);
  for (const name of ['retained', 'tracked', 'transient']) writeFileSync(join(root, name), name);
  git('add', 'retained', 'tracked');
  const observe = consumerSnapshotReader({ root, base: 'HEAD' }), original = Map.prototype.set;
  let cache, first;
  Map.prototype.set = function (key, value) {
    if (key === 'transient' && value?.identity && value.file?.digest) cache = this;
    return original.call(this, key, value);
  };
  try { first = observe(); } finally { Map.prototype.set = original; }
  assert.ok(cache instanceof Map);
  rmSync(join(root, 'tracked')); rmSync(join(root, 'transient'));
  const second = observe();
  assert.equal(second.after.get('retained'), first.after.get('retained'));
  assert.deepEqual([...cache.keys()], ['retained']);
  assert.equal(first.after.size, 3, 'earlier snapshot survives cache eviction');
});

test('consumer immutable tree retention is bounded while current revisions stay reusable', t => {
  const { root, git } = fixture(t), revision = git('rev-parse', 'HEAD');
  const observe = consumerSnapshotReader({ root, base: 'HEAD' }), first = observe();
  assert.equal(observe().before, first.before);
  for (let i = 0; i < 4; i++) {
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', `revision ${i}`);
    observe();
  }
  git('reset', '--soft', revision);
  const revisited = observe();
  assert.notEqual(revisited.before, first.before, 'old immutable tree is rebuilt after retention bound');
  assert.deepEqual(revisited.before, first.before);
  assert.equal(observe().before, revisited.before, 'newest immutable tree remains reusable');
});
