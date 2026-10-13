import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrate, retire, governanceDigest } from '../src/governance.mjs';
import { createEffectPlan, createAuthenticatedTransitionOperationReceipt,
  effectPlanByteDigest, encodeEffectPlan } from '../src/completion.mjs';
import { CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS, INTEGRATION_RECORD_RETAINED_EFFECTS,
  RETAINED_EFFECTS, createWorktreeCleanupContinuation, createWorktreeCleanupPlan,
  deriveCleanupOwnerStateDigest, worktreeCleanupPlanByteDigest } from '../src/cleanup.mjs';
import { validateCompletionCloseArguments, validateCompletionCloseBundle,
  applyCompletionClose, completionCloseBundleDigest,
  materializeCompletionCloseBundle } from '../bin/agentic-os-completion-close.mjs';
import { buildCompletionBundleScaffold, validateCompletionScaffoldArguments } from '../bin/agentic-os-completion-scaffold.mjs';

const REF = 'agent/device/feature';
const hash = char => char.repeat(64);
const transitionPlan = ({ transition, target, revision, claimId, leaseEpoch, fenceRevision,
  predecessorDigest, candidateDigest, snapshotDigest, parametersDigest, cleanup = false }) =>
  createEffectPlan({ target: { repository: 'github.com/example/repository', resource: target,
    immutableRevision: revision }, authority: { requestedTransition: transition,
    authoritySubject: 'github-user:42', ownerSubject: 'github-user:42', claimId, leaseEpoch,
    fenceRevision, writeSetDigest: governanceDigest(['owner-bound-worktree']),
    reviewLocator: transition === 'integrate' ? target : null, predecessorDigest },
  candidateDigest, snapshotDigest,
  effectClass: cleanup ? 'claim-retirement-with-cleanup' : 'protected-integration-record',
  allowedEffects: cleanup ? [...CLEANUP_EFFECTS, 'retire-claim'] : INTEGRATION_RECORD_EFFECTS,
  forbiddenEffects: cleanup ? RETAINED_EFFECTS : INTEGRATION_RECORD_RETAINED_EFFECTS,
  parametersDigest });
