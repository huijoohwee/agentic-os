import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim } from '../src/governance.mjs';
import {
  RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
  createRecoveryCandidate,
} from '../src/recovery-candidate.mjs';
import {
  createFencedClaimBundle,
  createGitHubAuthorityChallenge,
  deriveGitHubAuthorityInputDigest,
  validateFencedClaimBundle,
} from '../src/github-authority.mjs';
import {
  createGitHubProtectionProjection,
  validateGitHubAuthorityIssuance,
} from '../src/github-authority-issuer.mjs';
import { issueGitHubAuthority, verifyGitHubAuthorityIssuanceLive } from
  '../src/github-authority-operation.mjs';
import {
  createEffectPlan,
  effectPlanByteDigest,
  encodeEffectPlan,
} from '../src/completion.mjs';
import {
  createGitHubAuthorityLiveVerificationReceipt,
  validateGitHubAuthorityLiveVerificationReceipt,
} from '../src/github-authority-client.mjs';

const hash = (character, length = 64) => character.repeat(length);
const CANONICAL = hash('a', 40), WORKFLOW = hash('b', 40), PUBLICATION = hash('9', 40);
const LIVE_TIME = Date.parse('2026-09-02T00:20:00.000Z');
function candidate(overrides = {}) {
  return createRecoveryCandidate({
    targetRepository: 'github.com/example/target',
    branch: 'agent/device/recovery',
    headRevision: hash('c', 40),
    canonicalBranch: 'main',
    canonicalRevision: hash('d', 40),
    reviewLocator: 'https://example.invalid/reviews/7',
    predecessorEvidenceDigest: hash('e'),
    inventoryAlgorithm: RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
    inventoryEntries: {
      index: 1, tracked: 1, visibleUntracked: 0, hidden: 0, ignoredRuntime: 0, content: 1,
    },
    indexInventoryDigest: hash('7'),
    trackedInventoryDigest: hash('f'),
    visibleUntrackedInventoryDigest: hash('0'),
    hiddenInventoryDigest: hash('1'),
    ignoredRuntimeInventoryDigest: hash('2'),
    contentInventoryDigest: hash('3'),
    observedAt: '2026-09-02T00:05:00.000Z',
    expiresAt: '2026-09-02T00:55:00.000Z',
    ...overrides,
  });
}
function request(bound = candidate(), overrides = {}) {
  return claim({
    repository: bound.targetRepository,
    authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42',
    scope: ['recovery:fixture'],
    dependentWork: [`effect-plan:sha256:${hash('6')}`],
    immutableRevision: `candidate:sha256:${bound.candidateDigest}`,
    reviewLocator: bound.reviewLocator,
    observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
    ...overrides,
  });
}
function policy(overrides = {}) {
  return {
    evidenceRepository: 'github.com/example/evidence',
    targetRepositoryPrefix: 'github.com/example/',
    canonicalRef: 'refs/heads/release/2026',
    canonicalRevision: CANONICAL,
    workflowPath: '.github/workflows/authority.yml',
    workflowRef: 'refs/heads/release/2026',
    workflowRevision: WORKFLOW,
    confirmationClass: 'interactive-provider',
    requiredStatusChecks: ['Integration Gate'],
    allowedMergeMethods: ['squash'],
    evidenceRefPrefix: 'refs/heads/agentic-os/evidence/',
    evidencePathPrefix: 'authority-evidence/',
    validitySeconds: 3_600,
    ...overrides,
  };
}
function run(bound = candidate(), source = request(bound), selected = policy(), overrides = {}) {
  return {
    id: '101',
    locator: 'https://api.example.invalid/actions/runs/101',
    event: 'workflow_dispatch',
    runAttempt: 1,
    repository: selected.evidenceRepository,
    ref: selected.canonicalRef,
    revision: selected.canonicalRevision,
    workflowPath: selected.workflowPath,
    workflowRef: selected.workflowRef,
    workflowRevision: selected.workflowRevision,
    startedAt: '2026-09-02T00:10:00.000Z',
    authorityInputDigest: deriveGitHubAuthorityInputDigest({
      request: source, candidate: bound, policy: selected,
    }),
    actor: { id: '42', login: 'example' },
    triggeringActor: { id: '42', login: 'example' },
    ...overrides,
  };
}
function issueInput(overrides = {}) {
  const bound = candidate(), source = request(bound), selected = policy();
  return {
    request: source,
    candidate: bound,
    policy: selected,
    workflowRunLocator: run(bound, source, selected).locator,
    expiresAt: '2026-09-02T00:50:00.000Z',
    ...overrides,
  };
}
function rules(repository, ref, id, types, bypassActors, parameters = {}) {
  const descriptor = (type) => ({ type, parameters: parameters[type] ?? null });
  return {
    repository,
    ref,
    rulesets: [{ id, enforcement: 'active', rules: types.map(descriptor), bypassActors }],
  };
}
function canonicalRules(input, { canonicalTypes, canonicalBypass = [],
  canonicalContexts = ['Integration Gate'], canonicalStrict = false,
  canonicalMethods = ['squash'], canonicalIntegrationId = 15368,
} = {}) {
  return rules(input.policy.evidenceRepository, input.policy.canonicalRef, '11', canonicalTypes ?? [
    'pull_request', 'required_status_checks', 'deletion', 'non_fast_forward',
  ], canonicalBypass, {
    pull_request: { allowed_merge_methods: canonicalMethods },
    required_status_checks: {
      required_status_checks: canonicalContexts.map((context) => ({
        context, integration_id: canonicalIntegrationId,
      })),
      strict_required_status_checks_policy: canonicalStrict,
    },
  });
}
function evidenceRules(input, { evidenceBypass = [], evidenceTypes, evidenceUpdateAllows = false,
  evidenceUpdateParameters = { update_allows_fetch_and_merge: evidenceUpdateAllows },
  evidenceParameters = {}, extraEvidenceRuleset = false,
} = {}) {
  const immutable = rules(input.policy.evidenceRepository, input.bundleRef ?? '', '13',
    evidenceTypes ?? ['update', 'deletion', 'non_fast_forward'], evidenceBypass, {
      ...evidenceParameters,
      update: evidenceUpdateParameters,
    }).rulesets[0];
  const rulesets = [immutable];
  if (extraEvidenceRuleset) {
    rulesets.push(rules(input.policy.evidenceRepository, input.bundleRef ?? '', '14',
      ['creation'], []).rulesets[0]);
  }
  return { repository: input.policy.evidenceRepository, ref: input.bundleRef, rulesets };
}
function provider({ targetOwnerId = '42', targetOverrides = {}, reviewOverrides = {},
  postTargetOverrides = {}, postReviewOverrides = {}, canonicalTypes,
  canonicalBypass = [], canonicalContexts = ['Integration Gate'], canonicalStrict = false,
  canonicalMethods = ['squash'], canonicalIntegrationId = 15368,
  evidenceBypass = [], evidenceTypes, postEvidenceTypes, evidenceUpdateAllows = false,
  evidenceUpdateParameters,
  evidenceParameters = {}, extraEvidenceRuleset = false,
  canonicalRevision = CANONICAL, postCanonicalRevision,
  throwAfterPublish = false, raceStored = null, authorityInput = issueInput(),
  committedAt = '2026-09-02T00:11:00.000Z',
} = {}) {
  const input = authorityInput, calls = [];
  let stored = null, publication = null, liveCanonicalRevision = null;
  return {
    calls,
    setCanonicalRevision(value) { liveCanonicalRevision = value; },
    async readRun(query) {
      calls.push(['readRun', query]);
      return run(input.candidate, input.request, input.policy);
    },
    async readActor(query) {
      calls.push(['readActor', query]);
      return { id: '42', login: 'example', subject: 'github-user:42' };
    },
    async readTargetRepository(query) {
      calls.push(['readTargetRepository', query]);
      const after = stored === null ? targetOverrides : { ...targetOverrides, ...postTargetOverrides };
      const reviewAfter = stored === null ? reviewOverrides
        : { ...reviewOverrides, ...postReviewOverrides };
      return {
        repository: input.candidate.targetRepository,
        repositoryId: '77',
        owner: { id: targetOwnerId, login: 'example' },
        canonicalRevision: input.candidate.canonicalRevision,
        canonicalBranch: input.candidate.canonicalBranch,
        candidateBranch: input.candidate.branch,
        candidateHeadRevision: input.candidate.headRevision,
        review: {
          locator: input.candidate.reviewLocator,
          state: 'open',
          draft: false,
          headRepository: input.candidate.targetRepository,
          headBranch: input.candidate.branch,
          headRevision: input.candidate.headRevision,
          baseRepository: input.candidate.targetRepository,
          baseBranch: 'main',
          baseRevision: input.candidate.canonicalRevision,
          ...reviewAfter,
        },
        ...after,
      };
    },
    async readRules(query) {
      calls.push(['readRules', query]);
      if (query.ref === input.policy.canonicalRef) {
        return canonicalRules(input, { canonicalTypes, canonicalBypass, canonicalContexts,
          canonicalStrict, canonicalMethods, canonicalIntegrationId });
      }
      return evidenceRules({ ...input, bundleRef: query.ref }, {
        evidenceBypass,
        evidenceTypes: stored !== null && postEvidenceTypes !== undefined
          ? postEvidenceTypes : evidenceTypes,
        evidenceUpdateAllows, evidenceUpdateParameters, evidenceParameters, extraEvidenceRuleset,
      });
    },
    async readCanonicalRef(query) {
      calls.push(['readCanonicalRef', query]);
      return { repository: query.repository, ref: query.ref,
        revision: liveCanonicalRevision ?? (stored !== null && postCanonicalRevision !== undefined
          ? postCanonicalRevision : canonicalRevision) };
    },
    async readPublication(query) {
      calls.push(['readPublication', query]);
      return publication;
    },
    async readBundle(query) {
      calls.push(['readBundle', query]);
      return stored;
    },
    async publishBundle(inputValue) {
      calls.push(['publishBundle', inputValue]);
      if (stored !== null) throw new Error('reference already exists');
      stored = raceStored ?? inputValue.storedBundle;
      publication = {
        repository: inputValue.repository,
        ref: inputValue.ref,
        path: inputValue.path,
        revision: PUBLICATION,
        parentRevision: stored.authorityBundle.policy.canonicalRevision,
        committedAt,
        storedDigest: stored.storedDigest,
      };
      if (raceStored !== null) throw new Error('reference already exists after competing create');
      if (throwAfterPublish) throw new Error('create response lost after provider CAS');
      return { created: true };
    },
  };
}

