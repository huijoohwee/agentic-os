/**
 * Clone-common lane-state cache. This is explicitly non-authoritative: safety
 * decisions always recover from exact Git/provider observations, never cache bytes.
 */

import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { TextDecoder } from 'node:util';
import { readBoundedFile } from './catalog-input.mjs';
import { acquireDirectoryLock, finishOperationLock } from './file-integrity.mjs';
import { commonDir, git } from './git.mjs';
import { isLaneRef } from './lane-id.mjs';

export const SCHEMA = 'agentic-os/lanes/v1';
export const CACHE_REF = 'refs/agentic-os/cache/lanes-v1';
export const CACHE_LIMITS = Object.freeze({
  bytes: 500_000,
  lanes: 1_024,
  recordFields: 32,
  objectFields: 64,
  arrayEntries: 1_024,
  depth: 20,
  nodes: 50_000,
  stringBytes: 16_384,
  aggregateStringBytes: 400_000,
});
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const CACHE_LOCK_WAIT_MS = 30_000;
const CACHE_LOCK_PAUSE = new Int32Array(new SharedArrayBuffer(4));
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RECORD_FIELDS = new Set([
  'ref', 'device', 'scope', 'state', 'base', 'baseSha', 'worktree', 'pr', 'createdAt',
  'head', 'handoff', 'mode',
]);
const RECORD_STATES = new Set(['planned', 'active', 'published', 'queued', 'integrated']);
const STRING_FIELDS = new Set([
  'device', 'scope', 'base', 'baseSha', 'worktree', 'createdAt', 'head', 'mode',
]);

