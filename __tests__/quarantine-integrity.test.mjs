import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  git, quarantineWorktreeEntries, retireCleanProjectionUnderExclusiveContract,
} from '../src/git.mjs';

const LIMITS = Object.freeze({
  maxEntryBytes: 1_024, maxAggregateBytes: 4_096, maxManifestBytes: 1_024,
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-quarantine-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(['init', '--quiet', '--initial-branch=main'], { cwd: root });
  writeFileSync(join(root, 'first'), 'first owned bytes\n');
  writeFileSync(join(root, 'second'), 'second owned bytes\n');
  return root;
}

test('an occupied quarantine slot is retained without overwriting or moving another source', (t) => {
  const root = fixture(t);
  let failure;
  assert.throws(() => quarantineWorktreeEntries('quarantine-slot', [
    { path: 'first' }, { path: 'second' },
  ], (_entry, slot, path) => {
    if (slot === '0') writeFileSync(join(path, '1'), 'foreign slot bytes\n', { flag: 'wx' });
  }, root, null, LIMITS), (error) => {
    failure = error;
    return error.reason === 'blocked-quarantine-tree-race';
  });
  assert.equal(failure.quarantineSlot, '0');
  assert.ok(failure.treeDetail.actualPaths.includes(join(failure.quarantinePath, '1')));
  assert.equal(readFileSync(join(failure.quarantinePath, '0'), 'utf8'), 'first owned bytes\n');
  assert.equal(readFileSync(join(failure.quarantinePath, '1'), 'utf8'), 'foreign slot bytes\n');
  assert.equal(readFileSync(join(root, 'first'), 'utf8'), 'first owned bytes\n');
  assert.equal(readFileSync(join(root, 'second'), 'utf8'), 'second owned bytes\n');
  assert.equal(existsSync(join(failure.quarantinePath, '2')), false);
  assert.equal(failure.quarantineEntryCount, 1);
  assert.equal(failure.copiedBytes, Buffer.byteLength('first owned bytes\n'));
  assert.equal(failure.quarantineFailedSlot, '0');
  assert.equal(failure.quarantineCopyResultUnknown, false);
  assert.equal(failure.quarantineManifestPublished, false);
  assert.equal(failure.quarantineManifestWriteAttempted, false);
});

test('a replacement quarantine root is detected after verification and original bytes remain', (t) => {
  const root = fixture(t);
  let displaced;
  let failure;
  assert.throws(() => quarantineWorktreeEntries('quarantine-root', [
    { path: 'first' }, { path: 'second' },
  ], (_entry, slot, path) => {
    if (slot !== '0') return;
    displaced = `${path}-displaced`;
    renameSync(path, displaced);
    mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(path, 'foreign'), 'replacement root bytes\n');
  }, root, null, LIMITS), (error) => {
    failure = error;
    return error.reason === 'blocked-quarantine-root-race';
  });
  assert.equal(`${failure.quarantinePath}-displaced`, displaced);
  assert.equal(readFileSync(join(displaced, '0'), 'utf8'), 'first owned bytes\n');
  assert.equal(readFileSync(join(failure.quarantinePath, 'foreign'), 'utf8'),
    'replacement root bytes\n');
  assert.equal(readFileSync(join(root, 'first'), 'utf8'), 'first owned bytes\n');
  assert.equal(readFileSync(join(root, 'second'), 'utf8'), 'second owned bytes\n');
  assert.equal(existsSync(join(failure.quarantinePath, '1')), false);
});

test('no-replace quarantine publication preserves a symlink node and target', (t) => {
  const root = fixture(t);
  symlinkSync('target bytes', join(root, 'link'));
  const quarantine = quarantineWorktreeEntries('quarantine-symlink', [{ path: 'link' }],
    (_entry, slot, path) => {
      assert.equal(lstatSync(join(path, slot)).isSymbolicLink(), true);
      assert.equal(readlinkSync(join(path, slot)), 'target bytes');
    }, root, null, LIMITS);
  assert.equal(lstatSync(join(root, 'link')).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(root, 'link')), 'target bytes');
  assert.equal(readlinkSync(join(quarantine.path, '0')), 'target bytes');
  assert.equal(quarantine.copyOnly, true);
  assert.equal(quarantine.sourceRetired, false);
  quarantine.verify();
});

test('clean projection retirement is distinct and names only an external exclusive assertion', (t) => {
  const root = fixture(t);
  const manifest = Buffer.from('{"schema":"fixture"}\n');
  const quarantine = quarantineWorktreeEntries('quarantine-clean', [
    { path: 'first' }, { path: 'second' },
  ], () => {}, root, manifest, LIMITS);
  quarantine.verify();
  assert.equal(readFileSync(join(root, 'first'), 'utf8'), 'first owned bytes\n');
  const exclusiveContract = `agentic-os:canonical-sync:exclusive:${'a'.repeat(64)}`;
  const retired = retireCleanProjectionUnderExclusiveContract(quarantine, {
    exclusiveContract, inventoryCount: 0,
  });
  assert.equal(retired.schema, 'agentic-os/clean-projection-retirement/v1');
  assert.equal(retired.conditionalExternalExclusiveContract, exclusiveContract);
  assert.equal(retired.exclusivityBasis, 'external-assertion');
  assert.equal(retired.operatingSystemExclusivityProven, false);
  assert.equal(retired.sourceRetired, true);
  assert.equal(retired.retiredEntryCount, 2);
  assert.equal(existsSync(join(root, 'first')), false);
  assert.equal(existsSync(join(root, 'second')), false);
  assert.equal(readFileSync(join(quarantine.path, '0'), 'utf8'), 'first owned bytes\n');
  assert.equal(readFileSync(quarantine.manifestPath, 'utf8'), manifest.toString('utf8'));
  quarantine.verify();
});
