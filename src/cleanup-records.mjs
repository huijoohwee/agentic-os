/** Canonical, provider-neutral cleanup plans, evidence, eligibility, and receipts. */
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { canonicalJson, governanceDigest } from './governance.mjs';

export const WORKTREE_CLEANUP_PLAN_SCHEMA = 'agentic-os/worktree-cleanup-plan/v1';
export const CLEANUP_EVIDENCE_SCHEMA = 'agentic-os/cleanup-evidence-receipt/v1';
export const WORKTREE_CLEANUP_CONTINUATION_SCHEMA = 'agentic-os/worktree-cleanup-continuation/v1';
export const WORKTREE_CLEANUP_ELIGIBILITY_SCHEMA = 'agentic-os/worktree-cleanup-eligibility/v1';
export const WORKTREE_CLEANUP_RECEIPT_SCHEMA = 'agentic-os/worktree-cleanup-receipt/v1';
export const WORKTREE_CLEANUP_ADAPTER = Object.freeze({ id: 'git-worktree-quarantine', version: '1' });
export const SUCCESSOR_PRESERVATION_SCHEMA = 'agentic-os/successor-preservation-receipt/v1';
export const SUCCESSOR_PRESERVATION_PLAN_SCHEMA = 'agentic-os/successor-preservation-plan/v1';
export const CURRENT_QUARANTINE_SCHEMA = 'agentic-os/current-quarantine-retention-receipt/v1';
export const CURRENT_QUARANTINE_PLAN_SCHEMA = 'agentic-os/current-quarantine-retention-plan/v1';
export const RECORD_ONLY_RETIREMENT_EFFECTS = Object.freeze(['record-retirement', 'retire-claim']);
export const CLEANUP_EFFECTS = Object.freeze(['quarantine-worktree-projection', 'quarantine-worktree-registration']);
export const RETAINED_EFFECTS = Object.freeze(['delete-branch', 'delete-object', 'delete-ref',
  'delete-reflog', 'force-push', 'prune-peer-registration', 'remove-directory-bytes']);
export const INTEGRATION_RECORD_EFFECTS = Object.freeze(['record-integration', 'verify-exact-integration']);
export const INTEGRATION_RECORD_RETAINED_EFFECTS = Object.freeze(['cleanup', 'delete-branch',
  'delete-object', 'delete-ref', 'delete-reflog', 'deploy', 'force-push', 'merge',
  'prune-peer-registration', 'remove-directory-bytes']);
export const RECORD_ONLY_RETIREMENT_RETAINED_EFFECTS = Object.freeze(
  [...new Set([...INTEGRATION_RECORD_RETAINED_EFFECTS, ...CLEANUP_EFFECTS])].sort());
const DIGEST = /^[0-9a-f]{64}$/u;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PLAN_KEYS = Object.freeze(['schema', 'repository', 'targetPath', 'expectedBranch',
  'expectedHeadRevision', 'expectedCanonicalRef', 'expectedCanonicalRevision',
  'integratedResource', 'integratedImmutableRevision', 'candidateDigest', 'snapshotDigest',
  'integrationProofDigest', 'profileDigest', 'recoveryInventoryDigest', 'ownerStateDigest',
  'recoveryInventoryContentEntries', 'integrationReceiptDigest', 'integrationPlanByteDigest',
  'integrationPredecessorDigest', 'preservationReceiptDigest',
  'noRemainingValueReceiptDigest', 'projectionByteCeiling', 'projectionEntryCeiling',
  'registrationByteCeiling', 'registrationEntryCeiling', 'sharedStateByteCeiling',
  'sharedStateEntryCeiling', 'authorizedEffects', 'retainedEffects', 'expiresAt', 'planDigest']);
const CONTINUATION_KEYS = Object.freeze(['schema', 'authorityKind', 'repository', 'targetPath',
  'integratedImmutableRevision', 'candidateDigest', 'snapshotDigest', 'ownerStateDigest',
  'retirementReceiptDigest', 'priorCleanupPlanByteDigest', 'cleanupPlanDigest',
  'cleanupPlanByteDigest', 'issuedAt', 'expiresAt', 'authorityDigest']);
