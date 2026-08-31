import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { CONTRACT_PROOF_SCHEMA } from '../src/readiness-proof.mjs';
import {
  LEGACY_VERSION,
  MODERN_VERSION,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  TOOLS,
  handleRequest,
  runCli,
  toolArguments,
} from '../src/mcp-server.mjs';
import { MAX_IN_FLIGHT, createConnection, createLineFramer } from '../src/mcp-stdio.mjs';

export const READINESS_PROOF = Object.freeze({
  schema: CONTRACT_PROOF_SCHEMA,
  claims: ['sha256:53b854bc3e62760b70c9c8de3224360d75a77e956028970140f4285a5ae24de9'],
});

const CLIENT_META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
});

function request(method, id = 1, params = {}) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: CLIENT_META } };
}

function legacyInitialize(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: LEGACY_VERSION,
      capabilities: {},
      clientInfo: { name: 'legacy-test', version: '1.0.0' },
    },
  };
}

const okRunner = async () => ({ exitCode: 0, stdout: 'ok\n', stderr: '' });

test('the packaged fixed tool surface is deterministic and deeply frozen', () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), ['doctor', 'status', 'reap', 'lane']);
  assert.equal(Object.isFrozen(TOOLS), true);
  assert.equal(Object.isFrozen(TOOLS[0].inputSchema), true);
  assert.equal(TOOLS.find((tool) => tool.name === 'reap').annotations.destructiveHint, false);
  assert.equal(TOOLS.find((tool) => tool.name === 'lane').annotations.idempotentHint, false);
  assert.throws(() => { TOOLS[0].name = 'changed'; }, TypeError);

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.bin['agentic-os-mcp'], 'bin/agentic-os-mcp.mjs');
  assert.ok(pkg.files.includes('__tests__'));
  assert.notEqual(statSync(new URL('../bin/agentic-os-mcp.mjs', import.meta.url)).mode & 0o111, 0);
});

test('modern discovery advertises both eras and the exact server identity', async () => {
  const response = await handleRequest(request('server/discover', 'discover'));
  assert.equal(response.id, 'discover');
  assert.deepEqual(response.result.supportedVersions, [...SUPPORTED_VERSIONS]);
  assert.deepEqual(response.result.capabilities, { tools: {} });
  assert.deepEqual(response.result._meta, {
    'io.modelcontextprotocol/serverInfo': SERVER_INFO,
  });
  assert.equal(response.result.resultType, 'complete');
  assert.equal(response.result.cacheScope, 'public');
  assert.ok(response.result.ttlMs > 0);
});

test('modern tool listing is stable, cacheable, and schema-complete', async () => {
  const first = await handleRequest(request('tools/list', 1));
  const second = await handleRequest(request('tools/list', 2));
  assert.deepEqual(first.result.tools, second.result.tools);
  assert.equal(first.result.resultType, 'complete');
  assert.equal(first.result.cacheScope, 'public');
  for (const tool of first.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.deepEqual(tool.outputSchema.required, ['exitCode', 'stdout', 'stderr']);
  }
});

test('tool calls cross only the intended argument-array CLI boundary', async () => {
  const calls = [];
  const runCli = async (argv) => {
    calls.push([...argv]);
    return { exitCode: 0, stdout: argv.join(' '), stderr: '' };
  };
  const cases = [
    ['doctor', {}, ['doctor']],
    ['status', {}, ['status']],
    ['reap', {}, ['reap']],
    ['lane', { scope: 'pricing-table' }, ['start', 'pricing-table']],
  ];
  for (const [name, args, expected] of cases) {
    const response = await handleRequest(request('tools/call', name, { name, arguments: args }), {
      runCli,
    });
    assert.equal(response.result.resultType, 'complete');
    assert.deepEqual(response.result.structuredContent, {
      exitCode: 0,
      stdout: expected.join(' '),
      stderr: '',
    });
    assert.equal(response.result.content[0].text, JSON.stringify(response.result.structuredContent));
    assert.equal(response.result.isError, false);
  }
  assert.deepEqual(calls, cases.map((entry) => entry[2]));
  assert.ok(!calls.flat().includes('--apply'));
});

