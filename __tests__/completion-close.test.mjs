import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompletionCloseArguments, validateCompletionCloseBundle,
  applyCompletionClose, completionCloseBundleDigest,
  materializeCompletionCloseBundle } from '../bin/agentic-os-completion-close.mjs';

const REF = 'agent/device/feature';
test('completion close accepts only an exact plan or acknowledged apply invocation', () => {
  assert.deepEqual(validateCompletionCloseArguments(['plan', `--ref=${REF}`, '--bundle=/tmp/evidence.json']),
    { mode: 'plan', ref: REF, bundle: '/tmp/evidence.json', plan: undefined,
      authorize: undefined, stopped: false });
  assert.throws(() => validateCompletionCloseArguments(['apply', `--ref=${REF}`]),
    { reason: 'blocked-completion-arguments' });
  assert.throws(() => validateCompletionCloseArguments(['plan', `--ref=${REF}`,
    '--bundle=/tmp/evidence.json', '--bundle=/tmp/other.json']),
  { reason: 'blocked-completion-arguments' });
  assert.throws(() => validateCompletionCloseArguments(['apply', `--ref=${REF}`,
    '--bundle=/tmp/evidence.json', '--plan=/tmp/plan.json', '--authorize=abc', '--stopped=true']),
  { reason: 'blocked-completion-arguments' });
});

test('bundle rejects invented or omitted evidence before any provider call', () => {
  const status = { repository: 'github.com/example/repo', ref: REF,
    lane: { path: '/tmp/lane', head: 'a'.repeat(40) }, canonicalRevision: 'b'.repeat(40) };
  assert.throws(() => validateCompletionCloseBundle({ cleanup: {} }, status),
    { reason: 'blocked-completion-input' });
  assert.throws(() => validateCompletionCloseBundle({ cleanup: {}, integrationVerifier: {},
    retirementVerifier: {} }, status), { reason: 'blocked-completion-input' });
});

test('apply requires the explicit stopped-writers acknowledgement before observation', async () => {
  await assert.rejects(applyCompletionClose('/nonexistent', REF, {}, {}, 'digest'),
    { reason: 'blocked-completion-stop-acknowledgement' });
});

test('JSON completion bundles rehydrate exact plan bytes with a stable digest', () => {
  const bundle = { cleanup: { plan: {}, integrationReceipt: {}, integrationPlanBytes: Buffer.from([1, 2, 3]),
    retirementReceipt: {}, retirementPlanBytes: Uint8Array.from([4, 5]), integrationRequest: {},
    retirementRequest: {}, preservationReceipt: {}, noRemainingValueReceipt: {} },
  integrationVerifier: {}, retirementVerifier: {} };
  const serialized = JSON.parse(JSON.stringify({ ...bundle, cleanup: { ...bundle.cleanup,
    integrationPlanBytes: [...bundle.cleanup.integrationPlanBytes],
    retirementPlanBytes: [...bundle.cleanup.retirementPlanBytes] } }));
  assert.equal(completionCloseBundleDigest(bundle), completionCloseBundleDigest(serialized));
  const materialized = materializeCompletionCloseBundle(serialized);
  assert.ok(Buffer.isBuffer(materialized.cleanup.integrationPlanBytes));
  assert.ok(Buffer.isBuffer(materialized.cleanup.retirementPlanBytes));
  assert.deepEqual([...materialized.cleanup.integrationPlanBytes], [1, 2, 3]);
  assert.deepEqual([...materialized.cleanup.retirementPlanBytes], [4, 5]);
  assert.throws(() => materializeCompletionCloseBundle({ ...serialized, cleanup: {
    ...serialized.cleanup, integrationPlanBytes: [256] } }),
  { reason: 'blocked-completion-input' });
});
