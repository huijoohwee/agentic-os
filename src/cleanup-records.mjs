/** Canonical, provider-neutral cleanup plans, evidence, eligibility, and receipts. */
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { canonicalJson, governanceDigest } from './governance.mjs';

export const WORKTREE_CLEANUP_PLAN_SCHEMA = 'agentic-os/worktree-cleanup-plan/v1';
export const CLEANUP_EVIDENCE_SCHEMA = 'agentic-os/cleanup-evidence-receipt/v1';
export const WORKTREE_CLEANUP_ELIGIBILITY_SCHEMA =
  'agentic-os/worktree-cleanup-eligibility/v1';
export const WORKTREE_CLEANUP_RECEIPT_SCHEMA = 'agentic-os/worktree-cleanup-receipt/v1';
export const WORKTREE_CLEANUP_ADAPTER = Object.freeze({
  id: 'git-worktree-quarantine', version: '1',
});
export const CLEANUP_EFFECTS = Object.freeze([
  'quarantine-worktree-projection', 'quarantine-worktree-registration',
]);
export const RETAINED_EFFECTS = Object.freeze([
  'delete-branch', 'delete-object', 'delete-ref', 'delete-reflog', 'force-push',
  'prune-peer-registration', 'remove-directory-bytes',
]);
export const INTEGRATION_RECORD_EFFECTS = Object.freeze([
  'record-integration', 'verify-exact-integration',
]);
export const INTEGRATION_RECORD_RETAINED_EFFECTS = Object.freeze([
  'cleanup', 'delete-branch', 'delete-object', 'delete-ref', 'delete-reflog', 'deploy',
  'force-push', 'merge', 'prune-peer-registration', 'remove-directory-bytes',
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PLAN_KEYS = Object.freeze([
  'schema', 'repository', 'targetPath', 'expectedBranch', 'expectedHeadRevision',
  'expectedCanonicalRef', 'expectedCanonicalRevision', 'integratedResource',
  'integratedImmutableRevision',
  'candidateDigest', 'snapshotDigest', 'integrationProofDigest', 'profileDigest',
  'recoveryInventoryDigest', 'ownerStateDigest',
  'recoveryInventoryContentEntries',
  'integrationReceiptDigest', 'integrationPlanByteDigest', 'integrationPredecessorDigest',
  'preservationReceiptDigest', 'noRemainingValueReceiptDigest',
  'projectionByteCeiling', 'projectionEntryCeiling', 'registrationByteCeiling',
  'registrationEntryCeiling', 'sharedStateByteCeiling', 'sharedStateEntryCeiling',
  'authorizedEffects', 'retainedEffects', 'expiresAt', 'planDigest',
]);
const MAX_PROJECTION_BYTES = 4 * 1024 ** 4;
const MAX_PROJECTION_ENTRIES = 1_000_000;
const MAX_REGISTRATION_BYTES = 64 * 1024 ** 2;
const MAX_REGISTRATION_ENTRIES = 100_000;

function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function exact(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const found = Object.keys(value);
  if (found.some((key) => !keys.includes(key))
    || required && keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
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
function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}
function exactSet(value, expected, label) {
  if (!Array.isArray(value) || !same(value, expected)) fail(`${label} must equal its closed effect set`);
  return [...expected];
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
  return governanceDigest({ schema: 'agentic-os/cleanup-owner-state/v1',
    claimId: digest(source.claimId, 'owner-state claimId'), leaseEpoch: source.leaseEpoch,
    fenceRevision: digest(source.fenceRevision, 'owner-state fenceRevision'),
    state: text(source.state, 'owner-state state') });
}

export function createCleanupEvidenceReceipt(input) {
  const source = snap(input), keys = ['schema', 'kind', 'repository', 'targetPath',
    'candidateDigest', 'snapshotDigest', 'integrationReceiptDigest', 'recoveryInventoryDigest',
    'recoveryInventoryContentEntries', 'ownerStateDigest', 'archiveDigest',
    'preservationComplete', 'reachableFromRetainedRefs', 'unpreservedValueCount', 'receiptDigest'];
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
    candidateDigest: digest(source.candidateDigest, 'evidence candidateDigest'),
    snapshotDigest: digest(source.snapshotDigest, 'evidence snapshotDigest'),
    integrationReceiptDigest: digest(source.integrationReceiptDigest,
      'evidence integrationReceiptDigest'),
    recoveryInventoryDigest: digest(source.recoveryInventoryDigest,
      'evidence recoveryInventoryDigest'),
    recoveryInventoryContentEntries: count(source.recoveryInventoryContentEntries,
      'evidence recoveryInventoryContentEntries'),
    ownerStateDigest: digest(source.ownerStateDigest, 'evidence ownerStateDigest'),
    archiveDigest: digest(source.archiveDigest, 'evidence archiveDigest'),
    preservationComplete: source.preservationComplete,
    reachableFromRetainedRefs: source.reachableFromRetainedRefs,
    unpreservedValueCount: source.unpreservedValueCount };
  const receiptDigest = governanceDigest(payload);
  if (source.receiptDigest !== undefined
    && digest(source.receiptDigest, 'evidence receiptDigest') !== receiptDigest)
    fail('cleanup evidence digest is invalid');
  return frozen({ ...payload, receiptDigest });
}

export function validateCleanupEvidenceReceipt(value) {
  const source = snap(value), result = createCleanupEvidenceReceipt(source);
  exact(source, Object.keys(result), 'cleanup evidence receipt');
  if (!same(source, result)) fail('cleanup evidence receipt is not canonical');
  return result;
}

export function createWorktreeCleanupPlan(input) {
  const source = snap(input);
  exact(source, PLAN_KEYS, 'worktree cleanup plan input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_PLAN_SCHEMA)
    fail('worktree cleanup plan schema is invalid');
  const payload = { schema: WORKTREE_CLEANUP_PLAN_SCHEMA,
    repository: text(source.repository, 'cleanup repository'),
    targetPath: absolute(source.targetPath, 'cleanup targetPath'),
    expectedBranch: text(source.expectedBranch, 'cleanup expectedBranch'),
    expectedHeadRevision: revision(source.expectedHeadRevision, 'cleanup expectedHeadRevision'),
    expectedCanonicalRef: canonicalRef(source.expectedCanonicalRef),
    expectedCanonicalRevision: revision(source.expectedCanonicalRevision,
      'cleanup expectedCanonicalRevision'),
    integratedResource: text(source.integratedResource, 'cleanup integratedResource'),
    integratedImmutableRevision: revision(source.integratedImmutableRevision,
      'cleanup integratedImmutableRevision'),
    candidateDigest: digest(source.candidateDigest, 'cleanup candidateDigest'),
    snapshotDigest: digest(source.snapshotDigest, 'cleanup snapshotDigest'),
    integrationProofDigest: digest(source.integrationProofDigest, 'cleanup integrationProofDigest'),
    profileDigest: digest(source.profileDigest, 'cleanup profileDigest'),
    recoveryInventoryDigest: digest(source.recoveryInventoryDigest,
      'cleanup recoveryInventoryDigest'),
    recoveryInventoryContentEntries: count(source.recoveryInventoryContentEntries,
      'cleanup recoveryInventoryContentEntries'),
    ownerStateDigest: digest(source.ownerStateDigest, 'cleanup ownerStateDigest'),
    integrationReceiptDigest: digest(source.integrationReceiptDigest,
      'cleanup integrationReceiptDigest'),
    integrationPlanByteDigest: digest(source.integrationPlanByteDigest,
      'cleanup integrationPlanByteDigest'),
    integrationPredecessorDigest: digest(source.integrationPredecessorDigest,
      'cleanup integrationPredecessorDigest'),
    preservationReceiptDigest: digest(source.preservationReceiptDigest,
      'cleanup preservationReceiptDigest'),
    noRemainingValueReceiptDigest: digest(source.noRemainingValueReceiptDigest,
      'cleanup noRemainingValueReceiptDigest'),
    projectionByteCeiling: bound(source.projectionByteCeiling, MAX_PROJECTION_BYTES,
      'projectionByteCeiling'),
    projectionEntryCeiling: bound(source.projectionEntryCeiling, MAX_PROJECTION_ENTRIES,
      'projectionEntryCeiling'),
    registrationByteCeiling: bound(source.registrationByteCeiling, MAX_REGISTRATION_BYTES,
      'registrationByteCeiling'),
    registrationEntryCeiling: bound(source.registrationEntryCeiling, MAX_REGISTRATION_ENTRIES,
      'registrationEntryCeiling'),
    sharedStateByteCeiling: bound(source.sharedStateByteCeiling, MAX_PROJECTION_BYTES,
      'sharedStateByteCeiling'),
    sharedStateEntryCeiling: bound(source.sharedStateEntryCeiling, MAX_PROJECTION_ENTRIES,
      'sharedStateEntryCeiling'),
    authorizedEffects: exactSet(source.authorizedEffects, CLEANUP_EFFECTS, 'authorizedEffects'),
    retainedEffects: exactSet(source.retainedEffects, RETAINED_EFFECTS, 'retainedEffects'),
    expiresAt: instant(source.expiresAt, 'cleanup expiresAt') };
  const planDigest = governanceDigest(payload);
  if (source.planDigest !== undefined
    && digest(source.planDigest, 'cleanup planDigest') !== planDigest)
    fail('cleanup plan digest is invalid');
  return frozen({ ...payload, planDigest });
}

export function validateWorktreeCleanupPlan(value) {
  const source = snap(value), result = createWorktreeCleanupPlan(source);
  exact(source, PLAN_KEYS, 'worktree cleanup plan');
  if (!same(source, result)) fail('worktree cleanup plan is not canonical');
  return result;
}
export const encodeWorktreeCleanupPlan = (value) =>
  Buffer.from(canonicalJson(validateWorktreeCleanupPlan(value)), 'utf8');
export function worktreeCleanupPlanByteDigest(value) {
  return createHash('sha256').update(encodeWorktreeCleanupPlan(value)).digest('hex');
}

export function createWorktreeCleanupEligibility(input) {
  const source = snap(input), keys = ['schema', 'cleanupPlanDigest', 'cleanupPlanByteDigest',
    'integrationReceiptDigest', 'integrationPlanByteDigest', 'retirementReceiptDigest',
    'preservationReceiptDigest',
    'noRemainingValueReceiptDigest', 'retirementPlanByteDigest', 'recoveryInventoryDigest',
    'recoveryInventoryContentEntries', 'ownerStateDigest', 'profileDigest', 'canonicalRevision',
    'targetObservationDigest', 'projectionManifestDigest', 'projectionBytes',
    'projectionEntries', 'registrationManifestDigest', 'registrationBytes',
    'registrationEntries', 'peerRegistrationDigest', 'sharedRefDigest', 'objectInventoryDigest',
    'sharedStateBytes', 'sharedStateEntries',
    'eligibleEffects', 'evaluatedAt', 'expiresAt', 'eligibilityDigest'];
  exact(source, keys, 'worktree cleanup eligibility input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_ELIGIBILITY_SCHEMA)
    fail('worktree cleanup eligibility schema is invalid');
  const payload = { schema: WORKTREE_CLEANUP_ELIGIBILITY_SCHEMA,
    cleanupPlanDigest: digest(source.cleanupPlanDigest, 'cleanupPlanDigest'),
    cleanupPlanByteDigest: digest(source.cleanupPlanByteDigest, 'cleanupPlanByteDigest'),
    integrationReceiptDigest: digest(source.integrationReceiptDigest, 'integrationReceiptDigest'),
    integrationPlanByteDigest: digest(source.integrationPlanByteDigest,
      'integrationPlanByteDigest'),
    retirementReceiptDigest: digest(source.retirementReceiptDigest, 'retirementReceiptDigest'),
    preservationReceiptDigest: digest(source.preservationReceiptDigest,
      'preservationReceiptDigest'),
    noRemainingValueReceiptDigest: digest(source.noRemainingValueReceiptDigest,
      'noRemainingValueReceiptDigest'),
    retirementPlanByteDigest: digest(source.retirementPlanByteDigest,
      'retirementPlanByteDigest'),
    recoveryInventoryDigest: digest(source.recoveryInventoryDigest, 'recoveryInventoryDigest'),
    recoveryInventoryContentEntries: count(source.recoveryInventoryContentEntries,
      'recoveryInventoryContentEntries'),
    ownerStateDigest: digest(source.ownerStateDigest, 'ownerStateDigest'),
    profileDigest: digest(source.profileDigest, 'profileDigest'),
    canonicalRevision: revision(source.canonicalRevision, 'canonicalRevision'),
    targetObservationDigest: digest(source.targetObservationDigest, 'targetObservationDigest'),
    projectionManifestDigest: digest(source.projectionManifestDigest,
      'projectionManifestDigest'),
    projectionBytes: bound(source.projectionBytes, MAX_PROJECTION_BYTES, 'projectionBytes'),
    projectionEntries: count(source.projectionEntries, 'projectionEntries'),
    registrationManifestDigest: digest(source.registrationManifestDigest,
      'registrationManifestDigest'),
    registrationBytes: bound(source.registrationBytes, MAX_REGISTRATION_BYTES,
      'registrationBytes'),
    registrationEntries: count(source.registrationEntries, 'registrationEntries'),
    peerRegistrationDigest: digest(source.peerRegistrationDigest, 'peerRegistrationDigest'),
    sharedRefDigest: digest(source.sharedRefDigest, 'sharedRefDigest'),
    objectInventoryDigest: digest(source.objectInventoryDigest, 'objectInventoryDigest'),
    sharedStateBytes: bound(source.sharedStateBytes, MAX_PROJECTION_BYTES, 'sharedStateBytes'),
    sharedStateEntries: count(source.sharedStateEntries, 'sharedStateEntries'),
    eligibleEffects: exactSet(source.eligibleEffects, CLEANUP_EFFECTS, 'eligibleEffects'),
    evaluatedAt: instant(source.evaluatedAt, 'eligibility evaluatedAt'),
    expiresAt: instant(source.expiresAt, 'eligibility expiresAt') };
  if (Date.parse(payload.evaluatedAt) >= Date.parse(payload.expiresAt))
    fail('cleanup eligibility window is invalid');
  const eligibilityDigest = governanceDigest(payload);
  if (source.eligibilityDigest !== undefined
    && digest(source.eligibilityDigest, 'eligibilityDigest') !== eligibilityDigest)
    fail('cleanup eligibility digest is invalid');
  return frozen({ ...payload, eligibilityDigest });
}

export function validateWorktreeCleanupEligibility(value) {
  const source = snap(value), result = createWorktreeCleanupEligibility(source);
  exact(source, Object.keys(result), 'worktree cleanup eligibility');
  if (!same(source, result)) fail('cleanup eligibility is not canonical');
  return result;
}

export function createWorktreeCleanupReceipt(input) {
  const source = snap(input), keys = ['schema', 'adapter', 'cleanupPlanDigest',
    'eligibilityDigest', 'integrationPlanByteDigest', 'targetPath', 'projectionQuarantinePath',
    'registrationQuarantinePath', 'projectionManifestDigest', 'projectionBytes',
    'projectionEntries', 'registrationManifestDigest', 'registrationBytes',
    'registrationEntries', 'recoveryInventoryDigest', 'profileDigest', 'canonicalRevision',
    'recoveryInventoryContentEntries',
    'peerRegistrationDigest', 'sharedRefDigest', 'objectInventoryDigest', 'sharedStateBytes',
    'sharedStateEntries', 'registeredBefore',
    'registeredAfter', 'targetPathExistsBefore', 'targetPathExistsAfter', 'adminBytesRetained',
    'branchMutationAttempted', 'objectMutationAttempted', 'directoryByteRemovalAttempted',
    'operatingSystemExclusivityProven', 'result', 'executedAt', 'receiptDigest'];
  exact(source, keys, 'worktree cleanup receipt input', false);
  if (source.schema !== undefined && source.schema !== WORKTREE_CLEANUP_RECEIPT_SCHEMA)
    fail('worktree cleanup receipt schema is invalid');
  if (source.adapter !== undefined) {
    exact(source.adapter, ['id', 'version'], 'cleanup receipt adapter');
    if (!same(source.adapter, WORKTREE_CLEANUP_ADAPTER)) fail('cleanup receipt adapter is invalid');
  }
  const payload = { schema: WORKTREE_CLEANUP_RECEIPT_SCHEMA,
    adapter: { ...WORKTREE_CLEANUP_ADAPTER },
    cleanupPlanDigest: digest(source.cleanupPlanDigest, 'cleanupPlanDigest'),
    eligibilityDigest: digest(source.eligibilityDigest, 'eligibilityDigest'),
    integrationPlanByteDigest: digest(source.integrationPlanByteDigest,
      'integrationPlanByteDigest'),
    targetPath: absolute(source.targetPath, 'targetPath'),
    projectionQuarantinePath: absolute(source.projectionQuarantinePath,
      'projectionQuarantinePath'),
    registrationQuarantinePath: absolute(source.registrationQuarantinePath,
      'registrationQuarantinePath'),
    projectionManifestDigest: digest(source.projectionManifestDigest,
      'projectionManifestDigest'),
    projectionBytes: bound(source.projectionBytes, MAX_PROJECTION_BYTES, 'projectionBytes'),
    projectionEntries: bound(source.projectionEntries, MAX_PROJECTION_ENTRIES,
      'projectionEntries'),
    registrationManifestDigest: digest(source.registrationManifestDigest,
      'registrationManifestDigest'),
    registrationBytes: bound(source.registrationBytes, MAX_REGISTRATION_BYTES,
      'registrationBytes'),
    registrationEntries: bound(source.registrationEntries, MAX_REGISTRATION_ENTRIES,
      'registrationEntries'),
    recoveryInventoryDigest: digest(source.recoveryInventoryDigest, 'recoveryInventoryDigest'),
    recoveryInventoryContentEntries: count(source.recoveryInventoryContentEntries,
      'recoveryInventoryContentEntries'),
    profileDigest: digest(source.profileDigest, 'profileDigest'),
    canonicalRevision: revision(source.canonicalRevision, 'canonicalRevision'),
    peerRegistrationDigest: digest(source.peerRegistrationDigest, 'peerRegistrationDigest'),
    sharedRefDigest: digest(source.sharedRefDigest, 'sharedRefDigest'),
    objectInventoryDigest: digest(source.objectInventoryDigest, 'objectInventoryDigest'),
    sharedStateBytes: bound(source.sharedStateBytes, MAX_PROJECTION_BYTES, 'sharedStateBytes'),
    sharedStateEntries: count(source.sharedStateEntries, 'sharedStateEntries'),
    registeredBefore: source.registeredBefore, registeredAfter: source.registeredAfter,
    targetPathExistsBefore: source.targetPathExistsBefore,
    targetPathExistsAfter: source.targetPathExistsAfter,
    adminBytesRetained: source.adminBytesRetained,
    branchMutationAttempted: source.branchMutationAttempted,
    objectMutationAttempted: source.objectMutationAttempted,
    directoryByteRemovalAttempted: source.directoryByteRemovalAttempted,
    operatingSystemExclusivityProven: source.operatingSystemExclusivityProven,
    result: source.result, executedAt: instant(source.executedAt, 'executedAt') };
  if (payload.registeredBefore !== true || payload.registeredAfter !== false
    || payload.targetPathExistsBefore !== true || payload.targetPathExistsAfter !== false
    || payload.adminBytesRetained !== true || payload.branchMutationAttempted !== false
    || payload.objectMutationAttempted !== false || payload.directoryByteRemovalAttempted !== false
    || payload.operatingSystemExclusivityProven !== false || payload.result !== 'quarantined')
    fail('cleanup receipt postconditions are invalid');
  const receiptDigest = governanceDigest(payload);
  if (source.receiptDigest !== undefined
    && digest(source.receiptDigest, 'receiptDigest') !== receiptDigest)
    fail('cleanup receipt digest is invalid');
  return frozen({ ...payload, receiptDigest });
}

export function validateWorktreeCleanupReceipt(value) {
  const source = snap(value), result = createWorktreeCleanupReceipt(source);
  exact(source, Object.keys(result), 'worktree cleanup receipt');
  if (!same(source, result)) fail('cleanup receipt is not canonical');
  return result;
}
