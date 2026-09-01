import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  PROVIDER_CAPABILITIES, QUEUE_POLICY, effectivePullRequestMethods, observe,
  providerBlockingReasons, providerPolicy,
} from '../src/queue.mjs';

const CHECK = 'Integration Gate';
const MERGE = Object.freeze({
  allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false,
  delete_branch_on_merge: false, allow_auto_merge: true,
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-ruleset-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(['init', '--quiet', '--initial-branch=trunk'], { cwd: root });
  git(['config', 'user.name', 'Fixture'], { cwd: root });
  git(['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'integration.yml'), [
    'on:', '  pull_request:', '  merge_group:', 'jobs:', '  integration:',
    `    name: ${CHECK}`, '    runs-on: ubuntu-latest', '    steps:', '      - run: true', '',
  ].join('\n'));
  git(['add', '.'], { cwd: root });
  git(['commit', '--quiet', '--message', 'fixture'], { cwd: root });
  git(['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], { cwd: root });
  git(['update-ref', 'refs/remotes/origin/trunk', 'HEAD'], { cwd: root });
  return root;
}

function observeRulesets(t, capabilities, requiredChecks, details) {
  const cwd = fixture(t);
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/trunk', remoteRef: 'refs/remotes/origin/trunk' },
    adapters: { repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' } },
    capabilities, requiredChecks,
  });
  const provider = (args) => {
    if (args[0] === 'repo') return { nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'trunk' }, url: 'https://github.com/owner/repo' };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return MERGE;
    if (args[1] === 'repos/owner/repo/rulesets')
      return details.map((entry) => ({ id: entry.id }));
    const detail = details.find((entry) => args[1] === `repos/owner/repo/rulesets/${entry.id}`);
    if (detail) return detail;
    if (args[1] === 'repos/owner/repo/branches/trunk/protection')
      return { required_pull_request_reviews: { required_approving_review_count: 1 } };
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  return { state, policy: providerPolicy(profile) };
}

function ruleset(id, name, refName, rules) {
  return { id, name, target: 'branch', enforcement: 'active',
    conditions: { ref_name: refName }, rules };
}

test('an unknown wildcard ruleset cannot be ignored beside an exact passing queue rule', (t) => {
  const passing = ruleset(1, 'exact queue', {
    include: ['refs/heads/trunk'], exclude: [],
  }, [
    { type: 'required_status_checks', parameters: {
      strict_required_status_checks_policy: false,
      required_status_checks: [{ context: CHECK }],
    } },
    { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } },
    { type: 'merge_queue', parameters: { ...QUEUE_POLICY } },
  ]);
  const conflicting = ruleset(2, 'wildcard queue', {
    include: ['refs/heads/*'], exclude: [],
  }, [{ type: 'merge_queue', parameters: { merge_method: 'MERGE' } }]);
  const { state, policy } = observeRulesets(t, [
    PROVIDER_CAPABILITIES.PULL_REQUEST, PROVIDER_CAPABILITIES.MERGE_QUEUE,
    PROVIDER_CAPABILITIES.SQUASH,
  ], [CHECK], [passing, conflicting]);

  assert.equal(state.queueEnabled, true);
  assert.equal(state.queuePolicySatisfied, true);
  assert.equal(state.unknownRulesetScope, true);
  assert.ok(state.observationErrors.includes('ruleset-scope'));
  assert.deepEqual(providerBlockingReasons(state, policy), ['ruleset-observation']);
  assert.equal(state.handoffPolicySatisfied, false);
});

test('an unknown exclusion cannot hide a pull-request method conflict', (t) => {
  const passingRule = { type: 'pull_request', parameters: {
    allowed_merge_methods: ['squash'],
  } };
  const conflictingRule = { type: 'pull_request', parameters: {
    allowed_merge_methods: ['merge'],
  } };
  const passing = ruleset(3, 'exact review', {
    include: ['refs/heads/trunk'], exclude: [],
  }, [passingRule]);
  const conflicting = ruleset(4, 'uncertain exclusion', {
    include: ['refs/heads/trunk'], exclude: ['refs/heads/release/*'],
  }, [conflictingRule]);
  const { state, policy } = observeRulesets(t, [
    PROVIDER_CAPABILITIES.PULL_REQUEST, PROVIDER_CAPABILITIES.SQUASH,
  ], [], [passing, conflicting]);

  assert.deepEqual(effectivePullRequestMethods(MERGE, [passingRule, conflictingRule]), []);
  assert.deepEqual(state.effectiveMergeMethods, ['squash']);
  assert.equal(state.pullRequestPolicySatisfied, true);
  assert.equal(state.unknownRulesetScope, true);
  assert.ok(state.observationErrors.includes('ruleset-scope'));
  assert.deepEqual(providerBlockingReasons(state, policy), ['ruleset-observation']);
  assert.equal(state.handoffPolicySatisfied, false);
});
