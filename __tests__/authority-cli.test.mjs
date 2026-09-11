import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJson, claim } from '../src/governance.mjs';
import { MAX_STRING_BYTES } from '../src/catalog-input.mjs';
import { RECOVERY_CANDIDATE_INVENTORY_ALGORITHM, createRecoveryCandidate } from '../src/recovery-candidate.mjs';
import { deriveGitHubAuthorityInputDigest, GITHUB_RETROSPECTIVE_RECOVERY_MODE }
  from '../src/github-authority.mjs';
import { validateGitHubAuthorityIssuance } from '../src/github-authority-issuer.mjs';
import {
  createEffectPlan,
  effectPlanByteDigest,
  encodeEffectPlan,
} from '../src/completion.mjs';
import {
  createGitHubAuthorityLiveVerificationReceipt,
  createGitHubAuthorityReadProvider,
  deriveGitHubAuthorityRunName,
  validateGitHubAuthorityLiveVerificationReceipt,
  verifyGitHubAuthorityIssuanceLive,
} from '../src/github-authority-client.mjs';
import {
  MAX_AUTHORITY_EVENT_BYTES,
  MAX_AUTHORITY_INPUT_BYTES,
  MAX_AUTHORITY_RESPONSE_BYTES,
  loadAuthorityDispatch,
  parseAuthorityArguments,
  runAuthority,
} from '../bin/agentic-os-authority.mjs';

import { hash, HEAD, WORKFLOW, TARGET_BASE, TARGET_HEAD, PARENT, BASE_TREE, EVIDENCE_TREE, BLOB, PUBLICATION, MERGE, LIVE_TARGET, TARGET_TREE, STARTED, COMPLETED, COMMITTED, NOW, RUN, candidate, dispatch, policy, effectivePolicy, response, ambientMetadata, githubUserMetadata, content, commit, stream, sandbox, rule, fixture } from './fixtures/authority-cli-fixture.mjs';

test('authority command accepts only a current workflow dispatch event and committed policy', () => {
  assert.deepEqual(parseAuthorityArguments(['issue-github', '--event=event.json', '--policy', 'policy.json',
    '--repository=github.com/example/evidence', '--run-id=101']), {
    command: 'issue-github', eventPath: 'event.json', policyPath: 'policy.json',
    repository: 'github.com/example/evidence', runId: '101',
  });
  assert.deepEqual(parseAuthorityArguments(['validate-event', '--event=event.json', '--policy=policy.json']), {
    command: 'validate-event', eventPath: 'event.json', policyPath: 'policy.json',
  });
  assert.throws(() => parseAuthorityArguments(['issue-github', '--input=x', '--policy=y']), /option --input is invalid/u);
  assert.throws(() => parseAuthorityArguments(['issue-github', '--event=x']), /policy path/u);
  assert.throws(() => parseAuthorityArguments(['issue-github', '--event=x', '--policy=y',
    '--repository=github.com/example/evidence']), /run id/u);
});

test('Actions validation is read-only while the exact authority run is in progress', async (t) => {
  const api = fixture(t, { runStatus: 'in_progress', runConclusion: null });
  delete api.env.GITHUB_TOKEN;
  const result = await api.validate();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  assert.deepEqual(result.stdout.values, []);
  assert.deepEqual(api.calls, []);
});

test('Actions validation requires identical checked-out and workflow ref plus revision', async (t) => {
  const root = sandbox(t);
  for (const [name, value] of [
    ['GITHUB_WORKFLOW_SHA', hash('b', 40)],
    ['GITHUB_WORKFLOW_REF', 'example/evidence/.github/workflows/authority.yml@refs/heads/other'],
  ]) {
    const api = fixture(t, {}, root); api.env[name] = value;
    const result = await api.validate();
    assert.equal(result.code, 1, name);
    assert.match(result.stderr.values.join(''), /workflow ref and revision/u);
    assert.deepEqual(api.calls, []);
  }
});

