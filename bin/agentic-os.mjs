#!/usr/bin/env node
/** ADLC harness entrypoint: local lanes plus exact provider handoff. */
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  git,
  gitLines,
  repoRoot,
  currentBranch,
  configuredRemote,
  remoteTransport,
  acquireOperationLock,
  headSha,
  publishExactNewRef,
  remoteRefSha,
  fetch as gitFetch,
  worktreeCleanupRisks,
} from '../src/git.mjs';
import { deviceSegment, laneRef, isLaneRef, parseLaneRef } from '../src/lane-id.mjs';
import {
  CAPS,
  capAdvice,
  capFacts,
  legalEvents,
  orderingMode,
  providerAdapterRequired,
  transition,
} from '../src/lane-state.mjs';
import * as store from '../src/lane-records.mjs';
import * as queue from '../src/queue.mjs';
import * as config from '../src/config.mjs';
import {
  provision,
  inspect as inspectWorktree,
  laneBranches,
  staleWorktrees,
} from '../src/worktree.mjs';
import { integrationProof, surveyLanes, sourceHeadTrailer } from '../src/patch-identity.mjs';
import { dispatchInvocation, isInvocationTuple, resolveInvocation } from '../src/invocation.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import * as report from '../src/report.mjs';
import {
  REPOSITORY_PROFILE_FILENAME,
} from '../src/git-repository.mjs';
import {
  runAutonomyClass,
  runCanonicalSync,
  classifyPromotion,
  observeLocalHealth,
  runObserve,
  runRequest,
  assertProfileCurrent,
  assertProtectedRefCurrent,
  trustedRepositoryProfile,
} from './agentic-os-auxiliary.mjs';
const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);
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
function providerKind(profile) {
  if (!profile) return 'github';
  const selected = profile.adapters.provider;
  if (selected === null) return 'none';
  return selected.id === 'github' && selected.version === '1' ? 'github' : 'unsupported';
}
function repositoryKind(profile) {
  const selected = profile?.adapters.repository;
  return !selected || selected.id === 'git' && selected.version === '1' ? 'git' : 'unsupported';
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
function cmdSetup(root) {
  const changed = config.ensure(root);
  for (const hook of ['pre-commit', 'pre-push']) {
    const path = join(root, '.githooks', hook);
    if (existsSync(path)) chmodSync(path, 0o755);
  }
  out(report.formatConfig(config.inspect(root)));
  out('');
  out(changed.length === 0 ? 'configuration already correct.' : `${changed.length} setting(s) written.`);
  out('hooks executable, core.hooksPath set. Next: npm run doctor');
  return 0;
}
function cmdDoctor(root, profile, policy) {
  const configEntries = config.inspect(root);
  const local = observeLocalHealth(root, policy, profile);
  out(report.formatConfig(configEntries));
  out('');
  out(report.formatLocal(local));
  out('');
  const kind = providerKind(profile);
  const observed = kind === 'github'
    ? queue.observe({ cwd: root, profile: profile ?? undefined }) : null;
  const providerRequired = providerAdapterRequired(policy);
  const findings = kind === 'github' ? queue.audit(observed, profile ?? undefined) : [{
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
    (local.mainDirty ? 1 : 0) +
    (local.relation === 'equal' ? 0 : 1) +
    (local.staleWorktrees.length > 0 ? 1 : 0) +
    (local.laneBranches <= 20 ? 0 : 1);
  out('');
  if (failures === 0) {
    out('harness invariants hold.');
    return 0;
  }
  out(`${failures} finding(s) need attention. Nothing was changed.`);
  return 1;
}
function cmdStart(root, argv, policy, profile) {
  requireCanonical(root, policy);
  const [scope] = positional(argv);
  if (!scope) {
    err('usage: npm run lane -- <scope>   e.g. npm run lane -- pricing-table');
    return 1;
  }
  const device = option(argv, 'device', deviceSegment());
  const ref = laneRef(scope, device);
  const lockPath = acquireOperationLock('agentic-os-start', root);
  if (!lockPath) {
    err('blocked-concurrent-start: another lane admission owns the clone-wide start lock');
    return 1;
  }
  try {
    gitFetch(remoteName(policy, root), root);
    const baseSha = assertProfileCurrent(root, policy, profile);
    if (!baseSha) {
      err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
      return 1;
    }
    const branches = laneBranches(root);
    const scopeTaken = branches.some((branch) => parseLaneRef(branch)?.scope === scope);
    const facts = {
      ...capFacts(branches, device),
      baseFetched: true,
      scopeTaken,
    };
    const result = transition('planned', 'provision', facts);
    if (!result.ok) {
      err(report.formatRefusal(result, capAdvice(result.reason)));
      if (result.reason === 'blocked-scope-taken') err(`scope "${scope}" is already an open lane`);
      return 1;
    }
    const created = provision({ ref, scope, device, baseSha, cwd: root });
    store.put(
      {
        ...store.newRecord({
          ref,
          device,
          scope,
          base: policy.protectedRef,
          baseSha,
          worktree: created.path,
        }),
        state: 'active',
      },
      root,
    );
    out(`lane ${ref}`);
    out(`worktree ${created.path}`);
    out(`base ${policy.protectedRef} @ ${baseSha.slice(0, 9)}`);
    out('');
    out(`  cd ${created.path}`);
    out('  # author, commit, then:');
    out('  npm run land');
    return 0;
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
/** Review text binds Source-Head correlation; it never proves integration. */
function pullRequestText(root, ref, laneHeadSha, baseSha) {
  const subjects = gitLines(['log', '--format=%s', `${baseSha}..${laneHeadSha}`, '--reverse'], {
    cwd: root,
  });
  const scope = parseLaneRef(ref)?.scope ?? ref;
  const title = subjects.length === 1 ? subjects[0] : `${scope}: ${subjects.length} commits`;
  const body = [
    ...(subjects.length > 1 ? subjects.map((subject) => `- ${subject}`) : []),
    ...(subjects.length > 1 ? [''] : []),
    `Lane: ${ref}`,
    `Base-Revision: ${baseSha}`,
    sourceHeadTrailer(laneHeadSha),
  ].join('\n');
  return { title, body };
}
function publicationByteRisks(root) {
  const observed = worktreeCleanupRisks(root);
  const paths = [...new Set([...observed.hidden, ...observed.owned, ...observed.tracked])];
  return { blocked: observed.dirtyTracked || paths.length > 0, paths };
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
    err(`blocked-provider-adapter-${kind}: selected integration policy requires github adapter v1`);
    return 1;
  }

  const remote = remoteName(policy, root);
  const capturedRemote = remoteTransport(remote, root);
  gitFetch(remote, root, capturedRemote.fetchUrl);
  const baseSha = assertProfileCurrent(root, policy, profile);
  if (!baseSha) {
    err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
    return 1;
  }
  const record = store.get(ref, root);
  const laneHeadSha = headSha('HEAD', root);
  const commits = gitLines(['rev-list', `${baseSha}..${laneHeadSha}`], { cwd: root }).length;
  const publishedHead = remoteRefSha(remote, ref, root, capturedRemote.fetchUrl);
  const byteRisks = publicationByteRisks(root);
  if (byteRisks.blocked) {
    err(`blocked-publish-byte-risk: preserve ${byteRisks.paths.length} exact path(s) and tracked state`);
    return 1;
  }

  if (integrationProof(baseSha, laneHeadSha, { cwd: root })) {
    err('blocked-already-integrated: do not republish; reap can classify for public governance');
    return 1;
  }

  const providerPreflight = kind === 'github' && policy.pullRequestRequired
    ? queue.observe({ cwd: root, profile: profile ?? undefined }) : null;
  if (providerPreflight && (providerPreflight.available !== true
      || providerPreflight.repo === null
      || (providerPreflight.observationErrors ?? []).length > 0)) {
    err('blocked-provider-observation-incomplete: bind repository identity before publication');
    return 1;
  }

  let state = record?.state === 'planned' ? 'active' : record?.state ?? 'active';
  if (publishedHead) {
    if (publishedHead !== laneHeadSha || (record?.head && record.head !== laneHeadSha)) {
      err('blocked-published-head-drift: the exact remote lane revision is immutable');
      return 1;
    }
    // The remote exact ref is the publication fact. Recover safely when a
    // process crashed before updating the local, non-authoritative cache.
    if (state === 'active') state = 'published';
  } else if (state === 'published') {
    err('blocked-published-ref-missing: preserve the lane; its exact remote ref is absent');
    return 1;
  }
  if (!['active', 'published'].includes(state)) {
    err(`land requires an active or published lane; observed ${state}`);
    return 1;
  }
  const publishFacts = {
    onCanonicalMain: false,
    dirtyTracked: byteRisks.blocked,
    laneCommits: commits,
    pushed: false,
  };
  const preflight = state === 'active' ? transition('active', 'publish', publishFacts) : null;
  if (preflight && preflight.reason !== 'blocked-not-pushed') {
    err(report.formatRefusal(preflight, 'commit your work, then run npm run land again'));
    return 1;
  }

  if (state === 'published' && ((record?.head && record.head !== laneHeadSha)
      || publishFacts.dirtyTracked)) {
    err('blocked-published-head-drift: published lanes are immutable; preserve this worktree');
    return 1;
  }
  if (state === 'active') {
    assertProtectedRefCurrent(root, policy.protectedRef, baseSha);
    publishExactNewRef(remote, ref, laneHeadSha, root, capturedRemote.fetchUrl);
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
  store.put({ ref, state: 'published', head: laneHeadSha }, root);

  if (kind !== 'github' || !policy.pullRequestRequired) {
    out('published exact lane ref; no pull-request integration capability selected');
    return 0;
  }

  const observed = queue.observe({ cwd: root, profile: profile ?? undefined });
  const promotion = classifyPromotion(root, baseSha, laneHeadSha);
  const orderingFacts = {
    providerObservationComplete: observed.available === true
      && observed.repo !== null
      && (observed.observationErrors ?? []).length === 0,
    queueEnabled: policy.mergeQueueRequired && observed.queueEnabled,
    queuePolicySatisfied: observed.queuePolicySatisfied,
    requiredChecksSatisfied: policy.requiredChecks.every(
      (check) => observed.requiredChecks?.includes(check),
    ),
    mergeGroupSupported: observed.mergeGroupSupported,
  };
  const mode = orderingMode(orderingFacts);
  if (observed.remoteUrl !== providerPreflight.remoteUrl) {
    err('blocked-provider-remote-race: exact published lane retained; provider handoff refused');
    return 1;
  }
  if (!orderingFacts.providerObservationComplete) {
    store.put({ ref, state: 'published', head: laneHeadSha }, root);
    err('blocked-provider-observation-incomplete: exact repository and policy facts are required');
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
  const reviewProjected = handed.sourceHeadBound === true && handed.pr !== null;
  if (!handed.ok && !reviewProjected) {
    store.put({ ref, state: 'published', head: laneHeadSha,
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
      store.put({ ref, state: 'published', head: laneHeadSha,
        pr: handed.pr?.number ?? null, handoff: handed }, root);
      err(report.formatRefusal(queued, 'observed ordering does not satisfy repository policy'));
      return 1;
    }
    store.put({ ref, state: 'queued', head: laneHeadSha,
      pr: handed.pr?.number ?? null, handoff: handed, mode: 'merge-queue' }, root);
    out(handed.pr?.url ? `observed external queue entry: ${handed.pr.url}`
      : 'observed external queue entry');
    return 0;
  }
  store.put({ ref, state: 'published', head: laneHeadSha,
    pr: handed.pr?.number ?? null, handoff: handed }, root);
  out(handed.pr?.url ? `projected exact review: ${handed.pr.url}` : 'projected exact review');
  out(promotion.escalates
    ? 'authority-controlling candidate: external promotion authority required'
    : `candidate-side auto-arm refused; repository authority may select ${mode} ordering`);
  out('exact protected integration proof is still required');
  return 0;
}
function cmdStatus(root, argv, profile, policy) {
  const device = option(argv, 'device', deviceSegment());
  const branches = laneBranches(root);
  const lanes = branches.map((ref) => {
    const record = store.get(ref, root);
    const observedLane = inspectWorktree(ref, root, policy.protectedRef);
    const state = record?.state ?? 'active';
    return {
      ref,
      state,
      commits: observedLane.commits,
      untracked: observedLane.untracked.length,
      next: legalEvents(state),
    };
  });
  const observed = providerKind(profile) === 'github'
    ? queue.observe({ cwd: root, profile: profile ?? undefined }) : { available: false };
  out(
    report.formatStatus({
      device,
      lanes,
      caps: capFacts(branches, device),
      queue: observed.available ? observed : null,
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
  gitFetch(remoteName(policy, root), root);
  const baseSha = assertProfileCurrent(root, policy, profile);
  if (!baseSha) {
    err(`blocked-base-not-fetched: ${policy.protectedRef} is unavailable after fetch`);
    return 1;
  }
  const survey = surveyLanes(baseSha, laneBranches(root), { cwd: root });
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
function cmdQueue(root, argv, profile) {
  const [action = 'show'] = positional(argv);
  if (providerKind(profile) !== 'github') {
    err('blocked-provider-adapter-unselected: queue commands require github adapter v1');
    return 1;
  }
  if (action === 'show') {
    const observed = queue.observe({ cwd: root, profile: profile ?? undefined });
    out(report.formatFindings('remote configuration', queue.audit(observed, profile ?? undefined)));
    out('');
    out(report.formatPlan(queue.plan(profile ?? undefined)));
    return 0;
  }
  if (action === 'apply') {
    if (!flag(argv, 'yes')) {
      out(report.formatPlan(queue.plan(profile ?? undefined)));
      out('');
      out('Provider policy is repository-owned; this adapter will refuse candidate-side apply:');
      out('  npm run queue:apply -- --yes');
      return 1;
    }
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
      '  npm run setup             write local git config, make hooks executable',
      '  npm run doctor            report harness and remote drift, change nothing',
      '  npm run lane -- <scope>   open a lane at the fetched profile canonical ref',
      '  npm run land              publish the exact lane head and request provider handoff',
      '  npm run status            lanes, WIP against caps, queue state',
      '  npm run reap             classify exact integration; never clean or retire authority',
      '  npm run sync:canonical    plan a recovery-backed canonical checkout synchronization',
      '  npm run autonomy:class    compute the committed candidate promotion ceiling',
      '  agentic-os observe        emit a shallow profile-bound repository observation',
      '  agentic-os request ...    construct an unsigned Coordination Request from JSON',
      '  npm run queue:show        inspect the required remote configuration',
      '  npm run queue:apply       fail closed; provider policy is repository-owned',
      '',
      `cap: ${CAPS.openLanesPerDevice} open lanes per device`,
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

  if (command === undefined || command === 'help' || command === '--help') return cmdHelp();

  const cwd = process.cwd();
  let root;
  try {
    root = repoRoot(cwd);
  } catch {
    err('not inside a git repository.');
    return 1;
  }
  const trustedProfile = trustedRepositoryProfile(root);
  const { profile } = trustedProfile;
  if (repositoryKind(profile) !== 'git') {
    err('blocked-repository-adapter-unsupported: operational commands require git adapter v1');
    return 1;
  }
  const policy = queue.providerPolicy(profile ?? undefined);

  const protectedMutation = ['start', 'land'].includes(command)
    || command === 'canonical-sync' && positional(argv)[0] === 'apply';
  if (!profile && protectedMutation
      && process.env.AGENTIC_OS_ALLOW_LEGACY_PROFILE !== '1') {
    err(`blocked-repository-profile-missing: commit ${REPOSITORY_PROFILE_FILENAME} before mutation`);
    return 1;
  }

  switch (command) {
    case 'setup':
      return cmdSetup(root);
    case 'git-configure':
      out(report.formatConfig(config.inspect(root)));
      config.ensure(root);
      return 0;
    case 'guard-install':
      return cmdSetup(root);
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
    case 'canonical-sync':
      return runCanonicalSync(root, argv, policy);
    case 'queue':
      return cmdQueue(root, argv, profile);
    case 'autonomy-class':
      return runAutonomyClass(root, argv, policy);
    case 'observe':
      return runObserve(root, argv, profile);
    case 'request':
      return runRequest(argv);
    default:
      err(`unknown command "${command}"`);
      cmdHelp();
      return 1;
  }
}

try {
  process.exit(main());
} catch (error) {
  err(`agentic-os: ${error.reason ? `${error.reason}: ` : ''}${error.message}`);
  process.exit(1);
}
