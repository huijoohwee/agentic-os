import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { provision } from '../src/worktree.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-doctor-start-'));
  const root = join(parent, 'repo');
  mkdirSync(root);
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'base']);

  const support = join(parent, 'bin');
  mkdirSync(support);
  const gh = join(support, 'gh');
  writeFileSync(gh, '#!/bin/sh\nexit 1\n');
  chmodSync(gh, 0o755);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, run, support };
}

function commit(run, root, path, contents, message) {
  writeFileSync(join(root, path), contents);
  run(['add', path]);
  run(['commit', '--quiet', '--message', message]);
  return run(['rev-parse', 'HEAD']);
}

function doctor(root, support) {
  return spawnSync(process.execPath, [CLI, 'doctor'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${support}:${process.env.PATH}` },
  });
}

test('doctor fails closed for missing, ahead, and diverged cached origin/main', async (t) => {
  await t.test('missing origin/main is unknown', (child) => {
    const { root, support } = fixture(child);
    const result = doctor(root, support);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL main-current\s+canonical main relation to cached origin\/main is unknown/u);
  });

  await t.test('local main ahead of cached origin/main is not current', (child) => {
    const { root, run, support } = fixture(child);
    const base = run(['rev-parse', 'HEAD']);
    run(['update-ref', 'refs/remotes/origin/main', base]);
    commit(run, root, 'local.txt', 'local\n', 'local advance');

    const result = doctor(root, support);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL main-current\s+canonical main is 1 ahead of cached origin\/main/u);
  });

  await t.test('diverged cached origin/main is not flattened into behind', (child) => {
    const { root, run, support } = fixture(child);
    run(['switch', '--quiet', '--create', 'remote-side']);
    const remote = commit(run, root, 'remote.txt', 'remote\n', 'remote advance');
    run(['switch', '--quiet', 'main']);
    commit(run, root, 'local.txt', 'local\n', 'local advance');
    run(['update-ref', 'refs/remotes/origin/main', remote]);

    const result = doctor(root, support);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stdout,
      /FAIL main-current\s+canonical main diverged from cached origin\/main \(1 ahead, 1 behind\)/u,
    );
  });
});

test('doctor exposes hidden tracked-byte risk and retains owned ignored paths', (t) => {
  const { root, run, support } = fixture(t);
  writeFileSync(join(root, '.gitignore'), '*.secret\n');
  run(['add', '.gitignore']);
  run(['commit', '--quiet', '--message', 'ignore owned files']);
  run(['update-ref', 'refs/remotes/origin/main', run(['rev-parse', 'HEAD'])]);
  run(['update-index', '--assume-unchanged', 'base.txt']);
  writeFileSync(join(root, 'base.txt'), 'hidden authored bytes\n');
  writeFileSync(join(root, 'owner.secret'), 'owner bytes stay here\n');

  const result = doctor(root, support);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /FAIL main-clean\s+canonical main has exact tracked-byte\/index risk \(1 byte, 1 hidden\)/u);
  assert.match(result.stdout, /warn owned-paths\s+1 untracked\/ignored path\(s\) retained/u);
  assert.equal(existsSync(join(root, 'owner.secret')), true);
});

test('provision binds the lane to one supplied captured base when origin/main moves', (t) => {
  const { root, run } = fixture(t);
  const captured = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', captured]);
  const moved = commit(run, root, 'later.txt', 'later\n', 'move protected tracking ref');
  run(['update-ref', 'refs/remotes/origin/main', moved, captured]);

  const created = provision({
    ref: 'agent/test-device/captured-base',
    scope: 'captured-base',
    device: 'test-device',
    baseSha: captured,
    cwd: root,
  });

  assert.equal(run(['rev-parse', 'refs/remotes/origin/main']), moved);
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: created.path }), captured);
  assert.equal(run(['rev-parse', 'refs/heads/agent/test-device/captured-base']), captured);
  assert.equal(created.baseSha, captured);
});

test('a held clone-wide start lock refuses before branch or worktree mutation', (t) => {
  const { parent, root, run } = fixture(t);
  const head = run(['rev-parse', 'HEAD']);
  const lock = join(root, '.git', 'agentic-os-start.lock');
  mkdirSync(lock);
  const beforeWorktrees = run(['worktree', 'list', '--porcelain']);

  const result = spawnSync(
    process.execPath,
    [CLI, 'start', 'locked-scope', '--device=test-device'],
    { cwd: root, encoding: 'utf8',
      env: { ...process.env, AGENTIC_OS_ALLOW_LEGACY_PROFILE: '1' } },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /blocked-concurrent-start/u);
  assert.equal(run(['rev-parse', 'HEAD']), head);
  assert.equal(run(['rev-parse', '--verify', '--quiet',
    'refs/heads/agent/test-device/locked-scope'], { allowFail: true }), null);
  assert.equal(run(['worktree', 'list', '--porcelain']), beforeWorktrees);
  assert.equal(existsSync(join(parent, '.worktrees')), false);
  assert.equal(existsSync(lock), true, 'a refused contender must not remove another holder lock');
});

test('canonical sync apply requires a committed repository profile before reading a plan', (t) => {
  const { root, run } = fixture(t);
  const before = run(['for-each-ref', '--format=%(refname) %(objectname)']);
  const result = spawnSync(process.execPath, [CLI, 'canonical-sync', 'apply',
    '--plan=/does/not/exist', '--authorize=x', '--exclusive=y'], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-repository-profile-missing/u);
  assert.equal(run(['for-each-ref', '--format=%(refname) %(objectname)']), before);
});