test('owner-local issuance requires exact terminal success and bearer identity before writes', async (t) => {
  const root = sandbox(t);
  for (const options of [
    { runStatus: 'in_progress', runConclusion: null },
    { runStatus: 'completed', runConclusion: 'failure' },
    { completedAt: '2026-09-02T00:09:59.000Z' },
    { authenticatedActor: { id: 43, login: 'other' } },
  ]) {
    const api = fixture(t, options, root), result = await api.run();
    assert.equal(result.code, 1, JSON.stringify(options));
    assert.match(result.stderr.values.join(''), /authority issuance failed/u);
    assert.equal(api.calls.some((call) => call.init.method !== 'GET'), false);
  }
});

test('owner-local issuance projects realistic ambient bearer metadata before validation', async (t) => {
  const api = fixture(t), result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  assert.equal(api.calls.some((call) => call.route === 'GET /user'), true);
  assert.equal(api.calls.some((call) => call.init.method !== 'GET'), true);
});

test('issue-github refuses the GitHub Actions execution boundary without provider I/O', async (t) => {
  const api = fixture(t); api.env.GITHUB_ACTIONS = 'true';
  const result = await api.run(); assert.equal(result.code, 1);
  assert.match(result.stderr.values.join(''), /owner-local.*GitHub Actions/u);
  assert.deepEqual(api.calls, []);
});

test('publication reauthenticates the exact run, workflow, and bearer immediately before POST', async (t) => {
  const root = sandbox(t); for (const options of [{ lateRunStatus: 'in_progress' },
    { lateDisplayTitle: 'ADLC authority stale' }, { lateWorkflowState: 'disabled_manually' },
    { lateAuthenticatedActor: { id: 43, login: 'other' } }]) {
    const api = fixture(t, options, root), result = await api.run();
    assert.equal(result.code, 1, JSON.stringify(options)); assert.match(result.stderr.values.join(''), /authority issuance failed/u);
    assert.equal(api.calls.some((call) => call.init.method !== 'GET'), false);
  }
});

test('authority dispatch bounds the envelope independently from exact semantic inputs', (t) => {
  const root = sandbox(t), eventPath = join(root, 'large-event.json');
  const source = dispatch({ scope: Array.from({ length: 200 }, (_, index) => (
    `path:bounded-${String(index).padStart(3, '0')}-${'x'.repeat(80)}`
  )) });
  const payload = canonicalJson(source), authorityInputDigest = hash('a');
  const inputs = { authority_payload: payload, authority_input_digest: authorityInputDigest };
  const event = {
    ambient: 'x'.repeat(70_000),
    deepAmbient: Array.from({ length: 32 }).reduce((value) => ({ next: value }), 'leaf'),
    inputs,
    repository: Object.fromEntries(Array.from({ length: 95 }, (_, index) => [`field${index}`, index])),
  };
  const bytes = Buffer.from(JSON.stringify(event));
  assert.ok(Buffer.byteLength(payload) > MAX_STRING_BYTES);
  assert.ok(bytes.length > MAX_AUTHORITY_INPUT_BYTES && bytes.length < MAX_AUTHORITY_EVENT_BYTES);
  writeFileSync(eventPath, bytes);
  assert.deepEqual(loadAuthorityDispatch(eventPath, eventPath), {
    dispatch: source,
    authorityInputDigest,
  });
  writeFileSync(eventPath, JSON.stringify({ ...event, inputs: {
    ...inputs, authority_payload: JSON.stringify(source),
  } }));
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath), /exact canonical JSON bytes/u);
  writeFileSync(eventPath, bytes);
  assert.throws(() => loadAuthorityDispatch(eventPath, `${eventPath}.other`),
    /--event must equal GITHUB_EVENT_PATH/u);
  writeFileSync(eventPath, JSON.stringify({ ...event, inputs: { authority_payload: payload } }));
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath), /inputs fields are invalid/u);
  writeFileSync(eventPath, JSON.stringify({ ...event, inputs: { ...inputs, unexpected: 'rejected' } }));
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath), /inputs fields are invalid/u);
  const structurallyOversized = { ...source, request: {
    ...source.request, scope: ['x'.repeat(MAX_STRING_BYTES + 1)],
  } };
  writeFileSync(eventPath, JSON.stringify({ ...event, inputs: {
    ...inputs, authority_payload: JSON.stringify(structurallyOversized),
  } }));
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath),
    /authority_payload exceeds structural bounds/u);
  writeFileSync(eventPath, JSON.stringify({ ...event, inputs: {
    ...inputs, authority_payload: 'x'.repeat(MAX_AUTHORITY_INPUT_BYTES + 1),
  } }));
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath),
    /authority_payload must be a bounded non-empty string/u);
  writeFileSync(eventPath, JSON.stringify({ ...event, ambient: 'x'.repeat(MAX_AUTHORITY_EVENT_BYTES) }));
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath), /GitHub event byte budget exceeded/u);
  writeFileSync(eventPath, '[]');
  assert.throws(() => loadAuthorityDispatch(eventPath, eventPath), /GitHub event must be an object/u);
});

