/** Bounded target-tree checkout materialization and no-clobber installation. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readSync, renameSync, statSync, symlinkSync,
  writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDirectoryAncestors, commonDir, git, gitDir } from './git.mjs';
import {
  assertPathIdentity, captureExactTree, copyRegularFileExclusive, copySymlinkExclusive,
  pathIdentity, privateDirectoryIdentity, removeExactTree, snapshotWorktreeEntry, unlinkExactPath,
} from './file-integrity.mjs';
const MATERIALIZE = fileURLToPath(
  new URL('../bin/agentic-os-filter-materialize.mjs', import.meta.url),
);
const DEFAULT_INSTALL_LIMITS = Object.freeze({
  maxEntryBytes: 32 * 1024 * 1024, maxAggregateBytes: 128 * 1024 * 1024,
  maxParentDirectories: 50_000,
});
function fail(message, reason, detail = {}) {
  throw Object.assign(new Error(message), { reason, detail });
}
function descendantDirectories(root, paths, maxDirectories = Number.MAX_SAFE_INTEGER) {
  const found = new Set();
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== '.') {
      found.add(join(root, parent));
      if (found.size > maxDirectories)
        fail('target directory limit exceeded', 'blocked-target-directory-limit',
          { directories: found.size, limit: maxDirectories });
      parent = dirname(parent);
    }
  }
  return [...found].sort((left, right) => left.length - right.length);
}

function filteredFile(target, entry, cwd, env, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    const result = spawnSync(process.execPath, [MATERIALIZE, entry.path, entry.oid, String(maxBytes)], {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', descriptor],
      timeout: 31_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    });
    if (result.status !== 0 || result.signal !== null || result.error) {
      const limitExceeded = result.status === 3;
      fail(`checkout filters failed for ${entry.path}`,
        limitExceeded ? 'blocked-target-file-limit' : 'blocked-target-filter', {
        path: entry.path, status: result.status, signal: result.signal,
        cause: result.error?.code ?? null, ...(limitExceeded ? { limit: maxBytes } : {}),
      });
    }
    fchmodSync(descriptor, entry.mode === '100755' ? 0o755 : 0o644);
    const opened = fstatSync(descriptor, { bigint: true });
    const atPath = pathIdentity(target, `filtered target ${entry.path}`);
    if (!opened.isFile() || opened.dev !== atPath.dev || opened.ino !== atPath.ino
      || opened.mode !== atPath.mode || opened.size !== atPath.size
      || opened.mtimeNs !== atPath.mtimeNs)
      fail(`checkout filter replaced ${entry.path}`, 'blocked-target-filter-race', {
        path: entry.path,
      });
    return atPath;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function materializeTargetAttributes(root, entries, cwd, maxBytes) {
  const attributes = entries.filter(({ path, mode }) =>
    mode !== '120000' && (path === '.gitattributes' || path.endsWith('/.gitattributes')));
  for (const entry of attributes) {
    const target = join(root, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = git(['cat-file', 'blob', entry.oid], {
      cwd, binary: true, maxBuffer: maxBytes + 1,
    });
    if (bytes.length > maxBytes) fail(
      `target file limit exceeded for ${entry.path}`, 'blocked-target-file-limit', {
        path: entry.path, bytes: bytes.length, limit: maxBytes,
      });
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  return attributes;
}

function stageZeroEntry(path, cwd, env) {
  const pathBytes = Buffer.from(path, 'utf8');
  const raw = git(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', path], {
    cwd, env, binary: true, maxBuffer: pathBytes.length + 256,
  });
  if (raw.length === 0 || raw[raw.length - 1] !== 0 || raw.subarray(0, -1).includes(0)) return null;
  const record = raw.subarray(0, -1);
  const tab = record.indexOf(9);
  if (tab < 0 || !record.subarray(tab + 1).equals(pathBytes)) return null;
  const header = record.subarray(0, tab).toString('ascii');
  const match = header.match(/^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) 0$/u);
  return match ? { mode: match[1], oid: match[2] } : null;
}

/** Materialize the target tree with target-index attributes and explicit output ceilings. */
export function stageTreeEntries(name, ref, entries, limits, cwd = process.cwd()) {
  let path = null, stagingIdentity = null, indexRoot = null, indexIdentity = null;
  let index = null, indexManifest = null, primaryError = null, total = 0;
  let stagedEntryCount = 0, stagingAttemptedPath = null, stagingWriteResultUnknown = false;
  const stagingManifest = [];
  try {
    path = mkdtempSync(join(commonDir(cwd), `${name}-`));
    stagingIdentity = privateDirectoryIdentity(path, 'target staging directory');
    if (!stagingIdentity) throw new Error('target staging identity was not established');
    indexRoot = mkdtempSync(join(commonDir(cwd), `${name}-index-`));
    indexIdentity = privateDirectoryIdentity(indexRoot, 'target index staging directory');
    if (!indexIdentity) throw new Error('target index staging identity was not established');
    index = join(indexRoot, 'index');
    const attributeRoot = join(indexRoot, 'worktree');
    const env = {
      GIT_ATTR_SOURCE: ref, GIT_DIR: gitDir(cwd), GIT_INDEX_FILE: index,
      GIT_WORK_TREE: attributeRoot,
    };
    if (statSync(path).dev !== statSync(cwd).dev) fail(
      'staging and worktree are on different filesystems', 'blocked-staging-filesystem');
    git(['read-tree', ref], { cwd, env });
    mkdirSync(attributeRoot);
    const attributes = materializeTargetAttributes(
      attributeRoot, entries, cwd, limits.maxEntryBytes);
    const attributeFiles = attributes.map((entry) => join(attributeRoot, entry.path));
    indexManifest = captureExactTree(indexIdentity, [
      index, attributeRoot, ...descendantDirectories(attributeRoot,
        attributes.map(({ path: attributePath }) => attributePath)), ...attributeFiles,
    ], 'target index staging directory');
    const stageDirectories = descendantDirectories(path, entries.map(
      ({ path: entryPath }) => entryPath),
      limits.maxParentDirectories ?? DEFAULT_INSTALL_LIMITS.maxParentDirectories);
    for (const directory of stageDirectories) {
      mkdirSync(directory); stagingManifest.push(pathIdentity(directory, 'target staging directory'));
    }
    for (const entry of entries) {
      const target = join(path, entry.path);
      if (entry.mode === '120000') {
        const bytes = git(['cat-file', 'blob', entry.oid], {
          cwd, binary: true, maxBuffer: limits.maxEntryBytes + 1,
        });
        if (bytes.length > limits.maxEntryBytes) fail(
          `target file limit exceeded for ${entry.path}`, 'blocked-target-file-limit', {
            path: entry.path, bytes: bytes.length, limit: limits.maxEntryBytes,
          });
        stagingAttemptedPath = entry.path; stagingWriteResultUnknown = true;
        symlinkSync(bytes, target); stagingWriteResultUnknown = false;
        stagingManifest.push(pathIdentity(target, `staged target ${entry.path}`));
      } else {
        const before = stageZeroEntry(entry.path, cwd, env);
        if (before?.oid !== entry.oid || before.mode !== entry.mode)
          fail(`target index identity changed for ${entry.path}`, 'blocked-target-index-race', {
            path: entry.path,
          });
        stagingAttemptedPath = entry.path; stagingWriteResultUnknown = true;
        const stagedIdentity = filteredFile(target, entry, cwd, env, limits.maxEntryBytes);
        stagingWriteResultUnknown = false;
        const after = stageZeroEntry(entry.path, cwd, env);
        if (after?.oid !== entry.oid || after.mode !== entry.mode)
          fail(`target index identity changed for ${entry.path}`, 'blocked-target-index-race', {
            path: entry.path,
          });
        stagingManifest.push(stagedIdentity);
      }
      const size = Number(lstatSync(target).size);
      if (size > limits.maxEntryBytes) fail(
        `target file limit exceeded for ${entry.path}`, 'blocked-target-file-limit', {
          path: entry.path, bytes: size, limit: limits.maxEntryBytes,
        });
      if (size > limits.maxAggregateBytes - total) fail(
        'target aggregate byte limit exceeded', 'blocked-target-aggregate-limit', {
          bytes: total + size, limit: limits.maxAggregateBytes,
        });
      total += size; stagedEntryCount += 1; stagingAttemptedPath = null;
    }
  } catch (error) {
    primaryError = error;
  }
  let cleanupError = null;
  if (indexRoot) try {
    if (!indexIdentity || !indexManifest)
      throw new Error('target index staging manifest was not established');
    removeExactTree(indexIdentity, indexManifest, 'target index staging directory');
  } catch (error) { cleanupError = error; }
  if (primaryError || cleanupError) {
    const error = primaryError ?? Object.assign(
      new Error('target index cleanup failed', { cause: cleanupError }),
      { reason: 'blocked-target-index-cleanup' },
    );
    if (path) Object.assign(error, { stagingPath: path, stagingIdentity,
      stagedEntryCount, stagedBytes: total, stagingAttemptedPath,
      stagingWriteResultUnknown });
    if (cleanupError) Object.assign(error, { indexRoot, indexPath: index, indexCleanupError: cleanupError });
    throw error;
  }
  return Object.freeze({ path, identity: stagingIdentity, stagedEntryCount, stagedBytes: total,
    manifest: Object.freeze(stagingManifest) });
}

