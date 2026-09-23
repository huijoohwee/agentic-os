#!/usr/bin/env node
/** Bounded raw Git hashing over inherited stable descriptors. No repository code executes. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TRACKED_FILE_LIMITS = Object.freeze({ rawComparisonBytes: 32 * 1024 * 1024 });
export const RAW_BATCH_LIMITS = Object.freeze({ files: 32, bytes: 32 * 1024 * 1024, timeoutMs: 7_000 });
const HELPER = fileURLToPath(import.meta.url);
const validOid = oid => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid ?? '');

function sameRawNode(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function childEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('GIT_') || upper === 'NODE_OPTIONS' || upper === 'NODE_PATH')
      delete environment[key];
  }
  return environment;
}

/** Each batch has its own hard deadline; no result survives a partial or failed child. */
export function rawTrackedFilesMatch(requests) {
  const results = requests.map(() => false);
  let batch = [], bytes = 0;
  const release = () => {
    const owned = batch; batch = []; bytes = 0;
    let uncertain = false;
    for (const { source } of owned) {
      try { closeSync(source); } catch { uncertain = true; }
    }
    if (uncertain) for (const { index } of owned) results[index] = false;
  };
  const flush = () => {
    if (batch.length === 0) return;
    try {
      const input = JSON.stringify(batch.map(({ request, opened }) => ({
        oid: request.oid, size: Number(opened.size),
      })));
      const compared = spawnSync(process.execPath, [HELPER, '--batch'], {
        cwd: batch[0].request.cwd, env: childEnvironment(), input,
        stdio: ['pipe', 'pipe', 'ignore', ...batch.map(({ source }) => source)],
        timeout: RAW_BATCH_LIMITS.timeoutMs, killSignal: 'SIGKILL',
        maxBuffer: RAW_BATCH_LIMITS.files,
      });
      const output = compared.stdout;
      const complete = compared.status === 0 && compared.signal === null && !compared.error
        && Buffer.isBuffer(output) && output.length === batch.length
        && output.every(value => value === 48 || value === 49);
      batch.forEach(({ request, opened, source, index }, position) => {
        try {
          const afterOpen = fstatSync(source, { bigint: true });
          const afterPath = lstatSync(request.absolute, { bigint: true, throwIfNoEntry: false });
          const mode = afterOpen.mode & 0o111n ? '100755' : '100644';
          results[index] = complete && output[position] === 49 && mode === request.mode
            && sameRawNode(opened, afterOpen) && sameRawNode(afterOpen, afterPath);
        } catch { results[index] = false; }
      });
    } catch { /* Unavailable or malformed comparison remains false for the whole batch. */ }
    finally { release(); }
  };
  try {
    requests.forEach((request, index) => {
      if (batch.length === RAW_BATCH_LIMITS.files
        || batch.length && request.cwd !== batch[0].request.cwd) flush();
      let source = null;
      try {
        if (typeof request.path !== 'string' || request.path.includes('\0') || !validOid(request.oid)) return;
        source = openSync(request.absolute, constants.O_RDONLY | constants.O_NONBLOCK
          | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(source, { bigint: true });
        if (!opened.isFile() || !sameRawNode(request.before, opened)
          || opened.size > BigInt(TRACKED_FILE_LIMITS.rawComparisonBytes)) return;
        const size = Number(opened.size);
        if (batch.length && size > RAW_BATCH_LIMITS.bytes - bytes) flush();
        batch.push({ request, opened, source, index }); bytes += size; source = null;
      } catch { /* A raced, missing, or unsupported source is a mismatch. */ }
      finally { if (source !== null) closeSync(source); }
    });
    flush();
  } finally { release(); }
  return results;
}

export function rawTrackedFileMatches(request) { return rawTrackedFilesMatch([request])[0]; }

function descriptorMatches(descriptor, oid, limit, buffer, expectedSize = null) {
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.size > BigInt(limit)
      || expectedSize !== null && stat.size !== BigInt(expectedSize)) return false;
    const hash = createHash(oid.length === 40 ? 'sha1' : 'sha256');
    hash.update(`blob ${stat.size}\0`);
    let position = 0;
    while (position < Number(stat.size)) {
      const count = readSync(descriptor, buffer, 0,
        Math.min(buffer.length, Number(stat.size) - position), position);
      if (count === 0) return false;
      hash.update(buffer.subarray(0, count)); position += count;
    }
    if (readSync(descriptor, buffer, 0, 1, position) !== 0) return false;
    return hash.digest('hex') === oid;
  } catch { return false; }
}

function main() {
  if (process.argv[2] !== '--batch') {
    const [path, oid, rawLimit] = process.argv.slice(2), limit = Number(rawLimit);
    if (typeof path !== 'string' || path.includes('\0') || !validOid(oid)
      || !Number.isSafeInteger(limit) || limit < 0) return 2;
    return descriptorMatches(3, oid, limit, Buffer.allocUnsafe(64 * 1024)) ? 0 : 1;
  }
  try {
    const input = Buffer.alloc(4_097);
    let size = 0;
    for (;;) {
      const count = readSync(0, input, size, input.length - size, null);
      if (count === 0) break;
      size += count;
      if (size === input.length) return 2;
    }
    const entries = JSON.parse(input.subarray(0, size).toString('utf8'));
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > RAW_BATCH_LIMITS.files
      || entries.some(entry => !entry || Object.keys(entry).sort().join(',') !== 'oid,size'
        || !validOid(entry.oid) || !Number.isSafeInteger(entry.size) || entry.size < 0
        || entry.size > TRACKED_FILE_LIMITS.rawComparisonBytes)
      || entries.reduce((total, entry) => total + entry.size, 0) > RAW_BATCH_LIMITS.bytes) return 2;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const output = entries.map((entry, index) => descriptorMatches(
      index + 3, entry.oid, TRACKED_FILE_LIMITS.rawComparisonBytes, buffer, entry.size) ? '1' : '0').join('');
    process.stdout.write(output);
    return 0;
  } catch { return 2; }
}

if (process.argv[1] && resolve(process.argv[1]) === HELPER) process.exitCode = main();
