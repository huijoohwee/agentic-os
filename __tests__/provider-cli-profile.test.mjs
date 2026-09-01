import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { PROVIDER_CAPABILITIES } from '../src/queue.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

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
  ensureRepositoryTrust(root, profile, { allowCreate: true });
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

test('provider observation refuses unsupported adapters before provider access', (t) => {
  const subject = cliRepository(t, {
    repositoryAdapter: { id: 'git', version: '1' },
    provider: { id: 'future-provider', version: '7' },
    capabilities: [],
  });
  const result = spawnSync(process.execPath, [CLI, 'observe', '--provider'], {
    cwd: subject.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_PROVIDER_MARKER: subject.providerMarker,
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /blocked-provider-adapter-unsupported/u);
  assert.equal(existsSync(subject.providerMarker), false);
  const status = spawnSync(process.execPath, [CLI, 'status', '--device=test'], {
    cwd: subject.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_PROVIDER_MARKER: subject.providerMarker,
    },
  });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /provider observation UNKNOWN\/unsupported/u);
  assert.match(status.stdout, /agent\/test\/profile-guard/u);
  assert.equal(existsSync(subject.providerMarker), false);
});

test('land publishes without provider access when no provider-bound policy is selected', (t) => {
  const subject = cliRepository(t, {
    repositoryAdapter: { id: 'git', version: '1' },
    provider: { id: 'future-provider', version: '7' },
    capabilities: [],
  });
  const result = runCli(subject, 'land', subject.lane);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /published exact lane ref/u);
  assert.equal(remoteLaneExists(subject), true);
  assert.equal(existsSync(subject.providerMarker), false);
});

test('status device binding selects registered projections instead of relabeling all lanes', (t) => {
  const subject = cliRepository(t, {
    repositoryAdapter: { id: 'git', version: '1' }, provider: null, capabilities: [],
  });
  const selected = spawnSync(process.execPath, [CLI, 'status', '--device=test'], {
    cwd: subject.root, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH },
  });
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stdout, /agent\/test\/profile-guard/u);
  const other = spawnSync(process.execPath, [CLI, 'status', '--device=other'], {
    cwd: subject.root, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH },
  });
  assert.equal(other.status, 0, other.stderr);
  assert.doesNotMatch(other.stdout, /agent\/test\/profile-guard/u);
  assert.match(other.stdout, /no lanes/u);
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
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
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
