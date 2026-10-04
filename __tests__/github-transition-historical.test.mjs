import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, governanceDigest, integrate, retire } from '../src/governance.mjs';
import { createAuthenticatedTransitionOperationReceipt, createEffectPlan, effectPlanByteDigest, encodeEffectPlan } from '../src/completion.mjs';
import { createGitHubTransitionInput, createGitHubStoredTransition, deriveGitHubTransitionInputDigest, encodeGitHubTransitionInput, validateGitHubTransitionDispatchEvent } from '../src/github-transition-client.mjs';
import { createGitHubTransitionAuthorityVerifier, publishGitHubTransitionAuthority } from '../src/github-transition-authority.mjs';
import { GITHUB_HISTORICAL_CONTENT_MODE, GITHUB_TRANSITION_RECOVERY_POLICY_SCHEMA, validateGitHubTransitionPolicy, validateTransitionProviderProof } from '../src/github-transition-policy.mjs';
import { RECORD_ONLY_RETIREMENT_EFFECTS, RECORD_ONLY_RETIREMENT_RETAINED_EFFECTS } from '../src/cleanup-records.mjs';
import { CANDIDATE, TARGET_BASE, MERGE, NOW, TRANSITION_BASE, TRANSITION_POLICY, POLICY_CONTEXT, hex, checkRun, historicalSquash, integrationFixture, workflowRun } from './lib/github-transition-fixture.mjs';

const SCOPE = ['recovery/current-historical-content/pr-7'];
const ENROLLMENT = { schema: 'agentic-os/historical-content-enrollment/v1',
  repository: 'github.com/example/target', reviewLocator: 'https://github.com/example/target/pull/7',
  baseRevision: TARGET_BASE, headRevision: CANDIDATE, mergeRevision: MERGE, treeRevision: hex('a', 40),
  checkContexts: ['Integration Gate'], adoptionScope: SCOPE, rationale: 'Current adoption with historical authority unproven.' };
const ADOPTION = { schema: 'agentic-os/successor-preservation-adoption/v1',
  repository: ENROLLMENT.repository, predecessorRef: 'agent/device/predecessor', predecessorHead: hex('4', 40),
  successorRef: 'agent/device/recovery', successorHead: CANDIDATE, merge: MERGE,
  reviewLocator: ENROLLMENT.reviewLocator, replacedPaths: ['src/feature.mjs'], quarantineCoordinate: hex('f'),
  historicalSuccessionAuthorityProven: false };
const POLICY = { ...TRANSITION_POLICY, schema: GITHUB_TRANSITION_RECOVERY_POLICY_SCHEMA,
  historicalIntegrations: [ENROLLMENT], preservationAdoptions: [ADOPTION] };
function configure(state) {
  historicalSquash(state);
  state.targetMergeMethods = ['squash', 'rebase'];
  state.ruleSuiteRowsEmpty = true;
  state.transitionPolicy = POLICY;
}
const fixture = (change = () => {}) => integrationFixture(state => { configure(state); change(state); }, {
  initialReviewState: 'merged', integrationMode: GITHUB_HISTORICAL_CONTENT_MODE, scope: SCOPE });

async function publish(fx) {
  const winner = await publishGitHubTransitionAuthority(fx.common);
  const receipt = await createAuthenticatedTransitionOperationReceipt({ request: fx.final.request,
    planBytes: fx.final.planBytes }, createGitHubTransitionAuthorityVerifier(fx.common), { now: () => NOW });
  return { winner, receipt };
}
test('historical facts authenticate content with a distinct proof and no invented suite', async () => {
  const fx = await fixture(), { winner } = await publish(fx), proof = winner.stored.providerProof;
  assert.equal(proof.schema, 'agentic-os/github-integrate-provider-proof/v2');
  assert.equal(proof.proofBasis, GITHUB_HISTORICAL_CONTENT_MODE);
  assert.equal(proof.mergeMethod, 'unproven');
  assert.equal(proof.enrollmentDigest, governanceDigest(ENROLLMENT));
  for (const key of ['historicalProtectionProven', 'historicalRequiredCheckPolicyProven', 'historicalRuleSuiteProven', 'methodProven'])
    assert.equal(proof[key], false);
  assert.equal(proof.successfulChecks[0].checkRunId, '701');
  assert.equal(proof.successfulChecks[0].revision, CANDIDATE);
  assert.ok(proof.currentTargetProtection.targetRequiredContexts);
  assert.ok(!Object.keys(proof).some(key => key.startsWith('ruleSuite')));
  assert.ok(!fx.api.calls.some(route => route.includes('/rule-suites')));
});

