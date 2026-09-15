import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentSwarmFailure, createAgentSwarmMemoryStore } from '../runtime/agents/agent-swarm.js';
import { createAgentSwarmSqliteStore } from '../runtime/agents/sqlite-store.js';
import { createSwarmCoordinator, digest } from '../runtime/agents/agent-swarm-coordinator.js';
import { createAgentSwarmWorker } from '../runtime/agents/worker.js';
import { createLocalModelExecutor } from '../runtime/agents/local-model.js';
import { fixture, request, context, output, cost, work, retry } from './agents/workflow-fixture.mjs';

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'workflow-recovery-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}

test('killed read-only planning resumes with original request and fixed retention', { timeout: 10_000 }, async t => {
  const path = directory(t);
  const child = fork(join(import.meta.dirname, 'agents/workflow-fixture.mjs'), [JSON.stringify({ directory: path, planning: true })],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  assert.deepEqual((await once(child, 'message'))[0], { planning: 'persisted' });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const store = await createAgentSwarmSqliteStore({ directory: path, now: () => 1_101 }); t.after(() => store.close());
  const original = await store.get(request.runId);
  assert.deepEqual(original.request.input, request.input);
  const runtime = fixture({ stateStore: store, now: () => 1_101, planningEffect: 'read-only' });
  const worker = createAgentSwarmWorker({ runtime, stateStore: store, resolveContext: async () => context, now: () => 1_101 });
  assert.equal((await worker.tick()).runs[0].status, 'running');
  const resumed = await store.get(request.runId);
  assert.equal(resumed.deadlineAt, original.deadlineAt); assert.equal(resumed.expiresAt, original.expiresAt);
  await worker.tick(); await worker.tick();
  assert.equal((await runtime.status(request.runId, context)).status, 'completed');
  assert.equal((await worker.tick()).nextEligibleAt, null);
});

test('unknown planning is not replayed; cancel fences a late planner', async () => {
  let at = 1_000, finish, calls = 0;
  const store = createAgentSwarmMemoryStore({ now: () => at });
  const runtime = fixture({ stateStore: store, now: () => at, planTasks: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const started = runtime.start(request, context);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const canceled = await runtime.cancel({ runId: request.runId, operationId: 'stop' }, context);
  assert.equal(canceled.status, 'canceled');
  finish({ status: 'completed', planId: 'plan', tasks: [{ taskId: 'task', objective: 'test', dependencies: [], context: null }] });
  assert.equal((await started).reasonCode, 'ledger_conflict');
  assert.equal((await runtime.start(request, context)).status, 'canceled'); assert.equal(calls, 1);
  const other = { ...request, runId: 'unknown-planner' };
  const pending = runtime.start(other, context); finish = undefined;
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  at = 1_101;
  assert.equal((await runtime.start(other, context)).reasonCode, 'planning_outcome_unknown'); assert.equal(calls, 2);
  finish({ status: 'completed', planId: 'plan', tasks: [{ taskId: 'task', objective: 'test', dependencies: [], context: null }] });
  await pending;
});

test('expired peer execution counts release SQLite capacity without overwriting its checkpoint', async t => {
  let at = 1_000;
  const store = await createAgentSwarmSqliteStore({ directory: directory(t), now: () => at, maxActiveTasks: 1 });
  t.after(() => store.close());
  const original = { runId: 'first', ownerPrincipalId: 'seller', expiresAt: 10_000,
    tasks: [{ status: 'running', leaseExpiresAt: 1_100 }], checkpoint: 'retain' };
  await store.put(original);
  const second = { ...original, runId: 'second', tasks: [{ status: 'running', leaseExpiresAt: 1_200 }] };
  await assert.rejects(store.put(second), /capacity/); at = 1_101;
  assert.equal(await store.put(second), true); assert.deepEqual(await store.get('first'), original);
});

test('local model adapter is bounded, revision-bound, read-only and honest about unknown cost', async () => {
  const modelDigest = 'a'.repeat(64), imageDigest = `sha256:${'b'.repeat(64)}`, model = `sha256:${modelDigest}`;
  let call;
  const execute = createLocalModelExecutor({ endpoint: 'http://127.0.0.1:1234/v1/chat/completions', modelDigest, imageDigest,
    fetchImpl: async (url, init) => { call = { url, ...init }; return Response.json({ model,
      choices: [{ message: { content: 'A useful listing' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } }); } });
  const result = await execute({ input: { goal: 'Write a listing' }, execution: { idempotencyKey: 'one-key' } });
  assert.equal(result.effect, 'read-only'); assert.equal(result.output.costUsd, null);
  assert.equal(result.costLog, undefined); assert.equal(result.output.executor.modelRevision, model);
  assert.equal(call.headers.get('idempotency-key'), 'one-key'); assert.equal(call.redirect, 'error');
  assert.deepEqual(result.output.usage, { promptTokens: 12, completionTokens: 8 });
  assert.throws(() => createLocalModelExecutor({ endpoint: 'https://remote.example/', modelDigest, imageDigest }), /loopback/);
  const truncated = createLocalModelExecutor({ endpoint: 'http://localhost:1234/', modelDigest, imageDigest,
    fetchImpl: async () => Response.json({ model, choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }) });
  await assert.rejects(truncated({ input: {}, execution: { idempotencyKey: 'key' } }), error =>
    error instanceof AgentSwarmFailure && error.kind === 'transient' && error.effectState === 'absent');
});

test('duplicate request keys preserve one normalized request, owner and definition', async () => {
  const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 });
  const runtime = fixture({ stateStore });
  const first = await runtime.start(request, context);
  const replay = await runtime.start({ ...request, input: { b: 2, a: 1 } }, context);
  assert.equal(replay.requestDigest, first.requestDigest);
  assert.equal(replay.status, 'running');
  assert.equal((await runtime.start({ ...request, goal: 'Changed goal' }, context)).reasonCode, 'run_identity_conflict');
  assert.equal((await runtime.start(request, { principalId: 'other' })).reasonCode, 'run_forbidden');
  assert.equal((await fixture({ stateStore, maxAttempts: 3 }).start(request, context)).reasonCode, 'run_identity_conflict');
  assert.equal((await work(fixture({ stateStore, maxAttempts: 3 }))).reasonCode, 'execution_policy_mismatch');
  const before = await stateStore.get(request.runId);
  assert.equal(before.agent.revision, request.agent.revision);
  assert.equal(before.ownerPrincipalId, context.principalId);
});

test('transient delay and terminal failure survive SQLite reopen; waiting executes nothing', async t => {
  const path = directory(t); let at = 1_000, calls = 0;
  let stateStore = await createAgentSwarmSqliteStore({ directory: path, now: () => at });
  const options = { now: () => at, executeTask: async () => { calls++;
    throw new AgentSwarmFailure('backend_unavailable', { kind: 'transient', effectState: 'absent' }); } };
  let runtime = fixture({ ...options, stateStore });
  await runtime.start(request, context);
  assert.equal((await work(runtime)).status, 'retryable');
  assert.equal((await runtime.run(request, context)).nextEligibleAt, 1_020);
  assert.equal(calls, 1); stateStore.close();
  stateStore = await createAgentSwarmSqliteStore({ directory: path, now: () => at });
  t.after(() => stateStore.close()); runtime = fixture({ ...options, stateStore });
  assert.equal((await work(runtime)).status, 'idle'); assert.equal(calls, 1);
  at = 1_020; assert.equal((await work(runtime)).status, 'failed'); assert.equal(calls, 2);
  const terminal = await runtime.settle({ runId: request.runId, operationId: 'settle' }, context);
  assert.equal(terminal.reasonCode, 'no_completed_tasks');
  const expires = terminal.expiresAt;
  at = terminal.deadlineAt + 1;
  assert.equal((await runtime.status(request.runId, context)).status, 'blocked');
  assert.equal((await stateStore.get(request.runId)).expiresAt, expires);
  at = expires; assert.equal((await runtime.status(request.runId, context)).reasonCode, 'run_missing');
});

test('permanent absence never retries; unknown failure never repeats the executor', async () => {
  for (const [error, expected] of [
    [new AgentSwarmFailure('invalid_input', { kind: 'permanent', effectState: 'absent' }), 'failed'],
    [new Error('untrusted private response'), 'reconciling'],
  ]) {
    let calls = 0;
    const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 });
    const runtime = fixture({ stateStore, executeTask: async () => { calls++; throw error; } });
    await runtime.start(request, context);
    assert.equal((await work(runtime)).status, expected);
    await runtime.run(request, context); await work(runtime, 'another');
    assert.equal(calls, 1);
    assert.equal(JSON.stringify((await stateStore.get(request.runId)).events).includes('private'), false);
  }
});

test('kill after effect and before checkpoint reconciles a receipt without executing twice', { timeout: 10_000 }, async t => {
  const path = directory(t), effectPath = join(path, 'effect.json'); let at = 1_000;
  let stateStore = await createAgentSwarmSqliteStore({ directory: path, now: () => at });
  await fixture({ stateStore }).start(request, context); stateStore.close();
  const child = fork(join(import.meta.dirname, 'agents/workflow-fixture.mjs'), [JSON.stringify({ directory: path, effectPath })],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  assert.deepEqual((await once(child, 'message'))[0], { effect: 'committed' });
  const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  const receipt = JSON.parse(readFileSync(effectPath, 'utf8'));
  at = 1_101;
  stateStore = await createAgentSwarmSqliteStore({ directory: path, now: () => at });
  t.after(() => stateStore.close()); let executions = 0;
  const runtime = fixture({ stateStore, now: () => at, executeTask: async () => { executions++; throw Error('duplicate'); },
    reconcileTask: async call => ({ status: 'completed', verified: true, idempotencyKey: call.idempotencyKey,
      reference: 'fixture-effect-store/effect-once', outcome: { ...output, effect: 'idempotent', receipt } }) });
  assert.equal((await work(runtime)).status, 'idle');
  assert.equal((await runtime.status(request.runId, context)).counts.reconciling, 1);
  const reconciled = await retry(runtime);
  assert.equal(reconciled.counts.completed, 1); assert.equal(executions, 0);
  assert.equal(reconciled.evidence.receipts[0].receiptId, 'effect-once');
  const completed = await runtime.settle({ runId: request.runId, operationId: 'settle' }, context);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.evidence.receipts.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(effectPath, 'utf8')), receipt);
});

