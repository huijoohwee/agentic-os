/** Canonical GitHub transition inputs, CAS coordinates, and stored winner records. */
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest, validateCoordinationRequest } from './governance.mjs';
import { validateEffectPlan } from './completion.mjs';
import { GITHUB_RETROSPECTIVE_RECOVERY_MODE,
  parseGitHubRepositoryIdentity } from './github-authority.mjs';
import { validateGitHubAuthorityIssuance } from './github-authority-issuer.mjs';
import { CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS,
  INTEGRATION_RECORD_RETAINED_EFFECTS, RETAINED_EFFECTS } from './cleanup-records.mjs';
import { assertGitHubTransitionPolicyTarget, validateGitHubTransitionPolicy,
  validateGitHubTransitionPolicyExecution } from './github-transition-policy.mjs';
export const GITHUB_TRANSITION_READ_ADAPTER = Object.freeze({
  id: 'github-transition-rest-cas-verifier', version: '1',
});
/** Opt in only to recording an exact merge that provider evidence predates current authority. */
export const GITHUB_RETROSPECTIVE_INTEGRATION_MODE = GITHUB_RETROSPECTIVE_RECOVERY_MODE;
export const GITHUB_TRANSITION_INPUT_SCHEMA = 'agentic-os/transition-operation-input/v1';
export const GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA = 'agentic-os/github-successor-predecessor/v1';
export const GITHUB_TRANSITION_COORDINATE_SCHEMA = 'agentic-os/github-transition-coordinate/v1';
export const GITHUB_STORED_TRANSITION_SCHEMA = 'agentic-os/github-stored-transition/v1';
const API_ORIGIN = 'https://api.github.com';
const MAX_WORKFLOW_INPUT_BYTES = 65_535;
const MAX_OPERATION_PAYLOAD_BYTES = MAX_WORKFLOW_INPUT_BYTES - 64;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const DIGEST = /^[0-9a-f]{64}$/u, REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ID = /^[1-9][0-9]{0,18}$/u;
const REF_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const INPUT_KEYS = ['request', 'plan', 'planByteDigest', 'predecessorIssuance',
  'predecessorAuthority'];
const RECOVERY_INPUT_KEYS = [...INPUT_KEYS, 'integrationMode'];
const OPERATION_INPUT_KEYS = ['schema', 'request', 'plan', 'planByteDigest',
  'predecessorIssuance', 'predecessorAuthority'];
const RECOVERY_OPERATION_INPUT_KEYS = [...OPERATION_INPUT_KEYS, 'integrationMode'];
const EVENT_INPUT_KEYS = ['operation_payload', 'operation_input_digest'];
const RUN_KEYS = ['id', 'url', 'ref', 'revision', 'workflowRef', 'workflowPath',
  'workflowRevision', 'authoritySubject'];
const STORED_KEYS = ['schema', 'authorityRepository', 'targetRepository', 'coordinate',
  'evidenceRef', 'evidencePath', 'operationInput', 'operationInputDigest', 'workflowRun',
  'workflowStartedAt', 'workflowCompletedAt', 'policy', 'providerProof',
  'providerProofDigest', 'storedDigest'];
const SUCCESSOR_PREDECESSOR_KEYS = ['schema', 'authorityKind', 'authorityRef', 'reviewLocator',
  'sourceBranch', 'immutableRevision', 'reviewedSourceHead', 'reviewedSourceTree', 'protectedBase',
  'predecessorIssuanceDigest', 'predecessorTransitionReceiptDigest', 'adoptedTerminalClaimId',
  'adoptedLineageDigest', 'integrationReceiptDigest', 'reviewRequestId', 'retirementReason',
  'adoptionDisposition', 'cloudMutation', 'issuedAt', 'expiresAt'];
