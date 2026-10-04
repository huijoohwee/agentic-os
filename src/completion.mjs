/** Canonical effect plans and authenticated, current lifecycle operation receipts. */
import { createHash } from 'node:crypto';
import { canonicalJson, createAuthorityTransitionReceiptEnvelope, governanceDigest,
  validateAuthorityTransitionReceiptEnvelope, validateCoordinationRequest } from './governance.mjs';
import { cleanupRecordExact as exact, cleanupRecordDigest as digest,
  cleanupRecordFields as typedFields, cleanupRecordCanonical as canonicalRecord, freezeCleanupRecord as freeze } from './cleanup-records.mjs';
export const EFFECT_PLAN_SCHEMA = 'agentic-os/effect-plan/v1';
export const AUTHENTICATED_TRANSITION_SCHEMA =
  'agentic-os/authenticated-transition-operation-receipt/v1';
const EFFECT = /^[a-z][a-z0-9-]{0,127}$/u;
const PLAN_REFERENCE = /^effect-plan:sha256:([0-9a-f]{64})$/u;
const PLAN_KEYS = Object.freeze([
  'schema', 'target', 'authority', 'candidateDigest', 'snapshotDigest', 'effectClass',
  'allowedEffects', 'forbiddenEffects', 'parametersDigest', 'planDigest']);
const TARGET_KEYS = Object.freeze(['repository', 'resource', 'immutableRevision']);
const GRANT_KEYS = Object.freeze([
  'adapter', 'authenticatedSubject', 'providerRecordLocator', 'providerRecordDigest',
  'requestDigest', 'requestedTransition', 'planDigest', 'planByteDigest',
  'sourceClaimId', 'sourceLeaseEpoch', 'sourceFenceRevision', 'resultClaimId',
  'resultLeaseEpoch', 'resultFenceRevision', 'resultState', 'operationReceiptDigest',
  'transitionedAt', 'verifiedAt', 'expiresAt']);
const AUTHORITY_KEYS = Object.freeze([
  'requestedTransition', 'authoritySubject', 'ownerSubject', 'claimId', 'leaseEpoch',
  'fenceRevision', 'writeSetDigest', 'reviewLocator', 'predecessorDigest']);
