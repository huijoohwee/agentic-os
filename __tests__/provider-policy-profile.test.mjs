import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  PROVIDER_CAPABILITIES,
  QUEUE_POLICY,
  audit,
  effectivePullRequestMethods,
  observe,
  plan,
  providerBlockingReasons,
  providerPolicy,
  pullRequestPolicyMatches,
  queuePolicyMatches,
} from '../src/queue.mjs';

const CONTEXT = 'Integration Gate';

function repositoryProfile(capabilities = [], requiredChecks = [CONTEXT], branch = 'trunk') {
  return createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: `refs/heads/${branch}`,
      remoteRef: `refs/remotes/origin/${branch}`,
    },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    requiredChecks,
    capabilities,
  });
}

function finding(findings, id) {
  return findings.find((entry) => entry.id === id);
}

function providerState(overrides = {}) {
  return {
    available: true,
    observationErrors: [],
    strict: null,
    requiredChecks: [CONTEXT],
    merge: {
      allow_squash_merge: false,
      allow_merge_commit: true,
      allow_rebase_merge: true,
      delete_branch_on_merge: false,
    },
    queueEnabled: false,
    queuePolicySatisfied: false,
    pullRequestRequired: false,
    linearHistoryRequired: false,
    mergeGroupSupported: false,
    autoMerge: false,
    openPrs: [],
    ...overrides,
  };
}

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('repository profiles reject mismatched canonical branch identities', () => {
  assert.throws(() => createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/upstream/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  }), /same branch/u);
});

test('provider admission ignores unrelated source failures but requires retained lane refs', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-capability-selective-provider-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  runGit(cwd, 'init', '--quiet', '--initial-branch=release/v2');
  runGit(cwd, 'config', 'user.name', 'Fixture');
  runGit(cwd, 'config', 'user.email', 'fixture@example.invalid');
  runGit(cwd, 'commit', '--quiet', '--allow-empty', '--message', 'fixture');
  runGit(cwd, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  runGit(cwd, 'update-ref', 'refs/remotes/origin/release/v2', 'HEAD');
  const profile = repositoryProfile([PROVIDER_CAPABILITIES.PULL_REQUEST], [], 'release/v2');
  const provider = (args) => {
    if (args[0] === 'repo') return { nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'release/v2' }, url: 'https://github.com/owner/repo' };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return {
      allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true,
      delete_branch_on_merge: false,
    };
    if (args[1] === 'repos/owner/repo/rulesets') return null;
    if (args[1] === 'repos/owner/repo/branches/release%2Fv2/protection') return {
      required_pull_request_reviews: { required_approving_review_count: 1 },
    };
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.ok(state.observationErrors.includes('rulesets'));
  assert.deepEqual(state.blockingObservationErrors, []);
  assert.equal(state.handoffPolicySatisfied, true);
  assert.deepEqual(providerBlockingReasons({ ...state,
    merge: { ...state.merge, delete_branch_on_merge: true },
  }, providerPolicy(profile)), ['retain-on-merge']);
});

