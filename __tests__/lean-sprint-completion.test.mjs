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
import { parseWritePaths, provision, registeredLaneBranches, worktreeFor } from '../src/worktree.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-lean-sprint-'));
  const root = join(parent, 'repo');
  mkdirSync(root);
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', 'base.txt', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'base']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, run };
}

function createLane(t, root, ref, scope) {
  const baseSha = git(['rev-parse', 'HEAD'], { cwd: root });
  const created = provision({ ref, scope, device: 'test-device', baseSha, cwd: root });
  t.after(() => {
    if (existsSync(created.path)) {
      git(['worktree', 'remove', '--force', created.path], { cwd: root });
    }
  });
  return created;
}

test('write reservations reject traversal and Git pathspec magic', () => {
  assert.deepEqual(parseWritePaths('src/a.mjs,docs/guide.md'), ['docs/guide.md', 'src/a.mjs']);
  for (const path of ['../outside', '/absolute', 'src/*', ':(top)**', 'src\\file'])
    assert.throws(() => parseWritePaths(path), /write scope/u);
});

test('start admits a disjoint second lane without interrupting the active lane', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const active = createLane(t, root, 'agent/test-device/active', 'active');
  writeFileSync(join(active.path, 'active.txt'), 'active\n');

  const result = spawnSync(process.execPath, [CLI, 'start', 'next', '--device=test-device',
    '--write=next.txt'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(registeredLaneBranches(root), [
    'agent/test-device/active', 'agent/test-device/next',
  ]);
  const next = worktreeFor('agent/test-device/next', root);
  t.after(() => {
    if (next && existsSync(next.path)) git(['worktree', 'remove', '--force', next.path], { cwd: root });
  });
  assert.equal(run(['branch', '--show-current'], { cwd: active.path }), 'agent/test-device/active');
});

test('start refuses an overlapping active-lane write reservation', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const active = createLane(t, root, 'agent/test-device/active', 'active');
  writeFileSync(join(active.path, 'shared.txt'), 'active\n');

  const result = spawnSync(process.execPath, [CLI, 'start', 'next', '--device=test-device',
    '--write=shared.txt'], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-write-scope-overlap/u);
  assert.equal(run(['branch', '--list', 'agent/test-device/next']), '');
});

test('land autonomously stages, commits, and publishes only its reserved path', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);

  const started = spawnSync(process.execPath, [CLI, 'start', 'autonomous',
    '--device=test-device', '--write=change.txt'], { cwd: root, encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
  const lane = worktreeFor('agent/test-device/autonomous', root);
  assert.ok(lane);
  t.after(() => {
    if (existsSync(lane.path)) git(['worktree', 'remove', '--force', lane.path], { cwd: root });
  });
  writeFileSync(join(lane.path, 'change.txt'), 'delivered\n');

  const landed = spawnSync(process.execPath, [CLI, 'land', '--message=docs: autonomous'], {
    cwd: lane.path, encoding: 'utf8',
  });

  assert.equal(landed.status, 0, landed.stderr);
  assert.match(landed.stdout, /committed [0-9a-f]{9} \(1 path\(s\)\)/u);
  assert.match(landed.stdout, /pushed agent\/test-device\/autonomous/u);
  const local = run(['rev-parse', 'agent/test-device/autonomous']);
  const advertised = run(['ls-remote', '--refs', bare,
    'refs/heads/agent/test-device/autonomous']).split(/\s+/u)[0];
  assert.equal(advertised, local);
});

test('finish removes one clean integrated worktree and retains its branch history', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const ref = 'agent/test-device/completed';
  const created = createLane(t, root, ref, 'completed');
  writeFileSync(join(created.path, 'completed.txt'), 'completed\n');
  git(['add', 'completed.txt'], { cwd: created.path });
  git(['commit', '--quiet', '--message', 'complete lane'], { cwd: created.path });
  const laneHead = git(['rev-parse', 'HEAD'], { cwd: created.path });
  run(['merge', '--quiet', '--ff-only', ref]);
  run(['push', '--quiet', 'origin', 'main']);

  const result = spawnSync(process.execPath, [CLI, 'finish', `--ref=${ref}`], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agentic-os\/sprint-finish\/v1/u);
  assert.equal(existsSync(created.path), false);
  assert.deepEqual(registeredLaneBranches(root), []);
  assert.equal(run(['rev-parse', `refs/heads/${ref}`]), laneHead);
  assert.equal(run(['rev-parse', 'main']), laneHead);
  assert.equal(run(['rev-parse', 'origin/main']), laneHead);
});
