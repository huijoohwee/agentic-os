/** Observe one published review until merge, then let existing closeout primitives run. */
import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { currentBranch, worktreeInventory } from '../src/git.mjs';
import { loadRepositoryProfile } from '../src/git-repository.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { gh, observeGitHubReview } from '../src/github-provider.mjs';
import { observe as observeProviderOrdering } from '../src/queue.mjs';
import { inferMergedReviewWorkflow, githubRead } from './agentic-os-cleanup-review.mjs';
import { applyUserCleanup, planUserCleanup } from './agentic-os-cleanup-user.mjs';
import { RECOVERY_MODE } from './agentic-os-cleanup-recovery.mjs';
import { inspectCompletionStatus } from './agentic-os-completion-status.mjs';
import { cleanupWorkflowContext, releaseCommonLocalCleanupPolicy, runReleaseCommonSuccessorComplete } from '../src/cleanup.mjs';
export { runReleaseCommonSuccessorComplete };
import { isLaneRef } from '../src/lane-id.mjs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createWorkflowEffectGuard } from './agentic-os-workflow.mjs';
import { get } from '../src/lane-records.mjs';
import { option } from './agentic-os-argv.mjs';
import { classifyPromotion } from './agentic-os-auxiliary.mjs';

export const RELEASE_COMMON_COMPLETE_SCHEMA = 'agentic-os/release-common-complete-observation/v1';
export const SOURCE_PROMOTION_SCHEMA = 'agentic-os/authorized-source-promotion/v1';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const promotionFail = (reason, message) => fail(`blocked-source-promotion-${reason}`, message);

export function validateSourcePromotionPlan(plan, { repository, ref, head, base, profileDigest, requiredChecks }) {
  const { digest: supplied, ...core } = plan ?? {};
  if (plan?.schema !== SOURCE_PROMOTION_SCHEMA || plan.repository !== repository
    || plan.ref !== ref || plan.head !== head || plan.base !== base || plan.profileDigest !== profileDigest
    || plan.method !== 'squash' || !['direct', 'auto'].includes(plan.mode ?? 'direct')
    || (plan.mode === 'auto' && (!plan.ordering || plan.ordering.autoMerge !== true
      || !['fresh-base', 'merge-queue'].includes(plan.ordering.mode)))
    || JSON.stringify(plan.requiredChecks) !== JSON.stringify([...requiredChecks].sort())
    || supplied !== digest(core))
    promotionFail('plan-binding', 'promotion plan does not match current repository, source, base, or required checks');
  return plan;
}

export function sourcePromotionChecks(checks, requiredChecks, { allowPending = false } = {}) {
  if (!Array.isArray(checks)) promotionFail('checks-unavailable', 'required check inventory is unavailable');
  const selected = [...requiredChecks].sort().map((name) => {
    const matches = checks.filter((check) => check.name === name && check.app?.slug === 'github-actions'
      && check.app?.id === 15368);
    const newest = matches.sort((a, b) => b.id - a.id)[0];
    if (!Number.isSafeInteger(newest?.id) || newest.id < 1)
      promotionFail('checks-incomplete', `required check ${name} is missing or has no exact run identity`);
    const pending = newest.conclusion === null && ['queued', 'in_progress'].includes(newest.status);
    if (newest.status !== 'completed' || newest.conclusion !== 'success') {
      if (!allowPending || !pending)
        promotionFail(pending ? 'checks-pending' : 'checks-failed',
          `required check ${name} is ${pending ? 'pending' : 'failed or missing'}`);
    }
    return { name, id: newest.id, status: newest.status, conclusion: newest.conclusion,
      startedAt: newest.started_at, completedAt: newest.completed_at ?? null };
  });
  return selected;
}

