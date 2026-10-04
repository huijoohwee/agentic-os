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

test('historical content inclusion authenticates an ambiguous linear merge without naming its method', async () => {
  const configure = (state) => {
    historicalSquash(state, { rulesUpdatedAfterMerge: true });
    state.targetMergeMethods = ['merge', 'rebase', 'squash'];
  };
  const options = { initialReviewState: 'merged', integrationMode: GITHUB_RETROSPECTIVE_CONTENT_MODE };
  const fixture = await integrationFixture(configure, options);
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.equal(winner.stored.providerProof.integrationMode, GITHUB_RETROSPECTIVE_CONTENT_MODE);
  assert.equal(winner.stored.providerProof.mergeMethod, 'unproven');
  assert.equal(winner.stored.providerProof.integrationMethodEvidence.methodProven, false);
  assert.equal(winner.stored.providerProof.candidateTreeRevision,
    winner.stored.providerProof.mergeTreeRevision);
  const verifier = createGitHubTransitionAuthorityVerifier(fixture.common);
  await createAuthenticatedTransitionOperationReceipt({
    request: fixture.final.request, planBytes: fixture.final.planBytes,
  }, verifier, { now: () => NOW });
  await assert.rejects(integrationFixture((state) => {
    configure(state); state.mergeTree = hex('f', 40);
  }, options), /historical content differs|retrospective integration/u);
  await assert.rejects(integrationFixture((state) => {
    configure(state); state.pullBaseRevision = hex('f', 40);
  }, options), /exact protected integration/u);
  await assert.rejects(integrationFixture((state) => {
    configure(state); state.mergeEventRevisions = [hex('7', 40)];
  }, options), /exact protected integration/u);
  await assert.rejects(integrationFixture(configure, {
    initialReviewState: 'open', integrationMode: GITHUB_RETROSPECTIVE_CONTENT_MODE,
  }), /retrospective target proof|retrospective recovery/u);
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

test('successor predecessor authority accepts an exact historical squash under still-ambiguous live methods',
  async () => {
    const fixture = await successorFixture((state) => {
      historicalSquash(state, { rulesUpdatedAfterMerge: true });
      state.targetMergeMethods = ['merge', 'rebase', 'squash'];
    });
    const winner = await publishGitHubTransitionAuthority(fixture.common);
    assert.equal(winner.stored.providerProof.mergeMethod, 'squash');
    assert.equal(winner.stored.providerProof.integrationMode,
      GITHUB_RETROSPECTIVE_INTEGRATION_MODE);
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

test('retrospective proof uses classic branch checks and ignores deleted rulesets', async () => {
  const fixture = await successorFixture((state) => {
    historicalSquash(state, { rulesUpdatedAfterMerge: true });
    state.targetRulesetContexts = ['Budgets', 'Integration Gate'];
    state.targetClassicProtectionContexts = ['Integration Gate'];
    state.targetClassicConversationResolution = true;
    state.ruleEvaluations = [
      'deletion',
      'non_fast_forward',
      'pull_request',
      'required_linear_history',
      'required_review_thread_resolution',
      'required_status_checks',
    ].map((rule_type) => ({
      rule_source: { type: 'protected_branch' },
      enforcement: 'active',
      result: state.ruleEvaluation,
      rule_type,
    })).concat([{
      rule_source: { type: 'ruleset', name: 'deleted budget ruleset' },
      enforcement: 'deleted ruleset',
      result: state.ruleEvaluation,
      rule_type: 'required_status_checks',
    }]);
  });
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.deepEqual(winner.stored.providerProof.targetRequiredContexts, ['Integration Gate']);
  assert.ok(winner.stored.providerProof.targetActiveRuleTypes.includes(
    'required_review_thread_resolution'));
});

test('retrospective proof accepts complete strict classic protection without rulesets', async () => {
  const fixture = await successorFixture((state) => {
    historicalSquash(state, { rulesUpdatedAfterMerge: true });
    state.targetRulesetRowsEmpty = true;
    state.targetClassicStrict = true;
    state.targetClassicConversationResolution = true;
    state.ruleEvaluations = ['deletion', 'non_fast_forward', 'pull_request',
      'required_linear_history', 'required_review_thread_resolution',
      'required_status_checks'].map((rule_type) => ({
      rule_source: { type: 'protected_branch' }, enforcement: 'active',
      result: state.ruleEvaluation, rule_type,
    }));
  });
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.deepEqual(winner.stored.providerProof.targetRulesetVersions, []);
  assert.deepEqual(winner.stored.providerProof.targetRequiredContexts, ['Integration Gate']);
  assert.deepEqual(winner.stored.providerProof.targetAllowedMergeMethods, ['squash']);
});

test('retrospective proof widens rule suite lookup for older merges', async () => {
  const fixture = await successorFixture((state) => {
    historicalSquash(state, { rulesUpdatedAfterMerge: true });
    state.mergedAt = '2026-08-30T20:20:22Z';
    state.checkCompletedAt = '2026-08-30T20:20:00Z';
    state.ruleSuitePushedAt = '2026-08-30T20:20:21Z';
    state.ruleSuiteHeaders = { link: '<https://api.github.com/example?page=2>; rel=\"next\"' };
    state.mergeCommittedAt = '2026-08-30T20:20:21Z';
    state.targetRulesUpdatedAt = '2026-09-02T00:07:00Z';
  });
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.equal(fixture.api.state.ruleSuiteQuery,
    '?ref=refs%2Fheads%2Fmain&time_period=week&rule_suite_result=pass&per_page=100');
  assert.equal(winner.stored.providerProof.ruleSuiteId, '801');
});

test('canonical containment accepts compare payloads without head_commit', async () => {
  const fixture = await successorFixture((state) => {
    historicalSquash(state, { rulesUpdatedAfterMerge: true });
    state.compareHeadCommitMissing = true;
  });
  const winner = await publishGitHubTransitionAuthority(fixture.common);
  assert.equal(winner.stored.providerProof.observedCanonicalHead, MERGE);
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
