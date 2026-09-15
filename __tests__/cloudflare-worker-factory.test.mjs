import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareWorker } from '../runtime/adapters/cloudflare-worker.js';

const request = path => new Request(`https://worker.example${path}`);

test('generic Worker readiness requires no product extension', async () => {
  const worker = createCloudflareWorker();
  assert.equal(worker.fetch, worker.handleCloudflareRequest);
  const response = await worker.fetch(request('/ready'), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
});

test('extension is lazy, isolated per host and environment, and precedes readiness', async () => {
  const events = [], contexts = [], registries = [], environments = [];
  const env = { ASSETS: { fetch: () => { throw Error('unexpected asset fallback'); } } };
  const ctx = {};
  const createExtension = ({ env: selected, agentDefinitions }) => {
    events.push('create');
    environments.push(selected);
    assert.equal(typeof agentDefinitions, 'object');
    registries.push(agentDefinitions);
    return {
      handle(req, context) {
        contexts.push(context);
        events.push(new URL(req.url).pathname);
        return new URL(req.url).pathname === '/product' ? Response.json({ product: true }) : null;
      },
      beforeReadiness() { events.push('rehydrate'); },
    };
  };
  const first = createCloudflareWorker({ createExtension });
  const second = createCloudflareWorker({ createExtension });
  assert.deepEqual(events, []);
  assert.deepEqual(await (await first.fetch(request('/product'), env, ctx)).json(), { product: true });
  assert.equal((await first.fetch(request('/ready'), env, ctx)).status, 200);
  assert.deepEqual(events, ['create', '/product', '/ready', 'rehydrate']);
  assert.ok(contexts.every(context => context === ctx));
  assert.equal((await second.fetch(request('/ready'), env)).status, 200);
  assert.notEqual(registries[0], registries[1]);
  await first.fetch(request('/product'), { ...env });
  assert.deepEqual(environments.slice(0, 2), [env, env]);
  assert.notEqual(environments[2], env);
  assert.notEqual(registries[2], registries[0]);
});

test('invalid extension contracts and responses fail without asset fallback', async () => {
  let assetCalls = 0;
  const env = { ASSETS: { fetch: () => { assetCalls++; return Response.json({}); } } };
  assert.throws(() => createCloudflareWorker({ createExtension: {} }), /explicit factory/u);
  const invalid = createCloudflareWorker({ createExtension: () => ({ handle() {} }) });
  await assert.rejects(invalid.fetch(request('/'), env), /readiness handlers/u);
  const undefinedResponse = createCloudflareWorker({ createExtension: () => ({
    handle() {}, beforeReadiness() {},
  }) });
  await assert.rejects(undefinedResponse.fetch(request('/'), env), /invalid response/u);
  const deniedReadiness = createCloudflareWorker({ createExtension: () => ({
    handle: () => null, beforeReadiness() { throw Error('product restoration failed'); },
  }) });
  await assert.rejects(deniedReadiness.fetch(request('/ready'), env), /restoration failed/u);
  assert.equal(assetCalls, 0);
});