async function closeBundleFixture() {
  const repository = 'github.com/example/repository', targetPath = '/tmp/lane',
    review = `https://${repository}/pull/7`, candidateDigest = hash('a'), snapshotDigest = hash('b'),
    mergedRevision = 'f'.repeat(40), now = Date.parse('2026-09-02T00:40:00.000Z');
  const makeRequest = (plan) => {
    const input = { repository, authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
      scope: ['owner-bound-worktree'], claimId: plan.authority.claimId,
      leaseEpoch: plan.authority.leaseEpoch, fenceRevision: plan.authority.fenceRevision,
      immutableRevision: plan.target.immutableRevision, reviewLocator: plan.authority.reviewLocator,
      dependentWork: [`effect-plan:sha256:${effectPlanByteDigest(encodeEffectPlan(plan))}`],
      observedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z' };
    return plan.authority.requestedTransition === 'integrate' ? integrate(input) : retire(input);
  };
  const makeReceipt = async plan => {
    const request = makeRequest(plan), planBytes = encodeEffectPlan(plan);
    const verify = async () => ({ adapter: { id: 'fixture-provider', version: '1' },
      authenticatedSubject: 'github-user:42', providerRecordLocator: 'provider://operation/1',
      providerRecordDigest: hash('4'), requestDigest: request.requestDigest,
      requestedTransition: request.requestedTransition, planDigest: plan.planDigest,
      planByteDigest: effectPlanByteDigest(planBytes), sourceClaimId: request.claimId,
      sourceLeaseEpoch: request.leaseEpoch, sourceFenceRevision: request.fenceRevision,
      resultClaimId: request.claimId, resultLeaseEpoch: request.leaseEpoch + 1,
      resultFenceRevision: hash(request.requestedTransition === 'integrate' ? '3' : '7'),
      resultState: request.requestedTransition === 'integrate' ? 'integrated' : 'retired',
      operationReceiptDigest: hash(request.requestedTransition === 'integrate' ? '5' : '8'),
      transitionedAt: '2026-09-02T00:25:00.000Z', verifiedAt: '2026-09-02T00:30:00.000Z',
      expiresAt: '2026-09-02T01:00:00.000Z' });
    return { request, planBytes, receipt: await createAuthenticatedTransitionOperationReceipt(
      { request, planBytes }, verify, { now: () => now }) };
  };
  const integrationPlan = transitionPlan({ transition: 'integrate', target: review,
    revision: mergedRevision, claimId: hash('1'), leaseEpoch: 7, fenceRevision: hash('2'),
    predecessorDigest: hash('6'), candidateDigest, snapshotDigest,
    parametersDigest: hash('d') });
  const integration = await makeReceipt(integrationPlan);
  const ownerStateDigest = deriveCleanupOwnerStateDigest({
    claimId: integration.receipt.transitionReceipt.resultClaimId,
    leaseEpoch: integration.receipt.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.receipt.transitionReceipt.resultFenceRevision, state: 'integrated' });
  const retiredPlan = createWorktreeCleanupPlan({ repository, targetPath, expectedBranch: REF,
    expectedHeadRevision: 'c'.repeat(40), expectedCanonicalRef: 'refs/heads/main',
    expectedCanonicalRevision: 'c'.repeat(40), integratedResource: review,
    integratedImmutableRevision: mergedRevision, candidateDigest, snapshotDigest,
    integrationProofDigest: hash('d'), profileDigest: hash('e'),
    recoveryInventoryDigest: hash('f'), recoveryInventoryContentEntries: 1, ownerStateDigest,
    integrationReceiptDigest: integration.receipt.receiptDigest,
    integrationPlanByteDigest: effectPlanByteDigest(integration.planBytes),
    integrationPredecessorDigest: hash('6'), preservationReceiptDigest: hash('9'),
    noRemainingValueReceiptDigest: hash('0'), projectionByteCeiling: 1024,
    projectionEntryCeiling: 10, registrationByteCeiling: 1024, registrationEntryCeiling: 10,
    sharedStateByteCeiling: 1024, sharedStateEntryCeiling: 10,
    authorizedEffects: CLEANUP_EFFECTS, retainedEffects: RETAINED_EFFECTS,
    expiresAt: '2026-09-02T01:00:00.000Z' });
  const retiredPlanFields = Object.fromEntries(Object.entries(retiredPlan)
    .filter(([key]) => key !== 'planDigest'));
  const plan = createWorktreeCleanupPlan({ ...retiredPlanFields,
    expiresAt: '2026-09-02T02:00:00.000Z' });
  const retirementPlan = transitionPlan({ transition: 'retire', target: targetPath,
    revision: mergedRevision, claimId: integration.receipt.transitionReceipt.resultClaimId,
    leaseEpoch: integration.receipt.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.receipt.transitionReceipt.resultFenceRevision,
    predecessorDigest: integration.receipt.receiptDigest, candidateDigest, snapshotDigest,
    parametersDigest: worktreeCleanupPlanByteDigest(retiredPlan), cleanup: true });
  const retirement = await makeReceipt(retirementPlan);
  const verifier = request => ({ repository, targetRepository: repository,
    operationInput: { request }, workflowRun: 'fixture', policy: {} });
  return { now, plan, integration, retirement, retirementPlan,
    bundle: { cleanup: { plan, integrationReceipt: integration.receipt,
      integrationPlanBytes: integration.planBytes, retirementReceipt: retirement.receipt,
      retirementPlanBytes: retirement.planBytes, integrationRequest: integration.request,
      retirementRequest: retirement.request, preservationReceipt: {}, noRemainingValueReceipt: {} },
    integrationVerifier: verifier(integration.request), retirementVerifier: verifier(retirement.request) } };
}
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

test('JSON completion bundle digest is stable and unauthenticated evidence fails closed', () => {
  const bundle = { cleanup: { plan: {}, integrationReceipt: {}, integrationPlanBytes: Buffer.from([1, 2, 3]),
    retirementReceipt: {}, retirementPlanBytes: Uint8Array.from([4, 5]), integrationRequest: {},
    retirementRequest: {}, preservationReceipt: {}, noRemainingValueReceipt: {} },
  integrationVerifier: {}, retirementVerifier: {} };
  const serialized = JSON.parse(JSON.stringify({ ...bundle, cleanup: { ...bundle.cleanup,
    integrationPlanBytes: [...bundle.cleanup.integrationPlanBytes],
    retirementPlanBytes: [...bundle.cleanup.retirementPlanBytes] } }));
  assert.equal(completionCloseBundleDigest(bundle), completionCloseBundleDigest(serialized));
  assert.throws(() => materializeCompletionCloseBundle(serialized));
  assert.throws(() => materializeCompletionCloseBundle({ ...serialized, cleanup: {
    ...serialized.cleanup, integrationPlanBytes: [256] } }), { reason: 'blocked-completion-input' });
});

test('completion close derives a receipt-bound continuation through provider-window expiry', async () => {
  const fixture = await closeBundleFixture(), later = Date.parse('2026-09-02T01:10:00.000Z');
  const materialized = materializeCompletionCloseBundle(fixture.bundle, { now: () => later });
  const continuation = materialized.cleanup.cleanupContinuation;
  assert.equal(continuation.authorityKind, 'retired-cleanup-continuation');
  assert.equal(continuation.retirementReceiptDigest, fixture.retirement.receipt.receiptDigest);
  assert.equal(continuation.priorCleanupPlanByteDigest, fixture.retirementPlan.parametersDigest);
  assert.notEqual(continuation.priorCleanupPlanByteDigest,
    worktreeCleanupPlanByteDigest(fixture.plan));
  assert.equal(continuation.cleanupPlanDigest, fixture.plan.planDigest);
  assert.equal(continuation.issuedAt, new Date(later).toISOString());
  assert.equal(continuation.expiresAt, fixture.plan.expiresAt);
  const continuationFields = Object.fromEntries(Object.entries(continuation)
    .filter(([key]) => key !== 'authorityDigest'));
  const badContinuation = createWorktreeCleanupContinuation({ ...continuationFields,
    retirementReceiptDigest: hash('c') });
  assert.throws(() => materializeCompletionCloseBundle({ ...fixture.bundle, cleanup: {
    ...fixture.bundle.cleanup, cleanupContinuation: badContinuation } }, { now: () => later }),
  { reason: 'blocked-cleanup-continuation-unjoined' });
});

test('completion scaffold validates arguments and preserves known lane facts', () => {
  assert.deepEqual(validateCompletionScaffoldArguments([`--ref=${REF}`]), { ref: REF, derive: false });
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
  assert.deepEqual(scaffold.autoDerivedFields, ['cleanup.cleanupContinuation']);
  assert.equal(scaffold.bundleTemplate.cleanup.cleanupContinuation, null);
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
