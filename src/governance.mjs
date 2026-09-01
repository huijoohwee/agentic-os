/** Provider-neutral governance records and four root operations. No I/O or clock. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { JsonSnapshotError, snapshotBoundedJson } from './catalog-input.mjs';
export const COORDINATION_REQUEST_SCHEMA = 'agentic-os/coordination-request/v1';
export const AUTHORITY_TRANSITION_RECEIPT_SCHEMA = 'agentic-os/authority-transition-receipt/v1';
export const REPOSITORY_PROFILE_SCHEMA = 'agentic-os/repository-profile/v1';
export const OPERATIONS = Object.freeze(['claim', 'continue', 'integrate', 'retire']);
const PROFILE_CAPABILITIES = new Set((
  'deep-byte-audit-opt-in history:linear host-qualified-repository-pin integration-method:squash ' +
  'protected-integration:pull-request read-only-repository-observation read-only-review-observation ' +
  'required-check-policy:strict retain-all-cleanup shallow-observation-default ' +
  'tested-protected-ordering:merge-queue'
).split(' '));
const PROVIDER_BOUND_CAPABILITIES = new Set((
  'history:linear host-qualified-repository-pin integration-method:squash protected-integration:pull-request ' +
  'read-only-review-observation required-check-policy:strict tested-protected-ordering:merge-queue'
).split(' '));
const DIGEST = /^[0-9a-f]{64}$/u, EFFECT_PLAN = /^effect-plan:sha256:[0-9a-f]{64}$/u;
const MAX_DEPTH = 16, MAX_NODES = 10_000, MAX_BYTES = 500_000;
const CLEANUP_KEYS = Object.freeze(['worktreeProjection', 'worktreeRegistration',
  'remoteTrackingRef', 'localBranch', 'remoteBranch', 'unreachableObjects']);
const REQUEST_KEYS = Object.freeze([
  'schema', 'repository', 'authoritySubject', 'ownerSubject', 'scope', 'writeSetDigest', 'claimId',
  'leaseEpoch', 'fenceRevision', 'immutableRevision', 'reviewLocator', 'blocker', 'requestedTransition',
  'dependentWork', 'replyLocator', 'observedAt', 'expiresAt', 'requestDigest']);
const RECEIPT_KEYS = Object.freeze([
  'schema', 'repository', 'authoritySubject', 'requestDigest', 'requestedTransition', 'sourceClaimId',
  'sourceLeaseEpoch', 'sourceFenceRevision', 'resultClaimId', 'resultLeaseEpoch', 'resultFenceRevision',
  'resultState', 'immutableRevision', 'reviewLocator', 'operationReceiptDigest', 'transitionedAt',
  'receiptDigest']);
const PROFILE_KEYS = Object.freeze([
  'schema', 'repository', 'canonical', 'adapters', 'requiredChecks', 'capabilities', 'authority',
  'cleanup', 'profileDigest']);
const RESULT_STATE = Object.freeze({ claim: 'current', continue: 'current',
  integrate: 'integrated', retire: 'retired' });
export const RETAIN_ALL_CLEANUP = Object.freeze(Object.fromEntries(
  CLEANUP_KEYS.map((key) => [key, 'retain'])));
export const CONSUMER_AUTHORITY = Object.freeze({ runtime: 'consumer', release: 'consumer' });
function fail(message) { throw new TypeError(message); }
const SNAPSHOT_ERRORS = Object.freeze({
  'node-budget': 'governance value exceeds node budget',
  'object-budget': 'governance value exceeds node budget',
  'array-budget': 'governance value exceeds node budget',
  'depth-budget': 'governance value exceeds depth budget',
  'string-budget': 'governance value exceeds byte budget',
  'aggregate-string-budget': 'governance value exceeds byte budget',
  'number-invalid': 'governance numbers must be finite',
  'json-alias-invalid': 'governance value contains an alias or cycle',
  'array-property-invalid': 'governance arrays must be dense data arrays',
  'sparse-array-invalid': 'governance arrays must be dense data arrays',
  'array-accessor-invalid': 'governance arrays cannot contain accessors',
  'object-accessor-invalid': 'governance objects cannot contain accessors',
  'nonenumerable-property-invalid': 'governance objects cannot contain accessors',
  'object-prototype-invalid': 'governance objects must be plain',
  'symbol-property-invalid': 'governance object keys must be strings',
});
function snapshot(value, budget = { nodes: 0, stringBytes: 0 }) {
  try {
    return snapshotBoundedJson(value, {
      maxDepth: MAX_DEPTH, maxNodes: MAX_NODES, maxStringBytes: MAX_BYTES,
      maxAggregateStringBytes: MAX_BYTES, maxArrayLength: MAX_NODES, maxObjectKeys: MAX_NODES,
      sortKeys: true, arrayBudgetCode: 'node-budget', budget,
    });
  } catch (error) {
    if (!(error instanceof JsonSnapshotError)) throw error;
    fail(SNAPSHOT_ERRORS[error.code] ?? 'governance value is not JSON data');
  }
}
export function canonicalJson(value) {
  const encoded = JSON.stringify(snapshot(value));
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) fail('governance value exceeds byte budget');
  return encoded;
}
export function governanceDigest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}
function exactKeys(value, keys, label, requireAll = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.some((key) => !keys.includes(key))
    || (requireAll && keys.some((key) => !Object.hasOwn(value, key))))
    fail(`${label} fields are invalid`);
}
function text(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 4096)
    fail(`${label} must be a bounded non-empty string`);
  return value;
}
function digest(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}
function instant(value, label) {
  text(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    fail(`${label} must be an exact UTC instant`);
  return value;
}
function strings(value, label, { nonempty = false } = {}) {
  const source = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(source) || (nonempty && source.length === 0)) fail(`${label} must be an array`);
  const result = source.map((entry) => text(entry, label)).sort();
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`);
  return result;
}
function cleanup(value = RETAIN_ALL_CLEANUP) {
  exactKeys(value, CLEANUP_KEYS, 'cleanup');
  const result = Object.fromEntries(CLEANUP_KEYS.map((key) => {
    if (value[key] !== 'retain') fail(`cleanup.${key} must retain consumer-owned state`);
    return [key, 'retain'];
  }));
  return result;
}
export function deriveCoordinationClaimId({ repository, authoritySubject, ownerSubject, scope }) { return governanceDigest({ schema: 'agentic-os/claim-id/v1', repository, authoritySubject, ownerSubject, scope }); }
function requestPayload(input, requestedOperation) {
  const source = snapshot(input);
  exactKeys(source, REQUEST_KEYS, 'Coordination Request input', false);
  if (source.schema !== undefined && source.schema !== COORDINATION_REQUEST_SCHEMA)
    fail('Coordination Request schema is invalid');
  const operation = requestedOperation ?? source.requestedTransition;
  if (!OPERATIONS.includes(operation)) fail('requestedTransition is invalid');
  if (source.requestedTransition !== undefined && source.requestedTransition !== operation)
    fail('requestedTransition does not match the root operation');
  const scope = strings(source.scope, 'scope', { nonempty: true });
  const writeSetDigest = governanceDigest(scope);
  if (source.writeSetDigest !== undefined && source.writeSetDigest !== writeSetDigest)
    fail('writeSetDigest does not match scope');
  const observedAt = instant(source.observedAt, 'observedAt');
  const expiresAt = instant(source.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) fail('expiresAt must be after observedAt');
  const identity = {
    repository: text(source.repository, 'repository'),
    authoritySubject: text(source.authoritySubject, 'authoritySubject'),
    ownerSubject: text(source.ownerSubject, 'ownerSubject'),
    scope,
  };
  const dependentWork = strings(source.dependentWork ?? [], 'dependentWork');
  if (operation === 'retire' && !dependentWork.some((item) => EFFECT_PLAN.test(item)))
    fail('retire requires a digest-bound effect-plan reference');
  const claimId = source.claimId ?? deriveCoordinationClaimId(identity);
  const payload = {
    schema: COORDINATION_REQUEST_SCHEMA,
    ...identity,
    writeSetDigest,
    claimId: digest(claimId, 'claimId'),
    leaseEpoch: source.leaseEpoch ?? 1,
    fenceRevision: digest(source.fenceRevision ?? null, 'fenceRevision', true),
    immutableRevision: text(source.immutableRevision, 'immutableRevision'),
    reviewLocator: text(source.reviewLocator ?? null, 'reviewLocator', true),
    blocker: text(source.blocker ?? null, 'blocker', true),
    requestedTransition: operation,
    dependentWork,
    replyLocator: text(source.replyLocator ?? null, 'replyLocator', true),
    observedAt,
    expiresAt,
  };
  if (!Number.isSafeInteger(payload.leaseEpoch) || payload.leaseEpoch < 1)
    fail('leaseEpoch must be a positive safe integer');
  if (operation === 'claim' && payload.fenceRevision !== null) fail('claim cannot assert a source fence');
  if (operation !== 'claim' && payload.fenceRevision === null) fail(`${operation} requires a fenceRevision`);
  return payload;
}
export function createCoordinationRequest(input, operation) {
  const source = snapshot(input);
  const payload = requestPayload(source, operation);
  const requestDigest = governanceDigest(payload);
  if (source.requestDigest !== undefined && source.requestDigest !== requestDigest)
    fail('requestDigest does not match the Coordination Request');
  return frozen({ ...payload, requestDigest });
}
export function validateCoordinationRequest(value) {
  const source = snapshot(value);
  exactKeys(source, REQUEST_KEYS, 'Coordination Request');
  if (source.schema !== COORDINATION_REQUEST_SCHEMA) fail('Coordination Request schema is invalid');
  const normalized = createCoordinationRequest(source, source.requestedTransition);
  if (canonicalJson(source) !== canonicalJson(normalized)) fail('Coordination Request is not canonical');
  return normalized;
}
export function createAuthorityTransitionReceiptEnvelope(requestValue, outcome) {
  const request = validateCoordinationRequest(requestValue);
  const source = snapshot(outcome);
  const keys = [
    'resultClaimId', 'resultLeaseEpoch', 'resultFenceRevision', 'resultState', 'operationReceiptDigest',
    'transitionedAt'];
  exactKeys(source, keys, 'Authority Transition outcome');
  if (source.resultState !== RESULT_STATE[request.requestedTransition])
    fail('resultState does not match the requested transition');
  const initial = request.requestedTransition === 'claim';
  const resultClaimId = digest(source.resultClaimId, 'resultClaimId');
  const resultFenceRevision = digest(source.resultFenceRevision, 'resultFenceRevision');
  const transitionedAt = instant(source.transitionedAt, 'transitionedAt');
  const at = Date.parse(transitionedAt);
  if (at < Date.parse(request.observedAt) || at > Date.parse(request.expiresAt))
    fail('transitionedAt is outside the request validity window');
  if (resultClaimId !== request.claimId) fail('resultClaimId must preserve claim identity');
  if (initial ? source.resultLeaseEpoch !== request.leaseEpoch
    : source.resultLeaseEpoch <= request.leaseEpoch)
    fail('resultLeaseEpoch does not advance the requested transition');
  if (!initial && resultFenceRevision === request.fenceRevision)
    fail('resultFenceRevision must advance the requested transition');
  const payload = {
    schema: AUTHORITY_TRANSITION_RECEIPT_SCHEMA,
    repository: request.repository,
    authoritySubject: request.authoritySubject,
    requestDigest: request.requestDigest,
    requestedTransition: request.requestedTransition,
    sourceClaimId: initial ? null : request.claimId,
    sourceLeaseEpoch: initial ? null : request.leaseEpoch,
    sourceFenceRevision: initial ? null : request.fenceRevision,
    resultClaimId,
    resultLeaseEpoch: source.resultLeaseEpoch,
    resultFenceRevision,
    resultState: source.resultState,
    immutableRevision: request.immutableRevision,
    reviewLocator: request.reviewLocator,
    operationReceiptDigest: digest(source.operationReceiptDigest, 'operationReceiptDigest'),
    transitionedAt,
  };
  if (!Number.isSafeInteger(payload.resultLeaseEpoch) || payload.resultLeaseEpoch < 1)
    fail('resultLeaseEpoch must be a positive safe integer');
  return frozen({ ...payload, receiptDigest: governanceDigest(payload) });
}
export function validateAuthorityTransitionReceiptEnvelope(value) {
  const receipt = snapshot(value);
  exactKeys(receipt, RECEIPT_KEYS, 'Authority Transition Receipt');
  if (receipt.schema !== AUTHORITY_TRANSITION_RECEIPT_SCHEMA
    || !OPERATIONS.includes(receipt.requestedTransition)
    || receipt.resultState !== RESULT_STATE[receipt.requestedTransition]) {
    fail('Authority Transition Receipt semantics are invalid');
  }
  for (const [field, nullable] of [
    ['requestDigest', false], ['sourceClaimId', true], ['sourceFenceRevision', true],
    ['resultClaimId', false], ['resultFenceRevision', false], ['operationReceiptDigest', false],
    ['receiptDigest', false]]) digest(receipt[field], field, nullable);
  text(receipt.repository, 'repository');
  text(receipt.authoritySubject, 'authoritySubject');
  text(receipt.immutableRevision, 'immutableRevision');
  text(receipt.reviewLocator, 'reviewLocator', true);
  instant(receipt.transitionedAt, 'transitionedAt');
  const initial = receipt.requestedTransition === 'claim';
  if (initial !== (receipt.sourceClaimId === null
    && receipt.sourceLeaseEpoch === null && receipt.sourceFenceRevision === null)) {
    fail('Authority Transition Receipt source identity is invalid');
  }
  if (!initial && (receipt.sourceClaimId === null || receipt.sourceFenceRevision === null
    || !Number.isSafeInteger(receipt.sourceLeaseEpoch) || receipt.sourceLeaseEpoch < 1)) {
    fail('sourceLeaseEpoch must be a positive safe integer');
  }
  if (!Number.isSafeInteger(receipt.resultLeaseEpoch) || receipt.resultLeaseEpoch < 1) {
    fail('resultLeaseEpoch must be a positive safe integer');
  }
  if (!initial && (receipt.resultClaimId !== receipt.sourceClaimId
    || receipt.resultLeaseEpoch <= receipt.sourceLeaseEpoch
    || receipt.resultFenceRevision === receipt.sourceFenceRevision)) {
    fail('Authority Transition Receipt result does not advance source identity');
  }
  const { receiptDigest, ...payload } = receipt;
  if (governanceDigest(payload) !== receiptDigest) fail('receiptDigest does not match receipt');
  return frozen({ ...receipt });
}
export function isExactReplay(requestValue, receiptValue) {
  try {
    const request = validateCoordinationRequest(requestValue);
    const receipt = validateAuthorityTransitionReceiptEnvelope(receiptValue);
    const initial = request.requestedTransition === 'claim';
    return receipt.requestDigest === request.requestDigest
      && receipt.repository === request.repository
      && receipt.authoritySubject === request.authoritySubject
      && receipt.requestedTransition === request.requestedTransition
      && receipt.immutableRevision === request.immutableRevision
      && receipt.reviewLocator === request.reviewLocator
      && receipt.sourceClaimId === (initial ? null : request.claimId)
      && receipt.sourceLeaseEpoch === (initial ? null : request.leaseEpoch)
      && receipt.sourceFenceRevision === (initial ? null : request.fenceRevision)
      && receipt.resultClaimId === request.claimId
      && (initial ? receipt.resultLeaseEpoch === request.leaseEpoch
        : receipt.resultLeaseEpoch > request.leaseEpoch)
      && Date.parse(receipt.transitionedAt) >= Date.parse(request.observedAt)
      && Date.parse(receipt.transitionedAt) <= Date.parse(request.expiresAt);
  } catch {
    return false;
  }
}
export function findExactReplay(requestValue, receiptValues) {
  const request = validateCoordinationRequest(requestValue);
  if (!Array.isArray(receiptValues) || types.isProxy(receiptValues))
    fail('receiptValues must be an array');
  const length = Object.getOwnPropertyDescriptor(receiptValues, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_NODES - 1)
    fail('governance value exceeds node budget');
  const keys = Reflect.ownKeys(receiptValues);
  if (keys.length !== length + 1) fail('receiptValues must be a dense data array');
  const budget = { nodes: 1, stringBytes: 0 };
  const matches = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(receiptValues, String(index));
    if (!descriptor) fail('receiptValues must be a dense data array');
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      fail('receiptValues cannot contain accessors');
    const receipt = validateAuthorityTransitionReceiptEnvelope(snapshot(descriptor.value, budget));
    if (receipt.requestDigest === request.requestDigest) matches.push(receipt);
  }
  if (matches.length === 0) return null;
  if (matches.some((receipt) => !isExactReplay(request, receipt))
    || new Set(matches.map((receipt) => receipt.receiptDigest)).size !== 1) {
    fail('requestDigest resolves to conflicting receipts');
  }
  return matches[0];
}
function adapter(value, label, nullable = false) {
  if (nullable && value === null) return null;
  exactKeys(value, ['id', 'version'], label);
  return { id: text(value.id, `${label}.id`), version: text(value.version, `${label}.version`) };
}
function canonicalBranch(value, prefix, label) {
  if (typeof value !== 'string' || !value.startsWith(prefix))
    fail(`${label} must be a fully qualified Git ref`);
  const name = value.slice(prefix.length);
  const components = name.split('/');
  const forbidden = /[\u0000-\u0020\u007f~^:?*[\\]/u;
  if (!name || name === '@' || name.includes('..') || name.includes('@{')
    || components.some((component) => !component || component.startsWith('.')
      || component.endsWith('.') || component.endsWith('.lock') || forbidden.test(component))) {
    fail(`${label} must be a portable direct Git ref`);
  }
  return name;
}
function profilePayload(input) {
  const source = snapshot(input);
  exactKeys(source, PROFILE_KEYS, 'repository profile input', false);
  if (source.schema !== undefined && source.schema !== REPOSITORY_PROFILE_SCHEMA)
    fail('repository profile schema is invalid');
  exactKeys(source.canonical, ['localRef', 'remoteRef'], 'canonical');
  exactKeys(source.adapters, ['repository', 'provider'], 'adapters');
  const localBranch = canonicalBranch(source.canonical.localRef,
    'refs/heads/', 'canonical.localRef');
  const remote = source.canonical.remoteRef?.match(/^refs\/remotes\/([^/]+)\/(.+)$/u);
  if (!remote || !/^(?!.*\.\.)(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(remote[1]))
    fail('canonical.remoteRef must name one portable configured remote');
  const remoteBranch = canonicalBranch(source.canonical.remoteRef,
    `refs/remotes/${remote[1]}/`, 'canonical.remoteRef');
  if (localBranch !== remoteBranch)
    fail('canonical local and remote refs must identify the same branch');
  const authority = source.authority ?? CONSUMER_AUTHORITY;
  exactKeys(authority, ['runtime', 'release'], 'authority');
  if (authority.runtime !== 'consumer' || authority.release !== 'consumer')
    fail('runtime and release authority must remain consumer-owned');
  const capabilities = strings(source.capabilities ?? [], 'capabilities');
  const unsupported = capabilities.filter((capability) => !PROFILE_CAPABILITIES.has(capability));
  if (unsupported.length > 0)
    fail(`unsupported repository profile capabilities: ${unsupported.join(', ')}`);
  const repositoryAdapter = adapter(source.adapters.repository, 'adapters.repository');
  const providerAdapter = adapter(source.adapters.provider, 'adapters.provider', true);
  const requiredChecks = strings(source.requiredChecks ?? [], 'requiredChecks');
  if (providerAdapter === null && (requiredChecks.length > 0
    || capabilities.some((capability) => PROVIDER_BOUND_CAPABILITIES.has(capability))))
    fail('provider-bound capabilities and checks require a provider adapter');
  return {
    schema: REPOSITORY_PROFILE_SCHEMA,
    repository: text(source.repository, 'repository'),
    canonical: { localRef: text(source.canonical.localRef, 'canonical.localRef'),
      remoteRef: text(source.canonical.remoteRef, 'canonical.remoteRef') },
    adapters: { repository: repositoryAdapter, provider: providerAdapter },
    requiredChecks,
    capabilities,
    authority: { ...CONSUMER_AUTHORITY },
    cleanup: cleanup(source.cleanup),
  };
}
export function createRepositoryProfile(input) {
  const source = snapshot(input);
  const payload = profilePayload(source);
  const profileDigest = governanceDigest(payload);
  if (source.profileDigest !== undefined && source.profileDigest !== profileDigest)
    fail('profileDigest does not match repository profile');
  return frozen({ ...payload, profileDigest });
}
export function validateRepositoryProfile(value) {
  const source = snapshot(value);
  exactKeys(source, PROFILE_KEYS, 'repository profile');
  if (source.schema !== REPOSITORY_PROFILE_SCHEMA) fail('repository profile schema is invalid');
  const normalized = createRepositoryProfile(source);
  if (canonicalJson(source) !== canonicalJson(normalized)) fail('repository profile is not canonical');
  return normalized;
}
export function claim(input) { return createCoordinationRequest(input, 'claim'); }
function continueOperation(input) { return createCoordinationRequest(input, 'continue'); }
export { continueOperation as continue };
export function integrate(input) { return createCoordinationRequest(input, 'integrate'); }
export function retire(input) { return createCoordinationRequest(input, 'retire'); }
export const governance = Object.freeze({ claim, continue: continueOperation, integrate, retire });
