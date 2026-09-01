/** Provider-owned create-only CAS and deterministic live verification for transitions. */
import { canonicalJson } from './governance.mjs';
import { parseGitHubRepositoryIdentity } from './github-authority.mjs';
import { encodeEffectPlan, replayAuthenticatedTransitionOperationReceipt }
  from './completion.mjs';
import {
  GITHUB_TRANSITION_READ_ADAPTER, createGitHubStoredTransition,
  deriveGitHubTransitionCoordinate, deriveGitHubTransitionInputDigest,
  validateGitHubTransitionInput, validateGitHubTransitionWorkflowRun,
} from './github-transition-client.mjs';
import { createGitHubTransitionRestProvider } from './github-transition-provider.mjs';
import { assertGitHubTransitionPolicyTarget, validateGitHubTransitionPolicyExecution }
  from './github-transition-policy.mjs';
export * from './github-transition-client.mjs';
export * from './github-transition-policy.mjs';

function fail(message) { throw new TypeError(message); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze); return Object.freeze(value);
}
function repository(value) {
  return parseGitHubRepositoryIdentity(value, 'GitHub transition authority repository').repository;
}
function clock(value) {
  const now = value ?? Date.now;
  if (typeof now !== 'function') fail('GitHub transition authority requires a trusted clock');
  let prior = null;
  return () => {
    const result = now();
    if (!Number.isSafeInteger(result) || result < 0 || prior !== null && result < prior)
      fail('GitHub transition authority clock is invalid or moved backwards');
    prior = result; return result;
  };
}
function current(now, input) {
  const value = now();
  if (value < Date.parse(input.request.observedAt) || value >= Date.parse(input.request.expiresAt))
    fail('GitHub transition first publication is outside the request window');
  return value;
}
function configured(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('GitHub transition authority configuration is invalid');
  const authorityRepository = repository(value.repository);
  const targetRepository = repository(value.targetRepository);
  const operationInput = validateGitHubTransitionInput(value.operationInput);
  const workflowRun = validateGitHubTransitionWorkflowRun(value.workflowRun,
    authorityRepository);
  const policy = validateGitHubTransitionPolicyExecution(value.policy, {
    authorityRepository, authorityRef: workflowRun.ref,
    workflowPath: workflowRun.workflowPath, workflowRevision: workflowRun.workflowRevision,
  }).policy;
  assertGitHubTransitionPolicyTarget(policy, targetRepository);
  if (operationInput.request.repository !== targetRepository
    || operationInput.plan.target.repository !== targetRepository)
    fail('GitHub transition configured target repository changed');
  if (operationInput.request.requestedTransition === 'integrate'
    && operationInput.predecessorIssuance.storedBundle.authorityBundle.policy.evidenceRepository
      !== authorityRepository)
    fail('GitHub transition predecessor evidence repository changed');
  if (operationInput.request.requestedTransition === 'integrate'
    && policy.authorityRef
      !== operationInput.predecessorIssuance.storedBundle.authorityBundle.policy.canonicalRef)
    fail('GitHub transition policy is not anchored to the predecessor canonical ref');
  const coordinate = deriveGitHubTransitionCoordinate({ authorityRepository,
    targetRepository, operationInput });
  return { authorityRepository, targetRepository, operationInput, workflowRun, policy, coordinate };
}
function preparationConfigured(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('GitHub transition proof preparation configuration is invalid');
  const authorityRepository = repository(value.repository);
  const targetRepository = repository(value.targetRepository);
  const operationInput = validateGitHubTransitionInput(value.operationInput);
  const policy = validateGitHubTransitionPolicyExecution(value.policy, {
    authorityRepository, authorityRef: value.policy?.authorityRef,
    workflowPath: value.policy?.workflowPath, workflowRevision: value.workflowRevision,
  }).policy;
  assertGitHubTransitionPolicyTarget(policy, targetRepository);
  if (operationInput.request.requestedTransition !== 'integrate'
    || operationInput.request.repository !== targetRepository
    || operationInput.plan.target.repository !== targetRepository
    || operationInput.predecessorIssuance.storedBundle.authorityBundle.policy.evidenceRepository
      !== authorityRepository)
    fail('GitHub transition proof preparation repositories or operation changed');
  if (policy.authorityRef
    !== operationInput.predecessorIssuance.storedBundle.authorityBundle.policy.canonicalRef)
    fail('GitHub transition proof policy is not anchored to the predecessor canonical ref');
  return { authorityRepository, targetRepository, operationInput, policy,
    workflowRevision: value.workflowRevision };
}
function providerFor(value, state) {
  return createGitHubTransitionRestProvider({ repository: state.authorityRepository,
    targetRepository: state.targetRepository, token: value.token, fetchImpl: value.fetchImpl,
    timeoutMs: value.timeoutMs });
}
function stateMatches(state, expected) {
  return state?.stored.authorityRepository === expected.authorityRepository
    && state.stored.targetRepository === expected.targetRepository
    && state.stored.coordinate === expected.coordinate
    && same(state.stored.policy, expected.policy)
    && same(state.stored.operationInput, expected.operationInput);
}
function exactState(state, expected) {
  if (!stateMatches(state, expected))
    fail('transition source coordinate already has a conflicting immutable winner');
  return state;
}
function publicationWindow(state) {
  const input = state.stored.operationInput, committed = Date.parse(state.committedAt);
  const started = Date.parse(state.stored.workflowStartedAt);
  if (state.parentRevision !== state.stored.workflowRun.workflowRevision
    || started < Date.parse(input.request.observedAt) || committed < started
    || Date.parse(state.stored.workflowCompletedAt) > committed
    || committed >= Date.parse(input.request.expiresAt))
    fail('GitHub transition publication is not an in-window canonical child');
}
function sourceWindow(input, workflowStartedAt, providerProof, predecessor = null,
  committedAt = null) {
  let sourceStart, sourceExpiresAt;
  if (input.request.requestedTransition === 'integrate') {
    sourceStart = input.predecessorIssuance.publicationReceipt.committedAt;
    sourceExpiresAt = input.predecessorIssuance.storedBundle.authorityBundle.challenge.expiresAt;
  } else {
    if (predecessor === null) fail('retirement lacks its exact integrated source window');
    sourceStart = predecessor.committedAt;
    sourceExpiresAt = predecessor.stored.operationInput.request.expiresAt;
  }
  const started = Date.parse(workflowStartedAt);
  if (Date.parse(input.request.expiresAt) > Date.parse(sourceExpiresAt)
    || started < Date.parse(sourceStart) || started >= Date.parse(sourceExpiresAt)
    || input.request.requestedTransition === 'integrate'
      && Date.parse(providerProof.ruleSuitePushedAt) > started
    || committedAt !== null && Date.parse(committedAt) >= Date.parse(sourceExpiresAt))
    fail('GitHub transition does not consume its predecessor authority in-window');
}
function grant(state) {
  publicationWindow(state);
  const input = state.stored.operationInput, request = input.request;
  const encoded = state.ref.slice('refs/heads/'.length).split('/').map(encodeURIComponent).join('/');
  return freeze({ adapter: { ...GITHUB_TRANSITION_READ_ADAPTER },
    authenticatedSubject: request.authoritySubject,
    providerRecordLocator: `https://api.github.com/repos/${state.stored.authorityRepository
      .slice('github.com/'.length)}/git/ref/heads/${encoded}`,
    providerRecordDigest: state.publicationDigest, requestDigest: request.requestDigest,
    requestedTransition: request.requestedTransition, planDigest: input.plan.planDigest,
    planByteDigest: input.planByteDigest, sourceClaimId: request.claimId,
    sourceLeaseEpoch: request.leaseEpoch, sourceFenceRevision: request.fenceRevision,
    resultClaimId: request.claimId, resultLeaseEpoch: request.leaseEpoch + 1,
    resultFenceRevision: state.stored.coordinate,
    resultState: request.requestedTransition === 'integrate' ? 'integrated' : 'retired',
    operationReceiptDigest: state.publicationDigest, transitionedAt: state.committedAt,
    verifiedAt: state.committedAt, expiresAt: request.expiresAt });
}
async function integrationReceipt(state) {
  const input = state.stored.operationInput;
  return replayAuthenticatedTransitionOperationReceipt({ request: input.request,
    planBytes: encodeEffectPlan(input.plan) }, async () => grant(state));
}
async function bindRetirement(input, observation, policy) {
  if (input.request.requestedTransition !== 'retire') return;
  const prior = observation.predecessor;
  if (prior === null) fail('retirement lacks one exact integrated predecessor');
  const receipt = await integrationReceipt(prior), result = receipt.transitionReceipt;
  const priorInput = prior.stored.operationInput;
  if (input.plan.authority.predecessorDigest !== receipt.receiptDigest
    || !same(policy, prior.stored.policy)
    || result.resultClaimId !== input.request.claimId
    || result.resultLeaseEpoch !== input.request.leaseEpoch
    || result.resultFenceRevision !== input.request.fenceRevision
    || priorInput.request.repository !== input.request.repository
    || priorInput.request.authoritySubject !== input.request.authoritySubject
    || priorInput.request.ownerSubject !== input.request.ownerSubject
    || priorInput.request.writeSetDigest !== input.request.writeSetDigest
    || priorInput.plan.target.immutableRevision !== input.plan.target.immutableRevision
    || priorInput.plan.candidateDigest !== input.plan.candidateDigest
    || priorInput.plan.snapshotDigest !== input.plan.snapshotDigest)
    fail('retirement does not bind the exact authenticated integration receipt');
}
async function verifyWinner(provider, expected, state, terminal) {
  exactState(state, expected);
  await provider.readPolicy(state.stored.policy, state.stored.workflowRun.workflowRevision);
  const workflow = await provider.observeWorkflow(state.stored.workflowRun,
    state.stored.operationInputDigest,
    { terminal, currentRef: false }, state.stored.evidenceRef);
  if (workflow.startedAt !== state.stored.workflowStartedAt
    || workflow.completedAt !== state.stored.workflowCompletedAt)
    fail('transition immutable winner workflow terminal timing changed');
  const observation = await provider.observeProof(state.stored.operationInput,
    state.stored.providerProof);
  if (!same(observation.proof, state.stored.providerProof))
    fail('transition immutable winner no longer matches live provider proof');
  await bindRetirement(state.stored.operationInput, observation, state.stored.policy);
  publicationWindow(state);
  sourceWindow(state.stored.operationInput, state.stored.workflowStartedAt,
    state.stored.providerProof,
    observation.predecessor, state.committedAt);
  return state;
}