test('the stored bundle binds exact dispatch input and never self-asserts a transition', () => {
  const bound = candidate(), source = request(bound), selected = policy();
  const workflowRun = run(bound, source, selected);
  const challenge = createGitHubAuthorityChallenge({
    request: source,
    candidate: bound,
    workflowRun,
    policy: selected,
    expiresAt: '2026-09-02T00:50:00.000Z',
  });
  const bundle = createFencedClaimBundle({
    request: source, candidate: bound, challenge, workflowRun, policy: selected,
  });
  assert.deepEqual(validateFencedClaimBundle(bundle), bundle);
  assert.equal(bundle.challenge.authorityInputDigest, workflowRun.authorityInputDigest);
  assert.equal(bundle.externalEvidence.candidateInventoryDigest, bound.workingStateDigest);
  assert.equal(bundle.bootstrapAuthorization.effectPlanDigest, hash('6'));
  assert.equal(Object.hasOwn(bundle, 'transitionReceipt'), false);
  assert.equal(Object.hasOwn(bundle, 'publicationReceipt'), false);
  assert.equal(bundle.claimCoordinate, bundle.bootstrapAuthorization.claimCoordinate);
  assert.throws(() => createGitHubAuthorityChallenge({
    request: source,
    candidate: bound,
    workflowRun: { ...workflowRun, authorityInputDigest: hash('8') },
    policy: selected,
    expiresAt: '2026-09-02T00:50:00.000Z',
  }), /authority input/u);
});

