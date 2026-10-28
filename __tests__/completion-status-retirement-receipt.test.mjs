import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveCloseoutVerdict, retirementReviewLocator } from '../bin/agentic-os-completion-status.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { bindRetirementOperationReceipts, encodeEffectPlan } from '../src/completion.mjs';
import { createCostVerifiedTransitionReceipt as createAuthenticatedTransitionOperationReceipt,
  createTestEffectPlan as createEffectPlan } from './lib/effect-cost-fixtures.mjs';
import { createCoordinationRequest, governanceDigest } from '../src/governance.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const REPOSITORY = 'github.com/example/repository';
const REVIEW = `https://${REPOSITORY}/pull/42`;
const MERGE = 'a'.repeat(40);
const CLAIM = sha256('claim');
const OBSERVED = '2026-10-01T00:00:00.000Z';
const EXPIRES = '2026-10-01T00:05:00.000Z';

async function operationReceipt(operation, { leaseEpoch, fenceRevision, resultFenceRevision, reviewLocator }) {
  const scope = ['docs/example.md'];
  const authoritySubject = 'github-user:42';
  const ownerSubject = 'agent/device/receipt-test';
  const writeSetDigest = governanceDigest(scope);
  const plan = createEffectPlan({
    target: { repository: REPOSITORY, resource: REVIEW, immutableRevision: MERGE },
    authority: { requestedTransition: operation, authoritySubject, ownerSubject, claimId: CLAIM,
      leaseEpoch, fenceRevision, writeSetDigest, reviewLocator, predecessorDigest: sha256(`previous-${operation}`) },
    candidateDigest: sha256('candidate'), snapshotDigest: sha256('snapshot'),
    effectClass: operation, allowedEffects: [operation], forbiddenEffects: [], parametersDigest: sha256('parameters'),
  });
  const planBytes = encodeEffectPlan(plan);
  const planByteDigest = sha256(planBytes);
  const request = createCoordinationRequest({ repository: REPOSITORY, authoritySubject, ownerSubject,
    scope, claimId: CLAIM, leaseEpoch, fenceRevision, immutableRevision: MERGE, reviewLocator,
    dependentWork: [`effect-plan:sha256:${planByteDigest}`], observedAt: OBSERVED, expiresAt: EXPIRES }, operation);
  const verifiedAt = '2026-10-01T00:02:00.000Z';
  const grant = {
    adapter: { id: 'receipt-test', version: '1' }, authenticatedSubject: authoritySubject,
    expiresAt: '2026-10-01T00:04:00.000Z', operationReceiptDigest: sha256(`operation-${operation}`),
    planDigest: plan.planDigest, planByteDigest, providerRecordDigest: sha256(`provider-${operation}`),
    providerRecordLocator: `https://api.github.com/repos/example/repository/git/ref/${operation}`,
    requestDigest: request.requestDigest, requestedTransition: operation,
    sourceClaimId: CLAIM, sourceLeaseEpoch: leaseEpoch, sourceFenceRevision: fenceRevision,
    resultClaimId: CLAIM, resultLeaseEpoch: leaseEpoch + 1, resultFenceRevision,
    resultState: operation === 'integrate' ? 'integrated' : 'retired',
    transitionedAt: verifiedAt, verifiedAt,
  };
  return createAuthenticatedTransitionOperationReceipt({ request, planBytes }, () => grant,
    { now: () => Date.parse(verifiedAt) });
}

async function receiptPair({ retiredFence = sha256('retired-fence'), reviewLocator = REVIEW } = {}) {
  const integratedFence = sha256('integrated-fence');
  const integration = await operationReceipt('integrate', { leaseEpoch: 1, fenceRevision: sha256('initial-fence'),
    resultFenceRevision: integratedFence, reviewLocator });
  const retirement = await operationReceipt('retire', { leaseEpoch: 2, fenceRevision: integratedFence,
    resultFenceRevision: retiredFence, reviewLocator: null });
  return { integration, retirement };
}

