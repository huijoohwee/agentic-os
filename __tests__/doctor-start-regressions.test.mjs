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
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  inspect as inspectWorktree, lanePath, provision, registeredLaneBranches,
} from '../src/worktree.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function fixture(t, { profile = true } = {}) {
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
  if (profile) commitProfile(run, root);

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

function commitProfile(run, root) {
  const profile = fixtureProfile();
  commit(run, root, '.agentic-os.json', `${JSON.stringify(profile, null, 2)}\n`, 'profile');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
}

function fixtureProfile() {
  return createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
}

function doctor(root, support) {
  return spawnSync(process.execPath, [CLI, 'doctor'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${support}:${process.env.PATH}` },
  });
}

test('unknown commands fail argument grammar before repository and trust access', (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'agentic-os-unknown-command-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const outsideResult = spawnSync(process.execPath, [CLI, 'typo'], {
    cwd: outside, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(outsideResult.status, 1);
  assert.match(outsideResult.stderr, /blocked-invalid-arguments: typo: unknown command "typo"/u);
  assert.doesNotMatch(outsideResult.stderr, /not inside a git repository/u);
  for (const [args, missing] of [
    [['canonical-sync', 'apply'], '--plan=<value>'],
    [['request', 'claim'], '--input=<value>'],
    [['queue', 'apply'], '--yes'],
  ]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: outside, encoding: 'utf8', env: { ...process.env },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-invalid-arguments/u);
    assert.ok(result.stderr.includes(`missing ${missing}`), result.stderr);
    assert.doesNotMatch(result.stderr, /not inside a git repository|repository trust/u);
  }
  for (const command of ['help', '--help']) {
    const result = spawnSync(process.execPath, [CLI, command, 'unexpected'], {
      cwd: outside, encoding: 'utf8', env: { ...process.env },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-invalid-arguments/u);
    assert.doesNotMatch(result.stderr, /not inside a git repository|repository trust/u);
  }

  const { root } = fixture(t, { profile: false });
  const unanchored = spawnSync(process.execPath, [CLI, 'typo'], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(unanchored.status, 1);
  assert.match(unanchored.stderr, /blocked-invalid-arguments: typo: unknown command "typo"/u);
  assert.doesNotMatch(unanchored.stderr, /repository trust|repository profile/u);
});

test('doctor fails closed for missing, ahead, and diverged cached origin/main', async (t) => {
  await t.test('missing origin/main is unknown', (child) => {
    const { root, support } = fixture(child);
    const result = doctor(root, support);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL canonical-current\s+canonical main relation to cached origin\/main is unknown/u);
  });

  await t.test('local main ahead of cached origin/main is not current', (child) => {
    const { root, run, support } = fixture(child);
    const base = run(['rev-parse', 'HEAD']);
    run(['update-ref', 'refs/remotes/origin/main', base]);
    commit(run, root, 'local.txt', 'local\n', 'local advance');

    const result = doctor(root, support);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL canonical-current\s+canonical main is 1 ahead of cached origin\/main/u);
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
      /FAIL canonical-current\s+canonical main diverged from cached origin\/main \(1 ahead, 1 behind\)/u,
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
  assert.match(result.stdout, /FAIL canonical-clean\s+canonical main has exact tracked-byte\/index risk \(1 byte, 1 hidden\)/u);
  assert.match(result.stdout, /warn owned-paths\s+1 untracked\/ignored path\(s\) retained/u);
  assert.equal(existsSync(join(root, 'owner.secret')), true);
});

test('provision binds the lane to one supplied captured base when origin/main moves', (t) => {
  const { root, run } = fixture(t);
  assert.throws(() => inspectWorktree('agent/test-device/missing', root),
    /explicit canonical base ref/u);
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

  assert.equal(created.schema, 'agentic-os/git-provision/v1');
  assert.equal(created.provisionCompleted, true);
  assert.equal(created.effectsRetained, true);
  assert.equal(created.branchSha, captured);
  assert.equal(created.registeredWorktree.branch, 'agent/test-device/captured-base');
  assert.equal(created.pathIdentity.kind, 'directory');
  assert.equal(created.branchObservationExact, true);
  assert.equal(created.registrationObservationExact, true);
  assert.equal(created.pathObservationExact, true);
  assert.equal(run(['rev-parse', 'refs/remotes/origin/main']), moved);
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: created.path }), captured);
  assert.equal(run(['rev-parse', 'refs/heads/agent/test-device/captured-base']), captured);
  assert.equal(created.baseSha, captured);
});

test('retained lane refs do not become registered authoring projections', (t) => {
  const { root, run } = fixture(t);
  const head = run(['rev-parse', 'HEAD']);
  for (let index = 0; index < 30; index += 1) {
    run(['update-ref', `refs/heads/agent/test-device/retained-${index}`, head]);
  }
  assert.deepEqual(registeredLaneBranches(root), []);

  const created = provision({
    ref: 'agent/test-device/active',
    scope: 'active',
    device: 'test-device',
    baseSha: head,
    cwd: root,
  });
  assert.deepEqual(registeredLaneBranches(root), ['agent/test-device/active']);
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: created.path }), head);
  assert.throws(() => provision({
    ref: 'agent/test-device/active',
    scope: 'active',
    device: 'test-device',
    baseSha: head,
    cwd: root,
  }), /already exists/u);
});

test('failed one-command provisioning reports and retains exact recovery artifacts', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, '.gitattributes'), 'filtered.txt filter=required\n');
  writeFileSync(join(root, 'filtered.txt'), 'tracked\n');
  run(['config', 'filter.required.clean', 'cat']);
  run(['config', 'filter.required.smudge', 'cat']);
  run(['config', 'filter.required.required', 'true']);
  run(['add', '.gitattributes', 'filtered.txt']);
  run(['commit', '--quiet', '--message', 'required filter']);
  const baseSha = run(['rev-parse', 'HEAD']);
  run(['config', 'filter.required.smudge', 'false']);
  const ref = 'agent/test-device/failed-checkout';
  const path = lanePath('failed-checkout', 'test-device', root);

  assert.throws(() => provision({
    ref, scope: 'failed-checkout', device: 'test-device', baseSha, cwd: root,
  }), (error) => {
    assert.equal(error.reason, 'blocked-provision-recovery-required');
    assert.equal(error.artifacts.ref, ref);
    assert.equal(error.artifacts.path, path);
    assert.equal(error.artifacts.baseSha, baseSha);
    assert.equal(error.artifacts.branchSha, baseSha);
    assert.match(error.message, /recovery required.*failed-checkout/u);
    return true;
  });
  assert.equal(run(['rev-parse', `refs/heads/${ref}`]), baseSha);
  assert.deepEqual(registeredLaneBranches(root), []);
});

test('post-allocation inspection failure reports branch, registration, path, and created parents', (t) => {
  const { parent, root, run } = fixture(t);
  const baseSha = run(['rev-parse', 'HEAD']);
  const ref = 'agent/test-device/postcondition-failure';
  const path = lanePath('postcondition-failure', 'test-device', root);
  const support = join(parent, 'postcondition-bin');
  mkdirSync(support);
  const wrapper = join(support, 'git');
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$PWD" = "$TARGET_WORKTREE" ] && [ "$1" = branch ] && [ "$2" = --show-current ]; then',
    '  exit 29',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const prior = { PATH: process.env.PATH, REAL_GIT: process.env.REAL_GIT,
    TARGET_WORKTREE: process.env.TARGET_WORKTREE };
  Object.assign(process.env, { PATH: `${support}:${process.env.PATH}`,
    REAL_GIT: realGit, TARGET_WORKTREE: path });
  t.after(() => Object.entries(prior).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));

  assert.throws(() => provision({
    ref, scope: 'postcondition-failure', device: 'test-device', baseSha, cwd: root,
  }), (error) => {
    assert.equal(error.reason, 'blocked-provision-recovery-required');
    assert.equal(error.retainedOperation, true);
    assert.equal(error.artifacts.effectsRetained, true);
    assert.equal(error.artifacts.worktreeAddReturned, true);
    assert.equal(error.artifacts.branchSha, baseSha);
    assert.equal(error.artifacts.branchObservationExact, true);
    assert.equal(error.artifacts.registrationObservationExact, true);
    assert.equal(error.artifacts.registeredWorktree.branch, ref);
    assert.equal(error.artifacts.registeredWorktree.path, path);
    assert.equal(error.artifacts.pathExists, true);
    assert.equal(error.artifacts.pathIdentity.kind, 'directory');
    assert.equal(error.artifacts.postconditionHead, baseSha);
    assert.equal(error.artifacts.postconditionBranch, null);
    assert.ok(error.artifacts.createdParentPaths.length >= 1);
    assert.ok(error.artifacts.createdParentPaths.every((entry) => path.startsWith(`${entry}/`)));
    return true;
  });
  assert.equal(run(['rev-parse', `refs/heads/${ref}`]), baseSha);
  assert.equal(registeredLaneBranches(root).includes(ref), true);
  assert.equal(existsSync(path), true);
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
    { cwd: root, encoding: 'utf8' },
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

test('duplicate lane identity refuses before an advanced remote mutates tracking evidence', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const before = run(['rev-parse', 'refs/remotes/origin/main']);
  const created = provision({
    ref: 'agent/test-device/duplicate', scope: 'duplicate', device: 'test-device',
    baseSha: before, cwd: root,
  });
  const tree = run(['rev-parse', 'HEAD^{tree}']);
  const advanced = run(['commit-tree', tree, '-p', before, '-m', 'remote advance']);
  run(['push', '--quiet', bare, `${advanced}:refs/heads/main`]);

  const result = spawnSync(process.execPath, [CLI, 'start', 'duplicate',
    '--device=test-device'], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-lane-already-exists/u);
  assert.equal(run(['rev-parse', 'refs/remotes/origin/main']), before,
    'duplicate lane refusal must precede fetch evidence mutation');
  assert.equal(run(['--git-dir', bare, 'rev-parse', 'refs/heads/main']), advanced);
  assert.equal(run(['rev-parse', 'refs/heads/agent/test-device/duplicate']), before);
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: created.path }), before);
});

test('canonical sync apply requires setup trust before reading a plan', (t) => {
  const { root, run } = fixture(t, { profile: false });
  const before = run(['for-each-ref', '--format=%(refname) %(objectname)']);
  const result = spawnSync(process.execPath, [CLI, 'canonical-sync', 'apply',
    '--plan=/does/not/exist', '--authorize=x', '--exclusive=y'], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-repository-trust-missing/u);
  assert.equal(run(['for-each-ref', '--format=%(refname) %(objectname)']), before);
});

test('canonical sync apply rejects an anchored canonical profile disappearance', (t) => {
  const { root, run } = fixture(t);
  run(['rm', '--quiet', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'remove profile']);
  const before = run(['for-each-ref', '--format=%(refname) %(objectname)']);
  const result = spawnSync(process.execPath, [CLI, 'canonical-sync', 'apply',
    '--plan=/does/not/exist', '--authorize=x', '--exclusive=y'], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-repository-trust-conflict/u);
  assert.equal(run(['for-each-ref', '--format=%(refname) %(objectname)']), before);
});