test('adapter requires canonical initial owner claims and one exact effect plan', () => {
  const bound = candidate();
  assert.throws(() => deriveGitHubAuthorityInputDigest({ request: request(bound, {
    ownerSubject: 'provenance:fixture',
  }), candidate: bound, policy: policy() }), /allowed exact Recovery Candidate/u);
  assert.throws(() => deriveGitHubAuthorityInputDigest({ request: request(bound, {
    dependentWork: [],
  }), candidate: bound, policy: policy() }), /exactly one digest-bound effect plan/u);
  assert.throws(() => deriveGitHubAuthorityInputDigest({ request: request(bound, {
    dependentWork: [`effect-plan:sha256:${hash('6')}`, `effect-plan:sha256:${hash('7')}`],
  }), candidate: bound, policy: policy() }), /exactly one digest-bound effect plan/u);
  assert.throws(() => deriveGitHubAuthorityInputDigest({ request: request(bound, {
    claimId: hash('9'),
  }), candidate: bound, policy: policy() }), /allowed exact Recovery Candidate/u);
  assert.throws(() => deriveGitHubAuthorityInputDigest({ request: request(bound, {
    leaseEpoch: 2,
  }), candidate: bound, policy: policy() }), /allowed exact Recovery Candidate/u);
});

test('claim epoch and root operation, not request window, are the create-only CAS coordinate', () => {
  const bound = candidate(), selected = policy();
  const bundleFor = (source) => {
    const workflowRun = run(bound, source, selected);
    const challenge = createGitHubAuthorityChallenge({ request: source, candidate: bound,
      workflowRun, policy: selected, expiresAt: '2026-09-02T00:45:00.000Z' });
    return createFencedClaimBundle({ request: source, candidate: bound, challenge,
      workflowRun, policy: selected });
  };
  const first = bundleFor(request(bound));
  const second = bundleFor(request(bound, { observedAt: '2026-09-02T00:01:00.000Z',
    expiresAt: '2026-09-02T00:59:00.000Z' }));
  assert.equal(second.request.claimId, first.request.claimId);
  assert.equal(second.claimCoordinate, first.claimCoordinate);
  assert.equal(second.evidenceRef, first.evidenceRef);
  assert.equal(second.evidencePath, first.evidencePath);
  assert.notEqual(second.bundleDigest, first.bundleDigest);
});

