/** Bounded, stable filesystem reads and manifests for quarantine-only cleanup. */
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readlinkSync, readSync,
} from 'node:fs';
import { join } from 'node:path';

const BUFFER_SIZE = 64 * 1024;
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
export function strictCleanupStat(path, label) {
  let result;
  try { result = lstatSync(path, { bigint: true }); }
  catch (error) { fail(`blocked-${label}`, `${label} cannot be observed: ${error.code ?? 'error'}`); }
  return result;
}
export function sameCleanupNode(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
export function boundedDirectoryEntries(path, ceiling, label) {
  if (!Number.isSafeInteger(ceiling) || ceiling < 0)
    fail('blocked-cleanup-manifest', `${label} directory ceiling is invalid`);
  const directory = opendirSync(path), entries = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (entries.length >= ceiling)
        fail('blocked-cleanup-manifest', `${label} directory entry ceiling exceeded`);
      if (!entry.name || entry.name === '.' || entry.name === '..')
        fail('blocked-cleanup-manifest', `${label} path is unsafe`);
      entries.push(entry);
    }
  } finally { directory.closeSync(); }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}
export function readBoundedStableFile(path, byteCeiling, label) {
  if (!Number.isSafeInteger(byteCeiling) || byteCeiling < 1)
    fail(`blocked-${label}`, `${label} byte ceiling is invalid`);
  const before = strictCleanupStat(path, label);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || before.size > BigInt(byteCeiling)) fail(`blocked-${label}`, `${label} is unsafe or oversized`);
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK
      | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameCleanupNode(before, opened)) fail(`blocked-${label}`, `${label} identity changed`);
    const chunks = []; let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(BUFFER_SIZE, byteCeiling - total + 1));
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > byteCeiling) fail(`blocked-${label}`, `${label} byte ceiling exceeded`);
      chunks.push(buffer.subarray(0, count));
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!sameCleanupNode(opened, afterDescriptor) || !sameCleanupNode(afterDescriptor, afterPath))
      fail(`blocked-${label}`, `${label} changed while read`);
    return Buffer.concat(chunks, total);
  } finally { if (descriptor !== null) closeSync(descriptor); }
}
function frame(hash, value) {
  const bytes = Buffer.from(value);
  hash.update(String(bytes.length)).update(':').update(bytes).update(',');
}
function streamManifestFile(path, before, hash, budget) {
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK
      | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameCleanupNode(before, opened))
      fail('blocked-cleanup-manifest', 'cleanup file identity is unsafe');
    const buffer = Buffer.allocUnsafe(BUFFER_SIZE);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      budget.bytes += count;
      if (!Number.isSafeInteger(budget.bytes) || budget.bytes > budget.byteCeiling)
        fail('blocked-cleanup-manifest', 'cleanup manifest byte ceiling exceeded');
      hash.update(buffer.subarray(0, count));
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!sameCleanupNode(opened, afterDescriptor) || !sameCleanupNode(afterDescriptor, afterPath))
      fail('blocked-cleanup-manifest', 'cleanup file changed during hashing');
  } finally { if (descriptor !== null) closeSync(descriptor); }
}
export function observeQuarantineManifest(root, { byteCeiling, entryCeiling }) {
  if (!Number.isSafeInteger(byteCeiling) || byteCeiling < 1
    || !Number.isSafeInteger(entryCeiling) || entryCeiling < 1)
    fail('blocked-cleanup-manifest', 'cleanup manifest ceilings are invalid');
  const hash = createHash('sha256'), budget = { bytes: 0, entries: 0,
    byteCeiling, entryCeiling };
  hash.update('agentic-os/quarantine-manifest/v1\0');
  const visit = (path, relativePath) => {
    const before = strictCleanupStat(path, 'cleanup-manifest');
    budget.entries += 1;
    if (!Number.isSafeInteger(budget.entries) || budget.entries > budget.entryCeiling)
      fail('blocked-cleanup-manifest', 'cleanup manifest entry ceiling exceeded');
    const mode = (before.mode & 0o7777n).toString(8);
    if (before.isDirectory() && !before.isSymbolicLink()) {
      frame(hash, 'directory'); frame(hash, relativePath); frame(hash, mode);
      for (const entry of boundedDirectoryEntries(path,
        budget.entryCeiling - budget.entries, 'cleanup manifest'))
        visit(join(path, entry.name), relativePath ? `${relativePath}/${entry.name}` : entry.name);
      const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
      if (!sameCleanupNode(before, after))
        fail('blocked-cleanup-manifest', 'cleanup directory changed during hashing');
    } else if (before.isSymbolicLink() && before.nlink === 1n) {
      const target = readlinkSync(path, { encoding: 'buffer' });
      budget.bytes += target.length;
      if (budget.bytes > budget.byteCeiling)
        fail('blocked-cleanup-manifest', 'cleanup manifest byte ceiling exceeded');
      frame(hash, 'symlink'); frame(hash, relativePath); frame(hash, mode); frame(hash, target);
      const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
      if (!sameCleanupNode(before, after))
        fail('blocked-cleanup-manifest', 'cleanup symlink changed during hashing');
    } else if (before.isFile() && before.nlink === 1n) {
      frame(hash, 'file'); frame(hash, relativePath); frame(hash, mode); frame(hash, String(before.size));
      streamManifestFile(path, before, hash, budget);
    } else fail('blocked-cleanup-manifest', 'cleanup manifest contains unsupported bytes');
  };
  visit(root, '');
  return Object.freeze({ digest: hash.digest('hex'), bytes: budget.bytes, entries: budget.entries });
}