test('historical facts require exact v2 enrollment and a distinct reviewed current scope', async () => {
  for (const policy of [TRANSITION_POLICY, { ...POLICY, historicalIntegrations: [] },
    { ...POLICY, historicalIntegrations: [{ ...ENROLLMENT, mergeRevision: hex('6', 40) }] },
    { ...POLICY, historicalIntegrations: [{ ...ENROLLMENT, checkContexts: ['Foreign Gate'] }] }])
    await assert.rejects(fixture(state => { state.transitionPolicy = policy; }), /enrollment|required checks/u);
  await assert.rejects(integrationFixture(configure, { initialReviewState: 'merged',
    integrationMode: GITHUB_HISTORICAL_CONTENT_MODE }), /enrollment/u);
  assert.throws(() => validateGitHubTransitionPolicy({ ...POLICY, historicalIntegrations: [
    { ...ENROLLMENT, adoptionScope: ['src/feature.mjs'] }] }), /current-adoption scope/u);
});

test('historical dispatch rejects missing enrollment and legacy proof-schema substitution', async () => {
  const fx = await fixture(), bytes = encodeGitHubTransitionInput(fx.operationInput);
  const event = { inputs: { operation_payload: bytes.toString('utf8'), operation_input_digest: deriveGitHubTransitionInputDigest(bytes) } };
  assert.equal(validateGitHubTransitionDispatchEvent(event, { ...POLICY_CONTEXT, policy: POLICY }).operationInput.integrationMode, GITHUB_HISTORICAL_CONTENT_MODE);
  assert.throws(() => validateGitHubTransitionDispatchEvent(event, POLICY_CONTEXT), /enrollment/u);
  const { winner } = await publish(fx), original = winner.stored.providerProof;
  for (const update of [{ schema: 'agentic-os/github-integrate-provider-proof/v1' }, { methodProven: true },
    { historicalRuleSuiteProven: true }, { ruleSuiteId: '801' }, { ruleSuitePushedAt: '2026-09-02T00:04:29.000Z' }]) {
    const { proofDigest: omitted, ...payload } = { ...original, ...update };
    assert.ok(omitted);
    assert.throws(() => validateTransitionProviderProof({ ...payload, proofDigest: governanceDigest(payload) }, fx.operationInput), /schema|unproven history/u);
  }
});

test('historical facts reject late checks, changed source/event/tree/ancestry before effects', async () => {
  for (const change of [state => { state.checkCompletedAt = '2026-09-02T00:04:31Z'; },
    state => { state.mergeTree = hex('b', 40); }, state => { state.pullBaseRevision = hex('5', 40); },
    state => { state.mergeEventRevisions = [MERGE, MERGE]; },
    state => { state.targetHead = hex('7', 40); state.compareStatus = 'diverged'; },
    state => { state.mergeCommittedAt = '2026-09-02T00:04:20Z'; }])
    await assert.rejects(fixture(change), /checks|retrospective|review|merge event|contained/u);
});