test('authority rejects noncanonical local or committed policy bytes before publication', async (t) => {
  const root = sandbox(t), local = fixture(t, {}, root);
  writeFileSync(local.policyPath, `${JSON.stringify(policy(), null, 2)}\n`);
  const localResult = await local.run();
  assert.equal(localResult.code, 1);
  assert.match(localResult.stderr.values.join(''), /exact canonical JSON bytes/u);
  assert.deepEqual(local.calls, []);
  const remote = fixture(t, { noncanonicalRemotePolicy: true }, root), remoteResult = await remote.run();
  assert.equal(remoteResult.code, 1);
  assert.match(remoteResult.stderr.values.join(''), /exact canonical bytes/u);
  assert.equal(remote.calls.some((call) => call.init.method !== 'GET'), false);
});

test('issues, replays, and live-verifies one GitHub-fenced authority issuance', async (t) => {
  const api = fixture(t), first = await api.run();
  assert.equal(first.code, 0, first.stderr.values.join('')); assert.deepEqual(first.stderr.values, []);
  const issuance = JSON.parse(first.stdout.values.join(''));
  assert.deepEqual(validateGitHubAuthorityIssuance(issuance), issuance);
  assert.equal(issuance.publicationReceipt.parentRevision, HEAD);
  assert.equal(issuance.publicationReceipt.targetRepository.review.headRevision, TARGET_HEAD);
  assert.ok(api.calls.filter((call) => call.route === 'GET /repos/example/evidence/actions/runs/101').length >= 3);
  const firstPost = api.calls.findIndex((call) => call.init.method !== 'GET');
  assert.deepEqual(api.calls.slice(firstPost - 3, firstPost).map((call) => call.route), [
    'GET /repos/example/evidence/actions/runs/101',
    'GET /repos/example/evidence/actions/workflows/501',
    'GET /user',
  ]);
  assert.equal(api.calls.filter((call) => call.route === 'POST /repos/example/evidence/git/refs').length, 1);
  assert.equal(api.calls.some((call) => call.init.method === 'PATCH'), false);
  assert.equal(api.calls.every((call) => call.parsed.origin === 'https://api.github.com' && call.init.redirect === 'error'), true);
  assert.equal(api.calls.every((call) => call.init.headers.authorization === 'Bearer environment-secret'), true);
  assert.equal(first.stdout.values.join('').includes('environment-secret'), false);
  const second = await api.run();
  assert.equal(second.code, 0); assert.deepEqual(JSON.parse(second.stdout.values.join('')), issuance);
  assert.equal(api.calls.filter((call) => call.route === 'POST /repos/example/evidence/git/refs').length, 1);
});

