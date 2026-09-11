import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, runTests } from '../bin/agentic-os-tests.mjs';
import { hash } from '../bin/agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, receiptDirectory, reusableReceipt, writeReceipt } from '../bin/agentic-os-test-receipt.mjs';

function fixture(t, { evaluator = 'node -e "process.exit(0)"', body = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'test runner '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(root, 'test')); mkdirSync(join(root, '__tests__'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { evals: evaluator } }));
  writeFileSync(join(root, 'test/impact-contracts.json'), JSON.stringify({ schema: 'agentic-os/test-impact-contracts/v1',
    sentinels: ['small.test.mjs'], packaging: [], broad: ['package.json'], rules: [], dependencies: {} }));
  writeFileSync(join(root, '__tests__/small.test.mjs'), `import test from 'node:test'; test('behavior', () => { ${body} });\n`);
  git('add', '.'); git('commit', '-qm', 'base');
  const messages = [], invoke = extra => runTests(['affected', '--base=HEAD', ...(extra ?? [])], { root, out: text => messages.push(text) });
  const receipt = () => JSON.parse(readFileSync(join(receiptDirectory(root), 'last.json')));
  return { root, messages, invoke, receipt, git };
}
test('options are explicit and reject unknown, duplicate and empty input', () => {
  assert.equal(parseArguments([]).mode, 'affected');
  for (const args of [['unknown'], ['affected', '--skip'], ['affected', '--base='],
    ['affected', '--base=a', '--base=b'], ['fast', '--fresh']]) assert.throws(() => parseArguments(args));
});
test('public npm entrypoints forward baseline options before executing any checks', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const script of ['check', 'test', 'check:affected']) {
    const result = await executeCommand(root, 'npm', ['run', script, '--', '--base=-invalid']);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /blocked-test-ref/u, script);
    assert.doesNotMatch(result.output, /running evaluators|already-running/u);
  }
});
test('runner records commands, counts, byte identity, and reuses only the same local result', async t => {
  const env = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI; delete process.env.GITHUB_ACTIONS;
  t.after(() => { for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const f = fixture(t);
  assert.equal(await f.invoke(), 0); const first = f.receipt();
  assert.equal(first.authority, false); assert.equal(first.results[1].counts.pass, 1);
  assert.deepEqual(first.results.map(result => result.name), ['evaluators', 'behavior']);
  assert.equal(first.identity.sourceDigest.length, 64); assert.equal(first.identity.environmentDigest.length, 64);
  assert.equal(await f.invoke(), 0); assert.ok(f.messages.some(message => message.startsWith('reused local validation')));
  assert.equal(f.receipt().finishedAt, first.finishedAt, 'reuse cannot renew its lifetime');
  f.messages.length = 0; assert.equal(await f.invoke(['--fresh']), 0);
  assert.equal(f.messages.some(message => message.startsWith('reused')), false);
  process.env.CI = 'true'; f.messages.length = 0; assert.equal(await f.invoke(), 0);
  assert.equal(f.messages.some(message => message.startsWith('reused')), false);
});
test('stale, failed, tampered, incomplete and mismatched receipts are rejected', async t => {
  const f = fixture(t); assert.equal(await f.invoke(['--fresh']), 0);
  const directory = receiptDirectory(f.root), valid = f.receipt();
  const reuse = value => {
    writeReceipt(directory, 'last.json', value);
    return reusableReceipt(directory, valid.fingerprint, valid.plan);
  };
  assert.equal(reuse({ ...valid, finishedAt: Date.now() - 3_600_001 }), null);
  assert.equal(reuse({ ...valid, outcome: 'failed' }), null);
  assert.equal(reuse({ ...valid, fingerprint: hash('changed environment') }), null);
  assert.equal(reuse({ ...valid, results: valid.results.slice(0, 1) }), null);
  assert.equal(reuse({ ...valid, planDigest: hash('different tests') }), null);
  assert.equal(reuse({ ...valid, authority: true }), null);
  writeReceipt(directory, 'behavior.log', 'altered diagnostics');
  assert.equal(reuse(valid), null);
});
test('cheap evaluator failure stops before behavior execution', async t => {
  const f = fixture(t, { evaluator: 'node -e "process.exit(9)"' });
  assert.equal(await f.invoke(), 1); const receipt = f.receipt();
  assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.results.length, 1);
  assert.equal(receipt.results[0].exitCode, 9);
});
test('changed bytes during a passing test invalidate the result', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, '__tests__/small.test.mjs'),
    "import {writeFileSync} from 'node:fs'; import test from 'node:test'; test('mutates',()=>writeFileSync('drift.txt','changed'));\n");
  assert.equal(await f.invoke(), 1); assert.equal(f.receipt().outcome, 'blocked');
  assert.equal(f.receipt().error, 'blocked-test-input-drift');
});
test('concurrent calls cannot share or steal a worktree receipt', async t => {
  const f = fixture(t), directory = receiptDirectory(f.root), release = lockReceipts(directory);
  await assert.rejects(f.invoke(), /already-running/); release();
  assert.equal(await f.invoke(['--fresh']), 0);
});
test('command timeout, output overflow and missing executable fail with bounded diagnostics', async () => {
  const timeout = await executeCommand(process.cwd(), process.execPath,
    ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
  assert.equal(timeout.reason, 'timeout');
  const output = await executeCommand(process.cwd(), process.execPath,
    ['-e', 'process.stdout.write("x".repeat(10000))'], { outputBytes: 100 });
  assert.equal(output.reason, 'output-budget'); assert.ok(Buffer.byteLength(output.output) <= 100);
  const missing = await executeCommand(process.cwd(), '/nonexistent/agentic-test-executable', []);
  assert.equal(missing.reason, 'spawn-failed');
});
