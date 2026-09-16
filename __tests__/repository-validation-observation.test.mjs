import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runValidationStages, validationStageDirectory, STAGES_FILE } from '../bin/agentic-os-validation-stages.mjs';
import { validationObservation, readValidationObservation } from '../bin/agentic-os-validation-observation.mjs';
import { lockReceipts, receiptDirectory } from '../bin/agentic-os-test-receipt.mjs';
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
  assert.equal(exported.resources.cpuMs, null); assert.equal(exported.resources.tokens, null);
  assert.equal(exported.coverage.providerAuthority, false); assert.equal(exported.source.dirty, false);
  const json = JSON.stringify(exported);
  for (const secret of ['PRIVATE', root, 'console.log', '.log', 'command']) assert.ok(!json.includes(secret));
  assert.ok(output.every(line => !line.includes('PRIVATE')));
});
test('timeout retains failure identity, stops later stages and releases its lock', async t => {
  const { root } = fixture(t);
  await assert.rejects(runValidationStages(root, [stage('timeout', 'setInterval(()=>{},1000)', 100), stage('never', 'console.log(1)')], { out: () => {} }), /timeout failed/);
  const receipt = JSON.parse(readFileSync(join(validationStageDirectory(root), STAGES_FILE), 'utf8'));
  assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.results.length, 1); assert.equal(receipt.results[0].reason, 'timeout');
  assert.equal(validationObservation(receipt).stages[0].status, 'failed');
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