test('historical exact replay consumes original check IDs and never new effects after expiry', async () => {
  const fx = await fixture(), { winner, receipt } = await publish(fx), originalCalls = [...fx.api.calls];
  fx.api.state.latestCheckId = 999;
  fx.api.state.checkRuns = [{ id: 999, name: 'Integration Gate', app: { id: 15368 }, head_sha: CANDIDATE,
    completed_at: '2026-09-02T00:04:20Z', status: 'completed', conclusion: 'success' }];
  const replay = await publishGitHubTransitionAuthority({ ...fx.common, now: () => Date.parse('2026-09-03T00:00:00Z') });
  assert.equal(replay.publicationDigest, winner.publicationDigest);
  const repeated = await createGitHubTransitionAuthorityVerifier(fx.common)({ request: fx.final.request,
    plan: fx.final.plan, planByteDigest: fx.final.planByteDigest });
  assert.equal(repeated.providerRecordDigest, winner.publicationDigest);
  assert.equal(fx.api.publications.size, 1);
  assert.ok(fx.api.calls.slice(originalCalls.length).some(route => route.endsWith('/check-runs/701')));
  assert.ok(!fx.api.calls.slice(originalCalls.length).some(route => route.startsWith('POST ')));
});

test('historical publication rejects changed committed policy and expiry before any winner', async () => {
  const fx = await fixture();
  fx.api.state.transitionPolicy = { ...POLICY, historicalIntegrations: [{ ...ENROLLMENT, rationale: 'Changed decision.' }] };
  await assert.rejects(publishGitHubTransitionAuthority(fx.common), /committed.*policy/u);
  fx.api.state.transitionPolicy = POLICY;
  await assert.rejects(publishGitHubTransitionAuthority({ ...fx.common, now: () => Date.parse('2026-09-03T00:00:00Z') }), /request window/u);
  assert.equal(fx.api.publications.size, 0);
});

test('legacy retrospective modes still reject absent real rule suites', async () => {
  const { GITHUB_RETROSPECTIVE_CONTENT_MODE, GITHUB_RETROSPECTIVE_INTEGRATION_MODE } = await import('../src/github-transition-client.mjs');
  for (const integrationMode of [GITHUB_RETROSPECTIVE_CONTENT_MODE, GITHUB_RETROSPECTIVE_INTEGRATION_MODE])
    await assert.rejects(integrationFixture(state => { historicalSquash(state); state.ruleSuiteRowsEmpty = true; },
      { initialReviewState: 'merged', integrationMode }), /passing rule suite/u);
});



test('historical check selection rejects failed, foreign app and head substitutions', async () => {
  for (const change of [{ conclusion: 'failure' }, { app: { id: 999 } }, { head_sha: hex('b', 40) }, { name: 'Foreign Gate' }])
    await assert.rejects(fixture(state => { state.checkRuns = [checkRun(701, state.checkCompletedAt, change)]; }), /required checks/u);
});


test('historical mode cannot adopt an unmerged initial authority or reuse a legacy proof basis', async () => {
  await assert.rejects(integrationFixture(configure, { initialReviewState: 'open', integrationMode: GITHUB_HISTORICAL_CONTENT_MODE,
    scope: SCOPE }), /already merged|not eligible/u);
  const fx = await fixture(), { winner } = await publish(fx), { integrationMode: omitted, ...legacy } = fx.operationInput;
  assert.equal(omitted, GITHUB_HISTORICAL_CONTENT_MODE);
  assert.throws(() => validateTransitionProviderProof(winner.stored.providerProof, legacy), /proof schema/u);
});

test('historical integration rejects a changed current scope despite otherwise valid request and plan digests', async () => {
  const fx = await fixture(), scope = ['recovery/current-historical-content/pr-foreign'];
  const { planDigest: omittedPlan, ...planSource } = fx.final.plan;
  const plan = createEffectPlan({ ...planSource, authority: { ...planSource.authority,
    writeSetDigest: governanceDigest(scope) } });
  const planByteDigest = effectPlanByteDigest(encodeEffectPlan(plan));
  const { requestDigest: omittedRequest, writeSetDigest: omittedWriteSet, ...requestSource } = fx.final.request;
  assert.ok(omittedPlan && omittedRequest && omittedWriteSet);
  const request = integrate({ ...requestSource, scope, dependentWork: [`effect-plan:sha256:${planByteDigest}`] });
  assert.throws(() => createGitHubTransitionInput({ request, plan, planByteDigest,
    predecessorIssuance: fx.issuance, integrationMode: GITHUB_HISTORICAL_CONTENT_MODE }),
    /historical integration initial claim scope changed/u);
  assert.equal(fx.api.publications.size, 0);
});
