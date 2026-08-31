/**
 * Merge queue adapter. The queue is the only thing that decides what lands
 * next, so this module reads and writes provider configuration and enqueues a
 * lane. It never restacks, never force-pushes, and never merges directly.
 *
 * Provider access goes through the `gh` CLI, which already holds the operator's
 * credentials. No token is read, stored, or logged here.
 */

import { execFileSync } from 'node:child_process';
import { PROTECTED_BRANCH } from './worktree.mjs';

export const RULESET_NAME = 'ADLC merge queue';

/** Required queue shape. Batching is what turns N CI runs into N/max runs. */
export const QUEUE_POLICY = Object.freeze({
  merge_method: 'SQUASH',
  min_entries_to_merge: 1,
  max_entries_to_merge: 5,
  min_entries_to_merge_wait_minutes: 5,
  // Speculative builds ahead of the merge point. This is the merge train.
  max_entries_to_build: 5,
  grouping_strategy: 'ALLGREEN',
  check_response_timeout_minutes: 60,
});

export const REQUIRED_CHECKS = Object.freeze(['test', 'budgets']);

export function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Last provider error, so a failed call can be reported instead of guessed at. */
export let lastError = null;

/** Run gh and parse JSON. Returns null on any failure; callers report drift. */
export function gh(args, { cwd = process.cwd(), json = true, input } = {}) {
  try {
    const out = execFileSync('gh', args, {
      cwd,
      input,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    lastError = null;
    return json ? JSON.parse(out || 'null') : out.trim();
  } catch (error) {
    lastError = providerMessage(error);
    return null;
  }
}

/** Pull the useful sentence out of a gh failure. */
export function providerMessage(error) {
  const raw = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  if (!raw) return String(error.message ?? 'unknown provider error');
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const detail = (parsed.errors ?? [])
      .map((entry) => (typeof entry === 'string' ? entry : entry.message ?? ''))
      .filter(Boolean)
      .join('; ');
    return [parsed.message, detail].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return raw.split('\n').filter(Boolean).slice(0, 2).join(' ');
  }
}

/** Observed provider state relevant to the livelock. Read-only. */
export function observe({ cwd = process.cwd() } = {}) {
  if (!ghAvailable()) return { available: false };

  const repo = gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], { cwd });
  const merge = gh(
    [
      'api',
      'repos/:owner/:repo',
      '--jq',
      '{allow_squash_merge,allow_merge_commit,allow_rebase_merge,delete_branch_on_merge,allow_auto_merge}',
    ],
    { cwd },
  );
  const rulesets = gh(['api', 'repos/:owner/:repo/rulesets'], { cwd }) ?? [];
  const protection = gh(
    ['api', `repos/:owner/:repo/branches/${PROTECTED_BRANCH}/protection`],
    { cwd },
  );

  const expanded = expandRulesets(rulesets, { cwd });
  const queueRuleset = expanded.find((entry) =>
    entry.rules.some((rule) => rule.type === 'merge_queue'),
  );
  const prArgs = ['pr', 'list', '--state', 'open', '--json', 'number,headRefName'];
  const openPrs = gh(prArgs, { cwd }) ?? [];

  // Rules are looked up across every ruleset, not only the one holding the
  // queue rule, so a partially applied configuration reports honestly.
  const allRules = expanded.flatMap((entry) => entry.rules);
  const checksRule = allRules.find((rule) => rule.type === 'required_status_checks');
  const prRule = allRules.find((rule) => rule.type === 'pull_request');
  const rulesetStrict = checksRule?.parameters?.strict_required_status_checks_policy ?? null;
  const classicStrict = protection?.required_status_checks?.strict ?? null;

  return {
    available: true,
    repo: repo?.nameWithOwner ?? null,
    merge,
    // Either surface can impose require-up-to-date, so either one turning it on
    // is drift.
    strict: classicStrict === true || rulesetStrict === true ? true : classicStrict ?? rulesetStrict,
    requiredChecks: (checksRule?.parameters?.required_status_checks ?? [])
      .map((entry) => entry.context)
      .concat(protection?.required_status_checks?.contexts ?? []),
    autoMerge: Boolean(merge?.allow_auto_merge),
    pullRequestRequired: Boolean(prRule),
    queueEnabled: Boolean(queueRuleset),
    queueRuleset: queueRuleset ?? null,
    openPrs,
  };
}

/** Every active ruleset with its rules resolved. */
export function expandRulesets(rulesets, { cwd = process.cwd() } = {}) {
  const expanded = [];
  for (const summary of rulesets) {
    const full = gh(['api', `repos/:owner/:repo/rulesets/${summary.id}`], { cwd });
    if (full) expanded.push({ id: summary.id, name: full.name, rules: full.rules ?? [] });
  }
  return expanded;
}

/**
 * Findings against the required configuration. Each is the drift, the reason it
 * matters, and the exact remedy. Never applied automatically.
 */
