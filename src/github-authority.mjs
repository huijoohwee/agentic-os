import { canonicalJson, deriveCoordinationClaimId, governanceDigest, validateCoordinationRequest } from './governance.mjs';
import { createExternalAuthorityEvidence, validateExternalAuthorityEvidence } from './authority-record.mjs';
import { validateRecoveryCandidate } from './recovery-candidate.mjs';
export const GITHUB_AUTHORITY_ADAPTER = Object.freeze({ id: 'github-actions-fenced-authority', version: '1' });
export const GITHUB_AUTHORITY_INPUT_SCHEMA = 'agentic-os/github-authority-input/v1';
export const GITHUB_AUTHORITY_CLAIM_COORDINATE_SCHEMA = 'agentic-os/github-authority-claim-coordinate/v1';
export const GITHUB_AUTHORITY_CHALLENGE_SCHEMA = 'agentic-os/github-authority-challenge/v1';
export const FENCED_CLAIM_BUNDLE_SCHEMA = 'agentic-os/github-fenced-claim-bundle/v1';
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368;
const DIGEST = /^[0-9a-f]{64}$/u;
const EFFECT_PLAN = /^effect-plan:sha256:([0-9a-f]{64})$/u;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const USER_ID = /^[1-9][0-9]{0,18}$/u;
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})?$/u;
const REPOSITORY = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const REF_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const POLICY_KEYS = [
  'evidenceRepository', 'targetRepositoryPrefix', 'canonicalRef', 'canonicalRevision',
  'workflowPath', 'workflowRef', 'workflowRevision', 'confirmationClass',
  'requiredStatusChecks', 'allowedMergeMethods', 'evidenceRefPrefix',
  'evidencePathPrefix', 'validitySeconds',
];
const RUN_KEYS = [
  'id', 'locator', 'event', 'runAttempt', 'repository', 'ref', 'revision',
  'workflowPath', 'workflowRef', 'workflowRevision', 'startedAt', 'authorityInputDigest',
  'actor', 'triggeringActor',
];
const CHALLENGE_KEYS = [
  'schema', 'requestDigest', 'authoritySubject', 'candidateDigest',
  'predecessorEvidenceDigest', 'targetRepository', 'policyDigest', 'authorityInputDigest',
  'confirmationClass', 'workflowRunLocator', 'workflowRunDigest', 'issuedAt', 'expiresAt',
  'challengeDigest',
];
const BUNDLE_KEYS = [
  'schema', 'adapter', 'request', 'candidate', 'challenge', 'workflowRun', 'policy',
  'externalEvidence', 'bootstrapAuthorization', 'claimCoordinate', 'evidenceRef',
  'evidencePath', 'bundleDigest',
];
const ALLOWED = ['descendant-commit', 'exact-revalidation', 'new-review', 'nonforce-push'];
const FORBIDDEN = [
  'auto-merge', 'cleanup', 'deletion', 'deploy', 'force-push', 'merge', 'release',
  'reset', 'retire', 'stash',
];
function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function exact(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))
    || (required && keys.some((key) => !Object.hasOwn(value, key)))) fail(`${label} fields are invalid`);
}
function requireKeys(value, keys, label) {
  if (keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
}
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`);
  return value;
}
function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}
function revision(value, label) {
  if (typeof value !== 'string' || !REVISION.test(value)) fail(`${label} must be a full lowercase Git object identifier`);
  return value;
}
function instant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) fail(`${label} must be an exact UTC instant`);
  return result;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
function identifier(value, label) {
  const result = typeof value === 'number' ? String(value) : text(value, label);
  if (!USER_ID.test(result)) fail(`${label} must be a canonical positive identifier`);
  return result;
}
function actor(value, label) {
  exact(value, ['id', 'login'], label);
  const login = text(value.login, `${label}.login`).toLowerCase();
  if (!OWNER.test(login)) fail(`${label}.login is invalid`);
  return { id: identifier(value.id, `${label}.id`), login };
}
function subject(value, label) {
  const result = text(value, label), match = result.match(/^github-user:([1-9][0-9]{0,18})$/u);
  if (!match) fail(`${label} must be github-user:<id>`);
  return { subject: result, id: match[1] };
}
export function parseGitHubRepositoryIdentity(value, label = 'GitHub repository') {
  const result = text(value, label), match = result.match(/^github\.com\/([^/]+)\/([^/]+)$/u);
  if (!match || !OWNER.test(match[1]) || !REPOSITORY.test(match[2])) fail(`${label} must be canonical github.com/<owner>/<repository>`);
  return freeze({ repository: result, owner: match[1], name: match[2] }); }
function targetPrefix(value) {
  const result = text(value, 'policy.targetRepositoryPrefix');
  const match = result.match(/^github\.com\/([^/]+)\/$/u);
  if (!match || !OWNER.test(match[1])) fail('policy.targetRepositoryPrefix must be canonical github.com/<owner>/');
  return result;
}
function branchRef(value, label) {
  const result = text(value, label), prefix = 'refs/heads/';
  const parts = result.startsWith(prefix) ? result.slice(prefix.length).split('/') : [];
  if (!parts.length || parts.some((part) => !REF_PART.test(part)
    || part.endsWith('.') || part.endsWith('.lock'))) fail(`${label} must be a portable refs/heads ref`);
  return result;
}
function refPrefix(value) {
  const result = text(value, 'policy.evidenceRefPrefix');
  if (!result.endsWith('/')) fail('policy.evidenceRefPrefix must end in /');
  branchRef(result.slice(0, -1), 'policy.evidenceRefPrefix');
  return result;
}
function relative(value, label) {
  const result = text(value, label), parts = result.split('/');
  if (result.startsWith('/') || result.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} must be a portable relative path`);
  return result;
}
function pathPrefix(value) {
  const result = text(value, 'policy.evidencePathPrefix');
  if (!result.endsWith('/')) fail('policy.evidencePathPrefix must end in /');
  relative(result.slice(0, -1), 'policy.evidencePathPrefix');
  return result;
}
function policyStrings(value, label, allowed = null) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  const result = value.map((entry) => text(entry, label)).sort();
  if (new Set(result).size !== result.length
    || allowed && result.some((entry) => !allowed.includes(entry)) || !allowed && result.some((entry) => entry.trim() !== entry)) fail(`${label} must be canonical and duplicate-free`);
  return result;
}
function effectPlanDigest(request) {
  const matches = request.dependentWork.map((entry) => entry.match(EFFECT_PLAN)).filter(Boolean);
  if (matches.length !== 1) fail('claim requires exactly one digest-bound effect plan');
  return matches[0][1]; }
