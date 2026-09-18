import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runValidationStages, validationStageDirectory, STAGES_FILE } from '../bin/agentic-os-validation-stages.mjs';
import { validationObservation, readValidationObservation } from '../bin/agentic-os-validation-observation.mjs';
import { lockReceipts, receiptDirectory, writeReceipt } from '../bin/agentic-os-test-receipt.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'validation-observation-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  git('remote', 'add', 'origin', 'https://github.com/example/consumer.git');
  writeFileSync(join(root, 'source'), 'source'); git('add', '.'); git('commit', '-m', 'source');
  return { root, git };
}
const stage = (id, code, timeoutMs = 3000) => ({ id, command: ['node', '-e', code], timeoutMs });
test('stage executor records ordered timings and reduces emitted output; export redacts private data', async t => {
  const { root, git } = fixture(t), output = [];
  const artifacts = join(root, '.git', 'local-artifacts'); mkdirSync(artifacts);
  git('config', 'agentic-os.validationArtifactsRoot', artifacts);
  const receipt = await runValidationStages(root, [stage('first', "console.log('PRIVATE'.repeat(12000))"), stage('second', 'console.log(2)')], { out: v => output.push(v) });
  assert.ok(receiptDirectory(root).startsWith(artifacts));
  assert.equal(receipt.outcome, 'passed'); assert.deepEqual(receipt.results.map(r => r.id), ['first', 'second']);
  assert.ok(receipt.results[1].startedAt >= receipt.results[0].finishedAt);
  assert.ok(receipt.observedOutputBytes > 72000); assert.ok(receipt.emittedDiagnosticBytes < 1000);
  assert.equal(receipt.results[0].outputTruncated, true);
  const exported = readValidationObservation(root);
  assert.equal(exported.resources.cpuMs, receipt.results.every(r => r.resources.status === 'measured')
    ? receipt.results.reduce((n, r) => n + r.resources.cpuMs, 0) : null);
  assert.equal(exported.resources.tokens, null);
  assert.equal(exported.coverage.providerAuthority, false); assert.equal(exported.source.dirty, false);
  const json = JSON.stringify(exported);
  for (const secret of ['PRIVATE', root, 'console.log', '.log', 'command']) assert.ok(!json.includes(secret));
  assert.ok(output.every(line => !line.includes('PRIVATE')));
});

test('resource exports retain known zero, estimates, partial coverage and historical reuse', async t => {
  const { root } = fixture(t);
  const receipt = await runValidationStages(root, [stage('one', '0'), stage('two', '1')], { out: () => {} });
  for (const [i, result] of receipt.results.entries()) {
    result.resources = { status: 'measured', method: 'wait4', scope: 'waited-process-tree',
      memoryScope: 'maximum-single-process-rss', cpuMs: 10 + i, peakMemoryBytes: 100 + i };
    result.cost = { status: 'reported', prompt_tokens: i, completion_tokens: 0, estimated_cost_usd: 0 };
  }
  let output = validationObservation(receipt);
  assert.equal(output.resources.cpuMs, 21); assert.equal(output.resources.peakMemoryBytes, 101);
  assert.equal(output.resources.tokens, 1); assert.equal(output.resources.costUsd, 0);
  assert.equal(output.resources.costBasis, 'estimated');
  assert.equal(output.stages[0].resources.tokens, 0);
  receipt.results[1].reused = true;
  output = validationObservation(receipt);
  assert.equal(output.resources.cpuMs, 10); assert.equal(output.resources.tokens, 0);
  assert.equal(output.resources.coverage.expectedStages, 1);
  assert.equal(output.stages[1].resources.cpuMs, 11, 'reuse retains historical measurement without charging it again');
  receipt.results[1].reused = false; delete receipt.results[1].resources;
  output = validationObservation(receipt);
  assert.equal(output.resources.cpuMs, null); assert.equal(output.resources.coverage.cpuMs, 1);
  receipt.results[0].cost.prompt_tokens = -1;
  assert.throws(() => validationObservation(receipt), /observation/);
});
test('timeout retains failure identity, stops later stages and releases its lock', async t => {
  const { root } = fixture(t);
  await assert.rejects(runValidationStages(root, [stage('timeout', 'setInterval(()=>{},1000)', 100), stage('never', 'console.log(1)')], { out: () => {} }), /timeout failed/);
  const receipt = JSON.parse(readFileSync(join(validationStageDirectory(root), STAGES_FILE), 'utf8'));
  assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.results.length, 1); assert.equal(receipt.results[0].reason, 'timeout');
  assert.equal(validationObservation(receipt).stages[0].status, 'failed');
  assert.equal(validationObservation(receipt).coverage.expectedStages, 2);
  assert.equal(validationObservation(receipt).coverage.totalStages, 1);
  const release = lockReceipts(validationStageDirectory(root));
  await assert.rejects(runValidationStages(root, [stage('one', '')], { out: () => {} }), /definition/);
  await assert.rejects(runValidationStages(root, [stage('one', '0')], { out: () => {} }), /already-running/); release();
});
test('projection bounds records, rejects duplicates and accepts measured deadline teardown', async t => {
  const { root } = fixture(t);
  const receipt = await runValidationStages(root, [stage('one', '0')], { out: () => {} });
  receipt.results[0].elapsedMs = 900123; receipt.results[0].reason = 'timeout';
  assert.equal(validationObservation(receipt).stages[0].elapsedMs, 900123);
  receipt.results.push(receipt.results[0]); assert.throws(() => validationObservation(receipt), /observation/);
});

