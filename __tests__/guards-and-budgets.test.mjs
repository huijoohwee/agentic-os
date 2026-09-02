import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OVERRIDE_ENV,
  protectedRefForRepository,
} from '../src/guard-main.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { violations as docViolations, BUDGET as DOC_BUDGET } from '../bin/agentic-os-doc-budget.mjs';
import {
  violations as moduleViolations,
  BUDGET as MODULE_BUDGET,
  FORBIDDEN_SUFFIXES,
} from '../bin/agentic-os-module-budget.mjs';
import {
  assertDevice, assertScope, deviceSegment, isLaneRef, laneRef, parseLaneRef,
} from '../src/lane-id.mjs';
import { REQUIRED_CONFIG } from '../bin/agentic-os-config.mjs';
import {
  PROVIDER_CAPABILITIES,
  QUEUE_POLICY,
  RULESET_SCOPE,
  apply,
  audit,
  enqueue,
  isAbsentClassicProtection,
  observe,
  plan,
  providerPolicy,
  providerHttpStatus,
  queuePolicyMatches,
  rulesetApplies,
  rulesetScope,
  workflowHasMergeGroup,
  workflowMergeGroupChecks,
} from '../src/queue.mjs';

function queueProfile(repository = 'github.com/owner/repo') {
  return createRepositoryProfile({
    repository,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' } },
    requiredChecks: ['test', 'budgets'],
    capabilities: Object.values(PROVIDER_CAPABILITIES)
      .filter((capability) => capability !== PROVIDER_CAPABILITIES.STRICT),
  });
}
const TEST_PROFILE = queueProfile();
const TEST_POLICY = providerPolicy(TEST_PROFILE);

