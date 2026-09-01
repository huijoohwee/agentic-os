/** Identity-bound operation locks and exact raw tracked-byte comparison. */

import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readlinkSync, readSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeSync,
} from 'node:fs';
import { readBoundedFile } from './catalog-input.mjs';
import { isAbsolute, join, relative, sep } from 'node:path';
export { gitBlobOid, rawTrackedFileMatches, TRACKED_FILE_LIMITS } from './git-tracked.mjs';

function sameNode(left, right) {
  return Boolean(right) && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function identitySnapshot(stat, path) {
  return Object.freeze({
    path, dev: stat.dev, ino: stat.ino, mode: stat.mode, nlink: stat.nlink,
    size: stat.size, uid: stat.uid, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs,
    kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file'
      : stat.isSymbolicLink() ? 'symlink' : 'other',
  });
}
/** Capture one direct filesystem entry without following it. */
export function pathIdentity(path, label = 'filesystem entry') {
  const metadata = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!metadata) throw new Error(`${label} is missing`);
  const identity = identitySnapshot(metadata, path);
  if (identity.kind === 'other') throw new Error(`${label} has an unsupported type`);
  return identity;
}

export function assertPathIdentity(expected, label = 'filesystem entry') {
  const actual = pathIdentity(expected.path, label);
  if (!sameNode(expected, actual)) throw new Error(`${label} identity changed`);
  return actual;
}