test('existing OS receipts export bounded concurrent pages without inventing source cleanliness', t => {
  const { root, git } = fixture(t), file = join(root, '.git', 'native.json');
  const receipt = { schema: 'agentic-os/test-receipt/v2', authority: false, outcome: 'passed', startedAt: 1000,
    finishedAt: 2000, elapsedMs: 1000, identity: { root, headRevision: git('rev-parse', 'HEAD'), headTree: git('rev-parse', 'HEAD^{tree}') },
    plan: { suites: Array(129).fill({}) }, results: Array.from({ length: 130 }, (_, i) => ({ name: `__tests__/check-${i}.test.mjs`,
      exitCode: 0, reason: null, elapsedMs: 10, startedAt: 1000, finishedAt: 1010, reused: false })) };
  writeFileSync(file, JSON.stringify(receipt));
  const first = readValidationObservation(root, file), second = readValidationObservation(root, file, 128);
  assert.equal(first.executionOrder, 'concurrent'); assert.equal(first.source.dirty, null);
  assert.equal(first.stages.length, 128); assert.equal(second.stages.length, 2);
  assert.equal(first.coverage.totalStages, 130); assert.equal(first.coverage.partial, true);
  assert.equal(second.coverage.offset, 128); assert.equal(first.resources.observedOutputBytes, null);
  assert.throws(() => readValidationObservation(root, file, 1), /observation/);
  receipt.identity.root = '/foreign'; writeFileSync(file, JSON.stringify(receipt));
  assert.throws(() => readValidationObservation(root, file), /observation/);
});

test('expanded aggregate receipts retain every result and resource within the existing byte limit', t => {
  const { root, git } = fixture(t), directory = receiptDirectory(root), now = Date.now();
  const resources = { status: 'measured', method: 'wait4', scope: 'waited-process-tree',
    memoryScope: 'maximum-single-process-rss', cpuMs: 3, cpuUserMs: 2, cpuSystemMs: 1, peakMemoryBytes: 65000000 };
  const results = Array.from({ length: 232 }, (_, i) => ({ name: `__tests__/resource-accounting-regression-${i}.test.mjs`,
    stage: 'behavior', exitCode: 0, reason: null, startedAt: now - 100, finishedAt: now, elapsedMs: 100,
    outputDigest: 'a'.repeat(64), log: `check-${String(i).padStart(24, '0')}.log`, resources,
    counts: { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, reused: i === 0, validatedAt: now }));
  const receipt = { schema: 'agentic-os/test-receipt/v2', authority: false, outcome: 'passed',
    identity: { root, headRevision: git('rev-parse', 'HEAD'), headTree: git('rev-parse', 'HEAD^{tree}') },
    startedAt: now - 100, finishedAt: now, elapsedMs: 100,
    plan: { suites: results.slice(1).map(r => ({ path: r.name, stage: 'behavior', reasons: ['broad-impact'] })),
      stages: { behavior: results.map(r => r.name) } }, results };
  writeReceipt(directory, 'last.json', receipt);
  const bytes = readFileSync(join(directory, 'last.json')), saved = JSON.parse(bytes);
  assert.ok(bytes.length <= 128000); assert.equal(saved.results.length, 232);
  assert.deepEqual(saved.plan.suites.map(suite => ({ ...saved.plan.suiteDefaults, ...suite })), receipt.plan.suites);
  assert.equal(saved.diagnostics, 'per-check-receipts'); assert.equal(saved.results[0].resources.cpuUserMs, 2);
  assert.equal(saved.results[0].log, results[0].log); assert.equal(receipt.results[0].outputDigest, 'a'.repeat(64));
  const first = readValidationObservation(root, join(directory, 'last.json'));
  const second = readValidationObservation(root, join(directory, 'last.json'), 128);
  assert.equal(first.stages.length + second.stages.length, 232);
  assert.equal(first.resources.cpuMs, 231 * 3); assert.equal(first.resources.peakMemoryBytes, 65000000);
  assert.equal(first.stages[0].status, 'reused'); assert.equal(second.stages[0].resources.measurement, 'wait4');
  saved.resourceDefaults.scope = 'inferred'; writeFileSync(join(directory, 'last.json'), JSON.stringify(saved));
  assert.throws(() => readValidationObservation(root, join(directory, 'last.json')), /observation/);
});


test('CI allocation exports separate unknown gate coverage without fabricating an evaluator result', t => {
  const { root, git } = fixture(t), file = join(root, '.git', 'ci.json'), revision = git('rev-parse', 'HEAD');
  const external = { name: 'budgets', workflow: '.github/workflows/ci.yml', workflowDigest: 'a'.repeat(64),
    revision, runId: '123', runAttempt: '1', status: 'not-observed' };
  const receipt = { schema: 'agentic-os/test-receipt/v2', authority: false, outcome: 'passed', startedAt: 1000,
    finishedAt: 2000, elapsedMs: 1000, identity: { root, headRevision: revision, headTree: git('rev-parse', 'HEAD^{tree}') },
    plan: { suites: [{}] }, externalRequiredChecks: [external], results: [{ name: '__tests__/small.test.mjs',
      exitCode: 0, reason: null, elapsedMs: 10, startedAt: 1000, finishedAt: 1010, reused: false }] };
  writeFileSync(file, JSON.stringify(receipt));
  const result = readValidationObservation(root, file);
  assert.equal(result.coverage.expectedStages, 1); assert.equal(result.stages.length, 1);
  assert.deepEqual(result.coverage.externalRequiredChecks, [external]);
  for (const bad of [{ ...external, status: 'passed' }, { ...external, revision: 'b'.repeat(40) },
    { ...external, private: 'secret' }]) {
    receipt.externalRequiredChecks = [bad]; writeFileSync(file, JSON.stringify(receipt));
    assert.throws(() => readValidationObservation(root, file), /observation/);
  }
});
