/** On-demand Node build primitives. Receipts reuse verified outputs, never authority. */
import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, opendirSync,
  realpathSync, mkdirSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { acquireDirectoryLock, finishOperationLock } from '../src/file-integrity.mjs';

export const GENERATION_LIMITS = Object.freeze({ maxEntries: 10000, maxBytes: 256 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024, maxDepth: 32, timeoutMs: 30000, maxOutputBytes: 499999 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(`blocked-generation-${reason}`); };
const metadata = path => lstatSync(path, { bigint: true, throwIfNoEntry: false });
const same = (a, b) => a && b && ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs']
  .every(key => a[key] === b[key]);
function limits(options = {}) {
  const value = { ...GENERATION_LIMITS, ...options };
  for (const key of Object.keys(GENERATION_LIMITS))
    if (!Number.isSafeInteger(value[key]) || value[key] < 1) fail(`invalid-${key}`);
  return value;
}
function directory(path) {
  const stat = metadata(path);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) fail('directory-alias');
  return stat;
}
function ensureDirectory(path) {
  if (!metadata(path)) { ensureDirectory(dirname(path)); mkdirSync(path, { mode: 0o700 }); }
  return directory(path);
}
function deadline(end) { if (performance.now() > end) fail('time-budget'); }
function fileDigest(path, maxBytes, end) {
  const before = metadata(path);
  if (!before?.isFile() || before.isSymbolicLink()) fail('regular-file-required');
  if (before.size > BigInt(maxBytes)) fail('file-byte-budget');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024); let bytes = 0;
  try {
    if (!same(before, fstatSync(fd, { bigint: true }))) fail('file-drift');
    while (true) {
      deadline(end);
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count; if (bytes > maxBytes) fail('file-byte-budget');
      digest.update(buffer.subarray(0, count));
    }
    if (!same(before, fstatSync(fd, { bigint: true })) || !same(before, metadata(path))) fail('file-drift');
  } finally { closeSync(fd); }
  return { bytes, sha256: digest.digest('hex') };
}

/** Stream a deterministic manifest with bounded traversal, bytes, depth and elapsed time.
 * Exclusions are exact relative paths (and descendants); no implicit source exclusions.
 * This is an observed snapshot, not a filesystem transaction or release authorization.
 */
export function generationManifest(root, { paths = ['.'], exclude = [], ...options } = {}) {
  root = resolve(root); directory(root);
  const cap = limits(options), end = performance.now() + cap.timeoutMs;
  const validPath = path => typeof path === 'string' && path && !isAbsolute(path)
    && !path.split(/[\\/]/u).includes('..') && !path.includes('\0');
  if (![paths, exclude].every(list => Array.isArray(list) && list.length <= cap.maxEntries
    && list.every(validPath))) fail('invalid-paths');
  const omitted = exclude.map(path => relative(root, resolve(root, path)).split('\\').join('/'));
  const seen = new Set(), files = []; let entries = 0, bytes = 0;
  function visit(path, depth) {
    deadline(end);
    const name = relative(root, path).split('\\').join('/');
    if (omitted.some(value => name === value || name.startsWith(`${value}/`)) || seen.has(name)) return;
    seen.add(name);
    if (++entries > cap.maxEntries || depth > cap.maxDepth) fail('entry-depth-budget');
    const before = metadata(path);
    if (!before || before.isSymbolicLink()) fail('missing-or-aliased-input');
    if (before.isDirectory()) {
      directory(path);
      const dir = opendirSync(path);
      try { for (let entry; (entry = dir.readSync());) visit(join(path, entry.name), depth + 1); }
      finally { dir.closeSync(); }
      if (!same(before, metadata(path))) fail('directory-drift');
    } else {
      directory(dirname(path));
      const remaining = Math.min(cap.maxFileBytes, cap.maxBytes - bytes);
      if (remaining < 0 || before.size > BigInt(remaining)) fail('input-byte-budget');
      const file = fileDigest(path, remaining, end); bytes += file.bytes;
      files.push({ path: name, ...file, executable: Boolean(before.mode & 0o111n) });
    }
  }
  for (const path of paths) visit(resolve(root, path), 0);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, entries, bytes, digest: hash(JSON.stringify(files)) };
}