export function validateGitHubAuthorityPolicy(value) {
  const source = snap(value);
  exact(source, POLICY_KEYS, 'GitHub authority policy');
  if (!Number.isSafeInteger(source.validitySeconds)
    || source.validitySeconds < 60 || source.validitySeconds > 86_400) fail('policy.validitySeconds must be an integer from 60 through 86400');
  if (!['interactive-provider', 'delegated-provider'].includes(source.confirmationClass)) fail('policy.confirmationClass is invalid');
  const result = {
    evidenceRepository: parseGitHubRepositoryIdentity(source.evidenceRepository, 'policy.evidenceRepository').repository,
    targetRepositoryPrefix: targetPrefix(source.targetRepositoryPrefix),
    canonicalRef: branchRef(source.canonicalRef, 'policy.canonicalRef'),
    canonicalRevision: revision(source.canonicalRevision, 'policy.canonicalRevision'),
    workflowPath: relative(source.workflowPath, 'policy.workflowPath'),
    workflowRef: branchRef(source.workflowRef, 'policy.workflowRef'),
    workflowRevision: revision(source.workflowRevision, 'policy.workflowRevision'),
    confirmationClass: source.confirmationClass,
    requiredStatusChecks: policyStrings(source.requiredStatusChecks, 'policy.requiredStatusChecks'),
    allowedMergeMethods: policyStrings(source.allowedMergeMethods,
      'policy.allowedMergeMethods', ['merge', 'rebase', 'squash']),
    evidenceRefPrefix: refPrefix(source.evidenceRefPrefix),
    evidencePathPrefix: pathPrefix(source.evidencePathPrefix),
    validitySeconds: source.validitySeconds,
  };
  if (canonicalJson(source) !== canonicalJson(result)) fail('GitHub authority policy is not canonical');
  return freeze(result);
}
function assertRequestCandidate(request, candidate, policy) {
  const target = parseGitHubRepositoryIdentity(candidate.targetRepository, 'candidate.targetRepository'),
    canonicalClaimId = deriveCoordinationClaimId(request);
  if (request.requestedTransition !== 'claim'
    || request.ownerSubject !== request.authoritySubject
    || request.claimId !== canonicalClaimId || request.leaseEpoch !== 1
    || request.repository !== target.repository
    || !target.repository.startsWith(policy.targetRepositoryPrefix)
    || request.immutableRevision !== `candidate:sha256:${candidate.candidateDigest}`
    || request.reviewLocator !== candidate.reviewLocator) fail('claim must bind one allowed exact Recovery Candidate');
  effectPlanDigest(request); }
