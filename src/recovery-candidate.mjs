/**
 * A bounded, portable description of one observed recovery candidate.
 *
 * This module deliberately receives an observation value instead of reading a
 * worktree.  The caller owns collection; this record only binds the result.
 * It carries only inventory counts and digests, never authored bytes,
 * per-path manifests, or filesystem locations.
 */
import { canonicalJson, governanceDigest } from './governance.mjs';
import { RECOVERY_INVENTORY_ALGORITHM } from './recovery-inventory.mjs';

export const RECOVERY_CANDIDATE_SCHEMA = 'agentic-os/recovery-candidate/v1';
export const RECOVERY_WORKING_STATE_SCHEMA = 'agentic-os/recovery-working-state/v1';
export const RECOVERY_CANDIDATE_INVENTORY_ALGORITHM = RECOVERY_INVENTORY_ALGORITHM;

const DIGEST = /^[0-9a-f]{64}$/u;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const INVENTORY_ENTRY_KEYS = Object.freeze([
  'index',
  'tracked',
  'visibleUntracked',
  'hidden',
  'ignoredRuntime',
  'content',
]);
const RECORD_KEYS = Object.freeze([
  'schema',
  'targetRepository',
  'branch',
  'canonicalBranch',
  'headRevision',
  'canonicalRevision',
  'reviewLocator',
  'predecessorEvidenceDigest',
  'inventoryAlgorithm',
  'inventoryEntries',
  'indexInventoryDigest',
  'trackedInventoryDigest',
  'visibleUntrackedInventoryDigest',
  'hiddenInventoryDigest',
  'ignoredRuntimeInventoryDigest',
  'contentInventoryDigest',
  'workingStateDigest',
  'observedAt',
  'expiresAt',
  'candidateDigest',
]);
const OBSERVATION_KEYS = Object.freeze(RECORD_KEYS.filter((key) => ![
  'schema', 'workingStateDigest', 'candidateDigest',
].includes(key)));
const ABSOLUTE_PATH = /^(?:\/|\\|[A-Za-z]:[\\/])/u;
const FORBIDDEN_REF = /[\u0000-\u0020\u007f~^:?*[\\]/u;

function fail(message) { throw new TypeError(message); }

/** Snapshot through governance so proxies, accessors, aliases, and budgets fail closed. */
function snapshot(value) {
  return JSON.parse(canonicalJson(value));
}

function exactKeys(value, keys, label, requireAll = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.some((key) => !keys.includes(key))
    || (requireAll && keys.some((key) => !Object.hasOwn(value, key)))) {
    fail(`${label} fields are invalid`);
  }
}

