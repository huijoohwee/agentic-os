import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAgentToolkitSqliteStore } from '../runtime/agents/sqlite-store.js';
import { createAgentResourceAdmission } from '../runtime/agents/agent-toolkit-admission.js';

const day = 86_400_000;
const usage = { inputTokens: 0, outputTokens: 0, attempts: 1, elapsedMs: 1 };
const context = { projectId: 'seller', goalId: 'deliverable', taskId: 'listing', plan: {
  repository: 'github.com/owner/source', path: 'docs/plan.md', revision: '1'.repeat(40), digest: '2'.repeat(64),
  continuityId: 'SELLER-001', revisions: { prd: '0.2.0', tad: '0.2.0', adr: '0.2.0', mvp: '0.2.0', gtm: '0.2.0' } } };
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-retirement-'));
  let at = 1789545600000, store;
  const now = () => at;
  const resource = stateStore => createAgentResourceAdmission({ stateStore, now, resolveContext: async value => {
    const startsAt = Math.floor(at / day) * day;
    const cap = { inputTokens: 100, outputTokens: 100, attempts: 96, elapsedMs: 100_000 };
    return { context: value, allocation: { id: 'seller', revision: 'v1', windowId: String(startsAt), startsAt,
      endsAt: startsAt + day, project: cap, agent: cap, run: cap,
      bounds: { ...usage, elapsedMs: 1000 }, providerCostMicros: 0 } };
  } });
  const open = async () => { store = await createAgentToolkitSqliteStore({ directory, now }); return resource(store); };
  t.after(() => { store?.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, now, resource, open, get store() { return store; }, advance(ms) { at += ms; },
    request(principalId, extra = {}) { return { context, principalId, runId: `run-${principalId}`, agentId: 'agent', operationId: 'plan', phase: 'plan', ...extra }; },
    snapshot() { const db = new DatabaseSync(join(directory, 'swarm.sqlite'), { readOnly: true });
      try { return db.prepare('SELECT body FROM agent_records').all().map(row => JSON.parse(row.body).payload); } finally { db.close(); } } };
}

test('bounded SQLite store recovers after principal churn, closed windows and process-store restart', async t => {
  const f = await fixture(t); let runtime = await f.open(), settled = 0, refused = 0;
  for (let i = 0; i < 100; i++) {
    const request = f.request(`buyer-${i}`);
    try { await runtime.settle(await runtime.reserve(request), request.principalId, usage); settled++; }
    catch (error) { assert.match(error.message, /capacity/); refused++; }
  }
  assert.ok(settled > 20 && refused > 0, 'finite same-window capacity still refuses');
  assert.ok(f.snapshot().length <= 128);
  f.store.close(); f.advance(30 * day); runtime = await f.open();
  await f.store.get('sweep');
  assert.equal(f.snapshot().length, 0, 'settled allocations, indices and orphan markers retire together');
  await runtime.settle(await runtime.reserve(f.request('new-buyer')), 'new-buyer', usage);
  for (let window = 0; window < 10; window++) {
    f.advance(8 * day);
    for (let i = 0; i < 20; i++) {
      const principal = `daily-${window}-${i}`;
      await runtime.settle(await runtime.reserve(f.request(principal)), principal, usage);
    }
    assert.ok(f.snapshot().length < 128);
  }
});

test('reserved, unknown and overrun usage survives expiry and restart without quota refunds', async t => {
  const f = await fixture(t); let runtime = await f.open();
  for (const state of ['reserved', 'unknown', 'overrun']) {
    const reservation = await runtime.reserve(f.request(state));
    if (state !== 'reserved') await runtime.settle(reservation, state, state === 'unknown' ? null : { ...usage, attempts: 2 });
  }
  for (let i = 0; i < 8; i++) await runtime.reserve(f.request('eight-projects', { context: { ...context, projectId: `project-${i}` } }));
  f.store.close(); f.advance(30 * day); runtime = await f.open();
  await f.store.get('sweep');
  for (const state of ['reserved', 'unknown', 'overrun']) {
    const allocation = f.snapshot().find(row => row.ownerPrincipalId === state);
    assert.equal(allocation.entries[0].state, state);
    await assert.rejects(runtime.reserve(f.request(state, { operationId: 'next' })), { reasonCode: 'allocation_policy_conflict' });
  }
  await assert.rejects(runtime.reserve(f.request('eight-projects', { context: { ...context, projectId: 'ninth' } })), { reasonCode: 'allocation_quota_exceeded' });
});

