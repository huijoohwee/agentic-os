/** Profile-driven GitHub protected-integration observation and handoff. */
import { git, gitLines, remoteTransport } from './git.mjs';
import { enqueue as providerEnqueue, gh, ghAvailable, isAbsentClassicProtection,
  lastError, lastHttpStatus } from './github-provider.mjs';
import { PROVIDER_CAPABILITIES, providerPolicy as resolveProviderPolicy } from './lane-state.mjs';
export { isAbsentClassicProtection, providerHttpStatus } from './github-provider.mjs';
export { PROVIDER_CAPABILITIES } from './lane-state.mjs';

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

export const REQUIRED_CHECKS = resolveProviderPolicy().requiredChecks;
export const providerPolicy = resolveProviderPolicy;
export function queuePolicyMatches(parameters) {
  return Object.entries(QUEUE_POLICY).every(([key, value]) => parameters?.[key] === value);
}
/** Fail-closed recognition of a ruleset that explicitly governs the configured branch. */
export function rulesetApplies(entry, defaultBranch = null, protectedBranch = 'main') {
  const refs = entry.conditions?.ref_name ?? {};
  const protectedRef = `refs/heads/${protectedBranch}`;
  const include = Array.isArray(refs.include) ? refs.include : [];
  const exclude = Array.isArray(refs.exclude) ? refs.exclude : [];
  const recognized = (value) => value === protectedRef
    || (value === '~DEFAULT_BRANCH' && defaultBranch === protectedBranch);
  return entry.enforcement === 'active'
    && entry.target === 'branch'
    && include.length > 0
    && include.every(recognized)
    && exclude.length === 0;
}
export function workflowHasMergeGroup(text) {
  const lines = text.split('\n').filter((line) => !/^\s*#/u.test(line));
  const start = lines.findIndex((line) => /^(?:on|["']on["'])\s*:/u.test(line));
  if (start < 0) return false;
  const inline = lines[start].replace(/^(?:on|["']on["'])\s*:\s*/u, '')
    .replace(/\s+#.*$/u, '').trim();
  if (inline === 'merge_group') return true;
  if (inline.startsWith('[') && inline.endsWith(']')) {
    const triggers = inline.slice(1, -1).split(',')
      .map((value) => value.trim().replace(/^["']|["']$/gu, ''));
    return triggers.includes('merge_group');
  }
  if (inline !== '') return false;
  return directBlockEntries(lines, start).some((entry) => entry.key === 'merge_group');
}
function directBlockEntries(lines, start) {
  const parentIndent = lines[start].match(/^\s*/u)[0].length, block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index], indentation = line.match(/^\s*/u)[0].length;
    if (line.trim() !== '' && indentation <= parentIndent) break;
    if (line.trim() !== '') block.push({ line, index, indentation });
  }
  const indent = Math.min(...block.map((entry) => entry.indentation));
  return block.filter((entry) => entry.indentation === indent).map((entry) => {
    const match = entry.line.trim().match(/^(?:["']?)([^:"']+)(?:["']?)\s*:\s*(.*)$/u);
    return match ? { ...entry, key: match[1], value: match[2] } : null;
  }).filter(Boolean);
}
export function workflowMergeGroupChecks(text) {
  if (!workflowHasMergeGroup(text)) return [];
  const lines = text.split('\n').filter((line) => !/^\s*#/u.test(line));
  const jobs = lines.findIndex((line) => /^(?:jobs|["']jobs["'])\s*:/u.test(line));
  if (jobs < 0) return [];
  return directBlockEntries(lines, jobs).flatMap((job) => {
    if (job.value !== '') return [];
    const fields = directBlockEntries(lines, job.index);
    if (fields.some((entry) => entry.key === 'if')) return [];
    const name = fields.find((entry) => entry.key === 'name')?.value?.replace(/\s+#.*$/u, '')
      .replace(/^(["'])(.*)\1$/u, '$2').trim();
    return [name ?? job.key];
  });
}

function protectedWorkflowSupportsMergeGroup(cwd, policy) {
  const contexts = new Set();
  for (const path of gitLines(
    ['ls-tree', '-r', '--name-only', policy.protectedRef, '--', '.github/workflows'], { cwd },
  )) {
    workflowMergeGroupChecks(git(['show', `${policy.protectedRef}:${path}`], { cwd }))
      .forEach((context) => contexts.add(context));
  }
  return policy.requiredChecks.every((context) => contexts.has(context));
}

function hostOf(value) {
  try { return new URL(value).host.toLowerCase(); } catch {
    return value.match(/^(?:[^@/]+@)?([^:/]+)(?::|\/)/u)?.[1]?.toLowerCase() ?? null;
  }
}

/** Observed provider state relevant to the livelock. Read-only. */
export function observe({
  cwd = process.cwd(), profile, provider = gh, providerAvailable = ghAvailable,
} = {}) {
  const policy = resolveProviderPolicy(profile);
  if (!providerAvailable()) return { available: false };

  const errors = [];
  const call = (args) => provider(args, { cwd });
  const remote = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
  const originUrl = remoteTransport(remote, cwd).fetchUrl;
  const repo = originUrl
    ? call(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,url', '--', originUrl])
    : null;
  const hostname = hostOf(repo?.url ?? '');
  const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo?.nameWithOwner ?? '')
    && hostname && hostname === hostOf(originUrl ?? '') ? repo.nameWithOwner : null;
  const repository = repositoryName ? `${hostname}/${repositoryName}` : null;
  if (!repository) errors.push('repository');
  if (profile && repository !== profile.repository) errors.push('configured-repository');
  const endpoint = (suffix = '') => `repos/${repositoryName}${suffix}`;
  const onHost = (args) => [...args, '--hostname', hostname];
  const merge = repository ? call(onHost(
    [
      'api',
      endpoint(),
      '--jq',
      '{allow_squash_merge,allow_merge_commit,allow_rebase_merge,delete_branch_on_merge,' +
        'allow_auto_merge,squash_merge_commit_title,squash_merge_commit_message}',
    ],
  )) : null;
  if (!merge) errors.push('merge-settings');
  const rulesetsResult = repository
    ? call(onHost(['api', endpoint('/rulesets'), '--method', 'GET', '-F', 'per_page=100'])) : null;
  const rulesets = Array.isArray(rulesetsResult) ? rulesetsResult : [];
  if (!Array.isArray(rulesetsResult)) errors.push('rulesets');
  if (rulesets.length === 100) errors.push('rulesets-pagination-boundary');
  const protection = repository
    ? call(onHost(['api', endpoint(`/branches/${policy.protectedBranch}/protection`)])) : null;
  const classicAbsent = !protection && isAbsentClassicProtection(lastHttpStatus, lastError);
  if (!protection && !classicAbsent) errors.push('classic-protection');

  const expanded = rulesets.length === 100 ? [] : expandRulesets(rulesets, {
    cwd, repository: repositoryName, hostname, provider,
  });
  if (expanded.length !== rulesets.length) errors.push('expanded-rulesets');
  const defaultBranch = repo?.defaultBranchRef?.name ?? null;
  const applicable = expanded.filter((entry) =>
    rulesetApplies(entry, defaultBranch, policy.protectedBranch));
  const queueRules = applicable.flatMap((entry) => entry.rules
    .filter((rule) => rule.type === 'merge_queue')
    .map((rule) => ({ ruleset: entry, rule })));
  const queueRuleset = queueRules[0]?.ruleset ?? null;
  const prArgs = ['pr', 'list', '--state', 'open', '--json', 'number,headRefName'];
  if (repository) prArgs.push('--repo', repository);
  const openPrs = repository ? call(prArgs) : null;
  if (!Array.isArray(openPrs)) errors.push('open-pull-requests');

  const allRules = applicable.flatMap((entry) => entry.rules);
  const checksRules = allRules.filter((rule) => rule.type === 'required_status_checks');
  const prRules = allRules.filter((rule) => rule.type === 'pull_request');
  const rulesetStrictValues = checksRules
    .map((rule) => rule.parameters?.strict_required_status_checks_policy)
    .filter((value) => typeof value === 'boolean');
  const rulesetStrict = rulesetStrictValues.includes(true)
    ? true
    : rulesetStrictValues.length > 0 ? false : null;
  const classicStrict = protection?.required_status_checks?.strict ?? null;
  const requiredChecks = [...new Set(checksRules.flatMap(
    (rule) => rule.parameters?.required_status_checks ?? [],
  ).map((entry) => entry.context).concat(
    protection?.required_status_checks?.contexts ?? [],
  ))];

  return {
    available: true,
    observationErrors: [...new Set(errors)],
    repo: repository,
    remoteUrl: originUrl,
    policy,
    merge,
    strict: (protection || classicAbsent) && expanded.length === rulesets.length
      ? (classicStrict === true || rulesetStrict === true
        ? true : classicStrict ?? rulesetStrict ?? false)
      : null,
    requiredChecks,
    autoMerge: Boolean(merge?.allow_auto_merge),
    pullRequestRequired: prRules.length > 0,
    linearHistoryRequired: allRules.some((rule) => rule.type === 'required_linear_history')
      || protection?.required_linear_history?.enabled === true,
    queueEnabled: queueRules.length > 0,
    queuePolicySatisfied: queueRules.length > 0
      && queueRules.every(({ rule }) => queuePolicyMatches(rule.parameters)),
    queueRuleset: queueRuleset ?? null,
    mergeGroupSupported: policy.mergeQueueRequired
      ? protectedWorkflowSupportsMergeGroup(cwd, policy) : null,
    openPrs: Array.isArray(openPrs) ? openPrs : null,
  };
}

/** Every active ruleset with its rules resolved. */
export function expandRulesets(rulesets, {
  cwd = process.cwd(), repository, hostname, provider = gh,
} = {}) {
  const expanded = [];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? '') || !hostname) return expanded;
  for (const summary of rulesets) {
    const full = provider([
      'api', `repos/${repository}/rulesets/${summary.id}`, '--hostname', hostname,
    ], { cwd });
    if (full) expanded.push({
      id: summary.id, name: full.name, target: full.target,
      enforcement: full.enforcement, conditions: full.conditions, rules: full.rules ?? [],
    });
  }
  return expanded;
}

/** Compare observed state with the capability-selected repository policy. */
export function audit(state, profile) {
  const policy = profile === undefined ? state.policy ?? resolveProviderPolicy()
    : resolveProviderPolicy(profile);
  const findings = [];
  const fail = (id, detail, remedy) => findings.push({ id, ok: false, detail, remedy });
  const pass = (id, detail) => findings.push({ id, ok: true, detail });

  if (!state.available) return [{
    id: 'gh', ok: false, detail: 'gh CLI not available', remedy: 'install gh, then gh auth login',
  }];

  if ((state.observationErrors ?? []).length === 0) pass('provider-observation', 'all provider facts observed');
  else fail('provider-observation', `unknown: ${state.observationErrors.join(', ')}`,
    'restore provider observation before relying on this report');

  if (!policy.mergeQueueRequired) {
    pass('merge-queue', 'not selected by repository profile');
  } else if (state.queueEnabled) {
    pass('merge-queue', `enabled by ruleset "${state.queueRuleset.name}"`);
  } else {
    fail(
      'merge-queue',
      'tested protected-branch ordering is unavailable; auto-merge is not equivalent',
      'enable a provider merge queue',
    );
  }

  if (!policy.mergeQueueRequired) pass('queue-policy', 'not selected by repository profile');
  else if (state.queuePolicySatisfied) pass('queue-policy', 'every applicable queue rule matches policy');
  else fail(
    'queue-policy',
    'an applicable queue rule is absent or has policy drift',
    'apply the reviewed repository-owned queue policy',
  );

  if (!policy.mergeQueueRequired) pass('auto-merge', 'not required without merge-queue ordering');
  else if (state.autoMerge) pass('auto-merge', 'auto-merge is allowed, so a lane can be armed and left');
  else fail('auto-merge', 'auto-merge is disabled; the queue rule also requires it',
    'ask repository authority to apply the reviewed provider policy');

  if (!policy.pullRequestRequired) pass('pull-request', 'not selected by repository profile');
  else if (state.pullRequestRequired) pass('pull-request', 'an applicable pull-request rule is active');
  else fail('pull-request', 'no applicable pull-request rule was observed',
    'ask repository authority to apply the reviewed pull-request policy');

  if (!policy.linearHistoryRequired) pass('linear-history', 'not selected by repository profile');
  else if (state.linearHistoryRequired) pass('linear-history', 'linear history is required');
  else fail('linear-history', 'linear history is not required',
    'ask repository authority to apply the reviewed provider policy');

  const strictId = policy.strict === true ? 'strict-on' : 'strict-off';
  if (policy.strict === null) {
    pass('strict-policy', 'strictness not selected by repository profile');
  } else if (state.strict === policy.strict) {
    pass(strictId, `require-branches-up-to-date is ${policy.strict ? 'on' : 'off'} as selected`);
  } else if (state.strict === null) {
    fail(strictId, 'require-branches-up-to-date is unknown', 'restore protection observation');
  } else if (policy.strict === false) {
    fail(
      strictId,
      'require-branches-up-to-date is ON, which forces the restack treadmill the queue replaces',
      'ask repository authority to apply the reviewed provider policy',
    );
  } else {
    fail(strictId, 'require-branches-up-to-date is off but the profile requires fresh-base checks',
      'apply the reviewed repository-owned strict-check policy');
  }

  const squashOnly =
    state.merge?.allow_squash_merge &&
    !state.merge.allow_merge_commit &&
    !state.merge.allow_rebase_merge;
  if (!policy.squashOnlyRequired) pass('squash-only', 'not selected by repository profile');
  else if (squashOnly) pass('squash-only', 'squash is the only merge method');
  else fail('squash-only', 'more than one merge method is allowed',
    'ask repository authority to apply the reviewed provider policy');

  if (state.merge?.delete_branch_on_merge === false) {
    pass('retain-on-merge', 'remote lane refs remain available for governed retirement');
  } else {
    fail('retain-on-merge', 'merge can delete a lane ref before a retirement receipt', 'disable automatic branch deletion');
  }

  const missingChecks = policy.requiredChecks.filter(
    (check) => !state.requiredChecks?.includes(check),
  );
  if (missingChecks.length === 0) {
    pass('required-checks', policy.requiredChecks.length === 0
      ? 'none selected by repository profile'
      : `${policy.requiredChecks.join(', ')} are required`);
  } else {
    fail(
      'required-checks',
      `not required: ${missingChecks.join(', ')}; the queue has nothing to gate a batch on`,
      'ask repository authority to apply the reviewed provider policy',
    );
  }

  if (!policy.mergeQueueRequired) pass('merge-group', 'not required without merge-queue ordering');
  else if (state.mergeGroupSupported) pass('merge-group', 'CI statically binds required jobs to merge groups');
  else fail('merge-group', 'CI has no merge_group trigger', 'add merge_group to protected CI');

  const openCount = Array.isArray(state.openPrs) ? state.openPrs.length : null;
  if (openCount === null) {
    fail('wip', 'open pull-request count is unknown', 'restore pull-request observation');
  } else if (openCount > 15) {
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
/** Desired provider policy, rendered as data for repository-authority review. */
export function plan(profile) {
  const policy = resolveProviderPolicy(profile);
  const rules = [
    ...(policy.pullRequestRequired ? [{
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    }] : []),
    ...(policy.requiredChecks.length > 0 ? [{
      type: 'required_status_checks',
      parameters: {
        ...(policy.strict === null ? {} : { strict_required_status_checks_policy: policy.strict }),
        required_status_checks: policy.requiredChecks.map((context) => ({ context })),
      },
    }] : []),
    ...(policy.mergeQueueRequired ? [{ type: 'merge_queue', parameters: { ...QUEUE_POLICY } }] : []),
    ...(policy.linearHistoryRequired ? [{ type: 'required_linear_history' }] : []),
    { type: 'deletion' },
    { type: 'non_fast_forward' },
  ];
  const repository = {
    delete_branch_on_merge: false,
    ...(policy.mergeQueueRequired ? { allow_auto_merge: true } : {}),
    ...(policy.squashOnlyRequired ? {
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
      squash_merge_commit_title: 'PR_TITLE',
      squash_merge_commit_message: 'PR_BODY',
    } : {}),
  };
  return {
    ruleset: {
      name: RULESET_NAME,
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: [`refs/heads/${policy.protectedBranch}`], exclude: [] } },
      rules,
    },
    repository,
  };
}

/** Candidate code cannot widen repository-owned provider policy. */
export function apply() {
  return [{
    step: 'repository-owned provider policy',
    ok: false,
    error: 'blocked-repository-owned-policy: apply the reviewed plan through repository authority',
  }];
}

export function enqueue(ref, options = {}) {
  return providerEnqueue(ref, { provider: gh, ...options });
}
