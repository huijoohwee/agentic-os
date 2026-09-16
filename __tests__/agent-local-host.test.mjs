import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once, getEventListeners } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { startLocalAgentHost } from '../runtime/agents/local-host.js';
import { createAgentSwarmSqliteStore } from '../runtime/agents/sqlite-store.js';
import { createAgentRunClient } from '../runtime/agents/invocation.js';
import { withDeadline } from '../runtime/agents/running-agent-contract.js';
import { runCli } from '../src/mcp-stdio.mjs';
import { handleRequest, MODERN_VERSION } from '../src/mcp-server.mjs';
import { fixture as workflowFixture, request, context, output } from './agents/workflow-fixture.mjs';

// HTTP/SQLite tests use real scheduling, not the shared fixture's 10 ms fake-clock lease.
const fixture = options => workflowFixture({ taskTimeoutMs: 500, taskLeaseMs: 1_500,
  storeClaimTtlMs: 500, ...options });

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'agent-host-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
const authenticate = ({ headers }) => headers.authorization === 'Bearer local-test' ? context : null;
const client = host => createAgentRunClient({ endpoint: host.endpoint,
  getHeaders: () => ({ authorization: 'Bearer local-test' }) });
async function complete(runtime, runId = request.runId) {
  const deadline = Date.now() + 7_000;
  while (Date.now() < deadline) {
    const value = await runtime.status(runId, context);
    if (value.status === 'completed') return value;
    await pause(25);
  }
  throw Error('Host did not complete its accepted job');
}

test('authenticated host continues after the browser leaves, sleeps when idle, and replays one job', { timeout: 10_000 }, async t => {
  const path = directory(t);
  const sqlite = await createAgentSwarmSqliteStore({ directory: path });
  const stateStore = { ...sqlite, async claim(...args) {
    const record = await sqlite.claim(...args); await pause(25); return record;
  } };
  let executions = 0;
  const runtime = fixture({ stateStore, now: Date.now,
    executeTask: async () => { executions++; return output; } });
  const host = await startLocalAgentHost({ runtime, stateStore, authenticate, resolveContext: async () => context });
  t.after(async () => { await host.close(); stateStore.close(); });
  const file = join(path, 'request.json'); writeFileSync(file, JSON.stringify(request), { mode: 0o600 });
  const env = { ...process.env, AGENTIC_OS_RUN_ENDPOINT: host.endpoint, AGENTIC_OS_RUN_TOKEN: 'local-test' };
  const accepted = await runCli(['/run.start', `@input:${file}`, '#mutating'], { cwd: path, env, effectful: true });
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).status, 'running');
  // No subsequent browser request is needed for execution and synthesis.
  const result = await complete(runtime);
  assert.equal(result.output, 'reviewed listing fixture');
  await pause(20); assert.equal(host.stats().wakeScheduled, false);
  assert.equal((await client(host).invoke('start', request)).status, 'completed');
  const observed = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'run.status', arguments: { runId: request.runId }, _meta: {
      'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
      'io.modelcontextprotocol/clientInfo': { name: 'local-host-test', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  } }, { cwd: path, runCli: (argv, options) => runCli(argv, { ...options, env }) });
  assert.equal(observed.result.isError, false);
  assert.equal(JSON.parse(observed.result.structuredContent.stdout).output, result.output);
  assert.equal(executions, 1);
});

test('host rejects missing auth, hostile origins, spoofed owners and oversized bodies before execution', async t => {
  const stateStore = await createAgentSwarmSqliteStore({ directory: directory(t) });
  let calls = 0;
  const runtime = fixture({ stateStore, now: Date.now, executeTask: async () => { calls++; return output; } });
  const host = await startLocalAgentHost({ runtime, stateStore,
    authenticate: input => input.headers.authorization === 'Bearer other' ? { principalId: 'other' } : authenticate(input),
    resolveContext: async () => context });
  t.after(async () => { await host.close(); stateStore.close(); });
  const send = (body, headers = {}) => fetch(host.endpoint + 'start', { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await send(request)).status, 401);
  assert.equal((await send(request, { authorization: 'Bearer local-test', origin: 'https://hostile.example' })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    const attempt = httpRequest(host.endpoint + 'start', { method: 'POST',
      headers: { host: 'rebound.example', authorization: 'Bearer local-test', 'content-type': 'application/json' } },
    response => { response.resume(); resolve(response.statusCode); });
    attempt.on('error', reject); attempt.end(JSON.stringify(request));
  });
  assert.equal(rebound, 403);
  assert.equal((await send({ ...request, principalId: 'another-owner' }, { authorization: 'Bearer local-test' })).status, 400);
  assert.equal((await send({ ...request, input: 'x'.repeat(200_001) }, { authorization: 'Bearer local-test' })).status, 413);
  assert.equal((await send(request, { authorization: 'Bearer local-test', 'content-type': 'text/plain' })).status, 415);
  assert.equal(calls, 0); assert.equal(await stateStore.get(request.runId), null);
  await send(request, { authorization: 'Bearer local-test' });
  const denied = await fetch(host.endpoint + 'status', { method: 'POST',
    headers: { authorization: 'Bearer other', 'content-type': 'application/json' },
    body: JSON.stringify({ runId: request.runId }) });
  assert.equal(denied.status, 403);
  const rejected = await denied.json();
  assert.equal(rejected.reasonCode, 'run_forbidden');
  assert.equal('output' in rejected, false); assert.equal('events' in rejected, false);
});