test('target namespace is a parsed component boundary and validitySeconds is enforced in core', () => {
  const outside = candidate({ targetRepository: 'github.com/example-evil/target' });
  assert.throws(() => deriveGitHubAuthorityInputDigest({
    request: request(outside), candidate: outside, policy: policy(),
  }), /allowed exact Recovery Candidate/u);
  assert.throws(() => deriveGitHubAuthorityInputDigest({
    request: request(), candidate: candidate(),
    policy: policy({ targetRepositoryPrefix: 'github.com/example' }),
  }), /targetRepositoryPrefix/u);
  assert.throws(() => deriveGitHubAuthorityInputDigest({ request: request(), candidate: candidate(),
    policy: policy({ requiredStatusChecks: [' '] }) }), /canonical and duplicate-free/u);
  const bound = candidate(), source = request(bound), selected = policy({ validitySeconds: 60 });
  assert.throws(() => createGitHubAuthorityChallenge({
    request: source,
    candidate: bound,
    workflowRun: run(bound, source, selected),
    policy: selected,
    expiresAt: '2026-09-02T00:11:00.001Z',
  }), /validitySeconds/u);
});

test('issuance binds provider commit time, target owner, and exact pre/post protection', async () => {
  const api = provider();
  const issued = await issueGitHubAuthority(issueInput(), api);
  assert.deepEqual(validateGitHubAuthorityIssuance(issued), issued);
  assert.equal(issued.publicationReceipt.publicationRevision, PUBLICATION);
  assert.equal(issued.publicationReceipt.committedAt, '2026-09-02T00:11:00.000Z');
  assert.equal(issued.transitionReceipt.transitionedAt, issued.publicationReceipt.committedAt);
  assert.equal(issued.transitionReceipt.operationReceiptDigest,
    issued.publicationReceipt.receiptDigest);
  assert.equal(issued.publicationReceipt.targetRepository.owner.id, '42');
  assert.equal(issued.publicationReceipt.targetRepository.review.headRevision,
    issued.storedBundle.authorityBundle.candidate.headRevision);
  assert.equal(issued.publicationReceipt.preProtection.canonical.rulesets[0].id, '11');
  assert.equal(issued.publicationReceipt.preProtection.evidence.rulesets.length, 1);
  assert.equal(issued.publicationReceipt.preProtection.evidence.rulesets[0].id, '13');
  assert.deepEqual(issued.publicationReceipt.preProtection.evidence.rulesets[0].bypassActors, []);
  assert.equal(issued.publicationReceipt.preProtection.canonicalHead.revision, CANONICAL);
  assert.equal(issued.publicationReceipt.preProtection.snapshotDigest,
    issued.publicationReceipt.postProtection.snapshotDigest);
  assert.equal(Object.hasOwn(issued.storedBundle.authorityBundle, 'transitionReceipt'), false);
  const publication = api.calls.find(([name]) => name === 'publishBundle')[1];
  assert.equal(publication.createOnly, true);
  assert.equal(publication.expectedRevision, null);
});