test('an absent effect needs verified quiescence and the original key before retry', async () => {
  let at = 1_000, calls = 0, observation;
  const stateStore = createAgentSwarmMemoryStore({ now: () => at });
  const runtime = fixture({ stateStore, now: () => at,
    executeTask: async () => { calls++; if (calls === 1) throw Error('lost response'); return output; },
    reconcileTask: async call => ({ status: 'absent', verified: true, idempotencyKey: call.idempotencyKey,
      reference: 'effect-reader/negative', ...observation }) });
  await runtime.start(request, context); await work(runtime);
  await assert.rejects(retry(runtime), { reasonCode: 'reconciliation_not_quiescent' });
  at += 20; observation = { quiescent: true, idempotencyKey: 'wrong-key' };
  await assert.rejects(retry(runtime), { reasonCode: 'reconciliation_unverified' });
  at += 40; observation = { quiescent: true };
  const pending = await retry(runtime);
  assert.equal(pending.counts.pending, 1); assert.equal(calls, 1);
  assert.equal((await work(runtime)).status, 'idle');
  at = pending.nextEligibleAt; assert.equal((await work(runtime)).status, 'completed');
  assert.equal(calls, 2);
});

test('expired and revoked authority cannot dispatch or accept a late result', async () => {
  let at = 1_000, allowed = true, calls = 0;
  const stateStore = createAgentSwarmMemoryStore({ now: () => at });
  const runtime = fixture({ stateStore, now: () => at,
    authorize: async () => ({ allowed, approvalId: 'current-grant' }),
    executeTask: async () => { calls++; allowed = false; return output; } });
  await runtime.start(request, { ...context, principalExpiresAt: 1_100 });
  at = 1_101;
  assert.equal((await runtime.work({ runId: request.runId, workerId: 'worker', operationId: 'expired' },
    { ...context, principalExpiresAt: 1_100 })).reasonCode, 'principal_expired');
  assert.equal(calls, 0);
  const revoked = await work(runtime);
  assert.equal(revoked.status, 'reconciling'); assert.equal(calls, 1);
  assert.equal((await stateStore.get(request.runId)).tasks[0].output, undefined);
  assert.equal((await work(runtime)).status, 'blocked'); assert.equal(calls, 1);
});

