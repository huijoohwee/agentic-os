/** Observe one published review until merge, then let existing closeout primitives run. */
import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { currentBranch, worktreeInventory } from '../src/git.mjs';
import { loadRepositoryProfile } from '../src/git-repository.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { gh, observeGitHubReview } from '../src/github-provider.mjs';
import { inferMergedReviewWorkflow, githubRead } from './agentic-os-cleanup-review.mjs';
import { applyUserCleanup, planUserCleanup } from './agentic-os-cleanup-user.mjs';
import { RECOVERY_MODE } from './agentic-os-cleanup-recovery.mjs';
import { inspectCompletionStatus } from './agentic-os-completion-status.mjs';
import { cleanupWorkflowContext, releaseCommonLocalCleanupPolicy, runReleaseCommonSuccessorComplete } from '../src/cleanup.mjs';
export { runReleaseCommonSuccessorComplete };
import { isLaneRef } from '../src/lane-id.mjs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { createWorkflowEffectGuard } from './agentic-os-workflow.mjs';
import { get } from '../src/lane-records.mjs';
import { option } from './agentic-os-argv.mjs';

export const RELEASE_COMMON_COMPLETE_SCHEMA = 'agentic-os/release-common-complete-observation/v1';

const COMPLETE_STATES = new Set(['published', 'queued', 'integrated']);

function fail(reason, message) {
  const error = new Error(message);
  error.reason = reason;
  throw error;
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`blocked-release-common-complete-${label}`, `${label} must be an integer from ${min} to ${max}`);
  return value;
}

function jsonFile(path, ceiling, label) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true })
      .decode(readBoundedStableFile(path, ceiling, label)));
  } catch (error) {
    fail('blocked-release-common-complete-bundle', `${label}: ${error.message}`);
  }
}

function branchFromLocalRef(localRef) {
  const match = typeof localRef === 'string' ? localRef.match(/^refs\/heads\/(.+)$/u) : null;
  if (!match) fail('blocked-release-common-complete-profile-invalid',
    'repository profile canonical local ref must be refs/heads/<branch>');
  return match[1];
}

function headSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value) ? value : null;
}
export function resolveReleaseCommonCompleteBinding(root, ref, protectedBranch) {
  if (!isLaneRef(ref)) fail('blocked-invalid-lane-ref',
    'release-common complete requires --ref=<lane>');
  if (currentBranch(root) !== protectedBranch)
    fail('blocked-canonical-required',
      `release-common complete runs from the canonical ${protectedBranch} worktree`);
  const record = get(ref, root);
  if (!record || !COMPLETE_STATES.has(record.state))
    fail('blocked-release-common-complete-state',
      'release-common complete requires a published, queued, or integrated lane cache record');
  const head = headSha(record.head);
  if (!head)
    fail('blocked-release-common-complete-head',
      'release-common complete requires a cached published lane head');
  return Object.freeze({ ref, head, pr: Number.isSafeInteger(record.pr) ? record.pr : null });
}

export function resolveReleaseCommonCleanupRequest(argv) {
  const bundlePath = option(argv, 'bundle');
  const stopped = argv.includes('--stopped');
  if (bundlePath === null) {
    if (stopped)
      fail('blocked-release-common-complete-stopped',
        '--stopped is only valid together with --bundle=<json>');
    return Object.freeze({ bundlePath: null, stopped: false });
  }
  if (!stopped)
    fail('blocked-release-common-complete-stopped',
      'authenticated cleanup requires --stopped together with --bundle=<json>');
  return Object.freeze({ bundlePath, stopped: true });
}