function invalid(message, cause) {
  return Object.assign(new Error(`lane cache ${message}`, cause ? { cause } : undefined), {
    reason: 'blocked-lane-cache-invalid',
  });
}
function publication(message, cause, detail = {}) {
  return Object.assign(new Error(`lane cache publication ${message}`, cause ? { cause } : undefined), {
    reason: 'blocked-lane-cache-publication', ...detail,
  });
}
function empty() {
  return { schema: SCHEMA, lanes: Object.create(null) };
}
function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function accountString(value, state) {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > CACHE_LIMITS.stringBytes) throw invalid('string byte budget exceeded');
  state.stringBytes += bytes;
  if (state.stringBytes > CACHE_LIMITS.aggregateStringBytes)
    throw invalid('aggregate string byte budget exceeded');
}
function cloneJson(value, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > CACHE_LIMITS.nodes) throw invalid('node budget exceeded');
  if (depth > CACHE_LIMITS.depth) throw invalid('depth budget exceeded');
  if (typeof value === 'string') {
    accountString(value, state);
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > CACHE_LIMITS.arrayEntries) throw invalid('array entry budget exceeded');
    const keys = Reflect.ownKeys(value);
    const expected = new Set(['length']);
    for (let index = 0; index < value.length; index += 1) expected.add(String(index));
    if (keys.length !== expected.size || keys.some((key) => !expected.has(key)))
      throw invalid('arrays must be dense data-only values');
    const cloned = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        throw invalid('arrays must be dense data-only values');
      cloned[index] = cloneJson(descriptor.value, state, depth + 1);
    }
    return cloned;
  }
  if (!plainObject(value)) throw invalid('records must contain plain JSON values');
  const keys = Reflect.ownKeys(value);
  if (keys.length > CACHE_LIMITS.objectFields) throw invalid('object field budget exceeded');
  if (keys.some((key) => typeof key !== 'string' || DANGEROUS_KEYS.has(key)))
    throw invalid('object key is unsafe');
  const cloned = Object.create(null);
  for (const key of keys) {
    accountString(key, state);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      throw invalid('objects must contain enumerable data properties');
    cloned[key] = cloneJson(descriptor.value, state, depth + 1);
  }
  return cloned;
}
function normalizeStore(value) {
  if (!plainObject(value)) throw invalid('root must be a plain object');
  const rootKeys = Reflect.ownKeys(value);
  if (rootKeys.length !== 2 || !rootKeys.includes('schema') || !rootKeys.includes('lanes'))
    throw invalid('root shape is invalid');
  const schema = Object.getOwnPropertyDescriptor(value, 'schema');
  const lanesProperty = Object.getOwnPropertyDescriptor(value, 'lanes');
  if (!schema?.enumerable || !Object.hasOwn(schema, 'value') || schema.value !== SCHEMA
    || !lanesProperty?.enumerable || !Object.hasOwn(lanesProperty, 'value')
    || !plainObject(lanesProperty.value)) throw invalid('schema is invalid');
  const lanes = lanesProperty.value;
  const refs = Reflect.ownKeys(lanes);
  if (refs.length > CACHE_LIMITS.lanes) throw invalid('lane count budget exceeded');
  if (refs.some((ref) => typeof ref !== 'string' || !isLaneRef(ref)))
    throw invalid('lane key is invalid');
  const state = { nodes: 0, stringBytes: 0 };
  const normalized = empty();
  for (const ref of refs) {
    accountString(ref, state);
    const descriptor = Object.getOwnPropertyDescriptor(lanes, ref);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      throw invalid('lane records must be enumerable data properties');
    const record = descriptor.value;
    const recordKeys = plainObject(record) ? Reflect.ownKeys(record) : [];
    if (!plainObject(record) || recordKeys.length > CACHE_LIMITS.recordFields
      || recordKeys.some((key) => typeof key !== 'string' || !RECORD_FIELDS.has(key)))
      throw invalid(`record shape is invalid for ${ref}`);
    const recordRef = Object.getOwnPropertyDescriptor(record, 'ref');
    if (!recordRef?.enumerable || !Object.hasOwn(recordRef, 'value') || recordRef.value !== ref)
      throw invalid(`record ref does not match ${ref}`);
    const stateProperty = Object.getOwnPropertyDescriptor(record, 'state');
    if (!stateProperty?.enumerable || !Object.hasOwn(stateProperty, 'value')
      || !RECORD_STATES.has(stateProperty.value)) throw invalid(`record state is invalid for ${ref}`);
    for (const field of STRING_FIELDS) {
      const property = Object.getOwnPropertyDescriptor(record, field);
      if (property && (!property.enumerable || !Object.hasOwn(property, 'value')
        || typeof property.value !== 'string')) throw invalid(`record ${field} is invalid for ${ref}`);
    }
    const pr = Object.getOwnPropertyDescriptor(record, 'pr');
    if (pr && (!pr.enumerable || !Object.hasOwn(pr, 'value')
      || pr.value !== null && (!Number.isSafeInteger(pr.value) || pr.value < 1)))
      throw invalid(`record pr is invalid for ${ref}`);
    const handoff = Object.getOwnPropertyDescriptor(record, 'handoff');
    if (handoff && (!handoff.enumerable || !Object.hasOwn(handoff, 'value')
      || handoff.value !== null && !plainObject(handoff.value)))
      throw invalid(`record handoff is invalid for ${ref}`);
    normalized.lanes[ref] = cloneJson(record, state);
  }
  return normalized;
}

export function storePath(cwd = process.cwd()) {
  return join(commonDir(cwd), 'agentic-os', 'lanes.json');
}

function sameIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.uid === right.uid && left.nlink === right.nlink
    && left.size === right.size && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}