test('cancellation retains unknown effects and suppresses in-flight readback', async () => {
  let resolveRead, started;
  const reading = new Promise(resolve => { started = resolve; });
  const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 });
  const runtime = fixture({ stateStore, executeTask: async () => { throw Error('ambiguous'); },
    reconcileTask: async call => { started(); return new Promise(resolve => { resolveRead = () => resolve({
      status: 'absent', verified: true, quiescent: true, idempotencyKey: call.idempotencyKey, reference: 'negative' }); }); } });
  await runtime.start(request, context); await work(runtime);
  const pending = retry(runtime); await reading;
  const canceled = await runtime.cancel({ runId: request.runId, operationId: 'cancel' }, context);
  assert.equal(canceled.tasks[0].effectState, 'unknown'); resolveRead();
  await assert.rejects(pending, { reasonCode: 'reconciliation_stale' });
  assert.equal((await runtime.status(request.runId, context)).status, 'canceled');
});

test('legacy schema remains readable and unknown schemas cannot execute', async () => {
  const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 }), runtime = fixture({ stateStore });
  await runtime.start(request, context);
  const ledger = await stateStore.claim(request.runId, 'fixture', 2_000);
  await stateStore.replace(request.runId, 'fixture', { ...ledger, schema: 'agent-swarm-run/v1' });
  assert.equal((await runtime.status(request.runId, context)).status, 'running');
  assert.equal((await work(runtime)).reasonCode, 'ledger_migration_required');
  await stateStore.claim(request.runId, 'fixture', 2_000);
  await stateStore.replace(request.runId, 'fixture', { ...ledger, schema: 'unrecognized/v9' });
  assert.equal((await work(runtime)).reasonCode, 'ledger_invalid');
});