export async function watchReleaseCommonReview(binding, {
  timeoutMs = 60_000,
  once = false,
  initialMs = 5_000,
  now = () => performance.now(),
  sleep = delay,
  observeReview,
  emit = () => {},
} = {}) {
  if (typeof binding?.ref !== 'string' || headSha(binding?.head) === null)
    fail('blocked-release-common-complete-binding',
      'release-common complete review binding is invalid');
  if (typeof observeReview !== 'function')
    fail('blocked-release-common-complete-observer',
      'release-common complete requires a review observer');
  integer(timeoutMs, 1, 60_000, 'timeout-ms');
  integer(initialMs, 1, 60_000, 'initial-ms');

  const started = now();
  const deadline = started + timeoutMs;
  let polls = 0;
  let reason = 'observation-window-elapsed';
  let previous = null;

  const remainingMs = () => Math.max(0, Math.ceil(deadline - now()));
  while (remainingMs() > 0 && polls < 12) {
    const observation = await observeReview(binding, { remainingMs });
    polls += 1;
    if (remainingMs() === 0) break; // Late evidence cannot trigger closeout.
    const review = observation?.review ?? null;
    const merged = observation?.sourceHeadBound === true && review?.state === 'MERGED';
    const state = typeof review?.state === 'string' ? review.state : null;
    const signature = JSON.stringify([
      observation?.sourceHeadBound === true,
      observation?.reason ?? null,
      state,
      review?.mergeStateStatus ?? null,
    ]);
    const changed = signature !== previous;
    const event = {
      schema: RELEASE_COMMON_COMPLETE_SCHEMA, authority: false, ref: binding.ref, head: binding.head,
      pr: review?.number ?? binding.pr ?? null, state, mergeStateStatus: review?.mergeStateStatus ?? null,
      sourceHeadBound: observation?.sourceHeadBound === true, reason: observation?.reason ?? null,
      url: review?.url ?? null, polls, elapsedMs: Math.round(now() - started),
    };
    if (changed) { previous = signature; emit({ ...event, event: 'review_changed' }); }
    if (merged) {
      emit({ ...event, event: 'merged', nextAction: 'run_close' });
      return { code: 0, status: 'merged', review, polls, elapsedMs: Math.round(now() - started) };
    }
    if (observation?.sourceHeadBound !== true) {
      return {
        code: 1,
        status: 'blocked',
        reason: observation?.reason ?? 'review-unbound',
        review,
        polls,
        elapsedMs: Math.round(now() - started),
      };
    }
    if (state !== 'OPEN') {
      return {
        code: 1,
        status: 'blocked',
        reason: `review-state-${String(state ?? 'unknown').toLowerCase()}`,
        review,
        polls,
        elapsedMs: Math.round(now() - started),
      };
    }
    if (once) { reason = 'single-observation'; break; }
    if (!changed) { reason = 'unchanged-state'; break; }
    if (polls === 12) { reason = 'observation-budget-elapsed'; break; }
    await sleep(Math.min(initialMs, remainingMs()));
  }

  emit({
    schema: RELEASE_COMMON_COMPLETE_SCHEMA,
    event: 'verified_wait',
    reason,
    authority: false,
    ref: binding.ref,
    head: binding.head,
    pr: binding.pr ?? null,
    polls,
    elapsedMs: Math.round(now() - started),
    recheckAfterMs: 60_000,
    nextAction: 'continue_independent_work',
  });
  return { code: 2, status: 'waiting', reason,
    polls, elapsedMs: Math.round(now() - started) };
}