test('retirement respects active allocation and admission fences across independent connections', async t => {
  for (const kind of ['allocation', 'admission', 'shard']) {
    const f = await fixture(t), runtime = await f.open();
    const reservation = await runtime.reserve(f.request(kind)); await runtime.settle(reservation, kind, usage);
    const id = kind === 'allocation' ? reservation.recordId : f.snapshot().find(row => row.schema === `agent-toolkit-admission${kind === 'shard' ? '-shard' : ''}/v1`).recordId;
    await f.store.claim(id, 'held-fence', f.now() + 10 * day);
    const peer = await createAgentToolkitSqliteStore({ directory: f.directory, now: f.now });
    try {
      f.advance(8 * day); await peer.get('sweep');
      assert.ok(f.snapshot().some(row => row.recordId === reservation.recordId));
      assert.equal(await peer.claim(id, 'stale-writer', f.now() + 1000), null);
      await f.store.release(id, 'held-fence'); await peer.get('sweep');
      assert.equal(f.snapshot().length, 0);
    } finally { peer.close(); }
  }
});

test('delayed old-window reservation cannot recreate retired accounting', async t => {
  const f = await fixture(t); await f.open();
  const delayed = { ...f.store, async put(record) {
    if (record.schema === 'agent-resource-allocation/v1') f.advance(day);
    return f.store.put(record);
  } };
  await assert.rejects(f.resource(delayed).reserve(f.request('delayed')), /future integer timestamp/);
  await f.store.get('sweep'); assert.equal(f.snapshot().length, 0);
});

test('legacy settled accounting retires only after the supported maximum timer and keeps unknown holds', async t => {
  const f = await fixture(t), runtime = await f.open();
  await runtime.settle(await runtime.reserve(f.request('legacy')), 'legacy', usage);
  const held = await runtime.reserve(f.request('legacy-unknown')); await runtime.settle(held, 'legacy-unknown', null);
  for (const record of f.snapshot()) {
    if (record.allocations) record.allocations = record.allocations.map(entry => entry.digest);
    delete record.retentionEndsAt;
    for (const entry of record.principals ?? []) delete entry.retentionEndsAt;
    await f.store.claim(record.recordId, 'legacy-fixture', f.now() + 1000);
    await f.store.replace(record.recordId, 'legacy-fixture', record);
  }
  f.advance(8 * day); await f.store.get('sweep');
  assert.ok(f.snapshot().some(row => row.schema === 'agent-toolkit-admission/v1' && !row.allocations.length), 'old retention is conservatively bounded');
  f.advance(30 * day); await f.store.get('sweep');
  assert.equal(f.snapshot().filter(row => row.schema === 'agent-toolkit-admission/v1').length, 1);
  assert.equal(f.snapshot().find(row => row.ownerPrincipalId === 'legacy-unknown').entries[0].state, 'unknown');
});

test('same-window replay and concurrent post-retirement reservations conserve the new budget', async t => {
  const f = await fixture(t); const runtime = await f.open();
  const request = f.request('same-buyer'), reservation = await runtime.reserve(request);
  await runtime.settle(reservation, request.principalId, usage);
  assert.equal((await runtime.reserve(request)).replay, true);
  assert.equal((await runtime.inspect(context, request.principalId)).used.attempts, 1);
  f.advance(day);
  const peer = await createAgentToolkitSqliteStore({ directory: f.directory, now: f.now });
  try {
    const results = await Promise.all([runtime.reserve(request), f.resource(peer).reserve(request)]);
    assert.equal(results.filter(result => result.replay === false).length, 1);
    assert.equal((await runtime.inspect(context, request.principalId)).reserved.attempts, 1);
  } finally { peer.close(); }
});


test('full seven-day post-window retention prevents overlap refunds before and after retirement', async t => {
  const f = await fixture(t); const runtime = await f.open(), startsAt = f.now();
  await runtime.settle(await runtime.reserve(f.request('overlap')), 'overlap', usage);
  const revised = endsAt => createAgentResourceAdmission({ stateStore: f.store, now: f.now,
    resolveContext: async value => ({ context: value, allocation: { id: 'seller', revision: 'v1', windowId: String(startsAt),
      startsAt, endsAt, project: usage, agent: usage, run: usage, bounds: usage, providerCostMicros: 0 } }) });
  f.advance(day);
  await assert.rejects(revised(startsAt + 2 * day).reserve(f.request('overlap')), { reasonCode: 'allocation_policy_conflict' });
  f.advance(6 * day - 1);
  await f.store.get('sweep');
  assert.ok(f.snapshot().some(row => row.schema === 'agent-resource-allocation/v1'));
  f.advance(day + 1); await f.store.get('sweep');
  assert.equal(f.snapshot().length, 0);
  await assert.rejects(revised(startsAt + 7 * day).reserve(f.request('overlap')), { reasonCode: 'allocation_window_closed' });
  await assert.rejects(revised(f.now() + day).reserve(f.request('overlap')), { reasonCode: 'allocation_invalid' });
  await runtime.reserve(f.request('overlap'));
});
