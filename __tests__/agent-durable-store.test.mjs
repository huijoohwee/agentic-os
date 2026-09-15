import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSwarmSqliteStore } from '../runtime/agents/sqlite-store.js';
import { createDurableObjectSwarmRunStore, createDurableObjectAgentToolkitStore }
  from '../runtime/agents/durable-object-store.js';

const fixture = join(import.meta.dirname, 'agents/store-process.mjs');
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'durable-agent-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
async function child(t, input) {
  const process = fork(fixture, [JSON.stringify(input)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (process.exitCode === null) process.kill('SIGKILL'); });
  const [ready] = await once(process, 'message');
  assert.deepEqual(ready, { type: 'ready' });
  return process;
}
function execute(process) {
  const result = once(process, 'message'); process.send('go');
  return result.then(([message]) => { assert.equal(message.type, 'result', JSON.stringify(message)); return message; });
}

test('a killed process preserves committed checkpoint and recovers only after claim expiry', { timeout: 10_000 }, async t => {
  const path = directory(t);
  const worker = await child(t, { directory: path, action: 'checkpoint', claimId: 'old-worker' });
  assert.equal((await execute(worker)).acquired, true);
  const exit = once(worker, 'exit'); worker.kill('SIGKILL'); await exit;
  let now = 1_500;
  const store = await createAgentSwarmSqliteStore({ directory: path, now: () => now });
  t.after(() => store.close());
  const checkpoint = await store.get('restart');
  assert.deepEqual(checkpoint.checkpoint, { effectKey: 'stable-effect', receiptId: 'accepted-receipt', step: 2 });
  assert.equal(await store.claim('restart', 'new-worker', 3_000), null);
  now = 2_001;
  assert.deepEqual(await store.claim('restart', 'new-worker', 3_000), checkpoint);
  assert.equal(await store.replace('restart', 'old-worker', { ...checkpoint, checkpoint: null }), false);
  assert.equal(await store.commit('restart', 'old-worker'), false);
  assert.equal(await store.replace('restart', 'new-worker', { ...checkpoint, resumed: true }), true);
  assert.equal((await store.get('restart')).resumed, true);
});

test('independent processes racing the same persistent record produce exactly one claim', { timeout: 10_000 }, async t => {
  const path = directory(t);
  const store = await createAgentSwarmSqliteStore({ directory: path, now: () => 1_000 });
  await store.put({ runId: 'race', expiresAt: 10_000 }); store.close();
  const workers = await Promise.all(['first', 'second'].map(claimId => child(t,
    { directory: path, runId: 'race', action: 'claim', claimId })));
  const outcomes = await Promise.all(workers.map(execute));
  assert.equal(outcomes.filter(result => result.acquired).length, 1);
  await Promise.all(workers.map(worker => worker.exitCode === null ? once(worker, 'exit') : undefined));
});

test('persistent queue and execution caps reject atomically and retain the prior record', async t => {
  const path = directory(t);
  const store = await createAgentSwarmSqliteStore({ directory: path, now: () => 1_000,
    maxRecords: 3, maxRecordsPerPrincipal: 2, maxActiveTasks: 2, maxActiveTasksPerPrincipal: 1 });
  t.after(() => store.close());
  const job = (runId, ownerPrincipalId, active = false) => ({ runId, ownerPrincipalId, expiresAt: 10_000,
    tasks: active ? [{ status: 'running', leaseExpiresAt: 5_000 }] : [] });
  await store.put(job('a', 'alice', true));
  await store.put(job('b', 'alice'));
  await assert.rejects(store.put(job('c', 'alice')), /capacity/);
  const before = await store.claim('b', 'claim-b', 2_000);
  await assert.rejects(store.replace('b', 'claim-b', job('b', 'alice', true)), /capacity/);
  assert.deepEqual(await store.get('b'), before);
  await assert.rejects(store.replace('b', 'claim-b', job('b', 'bob')), /principal changed/);
  assert.equal(await store.release('b', 'claim-b'), true);
  await store.put(job('c', 'bob', true));
  await assert.rejects(store.put(job('d', 'charlie')), /capacity/);
  assert.equal(await store.put(job('a', 'alice')), false);
});

test('invalid state, changed limits, rollback clocks and unsafe paths fail without replacing data', async t => {
  const path = directory(t);
  let now = 1_000;
  const store = await createAgentSwarmSqliteStore({ directory: path, now: () => now });
  await store.put({ runId: 'retained', ownerPrincipalId: 'unassigned', expiresAt: 10_000 });
  await store.claim('retained', 'owner', 2_000);
  await assert.rejects(store.replace('retained', 'owner', {
    runId: 'retained', ownerPrincipalId: 'someone-else', expiresAt: 10_000,
  }), /principal changed/);
  await assert.rejects(store.put({ runId: 'large', expiresAt: 10_000, data: '界'.repeat(180_000) }), /byte capacity/);
  now = 999;
  await assert.rejects(store.get('retained'), /clock regressed/);
  store.close();
  await assert.rejects(createAgentSwarmSqliteStore({ directory: path, maxRecords: 1 }), /configuration changed/);
  const reopened = await createAgentSwarmSqliteStore({ directory: path, now: () => 1_001 });
  assert.equal((await reopened.get('retained')).runId, 'retained'); reopened.close();
  const unsafe = directory(t); symlinkSync(join(path, 'swarm.sqlite'), join(unsafe, 'swarm.sqlite'));
  await assert.rejects(createAgentSwarmSqliteStore({ directory: unsafe }), /private owned/);
});

test('optional edge transport retains existing state identities and operation bodies', async () => {
  for (const [factory, prefix, key] of [[createDurableObjectSwarmRunStore, 'swarm-run:', 'runId'],
    [createDurableObjectAgentToolkitStore, 'agent-toolkit:', 'recordId']]) {
    const requests = [], record = { [key]: 'existing', expiresAt: 10_000 };
    const store = factory({ namespace: {
      idFromName(name) { assert.equal(name, prefix + 'existing'); return name; },
      get(id) { return { async fetch(url, options) {
        assert.equal(id, prefix + 'existing');
        assert.equal(url, 'https://agent-state.internal/operation');
        assert.equal(options.method, 'POST'); requests.push(JSON.parse(options.body));
        return Response.json({ stored: true, record, replaced: true, released: true, committed: true, deleted: true });
      } }; },
    } });
    assert.equal(await store.put(record), true);
    assert.deepEqual(await store.get('existing'), record);
    assert.deepEqual(await store.claim('existing', 'claim', 2_000), record);
    assert.equal(await store.replace('existing', 'claim', record), true);
    assert.equal(await store.release('existing', 'claim'), true);
    assert.equal(await store.delete('existing'), true);
    assert.deepEqual(requests.map(value => value.operation), ['put', 'get', 'claim', 'replace', 'release', 'delete']);
    assert.deepEqual(requests[2].value, { claimId: 'claim', claimExpiresAt: 2_000 });
    assert.deepEqual(requests[3].value, { claimId: 'claim', record });
  }
});
