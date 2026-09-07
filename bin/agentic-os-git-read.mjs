/** A disposable process group bounds remote ref reads without changing mutation semantics. */
import { spawn, spawnSync } from 'node:child_process';
import { readSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(import.meta.url);
export const REMOTE_READ_TIMEOUT_MS = 15_000;
const MAX_BYTES = 65_536;
const terminate = pid => {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'],
      { timeout: 1000, stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
};

export function boundedGitRead(args, options, timeoutMs = REMOTE_READ_TIMEOUT_MS) {
  if (args[0] !== 'ls-remote' || !Number.isInteger(timeoutMs) || timeoutMs < 100
    || timeoutMs > REMOTE_READ_TIMEOUT_MS) throw new TypeError('invalid remote read deadline or command');
  const maximum = Math.min(options.maxBuffer, MAX_BYTES);
  const input = JSON.stringify({ args, timeoutMs, maximum });
  if (Buffer.byteLength(input) > MAX_BYTES) throw new TypeError('remote read arguments exceed byte limit');
  const env = { ...options.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const result = process.platform !== 'win32' ? spawnSync('git', args, {
    ...options, encoding: null, maxBuffer: maximum,
    detached: true, timeout: timeoutMs, killSignal: 'SIGKILL',
  }) : spawnSync(process.execPath, [WORKER, '--worker'], {
    cwd: options.cwd, env, input, encoding: null, detached: process.platform !== 'win32',
    timeout: timeoutMs + 2000, killSignal: 'SIGKILL', maxBuffer: maximum + 1024,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  // Also drain helpers whose leader exited or whose supervisor hit its watchdog.
  let cleanupError;
  try { terminate(result.pid); } catch (error) { cleanupError = error; }
  if (result.error || result.status !== 0 || cleanupError) throw Object.assign(
    new Error(result.error?.message ?? 'remote Git read failed'),
    { status: result.status, stderr: [result.error?.code === 'ETIMEDOUT'
      ? `remote Git read timed out after ${timeoutMs}ms`
      : result.error?.code === 'ENOBUFS' ? 'remote Git read exceeded output byte limit'
      : result.stderr?.toString() || result.error?.message || 'remote read terminated',
      cleanupError && `transport cleanup failed: ${cleanupError.code}`].filter(Boolean).join('\n') },
  );
  return options.encoding ? result.stdout.toString(options.encoding) : result.stdout;
}

function worker() {
  const request = Buffer.alloc(MAX_BYTES + 1);
  let length = 0;
  while (length < request.length) {
    const count = readSync(0, request, length, request.length - length, null);
    if (!count) break;
    length += count;
  }
  if (length > MAX_BYTES) throw new Error('remote read arguments exceed byte limit');
  const { args, timeoutMs, maximum } = JSON.parse(request.subarray(0, length));
  if (!Array.isArray(args) || args[0] !== 'ls-remote' || !args.every(arg => typeof arg === 'string')
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > REMOTE_READ_TIMEOUT_MS
    || !Number.isInteger(maximum) || maximum < 1 || maximum > MAX_BYTES) throw new Error('invalid remote read request');
  const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const buffers = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
  const stop = reason => { writeSync(2, reason + '\n'); terminate(process.pid); process.exit(1); };
  const timer = setTimeout(() => stop(`remote Git read timed out after ${timeoutMs}ms`), timeoutMs);
  for (const channel of ['stdout', 'stderr']) child[channel].on('data', chunk => {
    sizes[channel] += chunk.length;
    if (sizes[channel] > maximum) return stop('remote Git read exceeded output byte limit');
    buffers[channel].push(chunk);
  });
  child.once('error', error => { clearTimeout(timer); writeSync(2, error.message); process.exitCode = 1; });
  child.once('close', code => {
    clearTimeout(timer);
    // Partial advertisements never escape a failed or interrupted read.
    if (code === 0) writeSync(1, Buffer.concat(buffers.stdout));
    else writeSync(2, Buffer.concat(buffers.stderr));
    process.exitCode = Number.isInteger(code) && code >= 0 ? code : 1;
  });
}
if (process.argv[1] === WORKER && process.argv[2] === '--worker') {
  try { worker(); } catch (error) { writeSync(2, error.message + '\n'); process.exitCode = 1; }
}