/** Remove only the exact target staging directory allocated by stageTreeEntries. */
export function removeStagedTree(staging) {
  try {
    if (!staging?.path || staging.identity?.path !== staging.path || !staging.manifest)
      throw new Error('target staging identity or manifest is missing or mismatched');
    removeExactTree(staging.identity, staging.manifest, 'target staging directory');
  } catch (cause) {
    throw Object.assign(new Error('target staging cleanup failed', { cause }), {
      reason: 'blocked-target-staging-cleanup', stagingPath: staging?.path ?? null,
      stagingIdentity: staging?.identity ?? null, stagingCleanupError: cause,
    });
  }
}

function copyIndex(source, target, maxBytes) {
  const descriptor = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(descriptor, { bigint: true });
    if (!metadata.isFile() || metadata.size > BigInt(maxBytes))
      fail('canonical target index exceeds its byte ceiling', 'blocked-target-index-limit', {
        bytes: Number(metadata.size), limit: maxBytes,
      });
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (let offset = 0; ;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      for (let written = 0; written < count; )
        written += writeSync(target, buffer, written, count - written);
      offset += count;
    }
  } finally { closeSync(descriptor); }
}

/** Hold Git's conventional index lock until the exact target index is atomically published. */
export function prepareCanonicalIndex(ref, cwd, maxBytes) {
  const indexPath = join(gitDir(cwd), 'index');
  const original = pathIdentity(indexPath, 'canonical worktree index');
  const lockPath = `${indexPath}.lock`;
  let descriptor = null, lockCreated = false, lockIdentity = null, temp = null, tempIdentity = null;
  let tempManifest = null, primaryError = null, cleanupError = null;
  try {
    descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    lockCreated = true;
    assertPathIdentity(original, 'canonical worktree index');
    temp = mkdtempSync(join(commonDir(cwd), 'agentic-os-canonical-target-index-'));
    tempIdentity = privateDirectoryIdentity(temp, 'canonical target index temporary directory');
    if (!tempIdentity) throw new Error('canonical target index temporary identity was not established');
    const prepared = join(temp, 'index');
    git(['read-tree', ref], { cwd, env: { GIT_INDEX_FILE: prepared } });
    tempManifest = captureExactTree(tempIdentity, [prepared],
      'canonical target index temporary directory');
    copyIndex(prepared, descriptor, maxBytes);
    fchmodSync(descriptor, Number(original.mode & 0o777n)); fsyncSync(descriptor);
    const opened = fstatSync(descriptor, { bigint: true });
    lockIdentity = pathIdentity(lockPath, 'canonical worktree index lock');
    if (opened.dev !== lockIdentity.dev || opened.ino !== lockIdentity.ino
      || opened.mode !== lockIdentity.mode || opened.size !== lockIdentity.size
      || opened.mtimeNs !== lockIdentity.mtimeNs)
      throw new Error('canonical worktree index lock identity changed during preparation');
  } catch (error) { primaryError = error; }
  if (temp) try {
    if (!tempIdentity || !tempManifest)
      throw new Error('canonical target index temporary manifest was not established');
    removeExactTree(tempIdentity, tempManifest, 'canonical target index temporary directory');
  } catch (error) { cleanupError = error; }
  if (primaryError || cleanupError) {
    if (descriptor !== null) closeSync(descriptor);
    const error = primaryError ?? Object.assign(
      new Error('canonical target index preparation cleanup failed', { cause: cleanupError }),
      { reason: 'blocked-target-index-preparation-cleanup' },
    );
    Object.assign(error, { canonicalIndexLockCreated: lockCreated,
      canonicalIndexLockPath: lockCreated ? lockPath : null,
      canonicalIndexTempPath: cleanupError ? temp : null,
      canonicalIndexTempCleanupError: cleanupError });
    throw error;
  }
  return { indexPath, original, lockPath, lockIdentity, descriptor,
    published: false, closed: false };
}

