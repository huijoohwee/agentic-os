/** Bounded copy-only quarantine and explicitly conditional clean-source retirement. */

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertPathIdentity, assertPrivateDirectoryIdentity, captureExactTree,
  copyRegularFileExclusive, copySymlinkExclusive, pathIdentity, privateDirectoryIdentity,
  readPrivateFile, unlinkExactPath, writePrivateFileExclusive,
} from './file-integrity.mjs';

const states = new WeakMap();
const failure = (reason, message, detail, cause = null) =>
  Object.assign(new Error(message, cause ? { cause } : undefined), { reason, ...detail });

function assertRoot(identity) {
  try { return assertPrivateDirectoryIdentity(identity, 'quarantine root'); } catch (cause) {
    throw failure('blocked-quarantine-root-race', 'quarantine root identity changed', {
      quarantinePath: identity.path }, cause);
  }
}

function assertTree(root, paths, detail = { quarantinePath: root.path }) {
  try { return captureExactTree(root, paths, 'quarantine tree'); } catch (cause) {
    assertRoot(root);
    throw failure('blocked-quarantine-tree-race', 'quarantine tree has drift',
      { ...detail, treeDetail: cause.detail ?? null }, cause);
  }
}

function copyEntry(source, destination, maxBytes, detail) {
  try {
    const kind = pathIdentity(source, 'quarantine source').kind;
    if (kind === 'file') return copyRegularFileExclusive(source, destination,
      { maxBytes, label: 'quarantine regular-file copy' });
    if (kind === 'symlink') return copySymlinkExclusive(source, destination,
      { maxBytes, label: 'quarantine symlink copy' });
    throw new Error('quarantine source must be a regular file or symlink');
  } catch (cause) {
    throw failure(cause.code === 'EEXIST' ? 'blocked-quarantine-slot-occupied'
      : 'blocked-quarantine-copy', 'quarantine copy was not published', detail, cause);
  }
}

function expectedPaths(state) {
  return [...state.copied.map(({ slot }) => join(state.path, slot)),
    ...(state.manifestPath ? [state.manifestPath] : [])];
}

function verifyState(state) {
  assertRoot(state.root);
  assertTree(state.root, expectedPaths(state));
  state.copied.forEach(({ entry, slot }) => {
    if (!state.retired) assertPathIdentity(state.sources.get(slot), 'quarantine source');
    assertPathIdentity(state.slots.get(slot), 'quarantine destination');
    state.verify(entry, slot, state.path);
    assertRoot(state.root);
    if (!state.retired) assertPathIdentity(state.sources.get(slot), 'quarantine source');
    assertPathIdentity(state.slots.get(slot), 'quarantine destination');
  });
  if (state.manifestPath) {
    assertPathIdentity(state.manifestIdentity, 'quarantine manifest');
    if (!readPrivateFile(state.manifestPath, state.limits.maxManifestBytes,
      'quarantine manifest', state.root).equals(state.manifest))
      throw failure('blocked-quarantine-manifest-race', 'quarantine manifest bytes changed',
        { quarantinePath: state.path });
  }
  assertTree(state.root, expectedPaths(state));
  assertRoot(state.root);
  return true;
}

