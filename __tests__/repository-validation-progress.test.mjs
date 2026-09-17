import test from 'node:test';
import assert from 'node:assert/strict';
import { validationProgress } from '../bin/agentic-os-validation-progress.mjs';

const source = { repository: 'github.com/example/repo', revision: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false };
const observation = () => ({ schema: 'agentic-os/validation-observation/v1', authority: false, source,
  startedAt: 100, stages: [{ id: 'browser', status: 'running', elapsedMs: 30000, resources: {}, output: 'SECRET' }] });

test('child progress is source-bound, deduplicated and preserves measured zero without raw output', () => {
  let current = observation(); const output = [];
  const emit = validationProgress('.', source, 99, { read: () => current, out: line => output.push(line), now: () => 1000 });
  emit(); emit(); assert.equal(output.length, 1);
  current.stages[0] = { ...current.stages[0], status: 'passed', elapsedMs: 32000,
    resources: { cpuMs: 0, peakMemoryBytes: 1024, tokens: null, costUsd: null } };
  emit(); emit(); assert.equal(output.length, 2);
  assert.match(output[1], /passed, 32.00s, cpuMs=0, peakMemoryBytes=1024/);
  assert.doesNotMatch(output.join('\n'), /SECRET|tokens=|costUsd=/);
});

test('missing, stale, future or foreign child observations never become current progress', () => {
  for (const current of [null, { ...observation(), startedAt: 98 }, { ...observation(), startedAt: 1001 },
    { ...observation(), startedAt: undefined }, { ...observation(), authority: true },
    ...Object.keys(source).map(key => ({ ...observation(), source: { ...source, [key]: 'other' } }))]) {
    const output = [];
    validationProgress('.', source, 99, { read: () => current, out: line => output.push(line), now: () => 1000 })();
    assert.deepEqual(output, []);
  }
  assert.doesNotThrow(() => validationProgress('.', source, 99, { read: () => { throw Error('missing'); } })());
});
