/** MCP protocol surface for the existing ADLC CLI. Zero dependencies, no shell. */

import { readFileSync } from 'node:fs';
import { assertScope } from './lane-id.mjs';

export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSION = '2025-11-25';
export const SUPPORTED_VERSIONS = Object.freeze([MODERN_VERSION, LEGACY_VERSION]);
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
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
    writeResultUnknown: { type: 'boolean' },
    terminationReason: { type: 'string' },
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
    description: 'Report registered lanes and provider queue state without changing them.',
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
  const run = options.runCli;
  if (typeof run !== 'function') throw new Error('CLI runner is unavailable');
  const effectful = params.name === 'lane' || params.name === 'reap';
  if (effectful) options.onEffectful?.();
  const payload = await run(argv, {
    cwd: options.cwd, signal: effectful ? undefined : options.signal, effectful,
  });
  if (!plainObject(payload) || !Number.isInteger(payload.exitCode)
    || typeof payload.stdout !== 'string' || typeof payload.stderr !== 'string'
    || !onlyKeys(payload, [
      'exitCode', 'stdout', 'stderr', 'writeResultUnknown', 'terminationReason',
    ]) || ('writeResultUnknown' in payload && payload.writeResultUnknown !== true)
    || (payload.writeResultUnknown === true && typeof payload.terminationReason !== 'string')) {
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

export function hasValidModernMetadata(message) {
  try { validateModernMeta(message?.params); return true; } catch { return false; }
}
