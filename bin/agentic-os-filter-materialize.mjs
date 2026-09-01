#!/usr/bin/env node
/** Stream one checkout-filtered Git blob into an inherited staging descriptor. */

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';

const [path, oid, rawLimit] = process.argv.slice(2);
const limit = Number(rawLimit);
if (typeof path !== 'string' || path.includes('\0')
  || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid ?? '')
  || !Number.isSafeInteger(limit) || limit < 0) process.exit(2);

const grouped = process.platform !== 'win32';
const child = spawn('git', ['cat-file', '--filters', `--path=${path}`, oid], {
  detached: grouped,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bytes = 0;
let failed = false;
let failureCode = 1;
let stderrBytes = 0;
let hardExit = null;

function signal(name) {
  try { process.kill(grouped ? -child.pid : child.pid, name); } catch { /* already gone */ }
}
function stop(code = 1) {
  if (failed) return;
  failed = true;
  failureCode = code;
  signal('SIGTERM');
  hardExit = setTimeout(() => { signal('SIGKILL'); process.exit(failureCode); }, 250);
}

child.stdout.on('data', (chunk) => {
  if (failed) return;
  if (chunk.length > limit - bytes) { stop(3); return; }
  try {
    let offset = 0;
    while (offset < chunk.length) offset += writeSync(3, chunk, offset, chunk.length - offset);
    bytes += chunk.length;
  } catch { stop(); }
});
child.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
  if (stderrBytes > 64 * 1024) stop();
});
child.on('error', stop);

const timeout = setTimeout(stop, 30_000);
child.on('close', (code, childSignal) => {
  clearTimeout(timeout);
  if (hardExit !== null) clearTimeout(hardExit);
  if (failed || code !== 0 || childSignal !== null) process.exit(failureCode);
  process.exit(0);
});
