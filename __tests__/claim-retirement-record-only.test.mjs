import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, governanceDigest, retire } from '../src/governance.mjs';
import { createAuthenticatedTransitionOperationReceipt, createEffectPlan, effectPlanByteDigest, encodeEffectPlan } from '../src/completion.mjs';
import { createGitHubTransitionInput, createGitHubStoredTransition, deriveGitHubTransitionInputDigest, encodeGitHubTransitionInput, validateGitHubTransitionDispatchEvent } from '../src/github-transition-client.mjs';
import { createGitHubTransitionAuthorityVerifier, publishGitHubTransitionAuthority } from '../src/github-transition-authority.mjs';
import { GITHUB_HISTORICAL_CONTENT_MODE, GITHUB_TRANSITION_RECOVERY_POLICY_SCHEMA, GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA, validateGitHubTransitionPolicy, validateTransitionProviderProof } from '../src/github-transition-policy.mjs';
import { RECORD_ONLY_RETIREMENT_EFFECTS, RECORD_ONLY_RETIREMENT_RETAINED_EFFECTS } from '../src/cleanup-records.mjs';
import { CANDIDATE, TARGET_BASE, MERGE, NOW, TRANSITION_BASE, TRANSITION_POLICY, POLICY_CONTEXT, hex, historicalSquash, integrationFixture, workflowRun } from './lib/github-transition-fixture.mjs';

const SCOPE = ['recovery/current-historical-content/pr-7'];
const ENROLLMENT = { schema: 'agentic-os/historical-content-enrollment/v1',
  repository: 'github.com/example/target', reviewLocator: 'https://github.com/example/target/pull/7',
  baseRevision: TARGET_BASE, headRevision: CANDIDATE, mergeRevision: MERGE, treeRevision: hex('a', 40),
  checkContexts: ['Integration Gate'], adoptionScope: SCOPE, rationale: 'Current adoption with historical authority unproven.' };
const ADOPTION = { schema: 'agentic-os/successor-preservation-adoption/v1',
  repository: ENROLLMENT.repository, predecessorRef: 'agent/device/predecessor', predecessorHead: hex('4', 40),
  successorRef: 'agent/device/recovery', successorHead: CANDIDATE, merge: MERGE,
  reviewLocator: ENROLLMENT.reviewLocator, replacedPaths: ['src/feature.mjs'], quarantineCoordinate: hex('f'),
  historicalSuccessionAuthorityProven: false };
const POLICY = { ...TRANSITION_POLICY, schema: GITHUB_TRANSITION_RECOVERY_POLICY_SCHEMA,
  historicalIntegrations: [ENROLLMENT], preservationAdoptions: [ADOPTION] };
function configure(state) {
  historicalSquash(state);
  state.targetMergeMethods = ['squash', 'rebase'];
  state.ruleSuiteRowsEmpty = true;
  state.transitionPolicy = POLICY;
}
const fixture = (change = () => {}) => integrationFixture(state => { configure(state); change(state); }, {
  initialReviewState: 'merged', integrationMode: GITHUB_HISTORICAL_CONTENT_MODE, scope: SCOPE });

