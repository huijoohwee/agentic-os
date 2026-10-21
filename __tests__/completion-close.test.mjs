import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrate, retire, governanceDigest } from '../src/governance.mjs';
import { effectPlanByteDigest, encodeEffectPlan } from '../src/completion.mjs';
import { createCostVerifiedTransitionReceipt as createAuthenticatedTransitionOperationReceipt,
  createTestEffectPlan as createEffectPlan } from './lib/effect-cost-fixtures.mjs';
import { CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS, INTEGRATION_RECORD_RETAINED_EFFECTS,
  RETAINED_EFFECTS, createCleanupEvidenceReceipt, createWorktreeCleanupContinuation, createWorktreeCleanupPlan,
  deriveCleanupOwnerStateDigest, worktreeCleanupPlanByteDigest } from '../src/cleanup.mjs';
import { createGitHubTransitionInput } from '../src/github-transition-client.mjs';
import { integrationDraft, predecessorIssuance } from './lib/github-transition-fixture.mjs';
import { validateCompletionCloseArguments, validateCompletionCloseBundle,
  applyCompletionClose, completionCloseBundleDigest,
  materializeCompletionCloseBundle, deriveCompletionBundleFields } from '../bin/agentic-os-completion-close.mjs';
import { buildCompletionBundleScaffold, validateCompletionScaffoldArguments } from '../bin/agentic-os-completion-scaffold.mjs';

