import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { CACHE_LIMITS, get, load, save, SCHEMA, storePath } from '../src/lane-records.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function fixture(t, scope = 'cache-recovery') {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-land-cache-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'origin.git');
  const lane = join(parent, 'lane');
  const run = (args, cwd = root) => git(args, { cwd });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'profile']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', 'origin', 'main']);
  const ref = `agent/device/${scope}`;
  run(['worktree', 'add', '--quiet', '-b', ref, lane, 'main']);
  writeFileSync(join(lane, 'candidate.txt'), 'candidate\n');
  run(['add', 'candidate.txt'], lane);
  run(['commit', '--quiet', '--message', 'candidate'], lane);
  const head = run(['rev-parse', 'HEAD'], lane);
  return { root, bare, lane, run, ref, head };
}

test('an exact advertised ref recovers through a stale queued cache projection', (t) => {
  const subject = fixture(t);
  const { lane, run, ref, head } = subject;
  run(['push', '--quiet', 'origin', `${head}:refs/heads/${ref}`], lane);
  save({ schema: SCHEMA, lanes: { [ref]: { ref, state: 'queued', head } } }, lane);

  const result = spawnSync(process.execPath, [CLI, 'land'], { cwd: lane, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /published exact lane ref/u);
  assert.equal(get(ref, lane).state, 'published');
  assert.equal(run(['rev-parse', `refs/remotes/origin/${ref}`], lane), head);
});

test('cache saturation after publication cannot turn the authoritative effect into failure', (t) => {
  const subject = fixture(t, 'cache-saturation');
  const lanes = Object.fromEntries(Array.from({ length: CACHE_LIMITS.lanes }, (_, index) => {
    const ref = `agent/cache-device/filler-${index}`;
    return [ref, { ref, state: 'active' }];
  }));
  save({ schema: SCHEMA, lanes }, subject.lane);

  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane, encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning-lane-cache-degraded: authoritative effects retained/u);
  assert.match(result.stdout, /published exact lane ref/u);
  assert.equal(subject.run([
    '--git-dir', subject.bare, 'rev-parse', `refs/heads/${subject.ref}`,
  ], subject.lane), subject.head);
  assert.equal(load(subject.lane).lanes[subject.ref], undefined);
  const line = result.stderr.split('\n').find((entry) =>
    entry.startsWith('{"schema":"agentic-os/lane-projection-retained/v1"'));
  assert.ok(line, result.stderr);
  const retained = JSON.parse(line);
  assert.equal(retained.laneProjection.ref, subject.ref);
  assert.equal(retained.laneProjection.state, 'published');
  assert.equal(retained.laneProjection.head, subject.head);
  assert.equal(retained.handoffProjection, null);
});

test('cache saturation after start retains the full base and created worktree projection', (t) => {
  const subject = fixture(t, 'start-cache-receipt');
  const lanes = Object.fromEntries(Array.from({ length: CACHE_LIMITS.lanes }, (_, index) => {
    const ref = `agent/cache-device/start-filler-${index}`;
    return [ref, { ref, state: 'active' }];
  }));
  save({ schema: SCHEMA, lanes }, subject.root);
  const expectedBase = subject.run(['rev-parse', 'refs/remotes/origin/main'], subject.root);

  const result = spawnSync(process.execPath, [
    CLI, 'start', 'projection-receipt', '--device=receipt-device',
  ], { cwd: subject.root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const line = result.stderr.split('\n').find((entry) =>
    entry.startsWith('{"schema":"agentic-os/lane-projection-retained/v1"'));
  assert.ok(line, result.stderr);
  const retained = JSON.parse(line);
  assert.equal(retained.laneProjection.ref, 'agent/receipt-device/projection-receipt');
  assert.equal(retained.laneProjection.state, 'active');
  assert.equal(retained.laneProjection.baseSha, expectedBase);
  assert.equal(retained.laneProjection.base, 'refs/remotes/origin/main');
  assert.ok(existsSync(retained.laneProjection.worktree));
  assert.equal(retained.handoffProjection, null);
});

test('an invalid cache refuses land before fetch or publication effects', (t) => {
  const subject = fixture(t, 'invalid-cache');
  const before = subject.run(['rev-parse', 'refs/remotes/origin/main'], subject.lane);
  subject.run(['push', '--quiet', '--force', subject.bare,
    `${subject.head}:refs/heads/main`], subject.lane);
  writeFileSync(storePath(subject.lane), '{"schema":"invalid","lanes":{}}\n');

  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane, encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-lane-cache-invalid/u);
  assert.equal(subject.run(['rev-parse', 'refs/remotes/origin/main'], subject.lane), before,
    'cache preflight must precede fetch evidence mutation');
  assert.equal(spawnSync('git', [
    '--git-dir', subject.bare, 'show-ref', '--verify', '--quiet',
    `refs/heads/${subject.ref}`,
  ]).status, 1, 'cache refusal must precede remote publication');
});

test('local publication byte risk refuses before an advanced remote can mutate tracking evidence', (t) => {
  const subject = fixture(t, 'dirty-prefetch');
  const before = subject.run(['rev-parse', 'refs/remotes/origin/main'], subject.lane);
  const tree = subject.run(['rev-parse', 'HEAD^{tree}'], subject.root);
  const advanced = subject.run(['commit-tree', tree, '-p', before, '-m', 'remote advance']);
  subject.run(['push', '--quiet', subject.bare, `${advanced}:refs/heads/main`]);
  writeFileSync(join(subject.lane, 'candidate.txt'), 'uncommitted authored bytes\n');

  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane, encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-publish-byte-risk/u);
  assert.equal(subject.run(['rev-parse', 'refs/remotes/origin/main'], subject.lane), before,
    'local byte refusal must precede fetch evidence mutation');
  assert.equal(subject.run(['--git-dir', subject.bare, 'rev-parse', 'refs/heads/main']), advanced);
  assert.equal(spawnSync('git', [
    '--git-dir', subject.bare, 'show-ref', '--verify', '--quiet',
    `refs/heads/${subject.ref}`,
  ]).status, 1, 'local byte refusal must precede remote publication');
});