function fileIdentity(path, label) {
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
    throw invalid(`must be a regular file with one direct link (${label})`);
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))
    throw invalid(`${label} must be owned by the current user`);
  return stat;
}
function parentIdentity(path) {
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw invalid(`directory is unsafe: ${path}`);
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))
    throw invalid(`directory must be owned by the current user: ${path}`);
  return stat;
}
function parseBytes(bytes) {
  let text;
  try { text = UTF8.decode(bytes); } catch (error) {
    throw invalid('must be UTF-8', error);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) {
    throw invalid('must be JSON', error);
  }
  return normalizeStore(parsed);
}
function directRefOid(cwd) {
  const symbolic = git(['symbolic-ref', '--quiet', CACHE_REF], { cwd, allowFail: true });
  if (symbolic !== null) throw invalid(`ref must be direct: ${CACHE_REF}`);
  const oid = git(['rev-parse', '--verify', '--end-of-options', CACHE_REF], {
    cwd, allowFail: true,
  });
  if (oid !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid))
    throw invalid(`ref target is malformed: ${CACHE_REF}`);
  if (git(['symbolic-ref', '--quiet', CACHE_REF], { cwd, allowFail: true }) !== null)
    throw invalid(`ref changed to symbolic during observation: ${CACHE_REF}`);
  return oid;
}
function legacySnapshot(cwd) {
  const file = storePath(cwd);
  const directory = dirname(file);
  const parent = parentIdentity(directory);
  const before = fileIdentity(file, 'legacy cache');
  if (!before) return Object.freeze({ file, directory, parent, identity: null, digest: null });
  let bytes;
  try {
    bytes = readBoundedFile(file, CACHE_LIMITS.bytes, 'lane cache', {
      expectedIdentity: before,
    });
  } catch (error) { throw invalid(error.message, error); }
  const after = fileIdentity(file, 'legacy cache');
  if (!sameIdentity(before, after)) throw invalid('legacy cache changed during observation');
  const parentAfter = parentIdentity(directory);
  if (parent && !sameIdentity(parent, parentAfter))
    throw invalid('legacy cache directory identity changed during observation');
  return Object.freeze({
    file, directory, parent, identity: before,
    digest: createHash('sha256').update(bytes).digest('hex'), bytes,
  });
}
function assertLegacySnapshot(expected, cwd) {
  const actual = legacySnapshot(cwd);
  const parentMatches = expected.parent === null ? actual.parent === null
    : sameIdentity(expected.parent, actual.parent);
  const fileMatches = expected.identity === null ? actual.identity === null
    : sameIdentity(expected.identity, actual.identity) && expected.digest === actual.digest;
  if (!parentMatches || !fileMatches) throw publication('legacy state drifted', null, {
    legacyPath: expected.file, legacyExpectedDigest: expected.digest,
    legacyCurrentDigest: actual.digest,
  });
}
function loadSnapshot(cwd) {
  const before = directRefOid(cwd);
  if (before === null) {
    const legacy = legacySnapshot(cwd);
    const after = directRefOid(cwd);
    if (after !== null) throw invalid(`ref appeared during legacy observation: ${CACHE_REF}`);
    return Object.freeze({
      store: legacy.bytes ? parseBytes(legacy.bytes) : empty(),
      cursor: Object.freeze({ oid: null, legacy }),
    });
  }
  let bytes;
  try {
    if (git(['cat-file', '-t', before], { cwd }) !== 'blob')
      throw new Error('target is not a blob');
    bytes = git(['cat-file', 'blob', before], {
      cwd, binary: true, maxBuffer: CACHE_LIMITS.bytes + 1,
    });
  } catch (error) { throw invalid(`ref target is unreadable: ${CACHE_REF}`, error); }
  if (bytes.length > CACHE_LIMITS.bytes) throw invalid('byte budget exceeded');
  const computed = git(['hash-object', '--stdin'], { cwd, input: bytes });
  if (computed !== before) throw invalid(`ref blob identity mismatch: ${CACHE_REF}`);
  const after = directRefOid(cwd);
  if (after !== before) throw invalid(`ref changed during observation: ${CACHE_REF}`);
  return Object.freeze({
    store: parseBytes(bytes), cursor: Object.freeze({ oid: before, legacy: null }),
  });
}

/** Missing cache is normal recovery; every present invalid cache fails loudly. */
export function load(cwd = process.cwd()) {
  return loadSnapshot(cwd).store;
}