test('pre-push rejects a lane update targeting profile canonical trunk', (t) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-pre-push-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', '--initial-branch=trunk'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  cpSync(join(projectRoot, 'src'), join(root, 'src'), { recursive: true });
  const profilePath = join(root, '.agentic-os.json');
  const committedProfile = createRepositoryProfile({
    repository: 'github.com/owner/repository',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/upstream/trunk',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(profilePath, `${JSON.stringify(committedProfile, null, 2)}\n`);
  execFileSync('git', ['add', '.agentic-os.json'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--message', 'profile'], { cwd: root });
  ensureRepositoryTrust(root, committedProfile, { allowCreate: true });
  assert.equal(protectedRefForRepository(root), 'refs/heads/trunk');

  writeFileSync(profilePath, `${JSON.stringify(createRepositoryProfile({
    repository: 'github.com/owner/repository',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/upstream/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  }), null, 2)}\n`);
  assert.equal(protectedRefForRepository(root), 'refs/heads/trunk');

  const hook = join(projectRoot, '.githooks/pre-push');
  const update = (destination) => [
    'refs/heads/agent/device/scope', 'a'.repeat(40), destination, '0'.repeat(40),
  ].join(' ') + '\n';
  const run = (destination, env = {}) => spawnSync(hook, ['upstream', 'provider-url'], {
    cwd: root,
    input: update(destination),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  const blocked = run('refs/heads/trunk');
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /refs\/heads\/trunk/u);
  assert.equal(run('refs/heads/main').status, 0);
  assert.equal(run('refs/heads/trunk', { [OVERRIDE_ENV]: '1' }).status, 0);

  execFileSync('git', ['rm', '--quiet', '--force', '.agentic-os.json'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--message', 'remove profile'], { cwd: root });
  assert.equal(protectedRefForRepository(root), 'refs/heads/trunk');
  const fallback = run('refs/heads/trunk');
  assert.equal(fallback.status, 1);
  assert.match(fallback.stderr, /refs\/heads\/trunk/u);
  assert.equal(run('refs/heads/main').status, 0);
});

test('lane refs round-trip and reject malformed scopes', () => {
  const ref = laneRef('pricing-table', 'box-1.local');
  assert.equal(ref, 'agent/box-1.local/pricing-table');
  assert.equal(isLaneRef(ref), true);
  assert.deepEqual(parseLaneRef(ref), { device: 'box-1.local', scope: 'pricing-table' });

  assert.equal(isLaneRef('main'), false);
  assert.equal(isLaneRef('agent/dev'), false);
  assert.throws(() => assertScope('Pricing_Table'));
  assert.throws(() => assertScope('-leading'));
  assert.throws(() => assertScope('b--c'));
  assert.throws(() => assertScope('a'.repeat(129)));
  assert.throws(() => assertDevice('../../outside'));
  assert.throws(() => laneRef('pricing-table', '../../outside'));
  for (const device of ['a..b', 'a--b', 'a.', 'a.lock']) {
    assert.throws(() => assertDevice(device));
    assert.equal(isLaneRef(`agent/${device}/pricing-table`), false);
  }
  assert.ok(deviceSegment('Hui.MacBook Pro').length > 0);
});

test('required git config contains only the profile-derived safety hook', () => {
  const keys = REQUIRED_CONFIG.map((entry) => entry.key);
  assert.deepEqual(keys, ['core.hooksPath']);
  for (const entry of REQUIRED_CONFIG) {
    assert.ok(entry.why.length > 10, `${entry.key} needs a stated reason`);
  }
});

test('an explicit profile projects only selected queue invariants and no tuning policy', () => {
  assert.equal(QUEUE_POLICY.merge_method, 'SQUASH');
  assert.deepEqual(Object.keys(QUEUE_POLICY), ['merge_method']);

  const projected = plan(TEST_PROFILE);
  const rules = projected.ruleset.rules;
  const byType = (type) => rules.find((rule) => rule.type === type);
  const providerOwned = (type) => projected.providerOwnedRules.find((rule) => rule.type === type);

  assert.ok(providerOwned('pull_request'), 'every change must go through a pull request');
  assert.equal(byType('required_status_checks'), undefined);
  const checkConstraints = providerOwned('required_status_checks').constraints;
  assert.ok(checkConstraints.some((constraint) => constraint.operator === 'containsAll'));
  assert.ok(checkConstraints.some((constraint) => constraint.parameter
    === 'strict_required_status_checks_policy' && constraint.value === false));
  assert.ok(providerOwned('merge_queue'), 'the queue rule is the whole point');
  assert.ok(byType('required_linear_history'), 'protected history must remain linear');
  assert.ok(byType('non_fast_forward'), 'history must not be rewritten');
  assert.equal(projected.repository.delete_branch_on_merge, false);
});

test('the audit refuses strict mode from either configuration surface', () => {
  const findings = audit({
    available: true,
    strict: true,
    requiredChecks: ['test', 'budgets'],
    merge: { allow_squash_merge: true, delete_branch_on_merge: true },
    queueEnabled: true,
    queueRuleset: { name: 'q' },
    openPrs: [],
  }, TEST_PROFILE);
  const strictFinding = findings.find((finding) => finding.id === 'strict-off');
  assert.equal(strictFinding.ok, false);
  assert.match(strictFinding.detail, /restack treadmill/);
});

test('the audit flags policy drift but treats review count as observation', () => {
  const findings = audit({
    available: true,
    strict: false,
    requiredChecks: [],
    merge: { allow_squash_merge: true, delete_branch_on_merge: true },
    queueEnabled: false,
    openPrs: Array.from({ length: 45 }, (_, index) => ({ number: index })),
  }, TEST_PROFILE);
  assert.equal(findings.find((finding) => finding.id === 'merge-queue').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'required-checks').ok, false);
  const wip = findings.find((finding) => finding.id === 'wip');
  assert.equal(wip.ok, true);
  assert.match(wip.detail, /45 open pull request\(s\) observed; no universal count limit applies/u);
  assert.equal(wip.remedy, undefined);
});

test('queue policy and strict mode fail closed across applicable rulesets', () => {
  assert.equal(queuePolicyMatches({ ...QUEUE_POLICY }, TEST_POLICY), true);
  assert.equal(queuePolicyMatches({ ...QUEUE_POLICY, merge_method: 'MERGE' }, TEST_POLICY), false);
  const findings = audit({
    available: true,
    strict: true,
    requiredChecks: ['test', 'budgets'],
    merge: { allow_squash_merge: true, allow_merge_commit: false,
      allow_rebase_merge: false, delete_branch_on_merge: true },
    queueEnabled: true,
    queuePolicySatisfied: false,
    queueRuleset: { name: 'drifted queue' },
    pullRequestRequired: true,
    linearHistoryRequired: false,
    mergeGroupSupported: true,
    autoMerge: true,
    openPrs: [],
  }, TEST_PROFILE);
  assert.equal(findings.find((finding) => finding.id === 'strict-off').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'queue-policy').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'linear-history').ok, false);
});

test('unknown policy facts fail while unavailable PR telemetry remains informational', () => {
  const findings = audit({
    available: true,
    observationErrors: ['rulesets'],
    strict: null,
    requiredChecks: [],
    merge: null,
    queueEnabled: false,
    queuePolicySatisfied: false,
    pullRequestRequired: false,
    linearHistoryRequired: false,
    mergeGroupSupported: false,
    openPrs: null,
  }, TEST_PROFILE);
  assert.equal(findings.find((finding) => finding.id === 'provider-observation').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'strict-off').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'wip').ok, true);
  assert.match(findings.find((finding) => finding.id === 'wip').detail, /telemetry unavailable/u);
});

test('only an active protected-main ruleset contributes ordering facts', () => {
  const base = { target: 'branch', enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } } };
  assert.equal(rulesetApplies(base, 'main', 'main'), true);
  assert.equal(rulesetApplies(base, 'trunk', 'main'), false);
  assert.equal(rulesetApplies({ ...base, enforcement: 'disabled' }, 'main', 'main'), false);
  assert.equal(rulesetApplies({ ...base,
    conditions: { ref_name: { include: ['refs/heads/other'], exclude: [] } } },
  'main', 'main'), false);
  assert.equal(rulesetApplies({ ...base,
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: ['refs/heads/m*'] } } },
  'main', 'main'), false);
  assert.equal(rulesetScope({ ...base,
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: ['refs/heads/m*'] } } },
  'main', 'main'), RULESET_SCOPE.UNKNOWN);
  assert.equal(rulesetScope({ ...base,
    conditions: { ref_name: { include: ['refs/heads/m*'], exclude: [] } } },
  'main', 'main'), RULESET_SCOPE.UNKNOWN);
  assert.equal(rulesetScope({ ...base,
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: ['refs/heads/other'] } } },
  'main', 'main'), RULESET_SCOPE.APPLICABLE);
  assert.equal(rulesetScope({ ...base,
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: ['refs/heads/main'] } } },
  'main', 'main'), RULESET_SCOPE.INAPPLICABLE);
  assert.equal(rulesetScope({ ...base,
    conditions: { ref_name: { include: ['refs/heads/m*'], exclude: ['refs/heads/main'] } } },
  'main', 'main'), RULESET_SCOPE.INAPPLICABLE);
  assert.equal(rulesetApplies({ ...base,
    conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/m*'], exclude: [] } } },
  'main', 'main'), true);
  assert.throws(() => rulesetApplies(base, 'main'), /explicit canonical branch/u);
});

