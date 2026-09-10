import test from 'node:test';
import assert from 'node:assert/strict';
import { FRONTMATTER_LIMITS as limits, snapshotFrontmatter, JsonSnapshotError } from 'agentic-os/frontmatter';

const rejects = (value, code) => assert.throws(() => snapshotFrontmatter(value),
  error => error instanceof JsonSnapshotError && error.code === code);

test('parsed metadata is detached, deeply immutable and retains literal fields', () => {
  const input = { schema: 'product/v1', local_rung: 'unproven', flow: { nodes: ['one'] } };
  const result = snapshotFrontmatter(input);
  input.flow.nodes.push('two');
  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(result.flow.nodes, ['one']);
  assert.equal(result.local_rung, 'unproven'); // Values require the consumer's semantic validator.
  assert.equal(Object.isFrozen(result.flow.nodes), true);
  assert.throws(() => { result.schema = 'changed'; }, TypeError);
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":"literal"}');
  assert.equal(snapshotFrontmatter(hostile).__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
});

test('metadata rejects ambiguous or executable object representations', () => {
  for (const input of [null, [], true, 'schema: test']) rejects(input, 'frontmatter-mapping-required');
  const alias = {};
  rejects({ first: alias, second: alias }, 'json-alias-invalid');
  const cycle = {}; cycle.self = cycle;
  rejects(cycle, 'json-alias-invalid');
  rejects({ time: new Date() }, 'object-prototype-invalid');
  rejects({ result: Infinity }, 'number-invalid');
  let invoked = false;
  rejects({ get secret() { invoked = true; return 'secret'; } }, 'object-accessor-invalid');
  rejects(new Proxy({}, { ownKeys() { invoked = true; return []; } }), 'proxy-object-invalid');
  assert.equal(invoked, false);
});

test('metadata envelope bounds depth, collections, nodes and UTF-8 strings', () => {
  assert.equal(snapshotFrontmatter({ text: 'a'.repeat(limits.maxStringBytes) }).text.length,
    limits.maxStringBytes);
  rejects({ text: 'é'.repeat(limits.maxStringBytes / 2 + 1) }, 'string-budget');
  rejects({ items: Array(limits.maxArrayLength + 1).fill(null) }, 'array-budget');
  rejects(Object.fromEntries(Array.from({ length: limits.maxObjectKeys + 1 }, (_, i) => [i, null])),
    'object-budget');
  let nested = {};
  for (let i = 0; i <= limits.maxDepth; i += 1) nested = { child: nested };
  rejects(nested, 'depth-budget');
  rejects({ items: Array.from({ length: 5 }, () => Array(1000).fill(null)) }, 'node-budget');
  rejects(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i, 'x'.repeat(16_000)])),
    'aggregate-string-budget');
});