const MAX_PROJECTION_BYTES = 4 * 1024 ** 4;
const MAX_PROJECTION_ENTRIES = 1_000_000;
const MAX_REGISTRATION_BYTES = 64 * 1024 ** 2;
const MAX_REGISTRATION_ENTRIES = 100_000;
const QUARANTINE_POSTCONDITIONS = Object.freeze({
  registeredBefore: true, registeredAfter: false, targetPathExistsBefore: true,
  targetPathExistsAfter: false, adminBytesRetained: true, branchMutationAttempted: false,
  objectMutationAttempted: false, directoryByteRemovalAttempted: false,
  operatingSystemExclusivityProven: false, result: 'quarantined',
});

function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function exact(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const found = Object.keys(value);
  if (found.some((key) => !keys.includes(key)) || required && keys.some((key) => !Object.hasOwn(value, key)))
    fail(`${label} fields are invalid`);
}
function text(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text`);
  return value;
}
function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}
function revision(value, label) {
  if (typeof value !== 'string' || !REVISION.test(value)) fail(`${label} must be a full Git object ID`);
  return value;
}
function instant(value, label) {
  const result = text(value, label), time = Date.parse(result);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result)
    fail(`${label} must be an exact UTC instant`);
  return result;
}
function absolute(value, label) {
  const result = text(value, label);
  if (resolve(result) !== result || result === '/' || basename(result) === '')
    fail(`${label} must be one normalized absolute path`);
  return result;
}
function bound(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    fail(`${label} exceeds its explicit bound`);
  return value;
}
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PROJECTION_ENTRIES)
    fail(`${label} must be a bounded count`);
  return value;
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
export function freezeCleanupRecord(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeCleanupRecord); return Object.freeze(value);
}
function exactSet(value, expected, label) {
  if (!Array.isArray(value) || !same(value, expected)) fail(`${label} must equal its closed effect set`);
  return [...expected];
}
function typedFields(source, names, validator, prefix = '') {
  return Object.fromEntries(names.split(' ').map(name =>
    [name, validator(source[name], `${prefix}${name}`)]));
}
const bounded = maximum => (value, label) => bound(value, maximum, label);
function signedRecord(source, payload, key, label, error) {
  const value = governanceDigest(payload);
  if (source[key] !== undefined && digest(source[key], label) !== value) fail(error);
  return freezeCleanupRecord({ ...payload, [key]: value });
}
function canonicalRecord(value, create, label, error) {
  const source = snap(value), result = create(source);
  exact(source, Object.keys(result), label);
  if (!same(source, result)) fail(error);
  return result;
}
function canonicalRef(value) {
  const result = text(value, 'expectedCanonicalRef');
  if (!result.startsWith('refs/heads/')) fail('expectedCanonicalRef must be a local branch ref');
  return result;
}
export function deriveCleanupOwnerStateDigest(value) {
  const source = snap(value);
  exact(source, ['claimId', 'leaseEpoch', 'fenceRevision', 'state'], 'cleanup owner state');
  if (!Number.isSafeInteger(source.leaseEpoch) || source.leaseEpoch < 1)
    fail('cleanup owner-state leaseEpoch is invalid');
  return governanceDigest({ schema: 'agentic-os/cleanup-owner-state/v1', leaseEpoch: source.leaseEpoch,
    claimId: digest(source.claimId, 'owner-state claimId'),
    fenceRevision: digest(source.fenceRevision, 'owner-state fenceRevision'), state: text(source.state, 'owner-state state') });
}

export function createCleanupEvidenceReceipt(input) {
  const source = snap(input), keys = ['schema', 'kind', 'repository', 'targetPath', 'candidateDigest',
    'snapshotDigest', 'integrationReceiptDigest', 'recoveryInventoryDigest',
    'recoveryInventoryContentEntries', 'ownerStateDigest', 'archiveDigest', 'preservationComplete',
    'reachableFromRetainedRefs', 'unpreservedValueCount', 'receiptDigest'];
  exact(source, keys, 'cleanup evidence input', false);
  if (source.schema !== undefined && source.schema !== CLEANUP_EVIDENCE_SCHEMA)
    fail('cleanup evidence schema is invalid');
  if (!['preservation', 'no-remaining-value'].includes(source.kind))
    fail('cleanup evidence kind is invalid');
  const preservation = source.kind === 'preservation';
  if (preservation ? source.preservationComplete !== true
    || source.reachableFromRetainedRefs !== null || source.unpreservedValueCount !== null
    : source.preservationComplete !== null || source.reachableFromRetainedRefs !== true
      || source.unpreservedValueCount !== 0) fail('cleanup evidence claim is invalid');
  const payload = { schema: CLEANUP_EVIDENCE_SCHEMA, kind: source.kind,
    repository: text(source.repository, 'evidence repository'),
    targetPath: absolute(source.targetPath, 'evidence targetPath'),
    ...typedFields(source, 'candidateDigest snapshotDigest integrationReceiptDigest recoveryInventoryDigest ownerStateDigest ' +
      'archiveDigest', digest, 'evidence '),
    recoveryInventoryContentEntries: count(source.recoveryInventoryContentEntries,
      'evidence recoveryInventoryContentEntries'),
    preservationComplete: source.preservationComplete,
    reachableFromRetainedRefs: source.reachableFromRetainedRefs,
    unpreservedValueCount: source.unpreservedValueCount };
  return signedRecord(source, payload, 'receiptDigest', 'evidence receiptDigest', 'cleanup evidence digest is invalid');
}

export const validateCleanupEvidenceReceipt = value =>
  canonicalRecord(value, createCleanupEvidenceReceipt, 'cleanup evidence receipt', 'cleanup evidence receipt is not canonical');

export function createWorktreeCleanupPlan(input) {
  const source = snap(input);
  exact(source, PLAN_KEYS, 'worktree cleanup plan input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_PLAN_SCHEMA)
    fail('worktree cleanup plan schema is invalid');
  const payload = { schema: WORKTREE_CLEANUP_PLAN_SCHEMA,
    ...typedFields(source, 'repository expectedBranch integratedResource', text, 'cleanup '),
    targetPath: absolute(source.targetPath, 'cleanup targetPath'),
    ...typedFields(source, 'expectedHeadRevision expectedCanonicalRevision integratedImmutableRevision', revision, 'cleanup '),
    expectedCanonicalRef: canonicalRef(source.expectedCanonicalRef),
    ...typedFields(source, 'candidateDigest snapshotDigest integrationProofDigest profileDigest recoveryInventoryDigest ' +
      'ownerStateDigest integrationReceiptDigest integrationPlanByteDigest integrationPredecessorDigest ' +
      'preservationReceiptDigest noRemainingValueReceiptDigest', digest, 'cleanup '),
    recoveryInventoryContentEntries: count(source.recoveryInventoryContentEntries,
      'cleanup recoveryInventoryContentEntries'),
    ...typedFields(source, 'projectionByteCeiling sharedStateByteCeiling', bounded(MAX_PROJECTION_BYTES)),
    ...typedFields(source, 'projectionEntryCeiling sharedStateEntryCeiling', bounded(MAX_PROJECTION_ENTRIES)),
    registrationByteCeiling: bound(source.registrationByteCeiling, MAX_REGISTRATION_BYTES,
      'registrationByteCeiling'),
    registrationEntryCeiling: bound(source.registrationEntryCeiling, MAX_REGISTRATION_ENTRIES,
      'registrationEntryCeiling'),
    authorizedEffects: exactSet(source.authorizedEffects, CLEANUP_EFFECTS, 'authorizedEffects'),
    retainedEffects: exactSet(source.retainedEffects, RETAINED_EFFECTS, 'retainedEffects'),
    expiresAt: instant(source.expiresAt, 'cleanup expiresAt') };
  return signedRecord(source, payload, 'planDigest', 'cleanup planDigest', 'cleanup plan digest is invalid');
}

export const validateWorktreeCleanupPlan = value =>
  canonicalRecord(value, createWorktreeCleanupPlan, 'worktree cleanup plan', 'worktree cleanup plan is not canonical');
export const encodeWorktreeCleanupPlan = (value) =>
  Buffer.from(canonicalJson(validateWorktreeCleanupPlan(value)), 'utf8');
export const worktreeCleanupPlanByteDigest = (value) =>
  createHash('sha256').update(encodeWorktreeCleanupPlan(value)).digest('hex');

export function createWorktreeCleanupContinuation(input) {
  const source = snap(input); exact(source, CONTINUATION_KEYS, 'worktree cleanup continuation input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_CONTINUATION_SCHEMA)
    fail('worktree cleanup continuation schema is invalid');
  const payload = { schema: WORKTREE_CLEANUP_CONTINUATION_SCHEMA,
    authorityKind: text(source.authorityKind, 'cleanup authorityKind'),
    repository: text(source.repository, 'cleanup continuation repository'),
    targetPath: absolute(source.targetPath, 'cleanup continuation targetPath'),
    integratedImmutableRevision: revision(source.integratedImmutableRevision,
      'cleanup continuation integratedImmutableRevision'),
    ...typedFields(source, 'candidateDigest snapshotDigest ownerStateDigest retirementReceiptDigest priorCleanupPlanByteDigest ' +
      'cleanupPlanDigest cleanupPlanByteDigest', digest, 'cleanup continuation '),
    issuedAt: instant(source.issuedAt, 'cleanup continuation issuedAt'),
    expiresAt: instant(source.expiresAt, 'cleanup continuation expiresAt') };
  if (Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt))
    fail('cleanup continuation window is invalid');
  return signedRecord(source, payload, 'authorityDigest', 'cleanup continuation authorityDigest', 'cleanup continuation digest is invalid');
}

export const validateWorktreeCleanupContinuation = value =>
  canonicalRecord(value, createWorktreeCleanupContinuation, 'worktree cleanup continuation', 'worktree cleanup continuation is not canonical');
export function createWorktreeCleanupEligibility(input) {
  const source = snap(input), keys = ['schema', 'cleanupPlanDigest', 'cleanupPlanByteDigest',
    'integrationReceiptDigest', 'integrationPlanByteDigest', 'retirementReceiptDigest',
    'preservationReceiptDigest', 'noRemainingValueReceiptDigest', 'retirementPlanByteDigest',
    'recoveryInventoryDigest', 'recoveryInventoryContentEntries', 'ownerStateDigest',
    'profileDigest', 'canonicalRevision', 'targetObservationDigest', 'projectionManifestDigest',
    'projectionBytes', 'projectionEntries', 'registrationManifestDigest', 'registrationBytes',
    'registrationEntries', 'peerRegistrationDigest', 'sharedRefDigest', 'objectInventoryDigest',
    'sharedStateBytes', 'sharedStateEntries', 'eligibleEffects', 'evaluatedAt', 'expiresAt',
    'eligibilityDigest'];
  exact(source, keys, 'worktree cleanup eligibility input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_ELIGIBILITY_SCHEMA)
    fail('worktree cleanup eligibility schema is invalid');
  const payload = { schema: WORKTREE_CLEANUP_ELIGIBILITY_SCHEMA,
    ...typedFields(source, 'cleanupPlanDigest cleanupPlanByteDigest integrationReceiptDigest integrationPlanByteDigest ' +
      'retirementReceiptDigest preservationReceiptDigest noRemainingValueReceiptDigest ' +
      'retirementPlanByteDigest recoveryInventoryDigest ownerStateDigest profileDigest ' +
      'targetObservationDigest projectionManifestDigest registrationManifestDigest peerRegistrationDigest ' +
      'sharedRefDigest objectInventoryDigest', digest),
    ...typedFields(source, 'recoveryInventoryContentEntries projectionEntries registrationEntries sharedStateEntries', count),
    canonicalRevision: revision(source.canonicalRevision, 'canonicalRevision'),
    ...typedFields(source, 'projectionBytes sharedStateBytes', bounded(MAX_PROJECTION_BYTES)),
    registrationBytes: bound(source.registrationBytes, MAX_REGISTRATION_BYTES,
      'registrationBytes'),
    eligibleEffects: exactSet(source.eligibleEffects, CLEANUP_EFFECTS, 'eligibleEffects'),
    evaluatedAt: instant(source.evaluatedAt, 'eligibility evaluatedAt'),
    expiresAt: instant(source.expiresAt, 'eligibility expiresAt') };
  if (Date.parse(payload.evaluatedAt) >= Date.parse(payload.expiresAt))
    fail('cleanup eligibility window is invalid');
  return signedRecord(source, payload, 'eligibilityDigest', 'eligibilityDigest', 'cleanup eligibility digest is invalid');
}

export const validateWorktreeCleanupEligibility = value =>
  canonicalRecord(value, createWorktreeCleanupEligibility, 'worktree cleanup eligibility', 'cleanup eligibility is not canonical');
export function createWorktreeCleanupReceipt(input) {
  const source = snap(input), keys = ['schema', 'adapter', 'cleanupPlanDigest', 'eligibilityDigest',
    'integrationPlanByteDigest', 'targetPath', 'projectionQuarantinePath',
    'registrationQuarantinePath', 'projectionManifestDigest', 'projectionBytes', 'projectionEntries',
    'registrationManifestDigest', 'registrationBytes', 'registrationEntries',
    'recoveryInventoryDigest', 'profileDigest', 'canonicalRevision', 'recoveryInventoryContentEntries',
    'peerRegistrationDigest', 'sharedRefDigest', 'objectInventoryDigest', 'sharedStateBytes',
    'sharedStateEntries', ...Object.keys(QUARANTINE_POSTCONDITIONS), 'executedAt', 'receiptDigest'];
  exact(source, keys, 'worktree cleanup receipt input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_RECEIPT_SCHEMA)
    fail('worktree cleanup receipt schema is invalid');
  if (source.adapter !== undefined) {
    exact(source.adapter, ['id', 'version'], 'cleanup receipt adapter');
    if (!same(source.adapter, WORKTREE_CLEANUP_ADAPTER)) fail('cleanup receipt adapter is invalid');
  }
  const payload = { schema: WORKTREE_CLEANUP_RECEIPT_SCHEMA,
    adapter: { ...WORKTREE_CLEANUP_ADAPTER },
    ...typedFields(source, 'cleanupPlanDigest eligibilityDigest integrationPlanByteDigest projectionManifestDigest ' +
      'registrationManifestDigest recoveryInventoryDigest profileDigest peerRegistrationDigest ' +
      'sharedRefDigest objectInventoryDigest', digest),
    ...typedFields(source, 'targetPath projectionQuarantinePath registrationQuarantinePath', absolute),
    ...typedFields(source, 'projectionBytes sharedStateBytes', bounded(MAX_PROJECTION_BYTES)),
    projectionEntries: bound(source.projectionEntries, MAX_PROJECTION_ENTRIES,
      'projectionEntries'),
    registrationBytes: bound(source.registrationBytes, MAX_REGISTRATION_BYTES,
      'registrationBytes'),
    registrationEntries: bound(source.registrationEntries, MAX_REGISTRATION_ENTRIES,
      'registrationEntries'),
    ...typedFields(source, 'recoveryInventoryContentEntries sharedStateEntries', count),
    canonicalRevision: revision(source.canonicalRevision, 'canonicalRevision'),
    ...Object.fromEntries(Object.keys(QUARANTINE_POSTCONDITIONS).map(key => [key, source[key]])),
    executedAt: instant(source.executedAt, 'executedAt') };
  if (Object.entries(QUARANTINE_POSTCONDITIONS).some(([key, expected]) => payload[key] !== expected))
    fail('cleanup receipt postconditions are invalid');
  return signedRecord(source, payload, 'receiptDigest', 'receiptDigest', 'cleanup receipt digest is invalid');
}

export const validateWorktreeCleanupReceipt = value =>
  canonicalRecord(value, createWorktreeCleanupReceipt, 'worktree cleanup receipt', 'cleanup receipt is not canonical');

function preservationRecord(value, receipt, allowCurrent = false) {
  const source = snap(value), checksum = receipt ? 'receiptDigest' : 'planDigest';
  const current = allowCurrent && source.disposition === 'current-quarantine-retained';
  const history = current ? 'historicalQuarantineAuthorityProven' : 'historicalSuccessionAuthorityProven';
  const keys = ['schema', 'disposition', 'adoption', 'adoptionDigest', 'repository',
    'canonicalRevision', 'profileDigest', 'policyDigest', 'review', 'integration', 'retention',
    'state', 'issuedAt', 'expiresAt', 'physicalCleanupPerformed', 'providerAuthority',
    'claimRetired', history, checksum];
  exact(source, keys, 'successor preservation record');
  if (Buffer.byteLength(canonicalJson(source)) > 64000
    || source.schema !== (current ? receipt ? CURRENT_QUARANTINE_SCHEMA : CURRENT_QUARANTINE_PLAN_SCHEMA
      : receipt ? SUCCESSOR_PRESERVATION_SCHEMA : SUCCESSOR_PRESERVATION_PLAN_SCHEMA)
    || source.disposition !== (current ? 'current-quarantine-retained' : 'successor-preserved')
    || ['physicalCleanupPerformed', 'providerAuthority', 'claimRetired', history].some(name => source[name] !== false))
    fail('successor preservation claims are invalid');
  const adoption = source.adoption;
  exact(adoption, ['schema', 'repository', 'merge', 'reviewLocator', 'quarantineCoordinate', history,
    ...(current ? ['targetRef', 'targetHead', 'originalReceiptDigest']
      : ['predecessorRef', 'predecessorHead', 'successorRef', 'successorHead', 'replacedPaths'])], 'successor preservation adoption');
  const coordinates = current ? { predecessorRef: adoption.targetRef, successorRef: adoption.targetRef,
    predecessorHead: adoption.targetHead, successorHead: adoption.targetHead, replacedPaths: [] } : adoption;
  if (adoption.schema !== (current ? 'agentic-os/current-quarantine-adoption/v1' : 'agentic-os/successor-preservation-adoption/v1')
    || adoption[history] !== false
    || adoption.repository !== source.repository
    || !Array.isArray(coordinates.replacedPaths) || !current && !coordinates.replacedPaths.length
    || coordinates.replacedPaths.length > 512 || new Set(coordinates.replacedPaths).size !== coordinates.replacedPaths.length
    || coordinates.replacedPaths.some(path => typeof path !== 'string' || !path || path.startsWith('/')
      || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')))
    fail('successor preservation adoption is invalid');
  typedFields(coordinates, 'predecessorRef successorRef', text); text(adoption.reviewLocator, 'reviewLocator');
  typedFields(coordinates, 'predecessorHead successorHead', revision); revision(adoption.merge, 'merge');
  digest(adoption.quarantineCoordinate, 'quarantineCoordinate');
  if (digest(source.adoptionDigest, 'adoptionDigest') !== governanceDigest(adoption))
    fail('successor preservation adoption digest is invalid');
  typedFields(source, 'profileDigest policyDigest', digest);
  revision(source.canonicalRevision, 'canonicalRevision');
  instant(source.issuedAt, 'issuedAt'); instant(source.expiresAt, 'expiresAt');
  if (Date.parse(source.issuedAt) >= Date.parse(source.expiresAt)) fail('successor preservation window is invalid');
  const { review, integration, retention, state } = source;
  exact(review, ['repository', 'pr', 'url', 'branch', 'head', 'merge', 'mergedAt', 'checks',
    'protectionProven', 'authority'], 'preservation review');
  exact(integration, ['kind', 'predecessorHead', 'reviewedHead', 'merge', 'pathCount', 'replacements'], 'preservation integration');
  exact(retention, ['coordinate', 'operationDigest', 'registrationRef', 'retainedHead',
    'projectionManifest', 'registrationManifest', ...(current ? ['originalReceipt', 'originalReceiptDigest',
      'retainedIndexInventoryDigest', 'recoveryInventoryDigest'] : [])], 'preservation retention');
  if (current && (digest(adoption.originalReceiptDigest, 'originalReceiptDigest') !== governanceDigest(retention.originalReceipt)
    || retention.originalReceiptDigest !== adoption.originalReceiptDigest)) fail('current quarantine receipt is not enrolled');
  if (current) typedFields(retention, 'retainedIndexInventoryDigest recoveryInventoryDigest', digest);
  exact(state, ['root', 'policyRoot', 'policyRevision', 'policyRepository', 'workflow', 'predecessorHead',
    'successorHead', 'peerRegistrationDigest', 'cacheDigest', ...(receipt ? ['planDigest', 'planIssuedAt'] : [])], 'preservation state');
  typedFields(state, 'root policyRoot', absolute);
  typedFields(state, 'policyRevision predecessorHead successorHead', revision);
  typedFields(state, 'peerRegistrationDigest cacheDigest', digest);
  if (receipt) {
    digest(state.planDigest, 'preservation planDigest'); instant(state.planIssuedAt, 'preservation planIssuedAt');
    if (Date.parse(state.planIssuedAt) > Date.parse(source.issuedAt)) fail('preservation issuance chronology is invalid');
  }
  if (Date.parse(source.expiresAt) - Date.parse(receipt ? state.planIssuedAt : source.issuedAt) > 900000)
    fail('successor preservation window exceeds the admitted ceiling');
  text(state.policyRepository, 'policyRepository'); text(state.workflow, 'workflow');
  digest(retention.operationDigest, 'retained operationDigest');
  for (const name of ['projectionManifest', 'registrationManifest']) {
    exact(retention[name], ['digest', 'bytes', 'entries'], name);
    digest(retention[name].digest, name); count(retention[name].entries, name);
    if (!Number.isSafeInteger(retention[name].bytes) || retention[name].bytes < 0) fail('retained bytes are invalid');
  }
  if (review.repository !== source.repository.replace(/^github.com\//u, '')
    || !Number.isSafeInteger(review.pr) || review.pr < 1 || !Number.isFinite(Date.parse(review.mergedAt))
    || review.protectionProven !== false || review.authority !== 'observation-only'
    || review.url !== adoption.reviewLocator || review.branch !== coordinates.successorRef
    || review.head !== coordinates.successorHead || review.merge !== adoption.merge
    || integration.kind !== (current ? 'current-quarantined' : 'reviewed-successor') || integration.predecessorHead !== coordinates.predecessorHead
    || integration.reviewedHead !== coordinates.successorHead || integration.merge !== adoption.merge
    || !Number.isSafeInteger(integration.pathCount) || integration.pathCount < coordinates.replacedPaths.length
    || !Array.isArray(integration.replacements) || integration.replacements.length !== coordinates.replacedPaths.length
    || new Set(integration.replacements.map(row => row?.path)).size !== coordinates.replacedPaths.length
    || !Array.isArray(review.checks) || !review.checks.length || review.checks.length > 8
    || retention.coordinate !== adoption.quarantineCoordinate || retention.registrationRef !== coordinates.successorRef
    || retention.retainedHead !== coordinates.successorHead || state.predecessorHead !== coordinates.predecessorHead
    || state.successorHead !== coordinates.successorHead) fail('preservation source facts are not joined');
  for (const row of integration.replacements) {
    exact(row, ['path', 'old', 'accepted'], 'preservation replacement');
    if (!coordinates.replacedPaths.includes(row.path) || typeof row.old !== 'string' || typeof row.accepted !== 'string')
      fail('preservation replacement is invalid');
  }
  for (const check of review.checks) {
    exact(check, ['name', 'checkId', 'runId', 'attempt', 'workflow', 'conclusion', 'completedAt', 'url'], 'preservation check');
    if (check.conclusion !== 'success' || check.workflow !== state.workflow
      || !['checkId', 'runId', 'attempt'].every(key => Number.isSafeInteger(check[key]) && check[key] > 0)
      || !Number.isFinite(Date.parse(check.completedAt)) || Date.parse(check.completedAt) > Date.parse(review.mergedAt))
      fail('preservation check is invalid');
    text(check.name, 'check name'); text(check.url, 'check url');
  }
  const { [checksum]: found, ...payload } = source;
  if (digest(found, checksum) !== governanceDigest(payload)) fail('successor preservation digest is invalid');
  return freezeCleanupRecord(source);
}
export const validateSuccessorPreservationReceipt = value => preservationRecord(value, true);
export const validateSuccessorPreservationPlan = value => preservationRecord(value, false);
export const validateRetentionDispositionReceipt = value => preservationRecord(value, true, true);
export const validateRetentionDispositionPlan = value => preservationRecord(value, false, true);

export { exact as cleanupRecordExact, digest as cleanupRecordDigest, typedFields as cleanupRecordFields, canonicalRecord as cleanupRecordCanonical };
