/** Profile-driven GitHub protected-integration observation and handoff. */
import { remoteTransport } from './git.mjs';
import { enqueue as providerEnqueue, gh, ghAvailable, isAbsentClassicProtection,
  lastError, lastHttpStatus } from './github-provider.mjs';
import {
  effectivePullRequestMethods,
  effectivePullRequestPolicyMatches,
  PROVIDER_CAPABILITIES,
  providerBlockingReasons,
  providerPolicy as resolveProviderPolicy,
  pullRequestPolicyMatches,
  QUEUE_POLICY,
  queuePolicyMatches,
  RULESET_SCOPE,
  rulesetApplies,
  rulesetScope,
} from './lane-state.mjs';
import { protectedWorkflowSupportsMergeGroup } from './protected-workflows.mjs';
export { isAbsentClassicProtection, providerHttpStatus } from './github-provider.mjs';
export { PROVIDER_CAPABILITIES } from './lane-state.mjs';
export {
  effectivePullRequestMethods,
  providerBlockingReasons,
  pullRequestPolicyMatches,
  QUEUE_POLICY,
  queuePolicyMatches,
  RULESET_SCOPE,
  rulesetApplies,
  rulesetScope,
} from './lane-state.mjs';
export {
  PROTECTED_WORKFLOW_LIMITS,
  protectedWorkflowSupportsMergeGroup,
  workflowHasMergeGroup,
  workflowMergeGroupChecks,
} from './protected-workflows.mjs';
export const RULESET_NAME = 'ADLC protected integration';
/** Queue invariant selected by the squash integration capability. */
const MERGE_QUEUE_PARAMETERS = Object.freeze([
  'merge_method', 'min_entries_to_merge', 'max_entries_to_merge',
  'min_entries_to_merge_wait_minutes', 'max_entries_to_build',
  'grouping_strategy', 'check_response_timeout_minutes',
]);
const PULL_REQUEST_PARAMETERS = Object.freeze([
  'required_approving_review_count', 'dismiss_stale_reviews_on_push',
  'require_code_owner_review', 'require_last_push_approval',
  'required_review_thread_resolution', 'allowed_merge_methods',
]);
export const providerPolicy = resolveProviderPolicy;
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
  const transport = remoteTransport(remote, cwd), selectedRemoteUrl = transport.fetchUrl;
  const repo = selectedRemoteUrl
    ? call(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,url', '--', selectedRemoteUrl])
    : null;
  const hostname = hostOf(repo?.url ?? '');
  const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo?.nameWithOwner ?? '')
    && hostname && hostname === hostOf(selectedRemoteUrl ?? '') ? repo.nameWithOwner : null;
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
    ? call(onHost(['api', endpoint(
      `/branches/${encodeURIComponent(policy.protectedBranch)}/protection`,
    )])) : null;
  const classicAbsent = !protection && isAbsentClassicProtection(lastHttpStatus, lastError);
  if (!protection && !classicAbsent) errors.push('classic-protection');
  const expanded = rulesets.length === 100 ? [] : expandRulesets(rulesets, {
    cwd, repository: repositoryName, hostname, provider,
  });
  if (expanded.length !== rulesets.length) errors.push('expanded-rulesets');
  const defaultBranch = repo?.defaultBranchRef?.name ?? null;
  const scoped = expanded.map((entry) => ({ entry,
    scope: rulesetScope(entry, defaultBranch, policy.protectedBranch) }));
  const unknownRulesetScope = scoped.some(({ scope }) => scope === RULESET_SCOPE.UNKNOWN);
  if (unknownRulesetScope) errors.push('ruleset-scope');
  const applicable = scoped.filter(({ scope }) => scope === RULESET_SCOPE.APPLICABLE)
    .map(({ entry }) => entry);
  const queueRules = applicable.flatMap((entry) => entry.rules
    .filter((rule) => rule.type === 'merge_queue')
    .map((rule) => ({ ruleset: entry, rule })));
  const queueRuleset = queueRules[0]?.ruleset ?? null;
  const prArgs = ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName'];
  if (repository) prArgs.push('--repo', repository);
  const openPrs = repository ? call(prArgs) : null;
  const allRules = applicable.flatMap((entry) => entry.rules);
  const checksRules = allRules.filter((rule) => rule.type === 'required_status_checks');
  const prRules = allRules.filter((rule) => rule.type === 'pull_request');
  const malformedStrictRule = checksRules.some((rule) =>
    typeof rule.parameters?.strict_required_status_checks_policy !== 'boolean');
  if (malformedStrictRule) errors.push('required-status-checks-strict');
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
  let mergeGroupSupported = null;
  if (policy.mergeQueueRequired) {
    try { mergeGroupSupported = protectedWorkflowSupportsMergeGroup(cwd, policy); } catch {
      errors.push('protected-workflows');
    }
  }
  const strict = malformedStrictRule ? null
    : (protection || classicAbsent) && expanded.length === rulesets.length
      ? (classicStrict === true || rulesetStrict === true
        ? true : classicStrict ?? rulesetStrict ?? false)
      : null;
  const classicPullRequestRequired = protection?.required_pull_request_reviews != null;
  const pullRequestRequired = classicPullRequestRequired || prRules.length > 0;
  const linearHistoryRequired = allRules.some((rule) => rule.type === 'required_linear_history')
    || protection?.required_linear_history?.enabled === true;
  const effectiveMergeMethods = effectivePullRequestMethods(merge, prRules, {
    linearHistoryRequired,
  });
  const pullRequestPolicySatisfied = pullRequestRequired
    && effectivePullRequestPolicyMatches(effectiveMergeMethods, policy);
  const squashOnly = merge?.allow_squash_merge === true
    && merge.allow_merge_commit === false && merge.allow_rebase_merge === false;
  const queueEnabled = queueRules.length > 0;
  const queuePolicySatisfied = queueEnabled
    && queueRules.every(({ rule }) => queuePolicyMatches(rule.parameters, policy));
  const handoffPolicySatisfied = merge?.delete_branch_on_merge === false
    && (!policy.pullRequestRequired || pullRequestRequired && pullRequestPolicySatisfied)
    && (!policy.linearHistoryRequired || linearHistoryRequired)
    && (!policy.squashOnlyRequired || squashOnly)
    && (policy.strict === null || strict === policy.strict)
    && policy.requiredChecks.every((check) => requiredChecks.includes(check))
    && (!policy.mergeQueueRequired || queueEnabled && queuePolicySatisfied);
  const state = {
    available: true,
    observationErrors: [...new Set(errors)],
    repo: repository,
    remoteUrl: transport.displayUrl,
    remoteUrlDigest: transport.urlDigest,
    policy,
    merge,
    strict,
    requiredChecks,
    autoMerge: Boolean(merge?.allow_auto_merge),
    pullRequestRequired,
    pullRequestPolicySatisfied,
    effectiveMergeMethods,
    linearHistoryRequired,
    queueEnabled,
    queuePolicySatisfied,
    handoffPolicySatisfied,
    unknownRulesetScope,
    queueRuleset: queueRuleset ?? null,
    mergeGroupSupported,
    openPrs: Array.isArray(openPrs) ? openPrs : null,
    openPrsTruncated: Array.isArray(openPrs) && openPrs.length === 100,
  };
  const identityBound = repository === profile.repository;
  const blockingObservationErrors = providerBlockingReasons({ ...state, identityBound }, policy);
  return { ...state, identityBound,
    handoffPolicySatisfied: handoffPolicySatisfied
      && !blockingObservationErrors.includes('ruleset-observation'),
    blockingObservationErrors };
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
  const policy = profile === undefined ? state.policy : resolveProviderPolicy(profile);
  if (!policy) throw new TypeError('audit requires an observed or explicit repository policy');
  const findings = [];
  const fail = (id, detail, remedy) => findings.push({ id, ok: false, detail, remedy });
  const pass = (id, detail) => findings.push({ id, ok: true, detail });
  if (!state.available) return [{
    id: 'gh', ok: false, detail: 'gh CLI not available', remedy: 'install gh, then gh auth login',
  }];
  // Raw observed facts are authoritative; a supplied derived projection cannot waive blockers.
  const blockingErrors = providerBlockingReasons(state, policy);
  if (blockingErrors.length === 0) pass('provider-observation', 'all selected provider facts observed');
  else fail('provider-observation', `unknown: ${blockingErrors.join(', ')}`,
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
  else if (state.pullRequestRequired) pass('pull-request', 'applicable pull-request protection is active');
  else fail('pull-request', 'no applicable pull-request rule was observed',
    'ask repository authority to apply the reviewed pull-request policy');

  if (!policy.pullRequestRequired || !policy.linearHistoryRequired && !policy.squashOnlyRequired)
    pass('pull-request-policy', 'no merge-method constraint selected');
  else if (state.pullRequestPolicySatisfied)
    pass('pull-request-policy', 'allowed merge methods satisfy the selected constraint');
  else fail('pull-request-policy', 'allowed merge methods conflict with selected history policy',
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
  const countDetail = openCount === null ? 'open pull-request telemetry unavailable'
    : `${state.openPrsTruncated ? 'at least ' : ''}${openCount} open pull request(s) observed`;
  pass('wip', `${countDetail}; no universal count limit applies`);

  return findings;
}
/** Desired provider policy, rendered as data for repository-authority review. */
export function plan(profile) {
  const policy = resolveProviderPolicy(profile);
  const rules = [
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
    } : {}),
  };
  return {
    schema: 'agentic-os/github-policy-projection/v2',
    ruleset: {
      name: RULESET_NAME,
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: [`refs/heads/${policy.protectedBranch}`], exclude: [] } },
      rules,
    },
    repository,
    providerOwnedRules: [
      ...(policy.requiredChecks.length > 0 ? [{
        type: 'required_status_checks',
        requiredParameters: ['strict_required_status_checks_policy', 'required_status_checks'],
        constraints: [
          { parameter: 'required_status_checks', operator: 'containsAll',
            values: policy.requiredChecks.map((context) => ({ context })) },
          ...(policy.strict === null ? [] : [{
            parameter: 'strict_required_status_checks_policy', operator: 'equals',
            value: policy.strict,
          }]),
        ],
      }] : []),
      ...(policy.pullRequestRequired ? [{
        type: 'pull_request',
        requiredParameters: [...PULL_REQUEST_PARAMETERS],
        constraints: policy.squashOnlyRequired || policy.linearHistoryRequired ? [{
          parameter: 'allowed_merge_methods', operator: 'effectiveNonemptySubsetOf',
          values: policy.squashOnlyRequired ? ['squash'] : ['rebase', 'squash'],
        }] : [],
      }] : []),
      ...(policy.mergeQueueRequired ? [{
        type: 'merge_queue',
        requiredParameters: [...MERGE_QUEUE_PARAMETERS],
        constraints: policy.squashOnlyRequired || policy.linearHistoryRequired ? [{
          parameter: 'merge_method', operator: 'oneOf',
          values: policy.squashOnlyRequired ? ['SQUASH'] : ['REBASE', 'SQUASH'],
        }] : [],
      }] : []),
    ],
  };
}

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