test('explicit retrospective issuance binds an exact historical squash and current ancestry',
  async (t) => {
    const { source: prospective, planBytes } = laterVerificationInput();
    const source = { ...prospective, issuanceMode: GITHUB_RETROSPECTIVE_RECOVERY_MODE };
    const api = fixture(t, { source, retrospective: true, liveTargetBase: LIVE_TARGET });
    const result = await api.run();
    assert.equal(result.code, 0, result.stderr.values.join(''));
    const issuance = validateGitHubAuthorityIssuance(JSON.parse(result.stdout.values.join('')));
    assert.equal(issuance.storedBundle.authorityBundle.challenge.issuanceMode,
      GITHUB_RETROSPECTIVE_RECOVERY_MODE);
    assert.deepEqual(issuance.storedBundle.targetRepository.retrospectiveProof, {
      schema: 'agentic-os/github-retrospective-target-proof/v1', mergeRevision: MERGE,
      mergeEventId: '901', mergedAt: '2026-09-02T00:08:00.000Z',
      historicalBaseRevision: TARGET_BASE, liveCanonicalRevision: LIVE_TARGET,
      candidateTreeRevision: TARGET_TREE, mergeTreeRevision: TARGET_TREE,
    });
    assert.ok(api.calls.some((call) => call.route
      === `GET /repos/example/target/compare/${MERGE}...${LIVE_TARGET}`));
    assert.ok(api.calls.every((call) => call.init.headers['x-github-api-version']
      === '2026-03-10'));
    const reader = createGitHubAuthorityReadProvider({ issuance,
      token: 'environment-secret', fetchImpl: api.fetchImpl });
    assert.deepEqual(await verifyGitHubAuthorityIssuanceLive(issuance, reader,
      { now: () => NOW }), issuance);
    const reads = api.calls.length;
    await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({ issuance, planBytes },
      reader, { now: () => NOW }), /record-only/u);
    assert.equal(api.calls.length, reads, 'record-only refusal performs no provider I/O');
  });

test('retrospective issuance fails closed on mode, review, event, squash, tree, time, or ancestry drift',
  async (t) => {
    const root = sandbox(t);
    const modeSource = () => ({ ...dispatch(),
      issuanceMode: GITHUB_RETROSPECTIVE_RECOVERY_MODE });
    for (const options of [
      { source: modeSource(), liveTargetBase: LIVE_TARGET },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        mergedAt: STARTED },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        pullBase: hash('0', 40) },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        duplicateMergeEvent: true },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        eventNext: true },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        mergeParent: hash('0', 40) },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        candidateTree: hash('0', 40) },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        compareStatus: 'diverged' },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        compareStatus: 'identical' },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        compareTip: hash('0', 40) },
      { source: modeSource(), retrospective: true, liveTargetBase: LIVE_TARGET,
        emptyCompareCommits: true },
    ]) {
      const api = fixture(t, options, root), result = await api.run();
      assert.equal(result.code, 1, JSON.stringify(options));
      assert.match(result.stderr.values.join(''), /retrospective/u);
      assert.equal(api.calls.some((call) => call.init.method !== 'GET'), false);
    }
  });

test('owner-local issuance accepts the exact ref-qualified workflow API path', async (t) => {
  const api = fixture(t, { workflowPath: '.github/workflows/authority.yml@refs/heads/release/2026' });
  const result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
});

test('projects bounded target repository metadata before authority catalog inspection', async (t) => {
  assert.equal(Object.keys({ ...ambientMetadata(93), id: 77, full_name: 'example/target',
    owner: {} }).length, 97);
  const api = fixture(t, { ambientTargetRepositoryMetadata: true }), result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  const issuance = validateGitHubAuthorityIssuance(JSON.parse(result.stdout.values.join('')));
  assert.equal(issuance.schema, 'agentic-os/github-authority-issuance/v1');
  assert.doesNotMatch(JSON.stringify(issuance), /ambient_|deepAmbient/u);
});

test('projects bounded target review metadata before authority catalog inspection', async (t) => {
  assert.equal(Object.keys({ ...ambientMetadata(79), full_name: 'example/target' }).length, 81);
  const api = fixture(t, { ambientTargetReviewMetadata: true }), result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  const issuance = validateGitHubAuthorityIssuance(JSON.parse(result.stdout.values.join('')));
  assert.equal(issuance.schema, 'agentic-os/github-authority-issuance/v1');
  assert.doesNotMatch(JSON.stringify(issuance), /ambient_|deepAmbient/u);
});

test('retains the whole-body byte ceiling before target projection', async (t) => {
  const api = fixture(t, { oversizedTargetMetadata: true }), result = await api.run();
  assert.equal(result.code, 1);
  assert.match(result.stderr.values.join(''), /GitHub API response exceeds byte bound/u);
});

