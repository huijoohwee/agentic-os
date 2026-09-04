#!/usr/bin/env node
/** ADLC harness entrypoint: local lanes plus exact provider handoff. */
import { existsSync } from 'node:fs';
import {
  git,
  gitLines,
  repoRoot,
  currentBranch,
  configuredRemote,
  remoteTransport,
  acquireOperationLock,
  finishOperationLock,
  headSha,
  publishExactNewRef,
  remoteRefSha,
  fetch as gitFetch,
  worktrees,
} from '../src/git.mjs';
import { assertDevice, deviceSegment, laneRef, isLaneRef, parseLaneRef } from '../src/lane-id.mjs';
import {
  legalEvents,
  providerAdapterRequired,
  transition,
} from '../src/lane-state.mjs';
import * as store from '../src/lane-records.mjs';
import * as queue from '../src/queue.mjs';
import {
  provision, assertProvisionable,
  inspect as inspectWorktree,
  registeredLaneBranches,
  reapLaneBranches,
  staleWorktrees,
  worktreeFor,
} from '../src/worktree.mjs';
import { integrationProof, surveyLanes } from '../src/patch-identity.mjs';
import { dispatchInvocation, isInvocationTuple, resolveInvocation } from '../src/invocation.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import * as report from './agentic-os-report.mjs';
import {
  REPOSITORY_PROFILE_FILENAME,
} from '../src/git-repository.mjs';
import {
  runAutonomyClass,
  runCanonicalSync,
  runReconcile,
  assertPublicationPreflight, classifyPromotion, observeLocalHealth, publicationByteRisks,
  runObserve,
  runRequest,
  pullRequestText,
  providerKind,
  repositoryKind,
  assertProfileCurrent,
  assertProtectedRefCurrent,
  trustedRepositoryProfile,
} from './agentic-os-auxiliary.mjs';
import { hookDoctorEntries, runHookSetup } from './agentic-os-hooks.mjs';
import { validateCommandArguments } from './agentic-os-argv.mjs';
const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);
function projectCache(record, root) {
  const projected = store.project(record, root);
  if (!projected.ok) {
    err(`warning-lane-cache-degraded: authoritative effects retained; cache projection failed (${projected.error.reason ?? projected.error.message})`);
    const retained = report.formatLaneProjectionRetained(record, projected.error);
    if (retained) err(retained);
  }
}
function effectReceipt(operation, receipt) {
  const rendered = receipt?.effectsRetained ? report.formatEffectReceipt(operation, receipt) : null;
  if (rendered) err(rendered);
  return receipt;
}
function flag(argv, name) {
  return argv.includes(`--${name}`);
}
function option(argv, name, fallback = null) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function positional(argv) {
  return argv.filter((arg) => !arg.startsWith('--'));
}
function remoteName(policy, root) {
  const name = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
  if (!name) throw new TypeError('repository profile remote-tracking ref has no remote name');
  return configuredRemote(name, root);
}
function requireCanonical(root, policy) {
  const branch = currentBranch(root);
  if (branch === policy.protectedBranch) return;
  err(
    `this command runs in the canonical ${policy.protectedBranch} worktree, not in a lane.\n` +
      `current branch: ${branch ?? 'detached'}`,
  );
  process.exit(1);
}
function cmdSetup(root, policy, profile, allowTrustCreation) {
  return runHookSetup(root, policy, profile, out, { allowTrustCreation });
}
function cmdDoctor(root, profile, policy) {
  const configEntries = hookDoctorEntries(root);
  const local = observeLocalHealth(root, policy, profile);
  out(report.formatConfig(configEntries));
  out('');
  out(report.formatLocal(local));
  out('');
  const kind = providerKind(profile);
  const observed = kind === 'github'
    ? queue.observe({ cwd: root, profile }) : null;
  const providerRequired = providerAdapterRequired(policy);
  const findings = kind === 'github' ? queue.audit(observed, profile) : [{
    id: 'provider-adapter', ok: kind === 'none' && !providerRequired,
    detail: kind === 'none' ? providerRequired
      ? 'selected capabilities require a provider adapter' : 'no provider selected'
      : 'selected provider adapter is unsupported',
    remedy: kind === 'none' && !providerRequired ? null : 'select a supported provider adapter',
  }];
  out(report.formatFindings('remote configuration', findings));
  const failures =
    configEntries.filter((entry) => !entry.ok).length +
    findings.filter((finding) => !finding.ok).length +
    (local.canonicalDirty ? 1 : 0) +
    (local.relation === 'equal' ? 0 : 1) +
    (local.staleWorktrees.length > 0 ? 1 : 0);
  out(''); out(report.formatDoctorConclusion(failures, local.canonicalCleanlinessDeferred));
  return failures === 0 ? 0 : 1;
}
function cmdStart(root, argv, policy, profile) {
  requireCanonical(root, policy);
  const [scope] = positional(argv);
  if (!scope) {
    err('usage: npm run lane -- <scope>   e.g. npm run lane -- pricing-table');
    return 1;
  }
  const device = assertDevice(option(argv, 'device') ?? deviceSegment());
  const ref = laneRef(scope, device);
  store.load(root); // A present invalid cache must fail before fetch or lane creation.
  const lock = acquireOperationLock('agentic-os-start', root);
  if (!lock) {
    err('blocked-concurrent-start: another lane admission owns the clone-wide start lock');
    return 1;
  }
  let operationResult;
  let operationError = null;
  const artifacts = { effectsRetained: false, ref, worktree: null, baseSha: null,
    protectedRef: policy.protectedRef, fetchedProtectedSha: null, fetchCompleted: false,
    provisioned: false, branchSha: null, registeredWorktree: null, pathExists: false,
    fetchReceipt: null, provisionReceipt: null };
  try {
    operationResult = (() => {
      assertProvisionable({ ref, scope, device, cwd: root });
      const fetched = effectReceipt('fetch', gitFetch(remoteName(policy, root), root));
      Object.assign(artifacts, { fetchReceipt: fetched, fetchCompleted: true,
        effectsRetained: fetched.effectsRetained,
        fetchedProtectedSha: headSha(policy.protectedRef, root) });
      const baseSha = assertProfileCurrent(root, policy, profile);
      const active = registeredLaneBranches(root);
      if (active.length > 0) {
        throw Object.assign(new Error(
          `finish the active lane before starting another: ${active.join(', ')}`), {
          reason: 'blocked-active-lane-sprawl',
        });
      }
      artifacts.baseSha = baseSha;
      if (!baseSha) {
        err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
        return 1;
      }
      const facts = { baseFetched: true };
      const result = transition('planned', 'provision', facts);
      if (!result.ok) {
        err(report.formatRefusal(result));
        return 1;
      }
      const created = effectReceipt('provision-worktree',
        provision({ ref, scope, device, baseSha, cwd: root }));
      Object.assign(artifacts, { worktree: created.path, provisioned: true,
        provisionReceipt: created, effectsRetained: true });
      out(`lane ${ref}`);
      out(`worktree ${created.path}`);
      out(`base ${policy.protectedRef} @ ${baseSha.slice(0, 9)}`);
      projectCache({
        ...store.newRecord({
          ref, device, scope, base: policy.protectedRef, baseSha, worktree: created.path,
        }), state: 'active',
      }, root);
      out('');
      out(`  cd ${created.path}`);
      out('  # author, commit, then:');
      out('  npm run land');
      return 0;
    })();
  } catch (error) {
    const retained = error.operationArtifacts ?? error.artifacts;
    if (retained) {
      artifacts[retained.operation === 'fetch' ? 'fetchReceipt' : 'provisionReceipt'] = retained;
      artifacts.branchSha = retained.branchSha ?? null;
      artifacts.registeredWorktree = retained.registeredWorktree ?? null;
      artifacts.pathExists = retained.pathExists === true;
      artifacts.worktree = retained.path ?? retained.registeredWorktree?.path ?? null;
      artifacts.effectsRetained ||= retained.effectsRetained === true;
    }
    operationError = error;
  }
  return finishOperationLock(lock, {
    label: 'start', result: operationResult, error: operationError, artifacts,
  });
}
function cmdLand(cwd, profile, policy) {
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
  const kind = providerKind(profile);
  if (providerAdapterRequired(policy) && kind !== 'github') {
    err(`blocked-provider-adapter-${kind}: no landing adapter matches the selected profile policy`);
    return 1;
  }
  const remote = remoteName(policy, root);
  const capturedRemote = remoteTransport(remote, root);
  // A present invalid optional cache must fail before fetch mutates local provider evidence.
  store.load(root);
  const laneHeadSha = assertPublicationPreflight(root);
  effectReceipt('fetch', gitFetch(remote, root, capturedRemote.fetchUrl));
  const baseSha = assertProfileCurrent(root, policy, profile);
  if (!baseSha) {
    err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
    return 1;
  }
  const commits = gitLines(['rev-list', `${baseSha}..${laneHeadSha}`], { cwd: root }).length;
  const publishedHead = remoteRefSha(remote, ref, root, capturedRemote.fetchUrl);
  assertPublicationPreflight(root, laneHeadSha);

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

  if (publishedHead) {
    if (publishedHead !== laneHeadSha) {
      err('blocked-published-head-drift: the exact remote lane revision is immutable');
      return 1;
    }
  }
  // Only the exact advertised ref determines publication; stale cache states cannot block recovery.
  const state = publishedHead ? 'published' : 'active';
  const publishFacts = {
    onCanonicalBranch: false,
    dirtyTracked: false,
    laneCommits: commits,
    pushed: false,
  };
  const preflight = state === 'active' ? transition('active', 'publish', publishFacts) : null;
  if (preflight && preflight.reason !== 'blocked-not-pushed') {
    err(report.formatRefusal(preflight, 'commit your work, then run npm run land again'));
    return 1;
  }

  if (state === 'active') {
    assertProtectedRefCurrent(root, policy.protectedRef, baseSha);
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
  const handed = queue.enqueue(ref, {
    cwd: root,
    expectedHead: laneHeadSha,
    expectedRepository: observed.repo,
    baseBranch: policy.protectedBranch,
    assertSourceHead: () => remoteRefSha(remote, ref, root, capturedRemote.fetchUrl) === laneHeadSha,
    ...pullRequestText(root, ref, laneHeadSha, baseSha),
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
function cmdStatus(root, argv, profile, policy) {
  const device = assertDevice(option(argv, 'device') ?? deviceSegment());
  const cachedRecords = store.load(root).lanes;
  const registrations = worktrees(root)
    .filter(({ branch }) => parseLaneRef(branch)?.device === device);
  const lanes = registrations.map(({ branch: ref, path }) => {
    const record = cachedRecords[ref] ?? null;
    const state = record?.state ?? 'active';
    if (!existsSync(path)) return {
      ref, path, state, commits: '-', untracked: 0, next: [], stale: true,
    };
    let observedLane;
    try {
      observedLane = inspectWorktree(ref, root, policy.protectedRef, { includeIgnored: false });
    } catch (error) {
      if (!existsSync(path)) return {
        ref, path, state, commits: '-', untracked: 0, next: [], stale: true,
      };
      throw error;
    }
    return {
      ref,
      state,
      commits: observedLane.commits,
      untracked: observedLane.untracked.length,
      next: legalEvents(state),
    };
  });
  const kind = providerKind(profile);
  const observed = kind === 'github'
    ? queue.observe({ cwd: root, profile })
    : kind === 'unsupported' ? { available: false, reason: 'unsupported' } : null;
  out(
    report.formatStatus({
      device,
      lanes,
      queue: observed,
    }),
  );
  return 0;
}
function cmdReap(root, argv, policy, profile) {
  requireCanonical(root, policy);
  if (flag(argv, 'apply')) {
    err('blocked-authenticated-cleanup-required: reap is classification-only');
    return 1;
  }
  const branches = reapLaneBranches(option(argv, 'ref'), root);
  effectReceipt('fetch', gitFetch(remoteName(policy, root), root));
  const baseSha = assertProfileCurrent(root, policy, profile);
  if (!baseSha) {
    err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
    return 1;
  }
  const survey = surveyLanes(baseSha, branches, { cwd: root });
  const stale = staleWorktrees(root).map((entry) => entry.path);
  out(report.formatSurvey(survey));
  if (stale.length > 0) {
    out('');
    out(`${stale.length} stale worktree registration(s), preserved:`);
    for (const path of stale) out(`  ${path}`);
  }
  if (survey.integrated.length > 0 || stale.length > 0) {
    out('');
    out('classification only; authenticated retire(claim) and cleanup receipts remain required.');
  }
  return 0;
}
function cmdFinish(root, argv, policy, profile) {
  requireCanonical(root, policy);
  const ref = option(argv, 'ref');
  if (!ref || !isLaneRef(ref)) {
    err('blocked-invalid-lane-ref: finish requires --ref=<lane>');
    return 1;
  }
  const lane = worktreeFor(ref, root);
  if (!lane || !existsSync(lane.path)) {
    err(`blocked-unbound-lane: no registered worktree exists for ${ref}`);
    return 1;
  }
  if (git(['status', '--porcelain'], { cwd: lane.path }).trim()) {
    err(`blocked-dirty-lane: preserve and commit or remove authored bytes in ${lane.path}`);
    return 1;
  }
  effectReceipt('fetch', gitFetch(remoteName(policy, root), root));
  const baseSha = assertProfileCurrent(root, policy, profile);
  const laneHead = headSha(`refs/heads/${ref}`, root);
  if (!baseSha || !integrationProof(baseSha, laneHead, { cwd: root })) {
    err(`blocked-not-integrated: ${ref} is not exactly projected into ${policy.protectedRef}`);
    return 1;
  }
  git(['worktree', 'remove', lane.path], { cwd: root });
  if (worktreeFor(ref, root) || existsSync(lane.path)) {
    err(`blocked-finish-postcondition: ${ref} worktree removal is incomplete`);
    return 1;
  }
  out(JSON.stringify({ schema: 'agentic-os/sprint-finish/v1', ref, laneHead,
    integratedRevision: baseSha, worktree: lane.path, worktreeRemoved: true,
    branchRetained: true }));
  return 0;
}
function cmdQueue(root, argv, profile) {
  const [action = 'show'] = positional(argv);
  const kind = providerKind(profile);
  if (kind !== 'github') {
    err(`${kind === 'unsupported' ? 'blocked-provider-adapter-unsupported'
      : 'blocked-provider-adapter-unselected'}: queue commands require github adapter v1`);
    return 1;
  }
  if (action === 'show') {
    const observed = queue.observe({ cwd: root, profile });
    out(report.formatFindings('remote configuration', queue.audit(observed, profile)));
    out('');
    out(report.formatPlan(queue.plan(profile)));
    return 0;
  }
  if (action === 'apply') {
    const applied = queue.apply({ cwd: root });
    for (const step of applied) {
      out(`${step.ok ? 'ok  ' : 'FAIL'} ${step.step}`);
      if (step.error) out(`       provider: ${step.error}`);
      if (step.note) out(`       ${step.note}`);
    }
    out('');
    out('Verify with: npm run doctor');
    return applied.length > 0 && applied.every((step) => step.ok) ? 0 : 1;
  }
  err(`unknown queue action "${action}". use: show | apply`);
  return 1;
}
function cmdHelp() {
  out(
    [
      'agentic-os — ADLC harness',
      '',
      '  npm run setup             write config and select packaged hooks without clobbering',
      '  npm run doctor            report harness and remote drift, change nothing',
      '  npm run lane -- <scope>   open a lane at the fetched profile canonical ref',
      '  npm run land              publish the exact lane head and request provider handoff',
      '  npm run finish -- --ref=<lane>  remove one clean, exactly integrated worktree',
      '  npm run status            registered lane projections and provider state',
      '  npm run reap [-- --ref=<lane>]  classify exact integration; never clean or retire authority',
      '  npm run sync:canonical    plan a recovery-backed canonical checkout synchronization',
      '  npm run reconcile         fetch, classify, and plan protected-main reconciliation',
      '  npm run autonomy:class    compute the committed candidate promotion ceiling',
      '  agentic-os observe        emit a shallow profile-bound repository observation',
      '  agentic-os request ...    construct an unsigned Coordination Request from JSON',
      '  npm run queue:show        inspect the required remote configuration',
      '  npm run queue:apply -- --yes  fail closed; provider policy is repository-owned',
      '',
    ].join('\n'),
  );
  return 0;
}
function main() {
  const supplied = process.argv.slice(2);
  let [command, ...argv] = supplied;
  if (isInvocationTuple(supplied)) {
    const resolution = resolveInvocation(supplied);
    const dispatch = dispatchInvocation(resolution);
    if (!dispatch.ok) {
      err(`invocation ${resolution.code}: ${JSON.stringify(resolution.detail ?? {})}`);
      return 1;
    }
    command = dispatch.command;
    argv = dispatch.argv;
  }
  if (command === undefined) return cmdHelp();
  const argumentError = validateCommandArguments(command, argv);
  if (argumentError) {
    err(`blocked-invalid-arguments: ${command}: ${argumentError}`);
    return 1;
  }
  if (command === 'help' || command === '--help') return cmdHelp();
  if (command === 'request') return runRequest(argv);
  const cwd = process.cwd();
  let root;
  try {
    root = repoRoot(cwd);
  } catch {
    err('not inside a git repository.');
    return 1;
  }
  const setupCommand = ['setup', 'git-configure', 'guard-install'].includes(command);
  const trustedProfile = trustedRepositoryProfile(root, { allowUnanchored: setupCommand });
  const { profile } = trustedProfile;
  if (!profile) {
    err(`blocked-repository-profile-missing: commit ${REPOSITORY_PROFILE_FILENAME} before operation`);
    return 1;
  }
  if (repositoryKind(profile) !== 'git') {
    err('blocked-repository-adapter-unsupported: operational commands require git adapter v1');
    return 1;
  }
  const policy = queue.providerPolicy(profile);
  switch (command) {
    case 'setup':
    case 'git-configure':
    case 'guard-install':
      return cmdSetup(root, policy, profile, trustedProfile.trust === null);
    case 'doctor':
      return cmdDoctor(root, profile, policy);
    case 'start':
      return cmdStart(root, argv, policy, profile);
    case 'land':
      return cmdLand(cwd, profile, policy);
    case 'status':
      return cmdStatus(root, argv, profile, policy);
    case 'reap':
      return cmdReap(root, argv, policy, profile);
    case 'finish':
      return cmdFinish(root, argv, policy, profile);
    case 'canonical-sync':
      return runCanonicalSync(root, argv, policy);
    case 'reconcile':
      requireCanonical(root, policy);
      return runReconcile(root, argv, policy);
    case 'queue':
      return cmdQueue(root, argv, profile);
    case 'autonomy-class':
      return runAutonomyClass(root, argv, policy);
    case 'observe':
      return runObserve(root, argv, profile);
    default:
      err(`unknown command "${command}"`);
      cmdHelp();
      return 1;
  }
}
try {
  process.exit(main());
} catch (error) {
  const retained = report.formatRetainedOperation(error); if (retained) err(retained);
  err(`agentic-os: ${error.reason ? `${error.reason}: ` : ''}${error.message}`);
  process.exit(1);
}
