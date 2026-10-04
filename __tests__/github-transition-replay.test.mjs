import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { canonicalJson, claim, governanceDigest, integrate, retire } from '../src/governance.mjs';
import { RECOVERY_CANDIDATE_INVENTORY_ALGORITHM, createRecoveryCandidate } from '../src/recovery-candidate.mjs';
import { createFencedClaimBundle, createGitHubAuthorityChallenge, deriveGitHubAuthorityInputDigest } from '../src/github-authority.mjs';
import { GITHUB_RETROSPECTIVE_TARGET_PROOF_SCHEMA, createGitHubAuthorityIssuance, createGitHubProtectionProjection, createGitHubProtectionSnapshot, createGitHubPublicationReceipt, createGitHubStoredAuthorityBundle, createGitHubTargetRepositoryProjection } from '../src/github-authority-issuer.mjs';
import { createAuthenticatedTransitionOperationReceipt, createEffectPlan, effectPlanByteDigest, encodeEffectPlan, replayAuthenticatedTransitionOperationReceipt } from '../src/completion.mjs';
import { GITHUB_RETROSPECTIVE_CONTENT_MODE, GITHUB_RETROSPECTIVE_INTEGRATION_MODE, GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA, createGitHubTransitionInput, deriveGitHubTransitionCoordinate, deriveGitHubTransitionInputDigest, deriveGitHubTransitionRunName, encodeGitHubTransitionInput, validateGitHubTransitionDispatchEvent } from '../src/github-transition-client.mjs';
import { createGitHubTransitionAuthorityVerifier, prepareGitHubIntegrationProviderProof, publishGitHubTransitionAuthority } from '../src/github-transition-authority.mjs';
import { GITHUB_TRANSITION_POLICY_SCHEMA, encodeGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';
import { CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS, INTEGRATION_RECORD_RETAINED_EFFECTS, RETAINED_EFFECTS } from '../src/cleanup-records.mjs';
import { hex, EVIDENCE_BASE, INITIAL_WORKFLOW, CANDIDATE, TARGET_BASE, TRANSITION_BASE, MERGE, LATER, INITIAL_PUBLICATION, INITIAL_TREE, INITIAL_BASE_TREE, INITIAL_BLOB, TRANSITION_BASE_TREE, STARTED, COMMITTED, NOW, WORKFLOW_PATH, TRANSITION_POLICY, POLICY_CONTEXT, rule, canonicalRuleRows, targetRuleRows, evidenceRuleRows, classicProtection, projection, predecessorIssuance, integrationDraft, successorPredecessorAuthority, workflowRun, response, commit, checkRun, apiFixture, integrationFixture, successorFixture, inputWithExpiry, historicalSquash } from './lib/github-transition-fixture.mjs';

test('read-only transition CLI validates canonical committed policy and Actions identity', async (t) => {
  const { operationInput } = await integrationFixture();
  const directory = mkdtempSync(join(tmpdir(), 'agentic-os-transition-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, '.agentic-os'));
  writeFileSync(join(directory, '.agentic-os', 'github-transition-policy.json'),
    encodeGitHubTransitionPolicy(TRANSITION_POLICY));
  const payload = encodeGitHubTransitionInput(operationInput).toString('utf8');
  const event = join(directory, 'event.json');
  writeFileSync(event, JSON.stringify({ inputs: { operation_payload: payload,
    operation_input_digest: deriveGitHubTransitionInputDigest(payload) } }));
  const env = { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'example/evidence',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: TRANSITION_BASE,
    GITHUB_WORKFLOW_SHA: TRANSITION_BASE, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: `example/evidence/${WORKFLOW_PATH}@refs/heads/main` };
  const cli = resolve(import.meta.dirname, '..', 'bin', 'agentic-os-transition.mjs');
  assert.equal(spawnSync(process.execPath, [cli, 'validate-event'],
    { cwd: directory, env, encoding: 'utf8' }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [cli, 'validate-event'],
    { cwd: directory, env: { ...env, GITHUB_RUN_ATTEMPT: '2' }, encoding: 'utf8' }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [cli, 'validate-event'], { cwd: directory,
    env: { ...env, GITHUB_WORKFLOW_REF: `example/evidence/${WORKFLOW_PATH}@refs/heads/other` },
    encoding: 'utf8' }).status, 0);
  writeFileSync(join(directory, '.agentic-os', 'github-transition-policy.json'),
    `${encodeGitHubTransitionPolicy(TRANSITION_POLICY).toString('utf8')}\n`);
  assert.notEqual(spawnSync(process.execPath, [cli, 'validate-event'],
    { cwd: directory, env, encoding: 'utf8' }).status, 0);
});

test('create-only transition CAS publishes, verifies, replays, and permits later main advance', async () => {
  const fixture = await integrationFixture();
  const first = await publishGitHubTransitionAuthority(fixture.common);
  const coordinate = deriveGitHubTransitionCoordinate({ authorityRepository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target', operationInput: fixture.operationInput });
  assert.equal(first.stored.coordinate, coordinate);
  assert.equal(fixture.api.publications.size, 1);
  const replay = await publishGitHubTransitionAuthority(fixture.common);
  assert.deepEqual(replay, first);
  fixture.api.state.transitionStatus = 'completed';
  const verify = createGitHubTransitionAuthorityVerifier(fixture.common);
  const receipt = await createAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, verify, { now: () => NOW });
  const historical = await replayAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes }, verify);
  assert.deepEqual(historical, receipt);
  fixture.api.state.targetHead = LATER;
  fixture.api.state.latestCheckId = 702;
  const checkListsBeforeReplay = fixture.api.calls.filter((entry) =>
    entry === `GET /repos/example/target/commits/${CANDIDATE}/check-runs`).length;
  assert.deepEqual(await replayAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes }, verify), receipt);
  assert.equal(fixture.api.calls.filter((entry) =>
    entry === `GET /repos/example/target/commits/${CANDIDATE}/check-runs`).length,
  checkListsBeforeReplay);
  fixture.api.state.ruleSuiteResult = 'bypass';
  await assert.rejects(verify({ request: fixture.final.request, plan: fixture.final.plan,
    planByteDigest: fixture.final.planByteDigest }), /rule suite|provider proof/u);
  fixture.api.state.ruleSuiteResult = 'pass';
  fixture.api.state.checkCompletedAt = '2026-09-02T00:16:00Z';
  await assert.rejects(verify({ request: fixture.final.request, plan: fixture.final.plan,
    planByteDigest: fixture.final.planByteDigest }), /required checks|provider proof/u);
  fixture.api.state.checkCompletedAt = '2026-09-02T00:14:00Z';
  fixture.api.state.compareStatus = 'diverged';
  await assert.rejects(verify({ request: fixture.final.request, plan: fixture.final.plan,
    planByteDigest: fixture.final.planByteDigest }), /not contained|live provider proof/u);
});