test('REST create race accepts only the exact stored bundle as an idempotent replay', async (t) => {
  const api = fixture(t, { refCreateRace: true }), result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  assert.equal(validateGitHubAuthorityIssuance(
    JSON.parse(result.stdout.values.join(''))).schema, 'agentic-os/github-authority-issuance/v1');
  assert.equal(api.calls.filter((call) => call.route === 'POST /repos/example/evidence/git/refs').length, 1);
  assert.equal(api.calls.some((call) => ['PATCH', 'DELETE'].includes(call.init.method)), false);
});

test('REST create race rejects a conflicting bundle at the same absent-ref coordinate', async (t) => {
  const root = sandbox(t);
  const competingSource = dispatch({
    observedAt: '2026-09-02T00:01:00.000Z',
    expiresAt: '2026-09-02T00:59:00.000Z',
  });
  const competingApi = fixture(t, { source: competingSource }, root);
  const competingResult = await competingApi.run();
  assert.equal(competingResult.code, 0, competingResult.stderr.values.join(''));
  const competing = JSON.parse(competingResult.stdout.values.join('')).storedBundle;
  const api = fixture(t, { refCreateRaceStored: competing }, root), result = await api.run();
  assert.equal(result.code, 1);
  assert.match(result.stderr.values.join(''), /authority issuance failed:/u);
  const blobCall = api.calls.find((call) => call.route === 'POST /repos/example/evidence/git/blobs');
  const body = JSON.parse(blobCall.init.body);
  const attempted = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  assert.equal(competing.authorityBundle.evidenceRef, attempted.authorityBundle.evidenceRef);
  assert.equal(competing.authorityBundle.claimCoordinate,
    attempted.authorityBundle.claimCoordinate);
  assert.notEqual(competing.storedDigest, attempted.storedDigest);
  assert.equal(api.calls.filter((call) => call.route === 'POST /repos/example/evidence/git/refs').length, 1);
  assert.equal(api.calls.some((call) => ['PATCH', 'DELETE'].includes(call.init.method)), false);
});

test('fails closed for forged input, weak or inexact rules, target drift, and inexact trees', async (t) => {
  const root = sandbox(t);
  for (const options of [
    { digest: hash('f') },
    { rulesObject: true }, { emptyChecks: true }, { updateAllows: true }, { updateExtraParameter: true },
    { extraDetailRule: true },
    { evidenceBypass: true }, { evidenceCreation: true }, { extraEvidenceRuleset: true },
    { evidenceDeletionParameters: true },
    { targetHead: hash('9', 40) }, { ownerId: 43, ambientTargetRepositoryMetadata: true },
    { deepOwnerLogin: true, ambientTargetRepositoryMetadata: true },
    { extraTree: true }, { wrongTreeSha: true }, { truncatedTree: true },
  ]) {
    const api = fixture(t, options, root), result = await api.run();
    assert.equal(result.code, 1, JSON.stringify(options));
    assert.match(result.stderr.values.join(''), /authority issuance failed:/u);
    assert.doesNotMatch(result.stderr.values.join(''), /environment-secret/u);
  }
});

function laterVerificationInput() {
  const draft = dispatch(), requestValue = draft.request, bound = draft.candidate;
  const plan = createEffectPlan({
    target: { repository: bound.targetRepository, resource: bound.branch,
      immutableRevision: requestValue.immutableRevision },
    authority: { requestedTransition: requestValue.requestedTransition,
      authoritySubject: requestValue.authoritySubject, ownerSubject: requestValue.ownerSubject,
      claimId: requestValue.claimId, leaseEpoch: requestValue.leaseEpoch,
      fenceRevision: requestValue.fenceRevision, writeSetDigest: requestValue.writeSetDigest,
      reviewLocator: requestValue.reviewLocator,
      predecessorDigest: bound.predecessorEvidenceDigest },
    candidateDigest: bound.candidateDigest, snapshotDigest: bound.workingStateDigest,
    effectClass: 'publish-for-review-only',
    allowedEffects: ['descendant-commit', 'exact-revalidation', 'new-review', 'nonforce-push'],
    forbiddenEffects: ['auto-merge', 'cleanup', 'deletion', 'deploy', 'force-push',
      'merge', 'release', 'reset', 'retire', 'stash'], parametersDigest: hash('a'),
  });
  const planBytes = encodeEffectPlan(plan);
  const source = dispatch({ dependentWork: [
    `effect-plan:sha256:${effectPlanByteDigest(planBytes)}`,
  ] });
  return { source, planBytes };
}