/** Publish one immutable blob through an exact, direct-ref compare-and-swap. */
function publish(value, cwd, expected, artifacts = null) {
  const store = normalizeStore(value);
  const bytes = Buffer.from(`${JSON.stringify(store, null, 2)}\n`);
  if (bytes.length > CACHE_LIMITS.bytes) throw invalid('write byte budget exceeded');
  const candidateOid = git(['hash-object', '-w', '--stdin'], { cwd, input: bytes });
  if (artifacts) Object.assign(artifacts, {
    candidateOid, candidateObjectWritten: true, effectsRetained: true,
  });
  const detail = {
    cacheRef: CACHE_REF, expectedOid: expected.oid, candidateOid,
    retainedLegacyPath: expected.legacy?.file ?? null,
  };
  let observed;
  try { observed = directRefOid(cwd); } catch (error) {
    throw publication('ref became unreadable before compare-and-swap', error, detail);
  }
  if (observed !== expected.oid) throw publication('ref drifted before compare-and-swap', null, {
    ...detail, currentOid: observed,
  });
  if (expected.legacy) try { assertLegacySnapshot(expected.legacy, cwd); } catch (error) {
    throw publication('legacy state drifted before compare-and-swap', error, detail);
  }
  const format = git(['rev-parse', '--show-object-format'], { cwd });
  if (format !== 'sha1' && format !== 'sha256')
    throw publication(`unsupported object format: ${format}`, null, detail);
  const zero = '0'.repeat(format === 'sha256' ? 64 : 40);
  try {
    git(['update-ref', '--no-deref', CACHE_REF, candidateOid, expected.oid ?? zero], { cwd });
  } catch (error) {
    let currentOid = null;
    try { currentOid = directRefOid(cwd); } catch { currentOid = 'unreadable'; }
    throw publication('compare-and-swap failed; candidate blob retained', error, {
      ...detail, currentOid,
    });
  }
  if (artifacts) artifacts.refPublished = true;
  let currentOid;
  try { currentOid = directRefOid(cwd); } catch (error) {
    throw publication('ref became unreadable after compare-and-swap', error, {
      ...detail, currentOid: 'unreadable', published: true,
    });
  }
  if (currentOid !== candidateOid) throw publication('ref drifted after compare-and-swap', null, {
    ...detail, currentOid, published: true,
  });
  if (expected.legacy) try { assertLegacySnapshot(expected.legacy, cwd); } catch (error) {
    throw publication('legacy state drifted after compare-and-swap', error, {
      ...detail, currentOid, published: true,
    });
  }
  return Object.freeze({ ref: CACHE_REF, oid: candidateOid });
}

export function save(value, cwd = process.cwd()) {
  return publish(value, cwd, loadSnapshot(cwd).cursor);
}

export function get(ref, cwd = process.cwd()) {
  return load(cwd).lanes[ref] ?? null;
}

/** Serialize cache read-modify-write across every worktree and cooperating device. */
function mutate(cwd, operation) {
  const artifacts = {
    effectsRetained: false, cacheRef: CACHE_REF,
    legacyCachePath: storePath(cwd), candidateOid: null,
    candidateObjectWritten: false, refPublished: false,
  };
  const lockPath = join(commonDir(cwd), 'agentic-os-lane-cache.lock');
  const deadline = Date.now() + CACHE_LOCK_WAIT_MS;
  let lock = acquireDirectoryLock(lockPath);
  while (!lock && Date.now() < deadline) {
    Atomics.wait(CACHE_LOCK_PAUSE, 0, 0, 20);
    lock = acquireDirectoryLock(lockPath);
  }
  if (!lock) {
    throw Object.assign(new Error('lane cache update lock remained busy'), {
      reason: 'blocked-concurrent-lane-cache',
    });
  }
  let result;
  let error = null;
  try { result = operation(artifacts); } catch (caught) { error = caught; }
  return finishOperationLock(lock, {
    label: 'lane-cache', result, error, artifacts,
  });
}

export function put(record, cwd = process.cwd()) {
  return mutate(cwd, (artifacts) => {
    const { store, cursor } = loadSnapshot(cwd);
    store.lanes[record.ref] = { ...store.lanes[record.ref], ...record };
    publish(store, cwd, cursor, artifacts);
    return store.lanes[record.ref];
  });
}

/** Best-effort projection after authoritative Git/provider effects have completed. */
export function project(record, cwd = process.cwd()) {
  try { return Object.freeze({ ok: true, record: put(record, cwd) }); } catch (error) {
    return Object.freeze({ ok: false, error });
  }
}

export function remove(ref, cwd = process.cwd()) {
  return mutate(cwd, (artifacts) => {
    const { store, cursor } = loadSnapshot(cwd);
    delete store.lanes[ref];
    publish(store, cwd, cursor, artifacts);
  });
}

export function list(cwd = process.cwd()) {
  return Object.values(load(cwd).lanes);
}

export function newRecord({ ref, device, scope, base, baseSha, worktree }) {
  return {
    ref, device, scope, state: 'planned', base, baseSha, worktree, pr: null,
    createdAt: new Date().toISOString(),
  };
}
