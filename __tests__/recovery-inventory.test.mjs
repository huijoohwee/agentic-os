import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RECOVERY_INVENTORY_ALGORITHM,
  RECOVERY_INVENTORY_SCHEMA,
  collectRecoveryInventory,
} from '../src/recovery-inventory.mjs';

const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const CANONICAL_REF = 'refs/heads/main';
const DIGEST_KEYS = Object.freeze([
  'inventoryAlgorithm', 'inventoryEntries', 'indexInventoryDigest',
  'trackedInventoryDigest', 'visibleUntrackedInventoryDigest',
  'hiddenInventoryDigest', 'ignoredRuntimeInventoryDigest', 'contentInventoryDigest',
]);

function git(root, args, options = {}) {
  return execFileSync(REAL_GIT, args, { cwd: root, encoding: options.encoding, stdio:
    options.encoding ? ['ignore', 'pipe', 'pipe'] : 'ignore' });
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-recovery-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  return root;
}

function commit(root, message = 'fixture', { empty = false } = {}) {
  if (!empty) git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', ...(empty ? ['--allow-empty'] : []), '--message', message]);
}

function inventory(root) {
  return collectRecoveryInventory({ cwd: root, canonicalRef: CANONICAL_REF });
}

function projection(value) {
  return Object.fromEntries(DIGEST_KEYS.map((key) => [key, value[key]]));
}

function complexRepository(t, reverse = false) {
  const root = repository(t);
  const files = [
    ['.gitignore', 'runtime/\n'],
    ['tracked.txt', 'tracked\n'],
    ['missing.txt', 'remove after commit\n'],
    ['assume.txt', 'assume unchanged\n'],
    ['skip.txt', 'skip worktree\n'],
  ];
  for (const [path, bytes] of reverse ? files.toReversed() : files) {
    writeFileSync(join(root, path), bytes);
  }
  symlinkSync('tracked.txt', join(root, 'link'));
  commit(root);
  unlinkSync(join(root, 'missing.txt'));
  writeFileSync(join(root, 'visible\n\tname'), 'visible\n');
  mkdirSync(join(root, 'runtime'));
  writeFileSync(join(root, 'runtime', 'state.bin'), Buffer.from([0, 1, 2, 255]));
  git(root, ['update-index', '--assume-unchanged', 'assume.txt']);
  git(root, ['update-index', '--skip-worktree', 'skip.txt']);
  return root;
}

test('empty manifests have stable algorithm-framed golden digests and perform no index write', (t) => {
  const root = repository(t);
  commit(root, 'empty', { empty: true });
  const indexBefore = readFileSync(join(root, '.git', 'index'));
  const observed = inventory(root);
  assert.equal(observed.schema, RECOVERY_INVENTORY_SCHEMA);
  assert.equal(observed.inventoryAlgorithm, RECOVERY_INVENTORY_ALGORITHM);
  assert.deepEqual(observed.inventoryEntries, {
    index: 0, tracked: 0, visibleUntracked: 0, hidden: 0, ignoredRuntime: 0, content: 0,
  });
  assert.deepEqual({
    index: observed.indexInventoryDigest,
    tracked: observed.trackedInventoryDigest,
    visible: observed.visibleUntrackedInventoryDigest,
    hidden: observed.hiddenInventoryDigest,
    ignored: observed.ignoredRuntimeInventoryDigest,
    content: observed.contentInventoryDigest,
  }, {
    index: '273e30cb65464663d936dde6d0927fcbc4a55b62ed2f31d08485bf4f7d6886b0',
    tracked: '44cddbd07568f13b94d44193a92a5b46cc0ba822af402b827e9e95ab71303239',
    visible: '9cabce68d622856dbc962f00bb7b2277ea59fde8c8eafe5ae18efe8d2253012f',
    hidden: '460c3c8b6af0fb2c924d20be4eb75e92f8d4caf7bf403ac3c3bbc152d8f91842',
    ignored: '3b3dcfef49a2d9e703c38acfd1c278080d34c9a103f02ae4dfaf22086c529fa2',
    content: '26029d32e0f990c2568b7536024a32bae623f2b08638ca74af8b50d3c2bab6dd',
  });
  assert.deepEqual(readFileSync(join(root, '.git', 'index')), indexBefore);
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.inventoryEntries), true);
});

test('one executable tracked file and one hidden flag match concrete record test vectors', (t) => {
  const root = repository(t);
  writeFileSync(join(root, 'one.bin'), Buffer.from([0, 1, 2, 255]));
  chmodSync(join(root, 'one.bin'), 0o755);
  commit(root, 'single');
  git(root, ['update-index', '--assume-unchanged', 'one.bin']);
  const observed = inventory(root);
  assert.deepEqual(observed.inventoryEntries, {
    index: 1, tracked: 1, visibleUntracked: 0, hidden: 1, ignoredRuntime: 0, content: 1,
  });
  assert.equal(observed.indexInventoryDigest,
    '70019f7cddd25489b04a3285007041a3e66c6375a230997eda264c5f1a9ca133');
  assert.equal(observed.trackedInventoryDigest,
    '73ceb03ca7760db303d226afc962862bbc5130f0f8dee00fa5af4c50752211ce');
  assert.equal(observed.hiddenInventoryDigest,
    'ef3b5463511e0b5c9d0247dc77852c0aebefec829a09921e4799b05b85f6c3c4');
  assert.equal(observed.contentInventoryDigest,
    '19fe515ddec049aabd35d75f5215aa0db36ed3d438b61c8fdcc7340e6810821d');
});