test('merge-group detection is scoped to the top-level workflow trigger', () => {
  assert.equal(workflowHasMergeGroup('on:\n  pull_request:\n  merge_group:\n'), true);
  assert.equal(workflowHasMergeGroup('on: [push, pull_request, merge_group]\n'), true);
  assert.equal(workflowHasMergeGroup('"on": merge_group\n'), true);
  assert.equal(workflowHasMergeGroup('on :\n  merge_group :\n'), true);
  assert.equal(workflowHasMergeGroup('on: push # merge_group\n'), false);
  assert.equal(workflowHasMergeGroup('# on: merge_group\non: push\n'), false);
  assert.equal(workflowHasMergeGroup('on: push\njobs:\n  merge_group:\n'), false);
  assert.equal(workflowHasMergeGroup('on: merge_group\non: push\n'), false);
  assert.equal(workflowHasMergeGroup('on: merge_group\non : push\n'), false);
  assert.equal(workflowHasMergeGroup(
    'on:\n  workflow_call:\n    inputs:\n      merge_group:\n',
  ), false);
  assert.deepEqual(workflowMergeGroupChecks([
    'on:',
    '  merge_group:',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    strategy:',
    '      budgets:',
    '  budgets:',
    '    runs-on: ubuntu-latest',
  ].join('\n')), ['budgets']);
  assert.deepEqual(workflowMergeGroupChecks('on: merge_group\njobs:\n  other:\n'), ['other']);
  assert.deepEqual(workflowMergeGroupChecks(
    'on: merge_group\njobs:\n  test:\n  test:\n',
  ), []);
  assert.deepEqual(workflowMergeGroupChecks(
    'on: merge_group\njobs:\n  test:\n    name: test\n    strategy:\n      matrix: {}\n',
  ), []);
  assert.deepEqual(workflowMergeGroupChecks(
    'on : merge_group\njobs :\n  test :\n    runs-on: ubuntu-latest\n    if : false\n',
  ), []);
  assert.deepEqual(workflowMergeGroupChecks(
    'on: merge_group\njobs:\n  test:\n    runs-on: ubuntu-latest\n    !unsafe if: false\n',
  ), []);
  assert.deepEqual(workflowMergeGroupChecks([
    'on: merge_group',
    'jobs:',
    '  test:',
    '    name: not-test',
    '  budgets:',
    "    if: github.event_name != 'merge_group'",
  ].join('\n')), ['not-test']);
});

