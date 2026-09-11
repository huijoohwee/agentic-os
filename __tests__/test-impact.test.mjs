import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { references, selectTests, validateContracts } from '../bin/agentic-os-test-impact.mjs';
import { snapshot } from '../bin/agentic-os-test-inputs.mjs';

const file = text => ({ text, digest: text, mode: '100644' });
function fixture() {
  const contracts = { schema: 'agentic-os/test-impact-contracts/v1',
    sentinels: ['safety.test.mjs'], packaging: ['package.test.mjs'], broad: ['package.json', 'test/impact-contracts.json'],
    rules: [{ id: 'documents', inputs: ['docs/'], tests: ['docs.test.mjs'] }], dependencies: {} };
  const entries = {
    'package.json': JSON.stringify({ exports: { './public': './src/a.mjs' } }),
    'test/impact-contracts.json': JSON.stringify(contracts),
    'src/a.mjs': 'export const value = 1;', 'src/b.mjs': "export { value } from './a.mjs';",
    'src/isolated.mjs': 'export const other = 1;', 'docs/a.md': 'description',
    '__tests__/safety.test.mjs': '', '__tests__/docs.test.mjs': '', '__tests__/package.test.mjs': '',
    '__tests__/a.test.mjs': "import { value } from '../src/b.mjs';",
    '__tests__/public.test.mjs': "await import('agentic-os/public');",
    '__tests__/isolated.test.mjs': "import '../src/isolated.mjs';",
    '__tests__/other.test.mjs': '', '__tests__/more.test.mjs': '',
  };
  const before = new Map(Object.entries(entries).map(([path, text]) => [path, file(text)]));
  return { before, after: new Map(before), contracts };
}
const paths = plan => plan.suites.map(suite => suite.path);

test('transitive imports, re-exports and package exports select consumers without unrelated packaging', () => {
  const f = fixture(), plan = selectTests({ ...f, changed: ['src/a.mjs'] });
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(paths(plan), ['__tests__/a.test.mjs', '__tests__/public.test.mjs', '__tests__/safety.test.mjs']);
  assert.deepEqual(plan.stages[1].tests, []);
  assert.ok(plan.suites.find(s => s.path === '__tests__/a.test.mjs').reasons.includes('dependency:src/a.mjs'));
});
test('removed imports and deleted/renamed source retain old consumers', () => {
  const f = fixture(); f.after.delete('src/a.mjs');
  f.after.set('src/b.mjs', file("export { value } from './renamed.mjs';"));
  f.after.set('src/renamed.mjs', file('export const value = 2;'));
  const plan = selectTests({ ...f, changed: ['src/a.mjs', 'src/b.mjs', 'src/renamed.mjs'] });
  assert.ok(paths(plan).includes('__tests__/a.test.mjs'));
  assert.ok(paths(plan).includes('__tests__/public.test.mjs'));
});
test('documents use explicit contracts and changed tests run directly', () => {
  const f = fixture();
  const plan = selectTests({ ...f, changed: ['docs/a.md', '__tests__/isolated.test.mjs'] });
  assert.deepEqual(paths(plan), ['__tests__/docs.test.mjs', '__tests__/isolated.test.mjs', '__tests__/safety.test.mjs']);
});
test('unmapped paths, shared configuration and opaque affected code broaden with a reason', () => {
  for (const changed of [['new.dat'], ['package.json']]) {
    const f = fixture(), plan = selectTests({ ...f, changed });
    assert.equal(plan.mode, 'broad'); assert.equal(plan.suites.length, plan.available);
    assert.ok(plan.reasons.some(reason => reason.endsWith(changed[0])));
  }
  const f = fixture(); f.after.set('src/b.mjs', file('await import(computedPath);'));
  const plan = selectTests({ ...f, changed: ['src/b.mjs'] });
  assert.ok(plan.reasons.includes('opaque-dependency:src/b.mjs'));
  const elsewhere = selectTests({ ...f, changed: ['src/isolated.mjs'] });
  assert.equal(elsewhere.mode, 'broad', 'an opaque loader may consume a changed file without a static edge');
});
test('no changes still runs safety sentinels, while all selects every suite', () => {
  const f = fixture();
  assert.deepEqual(paths(selectTests({ ...f, changed: [] })), ['__tests__/safety.test.mjs']);
  const all = selectTests({ ...f, changed: [], forceAll: true });
  assert.equal(all.suites.length, all.available); assert.deepEqual(all.reasons, ['explicit-all']);
});
test('contract drift and missing suites cannot silently remove obligations', () => {
  const f = fixture();
  assert.throws(() => validateContracts({ ...f.contracts, sentinels: [] }, f.after), /contracts/);
  assert.throws(() => validateContracts({ ...f.contracts, packaging: ['missing.test.mjs'] }, f.after), /contracts/);
  assert.throws(() => validateContracts({ ...f.contracts, unexpected: true }, f.after), /contracts/);
  assert.throws(() => validateContracts({ ...f.contracts, dependencies: { 'src/a.mjs': ['../escape'] } }, f.after), /contracts/);
});
test('literal process paths and split basenames add dependencies conservatively', () => {
  const f = fixture();
  const result = references('__tests__/other.test.mjs', "spawn(node, ['src/a.mjs']); join(root, 'src', 'isolated.mjs')", f.after);
  assert.ok(result.dependencies.has('src/a.mjs')); assert.ok(result.dependencies.has('src/isolated.mjs'));
});
test('mixed quotes and query/fragment imports cannot hide a module dependency', () => {
  const f = fixture();
  for (const text of [
    'const description="don\'t omit"; import "./a.mjs";',
    'await import("./a.mjs?instance=1#copy");',
    'export { value } from "./a.mjs";',
  ]) assert.ok(references('src/b.mjs', text, f.after).dependencies.has('src/a.mjs'), text);
  assert.ok(references('src/b.mjs', 'await import("missing-package")', f.after).unresolved.length);
});
test('actual source covers known budget/packaging regressions and preserves a small independent module', () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), s = snapshot({ root, base: 'HEAD' });
  const select = changed => selectTests({ before: s.after, after: s.after, changed });
  const fleet = select(['bin/agentic-os-fleet.mjs']);
  assert.ok(paths(fleet).includes('__tests__/fleet.test.mjs'));
  assert.ok(fleet.suites.length < fleet.available / 3);
  assert.deepEqual(fleet.stages[1].tests, []);
  const docs = select(['docs/adlc-guidelines.md']);
  assert.ok(paths(docs).includes('__tests__/runtime-budgets.test.mjs'));
  assert.ok(paths(docs).includes('__tests__/packed-setup.test.mjs'));
  const hook = select(['.githooks/pre-push']); assert.equal(hook.suites.length, hook.available);
  const contract = JSON.parse(readFileSync(new URL('../test/impact-contracts.json', import.meta.url)));
  assert.ok(contract.packaging.includes('space-path-entrypoints.test.mjs'));
});