export function audit(state) {
  const findings = [];
  const fail = (id, detail, remedy) => findings.push({ id, ok: false, detail, remedy });
  const pass = (id, detail) => findings.push({ id, ok: true, detail });

  if (!state.available) {
    return [
      {
        id: 'gh',
        ok: false,
        detail: 'gh CLI not available',
        remedy: 'install gh, then gh auth login',
      },
    ];
  }

  if (state.queueEnabled) {
    pass('merge-queue', `enabled by ruleset "${state.queueRuleset.name}"`);
  } else if (state.autoMerge && (state.requiredChecks?.length ?? 0) > 0 && state.strict !== true) {
    findings.push({
      id: 'merge-queue',
      ok: true,
      detail: 'no queue; ordering delegated to auto-merge (no batching, still no restacks)',
    });
  } else {
    fail('merge-queue', 'nothing owns landing order', 'npm run queue:apply');
  }

  if (state.autoMerge) pass('auto-merge', 'auto-merge is allowed, so a lane can be armed and left');
  else fail('auto-merge', 'auto-merge is disabled; the queue rule also requires it', 'npm run queue:apply');

  if (state.pullRequestRequired) pass('pull-request', 'direct pushes to the protected branch are blocked');
  else fail('pull-request', 'the protected branch accepts direct pushes', 'npm run queue:apply');

  if (state.strict === true) {
    fail(
      'strict-off',
      'require-branches-up-to-date is ON, which forces the restack treadmill the queue replaces',
      'npm run queue:apply',
    );
  } else {
    pass('strict-off', 'require-branches-up-to-date is off');
  }

  const squashOnly =
    state.merge?.allow_squash_merge &&
    !state.merge.allow_merge_commit &&
    !state.merge.allow_rebase_merge;
  if (squashOnly) pass('squash-only', 'squash is the only merge method');
  else fail('squash-only', 'more than one merge method is allowed', 'npm run queue:apply');

  if (state.merge?.delete_branch_on_merge) {
    pass('delete-on-merge', 'remote lane refs are deleted on merge');
  } else {
    fail('delete-on-merge', 'merged lane refs are retained', 'npm run queue:apply');
  }

  const missingChecks = REQUIRED_CHECKS.filter((check) => !state.requiredChecks?.includes(check));
  if (missingChecks.length === 0) {
    pass('required-checks', `${REQUIRED_CHECKS.join(', ')} are required`);
  } else {
    fail(
      'required-checks',
      `not required: ${missingChecks.join(', ')}; the queue has nothing to gate a batch on`,
      'npm run queue:apply',
    );
  }

  const openCount = state.openPrs.length;
  if (openCount > 15) {
    fail(
      'wip',
      `${openCount} open pull requests; drain cost grows with the square of this number`,
      'npm run reap, then land or close the remainder',
    );
  } else {
    pass('wip', `${openCount} open pull request(s)`);
  }

  return findings;
}

/** The exact mutation `queue apply` performs, as data, so it can be reviewed. */
export function plan() {
  return {
    ruleset: {
      name: RULESET_NAME,
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
          },
        },
        {
          type: 'required_status_checks',
          parameters: {
            // The ruleset spelling of "require branches up to date". Off, because
            // the queue tests ahead of the protected branch on its own.
            strict_required_status_checks_policy: false,
            required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
          },
        },
        { type: 'merge_queue', parameters: { ...QUEUE_POLICY } },
        { type: 'deletion' },
        { type: 'non_fast_forward' },
      ],
    },
    repository: {
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
      delete_branch_on_merge: true,
      // The merge_queue rule requires this, and so does arming a lane.
      allow_auto_merge: true,
    },
  };
}

const RULESET_POST = ['api', '--method', 'POST', 'repos/:owner/:repo/rulesets', '--input', '-'];
const REPO_PATCH = ['api', '--method', 'PATCH', 'repos/:owner/:repo', '--input', '-'];

/**
 * Apply the plan. Mutates shared branch protection, so it is never automatic.
 *
 * If the provider rejects the merge_queue rule, the remaining rules are applied
 * and the rejection is reported verbatim. A partial apply still removes the
 * livelock: pull requests required, require-up-to-date off, no force pushes.
 */
export function apply({ cwd = process.cwd() } = {}) {
  const desired = plan();
  const applied = [];

  const repo = gh(REPO_PATCH, { cwd, input: JSON.stringify(desired.repository) });
  applied.push({ step: 'repository settings', ok: Boolean(repo), error: repo ? null : lastError });

  const full = gh(RULESET_POST, { cwd, input: JSON.stringify(desired.ruleset) });
  if (full) {
    applied.push({ step: `ruleset "${RULESET_NAME}" with merge queue`, ok: true, error: null });
    return applied;
  }

  const queueError = lastError;
  const degraded = {
    ...desired.ruleset,
    rules: desired.ruleset.rules.filter((rule) => rule.type !== 'merge_queue'),
  };
  const partial = gh(RULESET_POST, { cwd, input: JSON.stringify(degraded) });
  applied.push({
    step: 'merge queue rule',
    ok: false,
    error: queueError,
    note: 'the provider refused this rule; enable the merge queue in repository settings',
  });
  applied.push({
    step: `ruleset "${RULESET_NAME}" without merge queue`,
    ok: Boolean(partial),
    error: partial ? null : lastError,
  });
  return applied;
}

/** Open a PR for a lane if none exists, then hand it to the queue. */
export function enqueue(ref, { cwd = process.cwd(), title } = {}) {
  const existing = gh(['pr', 'view', ref, '--json', 'number,state,url'], { cwd });
  if (!existing) {
    const create = ['pr', 'create', '--base', PROTECTED_BRANCH, '--head', ref, '--fill'];
    if (title) create.push('--title', title);
    gh(create, { cwd, json: false });
  }
  const merged = gh(['pr', 'merge', ref, '--squash', '--auto'], { cwd, json: false });
  const view = ['pr', 'view', ref, '--json', 'number,state,url,mergeStateStatus'];
  return { pr: gh(view, { cwd }), enqueued: merged !== null };
}