function requiredKeys(value, keys, label) {
  if (keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
}

function text(value, label, { nullable = false, maxBytes = 4096 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}

function utcInstant(value, label) {
  const result = text(value, label);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) {
    fail(`${label} must be an exact UTC instant`);
  }
  return result;
}

function noAbsolutePath(value, label) {
  const result = text(value, label);
  if (ABSOLUTE_PATH.test(result) || /^file:/iu.test(result)) {
    fail(`${label} must not be an absolute filesystem location`);
  }
  return result;
}

function repository(value) {
  const result = noAbsolutePath(value, 'targetRepository');
  if (result.includes('\\')) fail('targetRepository must be a portable repository identity');
  return result;
}

/** A short branch name avoids ambiguity with filesystem locations and remote refs. */
function branch(value, label = 'branch') {
  const result = noAbsolutePath(value, label);
  const components = result.split('/');
  if (result.startsWith('refs/') || result === 'HEAD' || result.includes('//') || result.includes('..')
    || result.includes('@{') || components.some((part) => !part || part === '.' || part === '..'
      || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock') || FORBIDDEN_REF.test(part))) {
    fail(`${label} must be a portable short Git branch name`);
  }
  return result;
}

function revision(value, label) {
  if (typeof value !== 'string' || !REVISION.test(value)) {
    fail(`${label} must be a full lowercase Git object identifier`);
  }
  return value;
}

function reviewLocator(value) {
  if (value === null) return null;
  return noAbsolutePath(value, 'reviewLocator');
}

function entryCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function inventoryEntries(value) {
  exactKeys(value, INVENTORY_ENTRY_KEYS, 'inventoryEntries');
  const result = Object.fromEntries(INVENTORY_ENTRY_KEYS.map((key) => [
    key, entryCount(value[key], `inventoryEntries.${key}`),
  ]));
  const content = result.tracked + result.visibleUntracked + result.ignoredRuntime;
  if (!Number.isSafeInteger(content) || result.content !== content) {
    fail('inventoryEntries.content must equal tracked plus visibleUntracked plus ignoredRuntime');
  }
  if (result.hidden > result.tracked) {
    fail('inventoryEntries.hidden must not exceed tracked');
  }
  if (result.index < result.tracked) {
    fail('inventoryEntries.index must not be less than tracked');
  }
  return result;
}

function inventoryAlgorithm(value) {
  if (value !== RECOVERY_CANDIDATE_INVENTORY_ALGORITHM) {
    fail('inventoryAlgorithm is unsupported');
  }
  return value;
}

function workingStatePayload(source) {
  const headRevision = revision(source.headRevision, 'headRevision');
  return {
    schema: RECOVERY_WORKING_STATE_SCHEMA,
    inventoryAlgorithm: inventoryAlgorithm(source.inventoryAlgorithm),
    objectFormat: headRevision.length === 40 ? 'sha1' : 'sha256',
    headRevision,
    indexInventoryDigest: digest(source.indexInventoryDigest, 'indexInventoryDigest'),
    trackedInventoryDigest: digest(source.trackedInventoryDigest, 'trackedInventoryDigest'),
    visibleUntrackedInventoryDigest: digest(source.visibleUntrackedInventoryDigest,
      'visibleUntrackedInventoryDigest'),
    hiddenInventoryDigest: digest(source.hiddenInventoryDigest, 'hiddenInventoryDigest'),
    ignoredRuntimeInventoryDigest: digest(source.ignoredRuntimeInventoryDigest,
      'ignoredRuntimeInventoryDigest'),
    contentInventoryDigest: digest(source.contentInventoryDigest, 'contentInventoryDigest'),
    inventoryEntries: inventoryEntries(source.inventoryEntries),
  };
}

/** Derive the reusable identity of HEAD, index, worktree, hidden, and ignored state. */
export function deriveRecoveryWorkingStateDigest(value) {
  return governanceDigest(workingStatePayload(snapshot(value)));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function payload(input) {
  const source = snapshot(input);
  exactKeys(source, RECORD_KEYS, 'Recovery Candidate input', false);
  requiredKeys(source, OBSERVATION_KEYS, 'Recovery Candidate input');
  if (source.schema !== undefined && source.schema !== RECOVERY_CANDIDATE_SCHEMA) {
    fail('Recovery Candidate schema is invalid');
  }
  const workingState = workingStatePayload(source);
  const workingStateDigest = governanceDigest(workingState);
  if (source.workingStateDigest !== undefined
    && digest(source.workingStateDigest, 'workingStateDigest') !== workingStateDigest) {
    fail('workingStateDigest does not match Recovery Candidate working state');
  }
  const { headRevision } = workingState;
  const canonicalRevision = revision(source.canonicalRevision, 'canonicalRevision');
  if (headRevision.length !== canonicalRevision.length) {
    fail('headRevision and canonicalRevision must use one object identifier format');
  }
  const observedAt = utcInstant(source.observedAt, 'observedAt');
  const expiresAt = utcInstant(source.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) fail('expiresAt must be after observedAt');
  return {
    schema: RECOVERY_CANDIDATE_SCHEMA,
    targetRepository: repository(source.targetRepository),
    branch: branch(source.branch),
    canonicalBranch: branch(source.canonicalBranch, 'canonicalBranch'),
    headRevision,
    canonicalRevision,
    reviewLocator: reviewLocator(source.reviewLocator),
    predecessorEvidenceDigest: digest(source.predecessorEvidenceDigest, 'predecessorEvidenceDigest'),
    inventoryAlgorithm: workingState.inventoryAlgorithm,
    inventoryEntries: workingState.inventoryEntries,
    indexInventoryDigest: workingState.indexInventoryDigest,
    trackedInventoryDigest: workingState.trackedInventoryDigest,
    visibleUntrackedInventoryDigest: workingState.visibleUntrackedInventoryDigest,
    hiddenInventoryDigest: workingState.hiddenInventoryDigest,
    ignoredRuntimeInventoryDigest: workingState.ignoredRuntimeInventoryDigest,
    contentInventoryDigest: workingState.contentInventoryDigest,
    workingStateDigest,
    observedAt,
    expiresAt,
  };
}

/** Create one canonical, immutable candidate record from an explicit observation. */
export function createRecoveryCandidate(input) {
  const source = snapshot(input);
  const candidate = payload(source);
  const candidateDigest = governanceDigest(candidate);
  if (source.candidateDigest !== undefined) {
    digest(source.candidateDigest, 'candidateDigest');
    if (source.candidateDigest !== candidateDigest) {
      fail('candidateDigest does not match Recovery Candidate');
    }
  }
  return freeze({ ...candidate, candidateDigest });
}

/** Validate a received record without accepting reordered, omitted, or repaired fields. */
export function validateRecoveryCandidate(value) {
  const source = snapshot(value);
  exactKeys(source, RECORD_KEYS, 'Recovery Candidate');
  if (source.schema !== RECOVERY_CANDIDATE_SCHEMA) fail('Recovery Candidate schema is invalid');
  const normalized = createRecoveryCandidate(source);
  if (canonicalJson(source) !== canonicalJson(normalized)) {
    fail('Recovery Candidate is not canonical');
  }
  return normalized;
}