export function sourcePromotionCheckProgress(planned, observed) {
  const rank = { queued: 0, in_progress: 1, completed: 2 };
  if (!Array.isArray(planned) || !Array.isArray(observed) || planned.length !== observed.length)
    promotionFail('checks-changed', 'required check inventory changed; create a fresh plan');
  for (let index = 0; index < planned.length; index += 1) {
    const before = planned[index], after = observed[index];
    const queuedStart = before.status === 'queued' && before.startedAt === null
      && ['in_progress', 'completed'].includes(after.status) && Number.isFinite(Date.parse(after.startedAt));
    if (before.name !== after.name || before.id !== after.id
      || (before.startedAt !== after.startedAt && !queuedStart)
      || rank[before.status] === undefined || rank[after.status] === undefined
      || rank[after.status] < rank[before.status])
      promotionFail('checks-changed', 'required check run identity or progress changed; create a fresh plan');
    if (before.status === 'completed' && (before.conclusion !== after.conclusion
      || before.completedAt !== after.completedAt))
      promotionFail('checks-changed', 'completed required check evidence changed; create a fresh plan');
    if (after.status === 'completed' && after.conclusion !== 'success')
      promotionFail('checks-failed', `required check ${after.name} failed`);
  }
  return observed;
}

export function sourcePromotionOrdering(observation, profile) {
  const requiredChecks = [...profile.requiredChecks].sort();
  const visibleChecks = [...(observation?.requiredChecks ?? [])].sort();
  const queueSelected = profile.capabilities?.includes('tested-protected-ordering:merge-queue') === true;
  const mode = observation?.strict === true ? 'fresh-base'
    : queueSelected && observation?.queueEnabled === true && observation?.queuePolicySatisfied === true
      && observation?.mergeGroupSupported === true ? 'merge-queue' : null;
  if (!observation || observation.available !== true || observation.identityBound !== true
    || observation.repo !== profile.repository || observation.observationErrors?.length !== 0
    || observation.autoMerge !== true || !requiredChecks.every((check) => visibleChecks.includes(check)) || !mode)
    promotionFail('auto-merge-policy', 'pending checks require enabled auto-merge, exact required checks, and observed fresh-base or tested queue protection');
  return { repository: observation.repo, mode, strict: observation.strict, autoMerge: observation.autoMerge,
    requiredChecks: visibleChecks, queueEnabled: observation.queueEnabled,
    queuePolicySatisfied: observation.queuePolicySatisfied, mergeGroupSupported: observation.mergeGroupSupported };
}

