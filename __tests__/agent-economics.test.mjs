import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentResourceAdmission } from '../runtime/agents/agent-toolkit-admission.js';
import { createAgentToolkitMemoryStore } from '../runtime/agents/agent-toolkit-store.js';
import { createAgentToolkitSqliteStore } from '../runtime/agents/sqlite-store.js';
import { normalizeRunContext } from '../runtime/agents/agent-toolkit-contract.js';

const units = (inputTokens = 10, attempts = 1) => ({ inputTokens, outputTokens: 5, attempts, elapsedMs: 100 });
const context = { projectId: 'seller', goalId: 'first-deliverable', taskId: 'listing', plan: {
  repository: 'github.com/owner/source', path: 'docs/plan.md', revision: '1'.repeat(40), digest: '2'.repeat(64),
  continuityId: 'SELLER-001', revisions: { prd: '0.2.0', tad: '0.2.0', adr: '0.2.0', mvp: '0.2.0', gtm: '0.2.0' } } };
function fixture(store, clock = () => 1000, change = {}) {
  const allocation = { id: 'seller', revision: 'policy-1', windowId: 'window-1', startsAt: 0, endsAt: 10_000,
    project: units(), agent: units(), run: units(), bounds: units(), providerCostMicros: 0, ...change };
  const options = { stateStore: store, now: clock, resolveContext: async value => ({ context: value, allocation }) };
  return { allocation, options, runtime: createAgentResourceAdmission(options),
    request: { context, principalId: 'owner', runId: 'run-1', agentId: 'agent', operationId: 'step-1', phase: 'tool' } };
}

test('exact five-role source joins reject stale, extra and traversal fields', () => {
  assert.deepEqual(normalizeRunContext(context), context);
  for (const patch of [{ path: '../private' }, { revision: 'main' }, { revisions: { ...context.plan.revisions, gtm: '0.1.0' } }]) {
    assert.throws(() => normalizeRunContext({ ...context, plan: { ...context.plan, ...patch } }));
  }
  assert.throws(() => normalizeRunContext({ ...context, rawPrompt: 'private' }));
});

test('two independent coordinators atomically conserve shared project, agent and run caps', async () => {
  for (const dimension of ['project', 'agent', 'run']) {
    const store = createAgentToolkitMemoryStore({ now: () => 1000 });
    const wide = { inputTokens: 100, outputTokens: 100, attempts: 10, elapsedMs: 1000 };
    const f = fixture(store, () => 1000, { project: wide, agent: wide, run: wide, [dimension]: units() });
    const other = createAgentResourceAdmission(f.options);
    const attempts = await Promise.allSettled([
      f.runtime.reserve(f.request), other.reserve({ ...f.request, operationId: 'step-2', ...(dimension === 'project' ? { runId: 'run-2', agentId: 'other' } : {}) }),
    ]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(r => r.status === 'rejected').reason.reasonCode, `budget_${dimension}_exhausted`);
    const summary = await f.runtime.inspect(context, 'owner');
    assert.deepEqual(summary.reserved, units()); assert.deepEqual(summary.used, { inputTokens: 0, outputTokens: 0, attempts: 0, elapsedMs: 0 });
  }
});

test('restart, unknown outcome, altered replay and period change cannot refund reservations', async () => {
  let time = 1000;
  const store = createAgentToolkitMemoryStore({ now: () => time }), f = fixture(store, () => time);
  const reservation = await f.runtime.reserve(f.request);
  assert.equal((await createAgentResourceAdmission(f.options).reserve(f.request)).replay, true);
  await assert.rejects(f.runtime.reserve({ ...f.request, context: { ...context, goalId: 'altered' } }), { reasonCode: 'reservation_reused' });
  await f.runtime.settle(reservation, 'owner', null);
  await assert.rejects(f.runtime.reserve({ ...f.request, operationId: 'step-2' }), { reasonCode: 'allocation_usage_unknown' });
  time = 20_000;
  f.allocation.startsAt = 20_000; f.allocation.endsAt = 30_000; f.allocation.windowId = 'window-2';
  await assert.rejects(f.runtime.reserve({ ...f.request, operationId: 'step-2' }), { reasonCode: 'allocation_policy_conflict' });
  assert.deepEqual((await f.runtime.inspect(context, 'owner')).reserved, units());
  await assert.rejects(f.runtime.settle(reservation, 'other', units()), { reasonCode: 'allocation_forbidden' });
});

