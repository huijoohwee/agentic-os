import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareAgentConfig } from '../runtime/adapters/cloudflare-config.js';
import worker, { AgentState, CanvasRoom } from '../runtime/adapters/cloudflare-entry.js';
const identity = { name: 'fixture-agent', main: './worker.js', authSessionNamespace: '41001', canvasRoomNamespace: '41002' };

test('headless configuration preserves both class identities and free runtime bounds', () => {
  const config = createCloudflareAgentConfig(identity);
  assert.deepEqual(config.durable_objects.bindings.map(x => x.class_name), [CanvasRoom.name, AgentState.name]);
  assert.deepEqual(config.migrations, [
    { tag: 'v1-canvas-room', new_sqlite_classes: ['CanvasRoom'] },
    { tag: 'v2-agent-state', new_sqlite_classes: ['AgentState'] },
  ]);
  assert.equal(config.limits, undefined); assert.equal(config.assets, undefined);
  assert.equal(config.routes, undefined); assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false); assert.equal(config.compatibility_date, '2026-07-05');
  assert.deepEqual(config.ratelimits.map(x => x.simple), [{ limit: 30, period: 60 }, { limit: 120, period: 60 }]);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.deepEqual(config.secrets.required, ['AGENT_API_JWT_SECRET', 'AGENT_REVIEW_JWT_SECRET']);
});

test('deployment and rate-limit identities are explicit and isolated between consumers', () => {
  for (const invalid of [undefined, {}, { ...identity, name: '' }, { ...identity, main: '' },
    { ...identity, authSessionNamespace: '41002' }, { ...identity, canvasRoomNamespace: 'secret' }])
    assert.throws(() => createCloudflareAgentConfig(invalid), TypeError);
  const first = createCloudflareAgentConfig(identity);
  first.durable_objects.bindings[0].class_name = 'Changed'; first.secrets.required.push('PRODUCT_SECRET');
  const next = createCloudflareAgentConfig({ ...identity, name: 'other-agent', authSessionNamespace: '42001' });
  assert.equal(next.durable_objects.bindings[0].class_name, 'CanvasRoom');
  assert.equal(next.secrets.required.includes('PRODUCT_SECRET'), false);
  assert.equal(next.ratelimits[0].namespace_id, '42001');
});

test('optional native entry serves readiness without assets or an injected product', async () => {
  const env = {};
  const ready = await worker.fetch(new Request('https://fixture.invalid/ready'), env, {});
  assert.equal(ready.status, 200); assert.match(ready.headers.get('content-type'), /application\/json/);
  const root = await worker.fetch(new Request('https://fixture.invalid/'), env, {});
  assert.equal(root.status, 404);
});