test('source coordinate admits one exact winner and rejects another run or target before effects', async () => {
  const fixture = await integrationFixture();
  await publishGitHubTransitionAuthority(fixture.common);
  const competing = { ...fixture.common, workflowRun: workflowRun('202') };
  assert.deepEqual(await publishGitHubTransitionAuthority(competing),
    await publishGitHubTransitionAuthority(fixture.common));
  const conflictingInput = inputWithExpiry(fixture, '2026-09-02T00:49:00.000Z');
  await assert.rejects(publishGitHubTransitionAuthority({ ...fixture.common,
    workflowRun: workflowRun('202'), operationInput: conflictingInput }),
  /conflicting immutable winner/u);
  const before = fixture.api.calls.length;
  assert.throws(() => createGitHubTransitionAuthorityVerifier({ ...fixture.common,
    targetRepository: 'github.com/example/other' }), /target|policy/u);
  assert.equal(fixture.api.calls.length, before);
});

test('create-only publication recovers the exact winner after a lost create-ref response', async () => {
  const fixture = await integrationFixture();
  fixture.api.state.dropRefResponse = true;
  const result = await publishGitHubTransitionAuthority(fixture.common);
  assert.equal(result.stored.operationInputDigest,
    deriveGitHubTransitionInputDigest(fixture.operationInput));
  assert.equal(fixture.api.publications.size, 1);
});