test('exact replay reconstructs the same issuance from provider-persisted state', async () => {
  const api = provider({ throwAfterPublish: true });
  const first = await issueGitHubAuthority(issueInput(), api);
  const second = await issueGitHubAuthority(issueInput(), api);
  assert.deepEqual(second, first);
  assert.equal(api.calls.filter(([name]) => name === 'publishBundle').length, 1);
  assert.ok(api.calls.filter(([name]) => name === 'readPublication').length >= 6);
});

test('a conflicting winner of the absent-ref CAS cannot become authority', async () => {
  const bound = candidate();
  const conflictingInput = issueInput({
    request: request(bound, {
      observedAt: '2026-09-02T00:01:00.000Z',
      expiresAt: '2026-09-02T00:59:00.000Z',
    }),
    candidate: bound,
  });
  const conflictingProvider = provider({ authorityInput: conflictingInput });
  const conflicting = await issueGitHubAuthority(conflictingInput, conflictingProvider);
  const api = provider({ raceStored: conflicting.storedBundle });
  await assert.rejects(issueGitHubAuthority(issueInput(), api),
    /publication is not exact|conflicting stored bundle/u);
  const publications = api.calls.filter(([name]) => name === 'publishBundle');
  assert.equal(publications.length, 1);
  assert.equal(conflicting.storedBundle.authorityBundle.evidenceRef, publications[0][1].ref);
  assert.notEqual(conflicting.storedBundle.storedDigest,
    publications[0][1].storedBundle.storedDigest);
  assert.equal(api.calls.filter(([name]) => name === 'readPublication').length >= 4, true);
});

test('structural validation is not authentication; live verification is read-only and exact', async () => {
  const api = provider(), issued = await issueGitHubAuthority(issueInput(), api);
  const writes = api.calls.filter(([name]) => name === 'publishBundle').length;
  assert.deepEqual(validateGitHubAuthorityIssuance(issued), issued);
  assert.deepEqual(await verifyGitHubAuthorityIssuanceLive(issued, api,
    { now: () => LIVE_TIME }), issued);
  assert.equal(api.calls.filter(([name]) => name === 'publishBundle').length, writes);
  api.setCanonicalRevision(hash('4', 40));
  assert.deepEqual(validateGitHubAuthorityIssuance(issued), issued);
  await assert.rejects(verifyGitHubAuthorityIssuanceLive(issued, api,
    { now: () => LIVE_TIME }), /canonical ref moved/u);
});