async function publish(fx) {
  const winner = await publishGitHubTransitionAuthority(fx.common);
  const receipt = await createAuthenticatedTransitionOperationReceipt({ request: fx.final.request,
    planBytes: fx.final.planBytes }, createGitHubTransitionAuthorityVerifier(fx.common), { now: () => NOW });
  return { winner, receipt };
}
function signed(payload) { return { ...payload, receiptDigest: governanceDigest(payload) }; }
function disposition() {
  return signed({ schema: 'agentic-os/successor-preservation-receipt/v1', disposition: 'successor-preserved',
    adoption: ADOPTION, adoptionDigest: governanceDigest(ADOPTION), repository: ENROLLMENT.repository,
    canonicalRevision: MERGE, profileDigest: hex('1'), policyDigest: governanceDigest(POLICY),
    review: { repository: 'example/target', pr: 7, url: ADOPTION.reviewLocator, branch: ADOPTION.successorRef,
      head: CANDIDATE, merge: MERGE, mergedAt: '2026-09-02T00:04:30.000Z',
      checks: [{ name: 'Integration Gate', checkId: 701, runId: 201, attempt: 1, workflow: 'Integration',
        conclusion: 'success', completedAt: '2026-09-02T00:04:00.000Z', url: 'https://github.com/example/target/actions/runs/201/job/701' }],
      protectionProven: false, authority: 'observation-only' },
    integration: { kind: 'reviewed-successor', predecessorHead: ADOPTION.predecessorHead, reviewedHead: CANDIDATE,
      merge: MERGE, pathCount: 1, replacements: [{ path: 'src/feature.mjs', old: hex('2', 40), accepted: hex('3', 40) }] },
    retention: { coordinate: ADOPTION.quarantineCoordinate, operationDigest: hex('4'), registrationRef: ADOPTION.successorRef,
      retainedHead: CANDIDATE, projectionManifest: { digest: hex('5'), bytes: 128, entries: 1 },
      registrationManifest: { digest: hex('6'), bytes: 256, entries: 1 } },
    state: { root: '/exact/target', policyRoot: '/exact/evidence', policyRevision: TRANSITION_BASE,
      policyRepository: 'github.com/example/evidence', workflow: 'Integration', predecessorHead: ADOPTION.predecessorHead,
      successorHead: CANDIDATE, peerRegistrationDigest: hex('7'), cacheDigest: hex('8'), planDigest: hex('9'), planIssuedAt: '2026-09-02T00:21:15.000Z' },
    issuedAt: '2026-09-02T00:21:30.000Z', expiresAt: '2026-09-02T00:36:15.000Z',
    physicalCleanupPerformed: false, providerAuthority: false, claimRetired: false,
    historicalSuccessionAuthorityProven: false });
}
function retirement(fx, receipt, preservationDisposition = disposition(), allowedEffects = RECORD_ONLY_RETIREMENT_EFFECTS, scope = SCOPE) {
  const prior = receipt.transitionReceipt;
  const plan = createEffectPlan({ target: { repository: ENROLLMENT.repository,
    resource: ADOPTION.reviewLocator, immutableRevision: MERGE }, authority: {
    requestedTransition: 'retire', authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    claimId: prior.resultClaimId, leaseEpoch: prior.resultLeaseEpoch, fenceRevision: prior.resultFenceRevision,
    writeSetDigest: governanceDigest(scope), reviewLocator: null, predecessorDigest: receipt.receiptDigest },
    candidateDigest: fx.final.plan.candidateDigest, snapshotDigest: fx.final.plan.snapshotDigest,
    effectClass: 'claim-retirement-record-only', allowedEffects, forbiddenEffects: RECORD_ONLY_RETIREMENT_RETAINED_EFFECTS,
    parametersDigest: governanceDigest({ schema: 'agentic-os/record-only-retirement-parameters/v1',
      preservationReceiptDigest: preservationDisposition.receiptDigest, adoptionDigest: preservationDisposition.adoptionDigest }) });
  const planBytes = encodeEffectPlan(plan), planByteDigest = effectPlanByteDigest(planBytes);
  const request = retire({ repository: plan.target.repository, authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    scope, claimId: prior.resultClaimId, leaseEpoch: prior.resultLeaseEpoch, fenceRevision: prior.resultFenceRevision,
    immutableRevision: MERGE, dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt: '2026-09-02T00:22:00.000Z', expiresAt: '2026-09-02T00:36:15.000Z' });
  const operationInput = createGitHubTransitionInput({ request, plan, planByteDigest, predecessorIssuance: null, preservationDisposition });
  fx.api.state.currentDigest = deriveGitHubTransitionInputDigest(operationInput);
  return { request, planBytes, operationInput, common: { ...fx.common, workflowRun: workflowRun('202'), operationInput } };
}

test('record-only retirement binds adoption and real integration without physical cleanup', async () => {
  const fx = await fixture(), { receipt } = await publish(fx), retired = retirement(fx, receipt);
  const winner = await publishGitHubTransitionAuthority(retired.common);
  const proof = winner.stored.providerProof;
  assert.equal(proof.effectClass, 'claim-retirement-record-only');
  assert.equal(proof.preservationReceiptDigest, retired.operationInput.preservationDisposition.receiptDigest);
  assert.equal(proof.physicalCleanupPerformed, false);
  assert.equal(proof.historicalSuccessionAuthorityProven, false);
  const result = await createAuthenticatedTransitionOperationReceipt({ request: retired.request, planBytes: retired.planBytes },
    createGitHubTransitionAuthorityVerifier(retired.common), { now: () => NOW });
  assert.equal(result.transitionReceipt.resultState, 'retired');
  assert.equal(fx.api.publications.size, 2);
  const before = fx.api.calls.length;
  await publishGitHubTransitionAuthority({ ...retired.common, now: () => Date.parse('2026-09-03T00:00:00Z') });
  assert.ok(!fx.api.calls.slice(before).some(route => route.startsWith('POST ')));
});

