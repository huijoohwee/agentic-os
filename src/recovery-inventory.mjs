/** Read-only, byte-exact Git recovery inventory. */
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readlinkSync, readSync,
  realpathSync,
} from 'node:fs';
import { TextDecoder } from 'node:util';
import { dirname, join } from 'node:path';
import { observeGit } from './git-tracked.mjs';
import { readBoundedStableFile, sameCleanupNode as sameNode } from './cleanup-manifest.mjs';
export const RECOVERY_INVENTORY_ALGORITHM =
  'agentic-os/git-recovery-inventory/netstring-sha256-v1';
export const RECOVERY_INVENTORY_SCHEMA = 'agentic-os/recovery-inventory/v1';
/* Expand Git-collapsed ignored dirs; N(b)=ASCII(length):bytes,; rows sort by raw path bytes. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const SHA256_EMPTY = createHash('sha256').digest('hex');
const BUFFER_SIZE = 64 * 1024;
const CATEGORIES = Object.freeze({
  tracked: 'tracked',
  visibleUntracked: 'visible-untracked',
  ignoredRuntime: 'ignored-runtime',
});
function blocked(message, reason = 'blocked-recovery-inventory') {
  throw Object.assign(new Error(message), { reason });
}
function ascii(value) { return Buffer.from(String(value), 'ascii'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function netstring(value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([ascii(bytes.length), Buffer.from(':'), bytes, Buffer.from(',')]);
}
function manifestDigest(kind, records) {
  const hash = createHash('sha256');
  for (const field of [RECOVERY_INVENTORY_ALGORITHM, kind, records.length]) {
    hash.update(netstring(ascii(field)));
  }
  for (const record of records) {
    hash.update(netstring(Buffer.concat(record.fields.map(netstring))));
  }
  return hash.digest('hex');
}
function nulRecords(value, label) {
  if (!Buffer.isBuffer(value)) blocked(`${label} output is not bytes`);
  if (value.length === 0) return [];
  if (value.at(-1) !== 0) blocked(`${label} output is not NUL-terminated`);
  const result = []; let start = 0;
  for (let index = 0; index < value.length; index += 1) if (value[index] === 0) {
    if (index === start) blocked(`${label} contains an empty record`);
    result.push(Buffer.from(value.subarray(start, index))); start = index + 1;
  }
  return result;
}
function rawPath(value, label) {
  const windowsDrive = value?.length >= 2 && /[A-Za-z]/u.test(String.fromCharCode(value[0])) && value[1] === 58;
  if (!Buffer.isBuffer(value) || value.length === 0 || value.includes(0) || value[0] === 47
    || value.includes(92) || windowsDrive
    || value.toString('binary').split('/').some(part => !part || part === '.' || part === '..')) {
    blocked(`${label} contains an unsafe repository-relative path`);
  }
  return value;
}
function uniquePaths(records, label) {
  const seen = new Set();
  for (const record of records) {
    const key = record.path.toString('hex');
    if (seen.has(key)) blocked(`${label} contains a duplicate path`);
    seen.add(key);
  }
  return records.sort((left, right) => Buffer.compare(left.path, right.path));
}
function gitBytes(args, cwd, { allowFail = false, repositoryContext = null } = {}) {
  return observeGit(args, { cwd, binary: true, allowFail, repositoryContext, maxBuffer: 64 * 1024 * 1024 });
}
function gitLine(args, cwd, label, repositoryContext) {
  const output = gitBytes(args, cwd, { repositoryContext });
  if (output.length < 2 || output.at(-1) !== 10 || output.subarray(0, -1).includes(10)) {
    blocked(`${label} is not one newline-terminated value`);
  }
  return output.subarray(0, -1);
}
function gitPath(args, cwd, label, repositoryContext) {
  const output = gitBytes(args, cwd, { repositoryContext });
  if (output.length < 2 || output.at(-1) !== 10) blocked(`${label} is not newline-terminated`);
  return output.subarray(0, -1);
}
function strictText(value, label) {
  try { return UTF8.decode(value); } catch { return blocked(`${label} is not UTF-8`); }
}
function indexRecords(raw, objectFormat) {
  const oidLength = objectFormat === 'sha1' ? 40 : objectFormat === 'sha256' ? 64 : 0;
  if (oidLength === 0) blocked('Git object format is unsupported');
  const seen = new Set();
  return nulRecords(raw, 'index inventory').map((entry) => {
    const separator = entry.indexOf(9);
    if (separator <= 0) blocked('index inventory record is malformed');
    const metadata = strictText(entry.subarray(0, separator), 'index metadata');
    const match = metadata.match(/^([0-7]{6}) ([0-9a-f]+) ([0-3])$/u);
    if (!match || match[2].length !== oidLength) blocked('index inventory metadata is malformed');
    const path = rawPath(Buffer.from(entry.subarray(separator + 1)), 'index inventory');
    const stage = Number(match[3]);
    const key = `${path.toString('hex')}:${stage}`;
    if (seen.has(key)) blocked('index inventory contains a duplicate path and stage');
    seen.add(key);
    return { path, stage, mode: match[1], oid: match[2], fields: [path, ascii(stage), ascii(match[1]), ascii(objectFormat), ascii(match[2])] };
  }).sort((left, right) => Buffer.compare(left.path, right.path) || left.stage - right.stage);
}
function hiddenRecords(raw, indexPaths) {
  const records = nulRecords(raw, 'hidden inventory').flatMap((entry) => {
    if (entry.length < 3 || entry[1] !== 32 || !/[A-Za-z]/u.test(String.fromCharCode(entry[0]))) {
      blocked('hidden inventory record is malformed');
    }
    const tag = String.fromCharCode(entry[0]);
    const assumeUnchanged = tag >= 'a' && tag <= 'z';
    const skipWorktree = tag.toUpperCase() === 'S';
    if (!assumeUnchanged && !skipWorktree) return [];
    const path = rawPath(Buffer.from(entry.subarray(2)), 'hidden inventory');
    if (!indexPaths.has(path.toString('hex'))) blocked('hidden path is absent from the index');
    return [{ path, fields: [path, ascii(Number(assumeUnchanged)), ascii(Number(skipWorktree))] }];
  });
  return uniquePaths(records, 'hidden inventory');
}
function fullPath(root, relative) { return Buffer.concat([Buffer.from(`${root}/`), relative]); }
function parentChain(root, relative) {
  const separators = [];
  for (let index = 0; index < relative.length; index += 1) {
    if (relative[index] === 47) separators.push(index);
  }
  const entries = [];
  for (const separator of separators) {
    const path = fullPath(root, relative.subarray(0, separator));
    const metadata = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    entries.push({ path, metadata });
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return { direct: false, entries };
  }
  return { direct: true, entries };
}
function assertParentChain(expected) {
  for (const { path, metadata } of expected.entries) if (metadata === undefined
    ? lstatSync(path, { bigint: true, throwIfNoEntry: false }) !== undefined
    : !sameNode(metadata, lstatSync(path, { bigint: true, throwIfNoEntry: false }))) {
    blocked('content parent changed during hashing', 'blocked-recovery-inventory-race');
  }
}
function gitMode(metadata) {
  if (metadata.isSymbolicLink()) return '120000';
  if (metadata.isFile()) return metadata.mode & 0o111n ? '100755' : '100644';
  blocked('recovery inventory encountered an unsupported filesystem entry type');
}
function hashFile(path, before) {
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK
      | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameNode(before, opened)) blocked('file changed before content hashing');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(BUFFER_SIZE);
    let length = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      length += count;
      if (!Number.isSafeInteger(length)) blocked('file byte length exceeds the safe integer range');
      hash.update(buffer.subarray(0, count));
    }
    const afterOpen = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!sameNode(opened, afterOpen) || !sameNode(afterOpen, afterPath)) {
      blocked('file changed during content hashing', 'blocked-recovery-inventory-race');
    }
    return { length, digest: hash.digest('hex') };
  } finally { if (descriptor !== null) closeSync(descriptor); }
}

function contentRecord(root, category, path, trackedMode = null) {
  const parents = parentChain(root, path);
  const absolute = fullPath(root, path);
  const before = parents.direct
    ? lstatSync(absolute, { bigint: true, throwIfNoEntry: false }) : undefined;
  let kind, mode, length, digest;
  if (!before) {
    if (category !== CATEGORIES.tracked || trackedMode === null) {
      blocked('untracked inventory path disappeared', 'blocked-recovery-inventory-race');
    }
    ({ length, digest } = { length: 0, digest: SHA256_EMPTY });
    ({ kind, mode } = { kind: 'absent', mode: trackedMode });
  } else if (before.isSymbolicLink()) {
    const target = readlinkSync(absolute, { encoding: 'buffer' });
    const after = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!sameNode(before, after)) blocked('symlink changed during content hashing',
      'blocked-recovery-inventory-race');
    ({ kind, mode, length, digest } = {
      kind: 'symlink', mode: gitMode(before), length: target.length, digest: sha256(target),
    });
  } else if (before.isFile()) {
    ({ length, digest } = hashFile(absolute, before));
    ({ kind, mode } = { kind: 'file', mode: gitMode(before) });
  } else {
    blocked('recovery inventory encountered an unsupported filesystem entry type');
  }
  assertParentChain(parents);
  return { category, path, fields: [
    ascii(category), path, ascii(kind), ascii(mode), ascii(length), ascii(digest),
  ] };
}

function listedContent(raw, label, root, category, maxEntries) {
  const paths = [], pending = nulRecords(raw, label).map(entry => [entry.at(-1) === 47 ? entry.subarray(0, -1) : entry, entry.at(-1) === 47]);
  let visited = 0;
  while (pending.length) {
    const [entry, directory] = pending.pop();
    if (++visited > maxEntries) blocked('recovery inventory exceeds the cleanup content entry ceiling', 'blocked-recovery-inventory-budget');
    const path = rawPath(entry, label);
    if (!directory) { paths.push(path); continue; }
    const absolute = fullPath(root, path), before = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!before || !before.isDirectory() || before.isSymbolicLink()) blocked(`${label} directory is unsafe`, 'blocked-recovery-inventory-race');
    const handle = opendirSync(absolute, { encoding: 'buffer' });
    try {
      let child;
      while ((child = handle.readSync()) !== null) {
        if (!Buffer.isBuffer(child.name)) blocked(`${label} contains a non-byte path`);
        const childPath = rawPath(Buffer.concat([path, Buffer.from('/'), child.name]), label);
        pending.push([childPath, child.isDirectory() && !child.isSymbolicLink()]);
        if (paths.length + pending.length > maxEntries) blocked(
          'recovery inventory exceeds the cleanup content entry ceiling', 'blocked-recovery-inventory-budget');
      }
    } finally { handle.closeSync(); }
    if (!sameNode(before, lstatSync(absolute, { bigint: true, throwIfNoEntry: false }))) blocked(
      'listed directory changed during recovery inventory', 'blocked-recovery-inventory-race');
  }
  return uniquePaths(paths.map(path => ({ path })), label).map(({ path }) => contentRecord(root, category, path));
}

function inventorySnapshot(root, canonicalRef, allowDetached, maxContentEntries, repositoryContext, retainedRef) {
  const headRevision = strictText(gitLine(
    ['rev-parse', '--verify', '--end-of-options', `${retainedRef ?? 'HEAD'}^{commit}`], root, 'HEAD revision', repositoryContext),
  'HEAD revision');
  const canonicalRevision = strictText(gitLine([
    'rev-parse', '--verify', '--end-of-options', `${canonicalRef}^{commit}`,
  ], root, 'canonical revision', repositoryContext), 'canonical revision');
  const detached = allowDetached && strictText(gitLine(
    ['rev-parse', '--abbrev-ref', 'HEAD'], root, 'HEAD kind', repositoryContext), 'HEAD kind') === 'HEAD';
  const branch = retainedRef?.slice('refs/heads/'.length) ?? (detached ? null : strictText(gitLine(
    ['symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'branch', repositoryContext), 'branch'));
  const objectFormat = strictText(gitLine(
    ['rev-parse', '--show-object-format'], root, 'object format', repositoryContext), 'object format');
  const oidLength = objectFormat === 'sha1' ? 40 : objectFormat === 'sha256' ? 64 : 0;
  const oidPattern = /^[0-9a-f]+$/u;
  if (oidLength === 0 || headRevision.length !== oidLength || canonicalRevision.length !== oidLength
    || !oidPattern.test(headRevision) || !oidPattern.test(canonicalRevision)) {
    blocked('Git revision or object format is malformed');
  }
  const porcelainV2Digest = sha256(gitBytes([
    'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no', '--no-renames', '--',
  ], root, { repositoryContext }));
  const index = indexRecords(gitBytes(['ls-files', '--stage', '-z', '--'], root, { repositoryContext }), objectFormat);
  const indexPaths = new Set(index.map((entry) => entry.path.toString('hex')));
  const stageZero = new Map(index.filter((entry) => entry.stage === 0)
    .map((entry) => [entry.path.toString('hex'), entry]));
  if (stageZero.size !== indexPaths.size) blocked('unmerged index path has no stage-zero entry');
  const unsupported = [...stageZero.values()].find((entry) =>
    !['100644', '100755', '120000'].includes(entry.mode));
  if (unsupported) blocked('tracked index mode is unsupported');
  const visibleBytes = gitBytes(['ls-files', '--others', '--exclude-standard', '-z', '--'], root, { repositoryContext });
  const ignoredBytes = gitBytes(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--'], root, { repositoryContext });
  if (indexPaths.size + nulRecords(visibleBytes, 'visible untracked inventory').length
    + nulRecords(ignoredBytes, 'ignored runtime inventory').length > maxContentEntries) {
    blocked('recovery inventory exceeds the cleanup content entry ceiling',
      'blocked-recovery-inventory-budget');
  }
  const tracked = [...stageZero.values()].sort((left, right) => Buffer.compare(left.path, right.path))
    .map((entry) => contentRecord(root, CATEGORIES.tracked, entry.path, entry.mode));
  const visibleUntracked = listedContent(visibleBytes, 'visible untracked inventory', root,
    CATEGORIES.visibleUntracked, maxContentEntries - index.length);
  const ignoredRuntime = listedContent(ignoredBytes, 'ignored runtime inventory', root,
    CATEGORIES.ignoredRuntime, maxContentEntries - index.length - visibleUntracked.length);
  const allKeys = new Set(indexPaths);
  for (const record of [...visibleUntracked, ...ignoredRuntime]) {
    const key = record.path.toString('hex');
    if (allKeys.has(key)) blocked('content inventory categories overlap');
    allKeys.add(key);
  }
  const hidden = hiddenRecords(gitBytes(['ls-files', '-v', '-z', '--'], root, { repositoryContext }), indexPaths);
  const content = [...tracked, ...visibleUntracked, ...ignoredRuntime]
    .sort((left, right) => Buffer.compare(left.path, right.path)
      || Buffer.compare(ascii(left.category), ascii(right.category)));
  return {
    headRevision, canonicalRevision, branch, objectFormat, porcelainV2Digest,
    inventoryAlgorithm: RECOVERY_INVENTORY_ALGORITHM,
    inventoryEntries: { index: index.length, tracked: tracked.length,
      visibleUntracked: visibleUntracked.length, hidden: hidden.length,
      ignoredRuntime: ignoredRuntime.length, content: content.length },
    indexInventoryDigest: manifestDigest('index', index),
    trackedInventoryDigest: manifestDigest('content/tracked', tracked),
    visibleUntrackedInventoryDigest: manifestDigest('content/visible-untracked', visibleUntracked),
    hiddenInventoryDigest: manifestDigest('hidden', hidden),
    ignoredRuntimeInventoryDigest: manifestDigest('content/ignored-runtime', ignoredRuntime),
    contentInventoryDigest: manifestDigest('content/all', content),
  };
}

function frozen(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) Object.freeze(entry);
  });
  return Object.freeze(value);
}

/** Collect twice and return only an exact, stable, path-free observation. */
export function collectRecoveryInventory({ cwd = process.cwd(), canonicalRef, allowDetached = false,
  maxContentEntries = Number.MAX_SAFE_INTEGER, repositoryContext = null } = {}) {
  if (typeof allowDetached !== 'boolean') throw new TypeError('allowDetached must be a boolean');
  if (!Number.isSafeInteger(maxContentEntries) || maxContentEntries < 1)
    throw new TypeError('maxContentEntries must be a positive safe integer');
  if (typeof canonicalRef !== 'string' || !canonicalRef.startsWith('refs/')
    || canonicalRef.includes('\0')) throw new TypeError('canonicalRef must be a full Git ref');
  const initialRoot = strictText(gitPath(['rev-parse', '--show-toplevel'], cwd,
    'repository root', repositoryContext), 'repository root');
  const root = realpathSync(initialRoot);
  const rootIdentity = lstatSync(root, { bigint: true });
  if (gitBytes(['check-ref-format', canonicalRef], root, { allowFail: true, repositoryContext }) === null) {
    throw new TypeError('canonicalRef must be a valid full Git ref');
  }
  const retainedHead = () => {
    if (!repositoryContext?.indexFile) return null;
    const text = UTF8.decode(readBoundedStableFile(join(dirname(repositoryContext.indexFile), 'HEAD'), 256,
      'retained-inventory-head'));
    const match = /^ref: (refs\/heads\/[^\x00-\x20]+)\n$/u.exec(text);
    if (!match || gitBytes(['check-ref-format', match[1]], root,
      { allowFail: true, repositoryContext }) === null) blocked('retained inventory HEAD is invalid');
    return match[1];
  };
  const retainedRef = retainedHead();
  const first = inventorySnapshot(root, canonicalRef, allowDetached, maxContentEntries, repositoryContext, retainedRef);
  const second = inventorySnapshot(root, canonicalRef, allowDetached, maxContentEntries, repositoryContext, retainedRef);
  const finalRoot = realpathSync(strictText(gitPath(['rev-parse', '--show-toplevel'], root,
    'repository root', repositoryContext), 'repository root'));
  const finalIdentity = lstatSync(finalRoot, { bigint: true, throwIfNoEntry: false });
  if (retainedHead() !== retainedRef || JSON.stringify(first) !== JSON.stringify(second)
    || finalRoot !== root || !finalIdentity
    || finalIdentity.dev !== rootIdentity.dev || finalIdentity.ino !== rootIdentity.ino) {
    blocked('repository state changed during recovery inventory collection',
      'blocked-recovery-inventory-race');
  }
  const { objectFormat: _objectFormat, porcelainV2Digest: _porcelain, ...result } = second;
  return frozen({ schema: RECOVERY_INVENTORY_SCHEMA, ...result });
}