export function unlinkExactPath(expected, label = 'filesystem entry') {
  assertPathIdentity(expected, label);
  unlinkSync(expected.path);
}
function assertCopyLimit(maxBytes, label) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError(`${label} byte limit must be a nonnegative safe integer`);
}
function writeAll(descriptor, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error('exclusive copy made no write progress');
    offset += written;
  }
}
function assertOpenedPath(opened, path, label, { singleLink = false } = {}) {
  const atPath = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!opened.isFile() || !sameNode(opened, atPath) || (singleLink && opened.nlink !== 1n))
    throw new Error(`${label} identity changed`);
  return identitySnapshot(opened, path);
}
/** Copy one stable regular file to a new, distinct, single-link pathname. */
export function copyRegularFileExclusive(sourcePath, destinationPath, {
  maxBytes, label = 'exclusive regular-file copy',
}) {
  assertCopyLimit(maxBytes, label);
  let source = null, destination = null, total = 0;
  try {
    source = openSync(sourcePath, constants.O_RDONLY | constants.O_NONBLOCK
      | (constants.O_NOFOLLOW ?? 0));
    const sourceBefore = fstatSync(source, { bigint: true });
    if (!sourceBefore.isFile() || sourceBefore.size > BigInt(maxBytes))
      throw new Error(`${label} source must be a bounded regular file`);
    assertOpenedPath(sourceBefore, sourcePath, `${label} source`);
    destination = openSync(destinationPath, constants.O_WRONLY | constants.O_CREAT
      | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    const created = fstatSync(destination, { bigint: true });
    if (!created.isFile() || created.nlink !== 1n
      || created.dev === sourceBefore.dev && created.ino === sourceBefore.ino)
      throw new Error(`${label} destination is not a distinct single-link regular file`);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, maxBytes)));
    for (;;) {
      const count = readSync(source, buffer, 0, buffer.length, total);
      if (count === 0) break;
      if (count > maxBytes - total) throw new Error(`${label} byte limit exceeded`);
      writeAll(destination, buffer.subarray(0, count)); total += count;
    }
    if (BigInt(total) !== sourceBefore.size) throw new Error(`${label} source size changed`);
    fchmodSync(destination, Number(sourceBefore.mode & 0o7777n)); fsyncSync(destination);
    const sourceAfter = fstatSync(source, { bigint: true });
    const destinationAfter = fstatSync(destination, { bigint: true });
    const sourceIdentity = assertOpenedPath(sourceAfter, sourcePath, `${label} source`);
    const destinationIdentity = assertOpenedPath(
      destinationAfter, destinationPath, `${label} destination`, { singleLink: true });
    if (!sameNode(sourceBefore, sourceAfter) || destinationAfter.size !== sourceAfter.size
      || (destinationAfter.mode & 0o7777n) !== (sourceAfter.mode & 0o7777n)
      || destinationAfter.dev === sourceAfter.dev && destinationAfter.ino === sourceAfter.ino)
      throw new Error(`${label} source or destination identity changed`);
    return Object.freeze({ source: sourceIdentity, destination: destinationIdentity, bytes: total });
  } catch (error) {
    Object.assign(error, { sourcePath, destinationPath, copiedBytes: total }); throw error;
  } finally {
    if (destination !== null) closeSync(destination);
    if (source !== null) closeSync(source);
  }
}
/** Copy one stable symlink target to a new, distinct symlink pathname. */
export function copySymlinkExclusive(sourcePath, destinationPath, {
  maxBytes, label = 'exclusive symlink copy',
}) {
  assertCopyLimit(maxBytes, label);
  try {
    const before = lstatSync(sourcePath, { bigint: true, throwIfNoEntry: false });
    if (!before?.isSymbolicLink()) throw new Error(`${label} source must be a symlink`);
    const bytes = readlinkSync(sourcePath, { encoding: 'buffer' });
    if (bytes.length > maxBytes) throw new Error(`${label} byte limit exceeded`);
    if (!sameNode(before, lstatSync(sourcePath, { bigint: true, throwIfNoEntry: false })))
      throw new Error(`${label} source identity changed`);
    symlinkSync(bytes, destinationPath);
    const destination = lstatSync(destinationPath, { bigint: true, throwIfNoEntry: false });
    const source = lstatSync(sourcePath, { bigint: true, throwIfNoEntry: false });
    if (!destination?.isSymbolicLink() || !sameNode(before, source)
      || destination.dev === source.dev && destination.ino === source.ino
      || !bytes.equals(readlinkSync(destinationPath, { encoding: 'buffer' }))
      || !sameNode(destination,
        lstatSync(destinationPath, { bigint: true, throwIfNoEntry: false })))
      throw new Error(`${label} source or destination identity changed`);
    return Object.freeze({ source: identitySnapshot(source, sourcePath),
      destination: identitySnapshot(destination, destinationPath), bytes: bytes.length });
  } catch (error) {
    Object.assign(error, { sourcePath, destinationPath }); throw error;
  }
}
/** Write one bounded private file to a new, descriptor-bound pathname. */
export function writePrivateFileExclusive(destinationPath, bytes, {
  maxBytes, mode = 0o600, label = 'exclusive private file',
}) {
  assertCopyLimit(maxBytes, label);
  if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes)
    throw new Error(`${label} bytes must be a bounded Buffer`);
  let descriptor = null;
  try {
    descriptor = openSync(destinationPath, constants.O_WRONLY | constants.O_CREAT
      | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
    writeAll(descriptor, bytes); fchmodSync(descriptor, mode); fsyncSync(descriptor);
    const opened = fstatSync(descriptor, { bigint: true });
    if (opened.size !== BigInt(bytes.length)) throw new Error(`${label} size changed`);
    return assertOpenedPath(opened, destinationPath, label, { singleLink: true });
  } catch (error) {
    Object.assign(error, { destinationPath }); throw error;
  } finally { if (descriptor !== null) closeSync(descriptor); }
}

function sameOwnedEntry(expected, actual) {
  return Boolean(actual) && expected.path === actual.path && expected.kind === actual.kind
    && expected.dev === actual.dev && expected.ino === actual.ino
    && expected.mode === actual.mode && expected.uid === actual.uid
    && (expected.kind === 'directory' || expected.nlink === actual.nlink
      && expected.ctimeNs === actual.ctimeNs && expected.size === actual.size
      && expected.mtimeNs === actual.mtimeNs);
}

function exactTreeError(label, detail) {
  return Object.assign(new Error(`${label} contains unknown, missing, or replaced entries`), {
    code: 'ERR_EXACT_TREE_DRIFT', detail,
  });
}

