/** Lane cache codecs: strict legacy projection and immutable workspace records. */
import { isLaneRef } from './lane-id.mjs';

const ROOT_KEYS = new Set(['schema', 'lanes']);
const INVALID = Symbol('invalid legacy cache property');
const RECORD_KEYS = new Set([
  'ref', 'device', 'scope', 'state', 'base', 'baseSha', 'worktree', 'pr', 'createdAt',
  'head', 'handoff', 'mode', 'ejections',
]);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function enumerableValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : INVALID;
}

/**
 * Project the former non-authoritative `ejections` count only when the complete
 * legacy shape is otherwise an exact current-cache candidate. The caller still
 * validates the result with the current schema and never writes legacy bytes.
 */
export function projectLegacyLaneCache(value, schema) {
  if (!plainObject(value)) return null;
  const rootKeys = Reflect.ownKeys(value);
  if (rootKeys.length !== ROOT_KEYS.size || rootKeys.some((key) => !ROOT_KEYS.has(key))
    || enumerableValue(value, 'schema') !== schema) return null;
  const lanes = enumerableValue(value, 'lanes');
  if (!plainObject(lanes)) return null;
  const projected = { schema, lanes: Object.create(null) };
  let legacy = false;
  for (const ref of Reflect.ownKeys(lanes)) {
    if (typeof ref !== 'string' || !isLaneRef(ref)) return null;
    const record = enumerableValue(lanes, ref);
    if (!plainObject(record)) return null;
    const keys = Reflect.ownKeys(record);
    if (keys.some((key) => typeof key !== 'string' || !RECORD_KEYS.has(key))) return null;
    const ejections = enumerableValue(record, 'ejections');
    if (Object.hasOwn(record, 'ejections')) {
      if (!Number.isSafeInteger(ejections) || ejections < 0) return null;
      legacy = true;
    }
    const output = Object.create(null);
    for (const key of keys) {
      if (key === 'ejections') continue;
      const field = enumerableValue(record, key);
      if (field === INVALID) return null;
      output[key] = field;
    }
    projected.lanes[ref] = output;
  }
  return legacy ? projected : null;
}

/** Immutable local lane metadata; the caller retains Git CAS and schema authority. */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { commonDir, git, assertDirectoryAncestors } from './git.mjs';
import { readBoundedFile } from './catalog-input.mjs';
import { writePrivateFileExclusive } from './file-integrity.mjs';

export const WORKSPACE_CACHE_SCHEMA = 'agentic-os/lane-cache-workspace/v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(`lane cache workspace ${message}`), { reason: 'blocked-lane-cache-invalid' }); };
const TOTAL_BYTES = 8_000_000;
export function workspaceLaneCache(cwd) {
  const storage = git(['config', '--local', '--get-all', 'agentic-os.laneCacheStorage'], { cwd, allowFail: true });
  if (storage === null) return null;
  if (storage !== 'workspace-v1') fail('storage selection is invalid');
  const configured = git(['config', '--local', '--get-all', 'agentic-os.workspaceRoot'], { cwd, allowFail: true });
  if (configured !== null && (!configured || /[\r\n\x00]/u.test(configured))) fail('root is invalid');
  const common = commonDir(cwd);
  if (basename(common) !== '.git') fail('canonical layout required');
  const root = resolve(dirname(common), configured ?? '../.workspace'), clone = digest(common);
  const directory = join(root, '.local', 'lane-cache', clone);
  assertDirectoryAncestors(join(directory, 'entry'), sep, { allowMissing: true });
  return { directory, clone, root: digest(root) };
}
function readRecord(path, limit) {
  assertDirectoryAncestors(path, sep);
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))
    fail('record must be an owned single-link file');
  return readBoundedFile(path, limit, 'workspace lane record', { expectedIdentity: stat });
}
export function encodeWorkspaceLaneCache(store, cwd, limits) {
  const location = workspaceLaneCache(cwd);
  if (!location) return store;
  mkdirSync(location.directory, { recursive: true, mode: 0o700 });
  assertDirectoryAncestors(join(location.directory, 'entry'), sep);
  const owner = lstatSync(location.directory);
  if (typeof process.getuid === 'function' && owner.uid !== process.getuid() || (owner.mode & 0o022)) fail('directory must be private to its owner');
  const records = Object.create(null); let total = 0;
  for (const [ref, record] of Object.entries(store.lanes)) {
    const bytes = Buffer.from(JSON.stringify(record)); total += bytes.length;
    if (total > TOTAL_BYTES || bytes.length > limits.bytes) fail('record byte budget exceeded');
    const hash = digest(bytes), path = join(location.directory, `${hash}.json`);
    try { writePrivateFileExclusive(path, bytes, { maxBytes: limits.bytes, label: 'workspace lane record' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!readRecord(path, limits.bytes).equals(bytes)) fail('immutable record differs');
    records[ref] = { digest: hash, bytes: bytes.length };
  }
  return { schema: WORKSPACE_CACHE_SCHEMA, clone: location.clone, root: location.root, records };
}
export function decodeWorkspaceLaneCache(index, cwd, schema, limits) {
  const location = workspaceLaneCache(cwd);
  if (!location || index.clone !== location.clone || index.root !== location.root) fail('enrollment changed or missing');
  if (Object.keys(index).sort().join(',') !== 'clone,records,root,schema' || !index.records || Array.isArray(index.records)
    || typeof index.records !== 'object' || Object.keys(index.records).length > limits.lanes) fail('index shape is invalid');
  const lanes = Object.create(null); let total = 0;
  for (const [ref, entry] of Object.entries(index.records)) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'bytes,digest' || !/^[a-f0-9]{64}$/u.test(entry.digest)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > limits.bytes) fail('record reference is invalid');
    total += entry.bytes; if (total > TOTAL_BYTES) fail('aggregate byte budget exceeded');
    const bytes = readRecord(join(location.directory, `${entry.digest}.json`), entry.bytes);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.digest) fail('record digest differs');
    lanes[ref] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  return { schema, lanes };
}