test('validated profiles project exact canonical and capability-selected provider policy', () => {
  const profile = repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST,
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
    PROVIDER_CAPABILITIES.LINEAR_HISTORY,
    PROVIDER_CAPABILITIES.SQUASH,
  ]);
  assert.deepEqual(providerPolicy(profile), {
    profileDigest: profile.profileDigest,
    protectedBranch: 'trunk',
    protectedRef: 'refs/remotes/origin/trunk',
    requiredChecks: [CONTEXT],
    pullRequestRequired: true,
    mergeQueueRequired: true,
    strict: false,
    linearHistoryRequired: true,
    squashOnlyRequired: true,
    retainOnMergeRequired: true,
  });

  const projected = plan(profile);
  assert.deepEqual(projected.ruleset.conditions.ref_name, {
    include: ['refs/heads/trunk'],
    exclude: [],
  });
  const byType = (type) => projected.ruleset.rules.find((rule) => rule.type === type);
  const providerOwned = (type) => projected.providerOwnedRules.find((rule) => rule.type === type);
  assert.equal(byType('pull_request'), undefined);
  assert.equal(byType('merge_queue'), undefined);
  assert.ok(byType('required_linear_history'));
  assert.equal(byType('required_status_checks'), undefined);
  assert.deepEqual(providerOwned('required_status_checks').constraints, [
    { parameter: 'required_status_checks', operator: 'containsAll',
      values: [{ context: CONTEXT }] },
    { parameter: 'strict_required_status_checks_policy', operator: 'equals', value: false },
  ]);
  assert.deepEqual(providerOwned('pull_request'), {
    type: 'pull_request',
    requiredParameters: [
      'required_approving_review_count', 'dismiss_stale_reviews_on_push',
      'require_code_owner_review', 'require_last_push_approval',
      'required_review_thread_resolution', 'allowed_merge_methods',
    ],
    constraints: [{ parameter: 'allowed_merge_methods', operator: 'effectiveNonemptySubsetOf',
      values: ['squash'] }],
  });
  assert.deepEqual(providerOwned('merge_queue').constraints, [{
    parameter: 'merge_method', operator: 'oneOf', values: ['SQUASH'],
  }]);
  assert.ok(providerOwned('merge_queue').requiredParameters.includes('max_entries_to_merge'));
  assert.equal(projected.repository.allow_squash_merge, true);
  assert.equal(projected.repository.allow_merge_commit, false);
  assert.equal(projected.repository.allow_rebase_merge, false);
  assert.equal(projected.repository.allow_auto_merge, true);
  assert.equal(projected.repository.delete_branch_on_merge, false);
  assert.throws(() => providerPolicy(repositoryProfile([
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
    PROVIDER_CAPABILITIES.STRICT,
  ])), /conflict|incompatible/u);
  assert.throws(() => providerPolicy(repositoryProfile([
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
  ])), /requires pull-request/u);
});

test('optional provider capabilities stay absent while retain-all remains mandatory', () => {
  const profile = repositoryProfile();
  const projected = plan(profile);
  const ruleTypes = projected.ruleset.rules.map((rule) => rule.type);
  for (const optional of ['pull_request', 'merge_queue', 'required_linear_history']) {
    assert.equal(ruleTypes.includes(optional), false, `${optional} must be capability-selected`);
  }
  assert.equal(
    projected.ruleset.rules.some((rule) => rule.type === 'required_status_checks'), false,
  );
  const checks = projected.providerOwnedRules.find(
    (rule) => rule.type === 'required_status_checks',
  );
  assert.deepEqual(checks.requiredParameters,
    ['strict_required_status_checks_policy', 'required_status_checks']);
  assert.deepEqual(checks.constraints, [{
    parameter: 'required_status_checks', operator: 'containsAll',
    values: [{ context: CONTEXT }],
  }]);
  assert.equal(projected.providerOwnedRules.some(
    (rule) => ['pull_request', 'merge_queue'].includes(rule.type)), false);
  for (const optional of [
    'allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'allow_auto_merge',
  ]) {
    assert.equal(optional in projected.repository, false, `${optional} must not be hardcoded`);
  }
  assert.equal(projected.repository.delete_branch_on_merge, false);

  const findings = audit(providerState(), profile);
  for (const optional of [
    'merge-queue', 'queue-policy', 'auto-merge', 'pull-request', 'linear-history',
    'strict-on', 'strict-off', 'squash-only', 'merge-group',
  ]) {
    assert.notEqual(finding(findings, optional)?.ok, false, `${optional} is not requested`);
  }
  assert.equal(finding(findings, 'required-checks').ok, true);
  assert.equal(finding(findings, 'retain-on-merge').ok, true);

  const unsafe = audit(providerState({
    merge: { ...providerState().merge, delete_branch_on_merge: true },
  }), profile);
  assert.equal(finding(unsafe, 'retain-on-merge').ok, false);
});

