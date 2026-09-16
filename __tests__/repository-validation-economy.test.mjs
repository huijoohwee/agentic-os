import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ECONOMY_FILE, economyContext, readEconomy, observeCost, costOrderedChecks,
  resourcePlan } from '../bin/agentic-os-validation-economy.mjs';
const check = (name, requires = [], mandatory = false) => ({ name, requires,
  reasons: mandatory ? ['mandatory'] : ['input:source'], command: 'node', args: [name], timeoutMs: 900000 });
const state = checks => ({ schema: 'agentic-os/validation-economy/v1', authority: false,
  context: 'context', status: 'observed', checks });
const cost = (meanMs, failureRate = 0, samples = 3) => ({ meanMs, failureRate, samples, observedAt: Date.now() });
const names = checks => checks.map(c => c.name);

test('cost learning preserves exact coverage, prerequisites and mandatory precedence', () => {
  const checks = [check('mandatory', ['prepare'], true), check('slow'), check('quick'), check('prepare'), check('failing')];
  const learned = state({ mandatory: cost(1), prepare: cost(2), slow: cost(10000), quick: cost(100), failing: cost(200, 1) });
  const ordered = costOrderedChecks(checks, learned);
  assert.deepEqual(names(ordered), ['prepare', 'mandatory', 'failing', 'quick', 'slow']);
  assert.deepEqual(new Set(ordered), new Set(checks));
  for (const item of ordered) for (const dependency of item.requires)
    assert.ok(names(ordered).indexOf(dependency) < names(ordered).indexOf(item.name));
  assert.deepEqual(checks.map(c => c.timeoutMs), ordered.map(c => c.timeoutMs));
});

test('cold or partial feedback retains declared order; cycles fail loudly', () => {
  const checks = [check('slow'), check('fast')];
  assert.deepEqual(names(costOrderedChecks(checks, state({}))), ['slow', 'fast']);
  assert.deepEqual(names(costOrderedChecks(checks, state({ slow: cost(9000), fast: cost(1, 1, 2) }))), ['slow', 'fast']);
  assert.throws(() => costOrderedChecks([check('a', ['b']), check('b', ['a'])], state({})), /dependencies/);
});

test('observations are bounded, adapt to new cost and flag measured regressions', () => {
  const s = state({}), c = check('build');
  for (let i = 0; i < 40; i++) observeCost(s, c, { elapsedMs: 100, exitCode: 0, reason: null });
  assert.equal(s.checks.build.samples, 32);
  assert.deepEqual(observeCost(s, c, { elapsedMs: 1500, exitCode: 1, reason: null }),
    { check: 'build', previousMeanMs: 100, observedMs: 1500 });
  assert.equal(s.checks.build.meanMs, 450); assert.equal(s.checks.build.failureRate, 0.25);
  assert.throws(() => observeCost(s, c, { elapsedMs: Infinity }), /cost-observation/);
  observeCost(s, check('constructor'), { elapsedMs: 10, exitCode: 0, reason: null });
  assert.equal(s.checks.constructor.meanMs, 10);
});

test('stale, corrupt, wrong-context, symlink and oversized feedback cannot affect order', t => {
  const root = mkdtempSync(join(tmpdir(), 'validation-economy-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, ECONOMY_FILE), valid = state({ build: cost(100) });
  assert.deepEqual(readEconomy(root, 'context').checks, {});
  writeFileSync(file, JSON.stringify(valid)); assert.equal(readEconomy(root, 'context').checks.build.meanMs, 100);
  assert.deepEqual(readEconomy(root, 'context', Date.now(), ['different-check']).checks, {});
  assert.deepEqual(readEconomy(root, 'different').checks, {});
  assert.deepEqual(readEconomy(root, 'context', Date.now() + 15 * 86400000).checks, {});
  writeFileSync(file, JSON.stringify(state({ build: { ...cost(10), failureRate: 2 } })));
  assert.deepEqual(readEconomy(root, 'context').checks, {});
  writeFileSync(file, 'x'.repeat(64001)); assert.deepEqual(readEconomy(root, 'context').checks, {});
  rmSync(file); writeFileSync(join(root, 'target'), JSON.stringify(valid)); symlinkSync('target', file);
  assert.deepEqual(readEconomy(root, 'context').checks, {});
});

test('context isolates runtime and environment; estimates are observations rather than hard timeouts', () => {
  const identity = { root: '/repo', environmentDigest: 'env', node: 'v22', executable: '/node', platform: 'linux', arch: 'arm64' };
  assert.notEqual(economyContext('p', 'r', identity), economyContext('p', 'r', { ...identity, environmentDigest: 'new' }));
  assert.notEqual(economyContext('p', 'r', identity), economyContext('p', 'new-runtime', identity));
  const checks = [check('a'), check('b')], previews = [{ id: 'a', reuse: true }, { id: 'b', reuse: false }];
  const options = { checkout: 'pull-request-merge', observedBytes: 1234, runMs: 3600000 };
  const cold = resourcePlan(checks, state({}), previews, options);
  assert.equal(cold.estimatedMs, null); assert.equal(cold.unknownCosts, 1);
  const warm = resourcePlan(checks, state({ b: cost(200) }), previews, options);
  assert.equal(warm.estimatedMs, 200); assert.equal(warm.checkout.diffMinimumDepth, 2);
  assert.equal(warm.checkout.automaticFetch, false); assert.equal(warm.authority, false);
  assert.equal(resourcePlan(checks, state({}), previews, { ...options, checkout: 'pull-request-head' }).checkout.diffMinimumDepth, null);
});

test('timeout teardown remains an observation without extending the execution deadline', () => {
  const s = state({}), c = check('timeout');
  observeCost(s, c, { elapsedMs: 900123, exitCode: null, reason: 'timeout' });
  assert.equal(s.checks.timeout.meanMs, 900123);
  assert.equal(s.checks.timeout.failureRate, 1);
  assert.equal(c.timeoutMs, 900000);
  assert.deepEqual(resourcePlan([c], s, [{ id: c.name, unchangedFailure: true }], {}).unchangedFailures, ['timeout']);
});
