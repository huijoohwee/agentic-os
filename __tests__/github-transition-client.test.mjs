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
import { GITHUB_RETROSPECTIVE_INTEGRATION_MODE, GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA, createGitHubTransitionInput, deriveGitHubTransitionCoordinate, deriveGitHubTransitionInputDigest, deriveGitHubTransitionRunName, encodeGitHubTransitionInput, validateGitHubTransitionDispatchEvent } from '../src/github-transition-client.mjs';
import { createGitHubTransitionAuthorityVerifier, prepareGitHubIntegrationProviderProof, publishGitHubTransitionAuthority } from '../src/github-transition-authority.mjs';
import { GITHUB_TRANSITION_POLICY_SCHEMA, encodeGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';
import { CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS, INTEGRATION_RECORD_RETAINED_EFFECTS, RETAINED_EFFECTS } from '../src/cleanup-records.mjs';

const hex = (value, length = 64) => value.repeat(length);
const EVIDENCE_BASE = hex('a', 40), INITIAL_WORKFLOW = hex('b', 40);
const CANDIDATE = hex('c', 40), TARGET_BASE = hex('d', 40), TRANSITION_BASE = hex('e', 40);
const MERGE = hex('8', 40), LATER = hex('7', 40), INITIAL_PUBLICATION = hex('9', 40);
const INITIAL_TREE = hex('1', 40), INITIAL_BASE_TREE = hex('2', 40), INITIAL_BLOB = hex('3', 40);
const TRANSITION_BASE_TREE = hex('6', 40);
const STARTED = '2026-09-02T00:20:08.000Z', COMMITTED = '2026-09-02T00:21:00.000Z';
const NOW = Date.parse('2026-09-02T00:30:00.000Z');
const WORKFLOW_PATH = '.github/workflows/adlc-transition.yml';
const TRANSITION_POLICY = { schema: GITHUB_TRANSITION_POLICY_SCHEMA,
  authorityRepository: 'github.com/example/evidence', authorityRef: 'refs/heads/main',
  workflowPath: WORKFLOW_PATH, targetRepositories: ['github.com/example/target'],
  evidenceRefPrefix: 'refs/heads/adlc/authority/' };
const POLICY_CONTEXT = { policy: TRANSITION_POLICY, execution: {
  authorityRepository: 'github.com/example/evidence', authorityRef: 'refs/heads/main',
  workflowPath: WORKFLOW_PATH, workflowRevision: TRANSITION_BASE } };

function rule(type, rulesetId, parameters = null) { return { type, ruleset_id: rulesetId, parameters }; }
function canonicalRuleRows(id = 11) {
  return [rule('deletion', id), rule('non_fast_forward', id),
    rule('pull_request', id, { allowed_merge_methods: ['squash'] }),
    rule('required_status_checks', id, { required_status_checks: [{
      context: 'Initial Gate', integration_id: 15368 }],
    strict_required_status_checks_policy: false })];
}
function targetRuleRows(id = 21, methods = ['merge']) {
  return [rule('deletion', id), rule('non_fast_forward', id), rule('required_linear_history', id),
    rule('pull_request', id, { allowed_merge_methods: methods }),
    rule('required_status_checks', id, { required_status_checks: [{
      context: 'Integration Gate', integration_id: 15368 }],
    strict_required_status_checks_policy: false })];
}
function evidenceRuleRows(id) {
  return [rule('deletion', id), rule('non_fast_forward', id), rule('update', id,
    { update_allows_fetch_and_merge: false })];
}
function projection(repository, ref, id, rows, bypassActors = []) {
  return createGitHubProtectionProjection({ repository, ref, rulesets: [{ id: String(id),
    enforcement: 'active', rules: rows.map(({ type, parameters }) => ({ type, parameters })),
    bypassActors }] });
}
function predecessorIssuance(reviewState = 'open', issuanceMode = null, recoveryOverrides = {}) {
  const candidate = createRecoveryCandidate({ targetRepository: 'github.com/example/target',
    branch: 'agent/device/recovery', headRevision: CANDIDATE, canonicalBranch: 'main',
    canonicalRevision: TARGET_BASE, reviewLocator: 'https://github.com/example/target/pull/7',
    predecessorEvidenceDigest: hex('0'), inventoryAlgorithm: RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
    inventoryEntries: { index: 1, tracked: 1, visibleUntracked: 0, hidden: 0,
      ignoredRuntime: 0, content: 1 }, indexInventoryDigest: hex('1'),
    trackedInventoryDigest: hex('2'), visibleUntrackedInventoryDigest: hex('3'),
    hiddenInventoryDigest: hex('4'), ignoredRuntimeInventoryDigest: hex('5'),
    contentInventoryDigest: hex('6'), observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z' });
  const request = claim({ repository: candidate.targetRepository,
    authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    scope: ['src/feature.mjs'], dependentWork: [`effect-plan:sha256:${hex('a')}`],
    immutableRevision: `candidate:sha256:${candidate.candidateDigest}`,
    reviewLocator: candidate.reviewLocator, observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z' });
  const policy = { evidenceRepository: 'github.com/example/evidence',
    targetRepositoryPrefix: 'github.com/example/', canonicalRef: 'refs/heads/main',
    canonicalRevision: EVIDENCE_BASE, workflowPath: '.github/workflows/authority.yml',
    workflowRef: 'refs/heads/main', workflowRevision: INITIAL_WORKFLOW,
    confirmationClass: 'interactive-provider', requiredStatusChecks: ['Initial Gate'],
    allowedMergeMethods: ['squash'], evidenceRefPrefix: 'refs/heads/agentic-os/evidence/',
    evidencePathPrefix: 'authority-evidence/', validitySeconds: 3_600 };
  const workflowRun = { id: '101',
    locator: 'https://api.github.com/repos/example/evidence/actions/runs/101',
    event: 'workflow_dispatch', runAttempt: 1, repository: policy.evidenceRepository,
    ref: policy.canonicalRef, revision: policy.canonicalRevision,
    workflowPath: policy.workflowPath, workflowRef: policy.workflowRef,
    workflowRevision: policy.workflowRevision, startedAt: '2026-09-02T00:05:00.000Z',
    completedAt: '2026-09-02T00:05:30.000Z',
    authorityInputDigest: deriveGitHubAuthorityInputDigest({ request, candidate, policy,
      ...(issuanceMode === null ? {} : { issuanceMode }) }),
    actor: { id: '42', login: 'example' }, triggeringActor: { id: '42', login: 'example' } };
  const challenge = createGitHubAuthorityChallenge({ request, candidate, workflowRun, policy,
    expiresAt: '2026-09-02T00:55:00.000Z',
    ...(issuanceMode === null ? {} : { issuanceMode }) });
  const bundle = createFencedClaimBundle({ request, candidate, challenge, workflowRun, policy });
  const canonical = projection(policy.evidenceRepository, policy.canonicalRef, 11,
    canonicalRuleRows());
  const evidence = projection(policy.evidenceRepository, bundle.evidenceRef, 12,
    evidenceRuleRows(12));
  const protection = createGitHubProtectionSnapshot(canonical, evidence, {
    repository: policy.evidenceRepository, ref: policy.canonicalRef,
    revision: policy.canonicalRevision }, bundle);
  const target = createGitHubTargetRepositoryProjection({ repository: candidate.targetRepository,
    repositoryId: '77', owner: { id: '42', login: 'example' }, canonicalBranch: 'main',
    canonicalRevision: TARGET_BASE, candidateBranch: candidate.branch,
    candidateHeadRevision: CANDIDATE, review: { locator: candidate.reviewLocator, state: reviewState,
      draft: false, headRepository: candidate.targetRepository, headBranch: candidate.branch,
      headRevision: CANDIDATE, baseRepository: candidate.targetRepository, baseBranch: 'main',
      baseRevision: TARGET_BASE }, ...(issuanceMode === null ? {} : { retrospectiveProof: {
        schema: GITHUB_RETROSPECTIVE_TARGET_PROOF_SCHEMA, mergeRevision: MERGE,
        mergeEventId: '901', mergedAt: '2026-09-02T00:04:30.000Z',
        historicalBaseRevision: TARGET_BASE, liveCanonicalRevision: MERGE,
        candidateTreeRevision: hex('a', 40), mergeTreeRevision: hex('a', 40),
        ...recoveryOverrides,
      } }) }, bundle);
  const stored = createGitHubStoredAuthorityBundle({ authorityBundle: bundle,
    targetRepository: target, preProtection: protection });
  const receipt = createGitHubPublicationReceipt({ storedBundle: stored, publication: {
    repository: policy.evidenceRepository, ref: bundle.evidenceRef, path: bundle.evidencePath,
    revision: INITIAL_PUBLICATION, parentRevision: policy.canonicalRevision,
    committedAt: '2026-09-02T00:06:00.000Z', storedDigest: stored.storedDigest,
  }, postProtection: protection });
  return createGitHubAuthorityIssuance({ storedBundle: stored, publicationReceipt: receipt });
}

function integrationDraft(issuance, parametersDigest = hex('0'), integrationMode = null) {
  const source = issuance.storedBundle.authorityBundle;
  const plan = createEffectPlan({ target: { repository: 'github.com/example/target',
    resource: source.candidate.reviewLocator, immutableRevision: MERGE }, authority: {
    requestedTransition: 'integrate', authoritySubject: source.request.authoritySubject,
    ownerSubject: source.request.ownerSubject, claimId: source.request.claimId,
    leaseEpoch: issuance.transitionReceipt.resultLeaseEpoch,
    fenceRevision: issuance.transitionReceipt.resultFenceRevision,
    writeSetDigest: source.request.writeSetDigest, reviewLocator: source.candidate.reviewLocator,
    predecessorDigest: issuance.transitionReceipt.receiptDigest },
    candidateDigest: source.candidate.candidateDigest,
    snapshotDigest: source.candidate.workingStateDigest,
    effectClass: 'protected-integration-record',
    allowedEffects: INTEGRATION_RECORD_EFFECTS,
    forbiddenEffects: INTEGRATION_RECORD_RETAINED_EFFECTS, parametersDigest });
  const planBytes = encodeEffectPlan(plan), planByteDigest = effectPlanByteDigest(planBytes);
  const request = integrate({ repository: plan.target.repository,
    authoritySubject: plan.authority.authoritySubject, ownerSubject: plan.authority.ownerSubject,
    scope: ['src/feature.mjs'], claimId: plan.authority.claimId,
    leaseEpoch: plan.authority.leaseEpoch, fenceRevision: plan.authority.fenceRevision,
    dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    immutableRevision: MERGE, reviewLocator: plan.target.resource,
    observedAt: '2026-09-02T00:10:00.000Z', expiresAt: '2026-09-02T00:50:00.000Z' });
  return { request, plan, planBytes, planByteDigest, predecessorIssuance: issuance,
    ...(integrationMode === null ? {} : { integrationMode }) };
}
function successorPredecessorAuthority(issuance, {
  authorityRef = 'refs/heads/main',
  issuedAt = '2026-09-02T00:10:00.000Z',
  expiresAt = '2026-09-02T00:50:00.000Z',
} = {}) {
  const bundle = issuance.storedBundle.authorityBundle;
  const retrospective = issuance.storedBundle.targetRepository.retrospectiveProof;
  return {
    schema: GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA,
    authorityKind: 'append-only-replacement-transition-authority',
    authorityRef,
    reviewLocator: bundle.request.reviewLocator,
    sourceBranch: bundle.candidate.branch,
    immutableRevision: retrospective.mergeRevision,
    reviewedSourceHead: bundle.candidate.headRevision,
    reviewedSourceTree: retrospective.candidateTreeRevision,
    protectedBase: retrospective.historicalBaseRevision,
    predecessorIssuanceDigest: issuance.issuanceDigest,
    predecessorTransitionReceiptDigest: issuance.transitionReceipt.receiptDigest,
    adoptedTerminalClaimId: hex('4'),
    adoptedLineageDigest: hex('5'),
    integrationReceiptDigest: hex('6'),
    reviewRequestId: 'github-pull-request:PR_fixture',
    retirementReason: 'integrated',
    adoptionDisposition: 'response-loss-adopted',
    cloudMutation: false,
    issuedAt,
    expiresAt,
  };
}
function workflowRun(id = '201') {
  return { id, url: `https://api.github.com/repos/example/evidence/actions/runs/${id}`,
    ref: 'refs/heads/main', revision: TRANSITION_BASE, workflowRef: 'refs/heads/main',
    workflowPath: WORKFLOW_PATH, workflowRevision: TRANSITION_BASE,
    authoritySubject: 'github-user:42' };
}
function response(value, status = 200, headers = {}) {
  return new Response(value === null ? '' : JSON.stringify(value), { status, headers });
}
function commit(revision, parents, tree, date = COMMITTED) {
  return { sha: revision, parents: parents.map((sha) => ({ sha })), tree: { sha: tree },
    committer: { date } };
}
function checkRun(id, completedAt, overrides = {}) {
  return { id, name: 'Integration Gate', app: { id: 15368 },
    status: 'completed', conclusion: 'success', head_sha: CANDIDATE,
    completed_at: completedAt, ...overrides };
}
function apiFixture(issuance) {
  const calls = [], publications = new Map(), blobs = new Map(), trees = new Map(), commits = new Map();
  const state = { transitionStatus: 'completed', targetHead: MERGE, compareStatus: 'ahead',
    runId: '201', ruleSuiteResult: 'pass', ruleEvaluation: 'pass',
    checkCompletedAt: '2026-09-02T00:14:00Z', latestCheckId: 701,
    authorityHead: TRANSITION_BASE, runUpdatedAt: null, transitionPolicy: TRANSITION_POLICY,
    transitionRulesUpdatedAt: '2026-09-02T00:01:00Z', targetBypassActors: null,
    mergedAt: '2026-09-02T00:15:00Z', targetRepositoryId: 77,
    targetMergeMethods: ['merge'], ruleSuiteQuery: null, mergeEventRevisions: [MERGE],
    mergeEventCreatedAt: null, mergeEventHeaders: {},
    ruleSuitePushedAt: '2026-09-02T00:14:59Z', targetRulesUpdatedAt: '2026-09-02T00:13:00Z',
    mergeParents: [TARGET_BASE, CANDIDATE], mergeCommittedAt: '2026-09-02T00:15:00Z',
    candidateTree: hex('a', 40), mergeTree: hex('a', 40), pullBaseRevision: TARGET_BASE,
    targetOwner: { id: 42, login: 'example' }, absentRefBarrier: null,
    refCreateStatuses: [], concurrentRunTimes: false, runDigests: {} };
  const initialStored = issuance.storedBundle, bundle = initialStored.authorityBundle;
  const ruleDetail = (id, rows, bypass = []) => ({ id, enforcement: 'active',
    created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:01:00Z',
    rules: rows.map(({ type, parameters }) => ({ type, parameters })), bypass_actors: bypass });
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url), route = `${init.method} ${decodeURIComponent(parsed.pathname)}`;
    calls.push(route);
    if (route === 'GET /repos/example/evidence/actions/runs/101') return response({ id: 101,
      url: bundle.workflowRun.locator, display_title: `ADLC authority ${bundle.workflowRun.authorityInputDigest} @ ${INITIAL_WORKFLOW}`,
      event: 'workflow_dispatch', status: 'completed', conclusion: 'success', run_attempt: 1,
      repository: { full_name: 'example/evidence' }, head_branch: 'main', head_sha: EVIDENCE_BASE,
      path: '.github/workflows/authority.yml@main', workflow_id: 501,
      run_started_at: '2026-09-02T00:05:00Z', updated_at: '2026-09-02T00:05:30Z',
      actor: { id: 42, login: 'example' },
      triggering_actor: { id: 42, login: 'example' } });
    if (route === 'GET /repos/example/evidence/actions/workflows/501') return response({
      id: 501, path: '.github/workflows/authority.yml', state: 'active' });
    if (route === 'GET /users/example') return response({ id: 42, login: 'example' });
    if (route === `GET /repos/example/evidence/git/ref/heads/${bundle.evidenceRef.slice('refs/heads/'.length)}`)
      return response({ ref: bundle.evidenceRef, object: { type: 'commit', sha: INITIAL_PUBLICATION } });
    if (route === `GET /repos/example/evidence/contents/${bundle.evidencePath}`) {
      try { return response({ type: 'file', encoding: 'base64',
        content: Buffer.from(canonicalJson(initialStored)).toString('base64'), sha: INITIAL_BLOB }); }
      catch (error) { calls.push(`content-error:${error.message}`); throw error; }
    }
    if (route === `GET /repos/example/evidence/git/commits/${INITIAL_PUBLICATION}`)
      return response(commit(INITIAL_PUBLICATION, [EVIDENCE_BASE], INITIAL_TREE,
        '2026-09-02T00:06:00Z'));
    if (route === `GET /repos/example/evidence/git/commits/${EVIDENCE_BASE}`)
      return response(commit(EVIDENCE_BASE, [], INITIAL_BASE_TREE, '2026-09-02T00:00:00Z'));
    if (route === `GET /repos/example/evidence/git/trees/${INITIAL_BASE_TREE}`)
      return response({ sha: INITIAL_BASE_TREE, truncated: false, tree: [] });
    if (route === `GET /repos/example/evidence/git/trees/${INITIAL_TREE}`)
      return response({ sha: INITIAL_TREE, truncated: false, tree: [
        { path: 'authority-evidence', mode: '040000', type: 'tree', sha: hex('0', 40) },
        { path: bundle.evidencePath, mode: '100644', type: 'blob', sha: INITIAL_BLOB }] });
    if (route === 'GET /repos/example/evidence/rules/branches/main')
      return response(canonicalRuleRows());
    if (route === 'GET /repos/example/evidence/rulesets/11')
      return response(ruleDetail(11, canonicalRuleRows()));
    if (route === `GET /repos/example/evidence/rules/branches/${bundle.evidenceRef.slice('refs/heads/'.length)}`)
      return response(evidenceRuleRows(12));
    if (route === 'GET /repos/example/evidence/rulesets/12')
      return response(ruleDetail(12, evidenceRuleRows(12)));
    if (route === 'GET /repos/example/target') return response({ id: state.targetRepositoryId,
      full_name: 'example/target', owner: state.targetOwner });
    if (route === 'GET /repos/example/target/git/ref/heads/agent/device/recovery')
      return response({ ref: 'refs/heads/agent/device/recovery', object: { type: 'commit', sha: CANDIDATE } });
    if (route === 'GET /repos/example/target/git/ref/heads/main')
      return response({ ref: 'refs/heads/main', object: { type: 'commit', sha: state.targetHead } });
    if (route === 'GET /repos/example/target/pulls/7') return response({ number: 7,
      html_url: 'https://github.com/example/target/pull/7', state: 'closed', merged_at: state.mergedAt,
      merged: true, draft: false, head: { repo: { full_name: 'example/target' },
        ref: 'agent/device/recovery', sha: CANDIDATE },
      base: { repo: { full_name: 'example/target' }, ref: 'main',
        sha: state.pullBaseRevision } });
    if (route === 'GET /repos/example/target/issues/7/events') return response(
      state.mergeEventRevisions.map((commit_id, index) => ({ id: 901 + index, event: 'merged',
        commit_id, commit_url: `https://api.github.com/repos/example/target/commits/${commit_id}`,
        created_at: state.mergeEventCreatedAt ?? state.mergedAt })), 200, state.mergeEventHeaders);
    if (route === `GET /repos/example/target/git/commits/${MERGE}`)
      return response(commit(MERGE, state.mergeParents, state.mergeTree, state.mergeCommittedAt));
    if (route === `GET /repos/example/target/git/commits/${CANDIDATE}`)
      return response(commit(CANDIDATE, [TARGET_BASE], state.candidateTree,
        '2026-09-02T00:04:00Z'));
    if (route === 'GET /repos/example/target/rules/branches/main')
      return response(targetRuleRows(21, state.targetMergeMethods));
    if (route === 'GET /repos/example/target/rulesets/21') {
      const detail = { ...ruleDetail(21, targetRuleRows(21, state.targetMergeMethods)),
        created_at: '2026-09-02T00:00:00Z', updated_at: state.targetRulesUpdatedAt };
      if (state.targetBypassActors === null) delete detail.bypass_actors;
      else detail.bypass_actors = state.targetBypassActors;
      return response(detail);
    }
      const listedCheckRuns = state.checkRuns
        ?? [checkRun(state.latestCheckId, state.checkCompletedAt)];
      if (route === `GET /repos/example/target/commits/${CANDIDATE}/check-runs`)
        return response({ total_count: listedCheckRuns.length, check_runs: listedCheckRuns });
      const checkRunMatch = route.match(/^GET \/repos\/example\/target\/check-runs\/(\d+)$/u);
      if (checkRunMatch) {
        const record = state.checkRuns?.find((entry) => String(entry.id) === checkRunMatch[1])
          ?? checkRun(checkRunMatch[1], state.checkCompletedAt);
        return response(record);
      }
    if (route === 'GET /repos/example/target/rulesets/rule-suites') {
      state.ruleSuiteQuery = parsed.search;
      return response([{
        id: 801, actor_id: 42, actor_name: 'example', before_sha: TARGET_BASE, after_sha: MERGE,
        ref: 'refs/heads/main', repository_id: 77, repository_name: 'target',
        pushed_at: state.ruleSuitePushedAt, result: state.ruleSuiteResult,
      }]);
    }
    if (route === 'GET /repos/example/target/rulesets/rule-suites/801') return response({
      id: 801, actor_id: 42, actor_name: 'example', before_sha: TARGET_BASE, after_sha: MERGE,
      ref: 'refs/heads/main', repository_id: 77, repository_name: 'target',
      pushed_at: state.ruleSuitePushedAt, result: state.ruleSuiteResult,
      evaluation_result: state.ruleEvaluation,
      rule_evaluations: ['deletion', 'non_fast_forward', 'pull_request',
        'required_linear_history', 'required_status_checks'].map((rule_type) => ({
        rule_source: { type: 'ruleset', id: 21, name: 'protected main' },
        enforcement: 'active', result: state.ruleEvaluation, rule_type,
      })),
    });
    if (route === `GET /repos/example/target/compare/${MERGE}...${state.targetHead}`)
      return response({ status: state.compareStatus, base_commit: { sha: MERGE },
        merge_base_commit: { sha: state.compareStatus === 'diverged' ? TARGET_BASE : MERGE },
        head_commit: { sha: state.targetHead } });
    const runMatch = route.match(/^GET \/repos\/example\/evidence\/actions\/runs\/(\d+)$/u);
    if (runMatch) {
      const id = runMatch[1], input = [...publications.values()].find((entry) =>
        entry.stored.workflowRun.id === id)?.stored.operationInput;
      const digest = input ? deriveGitHubTransitionInputDigest(input)
        : state.runDigests[id] ?? state.currentDigest;
      return response({ id: Number(id), url: `https://api.github.com/repos/example/evidence/actions/runs/${id}`,
        repository: { full_name: 'example/evidence' }, event: 'workflow_dispatch', run_attempt: 1,
        status: state.transitionStatus, conclusion: state.transitionStatus === 'completed' ? 'success' : null,
        display_title: deriveGitHubTransitionRunName({ operationInputDigest: digest,
          workflowRevision: TRANSITION_BASE }), workflow_id: 601, head_branch: 'main',
        head_sha: TRANSITION_BASE, path: `${WORKFLOW_PATH}@main`,
        actor: { id: 42, login: 'example' }, triggering_actor: { id: 42, login: 'example' },
        run_started_at: id === '202' && !state.concurrentRunTimes ? '2026-09-02T00:22:08Z'
          : '2026-09-02T00:20:08Z',
        updated_at: state.runUpdatedAt ?? (id === '202' && !state.concurrentRunTimes ? '2026-09-02T00:22:30Z'
          : '2026-09-02T00:20:30Z') });
    }
    if (route === 'GET /repos/example/evidence/actions/workflows/601')
      return response({ id: 601, path: WORKFLOW_PATH, state: 'active' });
    if (route === 'GET /repos/example/evidence/git/ref/heads/main')
      return response({ ref: 'refs/heads/main', object: { type: 'commit', sha: state.authorityHead } });
    if (route === 'GET /repos/example/evidence/contents/.agentic-os/github-transition-policy.json')
      return response({ type: 'file', encoding: 'base64',
        content: encodeGitHubTransitionPolicy(state.transitionPolicy).toString('base64') });
    if (route.startsWith('GET /repos/example/evidence/rules/branches/adlc/authority/'))
      return response(evidenceRuleRows(13));
    if (route === 'GET /repos/example/evidence/rulesets/13')
      return response({ ...ruleDetail(13, evidenceRuleRows(13)),
        updated_at: state.transitionRulesUpdatedAt });
    const transitionRef = route.match(/^GET \/repos\/example\/evidence\/git\/ref\/heads\/adlc\/authority\/([0-9a-f]{64})$/u);
    if (transitionRef) {
      const found = publications.get(transitionRef[1]);
      const barrier = state.absentRefBarrier;
      if (!found && barrier) {
        barrier.count += 1;
        const stage = Math.floor((barrier.count - 1) / 2);
        if (barrier.count % 2 === 0) barrier.release[stage]();
        else await barrier.wait[stage];
      }
      return found ? response({ ref: found.stored.evidenceRef,
        object: { type: 'commit', sha: found.publication } }) : response(null, 404);
    }
    if (route === `GET /repos/example/evidence/git/commits/${TRANSITION_BASE}`)
      return response(commit(TRANSITION_BASE, [], TRANSITION_BASE_TREE, STARTED));
    const publishedCommit = [...publications.values()].find((entry) =>
      route === `GET /repos/example/evidence/git/commits/${entry.publication}`);
    if (publishedCommit) return response(commit(publishedCommit.publication,
      [TRANSITION_BASE], publishedCommit.tree,
      publishedCommit.stored.operationInput.request.requestedTransition === 'retire'
        ? '2026-09-02T00:23:00Z' : COMMITTED));
    if (route === `GET /repos/example/evidence/git/trees/${TRANSITION_BASE_TREE}`)
      return response({ sha: TRANSITION_BASE_TREE, truncated: false, tree: [] });
    const publishedTree = [...publications.values()].find((entry) =>
      route === `GET /repos/example/evidence/git/trees/${entry.tree}`);
    if (publishedTree) {
      return response({ sha: publishedTree.tree, truncated: false, tree: [
        { path: '.agentic-os', mode: '040000', type: 'tree', sha: hex('1', 40) },
        { path: '.agentic-os/authority', mode: '040000', type: 'tree', sha: hex('2', 40) },
        { path: '.agentic-os/authority/transitions', mode: '040000', type: 'tree', sha: hex('3', 40) },
        { path: publishedTree.stored.evidencePath, mode: '100644', type: 'blob',
          sha: publishedTree.blob }] });
    }
    if (route.startsWith('GET /repos/example/evidence/contents/.agentic-os/authority/transitions/')) {
      const coordinate = route.match(/([0-9a-f]{64})\.json$/u)?.[1], found = publications.get(coordinate);
      return found ? response({ type: 'file', encoding: 'base64', sha: found.blob,
        content: Buffer.from(canonicalJson(found.stored)).toString('base64') }) : response(null, 404);
    }
    if (route === 'POST /repos/example/evidence/git/blobs') {
      const content = JSON.parse(init.body).content;
      const stored = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
      const blob = createHash('sha1').update(`fixture-blob:${content}`).digest('hex');
      blobs.set(blob, stored); return response({ sha: blob }, 201);
    }
    if (route === 'POST /repos/example/evidence/git/trees') {
      const body = JSON.parse(init.body), stored = blobs.get(body.tree?.[0]?.sha);
      const tree = createHash('sha1').update(`fixture-tree:${init.body}`).digest('hex');
      if (!stored) throw new Error('fixture tree lost its blob');
      trees.set(tree, { stored, blob: body.tree[0].sha }); return response({ sha: tree }, 201);
    }
    if (route === 'POST /repos/example/evidence/git/commits') {
      const body = JSON.parse(init.body), pending = trees.get(body.tree);
      const publication = createHash('sha1').update(`fixture-commit:${init.body}`).digest('hex');
      if (!pending) throw new Error('fixture commit lost its tree');
      commits.set(publication, { ...pending, tree: body.tree, publication });
      return response({ sha: publication }, 201);
    }
    if (route === 'POST /repos/example/evidence/git/refs') {
      const pending = commits.get(JSON.parse(init.body).sha), stored = pending?.stored;
      if (!pending) throw new Error('fixture ref lost its commit');
      const coordinate = stored.coordinate;
      if (publications.has(coordinate)) {
        state.refCreateStatuses.push(422); return response({ message: 'exists' }, 422);
      }
      publications.set(coordinate, pending);
      state.refCreateStatuses.push(201);
      if (state.dropRefResponse) { state.dropRefResponse = false; throw new Error('lost response'); }
      return response({ ref: stored.evidenceRef }, 201);
    }
    calls.push(`unexpected:${route}${parsed.search}`);
    throw new Error(`unexpected ${route} ${parsed.search}`);
  };
  return { calls, fetchImpl, publications, state };
}

async function integrationFixture(configure = () => {}, {
  initialReviewState = 'open', integrationMode = null, recoveryOverrides = {},
} = {}) {
  const issuance = predecessorIssuance(initialReviewState,
    integrationMode === GITHUB_RETROSPECTIVE_INTEGRATION_MODE ? integrationMode : null,
    recoveryOverrides);
  const api = apiFixture(issuance);
  configure(api.state);
  const draft = integrationDraft(issuance, hex('0'), integrationMode);
  const draftInput = createGitHubTransitionInput({
    request: draft.request, plan: draft.plan, planByteDigest: draft.planByteDigest,
    predecessorIssuance: draft.predecessorIssuance,
    ...(integrationMode === null ? {} : { integrationMode }) });
  const common = { repository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target', workflowRun: workflowRun(),
    operationInput: draftInput, policy: TRANSITION_POLICY,
    token: 'secret', fetchImpl: api.fetchImpl, now: () => NOW };
  const { workflowRun: unusedWorkflowRun, ...preparation } = common;
  assert.equal(unusedWorkflowRun.id, '201');
  let proof;
  try { proof = await prepareGitHubIntegrationProviderProof({ ...preparation,
    workflowRevision: TRANSITION_BASE }); }
  catch (error) { throw new Error(`${error.message}; routes ${api.calls.slice(-12).join(' | ')}`); }
  const final = integrationDraft(issuance, proof.proofDigest, integrationMode);
  const operationInput = createGitHubTransitionInput({ request: final.request, plan: final.plan,
    planByteDigest: final.planByteDigest, predecessorIssuance: final.predecessorIssuance,
    ...(integrationMode === null ? {} : { integrationMode }) });
  api.state.currentDigest = deriveGitHubTransitionInputDigest(operationInput);
  return { issuance, api, final, operationInput, common: { ...common, operationInput } };
}
async function successorFixture(configure = () => {}, authorityOverrides = {}) {
  const issuance = predecessorIssuance('merged', GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
  const api = apiFixture(issuance);
  configure(api.state);
  const draft = integrationDraft(issuance, hex('0'), GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
  const predecessorAuthority = successorPredecessorAuthority(issuance, authorityOverrides);
  const draftInput = createGitHubTransitionInput({
    request: draft.request,
    plan: draft.plan,
    planByteDigest: draft.planByteDigest,
    predecessorIssuance: null,
    predecessorAuthority,
    integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
  });
  const common = { repository: 'github.com/example/evidence',
    targetRepository: 'github.com/example/target', workflowRun: workflowRun(),
    operationInput: draftInput, policy: TRANSITION_POLICY,
    token: 'secret', fetchImpl: api.fetchImpl, now: () => NOW };
  const { workflowRun: unusedWorkflowRun, ...preparation } = common;
  assert.equal(unusedWorkflowRun.id, '201');
  const proof = await prepareGitHubIntegrationProviderProof({ ...preparation,
    workflowRevision: TRANSITION_BASE });
  const final = integrationDraft(issuance, proof.proofDigest,
    GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
  const operationInput = createGitHubTransitionInput({
    request: final.request,
    plan: final.plan,
    planByteDigest: final.planByteDigest,
    predecessorIssuance: null,
    predecessorAuthority,
    integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
  });
  api.state.currentDigest = deriveGitHubTransitionInputDigest(operationInput);
  return { issuance, api, final, operationInput, predecessorAuthority,
    common: { ...common, operationInput } };
}
function inputWithExpiry(fixture, expiresAt) {
  const { requestDigest: omitted, ...source } = fixture.final.request;
  assert.match(omitted, /^[0-9a-f]{64}$/u);
  const request = integrate({ ...source, expiresAt });
  return createGitHubTransitionInput({ request, plan: fixture.final.plan,
    planByteDigest: fixture.final.planByteDigest, predecessorIssuance: fixture.issuance,
    ...(fixture.operationInput.integrationMode === undefined ? {}
      : { integrationMode: fixture.operationInput.integrationMode }) });
}

function historicalSquash(state, { rulesUpdatedAfterMerge = false } = {}) {
  state.mergedAt = '2026-09-02T00:04:30Z';
  state.checkCompletedAt = '2026-09-02T00:04:00Z';
  state.ruleSuitePushedAt = '2026-09-02T00:04:29Z';
  state.targetRulesUpdatedAt = rulesUpdatedAfterMerge
    ? '2026-09-02T00:07:00Z' : '2026-09-02T00:03:00Z';
  state.targetMergeMethods = ['squash'];
  state.mergeParents = [TARGET_BASE];
  state.mergeCommittedAt = '2026-09-02T00:04:29Z';
}

test('canonical transition input binds predecessor issuance and excludes result fields', async () => {
  const { api, operationInput } = await integrationFixture();
  assert.equal(api.state.ruleSuiteQuery,
    '?ref=refs%2Fheads%2Fmain&time_period=day&rule_suite_result=pass&per_page=100');
  const bytes = encodeGitHubTransitionInput(operationInput);
  const digest = deriveGitHubTransitionInputDigest(bytes);
  assert.equal(digest, deriveGitHubTransitionInputDigest(operationInput));
  assert.deepEqual(validateGitHubTransitionDispatchEvent({ inputs: {
    operation_payload: bytes.toString('utf8'), operation_input_digest: digest,
  } }, POLICY_CONTEXT).operationInput, operationInput);
  assert.throws(() => createGitHubTransitionInput({ ...operationInput, resultState: 'integrated' }),
    /fields/u);
  const noncanonical = ` ${bytes.toString('utf8')}`;
  const noncanonicalDigest = createHash('sha256').update(noncanonical).digest('hex');
  assert.throws(() => validateGitHubTransitionDispatchEvent({ inputs: {
    operation_payload: noncanonical, operation_input_digest: noncanonicalDigest,
  } }, POLICY_CONTEXT), /canonical|payload/u);
  assert.throws(() => validateGitHubTransitionDispatchEvent({ inputs: {
    operation_payload: bytes.toString('utf8'), operation_input_digest: hex('0'), extra: 'x',
  } }, POLICY_CONTEXT), /fields/u);
  assert.throws(() => validateGitHubTransitionDispatchEvent({ inputs: {
    operation_payload: bytes.toString('utf8'), operation_input_digest: hex('0'),
  } }, POLICY_CONTEXT), /do not match/u);
  assert.throws(() => validateGitHubTransitionDispatchEvent({ inputs: {
    operation_payload: bytes.toString('utf8'), operation_input_digest: digest,
  } }, { policy: { ...TRANSITION_POLICY,
    targetRepositoryPrefixes: ['github.com/example/'] }, execution: POLICY_CONTEXT.execution }),
  /fields/u);
  assert.throws(() => validateGitHubTransitionDispatchEvent({ inputs: {
    operation_payload: bytes.toString('utf8'), operation_input_digest: digest,
  } }, { policy: TRANSITION_POLICY, execution: { ...POLICY_CONTEXT.execution,
    authorityRef: 'refs/heads/feature' } }), /committed policy/u);
});

test('provider event timestamp tolerance remains bounded', async () => {
  await assert.rejects(integrationFixture((state) => {
    state.ruleSuitePushedAt = '2026-09-02T00:14:54Z';
  }), /rule suite identity or result/u);
});

test('merge event is unique, exact, and pagination-bounded', async () => {
  await assert.rejects(integrationFixture((state) => {
    state.mergeEventRevisions = [MERGE, hex('7', 40)];
  }), /one exact merge event/u);
  await assert.rejects(integrationFixture((state) => {
    state.mergeEventRevisions = [hex('7', 40)];
  }), /exact protected integration/u);
  await assert.rejects(integrationFixture((state) => {
    state.mergeEventHeaders = { link: '<https://api.github.com/next>; rel="next"' };
  }), /merge events are incomplete/u);
});

test('merge event timestamp permits only bounded absolute provider skew', async () => {
  await integrationFixture((state) => {
    state.mergeEventCreatedAt = '2026-09-02T00:15:01Z';
  });
  for (const createdAt of ['2026-09-02T00:15:06Z', '2026-09-02T00:14:54Z']) {
    await assert.rejects(integrationFixture((state) => {
      state.mergeEventCreatedAt = createdAt;
    }), /exact protected integration/u);
  }
});

test('explicit retrospective recovery records an already-merged exact squash without backdating',
  async () => {
    const fixture = await integrationFixture((state) => historicalSquash(state, {
      rulesUpdatedAfterMerge: true,
    }), { initialReviewState: 'merged',
      integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE });
    assert.equal(fixture.operationInput.integrationMode,
      GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
    const winner = await publishGitHubTransitionAuthority(fixture.common);
    assert.equal(fixture.final.plan.parametersDigest, winner.stored.providerProof.proofDigest);
    assert.equal(winner.stored.providerProof.integrationMode,
      GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
    assert.equal(winner.stored.providerProof.candidateTreeRevision,
      winner.stored.providerProof.mergeTreeRevision);
    assert.ok(Date.parse(winner.committedAt)
      > Date.parse(winner.stored.providerProof.mergedAt));
    const verifier = createGitHubTransitionAuthorityVerifier(fixture.common);
    const receipt = await createAuthenticatedTransitionOperationReceipt({
      request: fixture.final.request, planBytes: fixture.final.planBytes,
    }, verifier, { now: () => NOW });
    assert.deepEqual(await replayAuthenticatedTransitionOperationReceipt({
      request: fixture.final.request, planBytes: fixture.final.planBytes,
    }, verifier), receipt);
  });

test('successor predecessor authority records an already-merged exact squash', async () => {
  const fixture = await successorFixture((state) => historicalSquash(state, {
    rulesUpdatedAfterMerge: true,
  }));
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.equal(winner.stored.operationInput.predecessorIssuance, null);
  assert.deepEqual(winner.stored.operationInput.predecessorAuthority,
    fixture.predecessorAuthority);
  assert.equal(winner.stored.providerProof.integrationMode,
    GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
  assert.equal(winner.stored.providerProof.successorAuthorityKind,
    'append-only-replacement-transition-authority');
  assert.equal(winner.stored.providerProof.predecessorTransitionReceiptDigest,
    fixture.issuance.transitionReceipt.receiptDigest);
  const verifier = createGitHubTransitionAuthorityVerifier(fixture.common);
  const receipt = await createAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, verifier, { now: () => NOW });
  assert.deepEqual(await replayAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, verifier), receipt);
});

test('retrospective proof selects the latest successful required check rerun', async () => {
  const fixture = await successorFixture((state) => {
    historicalSquash(state, { rulesUpdatedAfterMerge: true });
    state.checkRuns = [
      checkRun(700, '2026-09-02T00:03:00Z'),
      checkRun(701, '2026-09-02T00:04:00Z'),
    ];
  });
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.deepEqual(winner.stored.providerProof.requiredChecks, [{
    context: 'Integration Gate',
    checkRunId: '701',
    appId: '15368',
    status: 'completed',
    conclusion: 'success',
    completedAt: '2026-09-02T00:04:00.000Z',
    revision: CANDIDATE,
  }]);
});

test('successor predecessor authority fails closed on policy-anchor and source-tree drift',
  async () => {
    await assert.rejects(successorFixture((state) => historicalSquash(state), {
      authorityRef: 'refs/heads/other',
    }), /policy is not anchored to the successor predecessor authority ref/u);
    await assert.rejects(successorFixture((state) => historicalSquash(state), {
      issuedAt: '2026-09-02T00:03:00.000Z',
    }), /retrospective integration was not provider-observed before recovery authority/u);
  });

test('retrospective recovery is closed to merged-source, chronology, squash, tree, and base drift',
  async () => {
    await assert.rejects(integrationFixture((state) => historicalSquash(state), {
      initialReviewState: 'merged',
    }), /predecessor authority window/u, 'absence of the explicit mode stays on normal chronology');
    await assert.rejects(integrationFixture((state) => historicalSquash(state), {
      integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
    }), /initial review was already merged|record-only recovery/u,
    'an open initial review cannot use recovery mode');
    await assert.rejects(integrationFixture((state) => {
      state.targetMergeMethods = ['squash']; state.mergeParents = [TARGET_BASE];
    }, { initialReviewState: 'merged',
      integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE }),
    /before recovery authority/u, 'recovery cannot replace prospective integration chronology');
    for (const mutate of [
      (state) => { state.candidateTree = hex('f', 40); },
      (state) => { state.targetMergeMethods = ['merge']; state.mergeParents = [TARGET_BASE, CANDIDATE]; },
      (state) => { state.pullBaseRevision = hex('f', 40); },
    ]) {
      await assert.rejects(integrationFixture((state) => {
        historicalSquash(state); mutate(state);
      }, { initialReviewState: 'merged',
        integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE }),
      /before recovery authority|exact protected integration/u);
    }
    await assert.rejects(integrationFixture((state) => historicalSquash(state), {
      initialReviewState: 'merged', integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
      recoveryOverrides: { mergeEventId: '902' },
    }), /before recovery authority/u, 'the reobserved merge event must match initial evidence');
    await assert.rejects(integrationFixture((state) => {
      historicalSquash(state); state.ruleSuitePushedAt = '2026-09-02T00:05:30Z';
    }, { initialReviewState: 'merged', integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE }),
    /before recovery authority/u, 'the historical rule suite must predate authority start');
    await assert.rejects(integrationFixture((state) => {
      historicalSquash(state); state.targetHead = LATER; state.compareStatus = 'identical';
    }, { initialReviewState: 'merged', integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE }),
    /contained by the protected canonical ref/u, 'distinct revisions cannot compare identical');
  });

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