export function publishCanonicalIndex(prepared) {
  assertPathIdentity(prepared.original, 'canonical worktree index');
  assertPathIdentity(prepared.lockIdentity, 'canonical worktree index lock');
  const opened = fstatSync(prepared.descriptor, { bigint: true });
  if (opened.dev !== prepared.lockIdentity.dev || opened.ino !== prepared.lockIdentity.ino
    || opened.size !== prepared.lockIdentity.size || opened.mtimeNs !== prepared.lockIdentity.mtimeNs)
    throw new Error('canonical worktree index lock changed before publication');
  renameSync(prepared.lockPath, prepared.indexPath); prepared.published = true;
  closeSync(prepared.descriptor); prepared.closed = true;
  const installed = pathIdentity(prepared.indexPath, 'published canonical worktree index');
  if (installed.dev !== prepared.lockIdentity.dev || installed.ino !== prepared.lockIdentity.ino)
    throw new Error('canonical worktree index publication identity changed');
}

export function abortCanonicalIndex(prepared) {
  if (prepared.published) return;
  if (!prepared.closed) { closeSync(prepared.descriptor); prepared.closed = true; }
  unlinkExactPath(prepared.lockIdentity, 'canonical worktree index lock');
}
/** Install staged entries and retain a bounded fingerprint for post-install fidelity proof. */
export function installStagedEntries(
  stagingPath, entries, cwd = process.cwd(), limits = DEFAULT_INSTALL_LIMITS,
  observer = null,
) {
  const expected = [];
  const captureBudget = { bytes: 0 };
  const parentDirectoriesCreated = []; let installedCount = 0;
  const beforeInstall = observer && typeof observer === 'object' ? observer.before : null;
  const afterInstall = typeof observer === 'function' ? observer : observer?.after ?? null;
  const beforeParent = observer?.beforeParent ?? null, afterParent = observer?.afterParent ?? null,
    parentFailure = observer?.parentFailure ?? null;
  if ([beforeInstall, afterInstall, beforeParent, afterParent, parentFailure]
    .some((callback) => callback !== null && typeof callback !== 'function'))
    throw new TypeError('target installation observer must expose functions');
  const directoryLimit = limits.maxParentDirectories ?? DEFAULT_INSTALL_LIMITS.maxParentDirectories;
  descendantDirectories(cwd, entries.map(({ path }) => path), directoryLimit);
  for (const entry of entries) {
    const source = join(stagingPath, entry.path);
    const target = join(cwd, entry.path);
    try {
      for (const parent of descendantDirectories(cwd, [entry.path], directoryLimit)) {
        const existing = lstatSync(parent, { throwIfNoEntry: false });
        if (existing) {
          if (!existing.isDirectory() || existing.isSymbolicLink())
            fail(`unsafe directory ancestor for ${entry.path}: ${parent}`,
            'blocked-directory-ancestor', { path: entry.path, parent });
          continue;
        }
        const parentPath = relative(cwd, parent);
        beforeParent?.(parentPath, parentDirectoriesCreated.length); let created = false;
        try {
          mkdirSync(parent); created = true;
          const identity = pathIdentity(parent, `target parent ${parentPath}`);
          if (identity.kind !== 'directory')
            throw new Error('created target parent is not a directory');
          parentDirectoriesCreated.push(parentPath);
          afterParent?.(parentPath, parentDirectoriesCreated.length);
        } catch (error) {
          parentFailure?.(parentPath, parentDirectoriesCreated.length, error, created); throw error; }
      }
      assertDirectoryAncestors(entry.path, cwd);
      const content = snapshotWorktreeEntry(source, {
        maxBytes: limits.maxEntryBytes, aggregateBytes: limits.maxAggregateBytes,
        budget: captureBudget, label: `staged target ${entry.path}`,
      });
      if (content.mode !== entry.mode) fail(
        `staged target mode changed for ${entry.path}`, 'blocked-target-install-drift', {
          path: entry.path, expectedMode: entry.mode, actualMode: content.mode,
        });
      expected.push({ path: entry.path, mode: content.mode,
        sha256: createHash('sha256').update(content.bytes).digest('hex') });
      const copy = { maxBytes: limits.maxEntryBytes, label: `target install ${entry.path}` };
      if (beforeInstall) beforeInstall(entry, installedCount);
      if (entry.mode === '120000') copySymlinkExclusive(source, target, copy);
      else copyRegularFileExclusive(source, target, copy);
      installedCount += 1;
      if (afterInstall) afterInstall(entry, installedCount);
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
        error.reason = 'blocked-install-collision';
      error.installPath = entry.path;
      error.installParentDirectoriesCreated = Object.freeze([...parentDirectoriesCreated]);
      throw error;
    }
  }
  return Object.freeze({ installedCount,
    parentDirectoriesCreated: Object.freeze([...parentDirectoriesCreated]),
    verify() {
      const budget = { bytes: 0 };
      for (const entry of expected) {
        let content;
        try {
          assertDirectoryAncestors(entry.path, cwd);
          content = snapshotWorktreeEntry(join(cwd, entry.path), {
            maxBytes: limits.maxEntryBytes, aggregateBytes: limits.maxAggregateBytes,
            budget, label: `installed target ${entry.path}`,
          });
          assertDirectoryAncestors(entry.path, cwd);
        } catch (error) {
          fail(`installed target changed for ${entry.path}`, 'blocked-target-install-drift', {
            path: entry.path, cause: error.code ?? error.reason ?? error.message,
          });
        }
        const sha256 = createHash('sha256').update(content.bytes).digest('hex');
        if (content.mode !== entry.mode || sha256 !== entry.sha256) fail(
          `installed target changed for ${entry.path}`, 'blocked-target-install-drift', {
            path: entry.path, expectedMode: entry.mode, actualMode: content.mode,
          });
      }
      return true;
    },
  });
}
