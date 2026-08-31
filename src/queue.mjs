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

/** Run gh and parse JSON. Returns null on any failure; callers report drift. */
export function gh(args, { cwd = process.cwd(), json = true } = {}) {
  try {
    const out = execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return json ? JSON.parse(out || 'null') : out.trim();
  } catch {
    return null;
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
      '{allow_squash_merge,allow_merge_commit,allow_rebase_merge,delete_branch_on_merge}',
    ],
    { cwd },
  );
  const rulesets = gh(['api', 'repos/:owner/:repo/rulesets'], { cwd }) ?? [];
  const protection = gh(
    ['api', `repos/:owner/:repo/branches/${PROTECTED_BRANCH}/protection`],
    { cwd },
  );

  const queueRuleset = findQueueRuleset(rulesets, { cwd });
  const prArgs = ['pr', 'list', '--state', 'open', '--json', 'number,headRefName'];
  const openPrs = gh(prArgs, { cwd }) ?? [];

  return {
    available: true,
    repo: repo?.nameWithOwner ?? null,
    merge,
    strict: protection?.required_status_checks?.strict ?? null,
    requiredChecks: protection?.required_status_checks?.contexts ?? [],
    queueEnabled: Boolean(queueRuleset),
    queueRuleset,
    openPrs,
  };
}

/** A ruleset carrying a merge_queue rule, with its parameters expanded. */
export function findQueueRuleset(rulesets, { cwd = process.cwd() } = {}) {
  for (const summary of rulesets) {
    const full = gh(['api', `repos/:owner/:repo/rulesets/${summary.id}`], { cwd });
    const rule = full?.rules?.find((entry) => entry.type === 'merge_queue');
    if (rule) return { id: summary.id, name: full.name, parameters: rule.parameters ?? {} };
  }
  return null;
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

  if (state.queueEnabled) pass('merge-queue', `enabled by ruleset "${state.queueRuleset.name}"`);
  else fail('merge-queue', 'no merge_queue rule on the protected branch', 'npm run queue:apply');

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
        { type: 'merge_queue', parameters: { ...QUEUE_POLICY } },
        { type: 'deletion' },
        { type: 'non_fast_forward' },
      ],
    },
    protection: {
      strict: false,
      contexts: [...REQUIRED_CHECKS],
    },
    repository: {
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
      delete_branch_on_merge: true,
    },
  };
}

/** Apply the plan. Mutates shared branch protection, so it is never automatic. */
export function apply({ cwd = process.cwd() } = {}) {
  const desired = plan();
  const applied = [];

  const ruleset = ghWrite(
    ['api', '--method', 'POST', 'repos/:owner/:repo/rulesets', '--input', '-'],
    JSON.stringify(desired.ruleset),
    cwd,
  );
  applied.push({ step: 'ruleset', ok: Boolean(ruleset) });

  const repo = ghWrite(
    ['api', '--method', 'PATCH', 'repos/:owner/:repo', '--input', '-'],
    JSON.stringify(desired.repository),
    cwd,
  );
  applied.push({ step: 'repository', ok: Boolean(repo) });

  return applied;
}

/** gh with stdin, used only for the explicit apply path. */
export function ghWrite(args, input, cwd = process.cwd()) {
  try {
    const out = execFileSync('gh', args, {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch {
    return null;
  }
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