function assertDescendants(root, paths, label) {
  if (new Set(paths).size !== paths.length) throw exactTreeError(label, { duplicate: true });
  for (const path of paths) {
    const suffix = relative(root.path, path);
    if (!suffix || isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`))
      throw exactTreeError(label, { outside: path });
  }
}

function scanTree(root, label) {
  const entries = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const identity = pathIdentity(path, label);
      entries.push(identity);
      if (identity.kind === 'directory') visit(path);
    }
  };
  assertPrivateDirectoryIdentity(root, label); visit(root.path);
  assertPrivateDirectoryIdentity(root, label);
  return entries;
}

/** Capture identities only when a private tree contains exactly the declared owned paths. */
export function captureExactTree(root, paths, label = 'private temporary tree') {
  assertDescendants(root, paths, label);
  const actual = scanTree(root, label);
  const expectedPaths = [...paths].sort();
  const actualPaths = actual.map(({ path }) => path).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths))
    throw exactTreeError(label, { expectedPaths, actualPaths });
  const byPath = new Map(actual.map((entry) => [entry.path, entry]));
  return Object.freeze(paths.map((path) => byPath.get(path)));
}

/** Delete only a previously captured exact tree; additive or replaced bytes are retained. */
export function removeExactTree(root, manifest, label = 'private temporary tree') {
  const paths = manifest.map(({ path }) => path);
  const actual = captureExactTree(root, paths, label);
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const changed = manifest.filter((entry) => !sameOwnedEntry(entry, actualByPath.get(entry.path)))
    .map(({ path }) => path);
  if (changed.length > 0) throw exactTreeError(label, { changed });
  const deepest = (left, right) => right.path.length - left.path.length;
  for (const entry of manifest.filter(({ kind }) => kind !== 'directory').sort(deepest)) {
    if (!sameOwnedEntry(entry, pathIdentity(entry.path, label)))
      throw exactTreeError(label, { changed: [entry.path] });
    unlinkSync(entry.path);
  }
  for (const entry of manifest.filter(({ kind }) => kind === 'directory').sort(deepest)) {
    const actualEntry = pathIdentity(entry.path, label);
    if (!sameOwnedEntry(entry, actualEntry))
      throw exactTreeError(label, { changed: [entry.path] });
    rmdirSync(entry.path);
  }
  assertPrivateDirectoryIdentity(root, label);
  rmdirSync(root.path);
  return true;
}

function ownedDirectoryIdentity(path, label, mode) {
  const metadata = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!metadata) return null;
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error(`${label} must be a direct directory`);
  if ((metadata.mode & 0o7777n) !== mode)
    throw new Error(`${label} mode must be 0${mode.toString(8)}`);
  if (typeof process.getuid === 'function' && metadata.uid !== BigInt(process.getuid()))
    throw new Error(`${label} must be owned by the current user`);
  return identitySnapshot(metadata, path);
}

/** Capture one direct, current-user-owned mode-0700 directory. */
export function privateDirectoryIdentity(path, label = 'private directory') {
  return ownedDirectoryIdentity(path, label, 0o700n);
}

export function legacyPrivateDirectoryIdentity(path, label = 'private directory') {
  return ownedDirectoryIdentity(path, label, 0o755n);
}

/** Tighten the exact opened legacy directory without following or adopting a replacement path. */
export function tightenLegacyPrivateDirectory(
  path, label = 'private directory', { onTightenAttempt = null, onTightened = null } = {},
) {
  if (onTightenAttempt !== null && typeof onTightenAttempt !== 'function')
    throw new TypeError('mode-tightening attempt callback must be a function');
  if (onTightened !== null && typeof onTightened !== 'function')
    throw new TypeError('mode-tightening effect callback must be a function');
  const expected = legacyPrivateDirectoryIdentity(path, label);
  if (!expected) throw new Error(`${label} is missing`);
  const flags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
    | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK;
  const descriptor = openSync(path, flags);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (opened.dev !== expected.dev || opened.ino !== expected.ino
        || opened.uid !== expected.uid || (opened.mode & 0o7777n) !== 0o755n)
      throw new Error(`${label} identity changed before mode tightening`);
    const effect = Object.freeze({ path, priorMode: 0o755, mode: 0o700,
      dev: String(opened.dev), ino: String(opened.ino) });
    onTightenAttempt?.(effect);
    fchmodSync(descriptor, 0o700);
    onTightened?.(effect);
    const tightened = fstatSync(descriptor, { bigint: true });
    if (tightened.dev !== opened.dev || tightened.ino !== opened.ino
        || tightened.uid !== opened.uid || (tightened.mode & 0o7777n) !== 0o700n)
      throw new Error(`${label} identity changed during mode tightening`);
  } finally { closeSync(descriptor); }
  const actual = privateDirectoryIdentity(path, label);
  if (!actual || actual.dev !== expected.dev || actual.ino !== expected.ino)
    throw new Error(`${label} identity changed after mode tightening`);
  return actual;
}

export function assertPrivateDirectoryIdentity(expected, label = 'private directory') {
  const actual = privateDirectoryIdentity(expected.path, label);
  if (!actual || actual.dev !== expected.dev || actual.ino !== expected.ino
      || actual.mode !== expected.mode || actual.uid !== expected.uid)
    throw new Error(`${label} identity changed`);
  return actual;
}

/** Read one stable, private, single-link regular file inside a stable private directory. */
export function readPrivateFile(path, maxBytes, label, parent) {
  const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!before) {
    const error = new Error(`${label} is missing`);
    error.code = 'ENOENT';
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`${label} must be a direct regular file`);
  if ((before.mode & 0o7777n) !== 0o600n) throw new Error(`${label} mode must be 0600`);
  if (before.nlink !== 1n) throw new Error(`${label} link count must be 1`);
  const bytes = readBoundedFile(path, maxBytes, label, { expectedIdentity: before });
  const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!sameNode(before, after)) throw new Error(`${label} identity changed during inspection`);
  assertPrivateDirectoryIdentity(parent, `${label} directory`);
  return bytes;
}

export class OperationLockError extends Error {
  constructor(label, lock, observed, lockError, result, operationError, artifacts) {
    super(`${label} lock is nonempty or changed; residue retained at ${lock.path}`, {
      cause: operationError ?? lockError,
    });
    Object.assign(this, {
      name: 'OperationLockError', reason: `blocked-${label}-lock-integrity`, lock,
      lockPath: lock.path, lockObserved: observed, lockError,
      operationResult: result, operationError, operationArtifacts: artifacts,
    });
  }
}

/** Acquire an identity-bound directory lock without adopting pre-existing bytes. */
export function acquireDirectoryLock(path) {
  try { mkdirSync(path); } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
  return identitySnapshot(lstatSync(path, { bigint: true }), path);
}

/** Remove only the exact empty lock acquired here, retaining either exact outcome. */
export function finishOperationLock(
  lock, { label, result, error = null, artifacts = null },
) {
  let observed = null;
  let lockError = null;
  try {
    observed = lstatSync(lock.path, { bigint: true, throwIfNoEntry: false });
    if (!observed?.isDirectory() || observed.isSymbolicLink() || !sameNode(lock, observed))
      throw new Error('operation lock identity changed');
    rmdirSync(lock.path);
  } catch (caught) { lockError = caught; }
  if (lockError)
    throw new OperationLockError(label, lock, observed, lockError, result, error, artifacts);
  if (error) throw error;
  return result;
}

/** Snapshot one regular file or symlink with stable identity and explicit byte ceilings. */
export function snapshotWorktreeEntry(absolute, {
  maxBytes, aggregateBytes = Number.MAX_SAFE_INTEGER, budget = { bytes: 0 },
  label = 'worktree entry',
}) {
  const before = lstatSync(absolute, { bigint: true });
  const reserve = (bytes) => {
    if (bytes > maxBytes)
      throw Object.assign(new Error(`${label} byte budget exceeded`), { code: 'ERR_FILE_TOO_LARGE' });
    if (bytes > aggregateBytes - budget.bytes)
      throw Object.assign(new Error(`${label} aggregate byte budget exceeded`),
        { code: 'ERR_AGGREGATE_TOO_LARGE' });
    budget.bytes += bytes;
  };
  if (before.isSymbolicLink()) {
    const bytes = readlinkSync(absolute, { encoding: 'buffer' });
    const after = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!sameNode(before, after)) throw new Error(`${label} changed during inspection`);
    reserve(bytes.length);
    return { kind: 'symlink', mode: '120000', bytes };
  }
  if (!before.isFile()) throw new Error(`${label} must be a regular file or symlink`);
  reserve(Number(before.size));
  const bytes = readBoundedFile(absolute, maxBytes, label, { expectedIdentity: before });
  return { kind: 'file', mode: before.mode & 0o111n ? '100755' : '100644', bytes };
}