export async function runSourcePromotion({ root, argv, profile,
  provider = (args, json = true) => gh(args, { cwd: root, json }), out = (line) => process.stdout.write(`${line}\n`),
  orderingObserver = (args) => observeProviderOrdering(args),
  now = Date.now } = {}) {
  const operation = argv[0];
  const api = (path) => {
    const result = provider(['api', path]);
    if (result === null || result === undefined) promotionFail('provider-unavailable', `provider read failed: ${path}`);
    return result;
  };
  const repository = profile.repository.replace(/^github.com\//u, '');
  if (operation === 'plan') {
    const ref = option(argv, 'ref');
    const protectedBranch = profile.canonical.localRef.replace('refs/heads/', '');
    if (!isLaneRef(ref) || currentBranch(root) !== protectedBranch)
      promotionFail('canonical-required', 'plan must run from canonical with one bound lane ref');
    const record = get(ref, root);
    const head = headSha(record?.head);
    if (!head || !Number.isSafeInteger(record?.pr)) promotionFail('lane-unpublished', 'lane has no exact published PR/head');
    const pull = api(`repos/${repository}/pulls/${record.pr}`);
    if (!pull || pull.state !== 'open' || pull.head?.sha !== head || pull.head?.repo?.full_name !== repository
      || pull.base?.repo?.full_name !== repository || pull.base?.ref !== protectedBranch)
      promotionFail('review-binding', 'PR is not open at the published source head and protected base');
    const checks = api(`repos/${repository}/commits/${head}/check-runs?filter=latest&per_page=100`);
    const requiredChecks = [...profile.requiredChecks].sort();
    if (!Number.isSafeInteger(checks?.total_count) || checks.total_count > 100 || !Array.isArray(checks.check_runs)
      || checks.total_count !== checks.check_runs.length) promotionFail('checks-incomplete', 'required check inventory is incomplete');
    let selected, mode = 'direct', ordering = null;
    try { selected = sourcePromotionChecks(checks.check_runs, requiredChecks, { allowPending: true }); }
    catch (error) {
      if (error.reason !== 'blocked-source-promotion-checks-failed') throw error;
      out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'blocked', reason: error.message, authority: false }));
      return 2;
    }
    if (selected.some((check) => check.status !== 'completed')) {
      try {
        ordering = sourcePromotionOrdering(orderingObserver({ cwd: root, profile }), profile);
        mode = 'auto';
      } catch (error) {
        if (error.reason !== 'blocked-source-promotion-auto-merge-policy') throw error;
        out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'waiting', reason: error.message, authority: false }));
        return 2;
      }
    }
    const base = pull.base.sha;
    if (!/^[0-9a-f]{40}$/u.test(base ?? '')) promotionFail('base-unavailable', 'protected base revision is unavailable');
    const authorityClass = classifyPromotion(root, base, head).class;
    const core = { schema: SOURCE_PROMOTION_SCHEMA, repository, ref, pr: pull.number, head, base,
      profileDigest: profile.profileDigest, authorityClass, requiredChecks, checks: selected, mode, ordering,
      method: 'squash', createdAt: now(), expiresAt: now() + 300_000 };
    const plan = { ...core, digest: digest(core) };
    out(JSON.stringify({ plan, confirmation: `sha256:${plan.digest}`, authority: false }));
    return 0;
  }
  if (operation !== 'apply') promotionFail('operation', 'promote requires plan or apply');
  const saved = jsonFile(option(argv, 'plan'), 65_536, 'source-promotion-plan');
  const plan = saved?.plan ?? saved;
  const token = option(argv, 'authorize');
  if (!token || token !== `sha256:${plan.digest}`) promotionFail('confirmation', 'exact plan confirmation is required');
  const protectedBranch = profile.canonical.localRef.replace('refs/heads/', '');
  if (currentBranch(root) !== protectedBranch)
    promotionFail('canonical-required', 'apply must run from canonical trusted runtime');
  const ref = plan.ref, record = get(ref, root), head = headSha(record?.head);
  if (head !== plan.head || record.pr !== plan.pr) promotionFail('head-changed', 'published lane head or PR changed');
  validateSourcePromotionPlan(plan, { repository, ref, head, base: plan.base, profileDigest: profile.profileDigest,
    requiredChecks: profile.requiredChecks });
  if (!Number.isSafeInteger(plan.expiresAt) || plan.expiresAt < now())
    promotionFail('plan-expired', 'promotion plan expired; create a fresh plan');
  const pull = api(`repos/${repository}/pulls/${plan.pr}`);
  if (pull?.state === 'closed' && pull?.merged === true && pull?.head?.sha === plan.head) {
    out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'already-merged', head: plan.head, authority: false }));
    return 0;
  }
  if (!pull || pull.number !== plan.pr || pull.state !== 'open' || pull.head?.sha !== plan.head
      || pull.head?.repo?.full_name !== repository || pull.base?.repo?.full_name !== repository
      || pull.base?.sha !== plan.base || pull.base?.ref !== protectedBranch)
    promotionFail('source-or-base-changed', 'PR source or protected base changed since planning');
  const checks = api(`repos/${repository}/commits/${plan.head}/check-runs?filter=latest&per_page=100`);
  if (!Number.isSafeInteger(checks?.total_count) || checks.total_count > 100 || !Array.isArray(checks.check_runs)
    || checks.total_count !== checks.check_runs.length) promotionFail('checks-incomplete', 'required check inventory is incomplete');
  let selected;
  try { selected = sourcePromotionChecks(checks.check_runs, plan.requiredChecks, { allowPending: plan.mode === 'auto' }); }
  catch (error) {
    if (error.reason !== 'blocked-source-promotion-checks-pending') throw error;
    out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'waiting', reason: error.message, authority: false }));
    return 2;
  }
  if (plan.mode === 'auto') sourcePromotionCheckProgress(plan.checks, selected);
  else if (JSON.stringify(selected) !== JSON.stringify(plan.checks))
    promotionFail('checks-changed', 'required check evidence changed; create a fresh plan');
  if (option(argv, 'authority-head') !== null && option(argv, 'authority-head') !== plan.head)
    promotionFail('authority-head', 'authority-head must exactly match candidate source');
  const promotion = classifyPromotion(root, plan.base, plan.head);
  if (promotion.class !== plan.authorityClass) promotionFail('authority-class-changed', 'candidate authority class changed; create a fresh plan');
  if (promotion.escalates === true && option(argv, 'authority-head') !== plan.head)
    promotionFail('authority-head-required', 'authority-controlling source requires --authority-head=<exact head>');
  // Github fences the head, while this immediate base recheck reduces (but cannot CAS-fence) base races.
  const before = api(`repos/${repository}/pulls/${plan.pr}`);
  if (before?.state !== 'open' || before?.head?.sha !== plan.head || before?.head?.repo?.full_name !== repository
      || before?.base?.repo?.full_name !== repository || before?.base?.sha !== plan.base)
    promotionFail('pre-effect-drift', 'source or base moved before the protected merge effect');
  if (plan.mode === 'auto') {
    const ordering = sourcePromotionOrdering(orderingObserver({ cwd: root, profile }), profile);
    if (JSON.stringify(ordering) !== JSON.stringify(plan.ordering))
      promotionFail('auto-merge-policy-changed', 'repository merge protection changed since planning');
  }
  try {
    provider(['pr', 'merge', String(plan.pr), '--repo', repository,
      ...(plan.mode === 'auto' ? ['--auto'] : []), '--squash', '--match-head-commit', plan.head], false);
  } catch {
    const observed = api(`repos/${repository}/pulls/${plan.pr}`);
    if (observed?.merged === true && observed?.head?.sha === plan.head) {
      out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'merged-after-uncertain-result', head: plan.head, authority: false }));
      return 0;
    }
    if (plan.mode === 'auto' && observed?.state === 'open' && observed?.auto_merge?.enabled_by)
      { out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'auto-merge-armed-after-uncertain-result', head: plan.head, authority: false })); return 0; }
    promotionFail('effect-unknown', 'merge result is uncertain; exact PR was reobserved and must not be retried blindly');
  }
  const merged = api(`repos/${repository}/pulls/${plan.pr}`);
  if (plan.mode === 'auto' && merged?.state === 'open' && merged?.head?.sha === plan.head
    && merged?.auto_merge?.enabled_by) {
    out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'auto-merge-armed', head: plan.head, authority: false }));
    return 0;
  }
  if (merged?.merged !== true || merged?.head?.sha !== plan.head)
    promotionFail('merge-unverified', 'merge command returned but exact source integration is not verified');
  out(JSON.stringify({ schema: SOURCE_PROMOTION_SCHEMA, state: 'merged', head: plan.head,
    mergeCommit: merged.merge_commit_sha ?? null, authority: false }));
  return 0;
}