test('real repositories are raw-path deterministic and bind absence, symlinks, categories, and flags',
  (t) => {
    const left = complexRepository(t);
    const right = complexRepository(t, true);
    const first = inventory(left);
    assert.deepEqual(projection(inventory(left)), projection(first));
    assert.deepEqual(projection(inventory(right)), projection(first));
    assert.deepEqual(first.inventoryEntries, {
      index: 6, tracked: 6, visibleUntracked: 1, hidden: 2, ignoredRuntime: 1, content: 8,
    });
    assert.deepEqual({
      index: first.indexInventoryDigest,
      tracked: first.trackedInventoryDigest,
      visible: first.visibleUntrackedInventoryDigest,
      hidden: first.hiddenInventoryDigest,
      ignored: first.ignoredRuntimeInventoryDigest,
      content: first.contentInventoryDigest,
    }, {
      index: '401ae777b97989abc85deb26760104806da8daab49055be441b408fbe9b2fa28',
      tracked: 'ecd0d2701d308a8408f3a3decdd44dae299c5318720335a9cda5c89c365ae44f',
      visible: '75f3448bb046e4c181ecb8e3f52ef2e70cd744ad65186d5a9ffbbf45460d315b',
      hidden: '35f99849a548fa05603b30989b1ab1739951412525d8220df1b6a02f7ad96c6b',
      ignored: '705fe75965f5efa29c3df58060faafbebd6be0d4483284dfd80ae97cd893eb01',
      content: '2d53e51d12ac94bd5ce243324802f22af0f811512c2c02187e912580eecaf85c',
    });

    const absentDigest = first.trackedInventoryDigest;
    writeFileSync(join(left, 'missing.txt'), Buffer.alloc(0));
    assert.notEqual(inventory(left).trackedInventoryDigest, absentDigest,
      'absent is distinct from an empty tracked file');
    const symlinkDigest = inventory(left).trackedInventoryDigest;
    unlinkSync(join(left, 'link'));
    symlinkSync('other-target', join(left, 'link'));
    assert.notEqual(inventory(left).trackedInventoryDigest, symlinkDigest,
      'raw symlink target bytes are content');
  });

test('unsupported filesystem kinds fail closed', (t) => {
  const root = repository(t);
  commit(root, 'empty', { empty: true });
  const head = git(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${head},gitlink`]);
  assert.throws(() => inventory(root), /tracked index mode is unsupported/u);
});

test('a symlinked tracked parent records the descendant absent without hashing outside bytes', (t) => {
  const root = repository(t);
  mkdirSync(join(root, 'tracked-parent'));
  writeFileSync(join(root, 'tracked-parent', 'child.txt'), 'inside\n');
  commit(root);
  rmSync(join(root, 'tracked-parent'), { recursive: true, force: true });
  const outside = mkdtempSync(join(tmpdir(), 'agentic-os-recovery-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'child.txt'), 'outside-before\n');
  symlinkSync(outside, join(root, 'tracked-parent'));
  const before = inventory(root);
  writeFileSync(join(outside, 'child.txt'), 'outside-after\n');
  const after = inventory(root);
  assert.deepEqual(projection(after), projection(before));
  assert.equal(before.inventoryEntries.tracked, 1);
  assert.equal(before.inventoryEntries.visibleUntracked, 1);
});

test('portable inventory rejects a backslash path instead of treating it as a separator later', (t) => {
  const root = repository(t);
  writeFileSync(join(root, 'back\\slash.txt'), 'tracked\n');
  commit(root);
  assert.throws(() => inventory(root), /unsafe repository-relative path/u);
});

test('a mid-collection ignored-byte change fails although porcelain omits ignored paths', (t) => {
  const root = repository(t);
  writeFileSync(join(root, '.gitignore'), 'runtime/\nshim/\n');
  commit(root);
  mkdirSync(join(root, 'runtime'));
  const target = join(root, 'runtime', 'state.txt');
  writeFileSync(target, 'before\n');
  const porcelain = () => git(root, [
    'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no', '--no-renames', '--',
  ], { encoding: 'buffer' });
  const shim = join(root, 'shim');
  mkdirSync(shim);
  const wrapper = join(shim, 'git');
  writeFileSync(wrapper, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'ls-files' && args.includes('--stage')) {
  let count = 0;
  try { count = Number(readFileSync(process.env.RECOVERY_RACE_COUNT, 'utf8')); } catch {}
  count += 1;
  writeFileSync(process.env.RECOVERY_RACE_COUNT, String(count));
  if (count === 2) writeFileSync(process.env.RECOVERY_RACE_TARGET, 'after\\n');
}
const child = spawnSync(process.env.RECOVERY_REAL_GIT, args, {
  env: { ...process.env, PATH: process.env.RECOVERY_ORIGINAL_PATH }, stdio: 'inherit',
});
process.exit(child.status ?? 1);
`);
  chmodSync(wrapper, 0o755);
  const original = process.env.PATH;
  Object.assign(process.env, {
    PATH: `${shim}:${original}`,
    RECOVERY_ORIGINAL_PATH: original,
    RECOVERY_REAL_GIT: REAL_GIT,
    RECOVERY_RACE_COUNT: join(root, '.git', 'race-count'),
    RECOVERY_RACE_TARGET: target,
  });
  t.after(() => {
    process.env.PATH = original;
    for (const key of [
      'RECOVERY_ORIGINAL_PATH', 'RECOVERY_REAL_GIT', 'RECOVERY_RACE_COUNT',
      'RECOVERY_RACE_TARGET',
    ]) delete process.env[key];
  });
  const statusBefore = porcelain();
  assert.throws(() => inventory(root), (error) =>
    error?.reason === 'blocked-recovery-inventory-race');
  assert.deepEqual(porcelain(), statusBefore, 'ignored byte changes do not alter porcelain-v2');
});