test('concurrent exact publishers converge on one create-only winner after both observe absence',
  async () => {
    const fixture = await integrationFixture(), release = [];
    const wait = [0, 1].map(() => new Promise((resolve) => { release.push(resolve); }));
    fixture.api.state.absentRefBarrier = { count: 0, wait, release };
    fixture.api.state.concurrentRunTimes = true;
    const [first, second] = await Promise.all([
      publishGitHubTransitionAuthority(fixture.common),
      publishGitHubTransitionAuthority({ ...fixture.common, workflowRun: workflowRun('202') }),
    ]);
    assert.deepEqual(second, first);
    assert.equal(fixture.api.state.absentRefBarrier.count, 4);
    assert.deepEqual(fixture.api.state.refCreateStatuses.sort(), [201, 422]);
    assert.equal(fixture.api.publications.size, 1);
  });

test('concurrent conflicting source-coordinate publishers retain one winner and reject the loser',
  async () => {
    const fixture = await integrationFixture(), release = [];
    const wait = [0, 1].map(() => new Promise((resolve) => { release.push(resolve); }));
    fixture.api.state.absentRefBarrier = { count: 0, wait, release };
    fixture.api.state.concurrentRunTimes = true;
    const conflictingInput = inputWithExpiry(fixture, '2026-09-02T00:49:00.000Z');
    fixture.api.state.runDigests['202'] = deriveGitHubTransitionInputDigest(conflictingInput);
    const settled = await Promise.allSettled([
      publishGitHubTransitionAuthority(fixture.common),
      publishGitHubTransitionAuthority({ ...fixture.common, workflowRun: workflowRun('202'),
        operationInput: conflictingInput }),
    ]);
    assert.deepEqual(settled.map((entry) => entry.status).sort(), ['fulfilled', 'rejected']);
    assert.match(settled.find((entry) => entry.status === 'rejected').reason.message,
      /conflicting immutable winner/u);
    assert.deepEqual(fixture.api.state.refCreateStatuses.sort(), [201, 422]);
    assert.equal(fixture.api.publications.size, 1);
  });

test('transition publication fails closed across workflow, policy, protection, and timing drift',
  async () => {
    const cases = [
      ['pre-terminal run', (state) => { state.transitionStatus = 'in_progress'; }, /workflow/u],
      ['stale authority main', (state) => { state.authorityHead = hex('6', 40); }, /workflow/u],
      ['policy bytes', (state) => { state.transitionPolicy = { ...TRANSITION_POLICY,
        targetRepositories: ['github.com/example/other'] }; }, /policy/u],
      ['target repository identity', (state) => { state.targetRepositoryId = 78; },
        /repository numeric identity|provider proof/u],
      ['unsupported rebase method', (state) => { state.targetMergeMethods = ['rebase']; },
        /merge methods|protection/u],
      ['target bypass', (state) => { state.targetBypassActors = [{ actor_type: 'Team',
        actor_id: 9, bypass_mode: 'always' }]; }, /bypass|protection/u],
      ['late evidence protection', (state) => {
        state.transitionRulesUpdatedAt = '2026-09-02T00:22:00Z';
      }, /protection/u],
      ['completion after publication', (state) => {
        state.runUpdatedAt = '2026-09-02T00:22:00Z';
      }, /publication|timing/u],
      ['merge before predecessor', (state) => {
        state.mergedAt = '2026-09-02T00:05:00Z';
        state.checkCompletedAt = '2026-09-02T00:04:00Z';
      }, /predecessor authority window/u],
    ];
    for (const [label, mutate, pattern] of cases) {
      const fixture = await integrationFixture(); mutate(fixture.api.state);
      await assert.rejects(publishGitHubTransitionAuthority(fixture.common), pattern, label);
    }
  });

test('an exact immutable winner replays after request expiry without a second effect', async () => {
  const fixture = await integrationFixture();
  const first = await publishGitHubTransitionAuthority(fixture.common);
  const replay = await publishGitHubTransitionAuthority({ ...fixture.common,
    now: () => Date.parse('2026-09-02T01:05:00.000Z') });
  assert.deepEqual(replay, first);
  assert.equal(fixture.api.publications.size, 1);
  assert.equal(first.stored.providerProof.targetBypassActorsObserved, false);
});