export function deriveGitHubAuthorityInputDigest(input) {
  const source = snap(input);
  exact(source, ['request', 'candidate', 'policy'], 'GitHub authority input');
  const request = validateCoordinationRequest(source.request);
  const candidate = validateRecoveryCandidate(source.candidate);
  const policy = validateGitHubAuthorityPolicy(source.policy);
  assertRequestCandidate(request, candidate, policy);
  return governanceDigest({ schema: GITHUB_AUTHORITY_INPUT_SCHEMA, request, candidate, policy });
}
export function deriveGitHubAuthorityClaimCoordinate(requestValue) {
  const request = validateCoordinationRequest(requestValue);
  return governanceDigest({
    schema: GITHUB_AUTHORITY_CLAIM_COORDINATE_SCHEMA,
    repository: request.repository,
    claimId: request.claimId,
    leaseEpoch: request.leaseEpoch,
    requestedTransition: request.requestedTransition,
  });
}
function workflowRun(value) {
  const source = snap(value);
  exact(source, RUN_KEYS, 'GitHub workflow run');
  const id = identifier(source.id, 'workflowRun.id');
  if (source.event !== 'workflow_dispatch' || source.runAttempt !== 1) fail('workflowRun must be workflow_dispatch with runAttempt 1');
  return freeze({
    id,
    locator: text(source.locator, 'workflowRun.locator'),
    event: source.event,
    runAttempt: 1,
    repository: parseGitHubRepositoryIdentity(
      source.repository, 'workflowRun.repository').repository,
    ref: branchRef(source.ref, 'workflowRun.ref'),
    revision: revision(source.revision, 'workflowRun.revision'),
    workflowPath: relative(source.workflowPath, 'workflowRun.workflowPath'),
    workflowRef: branchRef(source.workflowRef, 'workflowRun.workflowRef'),
    workflowRevision: revision(source.workflowRevision, 'workflowRun.workflowRevision'),
    startedAt: instant(source.startedAt, 'workflowRun.startedAt'),
    authorityInputDigest: digest(source.authorityInputDigest, 'workflowRun.authorityInputDigest'),
    actor: actor(source.actor, 'workflowRun.actor'),
    triggeringActor: actor(source.triggeringActor, 'workflowRun.triggeringActor'),
  });
}
function checkedRun(value, request, candidate, policy) {
  const run = workflowRun(value), owner = subject(request.authoritySubject, 'request.authoritySubject');
  const inputDigest = deriveGitHubAuthorityInputDigest({ request, candidate, policy });
  if (run.repository !== policy.evidenceRepository
    || run.ref !== policy.canonicalRef || run.revision !== policy.canonicalRevision
    || run.workflowPath !== policy.workflowPath || run.workflowRef !== policy.workflowRef
    || run.workflowRevision !== policy.workflowRevision
    || run.actor.id !== run.triggeringActor.id || run.actor.login !== run.triggeringActor.login
    || run.actor.id !== owner.id || run.authorityInputDigest !== inputDigest) fail('workflow run is not bound to the exact policy, authority input, and subject');
  return run;
}
function challengePayload(request, candidate, run, policy, expiresValue) {
  const issuedAt = run.startedAt, expiresAt = instant(expiresValue, 'challenge.expiresAt');
  const issued = Date.parse(issuedAt), expires = Date.parse(expiresAt);
  if (expires <= issued || expires > issued + policy.validitySeconds * 1000
    || issued < Date.parse(request.observedAt) || expires > Date.parse(request.expiresAt)
    || issued < Date.parse(candidate.observedAt) || expires > Date.parse(candidate.expiresAt)) fail('challenge validity must be current-input-bound and within policy validitySeconds');
  return {
    schema: GITHUB_AUTHORITY_CHALLENGE_SCHEMA,
    requestDigest: request.requestDigest,
    authoritySubject: request.authoritySubject,
    candidateDigest: candidate.candidateDigest,
    predecessorEvidenceDigest: candidate.predecessorEvidenceDigest,
    targetRepository: candidate.targetRepository,
    policyDigest: governanceDigest(policy),
    authorityInputDigest: run.authorityInputDigest,
    confirmationClass: policy.confirmationClass,
    workflowRunLocator: run.locator,
    workflowRunDigest: governanceDigest(run),
    issuedAt,
    expiresAt,
  };
}
export function createGitHubAuthorityChallenge(input) {
  const source = snap(input);
  exact(source, ['request', 'candidate', 'workflowRun', 'policy', 'expiresAt',
    'challengeDigest'], 'GitHub authority challenge input', false);
  requireKeys(source, ['request', 'candidate', 'workflowRun', 'policy', 'expiresAt'],
    'GitHub authority challenge input');
  const request = validateCoordinationRequest(source.request);
  const candidate = validateRecoveryCandidate(source.candidate);
  const policy = validateGitHubAuthorityPolicy(source.policy);
  assertRequestCandidate(request, candidate, policy);
  const run = checkedRun(source.workflowRun, request, candidate, policy);
  const payload = challengePayload(request, candidate, run, policy, source.expiresAt);
  const challengeDigest = governanceDigest(payload);
  if (source.challengeDigest !== undefined
    && digest(source.challengeDigest, 'challengeDigest') !== challengeDigest) {
    fail('challengeDigest does not match GitHub authority challenge');
  }
  return freeze({ ...payload, challengeDigest });
}
export function validateGitHubAuthorityChallenge(value) {
  const source = snap(value);
  exact(source, CHALLENGE_KEYS, 'GitHub authority challenge');
  if (source.schema !== GITHUB_AUTHORITY_CHALLENGE_SCHEMA
    || !['interactive-provider', 'delegated-provider'].includes(source.confirmationClass)) {
    fail('GitHub authority challenge schema or confirmationClass is invalid');
  }
  for (const field of ['requestDigest', 'candidateDigest', 'predecessorEvidenceDigest',
    'policyDigest', 'authorityInputDigest', 'workflowRunDigest']) digest(source[field], field);
  subject(source.authoritySubject, 'challenge.authoritySubject');
  parseGitHubRepositoryIdentity(source.targetRepository, 'challenge.targetRepository');
  text(source.workflowRunLocator, 'challenge.workflowRunLocator');
  const issuedAt = instant(source.issuedAt, 'challenge.issuedAt');
  const expiresAt = instant(source.expiresAt, 'challenge.expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) fail('challenge.expiresAt must be after challenge.issuedAt');
  const { challengeDigest, ...payload } = source;
  if (digest(challengeDigest, 'challengeDigest') !== governanceDigest(payload)) {
    fail('GitHub authority challenge is not canonical or exact');
  }
  return freeze(source);
}
function location(request, policy) {
  const claimCoordinate = deriveGitHubAuthorityClaimCoordinate(request);
  return {
    claimCoordinate,
    evidenceRef: `${policy.evidenceRefPrefix}${claimCoordinate}`,
    evidencePath: `${policy.evidencePathPrefix}${claimCoordinate}.json`,
  };
}
function bootstrap(request, candidate, evidence, place, policy, expiresAt) {
  const payload = {
    schema: 'agentic-os/publish-for-review-only-bootstrap-authorization/v1',
    requestDigest: request.requestDigest,
    candidateDigest: candidate.candidateDigest,
    effectPlanDigest: effectPlanDigest(request),
    evidenceReplayKey: evidence.replayKey,
    claimCoordinate: place.claimCoordinate,
    authoritySubject: request.authoritySubject,
    confirmationClass: policy.confirmationClass,
    effectClass: 'publish-for-review-only',
    allowedEffects: [...ALLOWED],
    forbiddenEffects: [...FORBIDDEN],
    evidenceRef: place.evidenceRef,
    evidencePath: place.evidencePath,
    expiresAt,
  };
  return freeze({ ...payload, authorizationDigest: governanceDigest(payload) });
}
function boundParts(request, candidate, challenge, run, policy) {
  if (challenge.requestDigest !== request.requestDigest
    || challenge.authoritySubject !== request.authoritySubject
    || challenge.candidateDigest !== candidate.candidateDigest
    || challenge.predecessorEvidenceDigest !== candidate.predecessorEvidenceDigest
    || challenge.targetRepository !== candidate.targetRepository
    || challenge.policyDigest !== governanceDigest(policy)
    || challenge.authorityInputDigest !== run.authorityInputDigest
    || challenge.confirmationClass !== policy.confirmationClass
    || challenge.workflowRunLocator !== run.locator
    || challenge.workflowRunDigest !== governanceDigest(run)) {
    fail('challenge is not bound to the request, candidate, policy, input, and workflow run');
  }
  const responseDigest = governanceDigest({
    schema: 'agentic-os/github-actions-dispatch-response/v1',
    workflowRunDigest: governanceDigest(run),
    authorityInputDigest: run.authorityInputDigest,
    actor: run.actor,
    policyDigest: challenge.policyDigest,
    candidateDigest: candidate.candidateDigest,
  });
  return validateExternalAuthorityEvidence(request, createExternalAuthorityEvidence(request, {
    adapter: GITHUB_AUTHORITY_ADAPTER,
    authenticatedSubject: request.authoritySubject,
    providerRecordLocator: run.locator,
    providerRecordDigest: governanceDigest(run),
    challengeDigest: challenge.challengeDigest,
    responseDigest,
    candidateInventoryDigest: candidate.workingStateDigest,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  }));
}
export function createFencedClaimBundle(input) {
  const source = snap(input);
  exact(source, ['request', 'candidate', 'challenge', 'workflowRun', 'policy'],
    'GitHub fenced claim bundle input');
  const request = validateCoordinationRequest(source.request);
  const candidate = validateRecoveryCandidate(source.candidate);
  const policy = validateGitHubAuthorityPolicy(source.policy);
  assertRequestCandidate(request, candidate, policy);
  const run = checkedRun(source.workflowRun, request, candidate, policy);
  const challenge = validateGitHubAuthorityChallenge(source.challenge);
  const evidence = boundParts(request, candidate, challenge, run, policy);
  const place = location(request, policy);
  const payload = {
    schema: FENCED_CLAIM_BUNDLE_SCHEMA,
    adapter: { ...GITHUB_AUTHORITY_ADAPTER },
    request,
    candidate,
    challenge,
    workflowRun: run,
    policy,
    externalEvidence: evidence,
    bootstrapAuthorization: bootstrap(
      request, candidate, evidence, place, policy, challenge.expiresAt),
    claimCoordinate: place.claimCoordinate,
    evidenceRef: place.evidenceRef,
    evidencePath: place.evidencePath,
  };
  return freeze({ ...payload, bundleDigest: governanceDigest(payload) });
}
export function validateFencedClaimBundle(value) {
  const source = snap(value);
  exact(source, BUNDLE_KEYS, 'GitHub fenced claim bundle');
  if (source.schema !== FENCED_CLAIM_BUNDLE_SCHEMA
    || canonicalJson(source.adapter) !== canonicalJson(GITHUB_AUTHORITY_ADAPTER)) {
    fail('GitHub fenced claim bundle schema or adapter is invalid');
  }
  const expected = createFencedClaimBundle({
    request: source.request,
    candidate: source.candidate,
    challenge: source.challenge,
    workflowRun: source.workflowRun,
    policy: source.policy,
  });
  if (digest(source.bundleDigest, 'bundleDigest') !== expected.bundleDigest
    || canonicalJson(source) !== canonicalJson(expected)) {
    fail('GitHub fenced claim bundle is not canonical or exact');
  }
  return expected;
}