test('record-only retirement rejects cleanup effects, upgraded local authority and foreign adoption', async () => {
  const fx = await fixture(), { receipt } = await publish(fx);
  assert.throws(() => retirement(fx, receipt, disposition(), [...RECORD_ONLY_RETIREMENT_EFFECTS, 'quarantine-worktree-projection']), /closed lifecycle|disjoint/u);
  const { receiptDigest: omitted, ...source } = disposition(); assert.ok(omitted);
  assert.throws(() => retirement(fx, receipt, signed({ ...source, providerAuthority: true })), /preservation claims/u);
  const altered = signed({ ...source, adoption: { ...ADOPTION, predecessorRef: 'agent/device/foreign' },
    adoptionDigest: governanceDigest({ ...ADOPTION, predecessorRef: 'agent/device/foreign' }) });
  const retired = retirement(fx, receipt, altered);
  await assert.rejects(publishGitHubTransitionAuthority(retired.common), /not exactly enrolled/u);
  assert.equal(fx.api.publications.size, 1);
});


test('record-only retirement rechecks local selected check IDs against provider and preserves its local false claims', async () => {
  const fx = await fixture(), { receipt } = await publish(fx), { receiptDigest: omitted, ...source } = disposition();
  assert.ok(omitted);
  const wrongCheck = signed({ ...source, review: { ...source.review, checks: source.review.checks.map(check => ({ ...check, checkId: 702 })) } });
  const retired = retirement(fx, receipt, wrongCheck);
  await assert.rejects(publishGitHubTransitionAuthority(retired.common), /adopted provider integration/u);
  const wrongPolicy = signed({ ...source, policyDigest: hex('f') });
  await assert.rejects(publishGitHubTransitionAuthority(retirement(fx, receipt, wrongPolicy).common), /adopted provider integration/u);
  assert.equal(fx.api.publications.size, 1);
});


test('record-only retirement binds exact policy source revision and selected check names before effects', async () => {
  const fx = await fixture(), { receipt } = await publish(fx), { receiptDigest: omitted, ...source } = disposition();
  assert.ok(omitted);
  for (const changed of [
    { ...source, state: { ...source.state, policyRevision: hex('5', 40) } },
    { ...source, state: { ...source.state, policyRepository: 'github.com/example/foreign' } },
    { ...source, review: { ...source.review, checks: source.review.checks.map(check => ({ ...check, name: 'Foreign Gate' })) } },
  ]) await assert.rejects(publishGitHubTransitionAuthority(retirement(fx, receipt, signed(changed)).common), /adopted provider integration/u);
  assert.equal(fx.api.publications.size, 1);
});

const ORIGINAL_RECEIPT = { schema: 'agentic-os/user-cleanup-receipt/v1',
  mode: 'explicit-local-user-consent-recovery', planDigest: ADOPTION.quarantineCoordinate,
  providerAuthority: false, protectionProven: false, claimRetired: false,
  historicalIntegrationMethodProven: false, result: 'quarantined' };
const RETENTION_ADOPTION = { schema: 'agentic-os/current-quarantine-adoption/v1',
  repository: ENROLLMENT.repository, targetRef: ADOPTION.successorRef, targetHead: CANDIDATE,
  merge: MERGE, reviewLocator: ADOPTION.reviewLocator, quarantineCoordinate: ADOPTION.quarantineCoordinate,
  originalReceiptDigest: governanceDigest(ORIGINAL_RECEIPT), historicalQuarantineAuthorityProven: false };
const RETENTION_POLICY = { ...POLICY, schema: GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA,
  retentionAdoptions: [RETENTION_ADOPTION] };
const retainedFixture = (change = () => {}) => fixture(state => {
  state.transitionPolicy = RETENTION_POLICY; change(state);
});
function retainedDisposition() {
  const { receiptDigest: omitted, historicalSuccessionAuthorityProven: history, ...source } = disposition();
  assert.ok(omitted); assert.equal(history, false);
  return signed({ ...source, schema: 'agentic-os/current-quarantine-retention-receipt/v1',
    disposition: 'current-quarantine-retained', adoption: RETENTION_ADOPTION,
    adoptionDigest: governanceDigest(RETENTION_ADOPTION), policyDigest: governanceDigest(RETENTION_POLICY),
    historicalQuarantineAuthorityProven: false,
    integration: { ...source.integration, kind: 'current-quarantined', predecessorHead: CANDIDATE, replacements: [] },
    state: { ...source.state, predecessorHead: CANDIDATE },
    retention: { ...source.retention, originalReceipt: ORIGINAL_RECEIPT,
      originalReceiptDigest: RETENTION_ADOPTION.originalReceiptDigest,
      retainedIndexInventoryDigest: hex('a'), recoveryInventoryDigest: hex('b') } });
}