export async function runReleaseCommonCleanup({
  root,
  ref,
  bundlePath,
  stopped,
  out = (line) => process.stdout.write(`${line}\n`),
  planCompletionClose,
  applyCompletionClose,
} = {}) {
  if (bundlePath === null) return 0;
  if (typeof planCompletionClose !== 'function' || typeof applyCompletionClose !== 'function') {
    const module = await import('./agentic-os-completion-close.mjs');
    planCompletionClose = module.planCompletionClose;
    applyCompletionClose = module.applyCompletionClose;
  }
  const bundle = jsonFile(bundlePath, 4_194_304, 'completion-bundle');
  const repository = loadRepositoryProfile({ repository: root }).repository;
  const assertWorkflowCurrent = createWorkflowEffectGuard(() => cleanupWorkflowContext(root, ref, repository));
  assertWorkflowCurrent();
  const planned = await planCompletionClose(root, ref, bundle);
  out(JSON.stringify(planned));
  if (planned.repository !== repository) fail('blocked-release-common-cleanup-repository', 'cleanup planning changed repository identity');
  assertWorkflowCurrent();
  const applied = await applyCompletionClose(root, ref, bundle, planned,
    planned.authorizationDigest, { stopped });
  out(JSON.stringify(applied));
  return 0;
}
export async function runReleaseCommonLocalCleanup({
  root,
  ref,
  profile,
  out = (line) => process.stdout.write(`${line}\n`),
  err = (line) => process.stderr.write(`${line}\n`),
  now = Date.now,
  api = githubRead,
} = {}) {
  try {
    const current = releaseCommonLocalCleanupPolicy(root, profile);
    const status = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile);
    const record = get(ref, root);
    let pr = record?.pr;
    if (record && pr == null && COMPLETE_STATES.has(record.state) && headSha(record.head)) {
      const observed = observeGitHubReview({ ref, expectedHead: record.head, profile, cwd: root });
      if (observed.sourceHeadBound === true && observed.review?.state === 'MERGED')
        pr = observed.review.number;
    }
    if (!Number.isSafeInteger(pr) || pr < 1)
      fail('blocked-release-common-local-cleanup-review', 'local cleanup requires one exact merged review record');
    if (!status.lane.path || status.lane.mounted !== true || status.lane.clean !== true)
      fail('blocked-release-common-local-cleanup-lane', 'local cleanup requires one exact mounted clean lane');
    const assertWorkflowCurrent = createWorkflowEffectGuard(() => cleanupWorkflowContext(root, ref, profile.repository));
    assertWorkflowCurrent();
    const workflow = inferMergedReviewWorkflow({
      repository: current.repository, pr, requiredChecks: [...current.requiredChecks].sort(),
    }, { cwd: root, api });
    const resolvePolicy = (policyRoot, mode) => {
      if (policyRoot !== root || mode !== RECOVERY_MODE)
        fail('blocked-release-common-local-cleanup-policy', 'local cleanup policy drifted');
      return current;
    };
    const plan = planUserCleanup({
      cwd: root,
      target: status.lane.path,
      pr,
      requiredChecks: [...current.requiredChecks].sort(),
      workflow,
      recovery: true,
    }, {
      now,
      api,
      resolvePolicy,
      observeRemote: () => `${current.canonical}\trefs/heads/main`,
    });
    out(JSON.stringify(plan));
    assertWorkflowCurrent();
    const receipt = applyUserCleanup(plan, {
      cwd: root,
      authorization: `agentic-os:user-cleanup:${plan.planDigest}`,
      stopped: true,
      now,
      api,
      resolvePolicy,
      observeRemote: () => `${current.canonical}\trefs/heads/main`,
    });
    out(JSON.stringify(receipt));
    return 0;
  } catch (error) {
    err(`${error.reason ?? 'blocked-release-common-local-cleanup'}: ${error.message}`);
    return 1;
  }
}