const COMPLETE_STATES = new Set(['published', 'queued', 'integrated']);
const completionPriority = state => state === 'integrated' ? 0 : state === 'queued' ? 1 : state === 'published' ? 2 : 3;

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
    if (observation?.sourceHeadBound !== true || state !== 'OPEN') {
      return {
        code: 1,
        status: 'blocked',
        reason: observation?.sourceHeadBound !== true
          ? observation?.reason ?? 'review-unbound'
          : `review-state-${String(state ?? 'unknown').toLowerCase()}`,
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
    if (status.findings.some(item => item.code === 'lane-dirty-state-unknown'))
      fail('blocked-release-common-lane-state-unknown', 'recover or disposition missing checkout bytes before closeout');
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
    const cleanupOptions = {
      now,
      api,
      resolvePolicy,
      observeRemote: () => `${current.canonical}\trefs/heads/main`,
    };
    const plan = planUserCleanup({
      cwd: root,
      target: status.lane.path,
      pr,
      requiredChecks: [...current.requiredChecks].sort(),
      workflow,
      recovery: true,
    }, {
      ...cleanupOptions,
      maxContentEntries: current.limits.projectionEntryCeiling,
    });
    out(JSON.stringify(plan));
    assertWorkflowCurrent();
    const receipt = applyUserCleanup(plan, {
      cwd: root,
      authorization: `agentic-os:user-cleanup:${plan.planDigest}`,
      stopped: true,
      ...cleanupOptions,
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
    const status = inspectCompletionStatus(root, ref, { protectedBranch }, profile);
    if (status.findings.some(item => item.code === 'lane-dirty-state-unknown'))
      fail('blocked-release-common-lane-state-unknown', 'recover or disposition missing checkout bytes before waiting on review');
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
    .map(target => ({ target, bound: isLaneRef(target.branch) ? record(target.branch, root) : null }))
    .sort((a, b) => completionPriority(a.bound?.state) - completionPriority(b.bound?.state) || a.target.path.localeCompare(b.target.path));
  if (targets.length > 32) fail('blocked-progressive-completion-budget', 'Select at most 32 registered worktrees');
  const eligibleTarget = ({ target, bound }) => COMPLETE_STATES.has(bound?.state) && bound.head === target.head
    && bound.worktree === target.path && bound.recovery?.dirtyState !== 'unobservable-at-missing-path'
    && !target.locked && !target.prunable;
  let eligibleRemaining = targets.filter(eligibleTarget).length;
  const deadline = now() + timeoutMs, results = []; for (const { target, bound } of targets) {
    let result = { path: target.path, ref: target.branch, head: target.head, status: 'blocked', reason: null }; try {
      const remaining = Math.ceil(deadline - now());
      if (!bound || !COMPLETE_STATES.has(bound.state)) result.reason = 'requires-published-lane';
      else if (bound.recovery?.dirtyState === 'unobservable-at-missing-path') result.reason = 'lane-dirty-state-unknown';
      else if (target.locked || target.prunable || bound.head !== target.head || bound.worktree !== target.path)
        result.reason = target.locked || target.prunable ? 'worktree-not-completable' : 'lane-binding-drift';
      else if (remaining <= 0) result = { ...result, status: 'deferred', reason: 'pass-budget' };
      else {
        const guard = () => {
          const fresh = inventory(root).find(row => row.path === target.path), current = record(target.branch, root);
          if (!fresh || fresh.branch !== target.branch || fresh.head !== target.head || fresh.locked || fresh.prunable
            || current?.head !== bound.head || current?.pr !== bound.pr || current?.worktree !== target.path)
            fail('worktree-binding-drift', 'Retain the changed worktree and reobserve its exact binding');
        };
        guard();
        const code = await complete(target.branch, Math.min(60_000, Math.max(1, Math.ceil(remaining / Math.max(1, eligibleRemaining--)))), guard);
          const settled = code === 0 ? status(root, target.branch, policy, profile) : null;
          result = { ...result, status: code === 2 ? 'waiting' : settled?.closeout?.missionState === 'source_complete'
            ? ['delivery_pending', 'delivery_scope_pending'].includes(settled.closeout.adlcState)
              ? settled.closeout.adlcState : 'source_complete' : 'blocked',
          reason: code === 2 ? 'review-pending' : code !== 0 ? 'completion-refused'
            : settled?.closeout?.missionState === 'source_complete' ? null : 'closeout-incomplete' };
      }
    } catch (error) { result.reason = error.reason ?? error.message; }
    results.push(result);
    out(JSON.stringify({ schema: 'agentic-os/progressive-completion/v1', authority: false, event: 'worktree', ...result }));
  }
  const completed = results.filter(row => row.status === 'source_complete').length;
  out(JSON.stringify({ schema: 'agentic-os/progressive-completion/v1', authority: false, event: 'summary',
    selected: targets.length, completed, deliveryPending: results.filter(row => ['delivery_pending', 'delivery_scope_pending'].includes(row.status)).length, remaining: targets.length - completed, results }));
  return results.some(row => row.status === 'blocked') ? 1 : completed === targets.length ? 0 : 2;
}