test('current original record-only retirement binds fresh H01 winner and exact retained enrollment', async () => {
  const fx = await retainedFixture(), { receipt } = await publish(fx), retired = retirement(fx, receipt, retainedDisposition());
  const winner = await publishGitHubTransitionAuthority(retired.common), proof = winner.stored.providerProof;
  assert.equal(proof.physicalCleanupPerformed, false);
  assert.equal(proof.historicalQuarantineAuthorityProven, false);
  assert.equal(proof.adoptionDigest, governanceDigest(RETENTION_ADOPTION));
  assert.ok(!Object.hasOwn(proof, 'historicalSuccessionAuthorityProven'));
  const result = await createAuthenticatedTransitionOperationReceipt({ request: retired.request, planBytes: retired.planBytes },
    createGitHubTransitionAuthorityVerifier(retired.common), { now: () => NOW });
  assert.equal(result.transitionReceipt.resultState, 'retired');
  const before = fx.api.calls.length;
  await publishGitHubTransitionAuthority({ ...retired.common, now: () => Date.parse('2026-09-03T00:00:00Z') });
  assert.ok(!fx.api.calls.slice(before).some(route => route.startsWith('POST ')));
});

test('current original disposition rejects altered old receipt, upgraded history, expiry and cleanup effects', async () => {
  const fx = await retainedFixture(), { receipt } = await publish(fx);
  const { receiptDigest: omitted, ...source } = retainedDisposition(); assert.ok(omitted);
  for (const changed of [
    { ...source, retention: { ...source.retention, originalReceipt: { ...ORIGINAL_RECEIPT, claimRetired: true } } },
    { ...source, historicalQuarantineAuthorityProven: true },
    { ...source, expiresAt: '2026-09-02T00:45:00.000Z' },
  ]) assert.throws(() => retirement(fx, receipt, signed(changed)), /receipt|claims|ceiling/u);
  assert.throws(() => retirement(fx, receipt, retainedDisposition(),
    [...RECORD_ONLY_RETIREMENT_EFFECTS, 'quarantine-worktree-projection']), /closed lifecycle|disjoint/u);
  assert.equal(fx.api.publications.size, 1);
});

test('current original basis rejects foreign enrollment, policy source, check IDs and immutable-winner substitution', async () => {
  const fx = await retainedFixture(), { receipt } = await publish(fx);
  const { receiptDigest: omitted, ...source } = retainedDisposition(); assert.ok(omitted);
  const foreign = { ...RETENTION_ADOPTION, targetRef: 'agent/device/foreign' };
  for (const changed of [
    { ...source, adoption: foreign, adoptionDigest: governanceDigest(foreign), review: { ...source.review, branch: foreign.targetRef },
      retention: { ...source.retention, registrationRef: foreign.targetRef } },
    { ...source, state: { ...source.state, policyRevision: hex('5', 40) } },
    { ...source, review: { ...source.review, checks: source.review.checks.map(check => ({ ...check, checkId: 702 })) } },
  ]) await assert.rejects(publishGitHubTransitionAuthority(retirement(fx, receipt, signed(changed)).common), /enrolled|adopted provider integration/u);
  const retired = retirement(fx, receipt, retainedDisposition());
  const publication = [...fx.api.publications.values()][0];
  publication.stored = { ...publication.stored, coordinate: hex('f') };
  await assert.rejects(publishGitHubTransitionAuthority(retired.common), /transition publication bytes are invalid/u);
  assert.equal(fx.api.publications.size, 1);
});

test('record-only retirement rejects scope substitution against the authenticated H01 winner', async () => {
  for (const [make, local] of [[fixture, disposition], [retainedFixture, retainedDisposition]]) {
    const fx = await make(), { receipt } = await publish(fx);
    const retired = retirement(fx, receipt, local(), RECORD_ONLY_RETIREMENT_EFFECTS,
      ['recovery/current-historical-content/pr-foreign']);
    const before = fx.api.calls.length;
    await assert.rejects(publishGitHubTransitionAuthority(retired.common),
      /exact authenticated integration receipt/u);
    assert.equal(fx.api.publications.size, 1);
    assert.ok(!fx.api.calls.slice(before).some(route => route.startsWith('POST ')));
  }
});
