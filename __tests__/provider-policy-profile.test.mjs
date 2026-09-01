import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  PROVIDER_CAPABILITIES,
  QUEUE_POLICY,
  audit,
  observe,
  plan,
  providerPolicy,
} from '../src/queue.mjs';

const CONTEXT = 'Integration Gate';
const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function repositoryProfile(capabilities = [], requiredChecks = [CONTEXT]) {
  return createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/origin/trunk',
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

function cliRepository(t, { repositoryAdapter, provider, capabilities, requiredChecks = [] }) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-profile-cli-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  const support = join(parent, 'bin');
  const providerMarker = join(parent, 'provider-called');
  mkdirSync(root);
  mkdirSync(support);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: repositoryAdapter, provider },
    capabilities,
    requiredChecks,
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(root, 'add', '.');
  runGit(root, 'commit', '--quiet', '--message', 'fixture');
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  runGit(root, 'worktree', 'add', '--quiet', '-b', 'agent/test/profile-guard', lane, 'main');
  writeFileSync(join(lane, 'lane.txt'), 'lane\n');
  runGit(lane, 'add', 'lane.txt');
  runGit(lane, 'commit', '--quiet', '--message', 'lane');
  const gh = join(support, 'gh');
  writeFileSync(gh, '#!/bin/sh\n: > "$AGENTIC_OS_TEST_PROVIDER_MARKER"\nexit 97\n');
  chmodSync(gh, 0o755);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { root, bare, lane, support, providerMarker };
}

function runCli(subject, command, cwd = subject.root) {
  return spawnSync(process.execPath, [CLI, command], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_PROVIDER_MARKER: subject.providerMarker,
    },
  });
}

function remoteLaneExists(subject) {
  return spawnSync('git', [
    '--git-dir', subject.bare, 'show-ref', '--verify', '--quiet',
    'refs/heads/agent/test/profile-guard',
  ]).status === 0;
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
  assert.ok(byType('pull_request'));
  assert.ok(byType('merge_queue'));
  assert.ok(byType('required_linear_history'));
  assert.deepEqual(
    byType('required_status_checks').parameters.required_status_checks,
    [{ context: CONTEXT }],
  );
  assert.equal(
    byType('required_status_checks').parameters.strict_required_status_checks_policy,
    false,
  );
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
  const checks = projected.ruleset.rules.find((rule) => rule.type === 'required_status_checks');
  assert.equal('strict_required_status_checks_policy' in checks.parameters, false);
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

test('strict protection is selected independently of merge queue ordering', () => {
  const profile = repositoryProfile([PROVIDER_CAPABILITIES.STRICT]);
  const projected = plan(profile);
  const checks = projected.ruleset.rules.find((rule) => rule.type === 'required_status_checks');
  assert.equal(checks.parameters.strict_required_status_checks_policy, true);
  assert.equal(projected.ruleset.rules.some((rule) => rule.type === 'merge_queue'), false);

  const findings = audit(providerState({ strict: true }), profile);
  assert.equal(finding(findings, 'strict-on').ok, true);
  assert.notEqual(finding(findings, 'merge-queue')?.ok, false);
});

test('profile checks and non-main canonical ref drive merge-group observation', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-profile-provider-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  run('init', '--quiet', '--initial-branch=trunk');
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
  run('update-ref', 'refs/remotes/origin/trunk', 'HEAD');

  const profile = repositoryProfile([
    PROVIDER_CAPABILITIES.PULL_REQUEST,
    PROVIDER_CAPABILITIES.MERGE_QUEUE,
  ]);
  const calls = [];
  const provider = (args) => {
    calls.push(args);
    if (args[0] === 'repo') return {
      nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'trunk' },
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
      name: 'trunk queue',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/trunk'], exclude: [] } },
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
    if (args[1] === 'repos/owner/repo/branches/trunk/protection') return {};
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };

  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.deepEqual(state.observationErrors, []);
  assert.deepEqual(state.requiredChecks, [CONTEXT]);
  assert.equal(state.queueEnabled, true);
  assert.equal(state.mergeGroupSupported, true);
  assert.ok(calls.some((args) => args[1] === 'repos/owner/repo/branches/trunk/protection'));
});

test('a full ruleset page makes provider observation incomplete', (t) => {
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
  const listCall = calls.find((args) => args[1] === 'repos/owner/repo/rulesets');
  assert.equal(listCall[listCall.indexOf('--method') + 1], 'GET');
  assert.ok(listCall.includes('per_page=100'));
  assert.equal(finding(audit(state, profile), 'provider-observation').ok, false);
});

