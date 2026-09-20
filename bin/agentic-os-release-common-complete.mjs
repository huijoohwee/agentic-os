/** Observe one published review until merge, then let existing closeout primitives run. */
import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { currentBranch } from '../src/git.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { observeGitHubReview } from '../src/github-provider.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
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
  timeoutMs = 300_000,
  initialMs = 5_000,
  maxMs = 60_000,
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
  integer(timeoutMs, 1, 10_800_000, 'timeout-ms');
  integer(initialMs, 1, 60_000, 'initial-ms');
  integer(maxMs, initialMs, 60_000, 'max-ms');

  const started = now();
  const deadline = started + timeoutMs;
  let polls = 0;
  let interval = initialMs;
  let previous = null;

  while (deadline - now() > 0) {
    const observation = await observeReview(binding);
    polls += 1;
    const review = observation?.review ?? null;
    const merged = observation?.sourceHeadBound === true && review?.state === 'MERGED';
    const state = typeof review?.state === 'string' ? review.state : null;
    const signature = JSON.stringify([
      observation?.sourceHeadBound === true,
      observation?.reason ?? null,
      state,
      review?.mergeStateStatus ?? null,
    ]);
    if (signature !== previous) {
      previous = signature;
      interval = initialMs;
      emit({
        schema: RELEASE_COMMON_COMPLETE_SCHEMA,
        event: 'review_changed',
        authority: false,
        ref: binding.ref,
        head: binding.head,
        pr: review?.number ?? binding.pr ?? null,
        state,
        mergeStateStatus: review?.mergeStateStatus ?? null,
        sourceHeadBound: observation?.sourceHeadBound === true,
        reason: observation?.reason ?? null,
        url: review?.url ?? null,
        polls,
        elapsedMs: Math.round(now() - started),
      });
    }
    if (merged) {
      emit({
        schema: RELEASE_COMMON_COMPLETE_SCHEMA,
        event: 'merged',
        authority: false,
        ref: binding.ref,
        head: binding.head,
        pr: review?.number ?? binding.pr ?? null,
        state: review.state,
        url: review.url ?? null,
        polls,
        elapsedMs: Math.round(now() - started),
        nextAction: 'run_close',
      });
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
    const remaining = Math.max(0, Math.ceil(deadline - now()));
    if (remaining === 0) break;
    const waitMs = Math.min(interval, remaining);
    emit({
      schema: RELEASE_COMMON_COMPLETE_SCHEMA,
      event: 'waiting',
      authority: false,
      ref: binding.ref,
      head: binding.head,
      pr: review?.number ?? binding.pr ?? null,
      state,
      url: review?.url ?? null,
      polls,
      elapsedMs: Math.round(now() - started),
      nextPollMs: waitMs,
      nextAction: 'reobserve_exact_review',
    });
    await sleep(waitMs);
    interval = Math.min(maxMs, interval * 2);
  }

  emit({
    schema: RELEASE_COMMON_COMPLETE_SCHEMA,
    event: 'timeout',
    authority: false,
    ref: binding.ref,
    head: binding.head,
    pr: binding.pr ?? null,
    polls,
    elapsedMs: Math.round(now() - started),
    recheckAfterMs: maxMs,
    nextAction: 'rerun_release_common_complete',
  });
  return { code: 2, status: 'timeout', reason: 'observation-window-elapsed',
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
  const planned = await planCompletionClose(root, ref, bundle);
  out(JSON.stringify(planned));
  const applied = await applyCompletionClose(root, ref, bundle, planned,
    planned.authorizationDigest, { stopped });
  out(JSON.stringify(applied));
  return 0;
}
export async function runReleaseCommonCompleteWait({
  root,
  argv,
  profile,
  protectedBranch = branchFromLocalRef(profile?.canonical?.localRef),
  out = (line) => process.stdout.write(`${line}\n`),
  err = (line) => process.stderr.write(`${line}\n`),
  observeReview = ({ ref, head }) => observeGitHubReview({ ref, expectedHead: head, profile, cwd: root }),
} = {}) {
  try {
    const ref = option(argv, 'ref');
    const timeoutMs = Number(option(argv, 'timeout-ms', '300000'));
    const binding = resolveReleaseCommonCompleteBinding(root, ref, protectedBranch);
    const result = await watchReleaseCommonReview(binding, {
      timeoutMs,
      observeReview,
      emit: (event) => out(JSON.stringify(event)),
    });
    if (result.code === 1) {
      err(`blocked-release-common-complete-review: ${result.reason}`);
    } else if (result.code === 2) {
      err('verified-wait-release-common-complete: exact review is still pending; re-run the same command later.');
    }
    return result.code;
  } catch (error) {
    err(`${error.reason ?? 'blocked-release-common-complete'}: ${error.message}`);
    return 1;
  }
}
