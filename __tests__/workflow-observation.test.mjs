import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { workflowObservation } from '../bin/agentic-os-workflow-observation.mjs';
import { validationArguments } from '../bin/agentic-os-validation.mjs';
const sha = 'a'.repeat(40), tree = 'b'.repeat(40);
const source = { repository: 'github.com/example/project', revision: sha, tree };
const digest = value => createHash('sha256').update(value).digest('hex');
const finish = { schema: 'agentic-os/sprint-finish/v1', laneHead: sha, integratedRevision: tree, grantsAuthority: false };
function setup(receipts = { integration: finish }, expected = Object.keys(receipts)) {
  const files = Object.fromEntries(Object.entries(receipts).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return { manifest: { schema: 'agentic-os/workflow-observation-input/v1', id: 'test-loop', source, expected,
    phases: Object.entries(files).map(([id, bytes]) => ({ id, file: id, digest: digest(bytes) })) }, read: file => files[file] };
}
test('workflow receipt coverage never becomes release authority or invented duration', () => {
  const { manifest, read } = setup({ integration: { ...finish, secret: 'do-not-export', worktree: '/private/path' } });
  const result = workflowObservation(manifest, read, 1000);
  assert.equal(result.status, 'completed'); assert.equal(result.authority, false);
  assert.equal(result.spans[0].timing.inclusiveMs, null);
  assert.equal(result.spans[1].resources.cpuMs, null);
  assert.equal(result.profile.workflow.receiptAuthorityVerified, false);
  assert(!JSON.stringify(result).includes('do-not-export')); assert(!JSON.stringify(result).includes('/private/path'));
});
test('missing phases remain visible and prevent complete workflow status', () => {
  const { manifest, read } = setup(undefined, ['preparation', 'integration', 'runtime']);
  const result = workflowObservation(manifest, read, 1000);
  assert.equal(result.status, 'running'); assert.deepEqual(result.profile.workflow.missing, ['preparation', 'runtime']);
  assert.equal(result.evaluation.score, 1 / 3); assert.equal(result.coverage.partial, true);
});
test('validation resources are preserved once per phase; reused children have unknown current consumption', () => {
  const validation = { schema: 'agentic-os/validation-observation/v1', authority: false, source, status: 'passed',
    startedAt: 100, finishedAt: 200, elapsedMs: 100, resources: { cpuMs: 50, peakMemoryBytes: 200, tokens: 0, costUsd: 0 },
    stages: [{ id: 'unit', status: 'reused', startedAt: 100, finishedAt: 100, elapsedMs: 0, resources: { cpuMs: 99 } }] };
  const { manifest, read } = setup({ checks: validation, integration: finish });
  const result = workflowObservation(manifest, read, 1000);
  assert.equal(result.spans[1].resources.cpuMs, 50); assert.equal(result.spans[1].resources.tokens, 0);
  assert.equal(result.spans.find(row => row.spanId === 'checks/unit').resources.cpuMs, null);
  assert.equal(result.spans[0].resources.cpuMs, null);
});
test('CI steps are tied to the same repository, revision, run and attempt', () => {
  const base = { schema: 'agentic-os/pipeline-observation/v1', authority: false, repo: 'example/project', head: sha, run: 1, attempt: 1 };
  const bytes = [ { ...base, event: 'job_completed', job: { id: 2, steps: [{ number: 1, name: 'Integration', status: 'completed', conclusion: 'success', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:02Z' }] } },
    { ...base, event: 'completed', conclusion: 'success' } ].map(JSON.stringify).join('\n');
  const { manifest, read } = setup({ ci: bytes });
  const result = workflowObservation(manifest, read, Date.parse('2026-01-01T00:00:03Z'));
  assert.equal(result.spans[2].operation, 'Integration'); assert.equal(result.spans[2].timing.inclusiveMs, 2000);
  const mismatched = bytes.replace('"attempt":1', '"attempt":2');
  manifest.phases[0].digest = digest(mismatched);
  assert.throws(() => workflowObservation(manifest, () => mismatched), /pipeline-binding/);
});
test('digest, source, duplicate evidence and unknown schemas fail closed', () => {
  const { manifest, read } = setup();
  assert.throws(() => workflowObservation(manifest, () => '{}'), /receipt-digest/);
  manifest.source = { ...source, revision: tree };
  assert.throws(() => workflowObservation(manifest, read), /finish-binding/);
  const duplicate = setup({ first: finish, second: finish });
  assert.throws(() => workflowObservation(duplicate.manifest, duplicate.read), /phase/);
  const unknown = setup({ first: { schema: 'unrecognized', ready: true } });
  assert.throws(() => workflowObservation(unknown.manifest, unknown.read), /unsupported-receipt/);
});
test('observation CLI stays read-only and rejects mixed input modes', () => {
  assert.equal(validationArguments(['observe', '--workflow=local.json']).workflow, 'local.json');
  assert.throws(() => validationArguments(['run', '--workflow=local.json']));
  assert.throws(() => validationArguments(['observe', '--workflow=local.json', '--ci-run=1']));
  assert.throws(() => validationArguments(['observe', '--workflow=local.json', '--input=other.json']));
});

test('bounded detail retains all phases and does not call projection omission dropped telemetry', () => {
  const data = { schema: 'agentic-os/validation-observation/v1', authority: false, source, status: 'passed',
    startedAt: 100, finishedAt: 200, elapsedMs: 100, stages: Array.from({ length: 40 }, (_, n) => ({ id: `check-${n}`, status: 'passed', elapsedMs: 1 })) };
  const { manifest, read } = setup({ checks: data, integration: finish });
  const result = workflowObservation(manifest, read, 1000);
  assert.equal(result.spans.length, 32); assert(result.spans.some(row => row.spanId === 'integration'));
  assert.equal(result.coverage.partial, true); assert.equal(result.coverage.droppedEvents, null);
  assert.equal(result.coverage.projectedSpansOmitted, 11);
});
