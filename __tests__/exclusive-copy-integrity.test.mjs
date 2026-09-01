import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync,
  symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertPathIdentity, copyRegularFileExclusive, copySymlinkExclusive,
  writePrivateFileExclusive,
} from '../src/file-integrity.mjs';

const temporary = (t) => {
  const path = mkdtempSync(join(tmpdir(), 'agentic-os-exclusive-copy-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};

test('regular quarantine copies are distinct, bounded, and leave source identity untouched', (t) => {
  const root = temporary(t);
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  writeFileSync(source, Buffer.from('owned dirty bytes'));
  chmodSync(source, 0o751);
  const before = lstatSync(source, { bigint: true });

  const copied = copyRegularFileExclusive(source, destination, {
    maxBytes: 64, label: 'test quarantine copy',
  });

  const after = lstatSync(source, { bigint: true });
  assert.deepEqual(readFileSync(destination), Buffer.from('owned dirty bytes'));
  assert.equal(copied.bytes, 17);
  assert.equal(copied.source.dev, before.dev);
  assert.equal(copied.source.ino, before.ino);
  assert.equal(after.nlink, before.nlink);
  assert.notEqual(copied.destination.ino, copied.source.ino);
  assert.equal(copied.destination.mode & 0o7777n, 0o751n);
  assertPathIdentity(copied.source, 'copied source');
  assertPathIdentity(copied.destination, 'copied destination');
});

test('symlink quarantine copies preserve the target while leaving the source untouched', (t) => {
  const root = temporary(t);
  const source = join(root, 'source-link');
  const destination = join(root, 'destination-link');
  symlinkSync(Buffer.from('../relative target'), source);
  const before = lstatSync(source, { bigint: true });

  const copied = copySymlinkExclusive(source, destination, {
    maxBytes: 64, label: 'test quarantine symlink',
  });

  assert.equal(readlinkSync(source), '../relative target');
  assert.equal(readlinkSync(destination), '../relative target');
  assert.equal(copied.bytes, 18);
  assert.equal(copied.source.ino, before.ino);
  assert.notEqual(copied.destination.ino, copied.source.ino);
  assertPathIdentity(copied.source, 'copied symlink source');
  assertPathIdentity(copied.destination, 'copied symlink destination');
});

test('private manifest publication is exclusive and descriptor-bound', (t) => {
  const root = temporary(t);
  const destination = join(root, 'manifest.json');
  const identity = writePrivateFileExclusive(destination, Buffer.from('{"ok":true}'), {
    maxBytes: 64, mode: 0o600, label: 'test quarantine manifest',
  });
  assert.equal(readFileSync(destination, 'utf8'), '{"ok":true}');
  assert.equal(identity.nlink, 1n);
  assert.equal(identity.mode & 0o7777n, 0o600n);
  assertPathIdentity(identity, 'quarantine manifest');
  assert.throws(() => writePrivateFileExclusive(destination, Buffer.from('replacement'), {
    maxBytes: 64, mode: 0o600, label: 'test quarantine manifest',
  }), (error) => error.code === 'EEXIST' && readFileSync(destination, 'utf8') === '{"ok":true}');
});
