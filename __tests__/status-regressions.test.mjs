import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { CACHE_LIMITS, load, save, SCHEMA } from '../src/lane-records.mjs';
import { formatLocal, formatStatus } from '../bin/agentic-os-report.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('local reporting requires explicit canonical identity', () => {
  assert.throws(() => formatLocal({}), /explicit canonical branch and remote-tracking ref/u);
});

test('status preserves a missing registered lane instead of inspecting its absent directory', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-stale-status-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repo',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(root, 'add', '.agentic-os.json');
  runGit(root, 'commit', '--quiet', '--message', 'fixture');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  runGit(root, 'worktree', 'add', '--quiet', '-b', 'agent/test/stale', lane, 'main');
  rmSync(lane, { recursive: true });

  const result = spawnSync(process.execPath, [CLI, 'status', '--device=test'], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent\/test\/stale/u);
  assert.match(result.stdout, /stale registration preserved/u);
  assert.match(result.stdout, new RegExp(lane.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('device traversal is refused before branch, worktree, or external path effects', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-device-traversal-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const escaped = join(parent, 'outside--scope');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repo',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(root, 'add', '.agentic-os.json');
  runGit(root, 'commit', '--quiet', '--message', 'fixture');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  const protectedBefore = runGit(root, 'rev-parse', 'refs/remotes/origin/main');
  const refsBefore = runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads');
  const worktreesBefore = runGit(root, 'worktree', 'list', '--porcelain');
  for (const args of [
    ['start', 'scope', '--devcie=other'],
    ['start', 'scope', 'extra'],
    ['start', 'scope', '--device=one', '--device=two'],
  ]) {
    const refused = spawnSync(process.execPath, [CLI, ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env },
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /blocked-invalid-arguments/u);
    assert.equal(runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads'), refsBefore);
    assert.equal(runGit(root, 'worktree', 'list', '--porcelain'), worktreesBefore);
  }
  const result = spawnSync(process.execPath, [
    CLI, 'start', 'scope', '--device=../../outside',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid device/u);
  assert.equal(existsSync(escaped), false);
  assert.equal(existsSync(join(root, '.git', 'agentic-os-start.lock')), false);
  assert.equal(runGit(root, 'rev-parse', 'refs/remotes/origin/main'), protectedBefore);
  assert.equal(runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads'), refsBefore);
  assert.equal(runGit(root, 'worktree', 'list', '--porcelain'), worktreesBefore);

  const cache = join(root, '.git', 'agentic-os', 'lanes.json');
  mkdirSync(join(root, '.git', 'agentic-os'), { recursive: true });
  writeFileSync(cache, '{"schema":"invalid","lanes":{}}\n');
  const invalidCache = spawnSync(process.execPath, [
    CLI, 'start', 'cache-preflight', '--device=test-device',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(invalidCache.status, 1);
  assert.match(invalidCache.stderr, /blocked-lane-cache-invalid/u);
  assert.equal(runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads'), refsBefore);
  assert.equal(runGit(root, 'worktree', 'list', '--porcelain'), worktreesBefore);
  rmSync(cache); // retire only the invalid fixture authored by this test

  const lanes = Object.create(null);
  for (let index = 0; index < CACHE_LIMITS.lanes; index += 1) {
    const ref = `agent/retained-${index}/cache`;
    lanes[ref] = { ref, state: 'integrated' };
  }
  save({ schema: SCHEMA, lanes }, root);
  const saturated = spawnSync(process.execPath, [
    CLI, 'start', 'cache-overflow', '--device=test-device',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(saturated.status, 0, saturated.stderr);
  assert.match(saturated.stdout, /lane agent\/test-device\/cache-overflow/u);
  assert.match(saturated.stdout, /worktree .*test-device--cache-overflow/u);
  assert.match(saturated.stderr, /warning-lane-cache-degraded/u);
  assert.notEqual(runGit(root, 'rev-parse', '--verify',
    'refs/heads/agent/test-device/cache-overflow'), '');
  assert.equal(Object.keys(load(root).lanes).length, CACHE_LIMITS.lanes);
});

test('incomplete provider observation renders queue state as bounded UNKNOWN', () => {
  const rendered = formatStatus({
    device: 'test',
    lanes: [],
    queue: {
      available: true,
      queueEnabled: false,
      openPrs: null,
      observationErrors: [
        'rulesets',
        `network ${'sensitive'.repeat(20)}`,
        'three', 'four', 'five', 'six',
      ],
    },
  });
  assert.match(rendered, /provider observation UNKNOWN\/incomplete/u);
  assert.match(rendered, /merge queue UNKNOWN/u);
  assert.match(rendered, /\+1 more/u);
  assert.doesNotMatch(rendered, /merge queue NOT ENABLED/u);
  assert.equal(rendered.includes('sensitive'.repeat(8)), false);
});

test('an unavailable selected provider is reported instead of omitted', () => {
  const rendered = formatStatus({ device: 'test', lanes: [], queue: { available: false } });
  assert.match(rendered, /provider observation UNKNOWN\/unavailable/u);
  assert.match(rendered, /merge queue UNKNOWN/u);
  assert.doesNotMatch(rendered, /merge queue NOT ENABLED/u);
});

test('an unsupported selected provider retains local status and reports UNKNOWN', () => {
  const rendered = formatStatus({
    device: 'test',
    lanes: [{ ref: 'agent/test/lane', state: 'active', commits: 1, untracked: 0, next: [] }],
    queue: { available: false, reason: 'unsupported' },
  });
  assert.match(rendered, /agent\/test\/lane/u);
  assert.match(rendered, /provider observation UNKNOWN\/unsupported/u);
  assert.match(rendered, /merge queue UNKNOWN/u);
});