test('explicit legacy migration binds source bytes and preserves effect keys for reconciliation', async () => {
  let at = 1_000;
  const stateStore = createAgentSwarmMemoryStore({ now: () => at }), runtime = fixture({ stateStore, now: () => at });
  await runtime.start(request, context);
  const legacy = await stateStore.claim(request.runId, 'fixture', 2_000);
  legacy.schema = 'agent-swarm-run/v1'; delete legacy.requestDigest; delete legacy.policyDigest;
  legacy.expiresAt = legacy.deadlineAt;
  Object.assign(legacy.tasks[0], { status: 'running', attempts: 1, executionId: 'old-execution', workerId: 'old-worker', leaseExpiresAt: 1_100 });
  delete legacy.tasks[0].effectPolicy; delete legacy.tasks[0].nextEligibleAt;
  const key = legacy.tasks[0].idempotencyKey, sourceDigest = digest(legacy);
  await stateStore.replace(request.runId, 'fixture', legacy);
  await assert.rejects(runtime.migrate({ runId: request.runId, operationId: 'migration', expectedDigest: '0'.repeat(64) }, context),
    { reasonCode: 'migration_source_changed' });
  assert.deepEqual(await stateStore.get(request.runId), legacy);
  const migrated = await runtime.migrate({ runId: request.runId, operationId: 'migration', expectedDigest: sourceDigest }, context);
  assert.equal(migrated.counts.reconciling, 1);
  const retained = await stateStore.get(request.runId);
  assert.equal(retained.schema, 'agent-swarm-run/v2');
  assert.equal(retained.tasks[0].idempotencyKey, key);
  assert.equal(retained.tasks[0].lastExecutionId, 'old-execution');
  assert.equal(retained.migration.sourceDigest, sourceDigest);
  at = legacy.expiresAt + 1; assert.equal((await runtime.status(request.runId, context)).runId, request.runId);
});