test('completion status accepts a locally bound receipt pair without claiming producer authentication', async () => {
  const { integration, retirement } = await receiptPair();
  assert.throws(() => bindRetirementOperationReceipts(integration, retirement,
    { repository: REPOSITORY, reviewLocator: REVIEW }), /do not bind/u);
  const binding = bindRetirementOperationReceipts(integration, retirement, {
    repository: REPOSITORY, reviewLocator: REVIEW,
    preservationReceipt: { repository: REPOSITORY, adoption: { reviewLocator: REVIEW, merge: MERGE } },
  });
  assert.equal(binding.state, 'retired');
  assert.equal(binding.integrationReceiptDigest, integration.receiptDigest);
  assert.equal(binding.retirementReceiptDigest, retirement.receiptDigest);
  assert.equal(binding.producerAuthorityVerified, false);
  assert.equal(binding.grantsAuthority, false);
  assert.equal(validateCommandArguments('completion', ['status', '--ref=agent/device/receipt-test',
    '--integration-receipt=/evidence/integration.json', '--retirement-receipt=/evidence/retirement.json']), null);
  assert.equal(validateCommandArguments('release-common', ['close', '--ref=agent/device/receipt-test',
    '--preservation=/evidence/preservation.json', '--integration-receipt=/evidence/integration.json',
    '--retirement-receipt=/evidence/retirement.json']), null);
});

test('retained preservation supplies the review locator after lane registration is quarantined', async () => {
  const { integration, retirement } = await receiptPair();
  const preservationReceipt = { repository: REPOSITORY, adoption: { reviewLocator: REVIEW, merge: MERGE } };
  const reviewLocator = retirementReviewLocator(REPOSITORY, null, preservationReceipt);
  assert.equal(reviewLocator, REVIEW);
  const binding = bindRetirementOperationReceipts(integration, retirement, {
    repository: REPOSITORY, reviewLocator, preservationReceipt,
  });
  assert.equal(binding.state, 'retired');
  assert.throws(() => retirementReviewLocator(REPOSITORY, null, {
    adoption: { reviewLocator: 'https://github.com/other/repository/pull/42' },
  }), /exact review locator/u);
  assert.throws(() => retirementReviewLocator(REPOSITORY, { pr: 43 }, preservationReceipt),
    /exact review locator/u);
});

test('completion status rejects receipts with the wrong review, merge, digest, or lease predecessor', async () => {
  const pair = await receiptPair();
  assert.throws(() => bindRetirementOperationReceipts(pair.integration, pair.retirement,
    { repository: REPOSITORY, reviewLocator: `${REVIEW}/wrong`, preservationReceipt: {
      repository: REPOSITORY, adoption: { reviewLocator: REVIEW, merge: MERGE } } }), /do not bind/u);
  assert.throws(() => bindRetirementOperationReceipts(pair.integration, pair.retirement,
    { repository: REPOSITORY, reviewLocator: REVIEW, preservationReceipt: {
      repository: REPOSITORY, adoption: { reviewLocator: REVIEW, merge: 'b'.repeat(40) } } }), /do not bind/u);
  const tampered = { ...pair.retirement, receiptDigest: '0'.repeat(64) };
  assert.throws(() => bindRetirementOperationReceipts(pair.integration, tampered,
    { repository: REPOSITORY, reviewLocator: REVIEW, preservationReceipt: {
      repository: REPOSITORY, adoption: { reviewLocator: REVIEW, merge: MERGE } } }), /receipt digest/u);
  const wrongPredecessor = await operationReceipt('retire', { leaseEpoch: 2, fenceRevision: sha256('wrong-fence'),
    resultFenceRevision: sha256('another-retired-fence'), reviewLocator: null });
  assert.throws(() => bindRetirementOperationReceipts(pair.integration, wrongPredecessor,
    { repository: REPOSITORY, reviewLocator: REVIEW, preservationReceipt: {
      repository: REPOSITORY, adoption: { reviewLocator: REVIEW, merge: MERGE } } }), /do not bind/u);
});

test('retirement receipt does not replace the separate workspace-cleanup receipt', () => {
  const shared = { sourceIntegrated: true, canonicalCurrent: true, laneMounted: false, laneClean: null,
    laneHead: true, quarantineProfile: true, quarantineObserved: false, preservationObserved: true,
    preservationDisposition: 'current-quarantine-retained', deployBound: false, findingCodes: [],
    localPolicyCandidate: true };
  const pending = deriveCloseoutVerdict({ ...shared, findingCodes: ['provider-retirement-unverified'] });
  assert.equal(pending.adlcState, 'retirement_pending');
  const bound = deriveCloseoutVerdict({ ...shared, retirementReceiptVerified: true });
  assert.equal(bound.completionScope, 'retirement-bound');
  assert.equal(bound.adlcState, 'cleanup_pending');
  assert.equal(bound.cleanupSatisfied, false);
  assert.equal(bound.nextAction.id, 'workspace-cleanup');
  assert.equal(bound.retirementSatisfied, true);
  assert.equal(bound.authorizesEffects, false);
});