test('candidate code cannot mutate repository-owned provider policy', () => {
  assert.deepEqual(apply(), [{
    step: 'repository-owned provider policy',
    ok: false,
    error: 'blocked-repository-owned-policy: apply the reviewed plan through repository authority',
  }]);
});

test('a ruleset-only branch reports exact absence of classic protection', () => {
  const failure = { stderr: 'gh: Branch not protected (HTTP 404)\n' };
  const status = providerHttpStatus(failure);
  assert.equal(status, 404);
  assert.equal(isAbsentClassicProtection(status, 'Branch not protected'), true);
  assert.equal(isAbsentClassicProtection(404, 'Not Found'), false);
  assert.equal(isAbsentClassicProtection(403, 'Branch not protected'), false);
});

test('provider observation pins every call to the Git origin despite GH_REPO and GH_HOST', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const calls = [];
  const previous = process.env.GH_REPO;
  const previousHost = process.env.GH_HOST;
  process.env.GH_REPO = 'attacker/other';
  process.env.GH_HOST = 'example.invalid';
  try {
    const provider = (args) => {
      calls.push(args);
      if (args[0] === 'repo') {
        return { nameWithOwner: 'owner/repo', defaultBranchRef: { name: 'main' },
          url: 'https://github.com/owner/repo' };
      }
      if (args[0] === 'pr') return [];
      if (args[1] === 'repos/owner/repo') {
        return { allow_squash_merge: true, allow_merge_commit: false,
          allow_rebase_merge: false, delete_branch_on_merge: false };
      }
      if (args[1] === 'repos/owner/repo/rulesets') return [];
      if (args[1] === 'repos/owner/repo/branches/main/protection') return {};
      return assert.fail(`unbound provider target: ${args.join(' ')}`);
    };
    const state = observe({ cwd, profile: TEST_PROFILE, provider, providerAvailable: () => true });
    assert.equal(state.repo, 'github.com/owner/repo');
    assert.deepEqual(state.observationErrors, []);
    const repoView = calls.find((args) => args[0] === 'repo');
    assert.ok(repoView.includes('--'));
    for (const args of calls.filter((entry) => entry[0] === 'api')) {
      assert.match(args[1], /^repos\/owner\/repo(?:\/|$)/u);
      assert.doesNotMatch(args[1], /:owner|:repo/u);
      assert.equal(args[args.indexOf('--hostname') + 1], 'github.com');
    }
    const prList = calls.find((args) => args[0] === 'pr');
    assert.equal(prList[prList.indexOf('--repo') + 1], 'github.com/owner/repo');
  } finally {
    if (previous === undefined) delete process.env.GH_REPO;
    else process.env.GH_REPO = previous;
    if (previousHost === undefined) delete process.env.GH_HOST;
    else process.env.GH_HOST = previousHost;
  }
});

test('provider observation retains a non-default GitHub Enterprise port', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-ghe-port-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  run('init', '--quiet', '--initial-branch=main');
  run('config', 'user.name', 'Fixture');
  run('config', 'user.email', 'fixture@example.invalid');
  run('commit', '--quiet', '--allow-empty', '-m', 'base');
  run('update-ref', 'refs/remotes/origin/main', 'HEAD');
  run('remote', 'add', 'origin', 'https://ghe.example:8443/owner/repo.git');
  const calls = [];
  const provider = (args) => {
    calls.push(args);
    if (args[0] === 'repo') return { nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'main' }, url: 'https://ghe.example:8443/owner/repo' };
    if (args[0] === 'pr') return [];
    if (args[1].endsWith('/rulesets')) return [];
    return {};
  };
  const state = observe({ cwd, profile: queueProfile('ghe.example:8443/owner/repo'),
    provider, providerAvailable: () => true });
  assert.equal(state.repo, 'ghe.example:8443/owner/repo');
  for (const args of calls.filter((entry) => entry[0] === 'api')) {
    assert.equal(args[args.indexOf('--hostname') + 1], 'ghe.example:8443');
  }
  const pr = calls.find((args) => args[0] === 'pr');
  assert.equal(pr[pr.indexOf('--repo') + 1], 'ghe.example:8443/owner/repo');
});

