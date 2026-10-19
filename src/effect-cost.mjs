/** Scoped provider cost evidence and current zero-cost verification for effects. */
import { canonicalJson, governanceDigest } from './governance.mjs';
import { cleanupRecordDigest as digest, cleanupRecordExact as exact,
  freezeCleanupRecord as freeze } from './cleanup-records.mjs';

export const EFFECT_COST_POLICY = Object.freeze({ schema: 'agentic-os/effect-cost-policy/v2',
  currency: 'USD', maxIncrementalSpendUsd: 0, billableUsageRequiresProviderHardCap: true,
  providerHardCapUsd: 0, freeQuotaOnlyEvidenceSufficient: false, paidPlansAllowed: false,
  addOnsAllowed: false, overagesAllowed: false, unknownCostDisposition: 'block',
  unknownQuotaHeadroomDisposition: 'block' });
export const VERIFIED_EFFECT_COST_EVIDENCE_SCHEMA = 'agentic-os/verified-effect-cost-evidence/v1';
const EVIDENCE_KEYS = ['schema', 'mode', 'provider', 'billingPlan', 'providerHardCapUsd',
  'quotaExhaustion', 'paidPlanActive', 'addOnsActive', 'overagesEnabled', 'autoUpgradeEnabled',
  'evidenceRef', 'evidenceDigest', 'scopeDigest', 'verifiedAt', 'expiresAt'];
const VERIFIED_KEYS = ['schema', 'status', 'provider', 'mode', 'billingPlan', 'providerHardCapUsd',
  'quotaExhaustion', 'paidPlanActive', 'addOnsActive', 'overagesEnabled', 'autoUpgradeEnabled',
  'evidenceDigest', 'scopeDigest', 'verifiedAt', 'expiresAt'];
