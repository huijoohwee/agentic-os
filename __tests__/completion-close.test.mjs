import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompletionCloseArguments, validateCompletionCloseBundle,
  applyCompletionClose } from '../bin/agentic-os-completion-close.mjs';

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