test('audit recomputes admission blockers from raw provider facts', () => {
  const profile = repositoryProfile([], []);
  const forgedProjection = providerState({
    identityBound: false,
    blockingObservationErrors: [],
  });
  const observation = finding(audit(forgedProjection, profile), 'provider-observation');
  assert.equal(observation.ok, false);
  assert.match(observation.detail, /repository-identity/u);
});

test('merge-queue ordering does not invent an unselected integration method or tuning policy', () => {
  const profile = repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST,
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
  ]);
  const policy = providerPolicy(profile);
  const projection = plan(profile);
  const queueRule = projection.providerOwnedRules.find((rule) => rule.type === 'merge_queue');
  assert.deepEqual(queueRule.constraints, []);
  assert.ok(queueRule.requiredParameters.includes('check_response_timeout_minutes'));
  const reviewRule = projection.providerOwnedRules.find((rule) => rule.type === 'pull_request');
  assert.deepEqual(reviewRule.constraints, []);
  assert.ok(reviewRule.requiredParameters.includes('allowed_merge_methods'));
  assert.equal(queuePolicyMatches({ merge_method: 'MERGE', max_entries_to_merge: 17 }, policy), true);
  assert.equal('allow_squash_merge' in projection.repository, false);
});

test('linear history accepts only provider methods that preserve linearity', () => {
  const profile = repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST,
    PROVIDER_CAPABILITIES.LINEAR_HISTORY,
  ]);
  const policy = providerPolicy(profile);
  assert.equal(queuePolicyMatches({ merge_method: 'MERGE' }, policy), false);
  assert.equal(queuePolicyMatches({ merge_method: 'REBASE' }, policy), true);
  assert.equal(queuePolicyMatches({ merge_method: 'SQUASH' }, policy), true);
  const review = plan(profile).providerOwnedRules.find((rule) => rule.type === 'pull_request');
  assert.deepEqual(review.constraints, [{
    parameter: 'allowed_merge_methods', operator: 'effectiveNonemptySubsetOf',
    values: ['rebase', 'squash'],
  }]);
  assert.equal(pullRequestPolicyMatches({ allowed_merge_methods: ['rebase'] }, policy), true);
  assert.equal(pullRequestPolicyMatches({ allowed_merge_methods: ['squash'] }, policy), true);
  assert.equal(pullRequestPolicyMatches({ allowed_merge_methods: ['rebase', 'squash'] }, policy), true);
  assert.equal(pullRequestPolicyMatches({ allowed_merge_methods: ['merge'] }, policy), false);
  const drift = audit(providerState({
    pullRequestRequired: true, pullRequestPolicySatisfied: false,
  }), profile);
  assert.equal(finding(drift, 'pull-request-policy').ok, false);
});