test('retire sources and replays the exact authenticated integration winner', async () => {
  const fixture = await integrationFixture();
  await publishGitHubTransitionAuthority(fixture.common);
  fixture.api.state.transitionStatus = 'completed';
  const integrationVerifier = createGitHubTransitionAuthorityVerifier(fixture.common);
  const integrated = await createAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, integrationVerifier, { now: () => NOW });
  const prior = integrated.transitionReceipt;
  const plan = createEffectPlan({ target: { repository: 'github.com/example/target',
    resource: '/exact/dirty/worktree', immutableRevision: MERGE }, authority: {
    requestedTransition: 'retire', authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    claimId: prior.resultClaimId, leaseEpoch: prior.resultLeaseEpoch,
    fenceRevision: prior.resultFenceRevision, writeSetDigest: fixture.final.request.writeSetDigest,
    reviewLocator: null, predecessorDigest: integrated.receiptDigest },
    candidateDigest: fixture.final.plan.candidateDigest, snapshotDigest: fixture.final.plan.snapshotDigest,
    effectClass: 'claim-retirement-with-cleanup',
    allowedEffects: [...CLEANUP_EFFECTS, 'retire-claim'], forbiddenEffects: RETAINED_EFFECTS,
    parametersDigest: governanceDigest('cleanup-plan-bytes') });
  const planBytes = encodeEffectPlan(plan), planByteDigest = effectPlanByteDigest(planBytes);
  const request = retire({ repository: plan.target.repository, authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42', scope: ['src/feature.mjs'], claimId: prior.resultClaimId,
    leaseEpoch: prior.resultLeaseEpoch, fenceRevision: prior.resultFenceRevision,
    immutableRevision: MERGE, dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt: '2026-09-02T00:22:00.000Z', expiresAt: '2026-09-02T00:45:00.000Z' });
  const operationInput = createGitHubTransitionInput({ request, plan, planByteDigest,
    predecessorIssuance: null });
  const common = { ...fixture.common, workflowRun: workflowRun('202'), operationInput };
  const retirementVariant = ({ ownerSubject = request.ownerSubject,
    scope = request.scope } = {}) => {
    const { planDigest: omittedPlanDigest, ...planSource } = plan;
    assert.match(omittedPlanDigest, /^[0-9a-f]{64}$/u);
    const variedPlan = createEffectPlan({ ...planSource, authority: { ...plan.authority,
      ownerSubject, writeSetDigest: governanceDigest(scope) } });
    const variedBytes = encodeEffectPlan(variedPlan);
    const { requestDigest: omittedRequestDigest, ...requestSource } = request;
    assert.match(omittedRequestDigest, /^[0-9a-f]{64}$/u);
    const variedRequest = retire({ ...requestSource, ownerSubject, scope,
      writeSetDigest: governanceDigest(scope),
      dependentWork: [`effect-plan:sha256:${effectPlanByteDigest(variedBytes)}`] });
    return createGitHubTransitionInput({ request: variedRequest, plan: variedPlan,
      planByteDigest: effectPlanByteDigest(variedBytes), predecessorIssuance: null });
  };
  for (const drifted of [retirementVariant({ ownerSubject: 'github-user:99' }),
    retirementVariant({ scope: ['src/other.mjs'] })]) {
    fixture.api.state.runDigests['202'] = deriveGitHubTransitionInputDigest(drifted);
    await assert.rejects(publishGitHubTransitionAuthority({ ...common,
      operationInput: drifted }), /exact authenticated integration receipt/u);
  }
  fixture.api.state.currentDigest = deriveGitHubTransitionInputDigest(operationInput);
  delete fixture.api.state.runDigests['202'];
  await publishGitHubTransitionAuthority(common);
  const verify = createGitHubTransitionAuthorityVerifier(common);
  const retired = await createAuthenticatedTransitionOperationReceipt({ request, planBytes }, verify,
    { now: () => NOW });
  assert.equal(retired.transitionReceipt.resultState, 'retired');
  assert.equal(fixture.api.publications.size, 2);
});