function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function exact(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))
    || required && keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
}
function text(value, label) { if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
  || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`); return value; }
function digest(value, label) { if (typeof value !== 'string' || !DIGEST.test(value))
  fail(`${label} must be a sha256 digest`); return value; }
function revision(value, label) { if (typeof value !== 'string' || !REVISION.test(value))
  fail(`${label} must be a full Git revision`); return value; }
function instant(value, label) {
  const parsed = Date.parse(text(value, label));
  if (!Number.isFinite(parsed)) fail(`${label} must be a UTC instant`);
  return new Date(parsed).toISOString();
}
function identifier(value, label) { const result = String(value); if (!ID.test(result))
  fail(`${label} must be a positive identifier`); return result; }
function boolean(value, label) { if (typeof value !== 'boolean') fail(`${label} must be boolean`); return value; }
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze); return Object.freeze(value); }
function branch(value, label) {
  const result = text(value, label), prefix = 'refs/heads/';
  const parts = result.startsWith(prefix) ? result.slice(prefix.length).split('/') : [];
  if (!parts.length || parts.some((part) => !REF_PART.test(part)
    || part.endsWith('.') || part.endsWith('.lock'))) fail(`${label} must be a portable branch ref`);
  return freeze(result);
}
function relative(value, label) { const result = text(value, label), parts = result.split('/');
  if (result.startsWith('/') || result.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} is invalid`);
  return result; }
function workflowPayload(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_OPERATION_PAYLOAD_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value)) fail('operation_payload must be a bounded UTF-8 JSON string');
  return value;
}
function authoritySubject(value) {
  const result = text(value, 'workflowRun.authoritySubject');
  const match = result.match(/^github-user:([1-9][0-9]{0,18})$/u);
  if (!match) fail('workflowRun.authoritySubject must be github-user:<id>');
  return { value: result, id: match[1] };
}
function repository(value) {
  const result = parseGitHubRepositoryIdentity(value, 'transition repository');
  return { ...result, path: `/repos/${encodeURIComponent(result.owner)}/${encodeURIComponent(result.name)}` };
}
function operation(value) { if (!['integrate', 'retire'].includes(value))
  fail('requestedTransition must be integrate or retire'); return value; }
