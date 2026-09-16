import test from 'node:test';
import assert from 'node:assert/strict';
import { ciTimingReceipt, ciObservationId } from '../bin/agentic-os-ci-observation.mjs';
import { validationObservation } from '../bin/agentic-os-validation-observation.mjs';
import { validationArguments } from '../bin/agentic-os-validation.mjs';
const source = { repository: 'github.com/example/project', revision: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: null };
const base = Date.parse('2026-09-17T00:00:00Z'), at = n => new Date(base + n).toISOString();
const run = { databaseId: 1, headSha: source.revision, attempt: 1,
  url: 'https://github.com/example/project/actions/runs/1', createdAt: at(0), updatedAt: at(15000),
  status: 'completed', conclusion: 'success', jobs: [{ status: 'completed', startedAt: at(5000) }] };

test('CI queue and execution timing remain separate, source bound and non-authoritative', () => {
  const receipt = ciTimingReceipt(run, source, 1, base + 16000);
  assert.deepEqual(receipt.results.map(r => [r.id, r.elapsedMs]), [['ci-queue', 5000], ['ci-execution', 10000]]);
  assert.equal(receipt.ci.queueWaitMs, 5000); assert.equal(receipt.source.revision, source.revision);
  const observation = validationObservation(receipt);
  assert.equal(observation.status, 'passed'); assert.equal(observation.resources.cpuMs, null);
  assert.equal(observation.resources.tokens, null); assert.equal(observation.resources.costUsd, null);
  assert.equal(observation.coverage.providerAuthority, false);
});

test('in-flight CI stays partial and cannot produce a passed execution stage', () => {
  const receipt = ciTimingReceipt({ ...run, status: 'in_progress', conclusion: '', jobs: [{ status: 'in_progress', startedAt: at(5000) }] }, source, 1, base + 16000);
  assert.equal(receipt.results.length, 1); assert.equal(receipt.active.id, 'ci-execution');
  assert.equal(receipt.active.elapsedMs, 11000); assert.equal(validationObservation(receipt).coverage.partial, true);
  const queued = ciTimingReceipt({ ...run, status: 'queued', jobs: [] }, source, 1, base + 16000);
  assert.equal(queued.active.id, 'ci-queue'); assert.equal(queued.results.length, 0);
});

test('CI observation rejects identity drift, impossible timing and mixed input modes', () => {
  for (const patch of [{ headSha: 'c'.repeat(40) }, { url: 'https://foreign.invalid/1' },
    { databaseId: 2 }, { createdAt: at(20000) }, { updatedAt: at(1000) }])
    assert.throws(() => ciTimingReceipt({ ...run, ...patch }, source, 1, base + 16000), /ci-observation/);
  assert.equal(validationArguments(['observe', '--ci-run=1'])['ci-run'], '1');
  assert.throws(() => validationArguments(['observe', '--ci-run=1', '--input=local']), /CI observation/);
  assert.throws(() => validationArguments(['run', '--ci-run=1']), /observation/);
});


test('retry timing starts at the current attempt and skips jobs which never execute', () => {
  const retry = ciTimingReceipt({ ...run, attempt: 2, startedAt: at(4000),
    jobs: [...run.jobs, { status: 'completed', conclusion: 'skipped', startedAt: '0001-01-01T00:00:00Z' }] }, source, 1, base + 16000);
  assert.equal(retry.startedAt, base + 4000); assert.equal(retry.ci.queueWaitMs, 1000);
  assert.equal(retry.elapsedMs, 11000);
  assert.throws(() => ciTimingReceipt({ ...run, attempt: 2 }, source, 1, base + 16000), /ci-observation/);
  assert.throws(() => ciTimingReceipt({ ...run, status: 'in_progress', jobs: [{ status: 'in_progress', startedAt: at(20000) }] }, source, 1, base + 16000), /ci-observation/);
});


test('provider metadata refreshes do not retrain a completed attempt', () => {
  const receipt = ciTimingReceipt(run, source, 1, base + 16000);
  assert.equal(ciObservationId(receipt, 'ci-execution'), ciObservationId({ ...receipt, finishedAt: base + 16000 }, 'ci-execution'));
  assert.notEqual(ciObservationId(receipt, 'ci-execution'), ciObservationId({ ...receipt, ci: { ...receipt.ci, attempt: 2 } }, 'ci-execution'));
});
