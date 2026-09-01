/** MCP protocol surface for the existing ADLC CLI. Zero dependencies, no shell. */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertScope } from './lane-id.mjs';

export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSION = '2025-11-25';
export const SUPPORTED_VERSIONS = Object.freeze([MODERN_VERSION, LEGACY_VERSION]);
export const CLI_TIMEOUT_MS = 60_000;
export const CLI_OUTPUT_BYTES = 256 * 1024;

const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
const CLI_PATH = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const SERVER_INFO = deepFreeze({ name: PACKAGE.name, version: PACKAGE.version });
export const SERVER_META = deepFreeze({ [SERVER_INFO_KEY]: SERVER_INFO });

const EMPTY_INPUT = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};
const LANE_INPUT = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$',
      description: 'Lowercase lane scope with optional interior hyphens.',
    },
  },
  required: ['scope'],
  additionalProperties: false,
};
const CLI_OUTPUT = {
  type: 'object',
  properties: {
    exitCode: { type: 'integer' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
  },
  required: ['exitCode', 'stdout', 'stderr'],
  additionalProperties: false,
};

export const TOOLS = deepFreeze([
  {
    name: 'doctor',
    title: 'Inspect ADLC invariants',
    description: 'Report local harness and remote configuration drift without changing it.',
    inputSchema: EMPTY_INPUT,
    outputSchema: CLI_OUTPUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'status',
    title: 'Inspect lanes and queue',
    description: 'Report lanes, WIP caps, and provider queue state without changing them.',
    inputSchema: EMPTY_INPUT,
    outputSchema: CLI_OUTPUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'reap',
    title: 'Survey integrated lanes',
    description: 'Survey exact integration identity; fetch may update remote-tracking refs.',
    inputSchema: EMPTY_INPUT,
    outputSchema: CLI_OUTPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'lane',
    title: 'Open a guarded ADLC lane',
    description: 'Create one lane worktree and branch at the fetched profile canonical ref.',
    inputSchema: LANE_INPUT,
    outputSchema: CLI_OUTPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
]);

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' || Number.isSafeInteger(value);

function invalidParams(message, data) {
  throw new RpcError(-32602, message, data);
}

function onlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateEnvelope(message) {
  if (!plainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
    || message.method.length === 0 || ('params' in message && !plainObject(message.params))
    || 'result' in message || 'error' in message) {
    throw new RpcError(-32600, 'Invalid Request');
  }
  if ('id' in message && !validId(message.id)) throw new RpcError(-32600, 'Invalid Request');
}

function validateImplementation(value, field) {
  if (!plainObject(value) || typeof value.name !== 'string' || value.name.length === 0
    || typeof value.version !== 'string' || value.version.length === 0) {
    invalidParams(`${field} must contain non-empty name and version strings`);
  }
}

function validateModernMeta(params) {
  if (!plainObject(params?._meta)) invalidParams('params._meta is required');
  const meta = params._meta;
  const requested = meta[VERSION_KEY];
  if (typeof requested !== 'string') invalidParams(`${VERSION_KEY} is required`);
  if (requested !== MODERN_VERSION) {
    throw new RpcError(-32022, 'Unsupported protocol version', {
      supported: [...SUPPORTED_VERSIONS],
      requested,
    });
  }
  if (!plainObject(meta[CLIENT_CAPABILITIES_KEY])) {
    invalidParams(`${CLIENT_CAPABILITIES_KEY} is required and must be an object`);
  }
  if (CLIENT_INFO_KEY in meta) validateImplementation(meta[CLIENT_INFO_KEY], CLIENT_INFO_KEY);
}

function validateEmptyArguments(args) {
  const value = args === undefined ? {} : args;
  if (!plainObject(value) || Object.keys(value).length > 0) {
    invalidParams('tool arguments must be an empty object');
  }
  return value;
}

export function toolArguments(name, args) {
  if (name === 'doctor' || name === 'status' || name === 'reap') {
    validateEmptyArguments(args);
    return [name];
  }
  if (name !== 'lane') invalidParams(`unknown tool "${String(name)}"`);
  if (!plainObject(args) || !onlyKeys(args, ['scope']) || typeof args.scope !== 'string') {
    invalidParams('lane arguments must contain only a string scope');
  }
  try {
    assertScope(args.scope);
  } catch (error) {
    invalidParams(error.message);
  }
  return ['start', args.scope];
}

function abortError() {
  const error = new Error('operation aborted');
  error.name = 'AbortError';
  return error;
}

/** Execute the existing CLI with an argument array and bounded resources. */
export function runCli(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUT_MS;
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(process.execPath, [CLI_PATH, ...argv], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let forcedReason = '';
    let killTimer;

    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      callback(value);
    };
    const stop = (reason) => {
      if (forcedReason) return;
      forcedReason = reason;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      killTimer.unref?.();
    };
    const append = (channel, chunk) => {
      const current = channel === 'stdout' ? stdout : stderr;
      const next = current + chunk;
      if (Buffer.byteLength(next) > CLI_OUTPUT_BYTES) {
        stop(`${channel} exceeded ${CLI_OUTPUT_BYTES} bytes`);
        return;
      }
      if (channel === 'stdout') stdout = next;
      else stderr = next;
    };
    const cancel = () => stop('operation cancelled');
    const timer = setTimeout(() => stop(`command timed out after ${timeoutMs}ms`), timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (signal?.aborted) return finish(reject, abortError());
      if (forcedReason) stderr += `${stderr.endsWith('\n') || stderr.length === 0 ? '' : '\n'}${forcedReason}\n`;
      finish(resolve, { exitCode: Number.isInteger(code) ? code : 1, stdout, stderr });
    });
    return undefined;
  });
}