test('tool argument validation rejects escalation and shell-shaped scopes', async () => {
  assert.deepEqual(toolArguments('reap', {}), ['reap']);
  for (const [name, args] of [
    ['reap', { apply: true }],
    ['status', null],
    ['lane', { scope: 'ok', device: 'other' }],
    ['lane', { scope: 'x;rm-rf' }],
    ['lane', { scope: '../escape' }],
    ['unknown', {}],
  ]) {
    const response = await handleRequest(request('tools/call', name, { name, arguments: args }), {
      runCli: okRunner,
    });
    assert.equal(response.error.code, -32602, `${name}: ${JSON.stringify(args)}`);
  }
});

test('a nonzero CLI exit is a tool error, not a JSON-RPC error', async () => {
  const response = await handleRequest(request('tools/call', 4, {
    name: 'doctor',
    arguments: {},
  }), {
    runCli: async () => ({ exitCode: 7, stdout: '', stderr: 'drift\n' }),
  });
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.exitCode, 7);
});

test('the production runner invokes the packaged CLI entrypoint', async () => {
  const result = await runCli(['help'], { cwd: new URL('..', import.meta.url), timeoutMs: 5_000 });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /agentic-os — ADLC harness/);
  assert.equal(result.stderr, '');
});

test('modern requests fail closed on metadata, version, method, and parameter drift', async () => {
  const missing = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  assert.equal(missing.error.code, -32602);

  const unsupported = request('tools/list', 2);
  unsupported.params._meta = {
    ...CLIENT_META,
    'io.modelcontextprotocol/protocolVersion': '1900-01-01',
  };
  const version = await handleRequest(unsupported);
  assert.equal(version.error.code, -32022);
  assert.deepEqual(version.error.data.supported, [...SUPPORTED_VERSIONS]);

  const capability = request('tools/list', 3);
  capability.params._meta = {
    'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
    'io.modelcontextprotocol/clientCapabilities': [],
  };
  assert.equal((await handleRequest(capability)).error.code, -32602);

  const client = request('tools/list', 4);
  client.params._meta = { ...CLIENT_META, 'io.modelcontextprotocol/clientInfo': { name: 'x' } };
  assert.equal((await handleRequest(client)).error.code, -32602);
  assert.equal((await handleRequest(request('missing', 5))).error.code, -32601);
  assert.equal((await handleRequest(request('server/discover', 6, { extra: true }))).error.code, -32602);
  assert.equal((await handleRequest(request('tools/list', 7, { cursor: 'next' }))).error.code, -32602);
});

test('direct modern calls remain stateless and validate every request independently', async () => {
  const called = await handleRequest(request('tools/call', 1, {
    name: 'status',
    arguments: {},
  }), { runCli: okRunner });
  assert.equal(called.result.isError, false);

  const laterMissingMeta = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  assert.equal(laterMissingMeta.error.code, -32602);
});

