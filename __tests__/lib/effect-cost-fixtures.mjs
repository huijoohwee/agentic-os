import { createEffectPlan, effectCostScopeDigest,
  createAuthenticatedTransitionOperationReceipt,
  VERIFIED_EFFECT_COST_EVIDENCE_SCHEMA } from '../../src/completion.mjs';

const EVIDENCE_DIGEST = 'f'.repeat(64);
const FIXTURE_VALID_FROM = '2026-09-01T00:00:00.000Z';
const FIXTURE_VALID_UNTIL = '2027-01-01T00:00:00.000Z';

export function createTestEffectPlan(input) {
  const costEvidence = {
    ...(input.costEvidence ?? {
    schema: 'agentic-os/effect-cost-evidence/v1',
    mode: 'free-fail-closed',
    provider: 'fixture-provider',
    billingPlan: 'free',
    providerHardCapUsd: null,
    quotaExhaustion: 'deny',
    paidPlanActive: false,
    addOnsActive: false,
    overagesEnabled: false,
    autoUpgradeEnabled: false,
    evidenceRef: 'provider://fixture/account-cost-evidence',
    evidenceDigest: EVIDENCE_DIGEST,
    verifiedAt: FIXTURE_VALID_FROM,
    expiresAt: FIXTURE_VALID_UNTIL,
    }),
    scopeDigest: effectCostScopeDigest(input),
  };
  return createEffectPlan({ ...input, costEvidence });
}

export function verifyTestEffectCost({ evidence, observedAt }) {
  return {
    schema: VERIFIED_EFFECT_COST_EVIDENCE_SCHEMA,
    status: 'verified-zero-cost',
    provider: evidence.provider,
    mode: evidence.mode,
    billingPlan: evidence.billingPlan,
    providerHardCapUsd: evidence.providerHardCapUsd,
    quotaExhaustion: evidence.quotaExhaustion,
    paidPlanActive: evidence.paidPlanActive,
    addOnsActive: evidence.addOnsActive,
    overagesEnabled: evidence.overagesEnabled,
    autoUpgradeEnabled: evidence.autoUpgradeEnabled,
    evidenceDigest: evidence.evidenceDigest,
    scopeDigest: evidence.scopeDigest,
    verifiedAt: observedAt ?? FIXTURE_VALID_FROM,
    expiresAt: evidence.expiresAt ?? FIXTURE_VALID_UNTIL,
  };
}

export function createCostVerifiedTransitionReceipt(input, verifyAuthority, options = {}) {
  const verifyAuthorityWithCost = typeof verifyAuthority === 'function'
    ? async (value) => ({ ...(await verifyAuthority(value)), costEvidenceVerification: value.costEvidenceVerification })
    : verifyAuthority;
  return createAuthenticatedTransitionOperationReceipt(input, verifyAuthorityWithCost, {
    ...options,
    verifyCostEvidence: options.verifyCostEvidence ?? verifyTestEffectCost,
  });
}