function closedEffects(plan, requestedTransition) {
  const integrating = requestedTransition === 'integrate';
  const effectClass = integrating ? 'protected-integration-record'
    : 'claim-retirement-with-cleanup';
  const allowedEffects = integrating ? INTEGRATION_RECORD_EFFECTS
    : [...CLEANUP_EFFECTS, 'retire-claim'].sort();
  const forbiddenEffects = integrating ? INTEGRATION_RECORD_RETAINED_EFFECTS : RETAINED_EFFECTS;
  if (plan.effectClass !== effectClass
    || canonicalJson(plan.allowedEffects) !== canonicalJson(allowedEffects)
    || canonicalJson(plan.forbiddenEffects) !== canonicalJson(forbiddenEffects))
    fail('GitHub transition effect plan is not one closed lifecycle operation');
}
function successorPredecessor(value, request, plan) {
  const source = snap(value);
  exact(source, SUCCESSOR_PREDECESSOR_KEYS, 'GitHub successor predecessor authority');
  if (source.schema !== GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA)
    fail('GitHub successor predecessor authority schema is invalid');
  const issuedAt = instant(source.issuedAt, 'successorPredecessor.issuedAt');
  const expiresAt = instant(source.expiresAt, 'successorPredecessor.expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt))
    fail('GitHub successor predecessor authority window is invalid');
  const prefix = 'successorPredecessor.';
  const authority = freeze({ schema: GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA,
    authorityKind: text(source.authorityKind, `${prefix}authorityKind`),
    authorityRef: branch(source.authorityRef, 'successorPredecessor.authorityRef'),
    reviewLocator: text(source.reviewLocator, 'successorPredecessor.reviewLocator'),
    sourceBranch: text(source.sourceBranch, 'successorPredecessor.sourceBranch'),
    immutableRevision: revision(source.immutableRevision, `${prefix}immutableRevision`),
    reviewedSourceHead: revision(source.reviewedSourceHead, `${prefix}reviewedSourceHead`),
    reviewedSourceTree: revision(source.reviewedSourceTree, `${prefix}reviewedSourceTree`),
    protectedBase: revision(source.protectedBase, `${prefix}protectedBase`),
    predecessorIssuanceDigest: digest(source.predecessorIssuanceDigest, `${prefix}predecessorIssuanceDigest`),
    predecessorTransitionReceiptDigest: digest(source.predecessorTransitionReceiptDigest, `${prefix}predecessorTransitionReceiptDigest`),
    adoptedTerminalClaimId: digest(source.adoptedTerminalClaimId, `${prefix}adoptedTerminalClaimId`),
    adoptedLineageDigest: digest(source.adoptedLineageDigest, `${prefix}adoptedLineageDigest`),
    integrationReceiptDigest: digest(source.integrationReceiptDigest, `${prefix}integrationReceiptDigest`),
    reviewRequestId: text(source.reviewRequestId, `${prefix}reviewRequestId`),
    retirementReason: text(source.retirementReason, `${prefix}retirementReason`),
    adoptionDisposition: text(source.adoptionDisposition, `${prefix}adoptionDisposition`),
    cloudMutation: boolean(source.cloudMutation, `${prefix}cloudMutation`),
    issuedAt, expiresAt });
  if (authority.cloudMutation !== false || authority.reviewLocator !== request.reviewLocator
    || authority.immutableRevision !== request.immutableRevision || plan.target.resource !== authority.reviewLocator
    || plan.target.immutableRevision !== authority.immutableRevision
    || plan.authority.predecessorDigest !== authority.predecessorTransitionReceiptDigest
    || Date.parse(request.observedAt) < Date.parse(authority.issuedAt)
    || Date.parse(request.expiresAt) > Date.parse(authority.expiresAt)) {
    fail('integrate does not bind the exact successor predecessor authority');
  }
  return authority;
}
function predecessor(source, request, plan) {
  if (request.requestedTransition === 'retire') return source.predecessorIssuance === null
      && !Object.hasOwn(source, 'predecessorAuthority')
    ? { predecessorIssuance: null, predecessorAuthority: null }
    : fail('retire locates its predecessor by the exact source fence');
  const hasIssuance = Object.hasOwn(source, 'predecessorIssuance') && source.predecessorIssuance !== null;
  const hasSuccessorAuthority = Object.hasOwn(source, 'predecessorAuthority');
  if (hasIssuance === hasSuccessorAuthority)
    fail('integrate requires exactly one predecessor source');
  if (hasIssuance) {
    const issuance = validateGitHubAuthorityIssuance(source.predecessorIssuance);
    const bundle = issuance.storedBundle.authorityBundle;
    const transition = issuance.transitionReceipt, candidate = bundle.candidate;
    if (transition.resultClaimId !== request.claimId
      || transition.resultLeaseEpoch !== request.leaseEpoch
      || transition.resultFenceRevision !== request.fenceRevision
      || transition.authoritySubject !== request.authoritySubject
      || bundle.request.ownerSubject !== request.ownerSubject
      || bundle.request.repository !== request.repository
      || bundle.request.writeSetDigest !== request.writeSetDigest
      || candidate.reviewLocator !== request.reviewLocator
      || plan.authority.predecessorDigest !== transition.receiptDigest
      || plan.candidateDigest !== candidate.candidateDigest
      || plan.snapshotDigest !== candidate.workingStateDigest
      || Date.parse(request.observedAt) < Date.parse(issuance.publicationReceipt.committedAt)
      || Date.parse(request.expiresAt) > Date.parse(bundle.challenge.expiresAt)) {
      fail('integrate does not bind the exact predecessor GitHub authority issuance');
    }
    return { predecessorIssuance: issuance, predecessorAuthority: null };
  }
  return { predecessorIssuance: null, predecessorAuthority:
    successorPredecessor(source.predecessorAuthority, request, plan) };
}
function integrationMode(source, request, predecessorSource) {
  if (!Object.hasOwn(source, 'integrationMode')) return null;
  if (source.integrationMode !== GITHUB_RETROSPECTIVE_INTEGRATION_MODE || request.requestedTransition !== 'integrate')
    fail('retrospective recovery requires an integrate request whose initial review was already merged');
  if (predecessorSource.predecessorIssuance !== null && (predecessorSource.predecessorIssuance.storedBundle.authorityBundle.challenge.issuanceMode
      !== GITHUB_RETROSPECTIVE_RECOVERY_MODE
    || predecessorSource.predecessorIssuance.storedBundle.targetRepository.review?.state !== 'merged')) {
    fail('retrospective recovery requires an integrate request whose initial review was already merged');
  }
  return GITHUB_RETROSPECTIVE_INTEGRATION_MODE;
  }
export function validateGitHubTransitionWorkflowRun(value, authorityRepository) {
  const repo = repository(authorityRepository);
  const source = snap(value);
  exact(source, RUN_KEYS, 'transition workflow run');
  const id = identifier(source.id, 'workflowRun.id');
  const result = { id, url: text(source.url, 'workflowRun.url'), ref: branch(source.ref, 'workflowRun.ref'),
    revision: revision(source.revision, 'workflowRun.revision'),
    workflowRef: branch(source.workflowRef, 'workflowRun.workflowRef'),
    workflowPath: relative(source.workflowPath, 'workflowRun.workflowPath'),
    workflowRevision: revision(source.workflowRevision, 'workflowRun.workflowRevision'),
    authoritySubject: authoritySubject(source.authoritySubject).value,
  };
  const expectedUrl = `${API_ORIGIN}${repo.path}/actions/runs/${id}`;
  if (result.url !== expectedUrl || result.workflowRef !== result.ref
    || result.workflowRevision !== result.revision)
    fail('workflowRun must bind one exact GitHub API run, ref, and revision');
  return result;
}
export function deriveGitHubTransitionRunName(value) {
  const source = snap(value);
  exact(source, ['operationInputDigest', 'workflowRevision'], 'GitHub transition run-name input');
  return `ADLC transition ${digest(source.operationInputDigest,
    'operationInputDigest')} @ ${revision(source.workflowRevision, 'workflowRevision')}`;
}
export function validateGitHubTransitionInput(value) {
  const source = snap(value);
  const recovery = Object.hasOwn(source, 'integrationMode');
  exact(source, recovery ? RECOVERY_OPERATION_INPUT_KEYS : OPERATION_INPUT_KEYS, 'GitHub transition operation input', false);
  for (const key of ['schema', 'request', 'plan', 'planByteDigest', 'predecessorIssuance'])
    if (!Object.hasOwn(source, key)) fail('GitHub transition operation input fields are invalid');
  if (source.schema !== GITHUB_TRANSITION_INPUT_SCHEMA)
    fail('GitHub transition operation input schema is invalid');
  const request = validateCoordinationRequest(source.request), plan = validateEffectPlan(source.plan);
  const requestedTransition = operation(request.requestedTransition), authority = plan.authority;
  closedEffects(plan, requestedTransition);
  const planByteDigest = digest(source.planByteDigest, 'planByteDigest');
  const canonicalPlanByteDigest = createHash('sha256').update(canonicalJson(plan)).digest('hex');
  const references = request.dependentWork.map((entry) => entry.match(/^effect-plan:sha256:([0-9a-f]{64})$/u)).filter(Boolean);
  if (plan.target.repository !== request.repository
    || plan.target.immutableRevision !== request.immutableRevision
    || authority.requestedTransition !== requestedTransition
    || authority.authoritySubject !== request.authoritySubject
    || authority.ownerSubject !== request.ownerSubject || authority.claimId !== request.claimId
    || authority.leaseEpoch !== request.leaseEpoch || authority.fenceRevision !== request.fenceRevision
    || authority.writeSetDigest !== request.writeSetDigest
    || authority.reviewLocator !== request.reviewLocator
    || planByteDigest !== canonicalPlanByteDigest
    || references.length !== 1 || references[0][1] !== planByteDigest
    || request.leaseEpoch >= Number.MAX_SAFE_INTEGER)
    fail('GitHub transition operation input does not bind one safe exact plan transition');
  const predecessorSource = predecessor(source, request, plan);
  const mode = integrationMode(source, request, predecessorSource);
  const result = Object.freeze({ schema: GITHUB_TRANSITION_INPUT_SCHEMA, request, plan, planByteDigest,
    ...(predecessorSource.predecessorIssuance === null ? { predecessorIssuance: null }
      : { predecessorIssuance: predecessorSource.predecessorIssuance }),
    ...(predecessorSource.predecessorAuthority === null ? {}
      : { predecessorAuthority: predecessorSource.predecessorAuthority }),
    ...(mode === null ? {} : { integrationMode: mode }) });
  const encoded = canonicalJson(result);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_OPERATION_PAYLOAD_BYTES
    || /[\u0000-\u001f\u007f]/u.test(encoded))
    fail('GitHub transition operation payload exceeds the workflow input bound');
  return result;
}
export function encodeGitHubTransitionInput(value) {
  return Buffer.from(canonicalJson(validateGitHubTransitionInput(value)), 'utf8');
}
export function validateGitHubTransitionInputBytes(value) {
  let bytes;
  if (typeof value === 'string') bytes = Buffer.from(value, 'utf8');
  else if (Buffer.isBuffer(value) || value instanceof Uint8Array) bytes = Buffer.from(value);
  else fail('GitHub transition operation payload must be UTF-8 bytes or a string');
  if (bytes.length === 0 || bytes.length > MAX_OPERATION_PAYLOAD_BYTES)
    fail('GitHub transition operation payload exceeds the workflow input bound');
  let parsed;
  try { parsed = JSON.parse(UTF8.decode(bytes)); }
  catch { fail('GitHub transition operation payload must be UTF-8 JSON'); }
  const operationInput = validateGitHubTransitionInput(parsed);
  if (!bytes.equals(encodeGitHubTransitionInput(operationInput)))
    fail('GitHub transition operation payload must be exact canonical UTF-8 bytes');
  return operationInput;
}
export function deriveGitHubTransitionInputDigest(value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value) : encodeGitHubTransitionInput(value);
  validateGitHubTransitionInputBytes(bytes);
  return createHash('sha256').update(bytes).digest('hex');
}
export function validateGitHubTransitionDispatchEvent(value, context) {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    fail('GitHub transition dispatch requires committed policy context');
  const boundPolicy = validateGitHubTransitionPolicyExecution(context.policy, context.execution);
  const event = snap(value), inputs = event?.inputs;
  exact(inputs, EVENT_INPUT_KEYS, 'GitHub transition dispatch inputs');
  const payload = workflowPayload(inputs.operation_payload);
  const suppliedDigest = digest(inputs.operation_input_digest, 'operation_input_digest');
  if (payload.length + suppliedDigest.length > MAX_WORKFLOW_INPUT_BYTES)
    fail('GitHub transition dispatch inputs exceed the workflow character bound');
  const operationInput = validateGitHubTransitionInputBytes(payload);
  const canonicalPayload = encodeGitHubTransitionInput(operationInput).toString('utf8');
  const operationInputDigest = deriveGitHubTransitionInputDigest(payload);
  if (payload !== canonicalPayload || suppliedDigest !== operationInputDigest)
    fail('GitHub transition dispatch inputs do not match the exact operation payload');
  assertGitHubTransitionPolicyTarget(boundPolicy.policy, operationInput.request.repository);
  return Object.freeze({ operationInput, operationPayload: canonicalPayload, operationInputDigest,
    policy: boundPolicy.policy, execution: boundPolicy.execution });
}
function planInput(value) {
  const source = snap(value);
  const recovery = Object.hasOwn(source, 'integrationMode');
  exact(source, recovery ? RECOVERY_INPUT_KEYS : INPUT_KEYS, 'GitHub transition verifier input', false);
  for (const key of ['request', 'plan', 'planByteDigest', 'predecessorIssuance'])
    if (!Object.hasOwn(source, key)) fail('GitHub transition verifier input fields are invalid');
  const payload = validateGitHubTransitionInput({ schema: GITHUB_TRANSITION_INPUT_SCHEMA, request: source.request,
    plan: source.plan, planByteDigest: source.planByteDigest, predecessorIssuance: source.predecessorIssuance,
    ...(Object.hasOwn(source, 'predecessorAuthority') ? { predecessorAuthority: source.predecessorAuthority } : {}),
    ...(recovery ? { integrationMode: source.integrationMode } : {}) });
  const bytes = encodeGitHubTransitionInput(payload);
  return { ...payload, payload, operationInputDigest: deriveGitHubTransitionInputDigest(bytes) };
}
/** Build a normal input, or an explicit retrospective input whose predecessor review is already merged. */
export function createGitHubTransitionInput(value) { return planInput(value).payload; }
export function deriveGitHubTransitionCoordinate(value) {
  const source = snap(value);
  exact(source, ['authorityRepository', 'targetRepository', 'operationInput'], 'GitHub transition coordinate input');
  const authorityRepository = repository(source.authorityRepository).repository;
  const targetRepository = repository(source.targetRepository).repository;
  const operationInput = validateGitHubTransitionInput(source.operationInput);
  const request = operationInput.request;
  if (request.repository !== targetRepository
    || operationInput.plan.target.repository !== targetRepository)
    fail('GitHub transition coordinate target repository does not match the operation');
  return governanceDigest({ schema: GITHUB_TRANSITION_COORDINATE_SCHEMA,
    authorityRepository, targetRepository, sourceClaimId: request.claimId,
    sourceLeaseEpoch: request.leaseEpoch, sourceFenceRevision: request.fenceRevision });
  }
