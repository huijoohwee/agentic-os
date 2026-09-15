import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createAgentRunClient, dispatchRunOperation, validateRunInput } from '../runtime/agents/invocation.js';
import { createAgentSwarmMemoryStore } from '../runtime/agents/agent-swarm.js';
import { resolveInvocation, dispatchInvocation, loadCatalog } from '../bin/agentic-os-invocation.mjs';
import { handleRequest, MODERN_VERSION, TOOLS } from '../src/mcp-server.mjs';
import { runCli } from '../src/mcp-stdio.mjs';
import { fixture, request, context, output, work } from './agents/workflow-fixture.mjs';

const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'fixture', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {} };
const call = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name, arguments: args, _meta: meta } });
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'run-invocation-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
async function server(t, runtime) {
  const received = [];
  const host = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer fixture-session') { res.statusCode = 401; res.end('{}'); return; }
    const operation = req.url.split('/').at(-1), chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); received.push({ operation, body });
    try { res.end(JSON.stringify(await dispatchRunOperation(runtime, operation, body, context))); }
    catch (error) { res.statusCode = 409; res.end(JSON.stringify({ code: error.reasonCode ?? 'invalid_run_request' })); }
  });
  host.listen(0, '127.0.0.1'); await once(host, 'listening');
  t.after(() => new Promise(resolve => { host.closeAllConnections(); host.close(resolve); }));
  return { endpoint: `http://127.0.0.1:${host.address().port}/api/agent-swarm/`, received };
}

test('slash, MCP and portable browser client share all four bounded operation contracts', async t => {
  let at = 1_000, executions = 0;
  const stateStore = createAgentSwarmMemoryStore({ now: () => at });
  const runtime = fixture({ stateStore, now: () => at, executeTask: async () => {
    if (++executions === 1) throw Error('uncertain'); return output;
  }, reconcileTask: async ({ idempotencyKey }) => ({ status: 'absent', verified: true, quiescent: true,
    idempotencyKey, reference: 'fixture/no-effect' }) });
  const host = await server(t, runtime), path = directory(t), file = join(path, 'input.json');
  writeFileSync(file, JSON.stringify(request));
  const environment = { ...process.env, AGENTIC_OS_RUN_ENDPOINT: host.endpoint, AGENTIC_OS_RUN_TOKEN: 'fixture-session' };
  const start = dispatchInvocation(resolveInvocation(['/run.start', `@input:${file}`, '#mutating']));
  assert.deepEqual(start.argv, ['start', `--input=${file}`]);
  const result = await runCli([start.command, ...start.argv], { cwd: path, env: environment, effectful: true });
  assert.equal(result.exitCode, 0); assert.equal(JSON.parse(result.stdout).status, 'running');
  const client = createAgentRunClient({ endpoint: host.endpoint, getHeaders: () => ({ authorization: 'Bearer fixture-session' }) });
  assert.equal((await client.invoke('status', { runId: request.runId })).status, 'running');
  assert.equal((await work(runtime)).status, 'reconciling');
  let effectful = 0, observedOptions;
  const retried = await handleRequest(call('run.retry', { runId: request.runId, taskId: 'listing', operationId: 'retry' }), {
    onEffectful: () => effectful++, cwd: path,
    runCli: (argv, options) => { observedOptions = options; return runCli(argv, { ...options, env: environment }); },
  });
  assert.equal(retried.result.isError, false); assert.equal(effectful, 1);
  assert.equal(observedOptions.effectful, true);
  assert.deepEqual(JSON.parse(observedOptions.stdin), { runId: request.runId, taskId: 'listing', operationId: 'retry' });
  const pending = JSON.parse(retried.result.structuredContent.stdout); at = pending.nextEligibleAt;
  assert.equal((await work(runtime)).status, 'completed'); assert.equal(executions, 2);
  await runtime.settle({ runId: request.runId, operationId: 'settle' }, context);
  const status = await handleRequest(call('run.status', { runId: request.runId }), {
    runCli: (argv, options) => { assert.equal(options.effectful, false); return runCli(argv, { ...options, env: environment }); },
  });
  assert.equal(JSON.parse(status.result.structuredContent.stdout).output, 'reviewed listing fixture');
  await client.invoke('start', { ...request, runId: 'cancel-me' });
  assert.equal((await client.invoke('cancel', { runId: 'cancel-me', operationId: 'cancel' })).status, 'canceled');
  assert.deepEqual([...new Set(host.received.map(item => item.operation))].sort(), ['cancel', 'retry', 'start', 'status']);
  assert.ok(host.received.every(item => !('principalId' in item.body) && !('token' in item.body)));
  for (const entry of loadCatalog().entries.filter(entry => entry.action === 'run')) {
    const tool = TOOLS.find(tool => tool.name === entry.token.slice(1));
    assert.deepEqual(tool.inputSchema, entry.inputSchema);
    assert.equal(tool.annotations.readOnlyHint, entry.semantic === 'read-only');
  }
});

