/** Provider-observed integration proof joined to one live predecessor issuance. */
import { canonicalJson, governanceDigest } from './governance.mjs';
import { GITHUB_ACTIONS_INTEGRATION_ID } from './github-authority.mjs';
import { createGitHubProtectionProjection } from './github-authority-issuer.mjs';
import { GITHUB_RETROSPECTIVE_INTEGRATION_MODE } from './github-transition-client.mjs';

const ID = /^[1-9][0-9]{0,18}$/u;
const REDACTED_BYPASS = 'unobserved:provider-redacted:read-only';
const PROVIDER_EVENT_SKEW_MS = 5_000;
function fail(message) { throw new TypeError(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text`);
  return value;
}
function id(value, label) {
  const result = String(value); if (!ID.test(result)) fail(`${label} must be an identifier`);
  return result;
}
function instant(value, label) {
  const parsed = Date.parse(text(value, label));
  if (!Number.isFinite(parsed)) fail(`${label} must be a UTC instant`);
  return new Date(parsed).toISOString();
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze); return Object.freeze(value);
}
function targetRepositoryIdentity(value, target, expected) {
  const source = object(value, 'target repository identity');
  const sourceOwner = object(source.owner, 'target repository owner');
  const live = { repository: `github.com/${text(source.full_name,
    'target repository full name')}`, repositoryId: id(source.id, 'target repository id'),
  owner: { id: id(sourceOwner.id, 'target repository owner id'),
    login: text(sourceOwner.login, 'target repository owner login').toLowerCase() } };
  const bound = { repository: expected.repository, repositoryId: expected.repositoryId,
    owner: expected.owner };
  if (live.repository !== target.repository || !same(live, bound))
    fail('target repository numeric identity or owner changed');
  return live;
}
async function initialAuthorityProof(provider, input) {
  const issuance = input.predecessorIssuance, stored = issuance.storedBundle;
  const bundle = stored.authorityBundle, publication = issuance.publicationReceipt;
  const query = { repository: bundle.policy.evidenceRepository, ref: bundle.evidenceRef,
    path: bundle.evidencePath };
  const [run, actorValue, foundPublication, foundBundle, evidenceRules,
    canonicalRules] = await Promise.all([
    provider.readRun({ repository: bundle.policy.evidenceRepository,
      locator: bundle.workflowRun.locator }),
    provider.readActor({ repository: bundle.policy.evidenceRepository,
      workflowRun: bundle.workflowRun }),
    provider.readPublication(query), provider.readBundle(query),
    provider.readRules({ repository: bundle.policy.evidenceRepository, ref: bundle.evidenceRef }),
    provider.readRules({ repository: bundle.policy.evidenceRepository,
      ref: bundle.policy.canonicalRef }),
  ]);
  const rules = createGitHubProtectionProjection(evidenceRules);
  const canonical = createGitHubProtectionProjection(canonicalRules);
  const expectedPublication = {
    repository: publication.evidenceRepository, ref: publication.evidenceRef,
    path: publication.evidencePath, revision: publication.publicationRevision,
    parentRevision: publication.parentRevision, committedAt: publication.committedAt,
    storedDigest: publication.storedDigest,
  };
  if (!same(run, bundle.workflowRun) || actorValue.subject !== input.request.authoritySubject
    || !same(foundBundle, stored) || foundPublication === null
    || !same(foundPublication, expectedPublication)
    || !same(rules, stored.preProtection.evidence)
    || !same(canonical, stored.preProtection.canonical))
    fail('initial GitHub authority issuance is no longer live and exact');
  return { predecessorIssuanceDigest: issuance.issuanceDigest,
    predecessorTransitionReceiptDigest: issuance.transitionReceipt.receiptDigest,
    predecessorStoredDigest: stored.storedDigest,
    predecessorPublicationReceiptDigest: publication.receiptDigest,
    predecessorPublicationRevision: publication.publicationRevision,
    predecessorEvidenceRef: bundle.evidenceRef,
    predecessorEvidencePath: bundle.evidencePath,
    predecessorEvidenceProtectionDigest: rules.projectionDigest,
    predecessorCanonicalProtectionDigest: canonical.projectionDigest };
}
function checkRecord(entry, context, revision, mergedAt) {
  const completedAt = instant(entry?.completed_at, 'check completion time');
  if (entry?.name !== context || String(entry?.app?.id) !== String(GITHUB_ACTIONS_INTEGRATION_ID)
    || entry.status !== 'completed' || entry.conclusion !== 'success'
    || entry.head_sha !== revision || Date.parse(completedAt) > Date.parse(mergedAt))
    fail('GitHub integration required checks are not exactly successful');
  return { context, checkRunId: id(entry.id, 'check run id'),
    appId: String(GITHUB_ACTIONS_INTEGRATION_ID), status: 'completed',
    conclusion: 'success', completedAt, revision };
}
async function checks(api, target, revision, contexts, mergedAt, expected = null) {
  if (expected !== null) {
    if (!Array.isArray(expected) || expected.length !== contexts.length)
      fail('stored required check identities are invalid');
    const required = [];
    for (const stored of expected) {
      const response = await api.call('GET', `${target.path}/check-runs/${
        id(stored.checkRunId, 'stored check run id')}`);
      const record = checkRecord(object(api.exact(response, [200], 'GitHub stored check run'),
        'GitHub stored check run'), stored.context, revision, mergedAt);
      if (!same(record, stored)) fail('stored required check run changed');
      required.push(record);
    }
    return { required, checksDigest: governanceDigest({
      schema: 'agentic-os/github-required-checks/v1', targetRepository: target.repository,
      revision, required }) };
  }
  const response = await api.call('GET',
    `${target.path}/commits/${revision}/check-runs?per_page=100&filter=latest`);
  const value = object(api.exact(response, [200], 'GitHub integration checks'),
    'GitHub integration checks');
  if (response.headers?.get?.('link')?.includes('rel="next"')
    || !Number.isSafeInteger(value.total_count) || value.total_count !== value.check_runs?.length)
    fail('GitHub integration checks are incomplete');
  const required = contexts.map((context) => {
    const matches = value.check_runs.filter((entry) => entry?.name === context
      && String(entry?.app?.id) === String(GITHUB_ACTIONS_INTEGRATION_ID));
    if (matches.length !== 1)
      fail('GitHub integration required checks are not exactly successful');
    return checkRecord(matches[0], context, revision, mergedAt);
  });
  return { required, checksDigest: governanceDigest({
    schema: 'agentic-os/github-required-checks/v1', targetRepository: target.repository,
    revision, required }) };
}
async function ruleSuite(api, target, canonicalRef, mergedCommit, input, mergedAt,
  activeRuleTypes, rulesetVersions, retrospective, expected = null) {
  let suiteId;
  if (expected === null) {
    const response = await api.call('GET', `${target.path}/rulesets/rule-suites?ref=${
      encodeURIComponent(canonicalRef)}&time_period=day&rule_suite_result=pass&per_page=100`);
    const suites = api.exact(response, [200], 'GitHub integration rule suites');
    if (!Array.isArray(suites) || response.headers?.get?.('link')?.includes('rel="next"'))
      fail('GitHub integration rule suites are incomplete');
    const matches = suites.filter((entry) => entry?.after_sha === input.plan.target.immutableRevision
      && entry?.ref === canonicalRef && entry?.result === 'pass');
    if (matches.length !== 1) fail('GitHub integration lacks one exact passing rule suite');
    suiteId = id(matches[0].id, 'rule suite id');
  } else suiteId = id(expected.ruleSuiteId, 'stored rule suite id');
  const detail = object(api.exact(await api.call('GET',
    `${target.path}/rulesets/rule-suites/${suiteId}`), [200], 'GitHub integration rule suite'),
  'GitHub integration rule suite');
  const actorId = id(detail.actor_id, 'rule suite actor id');
  const actorName = text(detail.actor_name, 'rule suite actor name');
  const pushedAt = instant(detail.pushed_at, 'rule suite pushed time');
  if (id(detail.id, 'rule suite detail id') !== suiteId
    || detail.before_sha !== mergedCommit.parents[0]
    || detail.after_sha !== input.plan.target.immutableRevision || detail.ref !== canonicalRef
    || detail.result !== 'pass'
    || Date.parse(pushedAt) + PROVIDER_EVENT_SKEW_MS < Date.parse(mergedAt)
    || !Array.isArray(detail.rule_evaluations))
    fail('GitHub integration rule suite identity or result is invalid');
  if (!retrospective
    && rulesetVersions.some((entry) => Date.parse(entry.updatedAt) > Date.parse(pushedAt)))
    fail('target ruleset was updated after the observed passing rule suite');
  const versionIds = new Set(rulesetVersions.map((entry) => entry.id));
  for (const evaluation of detail.rule_evaluations) {
    if (evaluation?.rule_source?.type === 'ruleset'
      && !versionIds.has(String(evaluation.rule_source.id)))
      fail('rule suite evaluation does not source the observed target rulesets');
  }
  for (const type of activeRuleTypes) {
    const evaluations = detail.rule_evaluations.filter((entry) => entry?.rule_type === type
      && entry?.enforcement === 'active');
    if (evaluations.length === 0 || evaluations.some((entry) => entry.result !== 'pass'))
      fail('GitHub integration rule suite did not pass every required active rule');
  }
  const payload = { schema: 'agentic-os/github-rule-suite-proof/v1', suiteId, actorId,
    actorName, beforeRevision: detail.before_sha, afterRevision: detail.after_sha,
    canonicalRef, pushedAt, result: 'pass', activePassedRules: activeRuleTypes,
    rulesetVersions };
  return { ...payload, ruleSuiteDigest: governanceDigest(payload) };
}
function targetProtection(observation, target, ref) {
  const projection = object(observation, 'target protection observation').projection;
  const versions = observation.versions;
  if (projection.repository !== target.repository || projection.ref !== ref
    || projection.rulesets.some((entry) => entry.bypassActors.length !== 0
      && !same(entry.bypassActors, [REDACTED_BYPASS])))
    fail('target canonical protection identity or bypass policy changed');
  if (!Array.isArray(versions) || versions.length !== projection.rulesets.length
    || versions.some((entry) => !projection.rulesets.some((ruleset) => ruleset.id === entry.id)))
    fail('target canonical protection versions are incomplete');
  const descriptors = (type) => projection.rulesets.flatMap((entry) => entry.rules)
    .filter((entry) => entry.type === type);
  for (const type of ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'])
    if (descriptors(type).length !== 1) fail('target canonical protection lacks one exact required rule');
  if (['deletion', 'non_fast_forward'].some((type) => descriptors(type)[0].parameters !== null))
    fail('target canonical destructive protection parameters are invalid');
  const required = descriptors('required_status_checks')[0].parameters;
  const contexts = required?.required_status_checks;
  const methods = descriptors('pull_request')[0].parameters?.allowed_merge_methods;
  if (!Array.isArray(contexts) || contexts.length === 0
    || required.strict_required_status_checks_policy !== false
    || contexts.some((entry) => entry?.integration_id !== GITHUB_ACTIONS_INTEGRATION_ID)
    || contexts.some((entry) => typeof entry.context !== 'string' || !entry.context)
    || !Array.isArray(methods) || methods.length === 0
    || methods.some((entry) => !['merge', 'squash'].includes(entry)))
    fail('target canonical protection does not expose exact checks and merge methods');
  const requiredContexts = contexts.map((entry) => entry.context).sort();
  const allowedMethods = [...methods].sort();
  if (new Set(requiredContexts).size !== requiredContexts.length
    || new Set(allowedMethods).size !== allowedMethods.length)
    fail('target canonical protection checks and merge methods are not unique');
  const activeRuleTypes = [...new Set(projection.rulesets.flatMap((entry) =>
    entry.rules.map((descriptor) => descriptor.type)))].sort();
  return { projection, versions, requiredContexts, allowedMethods, activeRuleTypes,
    bypassActorsObserved: projection.rulesets.every((entry) =>
      !entry.bypassActors.includes(REDACTED_BYPASS)) };
}
function mergeMethod(commitValue, candidateRevision, allowed) {
  if (commitValue.parents.length === 2 && commitValue.parents[1] === candidateRevision) {
    if (!allowed.includes('merge')) fail('observed merge commit method is forbidden');
    return 'merge';
  }
  const oneParent = allowed.filter((entry) => entry === 'squash');
  if (commitValue.parents.length !== 1 || oneParent.length !== 1)
    fail('GitHub integration merge method is not unambiguous');
  return oneParent[0];
}
async function descendant(api, target, base, head) {
  if (base === head) return 'equal';
  const response = await api.call('GET', `${target.path}/compare/${base}...${head}`);
  const value = object(api.exact(response, [200], 'GitHub canonical inclusion'),
    'GitHub canonical inclusion');
  if (value.status !== 'ahead' || value.base_commit?.sha !== base
    || value.merge_base_commit?.sha !== base || value.head_commit?.sha !== head)
    fail('integrated revision is not contained by the protected canonical ref');
  return 'ancestor';
}

export async function observeGitHubIntegrationProof({ api, target, input, initialProvider,
  expectedProof = null, requirePlanBinding = true }) {
  const locator = input.request.reviewLocator;
  let parsed; try { parsed = new URL(locator); } catch { fail('integrate requires an exact review URL'); }
  const prefix = `/${target.owner}/${target.name}/pull/`, number = parsed.pathname.slice(prefix.length);
  if (parsed.origin !== 'https://github.com' || !parsed.pathname.startsWith(prefix)
    || parsed.search || parsed.hash || !ID.test(number) || input.plan.target.resource !== locator)
    fail('integrate requires the exact target pull request resource');
  const bundle = input.predecessorIssuance.storedBundle.authorityBundle;
  const candidate = bundle.candidate;
  const initialReview = input.predecessorIssuance.storedBundle.targetRepository.review;
  const initialRecovery = input.predecessorIssuance.storedBundle.targetRepository.retrospectiveProof;
  const retrospective = input.integrationMode === GITHUB_RETROSPECTIVE_INTEGRATION_MODE;
  const canonicalRef = `refs/heads/${candidate.canonicalBranch}`;
  const [predecessor, pullResponse, mergeEventsResponse, candidateHead, currentCanonicalHead,
    protectionObservation, mergedCommit, candidateCommit, targetResponse] = await Promise.all([
    initialAuthorityProof(initialProvider, input), api.call('GET', `${target.path}/pulls/${number}`),
    api.call('GET', `${target.path}/issues/${number}/events?per_page=100`),
    api.gitRef(target, `refs/heads/${candidate.branch}`), api.gitRef(target, canonicalRef),
    expectedProof === null ? api.rules(target, canonicalRef) : Promise.resolve(null),
    api.commit(target, input.plan.target.immutableRevision),
    retrospective ? api.commit(target, candidate.headRevision) : Promise.resolve(null),
    api.call('GET', target.path),
  ]);
  const targetIdentity = targetRepositoryIdentity(api.exact(targetResponse, [200],
    'GitHub target repository'), target, input.predecessorIssuance.storedBundle.targetRepository);
  const pull = object(api.exact(pullResponse, [200], 'GitHub integration review'),
    'GitHub integration review');
  const events = api.exact(mergeEventsResponse, [200], 'GitHub integration merge events');
  if (!Array.isArray(events) || mergeEventsResponse.headers?.get?.('link')?.includes('rel="next"'))
    fail('GitHub integration merge events are incomplete');
  const mergedEvents = events.filter((entry) => entry?.event === 'merged');
  if (mergedEvents.length !== 1) fail('GitHub integration lacks one exact merge event');
  const mergeEvent = object(mergedEvents[0], 'GitHub integration merge event');
  const mergeEventId = id(mergeEvent.id, 'merge event id');
  const mergedAt = instant(pull.merged_at, 'review merged time');
  const protectedTarget = expectedProof === null
    ? targetProtection(protectionObservation, target, canonicalRef)
    : { projection: { projectionDigest: expectedProof.targetProtectionDigest },
      versions: expectedProof.targetRulesetVersions,
      requiredContexts: expectedProof.targetRequiredContexts,
      allowedMethods: expectedProof.targetAllowedMergeMethods,
      activeRuleTypes: expectedProof.targetActiveRuleTypes,
      bypassActorsObserved: expectedProof.targetBypassActorsObserved };
  const requiredChecksDigest = await checks(api, target, candidate.headRevision,
    protectedTarget.requiredContexts, mergedAt, expectedProof?.requiredChecks ?? null);
  const method = mergeMethod(mergedCommit, candidate.headRevision,
    protectedTarget.allowedMethods);
  const suite = await ruleSuite(api, target, canonicalRef, mergedCommit, input, mergedAt,
    protectedTarget.activeRuleTypes, protectedTarget.versions, retrospective, expectedProof);
  const predecessorStartedAt = retrospective ? bundle.challenge.issuedAt
    : input.predecessorIssuance.publicationReceipt.committedAt;
  const predecessorExpiresAt = bundle.challenge.expiresAt;
  if (retrospective) {
    if (initialReview?.state !== 'merged'
      || initialRecovery?.mergeRevision !== input.plan.target.immutableRevision
      || initialRecovery.mergeEventId !== mergeEventId
      || initialRecovery.historicalBaseRevision !== candidate.canonicalRevision
      || initialRecovery.candidateTreeRevision !== candidateCommit?.tree
      || initialRecovery.mergeTreeRevision !== mergedCommit.tree
      || initialRecovery.mergedAt !== mergedAt
      || Date.parse(mergedAt) >= Date.parse(predecessorStartedAt)
      || Date.parse(suite.pushedAt) >= Date.parse(predecessorStartedAt)
      || method !== 'squash' || candidateCommit?.tree !== mergedCommit.tree) {
      fail('retrospective integration was not provider-observed before recovery authority');
    }
  } else if (Date.parse(mergedAt) < Date.parse(predecessorStartedAt)
    || Date.parse(mergedAt) >= Date.parse(predecessorExpiresAt)
    || Date.parse(suite.pushedAt) >= Date.parse(predecessorExpiresAt)) {
    fail('protected integration is outside the predecessor authority window');
  }
  const storedCanonicalHead = expectedProof?.observedCanonicalHead ?? currentCanonicalHead;
  await descendant(api, target, input.plan.target.immutableRevision, currentCanonicalHead);
  await descendant(api, target, storedCanonicalHead, currentCanonicalHead);
  if (retrospective) await descendant(api, target,
    initialRecovery.liveCanonicalRevision, currentCanonicalHead);
  const reviewBaseRevision = retrospective
    ? api.sha(pull.base?.sha, 'review base revision') : null;
  const projection = { ...predecessor, targetRepository: target.repository,
    targetRepositoryIdentity: targetIdentity,
    reviewLocator: locator, reviewNumber: number, state: 'merged',
    candidateBranch: candidate.branch, candidateHeadRevision: candidate.headRevision,
    canonicalBranch: candidate.canonicalBranch, canonicalRef,
    observedCanonicalHead: storedCanonicalHead,
    mergeRevision: input.plan.target.immutableRevision, mergeMethod: method,
    mergeEventId, mergedAt,
    targetProtectionDigest: protectedTarget.projection.projectionDigest,
    targetBypassActorsObserved: protectedTarget.bypassActorsObserved,
    targetRequiredContexts: protectedTarget.requiredContexts,
    targetAllowedMergeMethods: protectedTarget.allowedMethods,
    targetActiveRuleTypes: protectedTarget.activeRuleTypes,
    targetRulesetVersions: protectedTarget.versions,
    requiredChecks: requiredChecksDigest.required,
    requiredChecksDigest: requiredChecksDigest.checksDigest,
    ruleSuiteDigest: suite.ruleSuiteDigest,
    ruleSuiteId: suite.suiteId, ruleSuiteResult: suite.result,
    ruleSuitePushedAt: suite.pushedAt,
    ...(retrospective ? { integrationMode: GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
      candidateTreeRevision: candidateCommit.tree, mergeTreeRevision: mergedCommit.tree,
      baseRevision: reviewBaseRevision } : {}),
    headRepository: `github.com/${text(pull.head?.repo?.full_name, 'review head repository')}`,
    headBranch: text(pull.head?.ref, 'review head branch'),
    headRevision: api.sha(pull.head?.sha, 'review head revision') };
  if (String(pull.number) !== number || pull.html_url !== locator || pull.state !== 'closed'
    || pull.merged !== true || pull.draft !== false
    || pull.base?.repo?.full_name !== `${target.owner}/${target.name}`
    || pull.base?.ref !== candidate.canonicalBranch
    || retrospective && (reviewBaseRevision !== candidate.canonicalRevision
      || reviewBaseRevision !== mergedCommit.parents[0]
      || Math.abs(Date.parse(mergedCommit.committedAt) - Date.parse(mergedAt))
        > PROVIDER_EVENT_SKEW_MS)
    || projection.headRepository !== candidate.targetRepository
    || projection.headBranch !== candidate.branch || projection.headRevision !== candidate.headRevision
    || api.sha(mergeEvent.commit_id, 'merge event revision') !== projection.mergeRevision
    || mergeEvent.commit_url !== `https://api.github.com${target.path}/commits/${projection.mergeRevision}`
    || Math.abs(Date.parse(instant(mergeEvent.created_at, 'merge event time'))
      - Date.parse(mergedAt)) > PROVIDER_EVENT_SKEW_MS
    || candidateHead !== candidate.headRevision)
    fail('GitHub review does not prove exact protected integration');
  const payload = { schema: 'agentic-os/github-integrate-provider-proof/v1', ...projection };
  const proof = freeze({ ...payload, proofDigest: governanceDigest(payload) });
  if (requirePlanBinding && input.plan.parametersDigest !== proof.proofDigest
    || expectedProof && !same(proof, expectedProof))
    fail('integration effect plan or stored winner does not bind the live provider proof');
  return proof;
}