test('host shutdown aborts a stalled authenticator and releases its listener', { timeout: 2_000 }, async t => {
  const stateStore = await createAgentSwarmSqliteStore({ directory: directory(t) });
  const runtime = fixture({ stateStore, now: Date.now });
  let signal, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const host = await startLocalAgentHost({ runtime, stateStore, resolveContext: async () => context, maxRequests: 1,
    authenticate: input => { signal = input.signal; entered(); return new Promise(() => {}); } });
  t.after(async () => { await host.close(); stateStore.close(); });
  const pending = client(host).invoke('status', { runId: request.runId }).catch(error => error);
  await ready;
  assert.equal((await fetch(host.endpoint + 'status', { method: 'POST', body: '{}' })).status, 429);
  await host.close(); await pending;
  assert.equal(signal.aborted, true); assert.equal(host.stats().listening, false);
});

test('unavailable worker authority pauses without polling and an explicit wake reauthorizes', { timeout: 8_000 }, async t => {
  const stateStore = await createAgentSwarmSqliteStore({ directory: directory(t) });
  const runtime = fixture({ stateStore, now: Date.now });
  await runtime.start(request, context);
  let authorized = false, reads = 0, paused;
  const observed = new Promise(resolve => { paused = resolve; });
  const host = await startLocalAgentHost({ runtime, stateStore, authenticate,
    resolveContext: async () => { reads++; return authorized ? context : null; },
    onEvent: event => { if (event.awaitingAuthorization === 1) paused(); } });
  t.after(async () => { await host.close(); stateStore.close(); });
  await observed; await pause(1_100);
  assert.equal(reads, 1); assert.equal(host.stats().wakeScheduled, false);
  assert.equal((await runtime.status(request.runId, context)).status, 'running');
  authorized = true; host.wake(); await complete(runtime);
});

test('deadline releases abort listeners even when an executor never settles', async () => {
  const outer = new AbortController(), inner = new AbortController();
  const result = withDeadline(() => new Promise(() => {}), outer.signal, 5, inner);
  await assert.rejects(result, error => error.reasonCode === 'timeout');
  assert.equal(inner.signal.aborted, true); assert.equal(getEventListeners(outer.signal, 'abort').length, 0);
  const next = new AbortController();
  let entered = false;
  const aborted = withDeadline(() => { entered = true; return new Promise(() => {}); }, outer.signal, 60_000, next);
  outer.abort(); await assert.rejects(aborted, error => error.reasonCode === 'aborted');
  assert.equal(entered, false);
  assert.equal(getEventListeners(outer.signal, 'abort').length, 0);
});

test('restarted HTTP process resumes its persisted retry without another start request', { timeout: 12_000 }, async t => {
  const path = directory(t), effectPath = join(path, 'executions');
  async function spawn(mode) {
    const child = fork(join(import.meta.dirname, 'agents/local-host-fixture.mjs'), [JSON.stringify({ path, effectPath, mode })],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const ready = Promise.withResolvers(), outcome = Promise.withResolvers();
    // Capture both phases before yielding: recovery may finish before readiness is observed.
    child.on('message', message => {
      if (message.endpoint) ready.resolve(message.endpoint); else outcome.resolve(message);
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    const failed = error => { ready.reject(error); outcome.reject(error); };
    child.once('error', failed);
    child.once('exit', (code, signal) => failed(Error(`Fixture exited (${code ?? signal}): ${stderr}`)));
    // An early failure of either phase must not become an unhandled rejection.
    ready.promise.catch(() => {}); outcome.promise.catch(() => {});
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    return { child, endpoint: await ready.promise, outcome: outcome.promise };
  }
  const first = await spawn('fail-once');
  await client(first).invoke('start', request);
  assert.deepEqual(await first.outcome, { retry: 'persisted' });
  const exited = once(first.child, 'exit'); first.child.kill('SIGKILL'); await exited;
  const second = await spawn('resume');
  assert.deepEqual(await second.outcome, { status: 'completed' });
  assert.equal((await client(second).invoke('status', { runId: request.runId })).status, 'completed');
  assert.equal((await client(second).invoke('start', request)).status, 'completed');
  assert.equal(readFileSync(effectPath, 'utf8'), 'completed\n');
});
