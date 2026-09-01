import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate,
  OVERRIDE_ENV,
  protectedRefForRepository,
} from '../src/guard-main.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { violations as docViolations, BUDGET as DOC_BUDGET } from '../src/doc-budget.mjs';
import {
  violations as moduleViolations,
  BUDGET as MODULE_BUDGET,
  FORBIDDEN_SUFFIXES,
} from '../src/module-budget.mjs';
import { deviceSegment, laneRef, isLaneRef, parseLaneRef, assertScope } from '../src/lane-id.mjs';
import { capFacts, CAPS, lanesForDevice } from '../src/lane-state.mjs';
import { REQUIRED_CONFIG } from '../src/config.mjs';
import {
  QUEUE_POLICY,
  apply,
  audit,
  enqueue,
  isAbsentClassicProtection,
  observe,
  plan,
  providerHttpStatus,
  queuePolicyMatches,
  rulesetApplies,
  workflowHasMergeGroup,
  workflowMergeGroupChecks,
} from '../src/queue.mjs';

test('the guard refuses commits on the protected branch', () => {
  const verdict = evaluate({ branch: 'main', phase: 'commit' });
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'blocked-main-authoring');
  assert.match(verdict.message, /npm run lane/);
});

test('the guard allows lanes and refuses every unbound authoring surface', () => {
  assert.equal(evaluate({ branch: 'agent/dev/scope', phase: 'commit' }).allow, true);
  for (const branch of [null, 'feature/unbound']) {
    const verdict = evaluate({ branch, phase: 'commit' });
    assert.equal(verdict.allow, false);
    assert.equal(verdict.reason, 'blocked-non-lane-authoring');
  }
});

test('the guard has an explicit, named override', () => {
  const verdict = evaluate({ branch: 'main', phase: 'commit', override: '1' });
  assert.equal(verdict.allow, true);
  assert.match(verdict.note, new RegExp(OVERRIDE_ENV));
});

test('pre-push rejects a lane update targeting profile canonical trunk', (t) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-pre-push-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', '--initial-branch=trunk'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  cpSync(join(projectRoot, 'src'), join(root, 'src'), { recursive: true });
  const profilePath = join(root, '.agentic-os.json');
  writeFileSync(profilePath, `${JSON.stringify(createRepositoryProfile({
    repository: 'github.com/owner/repository',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/upstream/trunk',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  }), null, 2)}\n`);
  execFileSync('git', ['add', '.agentic-os.json'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--message', 'profile'], { cwd: root });
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
  const legacy = run('refs/heads/main');
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /refs\/heads\/main/u);
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
  assert.ok(deviceSegment('Hui.MacBook Pro').length > 0);
});

test('caps are derived per device, not globally', () => {
  const refs = ['agent/a/one', 'agent/a/two', 'agent/b/three'];
  assert.equal(lanesForDevice(refs, 'a').length, 2);
  const facts = capFacts(refs, 'a');
  assert.equal(facts.openLanes, 2);
  assert.equal(facts.wipCap, CAPS.openLanesPerDevice);
});

test('required git config includes the conflict-memory settings', () => {
  const keys = REQUIRED_CONFIG.map((entry) => entry.key);
  for (const key of ['rerere.enabled', 'rerere.autoupdate', 'pull.ff']) {
    assert.ok(keys.includes(key), `${key} must be required`);
  }
  for (const entry of REQUIRED_CONFIG) {
    assert.ok(entry.why.length > 10, `${entry.key} needs a stated reason`);
  }
});

test('the plan batches, requires a PR, and turns require-up-to-date off', () => {
  assert.equal(QUEUE_POLICY.merge_method, 'SQUASH');
  assert.ok(QUEUE_POLICY.max_entries_to_merge > 1, 'batching is the point of the queue');

  const rules = plan().ruleset.rules;
  const byType = (type) => rules.find((rule) => rule.type === type);

  assert.ok(byType('pull_request'), 'every change must go through a pull request');
  assert.equal(byType('pull_request').parameters.required_approving_review_count, 0);
  assert.equal(
    byType('required_status_checks').parameters.strict_required_status_checks_policy,
    false,
    'require-branches-up-to-date must be off or the queue fights the authors',
  );
  assert.ok(byType('merge_queue'), 'the queue rule is the whole point');
  assert.ok(byType('required_linear_history'), 'protected history must remain linear');
  assert.ok(byType('non_fast_forward'), 'history must not be rewritten');
  assert.equal(plan().repository.delete_branch_on_merge, false);
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
  });
  const strictFinding = findings.find((finding) => finding.id === 'strict-off');
  assert.equal(strictFinding.ok, false);
  assert.match(strictFinding.detail, /restack treadmill/);
});