test('authoritative settlement is exact-once; overrun holds, while unknown values never become zero', async () => {
  const f = fixture(createAgentToolkitMemoryStore({ now: () => 1000 }));
  const reserved = await f.runtime.reserve(f.request), usage = { inputTokens: 4, outputTokens: 2, attempts: 1, elapsedMs: 30 };
  await f.runtime.settle(reserved, 'owner', usage); await f.runtime.settle(reserved, 'owner', usage);
  await assert.rejects(f.runtime.settle(reserved, 'owner', units()), { reasonCode: 'settlement_reused' });
  assert.deepEqual((await f.runtime.inspect(context, 'owner')).used, usage);
  const g = fixture(createAgentToolkitMemoryStore({ now: () => 1000 }));
  await g.runtime.settle(await g.runtime.reserve(g.request), 'owner', units(11));
  assert.equal((await g.runtime.inspect(context, 'owner')).status, 'held');
  await assert.rejects(g.runtime.reserve({ ...g.request, operationId: 'step-2' }), { reasonCode: 'allocation_usage_unknown' });
});

test('enrolled source resolver and free eligibility run before every reservation', async () => {
  const f = fixture(createAgentToolkitMemoryStore({ now: () => 1000 }));
  const stale = createAgentResourceAdmission({ ...f.options, resolveContext: async () => ({ context: { ...context, taskId: 'different' }, allocation: f.allocation }) });
  await assert.rejects(stale.reserve(f.request), { reasonCode: 'context_stale' });
  f.allocation.providerCostMicros = 1;
  await assert.rejects(f.runtime.reserve(f.request), { reasonCode: 'allocation_invalid' });
});

test('SQLite preserves allocation holds across independent connections and process-store restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-economics-'));
  let a, b;
  try {
    a = await createAgentToolkitSqliteStore({ directory, now: () => 1000 });
    b = await createAgentToolkitSqliteStore({ directory, now: () => 1000 });
    const f = fixture(a), g = fixture(b);
    const results = await Promise.allSettled([f.runtime.reserve(f.request), g.runtime.reserve({ ...g.request, runId: 'other' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    a.close(); b.close();
    a = await createAgentToolkitSqliteStore({ directory, now: () => 2000 });
    assert.deepEqual((await fixture(a, () => 2000).runtime.inspect(context, 'owner')).reserved, units());
  } finally { a?.close(); b?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('independent OS processes race one durable budget and retain the winner after exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-process-budget-'));
  const f = fixture(createAgentToolkitMemoryStore({ now: () => 1000 }));
  const script = `
    const {createAgentToolkitSqliteStore}=await import(process.argv[1]);
    const {createAgentResourceAdmission}=await import(process.argv[2]);
    const input=JSON.parse(process.argv[3]);
    const store=await createAgentToolkitSqliteStore({directory:input.directory,now:()=>1000});
    const runtime=createAgentResourceAdmission({stateStore:store,now:()=>1000,
      resolveContext:async context=>({context,allocation:input.allocation})});
    try {const reservation=await runtime.reserve(input.request);console.log(JSON.stringify({state:'reserved',reservation}));}
    catch(error) {console.log(JSON.stringify({reason:error.reasonCode}));}
    process.exit(0);`;
  try {
    const run = operationId => promisify(execFile)(process.execPath, ['--no-warnings', '--input-type=module', '-e', script,
      new URL('../runtime/agents/sqlite-store.js', import.meta.url).href,
      new URL('../runtime/agents/agent-toolkit-admission.js', import.meta.url).href,
      JSON.stringify({ directory, allocation: f.allocation, request: { ...f.request, operationId } })], { timeout: 10_000 });
    const results = (await Promise.all([run('a'), run('b')])).map(r => JSON.parse(r.stdout));
    assert.equal(results.filter(r => r.state === 'reserved').length, 1);
    assert.equal(results.find(r => r.reason).reason, 'budget_project_exhausted');
    const store = await createAgentToolkitSqliteStore({ directory, now: () => 2000 });
    try { assert.deepEqual((await fixture(store, () => 2000).runtime.inspect(context, 'owner')).reserved, units()); }
    finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
