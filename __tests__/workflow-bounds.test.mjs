import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  observe,
  PROTECTED_WORKFLOW_LIMITS,
  protectedWorkflowSupportsMergeGroup,
  PROVIDER_CAPABILITIES,
} from '../src/queue.mjs';

const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repository(t, name) {
  const cwd = mkdtempSync(join(tmpdir(), `agentic-os-${name}-`));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  runGit(cwd, 'init', '--quiet', '--initial-branch=trunk');
  runGit(cwd, 'config', 'user.name', 'Fixture');
  runGit(cwd, 'config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
  return cwd;
}
function commit(cwd) {
  runGit(cwd, 'add', '.github/workflows');
  runGit(cwd, 'commit', '--quiet', '--message', 'workflows');
}
const policy = { protectedRef: 'HEAD', requiredChecks: ['test'] };

test('protected workflow discovery enforces count, per-file, and aggregate byte budgets', async (t) => {
  await t.test('count', (child) => {
    const cwd = repository(child, 'workflow-count');
    for (let index = 0; index <= PROTECTED_WORKFLOW_LIMITS.count; index += 1) {
      writeFileSync(join(cwd, '.github', 'workflows', `${index}.yml`), 'on: push\n');
    }
    commit(cwd);
    assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /count budget/u);
  });
  await t.test('per-file bytes', (child) => {
    const cwd = repository(child, 'workflow-file-bytes');
    writeFileSync(join(cwd, '.github', 'workflows', 'large.yml'),
      Buffer.alloc(PROTECTED_WORKFLOW_LIMITS.perFileBytes + 1, 0x61));
    commit(cwd);
    assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /file byte budget/u);
  });
  await t.test('aggregate bytes', (child) => {
    const cwd = repository(child, 'workflow-total-bytes');
    const bytes = Buffer.alloc(Math.floor(PROTECTED_WORKFLOW_LIMITS.aggregateBytes / 5) + 1, 0x61);
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(cwd, '.github', 'workflows', `${index}.yml`), bytes);
    }
    commit(cwd);
    assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /aggregate byte budget/u);
  });
});

test('only direct YAML workflow files can prove merge-group check support', (t) => {
  const cwd = repository(t, 'workflow-file-selection');
  const decoy = ['on: merge_group', 'jobs:', '  test:', '    runs-on: ubuntu-latest', ''].join('\n');
  writeFileSync(join(cwd, '.github', 'workflows', 'decoy.txt'), decoy);
  mkdirSync(join(cwd, '.github', 'workflows', 'nested'));
  writeFileSync(join(cwd, '.github', 'workflows', 'nested', 'decoy.yml'), decoy);
  commit(cwd);
  assert.equal(protectedWorkflowSupportsMergeGroup(cwd, policy), false);
});

test('a symlink-mode workflow blob cannot prove merge-group support', (t) => {
  const cwd = repository(t, 'workflow-symlink');
  symlinkSync('on: merge_group\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
    join(cwd, '.github', 'workflows', 'decoy.yml'));
  commit(cwd);
  assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /not a regular blob/u);
});

test('a protected workflow read failure becomes incomplete provider observation', (t) => {
  const cwd = repository(t, 'workflow-read-failure');
  writeFileSync(join(cwd, '.github', 'workflows', 'integration.yml'), [
    'on: merge_group', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '',
  ].join('\n'));
  commit(cwd);
  runGit(cwd, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/origin/trunk',
    },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    capabilities: [
      PROVIDER_CAPABILITIES.PULL_REQUEST,
      PROVIDER_CAPABILITIES.MERGE_QUEUE,
    ],
    requiredChecks: ['test'],
  });
  const provider = (args) => {
    if (args[0] === 'repo') return {
      nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'trunk' },
      url: 'https://github.com/owner/repo',
    };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return { delete_branch_on_merge: false };
    if (args[1] === 'repos/owner/repo/rulesets') return [{ id: 1 }];
    if (args[1] === 'repos/owner/repo/rulesets/1') return {
      target: 'branch', enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/trunk'], exclude: [] } },
      rules: [
        { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } },
        { type: 'merge_queue', parameters: { merge_method: 'SQUASH' } },
        { type: 'required_status_checks', parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: 'test' }],
        } },
      ],
    };
    if (args[1] === 'repos/owner/repo/branches/trunk/protection') return {};
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.equal(state.mergeGroupSupported, null);
  assert.ok(state.observationErrors.includes('protected-workflows'));
});
