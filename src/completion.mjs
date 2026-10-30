/** Canonical effect plans and authenticated, current lifecycle operation receipts. */
import { createHash } from 'node:crypto';
import { canonicalJson, createAuthorityTransitionReceiptEnvelope, governanceDigest,
  validateAuthorityTransitionReceiptEnvelope, validateCoordinationRequest } from './governance.mjs';
import { cleanupRecordExact as exact, cleanupRecordDigest as digest, cleanupRecordFields as typedFields,
  cleanupRecordCanonical as canonicalRecord, freezeCleanupRecord as freeze,
  createWorktreeCleanupContinuation, deriveCleanupOwnerStateDigest,
  validateWorktreeCleanupContinuation, validateWorktreeCleanupPlan, validateRetentionDispositionReceipt,
  worktreeCleanupPlanByteDigest } from './cleanup-records.mjs';
import { EFFECT_COST_POLICY, effectCostScopeDigest, normalizeEffectCostEvidence,
  validateEffectCostEvidenceVerification, validateStoredEffectCostEvidence,
  verifyEffectCostEvidence } from './effect-cost.mjs';
export { EFFECT_COST_POLICY, effectCostScopeDigest, validateEffectCostEvidenceVerification, verifyEffectCostEvidence } from './effect-cost.mjs';
export const EFFECT_PLAN_SCHEMA = 'agentic-os/effect-plan/v4';
export { VERIFIED_EFFECT_COST_EVIDENCE_SCHEMA } from './effect-cost.mjs';
export const AUTHENTICATED_TRANSITION_SCHEMA =
  'agentic-os/authenticated-transition-operation-receipt/v2';
const EFFECT = /^[a-z][a-z0-9-]{0,127}$/u;
const PLAN_REFERENCE = /^effect-plan:sha256:([0-9a-f]{64})$/u;
const PLAN_KEYS = Object.freeze(['schema', 'target', 'authority', 'candidateDigest', 'snapshotDigest', 'effectClass', 'allowedEffects', 'forbiddenEffects', 'parametersDigest', 'costEvidence', 'costPolicy', 'planDigest']);
const TARGET_KEYS = Object.freeze(['repository', 'resource', 'immutableRevision']);
const GRANT_KEYS = Object.freeze(['adapter', 'authenticatedSubject', 'providerRecordLocator', 'providerRecordDigest',
  'requestDigest', 'requestedTransition', 'planDigest', 'planByteDigest', 'sourceClaimId', 'sourceLeaseEpoch',
  'sourceFenceRevision', 'resultClaimId', 'resultLeaseEpoch', 'resultFenceRevision', 'resultState',
  'operationReceiptDigest', 'costEvidenceVerification', 'transitionedAt', 'verifiedAt', 'expiresAt']);
const AUTHORITY_KEYS = Object.freeze(['requestedTransition', 'authoritySubject', 'ownerSubject', 'claimId',
  'leaseEpoch', 'fenceRevision', 'writeSetDigest', 'reviewLocator', 'predecessorDigest']);
