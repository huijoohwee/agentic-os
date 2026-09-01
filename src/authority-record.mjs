/** Provider-neutral, externally authenticated authority evidence record. No I/O or clock. */
import {
  canonicalJson,
  governanceDigest,
  validateCoordinationRequest,
} from './governance.mjs';

export const EXTERNAL_AUTHORITY_EVIDENCE_SCHEMA = 'agentic-os/external-authority-evidence/v1';
export const EXTERNAL_AUTHORITY_REPLAY_KEY_SCHEMA = 'agentic-os/external-authority-replay-key/v1';

const DIGEST = /^[0-9a-f]{64}$/u;
const EVIDENCE_KEYS = Object.freeze([
  'schema', 'requestDigest', 'adapter', 'authenticatedSubject', 'providerRecordLocator',
  'providerRecordDigest', 'challengeDigest', 'responseDigest', 'candidateInventoryDigest',
  'issuedAt', 'expiresAt', 'replayKey', 'evidenceDigest',
]);
const CREATION_REQUIRED_KEYS = Object.freeze([
  'adapter', 'authenticatedSubject', 'providerRecordLocator', 'providerRecordDigest',
  'challengeDigest', 'responseDigest', 'candidateInventoryDigest', 'issuedAt', 'expiresAt',
]);
const REPLAY_KEYS = Object.freeze(['adapter', 'providerRecordLocator', 'challengeDigest']);

function fail(message) { throw new TypeError(message); }

function snapshot(value) {
  return JSON.parse(canonicalJson(value));
}

function exactKeys(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.some((key) => !keys.includes(key))
    || (required && keys.some((key) => !Object.hasOwn(value, key)))) {
    fail(`${label} fields are invalid`);
  }
}

function requiredKeys(value, keys, label) {
  if (keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4096)
    fail(`${label} must be a bounded non-empty string`);
  return value;
}

function digest(value, label) {
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

function adapter(value) {
  exactKeys(value, ['id', 'version'], 'adapter');
  return { id: text(value.id, 'adapter.id'), version: text(value.version, 'adapter.version') };
}

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

function replayKeyFor(request, source) {
  const replay = snapshot({
    adapter: source.adapter,
    providerRecordLocator: source.providerRecordLocator,
    challengeDigest: source.challengeDigest,
  });
  exactKeys(replay, REPLAY_KEYS, 'External Authority replay input');
  return governanceDigest({
    schema: EXTERNAL_AUTHORITY_REPLAY_KEY_SCHEMA,
    requestDigest: request.requestDigest,
    adapter: adapter(replay.adapter),
    providerRecordLocator: text(replay.providerRecordLocator, 'providerRecordLocator'),
    challengeDigest: digest(replay.challengeDigest, 'challengeDigest'),
  });
}

/** Derive a replay fence from the immutable request and provider challenge coordinates. */
export function deriveExternalAuthorityReplayKey(requestValue, input) {
  return replayKeyFor(validateCoordinationRequest(requestValue), input);
}

export const createExternalAuthorityReplayKey = deriveExternalAuthorityReplayKey;

function normalizedEvidence(request, input, { complete } = {}) {
  const source = snapshot(input);
  exactKeys(source, EVIDENCE_KEYS, 'External Authority Evidence', complete === true);
  requiredKeys(source, CREATION_REQUIRED_KEYS, 'External Authority Evidence');
  if (source.schema !== undefined && source.schema !== EXTERNAL_AUTHORITY_EVIDENCE_SCHEMA)
    fail('External Authority Evidence schema is invalid');
  if (source.requestDigest !== undefined && source.requestDigest !== request.requestDigest)
    fail('requestDigest does not match the Coordination Request');

  const issuedAt = instant(source.issuedAt, 'issuedAt');
  const expiresAt = instant(source.expiresAt, 'expiresAt');
  const issued = Date.parse(issuedAt), expires = Date.parse(expiresAt);
  if (expires <= issued) fail('expiresAt must be after issuedAt');
  if (issued < Date.parse(request.observedAt) || expires > Date.parse(request.expiresAt))
    fail('External Authority Evidence validity must be nested in the Coordination Request window');

  const result = {
    schema: EXTERNAL_AUTHORITY_EVIDENCE_SCHEMA,
    requestDigest: request.requestDigest,
    adapter: adapter(source.adapter),
    authenticatedSubject: text(source.authenticatedSubject, 'authenticatedSubject'),
    providerRecordLocator: text(source.providerRecordLocator, 'providerRecordLocator'),
    providerRecordDigest: digest(source.providerRecordDigest, 'providerRecordDigest'),
    challengeDigest: digest(source.challengeDigest, 'challengeDigest'),
    responseDigest: digest(source.responseDigest, 'responseDigest'),
    candidateInventoryDigest: digest(source.candidateInventoryDigest, 'candidateInventoryDigest'),
    issuedAt,
    expiresAt,
    replayKey: replayKeyFor(request, source),
  };
  if (result.authenticatedSubject !== request.authoritySubject)
    fail('authenticatedSubject must match the Coordination Request authoritySubject');
  if (source.replayKey !== undefined && digest(source.replayKey, 'replayKey') !== result.replayKey)
    fail('replayKey does not match the immutable replay coordinates');
  return { source, result };
}

/** Construct a deterministic record; external authentication is verified by the embedding. */
export function createExternalAuthorityEvidence(requestValue, input) {
  const request = validateCoordinationRequest(requestValue);
  const { source, result } = normalizedEvidence(request, input);
  const evidenceDigest = governanceDigest(result);
  if (source.evidenceDigest !== undefined && digest(source.evidenceDigest, 'evidenceDigest') !== evidenceDigest)
    fail('evidenceDigest does not match External Authority Evidence');
  return frozen({ ...result, evidenceDigest });
}

/** Validate one exact evidence record against one exact Coordination Request. */
export function validateExternalAuthorityEvidence(requestValue, value) {
  const request = validateCoordinationRequest(requestValue);
  const { source, result } = normalizedEvidence(request, value, { complete: true });
  const evidenceDigest = digest(source.evidenceDigest, 'evidenceDigest');
  if (evidenceDigest !== governanceDigest(result))
    fail('evidenceDigest does not match External Authority Evidence');
  const normalized = { ...result, evidenceDigest };
  if (canonicalJson(source) !== canonicalJson(normalized))
    fail('External Authority Evidence is not canonical');
  return frozen(normalized);
}

/** Return false, rather than granting by exception, when evidence is not bound to this request. */
export function isEvidenceBoundToRequest(requestValue, value) {
  try {
    const request = validateCoordinationRequest(requestValue);
    const evidence = validateExternalAuthorityEvidence(request, value);
    return evidence.requestDigest === request.requestDigest
      && evidence.authenticatedSubject === request.authoritySubject
      && Date.parse(evidence.issuedAt) >= Date.parse(request.observedAt)
      && Date.parse(evidence.expiresAt) <= Date.parse(request.expiresAt);
  } catch {
    return false;
  }
}
