/** Newline-delimited stdio framing, dual-era selection, concurrency, and cancellation. */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  errorResponse, handleRequest, hasModernMetadata, hasValidModernMetadata,
} from './mcp-server.mjs';

export const MAX_LINE_BYTES = 256 * 1024;
export const MAX_IN_FLIGHT = 8;
export const CLI_TIMEOUT_MS = 60_000;
export const CLI_OUTPUT_BYTES = 256 * 1024;
const CLI_KILL_GRACE_MS = 1_000;
const CLI_PATH = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function abortError() {
  const error = new Error('operation aborted'); error.name = 'AbortError'; return error;
}

/** Execute the existing CLI with an argument array and bounded process-group resources. */
export function runCli(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUT_MS;
  const effectful = options.effectful === true;
  const signal = effectful ? null : options.signal;
  const isolatedProcessGroup = process.platform !== 'win32';
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(process.execPath, [CLI_PATH, ...argv], {
      cwd, detached: isolatedProcessGroup, env: options.env ?? process.env,
      shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', finished = false, forcedReason = '', killTimer;
    const terminate = (terminationSignal) => {
      if (isolatedProcessGroup && Number.isInteger(child.pid)) {
        try { process.kill(-child.pid, terminationSignal); return; }
        catch (error) { if (error.code === 'ESRCH') return; }
      }
      try { child.kill(terminationSignal); } catch { /* the child already exited */ }
    };
    const finish = (callback, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel); callback(value);
    };
    const stop = (reason) => {
      if (forcedReason) return;
      forcedReason = reason; terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), CLI_KILL_GRACE_MS);
      killTimer.unref?.();
    };
    const append = (channel, chunk) => {
      const current = channel === 'stdout' ? stdout : stderr;
      const next = current + chunk;
      if (Buffer.byteLength(next) > CLI_OUTPUT_BYTES) {
        stop(`${channel} exceeded ${CLI_OUTPUT_BYTES} bytes`); return;
      }
      if (channel === 'stdout') stdout = next; else stderr = next;
    };
    const cancel = () => stop('operation cancelled');
    const timer = setTimeout(() => stop(`command timed out after ${timeoutMs}ms`), timeoutMs);
    timer.unref?.(); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (forcedReason) terminate('SIGKILL');
      if (signal?.aborted) return finish(reject, abortError());
      if (forcedReason)
        stderr += `${stderr.endsWith('\n') || stderr.length === 0 ? '' : '\n'}${forcedReason}\n`;
      const result = { exitCode: Number.isInteger(code) ? code : 1, stdout, stderr };
      if (effectful && forcedReason) Object.assign(result, {
        writeResultUnknown: true, terminationReason: forcedReason,
      });
      finish(resolve, result);
    });
    return undefined;
  });
}

const validId = (value) => typeof value === 'string' || Number.isSafeInteger(value);
const idKey = (id) => `${typeof id}:${String(id)}`;
const objectMessage = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const notification = (message, method) => objectMessage(message) && message.jsonrpc === '2.0'
  && message.method === method && !('id' in message)
  && (!('params' in message) || objectMessage(message.params));

export function createLineFramer({ onLine, onOversize, maxBytes = MAX_LINE_BYTES }) {
  let buffer = '';
  let discarding = false;

  const emit = (line) => {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (Buffer.byteLength(clean) > maxBytes) onOversize();
    else onLine(clean);
  };

  return {
    push(chunk) {
      let text = String(chunk);
      while (text.length > 0) {
        const newline = text.indexOf('\n');
        if (discarding) {
          if (newline === -1) return;
          discarding = false;
          text = text.slice(newline + 1);
          continue;
        }
        if (newline === -1) {
          buffer += text;
          if (Buffer.byteLength(buffer) > maxBytes) {
            buffer = '';
            discarding = true;
            onOversize();
          }
          return;
        }
        emit(buffer + text.slice(0, newline));
        buffer = '';
        text = text.slice(newline + 1);
      }
    },
    end() {
      if (!discarding && buffer.length > 0) emit(buffer);
      buffer = '';
      discarding = false;
    },
  };
}

