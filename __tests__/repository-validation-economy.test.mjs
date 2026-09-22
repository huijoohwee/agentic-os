import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, realpathSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { receiptDirectory, lockReceipts } from '../bin/agentic-os-test-receipt.mjs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { startWorkflow } from '../bin/agentic-os-workflow.mjs';
import { runRepositoryValidation } from '../bin/agentic-os-validation.mjs';
import { ECONOMY_FILE, economyContext, readEconomy, observeCost, costOrderedChecks,
  resourcePlan, economyFeedback, recordEconomy } from '../bin/agentic-os-validation-economy.mjs';
const check = (name, requires = [], mandatory = false) => ({ name, requires,
  reasons: mandatory ? ['mandatory'] : ['input:source'], command: 'node', args: [name], timeoutMs: 900000 });
const state = checks => ({ schema: 'agentic-os/validation-economy/v1', authority: false,
  context: 'context', status: 'observed', checks });
const cost = (meanMs, failureRate = 0, samples = 3) => ({ meanMs, failureRate, samples, observedAt: Date.now() });
const names = checks => checks.map(c => c.name);

test('resource feedback flags measured regressions, excludes reuse and deduplicates older CI observations', () => {
  const s = state({}), c = check('ci-queue'), now = Date.now();
  const sample = i => ({ elapsedMs: 100, queueWaitMs: 100, exitCode: 0, reason: null,
    finishedAt: now - 1000 + i, observationId: String(i).padStart(64, '0'), sourceRevision: 'a'.repeat(40),
    resources: { status: 'measured', method: 'wait4', scope: 'waited-process-tree',
      memoryScope: 'maximum-single-process-rss', cpuMs: 10, peakMemoryBytes: 1000 } });
  for (let i = 1; i <= 3; i++) observeCost(s, c, sample(i), now);
  const prior = JSON.stringify(s);
  observeCost(s, c, sample(2), now); observeCost(s, c, { ...sample(4), reused: true }, now);
  assert.equal(JSON.stringify(s), prior);
  const result = sample(4); result.resources.cpuMs = 100;
  const regression = observeCost(s, c, result, now);
  assert.equal(regression.resources[0].metric, 'cpuMs');
  const feedback = economyFeedback(s);
  assert.equal(feedback.authority, false); assert.equal(feedback.ranking[0].nextAction, 'inspect-ci-queue');
  assert.equal(feedback.ranking[0].sourceRevision, 'a'.repeat(40));
  assert.equal(feedback.ranking[0].resourceMeans.tokens, undefined);
});

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


test('worktrees share bounded feedback, isolate receipts, and serialize baseline writes', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'feedback-worktrees-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), lane = join(root, 'lane'), artifacts = join(root, 'artifacts');
  mkdirSync(repo); mkdirSync(artifacts);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
  git('init', '-q'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
  git('config', '--local', 'agentic-os.validationArtifactsRoot', artifacts);
  git('worktree', 'add', '--detach', lane, 'HEAD');
  const directory = receiptDirectory(repo, 'feedback-stages');
  assert.equal(receiptDirectory(lane, 'feedback-stages'), directory);
  assert.notEqual(receiptDirectory(repo), receiptDirectory(lane));
  const sample = { elapsedMs: 10, exitCode: 0, observationId: '1'.repeat(64), finishedAt: Date.now(), sourceRevision: git('rev-parse', 'HEAD') };
  assert.equal(recordEconomy(directory, 'cohort', check('build'), sample).feedback.ranking[0].samples, 1);
  assert.equal(recordEconomy(directory, 'cohort', check('build'), sample).feedback.ranking[0].samples, 1);
  const unlock = lockReceipts(directory);
  try { assert.throws(() => recordEconomy(directory, 'cohort', check('build'), sample), /already-running/); } finally { unlock(); }
  git('worktree', 'remove', lane);
  assert.equal(readEconomy(directory, 'cohort').checks.build.samples, 1);
});


for (const readiness of [false, true]) test(`declared validation ${readiness ? 'handoff' : 'prerequisite'} blocks before source scan or child while plan remains observable`, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-validation-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  const keys = ['CI', 'GITHUB_ACTIONS', 'AGENTIC_OS_VALIDATION_ACTIVE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const repository = 'github.com/example/consumer'; git('remote', 'add', 'origin', `https://${repository}.git`);
  writeFileSync(join(root, 'native-prd-tad-adr-mvp-gtm.md'), '# Native plan\n');
  writeFileSync(join(root, 'check.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('executed', 'unexpected');\n");
  writeFileSync(join(root, '.agentic-os-validation.json'), JSON.stringify({
    schema: 'agentic-os/repository-validation-policy/v1', repository, broadInputs: [], always: ['check'], fallback: ['check'],
    checks: [{ id: 'check', command: ['node', 'check.mjs'], inputs: ['check.mjs'], requires: [], reuse: 'local', timeoutMs: 1000 }],
  }));
  git('add', '.'); git('commit', '-qm', 'fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const revision = git('rev-parse', 'HEAD'), worktreeId = basename(root);
  startWorkflow(root, repository, { revision, planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId,
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: readiness ? [] : [
      { before: { memberId: worktreeId, phase: 'preparation' }, after: { memberId: worktreeId, phase: 'checks' } },
    ] }, ...(readiness ? { readiness: { version: 1, participants: ['writer', 'reviewer'].map(role =>
      ({ memberId: worktreeId, traceId: role, role })) } } : {}) } });
  const output = [];
  await assert.rejects(runRepositoryValidation(['run', `--root=${root}`, '--base=missing-baseline'], { out: text => output.push(text) }), /blocked-workflow-dependencies/);
  assert.equal(existsSync(join(root, 'executed')), false);
  assert.equal(output.length, 0);
  assert.equal(await runRepositoryValidation(['plan', `--root=${root}`], { out: text => output.push(text) }), 0);
  assert.equal(JSON.parse(output[0]).selectedChecks, 1);
  assert.equal(existsSync(join(root, 'executed')), false);
});