const EFFECT = /^[a-z][a-z0-9-]{0,127}$/u;
function fail(message) { throw new TypeError(message); }
function snapshot(value) { return JSON.parse(canonicalJson(value)); }
function text(value, label) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`);
  return value;
}
function instant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) fail(`${label} must be an exact UTC instant`);
  return result;
}
function strings(value, label, { nonempty = false } = {}) {
  if (!Array.isArray(value) || nonempty && value.length === 0) fail(`${label} must be an array`);
  const result = value.map((entry) => text(entry, label)).sort();
  if (new Set(result).size !== result.length || result.some((entry) => !EFFECT.test(entry)))
    fail(`${label} must be canonical, duplicate-free effect names`);
  return result;
}
function target(value) {
  exact(value, ['repository', 'resource', 'immutableRevision'], 'effect plan target');
  return { repository: text(value.repository, 'effect plan target repository'),
    resource: text(value.resource, 'effect plan target resource'),
    immutableRevision: text(value.immutableRevision, 'effect plan immutable revision') };
}
export function effectCostScopeDigest(value) {
  const source = snapshot(value);
  return governanceDigest({ target: target(source.target),
    candidateDigest: digest(source.candidateDigest, 'cost scope candidateDigest'),
    effectClass: text(source.effectClass, 'cost scope effectClass'),
    allowedEffects: strings(source.allowedEffects, 'cost scope allowedEffects', { nonempty: true }),
    forbiddenEffects: strings(source.forbiddenEffects, 'cost scope forbiddenEffects'),
    parametersDigest: digest(source.parametersDigest, 'cost scope parametersDigest') });
}
export function normalizeEffectCostEvidence(value, scopeDigest) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('effect cost evidence is required');
  const source = snapshot(value);
  exact(source, EVIDENCE_KEYS, 'effect cost evidence');
  if (source.schema !== 'agentic-os/effect-cost-evidence/v1'
    || !['non-billable', 'free-fail-closed', 'provider-hard-cap'].includes(source.mode))
    fail('effect cost evidence schema or mode is invalid');
  const verifiedAt = instant(source.verifiedAt, 'effect cost evidence verifiedAt');
  const expiresAt = instant(source.expiresAt, 'effect cost evidence expiresAt');
  const cap = source.providerHardCapUsd;
  if (Date.parse(expiresAt) <= Date.parse(verifiedAt) || cap !== null && cap !== 0
    || source.mode === 'provider-hard-cap' && cap !== 0
    || source.mode !== 'provider-hard-cap' && cap !== null
    || source.mode === 'free-fail-closed' && (source.billingPlan !== 'free' || source.quotaExhaustion !== 'deny')
    || source.mode === 'non-billable' && (source.billingPlan !== 'none' || source.quotaExhaustion !== 'not-applicable')
    || source.mode === 'provider-hard-cap' && !['free', 'none'].includes(source.billingPlan)
    || source.mode === 'provider-hard-cap' && source.quotaExhaustion !== 'not-applicable'
    || source.paidPlanActive !== false || source.addOnsActive !== false
    || source.overagesEnabled !== false || source.autoUpgradeEnabled !== false)
    fail('effect cost evidence does not prove a zero-cost, no-overage disposition');
  const proofScope = digest(source.scopeDigest, 'effect cost evidence scopeDigest');
  if (proofScope !== scopeDigest) fail('effect cost evidence does not bind the exact effect scope');
  return freeze({ schema: source.schema, mode: source.mode,
    provider: text(source.provider, 'effect cost evidence provider'), billingPlan: source.billingPlan,
    providerHardCapUsd: cap, quotaExhaustion: source.quotaExhaustion, paidPlanActive: false,
    addOnsActive: false, overagesEnabled: false, autoUpgradeEnabled: false,
    evidenceRef: text(source.evidenceRef, 'effect cost evidence evidenceRef'),
    evidenceDigest: digest(source.evidenceDigest, 'effect cost evidence evidenceDigest'),
    scopeDigest: proofScope, verifiedAt, expiresAt });
}
export function validateEffectCostEvidenceVerification(value) {
  const source = snapshot(value);
  exact(source, VERIFIED_KEYS, 'verified effect cost evidence');
  const verifiedAt = instant(source.verifiedAt, 'verified cost evidence verifiedAt');
  const expiresAt = instant(source.expiresAt, 'verified cost evidence expiresAt');
  if (source.schema !== VERIFIED_EFFECT_COST_EVIDENCE_SCHEMA || source.status !== 'verified-zero-cost'
    || !['non-billable', 'free-fail-closed', 'provider-hard-cap'].includes(source.mode)
    || !['free', 'none'].includes(source.billingPlan)
    || source.providerHardCapUsd !== null && source.providerHardCapUsd !== 0
    || (source.mode === 'provider-hard-cap') !== (source.providerHardCapUsd === 0)
    || (source.mode === 'free-fail-closed') !== (source.billingPlan === 'free' && source.quotaExhaustion === 'deny')
    || source.mode === 'non-billable' && (source.billingPlan !== 'none' || source.quotaExhaustion !== 'not-applicable')
    || source.mode === 'provider-hard-cap' && source.quotaExhaustion !== 'not-applicable'
    || source.paidPlanActive !== false || source.addOnsActive !== false
    || source.overagesEnabled !== false || source.autoUpgradeEnabled !== false
    || Date.parse(expiresAt) <= Date.parse(verifiedAt)) fail('verified cost evidence shape is invalid');
  return freeze({ ...source, provider: text(source.provider, 'verified cost evidence provider'),
    verifiedAt, expiresAt, evidenceDigest: digest(source.evidenceDigest, 'verified cost evidence evidenceDigest'),
    scopeDigest: digest(source.scopeDigest, 'verified cost evidence scopeDigest') });
}
function evidenceMatches(verification, evidence) {
  return ['provider', 'mode', 'billingPlan', 'providerHardCapUsd', 'quotaExhaustion',
    'paidPlanActive', 'addOnsActive', 'overagesEnabled', 'autoUpgradeEnabled', 'evidenceDigest',
    'scopeDigest'].every((field) => verification[field] === evidence[field]);
}
export function validateStoredEffectCostEvidence(plan, request, value, transitionedAt) {
  const proof = validateEffectCostEvidenceVerification(value), evidence = plan.costEvidence;
  const effectTime = Date.parse(instant(transitionedAt, 'effect transition time'));
  if (!evidenceMatches(proof, evidence) || Date.parse(proof.verifiedAt) < Date.parse(request.observedAt)
    || Date.parse(proof.verifiedAt) > effectTime || Date.parse(proof.expiresAt) < Date.parse(request.expiresAt)
    || Date.parse(proof.expiresAt) > Date.parse(evidence.expiresAt) || effectTime >= Date.parse(proof.expiresAt))
    fail('stored cost verification does not cover this exact effect and authorization window');
  return proof;
}
function runtime(options, label) {
  const source = options ?? {};
  exact(source, ['now', 'verifyCostEvidence'], `${label} options`, false);
  if (typeof source.now !== 'function' || typeof source.verifyCostEvidence !== 'function')
    fail(`${label} requires a trusted clock and provider cost evidence verifier`);
  let prior = null;
  const now = () => {
    const value = source.now();
    if (!Number.isSafeInteger(value) || value < 0 || prior !== null && value < prior)
      fail(`${label} trusted clock is invalid or moved backwards`);
    prior = value;
    return value;
  };
  return { now, verifyCostEvidence: source.verifyCostEvidence };
}
function inWindow(value, start, end, label) {
  if (value < Date.parse(start) || value >= Date.parse(end)) fail(`${label} is outside its validity window`);
}
/** Recheck the provider immediately before effect authority and retain that check's exact window. */
export async function verifyEffectCostEvidence(plan, request, options) {
  const trusted = runtime(options, 'effect cost verification'), evidence = plan.costEvidence;
  const before = trusted.now();
  inWindow(before, request.observedAt, request.expiresAt, 'effect cost verification');
  if (Date.parse(evidence.expiresAt) < Date.parse(request.expiresAt))
    fail('effect cost evidence expires before the exact authorization window');
  const supplied = await trusted.verifyCostEvidence(freeze({ evidence, plan, request,
    observedAt: new Date(before).toISOString() }));
  const checkedAt = trusted.now();
  inWindow(checkedAt, request.observedAt, request.expiresAt, 'effect cost verification');
  const proof = validateEffectCostEvidenceVerification(supplied);
  if (!evidenceMatches(proof, evidence) || Date.parse(proof.verifiedAt) < before
    || Date.parse(proof.verifiedAt) > checkedAt || Date.parse(proof.expiresAt) < Date.parse(request.expiresAt)
    || Date.parse(proof.expiresAt) > Date.parse(evidence.expiresAt))
    fail('provider cost evidence is not current or does not cover the exact effect window');
  return proof;
}