/** Copy sources into distinct private slots without renaming or unlinking any source path. */
export function copyWorktreeEntriesToQuarantine({
  name, entries, verify, sourceRoot, storageRoot, manifest = null, limits = null,
}) {
  const limitKeys = ['maxEntryBytes', 'maxAggregateBytes', 'maxManifestBytes'];
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(name ?? '')
    || !limits || limitKeys.some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 0))
    throw new TypeError('quarantine copy requires a safe name and explicit byte limits');
  if (!Array.isArray(entries) || typeof verify !== 'function'
    || manifest !== null && !Buffer.isBuffer(manifest))
    throw new TypeError('quarantine copy input is invalid');
  let path = null, root = null;
  try {
    path = mkdtempSync(join(storageRoot, `${name}-`));
    root = privateDirectoryIdentity(path, 'quarantine root');
    if (!root) throw new Error('quarantine root identity was not established');
  } catch (error) {
    if (path) Object.assign(error, { quarantinePath: path, quarantineEntryCount: 0,
      copiedBytes: 0, quarantineCopyResultUnknown: false,
      quarantineManifestPath: null, quarantineManifestPublished: false,
      quarantineManifestWriteAttempted: false,
      quarantineManifestWriteResultUnknown: false });
    throw error;
  }
  const copied = [], slots = new Map(), sources = new Map(), budget = { bytes: 0 };
  const manifestPath = manifest === null ? null : join(path, 'manifest.json');
  let manifestIdentity = null, copyAttemptedSlot = null, copyResultUnknown = false;
  let manifestWriteAttempted = false, manifestWriteResultUnknown = false;
  try {
    for (const entry of entries) {
      const slot = String(copied.length);
      const detail = { quarantinePath: path, quarantineSlot: slot, sourcePath: entry.path };
      assertRoot(root); assertTree(root, copied.map(({ slot: prior }) => join(path, prior)), detail);
      const remaining = limits.maxAggregateBytes - budget.bytes;
      if (remaining < 0) throw failure('blocked-quarantine-copy-limit',
        'quarantine aggregate byte limit exceeded', detail);
      copyAttemptedSlot = slot; copyResultUnknown = true;
      const copy = copyEntry(join(sourceRoot, entry.path), join(path, slot),
        Math.min(limits.maxEntryBytes, remaining), detail);
      copyResultUnknown = false;
      budget.bytes += copy.bytes; sources.set(slot, copy.source); slots.set(slot, copy.destination);
      copied.push(Object.freeze({ entry, path: entry.path, slot }));
      try { verify(entry, slot, path); } catch (error) { error.quarantinePath = path; throw error; }
      assertRoot(root); assertPathIdentity(copy.source, 'quarantine source');
      assertPathIdentity(copy.destination, 'quarantine destination');
      assertTree(root, copied.map(({ slot: prior }) => join(path, prior)), detail);
    }
    if (manifest !== null) { assertRoot(root);
      manifestWriteAttempted = true; manifestWriteResultUnknown = true;
      manifestIdentity = writePrivateFileExclusive(manifestPath, manifest,
        { maxBytes: limits.maxManifestBytes, label: 'quarantine manifest' });
      manifestWriteResultUnknown = false; }
    assertRoot(root); assertTree(root, [
      ...copied.map(({ slot }) => join(path, slot)), ...(manifestPath ? [manifestPath] : []),
    ]);
  } catch (error) {
    Object.assign(error, { quarantinePath: path, quarantineEntryCount: copied.length,
      copiedBytes: budget.bytes, quarantineFailedSlot: error.quarantineSlot
        ?? (copyResultUnknown ? copyAttemptedSlot : null),
      quarantineCopyResultUnknown: copyResultUnknown
        && error.reason !== 'blocked-quarantine-slot-occupied',
      quarantineManifestPath: manifestPath,
      quarantineManifestPublished: manifestIdentity !== null,
      quarantineManifestWriteAttempted: manifestWriteAttempted,
      quarantineManifestWriteResultUnknown: manifestWriteResultUnknown });
    throw error;
  }
  const state = { path, root, copied: Object.freeze(copied), slots, sources, budget,
    manifest, manifestPath, manifestIdentity, limits: Object.freeze({ ...limits }), verify,
    retired: false };
  const receipt = Object.freeze({ path, copied: state.copied, copyOnly: true,
    sourceRetired: false, copiedBytes: budget.bytes, manifestPath,
    verify: () => verifyState(state) });
  states.set(receipt, state);
  return receipt;
}

/** Retire only a clean copied projection under a named external namespace assertion. */
export function retireCleanProjectionUnderExclusiveContract(receipt, {
  exclusiveContract, inventoryCount,
} = {}) {
  const state = states.get(receipt);
  if (!state || inventoryCount !== 0
    || !/^agentic-os:canonical-sync:exclusive:[0-9a-f]{64}$/u.test(exclusiveContract ?? ''))
    throw new TypeError('clean projection retirement requires its copy receipt, empty inventory, and exact external exclusive contract');
  if (state.retired) throw failure('blocked-clean-projection-already-retired',
    'clean projection sources were already retired', { quarantinePath: state.path });
  verifyState(state);
  for (const source of state.sources.values()) assertPathIdentity(source, 'clean source');
  let retiredEntryCount = 0;
  try {
    for (const source of state.sources.values()) {
      unlinkExactPath(source, 'clean source'); retiredEntryCount += 1;
    }
    state.retired = true; verifyState(state);
  } catch (error) {
    Object.assign(error, { reason: error.reason ?? 'blocked-clean-projection-retirement',
      quarantinePath: state.path, retiredEntryCount, conditionalExternalExclusiveContract:
      exclusiveContract, operatingSystemExclusivityProven: false });
    throw error;
  }
  return Object.freeze({ schema: 'agentic-os/clean-projection-retirement/v1',
    conditionalExternalExclusiveContract: exclusiveContract,
    exclusivityBasis: 'external-assertion', operatingSystemExclusivityProven: false,
    sourceRetired: true, retiredEntryCount, quarantinePath: state.path,
    copyOnlyQuarantineRetained: true });
}