/** Read provider facts needed to construct an integration plan parametersDigest. */
export async function prepareGitHubIntegrationProviderProof(value) {
  const state = preparationConfigured(value), provider = providerFor(value, state);
  await provider.readPolicy(state.policy, state.workflowRevision);
  return provider.prepareIntegrationProof(state.operationInput);
}

/** Publish one source-coordinate winner. Exact replays return the same publication. */
export async function publishGitHubTransitionAuthority(value) {
  const expected = configured(value), provider = providerFor(value, expected), now = clock(value.now);
  await provider.readPolicy(expected.policy, expected.workflowRun.workflowRevision);
  let state = await provider.readPublication(expected.coordinate);
  if (state !== null) return verifyWinner(provider, expected, state, true);
  current(now, expected.operationInput);
  const operationInputDigest = deriveGitHubTransitionInputDigest(expected.operationInput);
  const workflow = await provider.observeWorkflow(expected.workflowRun, operationInputDigest,
    { terminal: true, currentRef: true },
    `refs/heads/adlc/authority/${expected.coordinate}`);
  const observation = await provider.observeProof(expected.operationInput);
  await bindRetirement(expected.operationInput, observation, expected.policy);
  sourceWindow(expected.operationInput, workflow.startedAt, observation.proof,
    observation.predecessor);
  const stored = createGitHubStoredTransition({
    authorityRepository: expected.authorityRepository,
    targetRepository: expected.targetRepository, operationInput: expected.operationInput,
    workflowRun: expected.workflowRun, workflowStartedAt: workflow.startedAt,
    workflowCompletedAt: workflow.completedAt, policy: expected.policy,
    providerProof: observation.proof,
  });
  current(now, expected.operationInput);
  state = await provider.publishStored(stored);
  exactState(state, expected);
  return verifyWinner(provider, expected, state, true);
}

/** Create a no-write live verifier which derives one deterministic grant from winner bytes. */
export function createGitHubTransitionAuthorityVerifier(value) {
  const expected = configured(value), provider = providerFor(value, expected);
  return async (inputValue) => {
    const supplied = validateGitHubTransitionInput({ ...inputValue,
      schema: expected.operationInput.schema,
      predecessorIssuance: expected.operationInput.predecessorIssuance });
    if (!same(supplied, expected.operationInput))
      fail('GitHub transition verifier input differs from the dispatched operation');
    const state = await provider.readPublication(expected.coordinate);
    if (state === null) fail('GitHub transition immutable winner is absent');
    await verifyWinner(provider, expected, state, true);
    return grant(state);
  };
}