test('provider handoff succeeds only from exact externally observed tested ordering', () => {
  const head = 'a'.repeat(40);
  let created = false;
  const providerCalls = [];
  const review = () => ({
    number: 7,
    state: 'OPEN',
    url: 'https://github.com/owner/repo/pull/7',
    mergeStateStatus: 'BLOCKED',
    headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' },
    isCrossRepository: false,
    body: `Lane: agent/device/scope\nSource-Head: ${head}`,
    autoMergeRequest: null,
  });
  const provider = (args) => {
    providerCalls.push(args);
    if (args[1] === 'list') return created ? [review()] : [];
    if (args[1] === 'view') {
      if (!created) return null;
      return review();
    }
    if (args[1] === 'create') { created = true; return ''; }
    if (args[1] === 'merge') return assert.fail('the adapter must never arm ordering');
    if (args[0] === 'api' && args[1] === 'graphql') {
      return { data: { resource: {
        number: 7, state: 'OPEN', url: 'https://github.com/owner/repo/pull/7', headRefOid: head,
        headRefName: 'agent/device/scope',
        baseRefName: 'main', body: `Source-Head: ${head}`,
        headRepository: { nameWithOwner: 'owner/repo' },
        baseRepository: { nameWithOwner: 'owner/repo' },
        autoMergeRequest: null,
        mergeQueueEntry: { id: 'q1' },
      } } };
    }
    throw new Error(`unexpected provider call: ${args.join(' ')}`);
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    title: 'scope',
    body: `Lane: agent/device/scope\nSource-Head: ${head}`,
    assertSourceHead: () => true,
    provider,
  });
  assert.equal(receipt.schema, 'agentic-os-provider-handoff/v1');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.headSha, head);
  assert.equal(receipt.sourceHeadBound, true);
  assert.equal(receipt.orderingArmed, true);
  assert.equal(receipt.testedProtectedOrdering, true);
  for (const args of providerCalls.filter((entry) => entry[0] === 'pr')) {
    assert.equal(args[args.indexOf('--repo') + 1], 'github.com/owner/repo');
  }
});

test('provider handoff requires repository identity before any provider call', () => {
  let called = false;
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40),
    provider: () => { called = true; },
  });
  assert.equal(receipt.reason, 'repository-identity-missing');
  assert.equal(called, false);
});

test('provider handoff retains a non-default GitHub Enterprise port', () => {
  const head = '1'.repeat(40);
  const calls = [];
  const review = {
    state: 'OPEN', url: 'https://ghe.example:8443/owner/repo/pull/12', headRefOid: head,
    headRefName: 'agent/device/scope', baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
    body: `Source-Head: ${head}`,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'ghe.example:8443/owner/repo',
    baseBranch: 'main',
    assertSourceHead: () => true,
    provider: (args) => {
      calls.push(args);
      return args[0] === 'api' ? { data: { resource: review } }
        : args[1] === 'list' ? [review] : review;
    },
  });
  assert.equal(receipt.sourceHeadBound, true);
  const graphql = calls.find((args) => args[0] === 'api');
  assert.equal(graphql[graphql.indexOf('--hostname') + 1], 'ghe.example:8443');
  for (const args of calls.filter((entry) => entry[0] === 'pr')) {
    assert.equal(args[args.indexOf('--repo') + 1], 'ghe.example:8443/owner/repo');
  }
});

test('provider handoff returns a typed failure instead of inventing queued state', () => {
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40),
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    provider: (args) => (args[1] === 'view' ? null : null),
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-observation-failed');
  assert.equal(receipt.reviewRequiresAttention, false);
  assert.equal(receipt.orderingArmed, false);
  assert.equal(receipt.testedProtectedOrdering, false);
});

test('provider handoff rechecks the exact source before any review mutation', () => {
  const calls = [];
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40),
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    title: 'scope',
    assertSourceHead: () => false,
    provider: (args) => {
      calls.push(args);
      return args[1] === 'list' ? [] : assert.fail(`must not mutate: ${args.join(' ')}`);
    },
  });
  assert.equal(receipt.reason, 'source-ref-moved');
  assert.equal(receipt.reviewMutationAttempted, false);
  assert.equal(calls.some((args) => ['create', 'edit', 'merge'].includes(args[1])), false);
});

test('public review mutation refuses a missing exact-source assertion', () => {
  const calls = [];
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40), expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main', title: 'scope',
    provider: (args) => {
      calls.push(args);
      return args[1] === 'list' ? [] : assert.fail(`must not mutate: ${args.join(' ')}`);
    },
  });
  assert.equal(receipt.reason, 'source-head-assertion-missing');
  assert.equal(receipt.reviewMutationAttempted, false);
  assert.equal(calls.some((args) => ['create', 'edit', 'merge'].includes(args[1])), false);
});