test('effective pull-request methods intersect repository and applicable rule constraints', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-effective-methods-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  runGit(cwd, 'init', '--quiet', '--initial-branch=trunk');
  runGit(cwd, 'config', 'user.name', 'Fixture');
  runGit(cwd, 'config', 'user.email', 'fixture@example.invalid');
  runGit(cwd, 'commit', '--quiet', '--allow-empty', '--message', 'fixture');
  runGit(cwd, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  runGit(cwd, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  const profile = repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST, PROVIDER_CAPABILITIES.SQUASH,
  ], []);
  const merge = {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: false,
  };
  const broadRule = { type: 'pull_request', parameters: {
    allowed_merge_methods: ['merge', 'squash', 'rebase'],
  } };
  assert.deepEqual(effectivePullRequestMethods(merge, [broadRule]), ['squash']);
  const provider = (args) => {
    if (args[0] === 'repo') return { nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'trunk' }, url: 'https://github.com/owner/repo' };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return merge;
    if (args[1] === 'repos/owner/repo/rulesets') return [{ id: 12 }];
    if (args[1] === 'repos/owner/repo/rulesets/12') return {
      name: 'broad review rule', target: 'branch', enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/trunk'], exclude: [] } },
      rules: [broadRule],
    };
    if (args[1] === 'repos/owner/repo/branches/trunk/protection') return {};
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.deepEqual(state.effectiveMergeMethods, ['squash']);
  assert.equal(state.pullRequestPolicySatisfied, true);
  assert.equal(state.handoffPolicySatisfied, true);
  assert.deepEqual(providerBlockingReasons(state, providerPolicy(profile)), []);
  assert.deepEqual(audit(state, profile).filter((entry) => !entry.ok), []);

  const incomplete = observe({
    cwd, profile,
    provider: (args) => {
      if (args[1] === 'repos/owner/repo/rulesets') return null;
      if (args[1] === 'repos/owner/repo/branches/trunk/protection') return {
        required_pull_request_reviews: { required_approving_review_count: 1 },
      };
      return provider(args);
    },
    providerAvailable: () => true,
  });
  assert.equal(incomplete.pullRequestPolicySatisfied, true,
    'repository settings alone appear compatible when hidden rules are unknown');
  assert.deepEqual(providerBlockingReasons(incomplete, providerPolicy(profile)),
    ['ruleset-observation']);
});

test('strict protection is selected independently of merge queue ordering', () => {
  const profile = repositoryProfile([PROVIDER_CAPABILITIES.STRICT]);
  const projected = plan(profile);
  const checks = projected.providerOwnedRules.find((rule) => rule.type === 'required_status_checks');
  assert.ok(checks.constraints.some((constraint) => constraint.parameter
    === 'strict_required_status_checks_policy' && constraint.value === true));
  assert.equal(projected.ruleset.rules.some((rule) => rule.type === 'merge_queue'), false);

  const findings = audit(providerState({ strict: true }), profile);
  assert.equal(finding(findings, 'strict-on').ok, true);
  assert.notEqual(finding(findings, 'merge-queue')?.ok, false);
});

test('tested ordering and strict-check policy reject an empty check gate', () => {
  assert.throws(() => providerPolicy(repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST,
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
  ], [])), /at least one required check/u);
  assert.throws(() => providerPolicy(repositoryProfile([
    PROVIDER_CAPABILITIES.STRICT,
  ], [])), /at least one required check/u);
});

test('profile checks and a slash-containing canonical ref drive provider observation', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-profile-provider-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  run('init', '--quiet', '--initial-branch=release/v2');
  run('config', 'user.name', 'Fixture');
  run('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(cwd, '.github', 'workflows', 'integration.yml'), [
    'on:',
    '  merge_group:',
    'jobs:',
    '  integration:',
    `    name: ${CONTEXT}`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: true',
    '',
  ].join('\n'));
  run('add', '.github/workflows/integration.yml');
  run('commit', '--quiet', '--message', 'fixture');
  run('remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  run('update-ref', 'refs/remotes/origin/release/v2', 'HEAD');

  const profile = repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST,
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
  ], [CONTEXT], 'release/v2');
  const calls = [];
  const provider = (args) => {
    calls.push(args);
    if (args[0] === 'repo') return {
      nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'release/v2' },
      url: 'https://github.com/owner/repo',
    };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return {
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
      delete_branch_on_merge: false,
      allow_auto_merge: true,
    };
    if (args[1] === 'repos/owner/repo/rulesets') return [{ id: 7 }];
    if (args[1] === 'repos/owner/repo/rulesets/7') return {
      name: 'release/v2 queue',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/release/v2'], exclude: [] } },
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: CONTEXT }],
          },
        },
        { type: 'merge_queue', parameters: { ...QUEUE_POLICY } },
      ],
    };
    if (args[1] === 'repos/owner/repo/branches/release%2Fv2/protection') return {
      required_pull_request_reviews: { required_approving_review_count: 2 },
    };
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };

  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.deepEqual(state.observationErrors, []);
  assert.deepEqual(state.requiredChecks, [CONTEXT]);
  assert.equal(state.queueEnabled, true);
  assert.equal(state.mergeGroupSupported, true);
  assert.equal(state.pullRequestRequired, true);
  assert.equal(state.pullRequestPolicySatisfied, true);
  assert.equal(state.handoffPolicySatisfied, true);
  assert.ok(calls.some(
    (args) => args[1] === 'repos/owner/repo/branches/release%2Fv2/protection',
  ));
  const missingStrict = observe({
    cwd, profile, provider: (args) => {
      const value = provider(args);
      if (args[1] !== 'repos/owner/repo/rulesets/7') return value;
      return { ...value, rules: value.rules.map((rule) => rule.type === 'required_status_checks'
        ? { ...rule, parameters: { required_status_checks: [{ context: CONTEXT }] } } : rule) };
    },
    providerAvailable: () => true,
  });
  assert.equal(missingStrict.strict, null);
  assert.ok(missingStrict.observationErrors.includes('required-status-checks-strict'));
});