test('reused public operation IDs cannot release or replace a newer coordinator claim', async () => {
  let at = 1_000, pause, entered;
  const stateStore = createAgentSwarmMemoryStore({ now: () => at });
  await fixture({ stateStore }).start(request, context);
  const ledger = await stateStore.get(request.runId), claimIds = [];
  const store = { ...stateStore, async claim(...args) { claimIds.push(args[1]); return stateStore.claim(...args); } };
  const coordinator = createSwarmCoordinator({ store, limits: { storeClaimAttempts: 1, storeClaimTtlMs: 10 },
    instant: () => at, wait: async () => {}, policyDigest: ledger.policyDigest });
  const ready = new Promise(resolve => { entered = resolve; });
  const old = coordinator.withLedger(request.runId, 'same-operation', 'seller', async record => {
    entered(); await new Promise(resolve => { pause = resolve; }); record.planId = 'stale'; });
  await ready; at += 11;
  await coordinator.withLedger(request.runId, 'same-operation', 'seller', record => { record.planId = 'fresh'; });
  pause(); await assert.rejects(old, { reasonCode: 'ledger_conflict' });
  assert.notEqual(claimIds[0], claimIds[1]);
  assert.equal((await stateStore.get(request.runId)).planId, 'fresh');
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
});

test('permanent failure stays terminal after readback proves its effect absent', async () => {
  let calls = 0;
  const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 });
  const runtime = fixture({ stateStore, executeTask: async () => { calls++;
    throw new AgentSwarmFailure('permanent_rejection', { kind: 'permanent', effectState: 'unknown' }); },
    reconcileTask: async ({ idempotencyKey }) => ({ status: 'absent', verified: true, quiescent: true,
      idempotencyKey, reference: 'fixture/permanent-absence' }) });
  await runtime.start(request, context); await work(runtime);
  const result = await retry(runtime);
  assert.equal(result.counts.failed, 1); assert.equal(result.counts.pending ?? 0, 0);
  assert.equal(result.tasks[0].reasonCode, 'permanent_rejection');
  await runtime.run(request, context); assert.equal(calls, 1);
});

test('permanent synthesis failure cannot be rescheduled', async () => {
  let calls = 0;
  const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 });
  const runtime = fixture({ stateStore, synthesize: async () => { calls++;
    throw new AgentSwarmFailure('invalid_synthesis', { kind: 'permanent', effectState: 'absent' }); } });
  await runtime.start(request, context); await work(runtime);
  const blocked = await runtime.settle({ runId: request.runId, operationId: 'settle' }, context);
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reasonCode, 'invalid_synthesis');
  assert.equal(blocked.nextEligibleAt, null);
  await runtime.run(request, context); assert.equal(calls, 1);
});

test('in-flight task and synthesis expose their persisted lease wake time', async () => {
  let releaseTask, beganTask, releaseSynthesis, beganSynthesis;
  const taskStarted = new Promise(resolve => { beganTask = resolve; });
  const synthesisStarted = new Promise(resolve => { beganSynthesis = resolve; });
  const stateStore = createAgentSwarmMemoryStore({ now: () => 1_000 });
  const runtime = fixture({ stateStore, taskTimeoutMs: 1_000, taskLeaseMs: 2_000, runTtlMs: 10_000,
    executeTask: async () => { beganTask(); return new Promise(resolve => { releaseTask = () => resolve(output); }); },
    synthesize: async () => { beganSynthesis(); return new Promise(resolve => { releaseSynthesis = () => resolve({
      status: 'completed', output: 'reviewed', costLog: cost }); }); } });
  await runtime.start(request, context); const working = work(runtime); await taskStarted;
  assert.equal((await runtime.status(request.runId, context)).nextEligibleAt, 3_000);
  releaseTask(); await working;
  const settling = runtime.settle({ runId: request.runId, operationId: 'settle' }, context); await synthesisStarted;
  assert.equal((await runtime.status(request.runId, context)).nextEligibleAt, 3_000);
  releaseSynthesis(); assert.equal((await settling).nextEligibleAt, null);
});