/** Include producer/tool/config inputs in value; platform identity is always bound. */
export function generationKey(value) {
  const encoded = JSON.stringify({ schema: 'agentic-os/generation-key/v1', value,
    node: process.version, platform: process.platform, arch: process.arch });
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) fail('key-byte-budget');
  return hash(encoded);
}
function outputState(path, cap, end) {
  const stat = metadata(path);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail('output-alias');
  return { stat, ...fileDigest(path, cap, end) };
}
function atomicWrite(path, bytes, maxBytes, end) {
  if (bytes.length > maxBytes) fail('output-byte-budget');
  const parent = directory(dirname(path)), before = outputState(path, maxBytes, end);
  const sha256 = hash(bytes);
  if (before?.sha256 === sha256) return { bytes: bytes.length, sha256, written: false };
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    deadline(end);
    const currentParent = directory(dirname(path));
    if (currentParent.dev !== parent.dev || currentParent.ino !== parent.ino) fail('directory-drift');
    const current = metadata(path);
    if (before ? !same(before.stat, current) : current) fail('output-drift');
    renameSync(temporary, path);
  } finally { if (metadata(temporary)) unlinkSync(temporary); }
  return { bytes: bytes.length, sha256, written: true };
}
function withOutputLock(destination, action) {
  destination = resolve(destination); ensureDirectory(dirname(destination));
  const lock = acquireDirectoryLock(`${destination}.generation.lock`);
  if (!lock) fail('output-busy');
  return Promise.resolve().then(action).then(result => finishOperationLock(lock,
    { label: 'generation', result }), error => finishOperationLock(lock, { label: 'generation', error }));
}

/** Publish only a complete bounded buffer; identical bytes keep their existing mtime. */
export function writeGeneratedFile(destination, value, options = {}) {
  const cap = limits(options), end = performance.now() + cap.timeoutMs;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes.length > cap.maxOutputBytes) fail('output-byte-budget');
  destination = resolve(destination);
  return withOutputLock(destination, () => atomicWrite(destination, bytes, cap.maxOutputBytes, end));
}

/** One receipt per declared output; no payload copies, historical keys, timers or eviction.
 * inputs() must observe all producer inputs afresh. produce({signal}) returns bytes, never writes.
 * Caller owns the generated output and receipt paths. Never use this for effect authorization.
 */
export async function generateFile({ destination, receipt, inputs, produce, ...options }) {
  const cap = limits(options), end = performance.now() + cap.timeoutMs;
  destination = resolve(destination); receipt = resolve(receipt);
  if (receipt === destination || receipt === `${destination}.generation.lock`) fail('receipt-path');
  if (typeof inputs !== 'function' || typeof produce !== 'function') fail('callbacks-required');
  return withOutputLock(destination, async () => {
    ensureDirectory(dirname(receipt));
    const key = generationKey(await inputs()); deadline(end);
    let prior = null;
    if (metadata(receipt)) {
      outputState(receipt, 16384, end);
      try { prior = JSON.parse(readBoundedFile(receipt, 16384, 'generation receipt')); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    const existing = outputState(destination, cap.maxOutputBytes, end);
    if (prior?.schema === 'agentic-os/generation-receipt/v1' && prior.key === key
      && prior.destination === destination && prior.sha256 === existing?.sha256 && prior.bytes === existing?.bytes) {
      if (generationKey(await inputs()) !== key) fail('input-drift');
      if (outputState(destination, cap.maxOutputBytes, end)?.sha256 !== existing.sha256) fail('output-drift');
      deadline(end);
      return { ...prior, reused: true, written: false };
    }
    const controller = new AbortController(); let timer;
    try {
      const value = await Promise.race([Promise.resolve().then(() => produce({ signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('blocked-generation-time-budget'));
        }, Math.max(1, end - performance.now())); })]);
      deadline(end);
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (bytes.length > cap.maxOutputBytes) fail('output-byte-budget');
      if (generationKey(await inputs()) !== key) fail('input-drift');
      const output = atomicWrite(destination, bytes, cap.maxOutputBytes, end);
      const result = { schema: 'agentic-os/generation-receipt/v1', key, destination,
        sha256: output.sha256, bytes: output.bytes };
      atomicWrite(receipt, Buffer.from(`${JSON.stringify(result)}\n`), 16384, end);
      return { ...result, reused: false, written: output.written };
    } finally { clearTimeout(timer); }
  });
}