/** One stdio-process connection. Modern is stateless; initialize pins legacy semantics. */
export function createConnection(options = {}) {
  const write = options.write ?? (() => {});
  const active = new Map();
  const pending = new Set();
  const maxInFlight = Number.isSafeInteger(options.maxInFlight) && options.maxInFlight > 0
    ? options.maxInFlight
    : MAX_IN_FLIGHT;
  let era = 'unselected';
  let legacyPhase = 'none';
  let closed = false;

  const track = (promise) => {
    pending.add(promise);
    promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
  };
  const emit = (message) => Promise.resolve(write(message));
  const emitError = (id, code, message, data) => {
    const task = emit(errorResponse(id, { code, message, data }));
    track(task);
  };

  const cancel = (message) => {
    const requestId = message?.params?.requestId;
    if (!validId(requestId)) return;
    const entry = active.get(idKey(requestId));
    if (!entry) return;
    entry.cancelled = true;
    if (!entry.mustDeliver) entry.controller.abort();
  };

  const receive = (message) => {
    if (closed) return;
    if (notification(message, 'notifications/cancelled')) {
      if (era === 'modern' && !hasValidModernMetadata(message)) return;
      if (era === 'legacy' && hasModernMetadata(message)) return;
      cancel(message);
      return;
    }
    if (notification(message, 'notifications/initialized')) {
      if (era === 'legacy' && legacyPhase === 'responded') legacyPhase = 'ready';
      return;
    }

    if (era === 'unselected') {
      if (objectMessage(message) && message.method === 'initialize' && 'id' in message) era = 'legacy';
      else if (hasModernMetadata(message)) era = 'modern';
    } else if (era === 'legacy' && hasModernMetadata(message)) {
      emitError(message?.id, -32600, 'Modern and legacy MCP cannot be interleaved in one stdio process');
      return;
    }

    const id = validId(message?.id) ? message.id : undefined;
    const key = id === undefined ? null : idKey(id);
    if (key && active.has(key)) {
      emitError(id, -32600, 'Duplicate in-flight request ID');
      return;
    }
    if (key && active.size >= maxInFlight) {
      emitError(id, -31000, `Too many in-flight requests; limit is ${maxInFlight}`);
      return;
    }

    const reservesInitialize = era === 'legacy' && message?.method === 'initialize'
      && (legacyPhase === 'none' || legacyPhase === 'failed');
    if (reservesInitialize) legacyPhase = 'pending';

    const controller = new AbortController();
    const entry = { controller, cancelled: false, mustDeliver: false };
    if (key) active.set(key, entry);
    const selectedEra = era === 'legacy' ? 'legacy' : 'modern';
    const task = handleRequest(message, {
      era: selectedEra,
      allowInitialize: reservesInitialize,
      legacyReady: legacyPhase === 'ready',
      runCli: options.runCli ?? runCli,
      cwd: options.cwd,
      signal: controller.signal,
      onEffectful: () => { entry.mustDeliver = true; },
    }).then(async (response) => {
      if ((!entry.cancelled || entry.mustDeliver) && response) await emit(response);
      if (reservesInitialize) {
        legacyPhase = !entry.cancelled && response?.result ? 'responded' : 'failed';
      }
    }).finally(() => {
      if (key) active.delete(key);
    });
    track(task);
  };

  const receiveLine = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      emitError(undefined, -32700, 'Parse error');
      return;
    }
    receive(message);
  };

  return {
    receive,
    receiveLine,
    get era() { return era; },
    async idle() {
      await Promise.allSettled([...pending]);
    },
    async close() {
      closed = true;
      for (const entry of active.values()) {
        entry.cancelled = true;
        if (!entry.mustDeliver) entry.controller.abort();
      }
      await Promise.allSettled([...pending]);
    },
  };
}

export async function serveStdio(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const write = async (message) => {
    if (!output.write(`${JSON.stringify(message)}\n`)) await once(output, 'drain');
  };
  const connection = createConnection({ ...options, write });
  const framer = createLineFramer({
    onLine: connection.receiveLine,
    onOversize: () => connection.receive({ not: 'json-rpc' }),
    maxBytes: options.maxLineBytes,
  });
  input.setEncoding?.('utf8');
  try {
    await new Promise((resolve, reject) => {
      input.on('data', (chunk) => framer.push(chunk));
      input.once('end', resolve);
      input.once('error', reject);
    });
    framer.end();
  } finally {
    await connection.close();
  }
}