test('legacy initialize gates operation and omits modern-only response fields', async () => {
  const responses = [];
  const connection = createConnection({ write: (value) => responses.push(value), runCli: okRunner });
  connection.receive(legacyInitialize());
  await connection.idle();
  assert.equal(connection.era, 'legacy');
  assert.equal(responses[0].result.protocolVersion, LEGACY_VERSION);
  assert.deepEqual(responses[0].result.capabilities, { tools: {} });
  assert.equal(responses[0].result.resultType, undefined);

  connection.receive({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await connection.idle();
  assert.equal(responses.at(-1).error.code, -32600);

  connection.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
  connection.receive({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  await connection.idle();
  assert.deepEqual(responses.at(-1).result.tools, TOOLS);
  assert.equal(responses.at(-1).result.resultType, undefined);
  assert.equal(responses.at(-1).result.ttlMs, undefined);
  await connection.close();
});

test('legacy initialization is reserved once and premature initialized notices are ignored', async () => {
  const responses = [];
  const connection = createConnection({ write: (value) => responses.push(value) });
  connection.receive(legacyInitialize(1));
  connection.receive(legacyInitialize(2));
  connection.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await connection.idle();
  assert.equal(responses.filter((item) => item.result?.protocolVersion === LEGACY_VERSION).length, 1);
  assert.equal(responses.find((item) => item.id === 2).error.code, -32600);

  connection.receive({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  await connection.idle();
  assert.equal(responses.at(-1).error.code, -32600);
  connection.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
  connection.receive({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  await connection.idle();
  assert.deepEqual(responses.at(-1).result.tools, TOOLS);
  await connection.close();
});

test('one stdio process cannot interleave modern and legacy eras', async () => {
  const modernResponses = [];
  const modern = createConnection({ write: (value) => modernResponses.push(value) });
  modern.receive(request('server/discover', 1));
  await modern.idle();
  modern.receive(legacyInitialize(2));
  await modern.idle();
  assert.equal(modern.era, 'modern');
  assert.equal(modernResponses.at(-1).error.code, -32601);

  const legacyResponses = [];
  const legacy = createConnection({ write: (value) => legacyResponses.push(value) });
  legacy.receive(legacyInitialize(1));
  await legacy.idle();
  legacy.receive(request('tools/list', 2));
  await legacy.idle();
  assert.equal(legacyResponses.at(-1).error.code, -32600);
  await Promise.all([modern.close(), legacy.close()]);
});

test('duplicate IDs are rejected and cancellation suppresses the original response', async () => {
  const responses = [];
  let aborted = false;
  const runCli = (_argv, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted = true;
      const error = new Error('cancelled');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const connection = createConnection({ write: (value) => responses.push(value), runCli });
  connection.receive(request('tools/call', 'same', { name: 'doctor', arguments: {} }));
  connection.receive(request('tools/call', 'same', { name: 'status', arguments: {} }));
  connection.receive({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 'same', reason: 'test' },
  });
  await connection.idle();
  assert.equal(aborted, true);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].error.code, -32600);
  assert.match(responses[0].error.message, /Duplicate/);
  await connection.close();
});

test('the in-flight cap bounds concurrent CLI processes', async () => {
  const responses = [];
  let runs = 0;
  const runCli = (_argv, { signal }) => new Promise((_resolve, reject) => {
    runs += 1;
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    }, { once: true });
  });
  assert.equal(MAX_IN_FLIGHT, 8);
  const connection = createConnection({
    write: (value) => responses.push(value),
    runCli,
    maxInFlight: 1,
  });
  connection.receive(request('tools/call', 1, { name: 'doctor', arguments: {} }));
  connection.receive(request('tools/call', 2, { name: 'status', arguments: {} }));
  connection.receive({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  await connection.idle();
  assert.equal(runs, 1);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 2);
  assert.equal(responses[0].error.code, -31000);
  await connection.close();
});

test('EOF cancellation aborts active CLI work without writing a response', async () => {
  const responses = [];
  let aborted = false;
  const connection = createConnection({
    write: (value) => responses.push(value),
    runCli: (_argv, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(Object.assign(new Error('EOF'), { name: 'AbortError' }));
      }, { once: true });
    }),
  });
  connection.receive(request('tools/call', 1, { name: 'doctor', arguments: {} }));
  await connection.close();
  assert.equal(aborted, true);
  assert.deepEqual(responses, []);
});

test('the line framer handles chunks, CRLF, multiple messages, and oversize input', () => {
  const lines = [];
  let oversize = 0;
  const framer = createLineFramer({
    onLine: (line) => lines.push(line),
    onOversize: () => { oversize += 1; },
    maxBytes: 12,
  });
  framer.push('{"id":');
  framer.push('1}\r\n{}\n');
  framer.push('x'.repeat(13));
  framer.push('discarded\n{"ok":true}\n');
  framer.end();
  assert.deepEqual(lines, ['{"id":1}', '{}', '{"ok":true}']);
  assert.equal(oversize, 1);
});

test('malformed JSON and invalid envelopes produce bounded standard errors', async () => {
  const responses = [];
  const connection = createConnection({ write: (value) => responses.push(value) });
  connection.receiveLine('{');
  connection.receive([]);
  connection.receive({ jsonrpc: '2.0', id: 1.5, method: 'ping', params: {} });
  connection.receive({ jsonrpc: '2.0', method: 'notifications/initialized', id: 3 });
  await connection.idle();
  assert.deepEqual(responses.map((item) => item.error.code), [-32700, -32600, -32600, -32602]);
  assert.ok(responses.every((item) => !JSON.stringify(item).includes('stack')));
  await connection.close();
});

test('the packaged stdio binary emits only one valid JSON-RPC line for discovery', async () => {
  const child = spawn(process.execPath, ['bin/agentic-os-mcp.mjs'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  timeout.unref?.();
  child.stdin.write(`${JSON.stringify(request('server/discover', 'smoke'))}\n`);
  const [line] = await once(lines, 'line');
  const response = JSON.parse(line);
  assert.equal(response.id, 'smoke');
  assert.equal(response.result.resultType, 'complete');
  child.stdin.end();
  const [code] = await once(child, 'close');
  clearTimeout(timeout);
  assert.equal(code, 0);
});
