/** MCP protocol surface for the existing ADLC CLI. Zero dependencies, no shell. */

import { loadCatalog, validateCatalog } from '../bin/agentic-os-invocation.mjs';
import { readFileSync } from 'node:fs';
import { CAPABILITY_COMMAND, capabilityArguments, laneArguments, memoryArguments } from '../bin/agentic-os-argv.mjs';
import { isLaneRef } from './lane-id.mjs';
import { MAX_TASK_CHECKOUTS } from './canonical-resources.mjs';

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
const CHECKS_INPUT = {
  type: 'object',
  properties: { input: { type: 'string', minLength: 1, maxLength: 4096,
    description: 'Local check-discovery input JSON; paths inside it resolve from its directory.' } },
  required: ['input'], additionalProperties: false,
};
const LANE_INPUT = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$',
      description: 'Lowercase lane scope with optional interior hyphens.',
    },
    writePaths: {
      type: 'array', minItems: 1, maxItems: 128,
      items: { type: 'string', minLength: 1, maxLength: 4096, pattern: '^[^,]+$' },
      description: 'Repository-relative write reservations; combined UTF-8 limit 32 KiB.',
    },
    planningPath: { type: 'string', minLength: 1, maxLength: 4096,
      description: 'Committed joined plan path for native START --plan.' },
    mission: { type: 'string', minLength: 1, maxLength: 4096,
      description: 'Immutable workflow group manifest path; reuse its declared checkout allowance.' },
    checkoutLimit: { type: 'integer', minimum: 0, maximum: MAX_TASK_CHECKOUTS,
      description: 'New plans default to one; zero permits reuse only. An existing cap stays binding.' },
    expectedHead: { type: 'string', pattern: '^[0-9a-f]{40}$',
      description: 'Exact current revision for mission reuse; required with readmit.' },
    readmit: { type: 'boolean',
      description: 'Extend only an active unpublished bound lane; requires mission and expectedHead.' },
  },
  required: ['scope', 'writePaths'],
  additionalProperties: false,
};
const REAP_INPUT = {
  type: 'object',
  properties: {
    ref: {
      type: 'string',
      description: 'Optional exact local agent/<device>/<scope> lane ref.',
    },
  },
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

const invocationCatalog = loadCatalog();
const memorySchema = invocationCatalog.entries.find(entry => entry.token === '/memory.search').inputSchema;
if (!validateCatalog(invocationCatalog).ok) throw new TypeError('Invocation catalog is invalid.');
const RUN_TOOLS = invocationCatalog.entries.filter(entry => entry.action === 'run').map(entry => ({
  name: entry.token.slice(1), description: entry.summary, inputSchema: entry.inputSchema, outputSchema: CLI_OUTPUT,
  annotations: { readOnlyHint: entry.semantic === 'read-only', destructiveHint: false,
    idempotentHint: entry.token !== '/run.retry', openWorldHint: true },
}));
const WORKFLOW_TOOLS = invocationCatalog.entries.filter(entry => entry.action === 'workflow').map(entry => ({
  name: entry.token.slice(1), description: entry.summary, inputSchema: entry.token === '/workflow.targets' ? EMPTY_INPUT
    : { ...CHECKS_INPUT, properties: { input: { ...CHECKS_INPUT.properties.input, description: entry.token === '/workflow.trace' ? 'Local trace input JSON with repository-relative path, optional package script and native validation observation.' : 'Exact local lifecycle manifest path; collection retains digest-bound native receipts.' }, ...(entry.token === '/workflow.export' ? { offset: { type: 'integer', minimum: 0, multipleOf: 32 }, format: { type: 'string', enum: ['json','sse'] } } : {}) } }, outputSchema: CLI_OUTPUT,
  annotations: { readOnlyHint: entry.semantic === 'read-only', destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));
export const TOOLS = deepFreeze([
  ...WORKFLOW_TOOLS,
  ...RUN_TOOLS,
  { ...CAPABILITY_COMMAND, outputSchema: CLI_OUTPUT },
  { name: 'memory', description: 'Retrieve pinned enrolled shared memory or propose one reviewed learning record. Search/read/capture are local-only; no refresh, source write or authority. Results are historical context.',
    inputSchema: memorySchema, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  {
    name: 'collaborate', title: 'Coordinate optional shared work',
    description: 'Use enrolled shared Git coordination for on-demand agents; no model invocation or execution authority.',
    inputSchema: { type: 'object', properties: {
      operation: { type: 'string', enum: ['status', 'get', 'submit', 'claim', 'renew', 'release', 'report', 'archive'] },
      input: { type: 'string', minLength: 1, maxLength: 4096 }, offline: { type: 'boolean' },
    }, required: ['operation'], additionalProperties: false }, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  { name: 'doctor', title: 'Inspect ADLC invariants',
    description: 'Report local harness and remote configuration drift without changing it.',
    inputSchema: EMPTY_INPUT, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'status', title: 'Inspect lanes and queue',
    description: 'Report registered lanes and provider queue state without changing them.',
    inputSchema: EMPTY_INPUT, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'checks', title: 'Discover repository checks',
    description: 'Read owner checks, deduplicated validation plans and unsigned results without running checks or fetching.',
    inputSchema: CHECKS_INPUT, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'reap', title: 'Survey integrated lanes',
    description: 'Survey exact integration identity; fetch may update remote-tracking refs.',
    inputSchema: REAP_INPUT, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'lane', title: 'Open a guarded ADLC lane',
    description: 'Admit or reuse a lane through native START, including mission budgets and active unpublished re-admission.',
    inputSchema: LANE_INPUT, outputSchema: CLI_OUTPUT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
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
  if (RUN_TOOLS.some(tool => tool.name === name)) {
    if (!plainObject(args)) invalidParams('run operation requires a JSON object');
    return ['run', name.slice(4), '--input=-'];
  }
  if (name === 'capabilities') return capabilityArguments(args, invalidParams);
  if (name === 'memory') return memoryArguments(args, memorySchema, invalidParams);
  if (name === 'collaborate') {
    if (!plainObject(args) || !onlyKeys(args, ['operation', 'input', 'offline'])
      || !['status', 'get', 'submit', 'claim', 'renew', 'release', 'report', 'archive'].includes(args.operation))
      invalidParams('collaborate requires a known operation');
    if (args.operation === 'status') {
      if (args.input !== undefined || args.offline !== undefined && typeof args.offline !== 'boolean')
        invalidParams('status accepts only offline');
      return ['collaborate', 'status', ...(args.offline ? ['--offline'] : [])];
    }
    if (args.offline !== undefined || typeof args.input !== 'string' || !args.input.trim()
      || Buffer.byteLength(args.input) > 4096 || /[\x00-\x1f\x7f]/u.test(args.input))
      invalidParams('collaborate requires one bounded local input path');
    return ['collaborate', args.operation, `--input=${args.input}`];
  }
  if (name === 'doctor' || name === 'status') {
    validateEmptyArguments(args);
    return [name];
  }
  if (name === 'workflow.targets') { validateEmptyArguments(args); return ['workflow', 'targets']; }
  if (name === 'checks' || name === 'workflow.collect' || name === 'workflow.export' || name === 'workflow.recommend' || name === 'workflow.trace') {
    if (!plainObject(args) || !onlyKeys(args, name === 'workflow.export' ? ['input', 'offset', 'format'] : ['input']) || typeof args.input !== 'string'
      || !args.input.trim() || Buffer.byteLength(args.input) > 4096 || /[\u0000-\u001f\u007f]/u.test(args.input))
      invalidParams('checks requires one bounded local input path');
    if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset % 32)) invalidParams('invalid workflow offset');
    if (args.format !== undefined && !['json','sse'].includes(args.format)) invalidParams('invalid workflow format');
    return name === 'checks' ? ['observe', '--checks', `--input=${args.input}`]
      : ['workflow', name.slice(9), `--input=${args.input}`, ...(args.offset === undefined ? [] : [`--offset=${args.offset}`]), ...(args.format === undefined ? [] : [`--format=${args.format}`])];
  }
  if (name === 'reap') {
    const value = args === undefined ? {} : args;
    if (!plainObject(value) || !onlyKeys(value, ['ref'])
      || value.ref !== undefined && (typeof value.ref !== 'string' || !isLaneRef(value.ref)))
      invalidParams('reap arguments may contain only a valid string ref');
    return value.ref === undefined ? ['reap'] : ['reap', `--ref=${value.ref}`];
  }
  if (name !== 'lane') invalidParams(`unknown tool "${String(name)}"`);
  return laneArguments(args, invalidParams);
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
    instructions: 'Inspect with doctor, status, checks, or reap; use lane for native admission, reuse, or active unpublished re-admission.',
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
  let stdin;
  if (RUN_TOOLS.some(tool => tool.name === params.name)) {
    try { stdin = JSON.stringify((await import('../runtime/agents/invocation.js')).validateRunInput(params.name.slice(4), params.arguments)); }
    catch { invalidParams('Invalid durable run input'); }
  }
  const argv = toolArguments(params.name, params.arguments);
  const run = options.runCli;
  if (typeof run !== 'function') throw new Error('CLI runner is unavailable');
  const effectful = ['lane', 'reap', 'collaborate', 'workflow.collect'].includes(params.name) || (stdin !== undefined && RUN_TOOLS.find(tool => tool.name === params.name)?.annotations.readOnlyHint !== true);
  if (effectful) options.onEffectful?.();
  let payload = await run(argv, {
    cwd: options.cwd, signal: effectful ? undefined : options.signal, effectful, ...(stdin === undefined ? {} : { stdin }),
  });
  if (stdin !== undefined && effectful && typeof payload?.stdout === 'string') {
    try {
      if (JSON.parse(payload.stdout).writeResultUnknown === true) payload = { ...payload,
        writeResultUnknown: true, terminationReason: 'runtime response left the operation outcome unknown' };
    } catch { /* Invalid CLI output still passes through the existing result checks below. */ }
  }
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
      instructions: 'Inspect with doctor, status, or reap; use lane for native admission, reuse, or active unpublished re-admission.',
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
