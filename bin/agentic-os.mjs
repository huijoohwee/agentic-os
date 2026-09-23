#!/usr/bin/env node
import { existsSync } from 'node:fs';
import {
  git, repoRoot, currentBranch, configuredRemote, headSha,
  fetch as gitFetch, worktrees, refExists,
} from '../src/git.mjs';
import { assertDevice, deviceSegment, isLaneRef, parseLaneRef } from '../src/lane-id.mjs';
import { legalEvents } from '../src/lane-state.mjs';
import * as store from '../src/lane-records.mjs';
import * as queue from '../src/queue.mjs';
import {
  inspectRegistered,
  reapLaneBranches,
  staleWorktrees,
  worktreeFor,
  parseWritePaths, runPublishedLaneSuccessor,
} from '../src/worktree.mjs';
import { integrationProof, surveyLanes } from '../src/patch-identity.mjs';
import { dispatchInvocation, isInvocationTuple, resolveInvocation } from './agentic-os-invocation.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import * as report from './agentic-os-report.mjs';
import { REPOSITORY_PROFILE_FILENAME } from '../src/git-repository.mjs';
import {
  runAutonomyClass,
  runCanonicalSync,
  runReconcile,
  runObserve, runFlight, cmdDoctor,
  runRequest,
  providerKind,
  repositoryKind,
  assertProfileCurrent,
  trustedRepositoryProfile,
} from './agentic-os-auxiliary.mjs';
import { runHookSetup } from './agentic-os-hooks.mjs';
import { validateCommandArguments, cmdHelp, flag, option, positional } from './agentic-os-argv.mjs';
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
function remoteName(policy, root) {
  const name = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
  if (!name) throw new TypeError('repository profile remote-tracking ref has no remote name');
  return configuredRemote(name, root);
}
function requireCanonical(root, policy) {
  const branch = currentBranch(root);
  if (branch === policy.protectedBranch) return;
  err(`this command runs in the canonical ${policy.protectedBranch} worktree, not in a lane.\n` +
    `current branch: ${branch ?? 'detached'}`);
  process.exit(1);
}
async function cmdStart(root, argv, policy, profile) {
  return (await import('./agentic-os-admission.mjs')).cmdStart(root, argv, policy, profile,
    { out, err, projectCache, effectReceipt, remoteName, requireCanonical });
}
function cmdReleaseCommonHelp() {
  out(
    [
      'agentic-os release-common',
      '',
      'Default path:',
      '  agentic-os release-common start <scope> --write=<paths> [--plan=<committed-plan>]',
      '  agentic-os release-common publish [--message="<message>"] [--title="<title>"] [--body-file=<file>]',
      '  agentic-os release-common complete --ref=<lane> [--timeout-ms=<ms>] [--bundle=<json>] [--stopped]   wait, close, optional cleanup; emit closeout verdict',
      '  agentic-os complete-adlc --worktrees=<absolute-directory>   serial bounded closeout; preserve blocked lanes',
      '  agentic-os release-common close --ref=<lane>   run finish, reap, then completion status',
      '  agentic-os release-common finish --ref=<lane>   use the exact integration diagnostic path only when needed',
      '',
      'Exception path:',
      '  agentic-os release-common successor <scope> --expected-head=<published-head> [--write=<paths>]',
    ].join('\n'),
  );
  return 0;
}
async function cmdLand(cwd, argv, profile, policy) {
  return (await import('./agentic-os-publication.mjs')).cmdLand(cwd, argv, profile, policy,
    { out, err, projectCache, effectReceipt, remoteName });
}
function cmdSuccessor(root, argv, policy) {
  const predecessorRef = currentBranch(root);
  if (!predecessorRef || !isLaneRef(predecessorRef) || !isBoundLane(predecessorRef, root)) {
    err('blocked-unbound-lane: successor requires a bound published lane worktree');
    return 1;
  }
  const writeOption = option(argv, 'write'),
    expandedWritePaths = writeOption === null ? null : parseWritePaths(writeOption);
  return runPublishedLaneSuccessor({ cwd: root, predecessorRef,
    scope: positional(argv)[0], explicitHead: option(argv, 'expected-head'),
    remote: remoteName(policy, root), protectedRef: policy.protectedRef, out, expandedWritePaths });
}
async function cmdReleaseCommon(cwd, root, argv, policy, profile, once = false, beforeClose = () => {}) {
  const [action = 'help', ...rest] = argv;
  switch (action) {
    case 'help':
    case '--help':
    case '-h':
      return cmdReleaseCommonHelp();
    case 'start': {
      return cmdStart(root, rest, policy, profile);
    }
    case 'publish':
      return cmdLand(cwd, rest, profile, policy);
    case 'finish': {
      const finishStatus = cmdFinish(root, rest, policy, profile);
      if (finishStatus !== 0) return finishStatus;
      return cmdReap(root, rest, policy, profile);
    }
    case 'close': {
      const finishStatus = cmdFinish(root, rest, policy, profile);
      if (finishStatus !== 0) return finishStatus;
      const reapStatus = cmdReap(root, rest, policy, profile);
      if (reapStatus !== 0) return reapStatus;
      return (await import('./agentic-os-completion-status.mjs'))
        .runCompletionStatus(root, option(rest, 'ref'), policy, profile, out);
    }
    case 'complete': {
      const completeModule = await import('./agentic-os-release-common-complete.mjs');
      if (option(rest, 'via-pr') !== null)
        return completeModule.runReleaseCommonSuccessorComplete({ root, argv: rest, profile, out, err });
      if (option(rest, 'worktrees') !== null) return completeModule.runProgressiveCompletion({
        root, directory: option(rest, 'worktrees'), timeoutMs: Number(option(rest, 'timeout-ms', '60000')), policy, profile, out,
        complete: (ref, timeoutMs, guard) => cmdReleaseCommon(cwd, root, ['complete', `--ref=${ref}`, `--timeout-ms=${timeoutMs}`], policy, profile, true, guard),
      });
      const cleanup = completeModule.resolveReleaseCommonCleanupRequest(rest);
      const waitStatus = await completeModule.runReleaseCommonCompleteWait({
        root, argv: rest, profile, protectedBranch: policy.protectedBranch, out, err, once,
      });
      if (waitStatus !== 0) return waitStatus;
      beforeClose();
      const finishStatus = cmdFinish(root, rest, policy, profile);
      if (finishStatus !== 0) return finishStatus;
      const reapStatus = cmdReap(root, rest, policy, profile);
      if (reapStatus !== 0) return reapStatus;
      const completionModule = await import('./agentic-os-completion-status.mjs');
      const completion = completionModule.inspectCompletionStatus(root, option(rest, 'ref'), policy, profile);
      out(JSON.stringify(completion));
      const localCleanup = cleanup.bundlePath === null && profile.cleanup.worktreeProjection !== 'retain' && completion.lane.mounted;
      if (localCleanup || cleanup.bundlePath !== null) {
        beforeClose();
        const cleanupStatus = localCleanup
          ? await completeModule.runReleaseCommonLocalCleanup({ root, ref: option(rest, 'ref'), profile, out, err })
          : await completeModule.runReleaseCommonCleanup({ root, ref: option(rest, 'ref'), ...cleanup, out });
        if (cleanupStatus !== 0) return cleanupStatus;
        const settled = completionModule.inspectCompletionStatus(root, option(rest, 'ref'), policy, profile);
        out(JSON.stringify(settled));
        if (settled.lane.mounted) {
          err(`blocked-release-common-complete-${localCleanup ? 'local-cleanup' : 'cleanup'}-retained: cleanup returned, but the exact lane is still mounted.`);
          return 1;
        }
      }
      return 0;
    }
    case 'successor':
      return cmdSuccessor(root, rest, policy);
    default:
      err(`unknown release-common action "${action}"`);
      return cmdReleaseCommonHelp();
  }
}
function cmdStatus(root, argv, profile, policy) {
  const device = assertDevice(option(argv, 'device') ?? deviceSegment());
  const cachedRecords = store.load(root).lanes;
  const registrations = worktrees(root)
    .filter(({ branch }) => parseLaneRef(branch)?.device === device);
  const lanes = registrations.map((registration) => {
    const { branch: ref, path } = registration;
    const record = cachedRecords[ref] ?? null;
    const state = record?.state ?? 'active';
    if (!existsSync(path)) return {
      ref, path, state, commits: '-', untracked: 0, next: [], stale: true,
    };
    let observedLane;
    try {
      observedLane = inspectRegistered(registration, root, policy.protectedRef, { includeIgnored: false });
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
  const laneHead = headSha(`refs/heads/${ref}`, root);
  if (!laneHead || !refExists(`refs/heads/${ref}`, root)) {
    err(`blocked-lane-ref-missing: no local lane ref exists for ${ref}`);
    return 1;
  }
  const lane = worktreeFor(ref, root);
  const lanePath = lane && existsSync(lane.path) ? lane.path : null;
  if (lanePath && git(['status', '--porcelain'], { cwd: lanePath }).trim()) {
    err(`blocked-dirty-lane: preserve and commit or remove authored bytes in ${lane.path}`);
    return 1;
  }
  effectReceipt('fetch', gitFetch(remoteName(policy, root), root));
  const baseSha = assertProfileCurrent(root, policy, profile);
  if (!baseSha || !integrationProof(baseSha, laneHead, { cwd: root })) {
    err(`blocked-not-integrated: ${ref} is not exactly projected into ${policy.protectedRef}`);
    return 1;
  }
  out(JSON.stringify({ schema: 'agentic-os/sprint-finish/v1', ref, laneHead,
    integratedRevision: baseSha, worktree: lanePath, worktreeRemoved: false,
    branchRetained: true, grantsAuthority: false, profileDigest: profile.profileDigest,
    cleanupDisposition: profile.cleanup.worktreeProjection === 'retain'
      ? 'retained' : 'authenticated-cleanup-required',
    cleanupOwner: 'agentic-os/adapters/worktree-cleanup' }));
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
async function main() {
  const supplied = process.argv.slice(2);
  let [command = 'help', ...argv] = supplied;
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
  if (command === 'complete-adlc') { command = 'release-common'; argv = ['complete', ...argv]; }
  const argumentError = validateCommandArguments(command, argv);
  if (argumentError) {
    err(`blocked-invalid-arguments: ${command}: ${argumentError}`);
    return 1;
  }
  if (command === 'help' || command === '--help') return cmdHelp();
  if (command === 'release-common' && argv.length === 0) return cmdReleaseCommonHelp();
  if (command === 'release-common' && ['help', '--help', '-h'].includes(argv[0])) return cmdReleaseCommonHelp();
  if (command === 'run') return (await import('./agentic-os-run.mjs')).runAgentCommand(argv, out);
  if (command === 'capabilities') return (await import('./agentic-os-fleet.mjs')).runCapabilityCli(argv);
  if (command === 'request') return runRequest(argv);
  if (command === 'pipeline') return (await import('./agentic-os-pipeline.mjs')).runPipeline(argv);
  if (command === 'workspace' && argv[0] === 'check')
    return (await import('./agentic-os-workspace-check.mjs')).runWorkspaceCheck(argv, out);
  const cwd = process.cwd(); let root;
  try {
    root = repoRoot(cwd);
  } catch {
    err('not inside a git repository.');
    return 1;
  }
  if (command === 'profile') return (await import('./agentic-os-profile.mjs')).runProfileInit(root, argv, out);
  if (command === 'cleanup-user') return (await import('./agentic-os-cleanup-user.mjs')).runUserCleanup(root, argv, out);
  if (command === 'cleanup') return (await import('./agentic-os-cleanup-user.mjs')).runUnifiedCleanup(root, argv, out);
  if (command === 'pin') return (await import('./agentic-os-pin.mjs')).runPinCheck(root, argv, out);
  if (command === 'context') return (await import('./agentic-os-context.mjs')).runContext(root, argv, out);
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
    case 'collaborate': return (await import('./agentic-os-collaboration-store.mjs'))
      .runCollaboration(root, policy, profile, argv, out);
    case 'setup':
    case 'git-configure':
    case 'guard-install':
      return runHookSetup(root, policy, profile, out, { allowTrustCreation: trustedProfile.trust === null });
    case 'doctor': return cmdDoctor(root, profile, policy);
    case 'start': return cmdStart(root, argv, policy, profile);
    case 'release-common': return cmdReleaseCommon(cwd, root, argv, policy, profile);
    case 'memory': case 'workspace': return (await import('./agentic-os-workspace-sync.mjs'))
      .runWorkspaceCommand(root, policy, command, argv, out);
    case 'land': return cmdLand(cwd, argv, profile, policy);
    case 'successor': return cmdSuccessor(root, argv, policy);
    case 'status': return cmdStatus(root, argv, profile, policy);
    case 'reap': return cmdReap(root, argv, policy, profile);
    case 'finish': return cmdFinish(root, argv, policy, profile);
    case 'completion': return (await import('./agentic-os-completion-status.mjs'))
      .runCompletionStatus(root, option(argv, 'ref'), policy, profile, out);
    case 'canonical-sync': return runCanonicalSync(root, argv, policy);
    case 'reconcile': requireCanonical(root, policy); return runReconcile(root, argv, policy);
    case 'queue': return cmdQueue(root, argv, profile);
    case 'autonomy-class': return runAutonomyClass(root, argv, policy);
    case 'flight': return runFlight(root, argv, profile);
    case 'workflow': return (await import('./agentic-os-workflow.mjs')).runWorkflow(root, argv, profile, out);
    case 'observe': return runObserve(root, argv, profile);
    default:
      err(`unknown command "${command}"`);
      cmdHelp();
      return 1;
  }
}
try {
  process.exit(await main());
} catch (error) {
  const retained = report.formatRetainedOperation(error); if (retained) err(retained);
  err(`agentic-os: ${error.reason ? `${error.reason}: ` : ''}${error.message}`);
  process.exit(1);
}