test('an unrelated full ruleset page is nonblocking when no ruleset capability is selected', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-ruleset-boundary-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  runGit(cwd, 'init', '--quiet', '--initial-branch=trunk');
  runGit(cwd, 'config', 'user.name', 'Fixture');
  runGit(cwd, 'config', 'user.email', 'fixture@example.invalid');
  runGit(cwd, 'commit', '--quiet', '--allow-empty', '--message', 'fixture');
  runGit(cwd, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  runGit(cwd, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  const profile = repositoryProfile([], []);
  const rulesets = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
  let detailCalls = 0;
  const calls = [];
  const provider = (args) => {
    calls.push(args);
    if (args[0] === 'repo') return {
      nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'trunk' },
      url: 'https://github.com/owner/repo',
    };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return { delete_branch_on_merge: false };
    if (args[1] === 'repos/owner/repo/rulesets') return rulesets;
    if (/^repos\/owner\/repo\/rulesets\/\d+$/u.test(args[1] ?? '')) {
      detailCalls += 1;
      return {
        name: `ruleset ${detailCalls}`,
        target: 'branch',
        enforcement: 'disabled',
        conditions: { ref_name: { include: ['refs/heads/trunk'], exclude: [] } },
        rules: [],
      };
    }
    if (args[1] === 'repos/owner/repo/branches/trunk/protection') return {};
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };

  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.equal(detailCalls, 0, 'an incomplete page must not become a partial policy projection');
  assert.ok(state.observationErrors.includes('rulesets-pagination-boundary'));
  assert.deepEqual(state.blockingObservationErrors, []);
  const listCall = calls.find((args) => args[1] === 'repos/owner/repo/rulesets');
  assert.equal(listCall[listCall.indexOf('--method') + 1], 'GET');
  assert.ok(listCall.includes('per_page=100'));
  assert.equal(finding(audit(state, profile), 'provider-observation').ok, true);
});

test('provider-bound policy cannot be declared without a provider adapter', () => {
  for (const selected of [
    { capabilities: [PROVIDER_CAPABILITIES.PULL_REQUEST] },
    { capabilities: [PROVIDER_CAPABILITIES.STRICT] },
    { capabilities: [PROVIDER_CAPABILITIES.LINEAR_HISTORY] },
    { capabilities: [PROVIDER_CAPABILITIES.SQUASH] },
    { capabilities: [], requiredChecks: ['external check'] },
  ]) {
    assert.throws(() => createRepositoryProfile({
      repository: 'github.com/owner/repo',
      canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
      adapters: { repository: { id: 'git', version: '1' }, provider: null },
      ...selected,
    }), /require a provider adapter/u);
  }
});