test('unsupported repository adapters refuse before remote or provider mutation', async (t) => {
  for (const repositoryAdapter of [
    { id: 'git', version: '2' },
    { id: 'other', version: '1' },
  ]) {
    await t.test(`${repositoryAdapter.id}/${repositoryAdapter.version}`, (child) => {
      const subject = cliRepository(child, {
        repositoryAdapter,
        provider: { id: 'github', version: '1' },
        capabilities: [PROVIDER_CAPABILITIES.PULL_REQUEST],
      });
      const result = runCli(subject, 'land', subject.lane);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /blocked-repository-adapter-unsupported/u);
      assert.equal(remoteLaneExists(subject), false);
      assert.equal(existsSync(subject.providerMarker), false);
    });
  }
});

test('pull-request capability without a provider fails doctor and land closed', (t) => {
  const subject = cliRepository(t, {
    repositoryAdapter: { id: 'git', version: '1' },
    provider: null,
    capabilities: [PROVIDER_CAPABILITIES.PULL_REQUEST],
  });
  const doctor = runCli(subject, 'doctor');
  assert.equal(doctor.status, 1, doctor.stderr);
  assert.match(doctor.stdout, /FAIL provider-adapter\s+selected capabilities require a provider adapter/u);

  const land = runCli(subject, 'land', subject.lane);
  assert.equal(land.status, 1, land.stderr);
  assert.match(land.stderr, /blocked-provider-adapter-none/u);
  assert.equal(remoteLaneExists(subject), false);
  assert.equal(existsSync(subject.providerMarker), false);
});

test('every provider-enforced policy fails closed without a provider adapter', (t) => {
  for (const selected of [
    { capabilities: [PROVIDER_CAPABILITIES.STRICT] },
    { capabilities: [PROVIDER_CAPABILITIES.LINEAR_HISTORY] },
    { capabilities: [PROVIDER_CAPABILITIES.SQUASH] },
    { capabilities: [], requiredChecks: ['external check'] },
  ]) {
    const subject = cliRepository(t, {
      repositoryAdapter: { id: 'git', version: '1' }, provider: null, ...selected,
    });
    const doctor = runCli(subject, 'doctor');
    assert.equal(doctor.status, 1, `${JSON.stringify(selected)}\n${doctor.stdout}\n${doctor.stderr}`);
    assert.match(doctor.stdout, /selected capabilities require a provider adapter/u);
    const land = runCli(subject, 'land', subject.lane);
    assert.equal(land.status, 1, land.stderr);
    assert.match(land.stderr, /blocked-provider-adapter-none/u);
    assert.equal(remoteLaneExists(subject), false);
  }
});

test('remote profile advance blocks stale-policy start and land', (t) => {
  const subject = cliRepository(t, {
    repositoryAdapter: { id: 'git', version: '1' }, provider: null, capabilities: [],
  });
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-profile-writer-'));
  const writer = join(parent, 'writer');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  runGit(subject.root, '--git-dir', subject.bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  runGit(parent, 'clone', '--quiet', subject.bare, writer);
  runGit(writer, 'config', 'user.name', 'Profile Writer');
  runGit(writer, 'config', 'user.email', 'writer@example.invalid');
  const advanced = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    requiredChecks: ['new-policy'],
  });
  writeFileSync(join(writer, '.agentic-os.json'), `${JSON.stringify(advanced, null, 2)}\n`);
  runGit(writer, 'add', '.agentic-os.json');
  runGit(writer, 'commit', '--quiet', '--message', 'advance policy');
  runGit(writer, 'push', '--quiet', 'origin', 'main');

  const land = runCli(subject, 'land', subject.lane);
  assert.equal(land.status, 1, land.stderr);
  assert.match(land.stderr, /blocked-repository-profile-stale/u);
  assert.equal(remoteLaneExists(subject), false);

  const start = spawnSync(process.execPath, [CLI, 'start', 'stale-policy'], {
    cwd: subject.root, encoding: 'utf8',
    env: { ...process.env, PATH: `${subject.support}:${process.env.PATH}` },
  });
  assert.equal(start.status, 1, start.stderr);
  assert.match(start.stderr, /blocked-repository-profile-stale/u);
  assert.equal(runGit(subject.root, 'for-each-ref', '--format=%(refname)', 'refs/heads/agent')
    .includes('stale-policy'), false);
});
