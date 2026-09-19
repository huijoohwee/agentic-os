import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompletionCloseArguments, validateCompletionCloseBundle,
  applyCompletionClose, completionCloseBundleDigest,
  materializeCompletionCloseBundle } from '../bin/agentic-os-completion-close.mjs';
import { buildCompletionBundleScaffold, validateCompletionScaffoldArguments } from '../bin/agentic-os-completion-scaffold.mjs';

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

test('completion scaffold validates arguments and preserves known lane facts', () => {
  assert.deepEqual(validateCompletionScaffoldArguments([`--ref=${REF}`]), { ref: REF });
  assert.throws(() => validateCompletionScaffoldArguments([]),
    { reason: 'blocked-completion-arguments' });
  const scaffold = buildCompletionBundleScaffold({
    ref: REF,
    repository: 'github.com/example/repo',
    profileDigest: '1'.repeat(64),
    canonicalRevision: 'a'.repeat(40),
    lane: { path: null, mounted: false, head: 'b'.repeat(40), clean: null },
    integration: { kind: 'exact-tree-projection', pathCount: 3 },
    enrollment: { authorityRepository: 'github.com/example/repo', files: {}, localPolicyCandidate: true },
    findings: [{ code: 'lane-registration-detached', owner: 'lane-owner', action: 'Rebind the exact lane worktree path before cleanup planning.' }],
  }, { profileDigest: '1'.repeat(64), canonical: { localRef: 'refs/heads/main' } }, {
    transitionPolicy: { schema: 'agentic-os/github-transition-policy/v1' },
    integratedReview: { url: 'https://github.com/example/repo/pull/7', mergeCommit: 'c'.repeat(40), number: 7 },
  });
  assert.equal(scaffold.schema, 'agentic-os/completion-bundle-scaffold/v1');
  assert.equal(scaffold.bundleTemplate.cleanup.plan.expectedBranch, REF);
  assert.equal(scaffold.bundleTemplate.cleanup.plan.targetPath, 'REPLACE_WITH_REBOUND_WORKTREE_PATH');
  assert.equal(scaffold.bundleTemplate.cleanup.plan.integratedResource, 'https://github.com/example/repo/pull/7');
  assert.equal(scaffold.bundleTemplate.cleanup.plan.integratedImmutableRevision, 'c'.repeat(40));
  assert.equal(scaffold.bundleTemplate.cleanup.plan.projectionByteCeiling, 4 * 1024 ** 3);
  assert.equal(scaffold.bundleTemplate.integrationVerifier.policy.schema, 'agentic-os/github-transition-policy/v1');
  assert.equal(scaffold.requiredPlaceholders.includes('integrationVerifier.policy'), false);
  assert.equal(scaffold.requiredPlaceholders.includes('cleanup.plan.projectionByteCeiling'), false);
  assert.equal(scaffold.requiredPlaceholders.includes('cleanup.plan.integratedResource'), false);
  assert.equal(scaffold.requiredPlaceholders.includes('cleanup.plan.integratedImmutableRevision'), false);
  assert.ok(scaffold.stillRequiresAuthenticatedWinners.includes('integration receipt object'));
  assert.deepEqual(scaffold.bundleTemplate.cleanup.plan.authorizedEffects, [
    'quarantine-worktree-projection',
    'quarantine-worktree-registration',
  ]);
  assert.ok(scaffold.warnings.some((item) => item.code === 'lane-registration-detached'));
});

test('completion scaffold keeps verifier policy as a placeholder when no committed policy is available', () => {
  const scaffold = buildCompletionBundleScaffold({
    ref: REF,
    repository: 'github.com/example/repo',
    profileDigest: '1'.repeat(64),
    canonicalRevision: 'a'.repeat(40),
    lane: { path: '/tmp/lane', mounted: true, head: 'b'.repeat(40), clean: true },
    integration: { kind: 'exact-tree-projection', pathCount: 3 },
    enrollment: { authorityRepository: 'github.com/example/repo', files: {}, localPolicyCandidate: true },
    findings: [],
  }, { profileDigest: '1'.repeat(64), canonical: { localRef: 'refs/heads/main' } });
  assert.equal(scaffold.bundleTemplate.integrationVerifier.policy, 'REPLACE_WITH_TRANSITION_POLICY_OBJECT');
  assert.equal(scaffold.requiredPlaceholders.includes('integrationVerifier.policy'), true);
});
