import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createCacheContextRegistry, normalizeCacheUsage } from 'agentic-os/context/prefix';
import { createReasoningContinuityRegistry } from 'agentic-os/context/continuity';
import { normalizeJson } from 'agentic-os/context/json';

test('portable JSON snapshots reject accessors, sparse arrays, cycles and bounded-depth abuse', () => {
  const getter = { get dangerous() { assert.fail('getter must not execute'); } };
  for (const value of [getter, [,,], { value: undefined }, { value: Infinity }])
    assert.throws(() => normalizeJson(value));
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => normalizeJson(cycle), /cycles/);
  let deep = {}; for (let i = 0; i < 40; i++) deep = { deep };
  assert.throws(() => normalizeJson(deep), /budget/);
  const value = normalizeJson(JSON.parse('{"__proto__":{"safe":true},"a":1}'));
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(Object.isFrozen(value.__proto__), true);
});
test('prefix input and dynamic tails are bounded in UTF-8 and immutable', async () => {
  const registry = createCacheContextRegistry();
  const input = [{ content: 'stable' }];
  const entry = await registry.register({ namespace: 'one', revision: 'r1', stablePrefix: input });
  input[0].content = 'changed';
  assert.equal(registry.assemble({ handle: entry.handle, dynamicTail: ['request'] }).prompt[0].content, 'stable');
  assert.throws(() => registry.assemble({ handle: entry.handle, dynamicTail: ['界'.repeat(70000)] }), /byte budget/);
  await assert.rejects(registry.register({ namespace: 'one', revision: 'r2', stablePrefix: ['界'.repeat(70000)] }), /exceeds/);
  for (const namespace of ['one\0two', 'x'.repeat(513)])
    await assert.rejects(registry.register({ namespace, revision: 'r1', stablePrefix: input }));
  assert.throws(() => createCacheContextRegistry({ maxEntries: 129 }), /budget/);
  assert.throws(() => createReasoningContinuityRegistry({ maxThreads: 129 }), /budget/);
});
test('namespace routing is isolated and absent telemetry never implies a provider miss or hit', async () => {
  const registry = createCacheContextRegistry();
  const one = await registry.register({ namespace: 'one', revision: 'r1', stablePrefix: ['shared'] });
  const two = await registry.register({ namespace: 'two', revision: 'r1', stablePrefix: ['shared'] });
  assert.notEqual(one.routingKey, two.routingKey);
  assert.equal(normalizeCacheUsage({ usage: null }).provider_cache_status, 'unreported');
  assert.equal(normalizeCacheUsage({ usage: { input_tokens: 42 } }).provider_cache_status, 'unreported');
  assert.equal(normalizeCacheUsage({ usage: { input_tokens: 42,
    input_tokens_details: { cached_tokens: 0 } } }).provider_cache_status, 'miss');
  assert.equal(normalizeCacheUsage({ usage: { input_tokens: 42,
    input_tokens_details: { cached_tokens: 100 } } }).provider_cache_status, 'unreported');
});
test('the separately exported portable runtime has a closed budget and no host imports or external dependencies', () => {
  const root = new URL('../runtime/', import.meta.url);
  assert.deepEqual(readdirSync(root).sort(), ['cache-context.mjs', 'json-contract.mjs', 'reasoning-continuity.mjs']);
  let bytes = 0;
  for (const name of readdirSync(root)) {
    const source = readFileSync(new URL(name, root), 'utf8'); bytes += Buffer.byteLength(source);
    assert.ok(source.split('\n').length < 400, name);
    assert.doesNotMatch(source, /(?:node:|process\.|\bBuffer\b|\bfetch\s*\()/u);
  }
  assert.ok(bytes < 32000);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.deepEqual(pkg.dependencies, {});
  assert.ok(pkg.files.includes('runtime'));
});