function fail(message) { throw new TypeError(message); }
function snapshot(value) { return JSON.parse(canonicalJson(value)); }
function text(value, label) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`);
  return value;
}
function optionalText(value, label) { return value === null ? null : text(value, label); }
function instant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) fail(`${label} must be an exact UTC instant`);
  return result;
}
function adapter(value) {
  exact(value, ['id', 'version'], 'authority adapter');
  return typedFields(value, 'id version', text, 'authority adapter ');
}
function strings(value, label, { nonempty = false } = {}) {
  if (!Array.isArray(value) || nonempty && value.length === 0) fail(`${label} must be an array`);
  const result = value.map((entry) => text(entry, label)).sort();
  if (new Set(result).size !== result.length || result.some((entry) => !EFFECT.test(entry))) fail(`${label} must be canonical, duplicate-free effect names`);
  return result;
}
function target(value) {
  exact(value, TARGET_KEYS, 'effect plan target');
  return { repository: text(value.repository, 'effect plan target repository'),
    resource: text(value.resource, 'effect plan target resource'), immutableRevision: text(value.immutableRevision, 'effect plan immutable revision') };
}
function authority(value) {
  exact(value, AUTHORITY_KEYS, 'effect plan authority');
  if (!['claim', 'continue', 'integrate', 'retire'].includes(value.requestedTransition)) fail('effect plan requestedTransition is invalid');
  if (!Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 1) fail('effect plan leaseEpoch must be a positive safe integer');
  const fenceRevision = value.fenceRevision === null ? null : digest(value.fenceRevision, 'effect plan fenceRevision');
  if ((value.requestedTransition === 'claim') !== (fenceRevision === null)) fail('only an initial claim may omit the effect plan fenceRevision');
  return {
    requestedTransition: value.requestedTransition,
    ...typedFields(value, 'authoritySubject ownerSubject', text, 'effect plan '),
    ...typedFields(value, 'claimId writeSetDigest predecessorDigest', digest, 'effect plan '),
    leaseEpoch: value.leaseEpoch,
    fenceRevision,
    reviewLocator: optionalText(value.reviewLocator, 'effect plan reviewLocator'),
  };
}
/** Create the semantic plan. Its exact canonical bytes have a separate transport digest. */
export function createEffectPlan(input) {
  const source = snapshot(input);
  exact(source, PLAN_KEYS, 'effect plan input', false);
  if (source.schema !== undefined && source.schema !== EFFECT_PLAN_SCHEMA
    || source.costPolicy !== undefined && canonicalJson(source.costPolicy) !== canonicalJson(EFFECT_COST_POLICY)) fail('effect plan schema or zero-cost policy is invalid');
  const allowedEffects = strings(source.allowedEffects, 'allowedEffects', { nonempty: true });
  const forbiddenEffects = strings(source.forbiddenEffects, 'forbiddenEffects');
  if (allowedEffects.some((entry) => forbiddenEffects.includes(entry))) fail('allowedEffects and forbiddenEffects must be disjoint');
  const payload = {
    schema: EFFECT_PLAN_SCHEMA,
    target: target(source.target),
    authority: authority(source.authority),
    ...typedFields(source, 'candidateDigest snapshotDigest', digest),
    effectClass: text(source.effectClass, 'effectClass'),
    allowedEffects,
    forbiddenEffects,
    parametersDigest: digest(source.parametersDigest, 'parametersDigest'),
  };
  if (!EFFECT.test(payload.effectClass)) fail('effectClass must be a canonical effect name');
  payload.costEvidence = normalizeEffectCostEvidence(source.costEvidence, effectCostScopeDigest(payload));
  payload.costPolicy = EFFECT_COST_POLICY;
  const planDigest = governanceDigest(payload);
  if (source.planDigest !== undefined && digest(source.planDigest, 'planDigest') !== planDigest) fail('planDigest does not match effect plan');
  return freeze({ ...payload, planDigest });
}
export const validateEffectPlan = value =>
  canonicalRecord(value, createEffectPlan, 'effect plan', 'effect plan is not canonical');
export function encodeEffectPlan(value) {
  return Buffer.from(canonicalJson(validateEffectPlan(value)), 'utf8');
}
function planBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail('effect plan bytes must be a byte array');
  const bytes = Buffer.from(value);
  if (bytes.length === 0 || bytes.length > 500_000) fail('effect plan bytes exceed byte bounds');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('effect plan bytes must be exact UTF-8 JSON'); }
  const plan = validateEffectPlan(parsed), encoded = encodeEffectPlan(plan);
  if (!bytes.equals(encoded)) fail('effect plan bytes are not exact canonical bytes');
  return { bytes, plan, byteDigest: createHash('sha256').update(bytes).digest('hex') };
}
export const validateEffectPlanBytes = (value) => planBytes(value).plan;
export const effectPlanByteDigest = (value) => planBytes(value).byteDigest;
function currentClock(now, label) {
  if (typeof now !== 'function') fail(`${label} requires a trusted clock`);
  let prior = null;
  return () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || prior !== null && value < prior) fail(`${label} trusted clock is invalid or moved backwards`);
    prior = value;
    return value;
  };
}
function inWindow(value, start, end, label) { if (value < Date.parse(start) || value >= Date.parse(end)) fail(`${label} is outside its validity window`); }
function exactPlanReference(request, byteDigest) {
  const references = request.dependentWork.map((entry) => entry.match(PLAN_REFERENCE)).filter(Boolean);
  if (references.length !== 1 || references[0][1] !== byteDigest) fail('request must contain exactly the matching effect-plan byte digest');
}
function fieldsMatch(left, right, names) {
  return names.split(' ').every(name => left[name] === right[name]);
}
function planMatchesRequest(plan, request) {
  return fieldsMatch(plan.target, request, 'repository immutableRevision')
    && fieldsMatch(plan.authority, request, 'requestedTransition authoritySubject ownerSubject claimId leaseEpoch fenceRevision writeSetDigest reviewLocator');
}
function authorityGrant(value, expectedCostEvidence = null) {
  const source = snapshot(value);
  exact(source, GRANT_KEYS, 'authenticated transition grant');
  if (!['integrate', 'retire'].includes(source.requestedTransition)) fail('authenticated transition grant operation is invalid');
  for (const field of ['sourceLeaseEpoch', 'resultLeaseEpoch']) {
    if (!Number.isSafeInteger(source[field]) || source[field] < 1) fail(`grant.${field} must be a positive safe integer`);
  }
  const transitionedAt = instant(source.transitionedAt, 'grant.transitionedAt');
  const verifiedAt = instant(source.verifiedAt, 'grant.verifiedAt');
  const expiresAt = instant(source.expiresAt, 'grant.expiresAt');
  if (Date.parse(transitionedAt) > Date.parse(verifiedAt) || Date.parse(expiresAt) <= Date.parse(verifiedAt)) fail('grant operation, verification, and expiry times are invalid');
  const verifiedCost = validateEffectCostEvidenceVerification(source.costEvidenceVerification);
  if (expectedCostEvidence !== null && canonicalJson(verifiedCost) !== canonicalJson(expectedCostEvidence))
    fail('provider authority grant omitted or changed the zero-cost verification receipt');
  return freeze({ ...source, adapter: adapter(source.adapter),
    ...typedFields(source, 'authenticatedSubject providerRecordLocator', text),
    providerRecordDigest: digest(source.providerRecordDigest, 'providerRecordDigest'),
    ...typedFields(source, 'requestDigest planDigest planByteDigest sourceClaimId ' +
      'sourceFenceRevision resultClaimId resultFenceRevision', digest, 'grant.'),
    resultState: text(source.resultState, 'grant.resultState'),
    operationReceiptDigest: digest(source.operationReceiptDigest, 'operationReceiptDigest'),
    costEvidenceVerification: verifiedCost,
    transitionedAt, verifiedAt, expiresAt });
}
/** Create integrate/retire receipts only through an injected provider-authenticating verifier. */
async function authenticatedTransitionReceipt(input, verifyAuthority, options, historicalReplay) {
  exact(input, ['request', 'planBytes'], 'authenticated transition input');
  if (typeof verifyAuthority !== 'function') fail('authenticated transition verifier is required');
  const request = validateCoordinationRequest(input.request);
  if (!['integrate', 'retire'].includes(request.requestedTransition)) {
    fail('authenticated transition supports only integrate or retire');
  }
  const planned = planBytes(input.planBytes);
  exactPlanReference(request, planned.byteDigest);
  if (!planMatchesRequest(planned.plan, request)) {
    fail('transition request does not match the exact effect plan target');
  }
  const now = historicalReplay ? null : currentClock(options?.now, 'authenticated transition');
  const before = historicalReplay ? null : now();
  if (!historicalReplay) inWindow(before, request.observedAt, request.expiresAt, 'authenticated transition');
  const costVerification = historicalReplay ? null
    : await verifyEffectCostEvidence(planned.plan, request, options);
  const grant = authorityGrant(await verifyAuthority(freeze({ request, plan: planned.plan,
    planByteDigest: planned.byteDigest, ...(costVerification === null ? {} : { costEvidenceVerification: costVerification }) })), costVerification);
  validateStoredEffectCostEvidence(planned.plan, request, grant.costEvidenceVerification,
    grant.transitionedAt);
  const after = historicalReplay ? null : now();
  if (!historicalReplay)
    inWindow(after, request.observedAt, request.expiresAt, 'authenticated transition');
  if (grant.requestDigest !== request.requestDigest
    || grant.requestedTransition !== request.requestedTransition
    || grant.planDigest !== planned.plan.planDigest || grant.planByteDigest !== planned.byteDigest
    || grant.authenticatedSubject !== request.authoritySubject
    || grant.sourceClaimId !== request.claimId || grant.sourceLeaseEpoch !== request.leaseEpoch
    || grant.sourceFenceRevision !== request.fenceRevision
    || grant.resultLeaseEpoch !== request.leaseEpoch + 1
    || Date.parse(grant.transitionedAt) < Date.parse(request.observedAt)
    || !historicalReplay && Date.parse(grant.verifiedAt) > after
    || Date.parse(grant.expiresAt) > Date.parse(request.expiresAt)
    || !historicalReplay && after >= Date.parse(grant.expiresAt)) {
    fail('authenticated transition grant does not match the request, plan, source, or window');
  }
  const transitionReceipt = createAuthorityTransitionReceiptEnvelope(request, {
    resultClaimId: grant.resultClaimId,
    resultLeaseEpoch: grant.resultLeaseEpoch,
    resultFenceRevision: grant.resultFenceRevision,
    resultState: grant.resultState,
    operationReceiptDigest: grant.operationReceiptDigest,
    transitionedAt: grant.transitionedAt,
  });
  const payload = {
    schema: AUTHENTICATED_TRANSITION_SCHEMA,
    requestDigest: request.requestDigest,
    requestedTransition: request.requestedTransition,
    planDigest: planned.plan.planDigest,
    planByteDigest: planned.byteDigest,
    authorityOperation: grant,
    transitionReceipt,
  };
  return freeze({ ...payload, receiptDigest: governanceDigest(payload) });
}
/** Create a first in-window receipt. The verifier may publish one create-only provider record. */
export function createAuthenticatedTransitionOperationReceipt(input, verifyAuthority, options) { return authenticatedTransitionReceipt(input, verifyAuthority, options, false); }
/** Reconstruct an already-published exact immutable winner; this API authorizes no new effect. */
export function replayAuthenticatedTransitionOperationReceipt(input, verifyAuthority) { return authenticatedTransitionReceipt(input, verifyAuthority, undefined, true); }
export function validateAuthenticatedTransitionOperationReceipt(value) {
  const source = snapshot(value);
  const keys = ['schema', 'requestDigest', 'requestedTransition', 'planDigest',
    'planByteDigest', 'authorityOperation', 'transitionReceipt', 'receiptDigest'];
  exact(source, keys, 'authenticated transition operation receipt');
  if (source.schema !== AUTHENTICATED_TRANSITION_SCHEMA || !['integrate', 'retire'].includes(source.requestedTransition)) fail('authenticated transition operation receipt semantics are invalid');
  for (const field of ['requestDigest', 'planDigest', 'planByteDigest', 'receiptDigest']) digest(source[field], field);
  const operation = authorityGrant(source.authorityOperation);
  const receipt = validateAuthorityTransitionReceiptEnvelope(source.transitionReceipt);
  if (!fieldsMatch(receipt, source, 'requestDigest requestedTransition')
    || !fieldsMatch(operation, source, 'requestDigest requestedTransition planDigest planByteDigest')
    || receipt.authoritySubject !== operation.authenticatedSubject
    || !fieldsMatch(receipt, operation, 'sourceClaimId sourceLeaseEpoch sourceFenceRevision')
    || receipt.resultClaimId !== receipt.sourceClaimId
    || receipt.resultLeaseEpoch !== receipt.sourceLeaseEpoch + 1
    || receipt.resultFenceRevision === receipt.sourceFenceRevision
    || !fieldsMatch(receipt, operation, 'resultClaimId resultLeaseEpoch resultFenceRevision ' +
      'resultState operationReceiptDigest transitionedAt')) {
    fail('authenticated transition operation receipt is internally inconsistent');
  }
  const { receiptDigest, ...payload } = source;
  if (governanceDigest(payload) !== receiptDigest) fail('authenticated receipt digest is invalid');
  return freeze(source);
}

/** Derive a bounded local cleanup continuation from exact authenticated lifecycle receipts. */ export function deriveCompletionCleanupContinuation(cleanup, now = Date.now) {
  const fail = (reason, message) => { throw Object.assign(new Error(message), { reason }); }, plan = validateWorktreeCleanupPlan(cleanup.plan), integration = validateAuthenticatedTransitionOperationReceipt(cleanup.integrationReceipt), retirement = validateAuthenticatedTransitionOperationReceipt(cleanup.retirementReceipt), retirementPlan = validateEffectPlanBytes(cleanup.retirementPlanBytes), integrated = integration.transitionReceipt, retired = retirement.transitionReceipt;
  if (integration.requestedTransition !== 'integrate' || integrated.resultState !== 'integrated' || retirement.requestedTransition !== 'retire' || retired.resultState !== 'retired' || retired.sourceClaimId !== integrated.resultClaimId || retired.sourceLeaseEpoch !== integrated.resultLeaseEpoch || retired.sourceFenceRevision !== integrated.resultFenceRevision) fail('blocked-cleanup-continuation-unjoined', 'continuation requires the exact integrated then retired receipt pair');
  const ownerStateDigest = deriveCleanupOwnerStateDigest({ claimId: integrated.resultClaimId, leaseEpoch: integrated.resultLeaseEpoch, fenceRevision: integrated.resultFenceRevision, state: integrated.resultState }), issuedAt = now(), expiresAt = Date.parse(plan.expiresAt);
  if (ownerStateDigest !== plan.ownerStateDigest || retirementPlan.planDigest !== retirement.planDigest || retirementPlan.target.repository !== plan.repository || retirementPlan.target.resource !== plan.targetPath || retirementPlan.target.immutableRevision !== plan.integratedImmutableRevision || retirementPlan.candidateDigest !== plan.candidateDigest || retirementPlan.snapshotDigest !== plan.snapshotDigest || retirementPlan.authority.predecessorDigest !== integration.receiptDigest || retirementPlan.authority.requestedTransition !== 'retire' || retirementPlan.authority.claimId !== retired.sourceClaimId || retirementPlan.authority.leaseEpoch !== retired.sourceLeaseEpoch || retirementPlan.authority.fenceRevision !== retired.sourceFenceRevision) fail('blocked-cleanup-continuation-unjoined', 'continuation does not join the exact cleanup plan and lifecycle receipts');
  if (!Number.isSafeInteger(issuedAt) || issuedAt < Date.parse(retirement.authorityOperation.transitionedAt) || issuedAt >= expiresAt) fail('blocked-cleanup-continuation-expired', 'continuation must issue after retirement and before the cleanup plan expires');
  const bindings = { authorityKind: 'retired-cleanup-continuation', repository: plan.repository, targetPath: plan.targetPath, integratedImmutableRevision: plan.integratedImmutableRevision, candidateDigest: plan.candidateDigest, snapshotDigest: plan.snapshotDigest, ownerStateDigest, retirementReceiptDigest: retirement.receiptDigest, priorCleanupPlanByteDigest: retirementPlan.parametersDigest, cleanupPlanDigest: plan.planDigest, cleanupPlanByteDigest: worktreeCleanupPlanByteDigest(plan) };
  if (cleanup.cleanupContinuation !== undefined && cleanup.cleanupContinuation !== null) { const continuation = validateWorktreeCleanupContinuation(cleanup.cleanupContinuation); if (Object.entries(bindings).some(([key, value]) => continuation[key] !== value) || Date.parse(continuation.issuedAt) < Date.parse(retirement.authorityOperation.transitionedAt) || Date.parse(continuation.issuedAt) > issuedAt || Date.parse(continuation.expiresAt) > expiresAt || Date.parse(continuation.expiresAt) <= issuedAt) fail('blocked-cleanup-continuation-unjoined', 'supplied continuation exceeds or differs from the exact receipt-bound cleanup plan'); return continuation; }
  return createWorktreeCleanupContinuation({ ...bindings, issuedAt: new Date(issuedAt).toISOString(), expiresAt: plan.expiresAt });
}

/** Bind the local shape of an exact integration/retirement pair; never authenticate or authorize it. */
export function bindRetirementOperationReceipts(integrationValue, retirementValue,
  { repository, reviewLocator, preservationReceipt } = {}) {
  const integration = validateAuthenticatedTransitionOperationReceipt(integrationValue);
  const retirement = validateAuthenticatedTransitionOperationReceipt(retirementValue);
  const integrated = integration.transitionReceipt, retired = retirement.transitionReceipt;
  const preservation = preservationReceipt?.disposition === 'standalone-lane-retained' ? validateRetentionDispositionReceipt(preservationReceipt) : preservationReceipt, standalone = preservation?.disposition === 'standalone-lane-retained';
  if (integration.requestedTransition !== 'integrate' || retirement.requestedTransition !== 'retire'
    || !preservation || preservation.repository !== repository
    || preservation.adoption?.reviewLocator !== reviewLocator
    || preservation.adoption?.merge !== integrated.immutableRevision
    || standalone && preservation.adoption.integrationReceiptDigest !== integration.receiptDigest
    || integrated.repository !== repository || retired.repository !== repository
    || integrated.reviewLocator !== reviewLocator
    || integrated.resultState !== 'integrated' || retired.resultState !== 'retired'
    || integrated.immutableRevision !== retired.immutableRevision
    || integrated.authoritySubject !== retired.authoritySubject
    || integrated.resultClaimId !== retired.sourceClaimId
    || integrated.resultLeaseEpoch !== retired.sourceLeaseEpoch
    || integrated.resultFenceRevision !== retired.sourceFenceRevision
    || retired.resultClaimId !== integrated.resultClaimId
    || retired.resultLeaseEpoch !== integrated.resultLeaseEpoch + 1) {
    throw new TypeError('retirement receipts do not bind the exact review, merge, or integration predecessor');
  }
  return Object.freeze({ schema: 'agentic-os/retirement-receipt-binding/v1', state: 'retired',
    integrationReceiptDigest: integration.receiptDigest, retirementReceiptDigest: retirement.receiptDigest,
    integratedRevision: integrated.immutableRevision, reviewLocator: integrated.reviewLocator,
    producerAuthorityVerified: false, grantsAuthority: false });
}

export const DELIVERY_DISPOSITION_SET_PATH = '.agentic-os-delivery-dispositions.json', DELIVERY_DISPOSITION_SET_SCHEMA = 'agentic-os/delivery-disposition-set/v1';
const DELIVERY_ROW_SCHEMA = 'agentic-os/delivery-disposition/v1', DELIVERY_SET_KEYS = ['schema', 'repository', 'dispositions', 'receiptDigest'];
const DELIVERY_ROW_KEYS = ['schema', 'ref', 'laneHead', 'paths', 'disposition', 'candidateRevision', 'candidateDigest', 'sourceReleaseReceiptDigest', 'deploymentReceiptDigest', 'runtimeVerificationReceiptDigest', 'evidencePath', 'evidenceDigest', 'decisionRef', 'reason'];
const DELIVERY_SHA1 = /^[0-9a-f]{40}$/u, DELIVERY_SHA256 = /^[0-9a-f]{64}$/u;
const deliveryFail = reason => { throw Object.assign(new TypeError('delivery disposition is invalid'), { reason: `blocked-delivery-disposition-${reason}` }); };
function deliveryPath(value, label) {
  text(value, label);
  if (value.trim() !== value || value.startsWith('/') || value.includes('\\') || value.includes(':') || value.split('/').some(part => !part || part === '.' || part === '..')) deliveryFail(`${label}-path`);
}
function deliveryRow(row) {
  exact(row, DELIVERY_ROW_KEYS, 'delivery row');
  if (row.schema !== DELIVERY_ROW_SCHEMA || !/^agent\/[a-z0-9][a-z0-9._/-]{0,180}$/u.test(row.ref) || !DELIVERY_SHA1.test(row.laneHead ?? '') || !DELIVERY_SHA1.test(row.candidateRevision ?? '')) deliveryFail('row-identity');
  if (!Array.isArray(row.paths) || !row.paths.length || row.paths.length > 512) deliveryFail('row-paths');
  row.paths.forEach(path => deliveryPath(path, 'row'));
  if (new Set(row.paths).size !== row.paths.length || canonicalJson(row.paths) !== canonicalJson([...row.paths].sort())) deliveryFail('row-path-order');
  if (!DELIVERY_SHA256.test(row.candidateDigest ?? '') || !DELIVERY_SHA256.test(row.evidenceDigest ?? '')) deliveryFail('row-digest');
  deliveryPath(row.evidencePath, 'evidence'); text(row.decisionRef, 'decision reference');
  let url; try { url = new URL(row.decisionRef); } catch { deliveryFail('decision-ref'); }
  if (url.protocol !== 'https:' || url.username || url.password) deliveryFail('decision-ref');
  const keys = ['sourceReleaseReceiptDigest', 'deploymentReceiptDigest', 'runtimeVerificationReceiptDigest'];
  if (row.disposition === 'deployed') {
    if (keys.some(key => !DELIVERY_SHA256.test(row[key] ?? '')) || row.reason !== null) deliveryFail('deployed-receipts');
  } else if (row.disposition === 'no-deploy') {
    if (keys.some(key => row[key] !== null)) deliveryFail('no-deploy-receipts');
    text(row.reason, 'no-deploy reason'); if (!row.reason.trim()) deliveryFail('no-deploy-reason');
  } else deliveryFail('disposition');
  return row;
}
const mixedNoDeployExclusion = (row, expected, evidence) => row.evidencePath !== DELIVERY_DISPOSITION_SET_PATH && [row.reason, evidence].every(text => /excluded from (?:the )?product artifact/iu.test(text) && expected.paths.every(path => text.includes(path)));
/** Source/path/evidence binding only; consumer validation never authenticates or authorizes the producer. */
export function validateDeliveryDispositionSet(value, expected) {
  try {
    const set = snapshot(value); exact(set, DELIVERY_SET_KEYS, 'delivery disposition set');
    if (set.schema !== DELIVERY_DISPOSITION_SET_SCHEMA || set.repository !== expected.repository || !Array.isArray(set.dispositions) || !set.dispositions.length || set.dispositions.length > 32 || !DELIVERY_SHA256.test(set.receiptDigest ?? '')) deliveryFail('set-identity');
    const { receiptDigest, ...body } = set;
    if (governanceDigest(body) !== receiptDigest) deliveryFail('set-digest'); const rows = set.dispositions.map(deliveryRow), refs = rows.map(row => row.ref);
    if (new Set(refs).size !== refs.length || canonicalJson(refs) !== canonicalJson([...refs].sort())) deliveryFail('set-order');
    const row = rows.find(item => item.ref === expected.ref);
    if (!row) return null;
    if (row.laneHead !== expected.laneHead || canonicalJson(row.paths) !== canonicalJson(expected.paths)) deliveryFail('lane-binding');
    if (!expected.candidateIsCurrent(row.candidateRevision) || !expected.laneIntegratedAtCandidate(row.candidateRevision, row.laneHead)) deliveryFail('candidate-stale');
    const evidence = expected.readEvidence(row.evidencePath);
    if (typeof evidence !== 'string' || Buffer.byteLength(evidence) > 128_000 || expected.sha256(evidence) !== row.evidenceDigest) deliveryFail('evidence-binding');
    if (row.disposition === 'deployed' ? ['docs-only', 'control-ledger-only', 'delivery-evidence-only'].includes(expected.changeClass) || !expected.deployBound(row.candidateRevision) : expected.changeClass !== 'docs-only' && !(expected.changeClass === 'control-ledger-only' && canonicalJson(expected.paths) === canonicalJson([DELIVERY_DISPOSITION_SET_PATH])) && !(expected.changeClass === 'delivery-evidence-only' && expected.paths.some(path => path.startsWith('docs/reports/')) && expected.paths.every(path => path === DELIVERY_DISPOSITION_SET_PATH || path.startsWith('docs/reports/')) && row.evidencePath !== DELIVERY_DISPOSITION_SET_PATH && /excluded from (?:the )?product artifact/iu.test(row.reason)) && !(expected.changeClass === 'mixed' && mixedNoDeployExclusion(row, expected, evidence))) deliveryFail('disposition-scope');
    return Object.freeze({ ...row, ...(expected.changeClass === 'mixed' && row.disposition === 'no-deploy' ? { scopeRule: 'mixed-path-artifact-exclusion' } : expected.changeClass === 'delivery-evidence-only' && row.disposition === 'no-deploy' ? { scopeRule: 'delivery-evidence-artifact-exclusion' } : {}), receiptDigest: governanceDigest(row), setDigest: receiptDigest, producerAuthorityVerified: false, authorizesEffects: false });
  } catch (error) { if (error?.reason?.startsWith('blocked-delivery-disposition-')) throw error; deliveryFail('invalid'); }
}
/** Project only an exact, current, read-only closeout when a lane is already settled or still pending. */
export function projectProgressiveCloseout(target, observed) {
  const closeout = observed?.closeout, base = { path: target.path, ref: target.branch,
    head: target.head, status: 'blocked' };
  const exact = observed?.ref === target.branch && observed?.authorizesEffects === false
    && observed?.lane?.path === target.path && observed?.lane?.head === target.head
    && observed?.lane?.mounted === true && observed?.lane?.clean === true
    && observed?.canonicalClean === true
    && observed?.canonicalRevision === observed?.remoteTrackingRevision
    && closeout?.schema === 'agentic-os/closeout-verdict/v1'
    && closeout?.observationOnly === true && closeout?.authorizesEffects === false
    && closeout?.canonicalCurrent === true
    && (closeout?.sourceState !== 'source_complete' || closeout?.sourceIntegrated === true);
  if (!exact) return { ...base, reason: 'requires-published-lane' };
  const adlcState = closeout.adlcState ?? (closeout.missionState === 'source_complete' ? 'complete' : null);
  const fields = { sourceState: closeout.sourceState, missionState: closeout.missionState ?? null,
    adlcState, retentionState: closeout.retentionState ?? null,
    deliveryState: closeout.deliveryState ?? null, completionScope: closeout.completionScope ?? null, branchDisposition: closeout.branchDisposition ?? null,
    nextAction: closeout.nextAction ?? null };
  if (closeout.sourceState !== 'source_complete') return { ...base, ...fields,
    reason: closeout.nextAction?.id ?? 'source-not-complete' };
  const settled = ['complete', 'source_complete', 'cleanup_pending', 'delivery_pending',
    'delivery_scope_pending', 'retirement_pending'].includes(adlcState) ? adlcState : null;
  return { ...base, ...fields, status: settled ?? 'blocked', adlcState: settled,
    reason: settled && ['complete', 'source_complete'].includes(settled) ? null : 'closeout-incomplete' };
}
