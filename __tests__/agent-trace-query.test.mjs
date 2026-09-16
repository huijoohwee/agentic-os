import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, request, COST, PROFILE, evidence, evaluatorOutcome } from './agents/agent-toolkit.mjs';
import { createHarness as swarmHarness, REQUEST } from './agents/swarm-fixture.mjs';
import { createAgentToolkitMemoryStore, createAgentToolkitRuntime } from '../runtime/agents/agent-toolkit.js';
import { createAgentResourceAdmission } from '../runtime/agents/agent-toolkit-admission.js';
const access = { principalId: 'owner' };
const component = { id: 'model', revision: 'v1', digest: 'a'.repeat(64) };

test('query and detail use bounded authorized indices and revision-bound cursors', async () => {
  let at = 1000;
  const { runtime } = createHarness({ now: () => at });
  assert.equal((await runtime.query({}, access)).total, 0);
  for (const id of ['a', 'b', 'c']) await runtime.start(request(id), access);
  const first = await runtime.query({ limit: 2 }, access);
  assert.match(first.access.scope, /^[a-f0-9]{64}$/);
  assert.equal(first.access.expiresAt, at + 60_000);
  assert.notEqual(first.access.scope, (await runtime.query({}, { principalId: 'other' })).access.scope);
  assert.equal((await runtime.query({}, { ...access, principalExpiresAt: 2000 })).access.expiresAt, 2000);
  assert.deepEqual(first.items.map(r => r.runId), ['a', 'b']);
  const next = await runtime.query({ limit: 2, cursor: first.nextCursor }, access);
  assert.deepEqual(next.items.map(r => r.runId), ['c']);
  assert.equal((await runtime.query({ limit: 2, cursor: first.nextCursor }, { principalId: 'other' })).reasonCode, 'trace_cursor_expired');
  assert.equal((await runtime.trace({ runId: 'a' }, { principalId: 'other' })).reasonCode, 'run_not_found');
  await runtime.complete({ runId: 'b', operationId: 'complete', status: 'completed', costLog: COST }, access);
  assert.equal((await runtime.query({ limit: 2, cursor: first.nextCursor }, access)).reasonCode, 'trace_cursor_expired');
  at += 60_001;
  assert.equal((await runtime.query({ limit: 2, cursor: first.nextCursor }, access)).reasonCode, 'trace_cursor_expired');
  assert.equal((await runtime.query({}, { principalId: 'owner', principalExpiresAt: at })).reasonCode, 'principal_expired');
  await assert.rejects(runtime.query({ limit: 33 }, access));
});

test('leaf usage is attributed once and span evaluation is bound to its immutable subject', async () => {
  let at = 1000;
  const { runtime, calls } = createHarness({ now: () => at });
  await runtime.start(request('trace'), access);
  await runtime.startSpan({ runId: 'trace', spanId: 'root', kind: 'workflow', operation: 'root', component }, access);
  for (const spanId of ['a', 'b']) await runtime.startSpan({ runId: 'trace', spanId, parentSpanId: 'root', kind: 'model', operation: 'infer', component, taskId: 'task', attempt: 1 }, access);
  at += 10;
  assert.equal((await runtime.finishSpan({ runId: 'trace', spanId: 'a', status: 'completed', effectId: 'effect-a', costLog: COST }, access)).status, 'running');
  assert.equal((await runtime.finishSpan({ runId: 'trace', spanId: 'b', status: 'completed', effectId: 'effect-a', costLog: COST }, access)).reasonCode, 'effect_usage_reused');
  await runtime.finishSpan({ runId: 'trace', spanId: 'b', status: 'completed', effectId: 'effect-b', costLog: COST }, access);
  assert.equal((await runtime.finishSpan({ runId: 'trace', spanId: 'root', status: 'completed', effectId: 'root', costLog: COST }, access)).reasonCode, 'aggregate_usage_forbidden');
  const detail = await runtime.trace({ runId: 'trace', limit: 2 }, access);
  const subject = detail.spans.find(s => s.spanId === 'a');
  const evaluate = { runId: 'trace', spanId: 'a', subjectDigest: subject.subjectDigest, operationId: 'evaluate-a', evidence: evidence('a') };
  assert.equal((await runtime.evaluate({ ...evaluate, subjectDigest: '0'.repeat(64) }, access)).reasonCode, 'evaluation_subject_changed');
  await runtime.evaluate(evaluate, access); await runtime.evaluate(evaluate, access);
  assert.equal(calls.evaluate.length, 1);
  const final = await runtime.trace({ runId: 'trace' }, access);
  assert.equal(final.spans.find(s => s.spanId === 'a').evaluation.status, 'reported');
  assert.equal(final.evaluation.status, 'pending');
  await runtime.finishSpan({ runId: 'trace', spanId: 'root', status: 'completed' }, access);
  await runtime.complete({ runId: 'trace', operationId: 'complete', status: 'completed', costLog: COST }, access);
  const terminal = await runtime.trace({ runId: 'trace' }, access);
  assert.match(terminal.subjectDigest, /^[a-f0-9]{64}$/);
  const runEvaluation = { runId: 'trace', subjectDigest: terminal.subjectDigest, operationId: 'evaluate-run', evidence: evidence('run') };
  assert.equal((await runtime.evaluate({ ...runEvaluation, subjectDigest: '0'.repeat(64) }, access)).reasonCode, 'evaluation_subject_changed');
  await runtime.evaluate(runEvaluation, access); await runtime.evaluate(runEvaluation, access);
  assert.equal(calls.evaluate.length, 2);
  assert.equal(calls.evaluate[1].subject.digest, terminal.subjectDigest);
  for (const call of calls.evaluate) { assert.equal(call.subject.runId, 'trace'); assert.equal(call.subject.principalId, 'owner'); }
  assert.equal((await runtime.trace({ runId: 'trace' }, access)).subjectDigest, terminal.subjectDigest);
  assert.equal(final.spans.find(s => s.spanId === 'a').subjectDigest, subject.subjectDigest);
  for (const forbidden of ['reservationId', 'idempotencyKey', 'finishDigest', 'authorizationId']) assert.equal(JSON.stringify(final).includes(forbidden), false);
});