test('untrusted tools cannot choose endpoint, principal, credentials, shell, signal or definition code', async () => {
  for (const key of ['endpoint', 'principalId', 'token', 'shell', 'signal', 'source']) {
    assert.throws(() => validateRunInput('start', { ...request, [key]: 'untrusted' }));
    const response = await handleRequest(call('run.start', { ...request, [key]: 'untrusted' }), {
      onEffectful: () => assert.fail('invalid request granted effects'), runCli: () => assert.fail('invalid request spawned CLI'),
    });
    assert.equal(response.error.code, -32602);
  }
  assert.equal(resolveInvocation(['/run.start', '@input:request.json', '#read-only']).code, 'semantic-mismatch');
  for (const endpoint of ['http://example.com/api/', 'https://user:secret@example.com/', 'https://example.com/?secret=1'])
    assert.throws(() => createAgentRunClient({ endpoint }));
  await assert.rejects(runCli(['help'], { stdin: 'x'.repeat(200_001) }), /bounded/);
});

test('transport failure and server uncertainty retain unknown mutation outcome without automatic retry', async () => {
  let calls = 0;
  const client = createAgentRunClient({ endpoint: 'https://runtime.example/api/agent-swarm/',
    fetchImpl: async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); throw Error('private bearer details'); } });
  await assert.rejects(client.invoke('start', request), error => {
    assert.equal(error.writeResultUnknown, true); assert.equal(error.message.includes('private'), false); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(client.invoke('status', { runId: request.runId }), { writeResultUnknown: false });
  const unavailable = createAgentRunClient({ endpoint: 'https://runtime.example/api/', fetchImpl: async () => Response.json({}, { status: 503 }) });
  assert.equal((await unavailable.invoke('start', request)).writeResultUnknown, true);
  const mcp = await handleRequest(call('run.start', request), {
    runCli: async () => ({ exitCode: 1, stdout: JSON.stringify({ writeResultUnknown: true }), stderr: '' }),
  });
  assert.equal(mcp.result.structuredContent.writeResultUnknown, true);
  const anonymous = createAgentRunClient({ endpoint: 'https://runtime.example/api/', fetchImpl: async () => Response.json({}, { status: 401 }) });
  assert.equal((await anonymous.invoke('status', { runId: request.runId })).reasonCode, 'principal_expired');
});

test('MCP discovery loads metadata without loading any agent module or connecting a store', t => {
  const path = directory(t), loader = join(path, 'discovery-loader.mjs');
  writeFileSync(loader, `export async function load(url, context, next) {
    if (url.includes('/runtime/agents/')) throw Error('agent execution loaded during discovery');
    return next(url, context);
  }`);
  execFileSync(process.execPath, ['--no-warnings', '--loader', pathToFileURL(loader).href, '--input-type=module', '-e',
    `const { TOOLS } = await import(${JSON.stringify(new URL('../src/mcp-server.mjs', import.meta.url).href)});
     if (!TOOLS.some(tool => tool.name === 'run.start')) throw Error('tool missing');`], { timeout: 5_000 });
});