test('the audit flags an unenabled queue, missing checks, and excess WIP', () => {
  const findings = audit({
    available: true,
    strict: false,
    requiredChecks: [],
    merge: { allow_squash_merge: true, delete_branch_on_merge: true },
    queueEnabled: false,
    openPrs: Array.from({ length: 45 }, (_, index) => ({ number: index })),
  });
  assert.equal(findings.find((finding) => finding.id === 'merge-queue').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'required-checks').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'wip').ok, false);
});

test('queue policy and strict mode fail closed across applicable rulesets', () => {
  assert.equal(queuePolicyMatches({ ...QUEUE_POLICY }), true);
  assert.equal(queuePolicyMatches({ ...QUEUE_POLICY, merge_method: 'MERGE' }), false);
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
  });
  assert.equal(findings.find((finding) => finding.id === 'strict-off').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'queue-policy').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'linear-history').ok, false);
});

test('unknown provider strictness and PR counts are failures, never healthy defaults', () => {
  const findings = audit({
    available: true,
    observationErrors: ['rulesets', 'open-pull-requests'],
    strict: null,
    requiredChecks: [],
    merge: null,
    queueEnabled: false,
    queuePolicySatisfied: false,
    pullRequestRequired: false,
    linearHistoryRequired: false,
    mergeGroupSupported: false,
    openPrs: null,
  });
  assert.equal(findings.find((finding) => finding.id === 'provider-observation').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'strict-off').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'wip').ok, false);
});

test('only an active protected-main ruleset contributes ordering facts', () => {
  const base = { target: 'branch', enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } } };
  assert.equal(rulesetApplies(base, 'main'), true);
  assert.equal(rulesetApplies(base, 'trunk'), false);
  assert.equal(rulesetApplies({ ...base, enforcement: 'disabled' }, 'main'), false);
  assert.equal(rulesetApplies({ ...base,
    conditions: { ref_name: { include: ['refs/heads/other'], exclude: [] } } }, 'main'), false);
  assert.equal(rulesetApplies({ ...base,
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: ['refs/heads/m*'] } } },
  'main'), false);
  assert.equal(rulesetApplies({ ...base,
    conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/m*'], exclude: [] } } },
  'main'), false);
});

test('merge-group detection is scoped to the top-level workflow trigger', () => {
  assert.equal(workflowHasMergeGroup('on:\n  pull_request:\n  merge_group:\n'), true);
  assert.equal(workflowHasMergeGroup('on: [push, pull_request, merge_group]\n'), true);
  assert.equal(workflowHasMergeGroup('"on": merge_group\n'), true);
  assert.equal(workflowHasMergeGroup('on: push # merge_group\n'), false);
  assert.equal(workflowHasMergeGroup('# on: merge_group\non: push\n'), false);
  assert.equal(workflowHasMergeGroup('on: push\njobs:\n  merge_group:\n'), false);
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
  ].join('\n')), ['test', 'budgets']);
  assert.deepEqual(workflowMergeGroupChecks('on: merge_group\njobs:\n  other:\n'), ['other']);
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
    const state = observe({ cwd, provider, providerAvailable: () => true });
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
  const state = observe({ cwd, provider, providerAvailable: () => true });
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
    provider: (args) => (args[1] === 'view' ? null : null),
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-write-failed');
  assert.equal(receipt.reviewRequiresAttention, false);
  assert.equal(receipt.orderingArmed, false);
  assert.equal(receipt.testedProtectedOrdering, false);
});