test('a plan-bound concurrent run reserves every phase and produces native causal evidence', async () => {
  const now = () => Date.now(), store = createAgentToolkitMemoryStore({ now });
  const context = { projectId: 'seller', goalId: 'first-result', taskId: 'listing', plan: {
    repository: 'github.com/owner/source', path: 'docs/plan.md', revision: '1'.repeat(40), digest: '2'.repeat(64),
    continuityId: 'SELLER-001', revisions: { prd: '0.2.0', tad: '0.2.0', adr: '0.2.0', mvp: '0.2.0', gtm: '0.2.0' } } };
  const caps = { inputTokens: 1000, outputTokens: 1000, attempts: 12, elapsedMs: 60_000 };
  // The allocation window is immutable across resolutions, including concurrent calls.
  const endsAt = now() + 100_000;
  const stable = createAgentResourceAdmission({ stateStore: store, now, resolveContext: async value => ({ context: value,
    allocation: { id: 'seller', revision: 'v1', windowId: 'window', startsAt: endsAt - 200_000, endsAt,
      project: caps, agent: caps, run: caps, bounds: { inputTokens: 50, outputTokens: 50, attempts: 1, elapsedMs: 1000 }, providerCostMicros: 0 } }) });
  const toolkit = createAgentToolkitRuntime({ stateStore: store, resources: stable, now, authorize: async () => ({ allowed: true, authorizationId: 'local' }),
    evaluate: async call => evaluatorOutcome(1, call.evidence.id) });
  const { runtime } = swarmHarness({ toolkit, resources: stable, traceProfile: PROFILE, requireContext: true });
  const result = await runtime.run({ ...REQUEST, context }, access);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  const detail = await toolkit.trace({ runId: REQUEST.runId }, access);
  assert.equal(detail.status, 'completed');
  assert.equal(detail.spans.length, 6);
  assert.equal(detail.spans.find(s => s.taskId === 'final').links.length, 2);
  assert.equal(detail.resources.used.attempts, 5);
  assert.equal(detail.resources.used.inputTokens, 15);
  assert.equal(detail.profileSummary.tokenUsage.promptTokens, 15);
  assert.equal(JSON.stringify(detail).includes('one public answer'), false);
  assert.equal(JSON.stringify(detail).includes('Complete alpha.'), false);
});

test('overlapping children use interval union; truncated or cross-origin clocks remain unknown', async () => {
  let at = 1000;
  const store = createAgentToolkitMemoryStore({ now: () => at });
  const { runtime } = createHarness({ stateStore: store, now: () => at, clockOrigin: 'device-a', maxSpans: 3 });
  await runtime.start(request('timed'), access);
  await runtime.startSpan({ runId: 'timed', spanId: 'root', kind: 'workflow', operation: 'root', component }, access);
  at = 1010;
  await runtime.startSpan({ runId: 'timed', spanId: 'a', parentSpanId: 'root', kind: 'tool', operation: 'a', component }, access);
  at = 1020;
  await runtime.startSpan({ runId: 'timed', spanId: 'b', parentSpanId: 'root', kind: 'tool', operation: 'b', component }, access);
  at = 1040;
  await runtime.finishSpan({ runId: 'timed', spanId: 'a', status: 'completed' }, access);
  at = 1050;
  await runtime.finishSpan({ runId: 'timed', spanId: 'b', status: 'completed' }, access);
  at = 1060;
  await runtime.finishSpan({ runId: 'timed', spanId: 'root', status: 'completed' }, access);
  const detail = await runtime.trace({ runId: 'timed' }, access);
  assert.deepEqual(detail.spans[0].timing, { startOffsetMs: 0, inclusiveMs: 60, exclusiveObservedMs: 20 });
  await runtime.startSpan({ runId: 'timed', spanId: 'dropped', kind: 'tool', operation: 'dropped', component }, access);
  const clipped = await runtime.trace({ runId: 'timed' }, access);
  assert.equal(clipped.coverage.droppedEvents, 1); assert.equal(clipped.spans[0].timing.exclusiveObservedMs, null);
  const restarted = createHarness({ stateStore: store, now: () => at, clockOrigin: 'device-b' }).runtime;
  await restarted.complete({ runId: 'timed', operationId: 'complete', status: 'completed' }, access);
  assert.equal((await restarted.trace({ runId: 'timed' }, access)).completion.durationMs, null);
});

test('an unavailable optional exporter cannot hold the execution response', async () => {
  const { runtime } = createHarness({ telemetry: () => new Promise(() => {}) });
  const result = await runtime.start(request('export-timeout'), access);
  assert.equal(result.status, 'running');
});
