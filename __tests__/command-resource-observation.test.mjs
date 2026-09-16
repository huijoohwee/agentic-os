import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCommand } from '../bin/agentic-os-test-receipt.mjs';
import { validationChecks } from '../bin/agentic-os-tests.mjs';
import { resourceCommand, commandResourceReader } from '../bin/agentic-os-test-command-resources.cjs';

test('real command resources stay outside output and preserve command exit status', async () => {
  const result = await executeCommand(process.cwd(), process.execPath, ['-e', `
    const memory = Buffer.alloc(24 * 1024 * 1024, 1);
    let n = 0; for (let i = 0; i < 10000000; i++) n += i;
    console.log('owned-output', memory.length, n); process.exitCode = 7;
  `]);
  assert.equal(result.exitCode, 7); assert.equal(result.reason, null);
  assert.match(result.output, /^owned-output 25165824 /);
  assert.ok(!result.output.includes('cpuMs'));
  if (resourceCommand('node', [], process.env).measured) {
    assert.equal(result.resources.status, 'measured');
    assert.ok(result.resources.cpuMs > 0);
    assert.ok(result.resources.peakMemoryBytes >= 24 * 1024 * 1024);
    assert.equal(result.resources.cpuMs, result.resources.cpuUserMs + result.resources.cpuSystemMs);
    assert.equal(result.resources.memoryScope, 'maximum-single-process-rss');
  } else assert.equal(result.resources.status, 'unavailable');
});

test('accounting includes waited descendants and closes the private descriptor in the command', async () => {
  const result = await executeCommand(process.cwd(), process.execPath, ['-e', `
    const { spawnSync } = require('node:child_process');
    const { writeSync } = require('node:fs');
    let privateClosed = false; try { writeSync(3, 'spoof'); } catch { privateClosed = true; }
    if (!privateClosed) throw Error('private descriptor leaked');
    const child = spawnSync(process.execPath, ['-e', 'const a=Buffer.alloc(48*1024*1024,1); console.log(a.length)']);
    if (child.status !== 0) throw Error('child failed');
    console.log('child-completed');
  `]);
  assert.equal(result.exitCode, 0); assert.equal(result.output, 'child-completed\n');
  if (result.resources.status === 'measured') assert.ok(result.resources.peakMemoryBytes >= 48 * 1024 * 1024);
});

test('unavailable executables and interrupted capture preserve failure semantics', async () => {
  const missing = await executeCommand(process.cwd(), '/agentic-os-missing-executable', []);
  assert.equal(missing.reason, 'spawn-failed');
  const timeout = await executeCommand(process.cwd(), process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
  assert.equal(timeout.reason, 'timeout');
  assert.equal(timeout.resources.status, 'unavailable');
  assert.equal(timeout.resources.cpuMs, null);
});

test('unsupported hosts retain exact argv and malformed or oversized resource frames stay unknown', () => {
  const plan = resourceCommand('node', ['-e', '0'], {}, 'unsupported');
  assert.deepEqual([plan.command, plan.args], ['node', ['-e', '0']]);
  assert.equal(commandResourceReader(plan).finish().reason, 'unsupported-host');
  for (const frame of ['{"cpuUserMs":-1}', 'null', '{', 'x'.repeat(4097)]) {
    const reader = commandResourceReader({ measured: true }); reader.accept(Buffer.from(frame));
    assert.equal(reader.finish().status, 'unavailable');
  }
});


test('changing accounting invalidates cached results even for an unrelated bounded suite', () => {
  const file = text => ({ text, digest: text, mode: '100644' });
  const contracts = { schema: 'agentic-os/test-impact-contracts/v1', sentinels: ['safety.test.mjs'],
    packaging: ['package.test.mjs'], broad: ['package.json', 'test/impact-contracts.json'], rules: [], dependencies: {} };
  const after = new Map(Object.entries({ 'package.json': '{}', 'test/impact-contracts.json': JSON.stringify(contracts),
    '__tests__/safety.test.mjs': '', '__tests__/package.test.mjs': '', '__tests__/pure.test.mjs': 'assert.equal(1,1)',
    'bin/agentic-os-test-command-resources.cjs': 'accounting-v1' }).map(([path, text]) => [path, file(text)]));
  const plan = { suites: [{ path: '__tests__/pure.test.mjs', stage: 'behavior' }] };
  const observe = () => validationChecks({ after, identity: { root: '/fixture' } }, plan)[1];
  const before = observe(); assert.equal(before.inputs.scope, 'inputs');
  after.set('bin/agentic-os-test-command-resources.cjs', file('accounting-v2'));
  assert.notEqual(observe().fingerprint, before.fingerprint);
});