test('live verification rejects authority before issuance and at expiry', async () => {
  const api = provider(), issued = await issueGitHubAuthority(issueInput(), api);
  const reads = api.calls.length;
  await assert.rejects(verifyGitHubAuthorityIssuanceLive(issued, api, {
    now: () => Date.parse('2026-09-02T00:09:59.999Z'),
  }), /current validity window/u);
  await assert.rejects(verifyGitHubAuthorityIssuanceLive(issued, api, {
    now: () => Date.parse('2026-09-02T00:50:00.000Z'),
  }), /current validity window/u);
  assert.equal(api.calls.length, reads);
  let observations = 0;
  await assert.rejects(verifyGitHubAuthorityIssuanceLive(issued, api, {
    now: () => observations++ === 0
      ? LIVE_TIME : Date.parse('2026-09-02T00:50:00.000Z'),
  }), /current validity window/u);
});

test('issuer rejects wrong-owner targets, weak policy rules, and non-provider time', async () => {
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({ targetOwnerId: '43' })),
    /same-owner/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    canonicalTypes: ['pull_request', 'deletion', 'non_fast_forward'],
  })), /exact required rule/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({ canonicalContexts: [] })),
    /status checks/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    canonicalContexts: ['Bogus Gate'],
  })), /status contexts/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    canonicalIntegrationId: 42,
  })), /status checks/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({ canonicalStrict: true })),
    /status checks/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    canonicalMethods: ['merge'],
  })), /merge methods/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    evidenceBypass: ['RepositoryRole:5:always'],
  })), /one exact zero-bypass immutable ruleset/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    evidenceTypes: ['creation', 'deletion', 'non_fast_forward', 'update'],
  })), /one exact zero-bypass immutable ruleset/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    extraEvidenceRuleset: true,
  })), /one exact zero-bypass immutable ruleset/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    evidenceParameters: { deletion: {} },
  })), /one exact zero-bypass immutable ruleset/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({ evidenceUpdateAllows: true })),
    /one exact zero-bypass immutable ruleset/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    evidenceUpdateParameters: { update_allows_fetch_and_merge: false, unexpected: true },
  })), /one exact zero-bypass immutable ruleset/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    postEvidenceTypes: ['deletion', 'non_fast_forward'],
  })), /one exact zero-bypass immutable ruleset|protection changed/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    committedAt: '2026-09-02T00:50:00.000Z',
  })), /in-window/u);
});

test('issuer rejects canonical-ref and exact target PR drift before or after CAS', async () => {
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    canonicalRevision: hash('4', 40),
  })), /canonical ref moved/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    postCanonicalRevision: hash('4', 40),
  })), /canonical ref moved/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    targetOverrides: { candidateHeadRevision: hash('4', 40) },
  })), /exact same-owner authority target/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    targetOverrides: { canonicalBranch: 'develop' },
  })), /exact same-owner authority target/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    reviewOverrides: { headRevision: hash('4', 40) },
  })), /exact candidate head/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    postReviewOverrides: { baseRevision: hash('4', 40) },
  })), /exact candidate head|identity changed/u);
  await assert.rejects(issueGitHubAuthority(issueInput(), provider({
    postReviewOverrides: { baseBranch: 'develop' },
  })), /exact candidate head|identity changed/u);
});

test('protection projection digests ruleset ids, types, and bypass actors', () => {
  const projected = createGitHubProtectionProjection(rules(
    'github.com/example/evidence', 'refs/heads/main', '12',
    ['update', 'creation'], ['RepositoryRole:5:always'], {
      update: { update_allows_fetch_and_merge: false },
    }));
  assert.deepEqual(projected.rulesets[0].rules.map((entry) => entry.type), ['creation', 'update']);
  assert.match(projected.projectionDigest, /^[0-9a-f]{64}$/u);
  assert.throws(() => createGitHubProtectionProjection({
    ...rules('github.com/example/evidence', 'refs/heads/main', '12',
      ['creation'], ['RepositoryRole:5:always']),
    rulesets: [
      { id: '12', enforcement: 'active',
        rules: [{ type: 'creation', parameters: null }], bypassActors: [] },
      { id: '12', enforcement: 'active', rules: [{ type: 'update',
        parameters: { update_allows_fetch_and_merge: false } }], bypassActors: [] },
    ],
  }), /distinct active rulesets/u);
});