function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function errorResponse(id, error) {
  const response = {
    jsonrpc: '2.0',
    error: {
      code: Number.isInteger(error?.code) ? error.code : -32603,
      message: Number.isInteger(error?.code) ? error.message : 'Internal error',
    },
  };
  if (validId(id)) response.id = id;
  if (error?.data !== undefined) response.error.data = error.data;
  return response;
}

function discoverResult() {
  return {
    resultType: 'complete',
    supportedVersions: [...SUPPORTED_VERSIONS],
    capabilities: { tools: {} },
    _meta: SERVER_META,
    instructions: 'Inspect with doctor, status, or reap; use lane only when a new worktree is intended.',
    ttlMs: 300_000,
    cacheScope: 'public',
  };
}

function listResult(modern) {
  return {
    ...(modern ? { resultType: 'complete' } : {}),
    tools: TOOLS,
    ...(modern ? { ttlMs: 300_000, cacheScope: 'public', _meta: SERVER_META } : {}),
  };
}

async function callResult(params, modern, options) {
  if (typeof params.name !== 'string' || !onlyKeys(params, ['name', 'arguments', '_meta'])) {
    invalidParams('tools/call requires a tool name and optional arguments object');
  }
  const argv = toolArguments(params.name, params.arguments);
  const run = options.runCli ?? runCli;
  const payload = await run(argv, { cwd: options.cwd, signal: options.signal });
  if (!plainObject(payload) || !Number.isInteger(payload.exitCode)
    || typeof payload.stdout !== 'string' || typeof payload.stderr !== 'string') {
    throw new Error('CLI runner returned an invalid result');
  }
  return {
    ...(modern ? { resultType: 'complete' } : {}),
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: payload.exitCode !== 0,
    ...(modern ? { _meta: SERVER_META } : {}),
  };
}

async function dispatchModern(message, options) {
  if (message.method === 'initialize') {
    throw new RpcError(-32601, 'This stdio process is using modern MCP', {
      supported: [MODERN_VERSION],
    });
  }
  validateModernMeta(message.params);
  if (message.method === 'server/discover') {
    if (!onlyKeys(message.params, ['_meta'])) invalidParams('server/discover accepts only _meta');
    return discoverResult();
  }
  if (message.method === 'ping') {
    if (!onlyKeys(message.params, ['_meta'])) invalidParams('ping accepts only _meta');
    return { resultType: 'complete', _meta: SERVER_META };
  }
  if (message.method === 'tools/list') {
    if (!onlyKeys(message.params, ['_meta'])) invalidParams('pagination is not required for this fixed tool list');
    return listResult(true);
  }
  if (message.method === 'tools/call') return callResult(message.params, true, options);
  throw new RpcError(-32601, 'Method not found');
}

function validateLegacyInitialize(params) {
  if (!plainObject(params) || typeof params.protocolVersion !== 'string'
    || !plainObject(params.capabilities)) {
    invalidParams('initialize requires protocolVersion and capabilities');
  }
  validateImplementation(params.clientInfo, 'clientInfo');
}

async function dispatchLegacy(message, options) {
  if (message.method === 'initialize') {
    if (!options.allowInitialize) throw new RpcError(-32600, 'Legacy process is already initialized');
    validateLegacyInitialize(message.params);
    return {
      protocolVersion: LEGACY_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: 'Inspect with doctor, status, or reap; use lane only when a new worktree is intended.',
    };
  }
  if (message.method === 'ping') return {};
  if (!options.legacyReady) throw new RpcError(-32600, 'Legacy initialization is not complete');
  if (message.method === 'tools/list') return listResult(false);
  if (message.method === 'tools/call') return callResult(message.params ?? {}, false, options);
  throw new RpcError(-32601, 'Method not found');
}

/** Validate one request and return exactly one JSON-RPC response. */
export async function handleRequest(message, options = {}) {
  let id;
  try {
    validateEnvelope(message);
    if (!('id' in message)) return null;
    id = message.id;
    const result = options.era === 'legacy'
      ? await dispatchLegacy(message, options)
      : await dispatchModern(message, options);
    return success(id, result);
  } catch (error) {
    return errorResponse(id, error);
  }
}

export function hasModernMetadata(message) {
  const meta = message?.params?._meta;
  return plainObject(meta) && (VERSION_KEY in meta || CLIENT_CAPABILITIES_KEY in meta);
}
