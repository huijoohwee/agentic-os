import { test } from 'node:test';
import assert from 'node:assert/strict';
import { governanceDigest, integrate, retire } from '../src/governance.mjs';
import {
  EFFECT_COST_POLICY,
  createAuthenticatedTransitionOperationReceipt as createRawTransitionReceipt,
  effectCostScopeDigest,
  effectPlanByteDigest,
  encodeEffectPlan,
  validateAuthenticatedTransitionOperationReceipt,
  validateEffectPlan,
  validateEffectPlanBytes,
} from '../src/completion.mjs';
import { createCostVerifiedTransitionReceipt as createAuthenticatedTransitionOperationReceipt,
  createTestEffectPlan as createEffectPlan, verifyTestEffectCost } from './lib/effect-cost-fixtures.mjs';
import { createEffectPlan as createRawEffectPlan } from '../src/completion.mjs';

const hash = (character) => character.repeat(64);
const NOW = Date.parse('2026-09-02T00:40:00.000Z');

function plan(overrides = {}) {
  return createEffectPlan({
    target: {
      repository: 'github.com/example/repository',
      resource: 'agent/device/lane',
      immutableRevision: 'a'.repeat(40),
    },
    authority: {
      requestedTransition: 'integrate',
      authoritySubject: 'github-user:42',
      ownerSubject: 'github-user:42',
      claimId: hash('1'),
      leaseEpoch: 7,
      fenceRevision: hash('2'),
      writeSetDigest: governanceDigest(['src/feature.mjs']),
      reviewLocator: null,
      predecessorDigest: hash('6'),
    },
    candidateDigest: hash('b'),
    snapshotDigest: hash('c'),
    effectClass: 'protected-integration',
    allowedEffects: ['merge'],
    forbiddenEffects: ['cleanup', 'delete-ref', 'force-push'],
    parametersDigest: hash('d'),
    ...overrides,
  });
}

function request(operation, bound = plan(), overrides = {}) {
  const create = operation === 'integrate' ? integrate : retire;
  return create({
    repository: bound.target.repository,
    authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42',
    scope: ['src/feature.mjs'],
    claimId: hash('1'),
    leaseEpoch: 7,
    fenceRevision: hash('2'),
    immutableRevision: bound.target.immutableRevision,
    dependentWork: [`effect-plan:sha256:${effectPlanByteDigest(encodeEffectPlan(bound))}`],
    observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
    ...overrides,
  });
}

const grant = (input, overrides = {}) => ({
  adapter: { id: 'fixture-provider', version: '1' },
  authenticatedSubject: 'github-user:42',
  providerRecordLocator: 'provider://operation/7',
  providerRecordDigest: hash('4'),
  requestDigest: input.request.requestDigest,
  requestedTransition: input.request.requestedTransition,
  planDigest: input.plan.planDigest,
  planByteDigest: input.planByteDigest,
  sourceClaimId: input.request.claimId,
  sourceLeaseEpoch: input.request.leaseEpoch,
  sourceFenceRevision: input.request.fenceRevision,
  resultClaimId: input.request.claimId,
  resultLeaseEpoch: input.request.leaseEpoch + 1,
  resultFenceRevision: hash('3'),
  resultState: input.request.requestedTransition === 'integrate' ? 'integrated' : 'retired',
  operationReceiptDigest: hash('5'),
  costEvidenceVerification: input.costEvidenceVerification,
  transitionedAt: '2026-09-02T00:40:00.000Z',
  verifiedAt: '2026-09-02T00:40:00.000Z',
  expiresAt: '2026-09-02T00:50:00.000Z',
  ...overrides,
});

test('effect plans have distinct semantic and exact-byte identities', () => {
  const bound = plan(), bytes = encodeEffectPlan(bound);
  assert.deepEqual(validateEffectPlan(bound), bound);
  assert.deepEqual(validateEffectPlanBytes(bytes), bound);
  assert.deepEqual(bound.costPolicy, EFFECT_COST_POLICY);
  assert.equal(bound.schema, 'agentic-os/effect-plan/v4');
  assert.equal(bound.costPolicy.schema, 'agentic-os/effect-cost-policy/v2');
  assert.equal(bound.costPolicy.maxIncrementalSpendUsd, 0);
  assert.equal(bound.costPolicy.billableUsageRequiresProviderHardCap, true);
  assert.equal(bound.costPolicy.providerHardCapUsd, 0);
  assert.equal(bound.costPolicy.freeQuotaOnlyEvidenceSufficient, false);
  assert.equal(bound.costEvidence.scopeDigest, effectCostScopeDigest(bound));
  assert.equal(bound.costPolicy.unknownQuotaHeadroomDisposition, 'block');
  assert.match(bound.planDigest, /^[0-9a-f]{64}$/u);
  assert.match(effectPlanByteDigest(bytes), /^[0-9a-f]{64}$/u);
  assert.notEqual(bound.planDigest, effectPlanByteDigest(bytes));
  assert.throws(() => validateEffectPlanBytes(Buffer.concat([bytes, Buffer.from('\n')])),
    /canonical bytes/u);
  assert.throws(() => createEffectPlan({
    ...bound,
    planDigest: hash('9'),
  }), /planDigest/u);
  assert.throws(() => createEffectPlan({
    ...bound,
    allowedEffects: ['cleanup'],
  }), /disjoint/u);
  assert.throws(() => createEffectPlan({ ...bound,
    costPolicy: { ...EFFECT_COST_POLICY, maxIncrementalSpendUsd: 1 },
  }), /zero-cost policy/u);
  assert.throws(() => createEffectPlan({ ...bound,
    costPolicy: { ...EFFECT_COST_POLICY, freeQuotaOnlyEvidenceSufficient: true },
  }), /zero-cost policy/u);
  assert.throws(() => validateEffectPlan({ ...bound, schema: 'agentic-os/effect-plan/v2' }),
    /schema or zero-cost policy/u);
  const { costEvidence: _omittedCostEvidence, ...withoutCostEvidence } = bound;
  assert.throws(() => createRawEffectPlan(withoutCostEvidence), /effect cost evidence is required/u);
  assert.throws(() => createRawEffectPlan({ ...bound, costEvidence: {
    ...bound.costEvidence, mode: 'provider-hard-cap', providerHardCapUsd: null,
  } }), /zero-cost, no-overage disposition/u);
  assert.throws(() => createRawEffectPlan({ ...bound, costEvidence: {
    ...bound.costEvidence, scopeDigest: hash('9'),
  } }), /exact effect scope/u);
});