test('ambient-independent REST provider authenticates the API-visible authority run name', async (t) => {
  const { source, planBytes } = laterVerificationInput();
  const options = { source, ambientTargetRepositoryMetadata: true,
    ambientTargetReviewMetadata: true };
  const api = fixture(t, options);
  const result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  const issuance = JSON.parse(result.stdout.values.join(''));
  const writes = api.calls.filter((call) => call.init.method !== 'GET').length;
  const provider = createGitHubAuthorityReadProvider({
    issuance, token: 'environment-secret', fetchImpl: api.fetchImpl,
  });
  const receipt = await createGitHubAuthorityLiveVerificationReceipt({
    issuance, planBytes,
  }, provider, { now: () => NOW });
  assert.deepEqual(validateGitHubAuthorityLiveVerificationReceipt(receipt), receipt);
  assert.match(receipt.providerObservationDigest, /^[0-9a-f]{64}$/u);
  assert.match(receipt.spendKey, /^[0-9a-f]{64}$/u);
  assert.ok(api.calls.some((call) => call.route
    === 'GET /repos/example/evidence/actions/workflows/501'));
  assert.equal(api.calls.filter((call) => call.init.method !== 'GET').length, writes);
  options.oversizedTargetMetadata = true;
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({ issuance, planBytes },
    provider, { now: () => NOW }), /GitHub response exceeds bounds/u);
});

test('later REST verification rejects a static or forged workflow display title', async (t) => {
  const { source } = laterVerificationInput();
  const api = fixture(t, { source, displayTitle: 'ADLC authority static' });
  const result = await api.run();
  assert.equal(result.code, 1);
  assert.match(result.stderr.values.join(''), /exact successful active-workflow dispatch/u);
  assert.equal(api.calls.some((call) => call.init.method !== 'GET'), false);
});

test('later REST verification accepts only the bare or exactly ref-qualified workflow path', async (t) => {
  const { source, planBytes } = laterVerificationInput(), options = { source };
  const api = fixture(t, options), result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  const issuance = JSON.parse(result.stdout.values.join(''));
  const provider = createGitHubAuthorityReadProvider({
    issuance, token: 'environment-secret', fetchImpl: api.fetchImpl,
  });
  options.workflowPath = '.github/workflows/authority.yml@refs/heads/release/2026';
  await createGitHubAuthorityLiveVerificationReceipt({ issuance, planBytes },
    provider, { now: () => NOW });
  options.workflowPath = '.github/workflows/authority.yml@refs/heads/other';
  await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({ issuance, planBytes },
    provider, { now: () => NOW }), /retained dispatch/u);
});

test('later REST verification requires successful completion and the exact active workflow resource', async (t) => {
  const { source, planBytes } = laterVerificationInput(), options = { source };
  const api = fixture(t, options), result = await api.run();
  assert.equal(result.code, 0, result.stderr.values.join(''));
  const issuance = JSON.parse(result.stdout.values.join(''));
  const provider = createGitHubAuthorityReadProvider({
    issuance, token: 'environment-secret', fetchImpl: api.fetchImpl,
  });
  for (const [key, value] of [
    ['runStatus', 'in_progress'], ['runConclusion', 'failure'],
    ['completedAt', '2026-09-02T00:10:31.000Z'],
    ['workflowResourceId', 502], ['workflowState', 'disabled_manually'],
    ['workflowResourcePath', '.github/workflows/other.yml'],
  ]) {
    options[key] = value;
    await assert.rejects(createGitHubAuthorityLiveVerificationReceipt({ issuance, planBytes },
      provider, { now: () => NOW }), /retained dispatch|provider workflow run/u, key);
    delete options[key];
  }
});