test('retire accepts a fresh successor predecessor authority window', async () => {
  const fixture = await integrationFixture();
  await publishGitHubTransitionAuthority(fixture.common);
  fixture.api.state.transitionStatus = 'completed';
  const integrationVerifier = createGitHubTransitionAuthorityVerifier(fixture.common);
  const integrated = await createAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, integrationVerifier, { now: () => NOW });
  const prior = integrated.transitionReceipt;
  const plan = createEffectPlan({ target: { repository: 'github.com/example/target',
    resource: '/exact/dirty/worktree', immutableRevision: MERGE }, authority: {
    requestedTransition: 'retire', authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    claimId: prior.resultClaimId, leaseEpoch: prior.resultLeaseEpoch,
    fenceRevision: prior.resultFenceRevision, writeSetDigest: fixture.final.request.writeSetDigest,
    reviewLocator: null, predecessorDigest: integrated.receiptDigest },
    candidateDigest: fixture.final.plan.candidateDigest, snapshotDigest: fixture.final.plan.snapshotDigest,
    effectClass: 'claim-retirement-with-cleanup',
    allowedEffects: [...CLEANUP_EFFECTS, 'retire-claim'], forbiddenEffects: RETAINED_EFFECTS,
    parametersDigest: governanceDigest('cleanup-plan-bytes') });
  const planBytes = encodeEffectPlan(plan), planByteDigest = effectPlanByteDigest(planBytes);
  const predecessorAuthority = {
    schema: GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA,
    authorityKind: 'append-only-retire-successor-predecessor',
    authorityRef: 'refs/heads/main',
    reviewLocator: fixture.final.request.reviewLocator,
    sourceBranch: fixture.issuance.storedBundle.authorityBundle.candidate.branch,
    immutableRevision: MERGE,
    reviewedSourceHead: fixture.issuance.storedBundle.authorityBundle.candidate.headRevision,
    reviewedSourceTree: fixture.api.state.candidateTree,
    protectedBase: TARGET_BASE,
    predecessorIssuanceDigest: fixture.issuance.issuanceDigest,
    predecessorTransitionReceiptDigest: integrated.receiptDigest,
    adoptedTerminalClaimId: hex('4'),
    adoptedLineageDigest: hex('5'),
    integrationReceiptDigest: integrated.receiptDigest,
    reviewRequestId: 'github-pull-request:PR_fixture',
    retirementReason: 'integrated-successor-retire-continuation',
    adoptionDisposition: 'response-loss-adopted',
    cloudMutation: false,
    issuedAt: '2026-09-02T00:55:00.000Z',
    expiresAt: '2026-09-02T01:05:00.000Z',
  };
  const request = retire({ repository: plan.target.repository, authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42', scope: ['src/feature.mjs'], claimId: prior.resultClaimId,
    leaseEpoch: prior.resultLeaseEpoch, fenceRevision: prior.resultFenceRevision,
    immutableRevision: MERGE, dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt: '2026-09-02T00:55:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z' });
  const operationInput = createGitHubTransitionInput({ request, plan, planByteDigest,
    predecessorIssuance: null, predecessorAuthority });
  fixture.api.state.runStartedAtById['202'] = '2026-09-02T00:55:10Z';
  fixture.api.state.runUpdatedAtById['202'] = '2026-09-02T00:55:30Z';
  fixture.api.state.retirePublicationCommittedAt = '2026-09-02T00:55:40Z';
  fixture.api.state.currentDigest = deriveGitHubTransitionInputDigest(operationInput);
  const common = { ...fixture.common, workflowRun: workflowRun('202'), operationInput,
    now: () => Date.parse('2026-09-02T00:56:00.000Z') };
  await publishGitHubTransitionAuthority(common);
  const verify = createGitHubTransitionAuthorityVerifier(common);
  const retired = await createAuthenticatedTransitionOperationReceipt({ request, planBytes }, verify,
    { now: () => Date.parse('2026-09-02T00:56:00.000Z') });
  assert.equal(retired.transitionReceipt.resultState, 'retired');
  assert.equal(fixture.api.publications.size, 2);
});