const REF = 'agent/device/feature';
const hash = char => char.repeat(64);
const transitionPlan = ({ repository = 'github.com/example/repository', transition, target, revision, claimId, leaseEpoch, fenceRevision,
  predecessorDigest, candidateDigest, snapshotDigest, parametersDigest, cleanup = false }) =>
  createEffectPlan({ target: { repository, resource: target,
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
  const issuance = predecessorIssuance(), draft = integrationDraft(issuance, hash('d'));
  const repository = 'github.com/example/target', targetPath = '/tmp/lane',
    review = draft.plan.target.resource, candidateDigest = draft.plan.candidateDigest,
    snapshotDigest = draft.plan.snapshotDigest, mergedRevision = draft.plan.target.immutableRevision,
    now = Date.parse('2026-09-02T00:40:00.000Z');
  const makeRequest = (plan) => {
    const input = { repository, authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
      scope: ['owner-bound-worktree'], claimId: plan.authority.claimId,
      leaseEpoch: plan.authority.leaseEpoch, fenceRevision: plan.authority.fenceRevision,
      immutableRevision: plan.target.immutableRevision, reviewLocator: plan.authority.reviewLocator,
      dependentWork: [`effect-plan:sha256:${effectPlanByteDigest(encodeEffectPlan(plan))}`],
      observedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z' };
    return plan.authority.requestedTransition === 'integrate' ? integrate(input) : retire(input);
  };
  const makeReceipt = async (plan, exactRequest = null) => {
    const request = exactRequest ?? makeRequest(plan), planBytes = encodeEffectPlan(plan);
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
      transitionedAt: new Date(now).toISOString(), verifiedAt: new Date(now).toISOString(),
      expiresAt: request.expiresAt });
    return { request, planBytes, receipt: await createAuthenticatedTransitionOperationReceipt(
      { request, planBytes }, verify, { now: () => now }) };
  };
  const integrationPlan = draft.plan;
  const integration = await makeReceipt(integrationPlan, draft.request);
  const ownerStateDigest = deriveCleanupOwnerStateDigest({
    claimId: integration.receipt.transitionReceipt.resultClaimId,
    leaseEpoch: integration.receipt.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.receipt.transitionReceipt.resultFenceRevision, state: 'integrated' });
  const recoveryInventoryDigest = hash('f'), recoveryInventoryContentEntries = 1, archiveDigest = hash('e');
  const preservationReceipt = createCleanupEvidenceReceipt({ kind: 'preservation', repository,
    targetPath, candidateDigest, snapshotDigest, integrationReceiptDigest: integration.receipt.receiptDigest,
    recoveryInventoryDigest, recoveryInventoryContentEntries, ownerStateDigest, archiveDigest,
    preservationComplete: true, reachableFromRetainedRefs: null, unpreservedValueCount: null });
  const noRemainingValueReceipt = createCleanupEvidenceReceipt({ kind: 'no-remaining-value', repository,
    targetPath, candidateDigest, snapshotDigest, integrationReceiptDigest: integration.receipt.receiptDigest,
    recoveryInventoryDigest, recoveryInventoryContentEntries, ownerStateDigest, archiveDigest,
    preservationComplete: null, reachableFromRetainedRefs: true, unpreservedValueCount: 0 });
  const retiredPlan = createWorktreeCleanupPlan({ repository, targetPath, expectedBranch: REF,
    expectedHeadRevision: 'c'.repeat(40), expectedCanonicalRef: 'refs/heads/main',
    expectedCanonicalRevision: 'c'.repeat(40), integratedResource: review,
    integratedImmutableRevision: mergedRevision, candidateDigest, snapshotDigest,
    integrationProofDigest: hash('d'), profileDigest: hash('e'),
    recoveryInventoryDigest, recoveryInventoryContentEntries, ownerStateDigest,
    integrationReceiptDigest: integration.receipt.receiptDigest,
    integrationPlanByteDigest: effectPlanByteDigest(integration.planBytes),
    integrationPredecessorDigest: integrationPlan.authority.predecessorDigest,
    preservationReceiptDigest: preservationReceipt.receiptDigest,
    noRemainingValueReceiptDigest: noRemainingValueReceipt.receiptDigest, projectionByteCeiling: 1024,
    projectionEntryCeiling: 10, registrationByteCeiling: 1024, registrationEntryCeiling: 10,
    sharedStateByteCeiling: 1024, sharedStateEntryCeiling: 10,
    authorizedEffects: CLEANUP_EFFECTS, retainedEffects: RETAINED_EFFECTS,
    expiresAt: '2026-09-02T01:00:00.000Z' });
  const retiredPlanFields = Object.fromEntries(Object.entries(retiredPlan)
    .filter(([key]) => key !== 'planDigest'));
  const plan = createWorktreeCleanupPlan({ ...retiredPlanFields,
    expiresAt: '2026-09-02T02:00:00.000Z' });
  const retirementPlan = transitionPlan({ repository, transition: 'retire', target: targetPath,
    revision: mergedRevision, claimId: integration.receipt.transitionReceipt.resultClaimId,
    leaseEpoch: integration.receipt.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.receipt.transitionReceipt.resultFenceRevision,
    predecessorDigest: integration.receipt.receiptDigest, candidateDigest, snapshotDigest,
    parametersDigest: worktreeCleanupPlanByteDigest(retiredPlan), cleanup: true });
  const retirement = await makeReceipt(retirementPlan);
  const integrationOperationInput = createGitHubTransitionInput({ request: integration.request,
    plan: integrationPlan, planByteDigest: effectPlanByteDigest(integration.planBytes),
    predecessorIssuance: issuance });
  const retirementOperationInput = createGitHubTransitionInput({ request: retirement.request,
    plan: retirementPlan, planByteDigest: effectPlanByteDigest(retirement.planBytes),
    predecessorIssuance: null });
  const verifier = operationInput => ({ repository: 'github.com/example/evidence', targetRepository: repository,
    operationInput, workflowRun: 'fixture', policy: {} });
  return { now, plan, integration, retirement, retirementPlan, integrationOperationInput,
    retirementOperationInput,
    bundle: { cleanup: { plan, integrationReceipt: integration.receipt,
      integrationPlanBytes: integration.planBytes, retirementReceipt: retirement.receipt,
      retirementPlanBytes: retirement.planBytes, integrationRequest: integration.request,
      retirementRequest: retirement.request, preservationReceipt, noRemainingValueReceipt },
    integrationVerifier: verifier(integrationOperationInput), retirementVerifier: verifier(retirementOperationInput) } };
}
test('completion close accepts only an exact plan or acknowledged apply invocation', () => {
  assert.deepEqual(validateCompletionCloseArguments(['plan', `--ref=${REF}`, '--bundle=/tmp/evidence.json']),
    { mode: 'plan', ref: REF, bundle: '/tmp/evidence.json', plan: undefined,
      authorize: undefined, confirm: undefined, stopped: false });
  assert.deepEqual(validateCompletionCloseArguments(['apply', `--ref=${REF}`,
    '--bundle=/tmp/evidence.json', '--confirm=sha256:abc', '--stopped']),
  { mode: 'apply', ref: REF, bundle: '/tmp/evidence.json', plan: undefined,
    authorize: undefined, confirm: 'sha256:abc', stopped: true });
  assert.throws(() => validateCompletionCloseArguments(['apply', `--ref=${REF}`]),
    { reason: 'blocked-completion-arguments' });
  assert.throws(() => validateCompletionCloseArguments(['plan', `--ref=${REF}`,
    '--bundle=/tmp/evidence.json', '--bundle=/tmp/other.json']),
  { reason: 'blocked-completion-arguments' });
  assert.throws(() => validateCompletionCloseArguments(['apply', `--ref=${REF}`,
    '--bundle=/tmp/evidence.json', '--plan=/tmp/plan.json', '--authorize=abc', '--stopped=true']),
  { reason: 'blocked-completion-arguments' });
  assert.throws(() => validateCompletionCloseArguments(['apply', `--ref=${REF}`,
    '--bundle=/tmp/evidence.json', '--confirm=abc', '--plan=/tmp/plan.json', '--stopped']),
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
  assert.throws(() => validateCompletionScaffoldArguments([`--ref=${REF}`, '--from=/tmp/scaffold.json']),
    { reason: 'blocked-completion-arguments' });
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
  assert.equal(scaffold.hydrationInputs.length, 8);
  assert.equal(scaffold.requiredPlaceholders.includes('integrationVerifier.policy'), false);
  assert.equal(scaffold.requiredPlaceholders.includes('cleanup.plan.projectionByteCeiling'), false);
  assert.equal(scaffold.requiredPlaceholders.includes('cleanup.plan.integratedResource'), false);
  assert.equal(scaffold.requiredPlaceholders.includes('cleanup.plan.integratedImmutableRevision'), false);
  assert.ok(scaffold.hydrationInputs.includes('cleanup.integrationReceipt'));
  assert.deepEqual(scaffold.bundleTemplate.cleanup.plan.authorizedEffects, [
    'quarantine-worktree-projection',
    'quarantine-worktree-registration',
  ]);
  assert.deepEqual(scaffold.autoDerivedFields, ['cleanup.cleanupContinuation']);
  assert.equal(scaffold.bundleTemplate.cleanup.cleanupContinuation, null);
  assert.ok(scaffold.warnings.some((item) => item.code === 'lane-registration-detached'));
});

test('completion plan hydration derives duplicate requests, plan bytes, digests, and continuation', async () => {
  const fixture = await closeBundleFixture(), bundle = structuredClone(fixture.bundle);
  const run = id => ({ id: String(id),
    url: `https://api.github.com/repos/example/evidence/actions/runs/${id}`,
    ref: 'refs/heads/main', revision: 'a'.repeat(40), workflowRef: 'refs/heads/main',
    workflowPath: '.github/workflows/adlc-transition.yml', workflowRevision: 'a'.repeat(40),
    authoritySubject: 'github-user:42' });
  bundle.integrationVerifier = { repository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target',
    operationInput: fixture.integrationOperationInput, workflowRun: run(1), policy: {} };
  bundle.retirementVerifier = { repository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target',
    operationInput: fixture.retirementOperationInput, workflowRun: run(2), policy: {} };
  const hydrated = deriveCompletionBundleFields(bundle,
    { now: () => Date.parse('2026-09-02T01:10:00.000Z') });
  assert.equal(hydrated.cleanup.plan.candidateDigest, fixture.plan.candidateDigest);
  assert.equal(hydrated.cleanup.plan.integrationReceiptDigest, fixture.integration.receipt.receiptDigest);
  assert.deepEqual([...hydrated.cleanup.integrationPlanBytes], [...fixture.integration.planBytes]);
  assert.deepEqual(hydrated.cleanup.integrationRequest, fixture.integration.request);
  assert.ok(hydrated.cleanup.cleanupContinuation);
  assert.equal(hydrated.cleanup.plan.planDigest, fixture.plan.planDigest);
  assert.doesNotThrow(() => materializeCompletionCloseBundle(hydrated,
    { now: () => Date.parse('2026-09-02T01:10:00.000Z') }));
});

test('completion bundle hydration rejects conflicting duplicate evidence instead of overwriting it', async () => {
  const fixture = await closeBundleFixture(), bundle = structuredClone(fixture.bundle);
  const evidence = fixture.integration;
  bundle.integrationVerifier = { repository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target',
    operationInput: fixture.integrationOperationInput,
    workflowRun: 'REPLACE_WITH_INTEGRATION_WORKFLOW_RUN', policy: {} };
  bundle.retirementVerifier = { repository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target', operationInput: 'REPLACE_WITH_RETIREMENT_OPERATION_INPUT',
    workflowRun: 'REPLACE_WITH_RETIREMENT_WORKFLOW_RUN', policy: {} };
  bundle.cleanup.integrationRequest = { ...evidence.request, requestDigest: hash('9') };
  assert.throws(() => deriveCompletionBundleFields(bundle),
    /integrationRequest conflicts with authenticated evidence/u);
});

test('completion scaffold keeps verifier policy as a placeholder when no committed policy is available', () => {
  const scaffold = buildCompletionBundleScaffold({
    ref: REF,
    repository: 'github.com/example/repo',
    profileDigest: '1'.repeat(64),
    canonicalRevision: 'a'.repeat(40),
    lane: { path: '/tmp/lane', mounted: true, head: 'b'.repeat(40), clean: true },
    integration: { kind: 'exact-tree-projection', pathCount: 3 },
    findings: [],
  }, { profileDigest: '1'.repeat(64), canonical: { localRef: 'refs/heads/main' } });
  assert.equal(scaffold.bundleTemplate.integrationVerifier.policy, 'REPLACE_WITH_TRANSITION_POLICY_OBJECT');
  assert.ok(scaffold.hydrationInputs.includes('integrationVerifier.policy'));
  assert.ok(scaffold.hydrationInputs.includes('retirementVerifier.policy'));
  assert.ok(scaffold.hydrationInputs.includes('integrationVerifier.repository'));
  assert.ok(scaffold.hydrationInputs.includes('retirementVerifier.repository'));
  assert.equal(scaffold.requiredPlaceholders.includes('integrationVerifier.policy'), true);
});