export async function runReleaseCommonCompleteWait({
  root,
  argv,
  profile,
  protectedBranch = branchFromLocalRef(profile?.canonical?.localRef),
  once = false,
  out = (line) => process.stdout.write(`${line}\n`),
  err = (line) => process.stderr.write(`${line}\n`),
  observeReview = ({ ref, head }, { remainingMs }) => observeGitHubReview({
    ref, expectedHead: head, profile, cwd: root,
    provider: (args, options) => gh(args, { ...options, timeoutMs: Math.max(1, Math.min(15_000, remainingMs())) }),
  }),
} = {}) {
  try {
    const ref = option(argv, 'ref');
    const timeoutMs = Number(option(argv, 'timeout-ms', '60000'));
    const binding = resolveReleaseCommonCompleteBinding(root, ref, protectedBranch);
    const result = await watchReleaseCommonReview(binding, {
      timeoutMs, once,
      observeReview,
      emit: (event) => out(JSON.stringify(event)),
    });
    if (result.code === 1) {
      err(`blocked-release-common-complete-review: ${result.reason}`);
    } else if (result.code === 2) {
      err('verified-wait-release-common-complete: exact review is still pending; continue independent work, or report the dependency and yield.');
    }
    return result.code;
  } catch (error) {
    err(`${error.reason ?? 'blocked-release-common-complete'}: ${error.message}`);
    return 1;
  }
}

/** One bounded pass over registered immediate children; existing owners govern every effect. */
export async function runProgressiveCompletion({ root, directory, timeoutMs = 60_000, policy, profile, complete,
  out = line => process.stdout.write(`${line}\n`), now = () => performance.now(),
  inventory = worktreeInventory, record = get, status = inspectCompletionStatus,
} = {}) {
  integer(timeoutMs, 1, 60_000, 'timeout-ms');
  if (currentBranch(root) !== policy.protectedBranch || !isAbsolute(directory)
    || realpathSync(directory) !== resolve(directory)) fail('blocked-progressive-completion-scope',
    'Use canonical main and one absolute directory without symbolic links');
  directory = resolve(directory);
  const targets = inventory(root).filter(row => row.path !== root && dirname(row.path) === directory)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (targets.length > 32) fail('blocked-progressive-completion-budget', 'Select at most 32 registered worktrees');
  const deadline = now() + timeoutMs, results = [];
  for (const target of targets) {
    let result = { path: target.path, ref: target.branch, head: target.head, status: 'blocked', reason: null };
    try {
      const remaining = Math.ceil(deadline - now());
      const bound = remaining > 0 && isLaneRef(target.branch) ? record(target.branch, root) : null;
      if (remaining <= 0) result = { ...result, status: 'deferred', reason: 'pass-budget' };
      else if (!bound || !COMPLETE_STATES.has(bound.state)) result.reason = 'requires-published-lane';
      else if (bound.head !== target.head || bound.worktree !== target.path) result.reason = 'lane-binding-drift';
      else {
        const guard = () => {
          const fresh = inventory(root).find(row => row.path === target.path), current = record(target.branch, root);
          if (!fresh || fresh.branch !== target.branch || fresh.head !== target.head || fresh.locked || fresh.prunable
            || current?.head !== bound.head || current?.pr !== bound.pr || current?.worktree !== target.path)
            fail('worktree-binding-drift', 'Retain the changed worktree and reobserve its exact binding');
        };
        guard();
        {
          const code = await complete(target.branch, Math.min(60_000, remaining), guard);
          const settled = code === 0 ? status(root, target.branch, policy, profile) : null;
          result = { ...result, status: code === 2 ? 'waiting' : code === 0
            && settled?.closeout?.missionState === 'source_complete' ? 'source_complete' : 'blocked',
          reason: code === 2 ? 'review-pending' : code !== 0 ? 'completion-refused'
            : settled?.closeout?.missionState === 'source_complete' ? null : 'closeout-incomplete' };
        }
      }
    } catch (error) { result.reason = error.reason ?? error.message; }
    results.push(result);
    out(JSON.stringify({ schema: 'agentic-os/progressive-completion/v1', authority: false, event: 'worktree', ...result }));
  }
  const completed = results.filter(row => row.status === 'source_complete').length;
  out(JSON.stringify({ schema: 'agentic-os/progressive-completion/v1', authority: false, event: 'summary',
    selected: targets.length, completed, remaining: targets.length - completed, results }));
  return results.some(row => row.status === 'blocked') ? 1 : completed === targets.length ? 0 : 2;
}