test('provider handoff rechecks the exact source before any review mutation', () => {
  const calls = [];
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40),
    expectedRepository: 'github.com/owner/repo',
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
    expectedHead: 'a'.repeat(40), expectedRepository: 'github.com/owner/repo', title: 'scope',
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

test('without tested-ordering capability a review is projected but auto-merge is not armed', () => {
  const head = 'b'.repeat(40);
  const review = {
    number: 8, state: 'OPEN', url: 'https://github.com/owner/repo/pull/8', headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'main', body: `Source-Head: ${head}`, autoMergeRequest: { enabledAt: 'now' },
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    provider: (args) => args[0] === 'api' ? { data: { resource: review } }
      : args[1] === 'list' ? [review]
        : args[1] === 'merge' ? assert.fail('must not arm auto-merge') : review,
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'tested-ordering-unavailable');
  assert.equal(receipt.orderingArmed, false);
  assert.equal(receipt.testedProtectedOrdering, false);
});

test('an already-observed queue entry survives a duplicate handoff command failure', () => {
  const head = 'c'.repeat(40);
  const review = {
    number: 9, state: 'OPEN', url: 'https://github.com/owner/repo/pull/9', headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'main', body: `Source-Head: ${head}`, autoMergeRequest: null,
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    provider: (args) => args[0] === 'api'
      ? { data: { resource: { ...review, mergeQueueEntry: { id: 'q9' } } } }
      : args[1] === 'list' ? [review]
        : args[1] === 'merge' ? null : review,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.testedProtectedOrdering, true);
});

test('read-only handoff recognizes external tested ordering without arming it', () => {
  const head = '9'.repeat(40);
  const calls = [];
  const review = {
    number: 19, state: 'OPEN', url: 'https://github.com/owner/repo/pull/19',
    headRefOid: head, headRefName: 'agent/device/scope', baseRefName: 'main',
    body: `Source-Head: ${head}`,
    headRepository: { nameWithOwner: 'owner/repo' },
    baseRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    title: 'must not edit',
    provider: (args) => {
      calls.push(args);
      if (args[1] === 'list') return [review];
      if (args[0] === 'api') return { data: { resource: {
        ...review, mergeQueueEntry: { id: 'external-q19' },
      } } };
      return assert.fail(`read-only observation must not mutate: ${args.join(' ')}`);
    },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.testedProtectedOrdering, true);
  assert.equal(receipt.reviewMutationAttempted, false);
  assert.equal(calls.some((args) => ['edit', 'merge'].includes(args[1])), false);
});

test('a queue entry never overrides an atomic review identity mismatch', () => {
  const expected = 'd'.repeat(40);
  const changed = 'e'.repeat(40);
  const calls = [];
  const projected = { state: 'OPEN', url: 'https://github.com/owner/repo/pull/10',
    headRefOid: changed, headRefName: 'agent/device/scope', baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: expected,
    expectedRepository: 'github.com/owner/repo',
    provider: (args) => {
      calls.push(args);
      return args[1] === 'list' ? [projected]
        : args[0] === 'api'
      ? { data: { resource: { ...projected, headRefOid: changed,
          headRefName: 'agent/device/scope', baseRefName: 'main',
          body: `Source-Head: ${expected}`, mergeQueueEntry: { id: 'q10' } } } }
        : projected;
    },
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-identity-mismatch');
  assert.equal(receipt.testedProtectedOrdering, false);
  assert.equal(calls.some((args) => args[1] === 'edit' || args[1] === 'merge'), false);
});

test('CLI review discovery uses supported fields and binds same-repository identity', () => {
  const head = 'f'.repeat(40);
  const calls = [];
  const review = {
    state: 'OPEN', url: 'https://github.com/owner/repo/pull/11', headRefOid: head,
    headRefName: 'agent/device/scope', baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: true,
    body: `Source-Head: ${head}`,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    provider: (args) => {
      calls.push(args);
      if (args[1] === 'list') return [review];
      return assert.fail(`identity mismatch must not mutate: ${args.join(' ')}`);
    },
  });
  const fields = calls[0][calls[0].indexOf('--json') + 1];
  assert.match(fields, /isCrossRepository/u);
  assert.doesNotMatch(fields, /baseRepository/u);
  assert.equal(receipt.reason, 'review-identity-mismatch');
});

test('this repository is inside its own documentation budget', () => {
  const { found, total } = docViolations();
  assert.deepEqual(found, [], `doc budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.ok(total <= DOC_BUDGET.alwaysLoadBytes);
});

test('this repository is inside its own module budget', () => {
  const { found, entries, total } = moduleViolations();
  assert.deepEqual(found, [], `module budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.ok(entries.length <= MODULE_BUDGET.modules);
  assert.ok(total <= MODULE_BUDGET.totalLines);
});

test('per-scenario module families are forbidden by name', () => {
  assert.ok(FORBIDDEN_SUFFIXES.includes('-controller.mjs'));
  assert.ok(FORBIDDEN_SUFFIXES.includes('-repository-adapter.mjs'));
});
