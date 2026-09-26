import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runValidationStages, validationStageDirectory, STAGES_FILE } from '../bin/agentic-os-validation-stages.mjs';
import { exportFailureDiagnostics } from '../bin/agentic-os-validation-stages.mjs';
import { executeCommand, FAILURE_OUTPUT_BYTES } from '../bin/agentic-os-test-receipt.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'failure-diagnostics-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/example/consumer.git');
  writeFileSync(join(root, 'source'), 'source'); git('add', '.'); git('commit', '-m', 'source');
  return { root, git };
}

test('failed-stage artifact retains the early test name, seed and diagnostics beyond the console tail', async t => {
  const { root } = fixture(t), output = [];
  const diagnostic = 'not ok 1 - reproducible property\n  ---\n  error: seed=12345 path=2:1 counterexample=example\n  ...\n';
  const code = `process.stdout.write(${JSON.stringify(diagnostic)} + 'later passing output\\n'.repeat(8000)); process.exitCode=1`;
  await assert.rejects(runValidationStages(root, [{ id: 'core', command: ['node', '-e', code], timeoutMs: 3000 }],
    { out: line => output.push(line) }), /core failed/);
  const directory = validationStageDirectory(root), receipt = JSON.parse(readFileSync(join(directory, STAGES_FILE)));
  assert.equal(receipt.results[0].outputTruncated, true);
  assert.equal(receipt.results[0].failureOutput.truncated, false);
  assert.ok(!readFileSync(join(directory, receipt.results[0].log), 'utf8').includes('seed=12345'));
  const destination = join(root, '.git', 'failure-export');
  const manifest = exportFailureDiagnostics(root, destination);
  assert.equal(manifest.authority, false);
  assert.ok(readFileSync(join(destination, manifest.failureOutput.log), 'utf8').startsWith(diagnostic));
  assert.ok(output.some(line => line.includes('failure diagnostics:')));
  assert.throws(() => exportFailureDiagnostics(root, destination), /EEXIST/);
  writeFileSync(join(directory, manifest.failureOutput.log), 'tampered');
  assert.throws(() => exportFailureDiagnostics(root, join(root, '.git', 'tampered')), /diagnostics-digest/);
  assert.equal(existsSync(join(root, '.git', 'tampered')), false);
});

test('failure diagnostics refuse changed source and successful stages', async t => {
  const { root } = fixture(t);
  const run = code => runValidationStages(root, [{ id: 'core', command: ['node', '-e', code], timeoutMs: 3000 }], { out: () => {} });
  await assert.rejects(run('process.exitCode=1'));
  writeFileSync(join(root, 'source'), 'changed');
  assert.throws(() => exportFailureDiagnostics(root, join(root, '.git', 'dirty')), /diagnostics-source/);
  writeFileSync(join(root, 'source'), 'source');
  await run('console.log("passed")');
  assert.throws(() => exportFailureDiagnostics(root, join(root, '.git', 'passed')), /diagnostics-source/);
});

test('complete diagnostics remain byte-bounded and passing commands retain no full log', async t => {
  const { root } = fixture(t);
  const result = await executeCommand(root, 'node', ['-e',
    `require('node:fs').writeSync(1,Buffer.alloc(${FAILURE_OUTPUT_BYTES + 65536},120));process.exitCode=1`],
  { outputMode: 'tail', outputBytes: 1000, retainFailureOutput: true });
  assert.equal(result.fullOutput.length, FAILURE_OUTPUT_BYTES);
  assert.equal(result.fullOutputTruncated, true);
  assert.equal(result.reason, 'output-budget');
  const passed = await executeCommand(root, 'node', ['-e', 'console.log("ok")'], { retainFailureOutput: true });
  assert.equal(passed.exitCode, 0); assert.equal(passed.fullOutput, undefined);
});