function validatedProviderProof(value, operationName) {
  const source = snap(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some((key) => key !== 'proofDigest' && key !== 'schema' && !/^[a-z][A-Za-z0-9]{0,63}$/u.test(key)))
    fail('GitHub transition provider proof fields are invalid');
  if (source.schema !== `agentic-os/github-${operationName}-provider-proof/v1`)
    fail('GitHub transition provider proof schema is invalid');
  const { proofDigest, ...payload } = source;
  if (canonicalJson(source).length > 100_000
    || digest(proofDigest, 'providerProof.proofDigest') !== governanceDigest(payload))
    fail('GitHub transition provider proof digest is invalid');
  return freeze(source);
  }
function transitionLocation(coordinate) {
  return { evidenceRef: `refs/heads/adlc/authority/${coordinate}`, evidencePath: `.agentic-os/authority/transitions/${coordinate}.json` };
  }
export function createGitHubStoredTransition(value) {
  const source = snap(value);
  exact(source, STORED_KEYS, 'GitHub stored transition input', false);
  for (const key of ['authorityRepository', 'targetRepository', 'operationInput', 'workflowRun',
    'workflowStartedAt', 'workflowCompletedAt', 'policy', 'providerProof'])
    if (!Object.hasOwn(source, key)) fail(`GitHub stored transition ${key} is required`);
  const authorityRepository = repository(source.authorityRepository).repository;
  const targetRepository = repository(source.targetRepository).repository;
  const operationInput = validateGitHubTransitionInput(source.operationInput);
  const workflowRun = validateGitHubTransitionWorkflowRun(source.workflowRun, authorityRepository);
  const workflowStartedAt = instant(source.workflowStartedAt, 'workflowStartedAt');
  const workflowCompletedAt = instant(source.workflowCompletedAt, 'workflowCompletedAt');
  if (Date.parse(workflowCompletedAt) < Date.parse(workflowStartedAt))
    fail('workflow completion precedes workflow start');
  const coordinate = deriveGitHubTransitionCoordinate({ authorityRepository,
    targetRepository, operationInput });
  const policy = assertGitHubTransitionPolicyTarget(validateGitHubTransitionPolicy(source.policy), targetRepository);
  if (policy.authorityRepository !== authorityRepository || policy.authorityRef !== workflowRun.ref
    || policy.workflowPath !== workflowRun.workflowPath)
    fail('GitHub stored transition is not joined to committed transition policy');
  const location = transitionLocation(coordinate);
  const operationInputDigest = deriveGitHubTransitionInputDigest(operationInput);
  const providerProof = validatedProviderProof(source.providerProof, operationInput.request.requestedTransition);
  const providerProofDigest = providerProof.proofDigest;
  if (workflowRun.authoritySubject !== operationInput.request.authoritySubject)
    fail('GitHub stored transition workflow authority does not match the operation');
  if (operationInput.request.requestedTransition === 'integrate'
    && operationInput.predecessorIssuance !== null
    && operationInput.predecessorIssuance.storedBundle.authorityBundle.policy.evidenceRepository
      !== authorityRepository)
    fail('GitHub stored transition predecessor evidence repository changed');
  if (operationInput.request.requestedTransition === 'integrate'
    && operationInput.predecessorAuthority !== undefined
    && operationInput.predecessorAuthority.authorityRef !== policy.authorityRef)
    fail('GitHub stored transition successor predecessor policy anchor changed');
  const payload = { schema: GITHUB_STORED_TRANSITION_SCHEMA, authorityRepository, targetRepository,
    coordinate, ...location, operationInput, operationInputDigest, workflowRun, workflowStartedAt,
    workflowCompletedAt, policy, providerProof, providerProofDigest };
  const storedDigest = governanceDigest(payload), result = freeze({ ...payload, storedDigest });
  for (const key of ['schema', 'coordinate', 'evidenceRef', 'evidencePath',
    'operationInputDigest', 'storedDigest']) {
    if (Object.hasOwn(source, key) && source[key] !== result[key])
      fail(`GitHub stored transition ${key} does not match`);
  }
  return result;
  }
export function validateGitHubStoredTransition(value) {
  const source = snap(value), result = createGitHubStoredTransition(source);
  exact(source, STORED_KEYS, 'GitHub stored transition');
  if (canonicalJson(source) !== canonicalJson(result))
    fail('GitHub stored transition is not canonical');
  return result;
}