function spendFixture() {
  const bound = candidate();
  const draft = request(bound);
  const plan = createEffectPlan({
    target: {
      repository: bound.targetRepository,
      resource: bound.branch,
      immutableRevision: `candidate:sha256:${bound.candidateDigest}`,
    },
    authority: {
      requestedTransition: draft.requestedTransition,
      authoritySubject: draft.authoritySubject,
      ownerSubject: draft.ownerSubject,
      claimId: draft.claimId,
      leaseEpoch: draft.leaseEpoch,
      fenceRevision: draft.fenceRevision,
      writeSetDigest: draft.writeSetDigest,
      reviewLocator: draft.reviewLocator,
      predecessorDigest: bound.predecessorEvidenceDigest,
    },
    candidateDigest: bound.candidateDigest,
    snapshotDigest: bound.workingStateDigest,
    effectClass: 'publish-for-review-only',
    allowedEffects: ['descendant-commit', 'exact-revalidation', 'new-review', 'nonforce-push'],
    forbiddenEffects: ['auto-merge', 'cleanup', 'deletion', 'deploy', 'force-push',
      'merge', 'release', 'reset', 'retire', 'stash'],
    parametersDigest: hash('8'),
  });
  const planBytes = encodeEffectPlan(plan);
  const source = request(bound, {
    dependentWork: [`effect-plan:sha256:${effectPlanByteDigest(planBytes)}`],
  });
  const input = issueInput({ request: source, candidate: bound });
  return { plan, planBytes, input, api: provider({ authorityInput: input }) };
}

test('live issuance spend binds exact canonical plan bytes and current provider state', async () => {
  const fixture = spendFixture();
  const issued = await issueGitHubAuthority(fixture.input, fixture.api);
  const receipt = await createGitHubAuthorityLiveVerificationReceipt({
    issuance: issued, planBytes: fixture.planBytes,
  }, fixture.api, { now: () => LIVE_TIME });
  assert.deepEqual(validateGitHubAuthorityLiveVerificationReceipt(receipt), receipt);
  assert.equal(receipt.planDigest, fixture.plan.planDigest);
  assert.equal(receipt.planByteDigest, effectPlanByteDigest(fixture.planBytes));
  assert.equal(receipt.issuanceDigest, issued.issuanceDigest);
  assert.equal(fixture.api.calls.filter(([name]) => name === 'publishBundle').length, 1);
});

test('live issuance spend rejects noncanonical, mismatched, stale, and drifting authority', async () => {
  const fixture = spendFixture();
  const issued = await issueGitHubAuthority(fixture.input, fixture.api);
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({
    issuance: issued, planBytes: Buffer.concat([fixture.planBytes, Buffer.from('\n')]),
  }, fixture.api, { now: () => LIVE_TIME }), /canonical bytes/u);
  const { planDigest: ignoredPlanDigest, ...planInput } = fixture.plan;
  assert.match(ignoredPlanDigest, /^[0-9a-f]{64}$/u);
  const changed = encodeEffectPlan(createEffectPlan({
    ...planInput, parametersDigest: hash('7'),
  }));
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({ issuance: issued, planBytes: changed },
    fixture.api, { now: () => LIVE_TIME }), /exact effect plan/u);
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({
    issuance: issued, planBytes: fixture.planBytes,
  }, fixture.api, { now: () => Date.parse('2026-09-02T00:50:00.000Z') }),
  /validity window/u);
  let calls = 0;
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({
    issuance: issued, planBytes: fixture.planBytes,
  }, fixture.api, { now: () => calls++ === 0 ? LIVE_TIME : LIVE_TIME - 1 }),
  /moved backwards/u);
  fixture.api.setCanonicalRevision(hash('4', 40));
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({
    issuance: issued, planBytes: fixture.planBytes,
  }, fixture.api, { now: () => LIVE_TIME }), /canonical ref moved/u);
});