test('a post-write identity race exposes the retained review artifact', () => {
  const expected = 'a'.repeat(40);
  const changed = 'b'.repeat(40);
  const review = {
    number: 12, state: 'OPEN', url: 'https://github.com/owner/repo/pull/12',
    headRefOid: changed, headRefName: 'agent/device/scope', baseRefName: 'main',
    body: `Source-Head: ${expected}`,
    headRepository: { nameWithOwner: 'owner/repo' },
    baseRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: expected,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    title: 'scope',
    body: `Source-Head: ${expected}`,
    assertSourceHead: () => true,
    provider: (args) => args[1] === 'list' ? []
      : args[1] === 'create' ? ''
        : args[1] === 'view' ? review
          : args[0] === 'api' ? { data: { resource: review } } : null,
  });
  assert.equal(receipt.reason, 'written-but-identity-failed');
  assert.equal(receipt.reviewRequiresAttention, true);
  assert.equal(receipt.pr.url, review.url);
  assert.equal(receipt.sourceHeadBound, false);
});

test('this repository is inside its own documentation budget', () => {
  const { found, total } = docViolations();
  assert.deepEqual(found, [], `doc budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.ok(total <= DOC_BUDGET.alwaysLoadBytes);
});

test('the portable runtime system prompt is exact and within its character contract', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const prompt = readFileSync(join(root, 'templates/SYSTEM-PROMPT-RUNTIME.md'), 'utf8');
  assert.ok([...prompt].length <= 1_000);
  assert.equal(createHash('sha256').update(prompt).digest('hex'),
    'b1d6398097e8cc542d1c5f759c8a5cfbc3a30a1f8ef7db42b6f93fe05023d38a');
});

test('the universal ADLC guideline has exact agent-runtime frontmatter', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const text = readFileSync(join(root, 'docs/adlc-guidelines.md'), 'utf8');
  const match = text.match(/^---\n([\s\S]+?)\n---\n/u);
  assert.ok(match, 'ADLC guideline requires YAML frontmatter');
  const entries = match[1].split('\n').map((line) => {
    const field = line.match(/^([a-z_]+): (\S(?:.*\S)?)$/u);
    assert.ok(field, `invalid ADLC frontmatter line: ${line}`);
    return [field[1], field[2]];
  });
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
  assert.deepEqual(Object.fromEntries(entries), {
    schema: 'agentic-os/adlc-guidelines/v1', title: 'ADLC Guidelines', doc_type: 'guidelines',
    version: '1.0.0', owner: 'agentic-os', universal_scope: 'true',
    supersedes: 'agentic-sdlc', runtime_contract: 'enforced',
    runtime_evaluator: 'npm run check', runtime_policy: 'fail-closed',
    lifecycle_status: 'active',
  });
});

test('this repository is inside its own module budget', () => {
  const { found, entries, total } = moduleViolations();
  assert.deepEqual(found, [], `module budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.equal(MODULE_BUDGET.modules, 46);
  assert.ok(entries.length <= MODULE_BUDGET.modules);
  assert.ok(total <= MODULE_BUDGET.totalLines);
  for (const path of [
    'src/authority-record.mjs',
    'src/recovery-candidate.mjs',
    'src/recovery-inventory.mjs',
    'src/github-authority.mjs',
    'src/github-authority-issuer.mjs',
    'src/github-authority-operation.mjs',
  ]) assert.ok(entries.some((entry) => entry.path === path), path);
});

test('the 46-module cap documents generic authority boundaries, not scenario growth', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const document = readFileSync(join(root, 'docs/BUDGETS.md'), 'utf8');
  assert.match(document, /increase from 29 to 35 isolates six reusable authority boundaries/u);
  assert.match(document, /increase from 35 to 46 isolates eleven reusable lifecycle-completion boundaries/u);
  assert.match(document,
    /external evidence, recovery\s+candidates, recovery inventory, GitHub challenge records, provider receipts,\s+and I\/O issuance/u);
  assert.match(document,
    /none owns a scenario, target repository, release, or cleanup effect/iu);
});

test('per-scenario module families are forbidden by name', () => {
  assert.ok(FORBIDDEN_SUFFIXES.includes('-controller.mjs'));
  assert.ok(FORBIDDEN_SUFFIXES.includes('-repository-adapter.mjs'));
});