test('retire accepts successor-bound policy drift limited to authorityRef', async () => {
  const fixture = await integrationFixture();
  await publishGitHubTransitionAuthority(fixture.common);
  fixture.api.state.transitionStatus = 'completed';
  const integrationVerifier = createGitHubTransitionAuthorityVerifier(fixture.common);
  const integrated = await createAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, integrationVerifier, { now: () => NOW });
  const prior = integrated.transitionReceipt;
  const plan = createEffectPlan({ target: { repository: 'github.com/example/target',
    resource: '/exact/dirty/worktree', immutableRevision: MERGE }, authority: {
    requestedTransition: 'retire', authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    claimId: prior.resultClaimId, leaseEpoch: prior.resultLeaseEpoch,
    fenceRevision: prior.resultFenceRevision, writeSetDigest: fixture.final.request.writeSetDigest,
    reviewLocator: null, predecessorDigest: integrated.receiptDigest },
    candidateDigest: fixture.final.plan.candidateDigest, snapshotDigest: fixture.final.plan.snapshotDigest,
    effectClass: 'claim-retirement-with-cleanup',
    allowedEffects: [...CLEANUP_EFFECTS, 'retire-claim'], forbiddenEffects: RETAINED_EFFECTS,
    parametersDigest: governanceDigest('cleanup-plan-bytes') });
  const planBytes = encodeEffectPlan(plan), planByteDigest = effectPlanByteDigest(planBytes);
  const predecessorAuthority = {
    schema: GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA,
    authorityKind: 'append-only-retire-successor-predecessor',
    authorityRef: 'refs/heads/main',
    reviewLocator: fixture.final.request.reviewLocator,
    sourceBranch: fixture.issuance.storedBundle.authorityBundle.candidate.branch,
    immutableRevision: MERGE,
    reviewedSourceHead: fixture.issuance.storedBundle.authorityBundle.candidate.headRevision,
    reviewedSourceTree: fixture.api.state.candidateTree,
    protectedBase: TARGET_BASE,
    predecessorIssuanceDigest: fixture.issuance.issuanceDigest,
    predecessorTransitionReceiptDigest: integrated.receiptDigest,
    adoptedTerminalClaimId: hex('4'),
    adoptedLineageDigest: hex('5'),
    integrationReceiptDigest: integrated.receiptDigest,
    reviewRequestId: 'github-pull-request:PR_fixture',
    retirementReason: 'integrated-successor-retire-continuation',
    adoptionDisposition: 'response-loss-adopted',
    cloudMutation: false,
    issuedAt: '2026-09-02T00:55:00.000Z',
    expiresAt: '2026-09-02T01:05:00.000Z',
  };
  const request = retire({ repository: plan.target.repository, authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42', scope: ['src/feature.mjs'], claimId: prior.resultClaimId,
    leaseEpoch: prior.resultLeaseEpoch, fenceRevision: prior.resultFenceRevision,
    immutableRevision: MERGE, dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt: '2026-09-02T00:55:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z' });
  const operationInput = createGitHubTransitionInput({ request, plan, planByteDigest,
    predecessorIssuance: null, predecessorAuthority });
  fixture.api.state.runStartedAtById['202'] = '2026-09-02T00:55:10Z';
  fixture.api.state.runUpdatedAtById['202'] = '2026-09-02T00:55:30Z';
  fixture.api.state.retirePublicationCommittedAt = '2026-09-02T00:55:40Z';
  fixture.api.state.currentDigest = deriveGitHubTransitionInputDigest(operationInput);
  fixture.api.state.runBranchesById = { 202: 'feature' };
  fixture.api.state.transitionPolicy = { ...fixture.api.state.transitionPolicy,
    authorityRef: 'refs/heads/feature' };
  const common = { ...fixture.common, policy: fixture.api.state.transitionPolicy,
    workflowRun: { ...workflowRun('202'), ref: 'refs/heads/feature',
      workflowRef: 'refs/heads/feature' },
    operationInput, now: () => Date.parse('2026-09-02T00:56:00.000Z') };
  await publishGitHubTransitionAuthority(common);
  const verify = createGitHubTransitionAuthorityVerifier(common);
  const retired = await createAuthenticatedTransitionOperationReceipt({ request, planBytes }, verify,
    { now: () => Date.parse('2026-09-02T00:56:00.000Z') });
  assert.equal(retired.transitionReceipt.resultState, 'retired');
  assert.equal(fixture.api.publications.size, 2);
});
