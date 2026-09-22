/** Native exact-candidate publication; lazy-loaded by both CLI publication routes. */
import { basename } from 'node:path';
import { git, gitLines, repoRoot, currentBranch, remoteTransport, headSha, publishExactNewRef,
  bindPublishedUpstream, remoteRefSha, fetch as gitFetch, worktrees, isAncestor } from '../src/git.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { providerAdapterRequired, successorLineage, transition } from '../src/lane-state.mjs';
import * as store from '../src/lane-records.mjs';
import * as queue from '../src/queue.mjs';
import { assertDisjointReservation, commitReservedChanges, parseWritePaths } from '../src/worktree.mjs';
import { integrationProof } from '../src/patch-identity.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import * as report from './agentic-os-report.mjs';
import { assertPublicationPreflight, classifyPromotion, publicationByteRisks, assertFlightRequirements,
  pullRequestText, validateReviewBody, providerKind, assertProfileCurrent, assertProtectedRefCurrent } from './agentic-os-auxiliary.mjs';
import { option } from './agentic-os-argv.mjs';
import { createWorkflowEffectGuard, rebindWorkflowCandidate } from './agentic-os-workflow.mjs';

export function cmdLand(cwd, argv, profile, policy, { out, err, projectCache, effectReceipt, remoteName }) {
  const root = repoRoot(cwd);
  const ref = currentBranch(root);
  if (!ref || !isLaneRef(ref)) {
    err(`land runs inside a lane worktree. current branch: ${ref ?? 'detached'}`);
    err('open one with: npm run lane -- <scope>');
    return 1;
  }
  if (!isBoundLane(ref, root)) {
    err('blocked-unbound-lane: land requires the registered linked worktree for this lane');
    return 1;
  }
  const laneStore = store.load(root);
  const record = laneStore.lanes[ref];
  const lineage = successorLineage(record);
  if (lineage === false) { err('blocked-successor-cache-race: successor lineage payload is invalid'); return 1; }
  if (record?.state === 'planned' && lineage) {
    err(`blocked-successor-recovery-required: rerun npm run successor -- ${record.scope} --expected-head=${lineage.predecessorHead}`);
    return 1;
  }
  const workflowContext = () => {
    const registration = worktrees(root).find(row => row.path === root && row.branch === ref);
    if (!registration) throw new Error('blocked-publication-worktree-binding');
    return { root, repository: profile.repository, phase: 'ci', ref,
      worktreeId: basename(registration.path), revision: headSha('HEAD', root),
      dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'], { cwd: root })) };
  };
  const assertWorkflowCurrent = createWorkflowEffectGuard(workflowContext);
  assertWorkflowCurrent('dependencies');
  const configuredFlight = assertFlightRequirements(root, 'pre');
  const bodyFile = option(argv, 'body-file'), title = option(argv, 'title');
  validateReviewBody(root, ref, bodyFile, title);
  const writePaths = (record?.writePaths ?? []).flatMap((path) => parseWritePaths(path));
  const remote = remoteName(policy, root);
  const capturedRemote = remoteTransport(remote, root);
  const message = option(argv, 'message');
  if (message !== null) {
    if (writePaths.length === 0) {
      err('blocked-write-scope-missing: autonomous land requires an admitted --write reservation');
      return 1;
    }
    assertDisjointReservation({ cwd: root, ref, writePaths,
      protectedRef: policy.protectedRef, records: laneStore.lanes });
    const advertised = remoteRefSha(remote, ref, root, capturedRemote.fetchUrl);
    if (advertised && (advertised !== headSha('HEAD', root) || publicationByteRisks(root).blocked)) {
      err(`blocked-published-head-drift: preserve changes; commit locally, then run npm run successor -- <scope> --expected-head=${advertised}`);
      return 1;
    }
    const beforeCommit = workflowContext();
    const expectedDecision = assertWorkflowCurrent('dependencies');
    const committed = commitReservedChanges({ cwd: root, writePaths, message });
    if (committed) {
      out(`committed ${committed.head.slice(0, 9)} (${committed.paths.length} path(s))`);
      rebindWorkflowCandidate({ root, repository: profile.repository, ref, worktreeId: beforeCommit.worktreeId, expectedDecision,
        previousRevision: beforeCommit.revision, revision: committed.head });
    }
  }
  const kind = providerKind(profile);
  if (providerAdapterRequired(policy) && kind !== 'github') {
    err(`blocked-provider-adapter-${kind}: no landing adapter matches the selected profile policy`);
    return 1;
  }
  // A present invalid optional cache must fail before fetch mutates local provider evidence.
  store.load(root);
  assertWorkflowCurrent();
  const laneHeadSha = assertPublicationPreflight(root, null, configuredFlight);
  effectReceipt('fetch', gitFetch(remote, root, capturedRemote.fetchUrl));
  const baseSha = assertProfileCurrent(root, policy, profile);
  if (!baseSha) {
    err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
    return 1;
  }
  assertWorkflowCurrent();
  const publishedHead = remoteRefSha(remote, ref, root, capturedRemote.fetchUrl);
  // An existing published revision remains immutable and recoverable. Only a new
  // publication must include the protected base just fetched by its native owner.
  if (!publishedHead && !isAncestor(baseSha, laneHeadSha, root)) {
    err('blocked-publication-stale-base: protected base is not an ancestor of this unpublished candidate; preserve source and refresh through native admission');
    return 1;
  }
  const commits = gitLines(['rev-list', `${baseSha}..${laneHeadSha}`], { cwd: root }).length;
  const reviewText = bodyFile !== null || kind === 'github' && policy.pullRequestRequired
    ? pullRequestText(root, ref, laneHeadSha, baseSha, bodyFile, title) : null;
  assertPublicationPreflight(root, laneHeadSha, configuredFlight);
  if (integrationProof(baseSha, laneHeadSha, { cwd: root })) {
    err('blocked-already-integrated: do not republish; reap can classify for public governance');
    return 1;
  }
  const providerPreflight = kind === 'github' && providerAdapterRequired(policy)
    ? queue.observe({ cwd: root, profile }) : null;
  const providerBlockers = providerPreflight
    ? queue.providerBlockingReasons(providerPreflight, policy) : [];
  if (providerPreflight && (providerPreflight.available !== true
      || providerPreflight.repo === null
      || providerBlockers.length > 0)) {
    err(`blocked-provider-observation-incomplete: ${providerBlockers.join(', ')}`);
    return 1;
  }
  if (publishedHead && publishedHead !== laneHeadSha) {
    err('blocked-published-head-drift: the exact remote lane revision is immutable');
    return 1;
  }
  const state = publishedHead ? 'published' : 'active';
  const publishFacts = {
    onCanonicalBranch: false, dirtyTracked: false, laneCommits: commits, pushed: false,
  };
  const preflight = state === 'active' ? transition('active', 'publish', publishFacts) : null;
  if (preflight && preflight.reason !== 'blocked-not-pushed') {
    err(report.formatRefusal(preflight, 'commit your work, then run npm run land again'));
    return 1;
  }
  if (state === 'active') {
    assertFlightRequirements(root, 'in', configuredFlight);
    assertProtectedRefCurrent(root, policy.protectedRef, baseSha);
    assertWorkflowCurrent();
    effectReceipt('publish-exact-new-ref',
      publishExactNewRef(remote, ref, laneHeadSha, root, capturedRemote.fetchUrl));
    out(`pushed ${ref} @ ${laneHeadSha.slice(0, 9)}`);
  }
  const postPublishRisks = publicationByteRisks(root);
  if (headSha('HEAD', root) !== laneHeadSha || postPublishRisks.blocked) {
    err('blocked-lane-head-moved-after-publish: exact published revision retained; preserve this lane');
    return 1;
  }
  const observedRemoteHead = remoteRefSha(remote, ref, root, capturedRemote.fetchUrl);
  if (observedRemoteHead !== laneHeadSha) {
    err(`blocked-not-pushed: ${remote} advertises ${observedRemoteHead ?? 'no exact ref'}`);
    return 1;
  }
  if (state === 'active') {
    const publish = transition('active', 'publish', {
      ...publishFacts,
      pushed: true,
    });
    if (!publish.ok) {
      err(report.formatRefusal(publish, 'the pushed lane did not satisfy publication guards'));
      return 1;
    }
  }
  effectReceipt('publication-tracking', bindPublishedUpstream(remote, ref, laneHeadSha, root, capturedRemote.fetchUrl));
  projectCache({ ref, state: 'published', head: laneHeadSha }, root);
  if (kind !== 'github' || !policy.pullRequestRequired) {
    out('published exact lane ref; no pull-request integration capability selected');
    return 0;
  }
  const observed = queue.observe({ cwd: root, profile });
  const promotion = classifyPromotion(root, baseSha, laneHeadSha);
  const observedBlockers = queue.providerBlockingReasons(observed, policy);
  if (observed.available !== true || observed.repo === null || observedBlockers.length > 0) {
    projectCache({ ref, state: 'published', head: laneHeadSha }, root);
    err('blocked-provider-observation-incomplete: exact published lane retained; exact repository and policy facts are required');
    return 1;
  }
  if (observed.remoteUrlDigest !== providerPreflight.remoteUrlDigest) {
    err('blocked-provider-remote-race: exact published lane retained; provider handoff refused');
    return 1;
  }
  assertProtectedRefCurrent(root, policy.protectedRef, baseSha);
  assertWorkflowCurrent();
  const handed = queue.enqueue(ref, {
    cwd: root,
    expectedHead: laneHeadSha,
    expectedRepository: observed.repo,
    baseBranch: policy.protectedBranch, preserveExistingText: bodyFile === null,
    assertSourceHead: () => {
      assertWorkflowCurrent();
      assertFlightRequirements(root, 'in', configuredFlight);
      return remoteRefSha(remote, ref, root, capturedRemote.fetchUrl) === laneHeadSha;
    },
    ...reviewText,
  });
  let finalObserved;
  try {
    finalObserved = queue.observe({ cwd: root, profile });
  } catch {
    projectCache({ ref, state: 'published', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed }, root);
    err('blocked-provider-final-observation: provider effects retained; final observation failed');
    return 1;
  }
  const finalProviderBlockers = queue.providerBlockingReasons(finalObserved, policy);
  if (finalObserved.available !== true || finalObserved.repo === null
      || finalProviderBlockers.length > 0) {
    projectCache({ ref, state: 'published', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed }, root);
    err('blocked-provider-observation-incomplete: provider effects retained; selected policy facts changed after handoff');
    return 1;
  }
  if (finalObserved.remoteUrlDigest !== observed.remoteUrlDigest) {
    projectCache({ ref, state: 'published', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed }, root);
    err('blocked-provider-remote-race: provider effects retained; final remote identity changed');
    return 1;
  }
  const finalRemoteHead = remoteRefSha(remote, ref, root, capturedRemote.fetchUrl);
  if (finalRemoteHead !== laneHeadSha) {
    projectCache({ ref, state: 'published', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed }, root);
    err(`blocked-provider-source-ref-race: provider effects retained; ${remote} advertises ${finalRemoteHead ?? 'no exact ref'}`);
    return 1;
  }
  const orderingFacts = {
    providerObservationComplete: true,
    handoffPolicySatisfied: finalObserved.handoffPolicySatisfied,
    queueEnabled: policy.mergeQueueRequired && finalObserved.queueEnabled,
    queuePolicySatisfied: finalObserved.queuePolicySatisfied,
    requiredChecksSatisfied: policy.requiredChecks.every(
      (check) => finalObserved.requiredChecks?.includes(check),
    ),
    mergeGroupSupported: finalObserved.mergeGroupSupported,
  };
  const toleratedReviewProjection = handed.ok === false
    && handed.reason === 'tested-ordering-unavailable'
    && handed.reviewRequiresAttention === false
    && handed.sourceHeadBound === true
    && handed.testedProtectedOrdering === false
    && handed.pr !== null;
  if (!handed.ok && !toleratedReviewProjection) {
    projectCache({ ref, state: 'published', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed }, root);
    if (handed.pr?.url) out(`projected exact review: ${handed.pr.url}`);
    err(`provider handoff refused: ${handed.reason ?? 'unknown'}`);
    return 1;
  }
  if (handed.testedProtectedOrdering) {
    const queued = transition('published', 'enqueue', {
      ...orderingFacts, laneHeadSha, providerReceipt: handed,
    });
    if (!queued.ok) {
      projectCache({ ref, state: 'published', head: laneHeadSha,
        pr: handed.pr?.number ?? null, handoff: handed }, root);
      err(report.formatRefusal(queued, 'observed ordering does not satisfy repository policy'));
      return 1;
    }
    projectCache({ ref, state: 'queued', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed, mode: 'merge-queue' }, root);
    out(handed.pr?.url ? `observed external queue entry: ${handed.pr.url}`
      : 'observed external queue entry');
    return 0;
  }
  projectCache({ ref, state: 'published', head: laneHeadSha,
    pr: handed.pr?.number ?? null, handoff: handed }, root);
  out(handed.pr?.url ? `projected exact review: ${handed.pr.url}` : 'projected exact review');
  out(promotion.escalates
    ? 'authority-controlling candidate: external promotion authority required'
    : 'candidate retained as published; protected integration requires external authority');
  out('exact protected integration proof is still required');
  return 0;
}