function fail(message) { throw new TypeError(message); }
function snapshot(value) { return JSON.parse(canonicalJson(value)); }
function text(value, label) {
  if (typeof value !== 'string' || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a bounded non-empty string`);
  }
  return value;
}
function optionalText(value, label) { return value === null ? null : text(value, label); }
function instant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) {
    fail(`${label} must be an exact UTC instant`);
  }
  return result;
}
function adapter(value) {
  exact(value, ['id', 'version'], 'authority adapter');
  return typedFields(value, 'id version', text, 'authority adapter ');
}
function strings(value, label, { nonempty = false } = {}) {
  if (!Array.isArray(value) || nonempty && value.length === 0) fail(`${label} must be an array`);
  const result = value.map((entry) => text(entry, label)).sort();
  if (new Set(result).size !== result.length
    || result.some((entry) => !EFFECT.test(entry))) {
    fail(`${label} must be canonical, duplicate-free effect names`);
  }
  return result;
}
function target(value) {
  exact(value, TARGET_KEYS, 'effect plan target');
  return {
    repository: text(value.repository, 'effect plan target repository'),
    resource: text(value.resource, 'effect plan target resource'),
    immutableRevision: text(value.immutableRevision, 'effect plan immutable revision'),
  };
}
function authority(value) {
  exact(value, AUTHORITY_KEYS, 'effect plan authority');
  if (!['claim', 'continue', 'integrate', 'retire'].includes(value.requestedTransition)) {
    fail('effect plan requestedTransition is invalid');
  }
  if (!Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 1) {
    fail('effect plan leaseEpoch must be a positive safe integer');
  }
  const fenceRevision = value.fenceRevision === null ? null
    : digest(value.fenceRevision, 'effect plan fenceRevision');
  if ((value.requestedTransition === 'claim') !== (fenceRevision === null)) {
    fail('only an initial claim may omit the effect plan fenceRevision');
  }
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
  if (source.schema !== undefined && source.schema !== EFFECT_PLAN_SCHEMA)
    fail('effect plan schema is invalid');
  const allowedEffects = strings(source.allowedEffects, 'allowedEffects', { nonempty: true });
  const forbiddenEffects = strings(source.forbiddenEffects, 'forbiddenEffects');
  if (allowedEffects.some((entry) => forbiddenEffects.includes(entry)))
    fail('allowedEffects and forbiddenEffects must be disjoint');
  const payload = {
    schema: EFFECT_PLAN_SCHEMA,
    target: target(source.target),
    authority: authority(source.authority),
    ...typedFields(source, 'candidateDigest snapshotDigest parametersDigest', digest),
    effectClass: text(source.effectClass, 'effectClass'),
    allowedEffects,
    forbiddenEffects,
  };
  if (!EFFECT.test(payload.effectClass)) fail('effectClass must be a canonical effect name');
  const planDigest = governanceDigest(payload);
  if (source.planDigest !== undefined && digest(source.planDigest, 'planDigest') !== planDigest) {
    fail('planDigest does not match effect plan');
  }
  return freeze({ ...payload, planDigest });
}
export const validateEffectPlan = value =>
  canonicalRecord(value, createEffectPlan, 'effect plan', 'effect plan is not canonical');
export function encodeEffectPlan(value) {
  return Buffer.from(canonicalJson(validateEffectPlan(value)), 'utf8');
}
function planBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail('effect plan bytes must be a byte array');
  }
  const bytes = Buffer.from(value);
  if (bytes.length === 0 || bytes.length > 500_000) fail('effect plan bytes exceed byte bounds');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('effect plan bytes must be exact UTF-8 JSON'); }
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
    if (!Number.isSafeInteger(value) || value < 0 || prior !== null && value < prior) {
      fail(`${label} trusted clock is invalid or moved backwards`);
    }
    prior = value;
    return value;
  };
}
function trustedClock(options, label) {
  const source = options ?? {};
  exact(source, ['now'], `${label} options`);
  return currentClock(source.now, label);
}
function inWindow(value, start, end, label) {
  if (value < Date.parse(start) || value >= Date.parse(end)) fail(`${label} is outside its validity window`);
}
function exactPlanReference(request, byteDigest) {
  const references = request.dependentWork.map((entry) => entry.match(PLAN_REFERENCE))
    .filter(Boolean);
  if (references.length !== 1 || references[0][1] !== byteDigest) {
    fail('request must contain exactly the matching effect-plan byte digest');
  }
}
function fieldsMatch(left, right, names) {
  return names.split(' ').every(name => left[name] === right[name]);
}
function planMatchesRequest(plan, request) {
  return fieldsMatch(plan.target, request, 'repository immutableRevision')
    && fieldsMatch(plan.authority, request, 'requestedTransition authoritySubject ownerSubject ' +
      'claimId leaseEpoch fenceRevision writeSetDigest reviewLocator');
}
function authorityGrant(value) {
  const source = snapshot(value);
  exact(source, GRANT_KEYS, 'authenticated transition grant');
  if (!['integrate', 'retire'].includes(source.requestedTransition)) {
    fail('authenticated transition grant operation is invalid');
  }
  for (const field of ['sourceLeaseEpoch', 'resultLeaseEpoch']) {
    if (!Number.isSafeInteger(source[field]) || source[field] < 1) {
      fail(`grant.${field} must be a positive safe integer`);
    }
  }
  const transitionedAt = instant(source.transitionedAt, 'grant.transitionedAt');
  const verifiedAt = instant(source.verifiedAt, 'grant.verifiedAt');
  const expiresAt = instant(source.expiresAt, 'grant.expiresAt');
  if (Date.parse(transitionedAt) > Date.parse(verifiedAt)
    || Date.parse(expiresAt) <= Date.parse(verifiedAt)) {
    fail('grant operation, verification, and expiry times are invalid');
  }
  return freeze({ ...source, adapter: adapter(source.adapter),
    ...typedFields(source, 'authenticatedSubject providerRecordLocator', text),
    providerRecordDigest: digest(source.providerRecordDigest, 'providerRecordDigest'),
    ...typedFields(source, 'requestDigest planDigest planByteDigest sourceClaimId ' +
      'sourceFenceRevision resultClaimId resultFenceRevision', digest, 'grant.'),
    resultState: text(source.resultState, 'grant.resultState'),
    operationReceiptDigest: digest(source.operationReceiptDigest, 'operationReceiptDigest'),
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
  const now = historicalReplay ? null : trustedClock(options, 'authenticated transition');
  const before = historicalReplay ? null : now();
  if (!historicalReplay)
    inWindow(before, request.observedAt, request.expiresAt, 'authenticated transition');
  const grant = authorityGrant(await verifyAuthority(freeze({
    request, plan: planned.plan, planByteDigest: planned.byteDigest,
  })));
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
export function createAuthenticatedTransitionOperationReceipt(input, verifyAuthority, options) {
  return authenticatedTransitionReceipt(input, verifyAuthority, options, false);
}
/** Reconstruct an already-published exact immutable winner; this API authorizes no new effect. */
export function replayAuthenticatedTransitionOperationReceipt(input, verifyAuthority) {
  return authenticatedTransitionReceipt(input, verifyAuthority, undefined, true);
}
export function validateAuthenticatedTransitionOperationReceipt(value) {
  const source = snapshot(value);
  const keys = ['schema', 'requestDigest', 'requestedTransition', 'planDigest',
    'planByteDigest', 'authorityOperation', 'transitionReceipt', 'receiptDigest'];
  exact(source, keys, 'authenticated transition operation receipt');
  if (source.schema !== AUTHENTICATED_TRANSITION_SCHEMA
    || !['integrate', 'retire'].includes(source.requestedTransition)) {
    fail('authenticated transition operation receipt semantics are invalid');
  }
  for (const field of ['requestDigest', 'planDigest', 'planByteDigest', 'receiptDigest']) {
    digest(source[field], field);
  }
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