for (const operation of ['integrate', 'retire']) {
  test(`${operation} transition requires provider-authenticated exact-plan operation proof`,
    async () => {
      const bound = plan({
        effectClass: operation === 'integrate' ? 'protected-integration' : 'claim-retirement',
        authority: { ...plan().authority, requestedTransition: operation },
      });
      const source = request(operation, bound);
      let observed;
      const receipt = await createAuthenticatedTransitionOperationReceipt({
        request: source,
        planBytes: encodeEffectPlan(bound),
      }, async (input) => { observed = input; return grant(input); }, { now: () => NOW });
      assert.equal(observed.request.requestDigest, source.requestDigest);
      assert.equal(observed.plan.planDigest, bound.planDigest);
      assert.equal(observed.planByteDigest, effectPlanByteDigest(encodeEffectPlan(bound)));
      assert.deepEqual(validateAuthenticatedTransitionOperationReceipt(receipt), receipt);
      assert.equal(receipt.requestedTransition, operation);
      assert.equal(receipt.transitionReceipt.resultState,
        operation === 'integrate' ? 'integrated' : 'retired');
      assert.equal(receipt.transitionReceipt.operationReceiptDigest, hash('5'));
    });
}

test('authenticated transitions fail closed on authority, time, plan, and outcome drift', async () => {
  const bound = plan(), source = request('integrate', bound), input = {
    request: source,
    planBytes: encodeEffectPlan(bound),
  };
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(
    input, async (observed) => grant(observed, { authenticatedSubject: 'github-user:43' }),
    { now: () => NOW }), /request, plan, source, or window/u);
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(
    input, async (observed) => grant(observed, { expiresAt: '2026-09-02T00:40:00.000Z' }),
    { now: () => NOW }), /times are invalid|request, plan, source, or window/u);
  await assert.rejects(createAuthenticatedTransitionOperationReceipt({
    ...input, planBytes: Buffer.concat([input.planBytes, Buffer.from('\n')]),
  }, async (observed) => grant(observed), { now: () => NOW }), /canonical bytes/u);
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(input,
    async (observed) => grant(observed, { resultState: 'retired' }),
    { now: () => NOW }), /resultState/u);
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(input,
    async (observed) => grant(observed, { requestDigest: hash('9') }),
    { now: () => NOW }), /request, plan, source, or window/u);
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(
    input, null, { now: () => NOW }), /verifier is required/u);
  await assert.rejects(createRawTransitionReceipt(input, async (observed) => grant(observed),
    { now: () => NOW }), /provider cost evidence verifier/u);
  await assert.rejects(createRawTransitionReceipt(input, async (observed) => {
    const { costEvidenceVerification: _missing, ...unbound } = grant(observed);
    return unbound;
  }, { now: () => NOW, verifyCostEvidence: verifyTestEffectCost }), /fields are invalid/u);
  let authorityCalls = 0;
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(input,
    async (observed) => { authorityCalls += 1; return grant(observed); }, {
      now: () => NOW,
      verifyCostEvidence: async ({ evidence }) => ({ ...verifyTestEffectCost({ evidence }),
        status: 'unverified' }),
    }), /cost evidence/u);
  assert.equal(authorityCalls, 0, 'authority operation must not run before cost evidence verifies');
  let calls = 0;
  await assert.rejects(createAuthenticatedTransitionOperationReceipt(
    input, async (observed) => grant(observed),
    { now: () => calls++ === 0 ? NOW : NOW - 1 }),
  /moved backwards/u);
  const valid = await createAuthenticatedTransitionOperationReceipt(input,
    async (observed) => grant(observed), { now: () => NOW });
  assert.equal(valid.authorityOperation.costEvidenceVerification.verifiedAt,
    '2026-09-02T00:40:00.000Z');
  const forged = JSON.parse(JSON.stringify(valid));
  forged.authorityOperation.resultLeaseEpoch += 1;
  forged.transitionReceipt.resultLeaseEpoch += 1;
  delete forged.transitionReceipt.receiptDigest;
  forged.transitionReceipt.receiptDigest = governanceDigest(forged.transitionReceipt);
  delete forged.receiptDigest;
  forged.receiptDigest = governanceDigest(forged);
  assert.throws(() => validateAuthenticatedTransitionOperationReceipt(forged),
    /internally inconsistent/u);
});
