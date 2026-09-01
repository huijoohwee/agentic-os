import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GIT_ADAPTER,
  REPOSITORY_PROFILE_FILENAME,
  createGitRepositoryAdapter,
  loadRepositoryProfileAtRef,
  loadRepositoryProfile,
  observeRepositoryProfileAtRef,
  observeRepository,
} from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';

function run(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function repository(t, name = 'repository') {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-git-adapter-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, name);
  mkdirSync(root);
  run(root, 'init', '--quiet', '--initial-branch=trunk');
  run(root, 'config', 'user.name', 'Fixture');
  run(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitignore'), '*.secret\n');
  writeFileSync(join(root, 'tracked.txt'), 'original\n');
  run(root, 'add', '.');
  run(root, 'commit', '--quiet', '-m', 'initial');
  run(root, 'update-ref', 'refs/remotes/upstream/trunk', 'HEAD');
  return { parent, root: realpathSync(root) };
}

function profile(overrides = {}) {
  return createRepositoryProfile({
    repository: 'configured:fixture',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/upstream/trunk',
    },
    adapters: { repository: { ...GIT_ADAPTER }, provider: null },
    ...overrides,
  });
}

function writeProfile(root, value = profile()) {
  writeFileSync(join(root, REPOSITORY_PROFILE_FILENAME), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

test('Git adapter observes a bound clean clone without assuming consumer authority', (t) => {
  const subject = repository(t);
  const observation = observeRepository({ repository: subject.root, profile: profile() });
  assert.equal(observation.configuredRepository, 'configured:fixture');
  assert.equal(observation.observedRepository.root, subject.root);
  assert.match(observation.observedRepository.commonDirectory, /\.git$/u);
  assert.equal(observation.canonical.relation, 'equal');
  assert.equal(observation.canonical.operationallyClean, true);
  assert.deepEqual(observation.authority, { runtime: 'consumer', release: 'consumer' });
  assert.ok(Object.values(observation.cleanup).every((effect) => effect === 'retain'));
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.canonical), true);
  assert.equal(Object.isFrozen(observation.projections[0].ownedPaths), true);
  assert.throws(() => { observation.canonical.operationallyClean = false; }, TypeError);
  assert.throws(() => observation.projections[0].ownedPaths.push('invented'), TypeError);
});

test('trusted profile loading reads committed canonical bytes, not working-tree edits', (t) => {
  const subject = repository(t);
  const committed = writeProfile(subject.root);
  run(subject.root, 'add', REPOSITORY_PROFILE_FILENAME);
  run(subject.root, 'commit', '--quiet', '-m', 'profile');
  writeProfile(subject.root, profile({ repository: 'candidate:replacement' }));
  const observation = observeRepositoryProfileAtRef({
    repository: subject.root, ref: 'refs/heads/trunk',
  });
  assert.equal(observation.revision, run(subject.root, 'rev-parse', 'refs/heads/trunk'));
  assert.deepEqual(observation.profile, committed);
  assert.deepEqual(loadRepositoryProfileAtRef({
    repository: subject.root, ref: 'refs/heads/trunk',
  }), committed);
});

test('trusted profile observation rejects canonical ref movement during the read', (t) => {
  const subject = repository(t);
  writeProfile(subject.root);
  run(subject.root, 'add', REPOSITORY_PROFILE_FILENAME);
  run(subject.root, 'commit', '--quiet', '-m', 'profile');
  const captured = run(subject.root, 'rev-parse', 'HEAD');
  run(subject.root, 'commit', '--quiet', '--allow-empty', '-m', 'move ref');
  const moved = run(subject.root, 'rev-parse', 'HEAD');
  run(subject.root, 'reset', '--quiet', '--hard', captured);

  const support = join(subject.parent, 'bin');
  mkdirSync(support);
  const wrapper = join(support, 'git');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(wrapper, [
    '#!/bin/sh',
    `real_git=${JSON.stringify(realGit)}`,
    'if [ "$1" = cat-file ] && [ "$2" = blob ]; then',
    '  "$real_git" "$@"',
    '  status=$?',
    `  "$real_git" update-ref refs/heads/trunk ${moved} ${captured}`,
    '  exit "$status"',
    'fi',
    'exec "$real_git" "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const priorPath = process.env.PATH;
  try {
    process.env.PATH = `${support}:${priorPath}`;
    assert.throws(() => observeRepositoryProfileAtRef({
      repository: subject.root, ref: 'refs/heads/trunk',
    }), (error) => error?.reason === 'blocked-protected-ref-race');
  } finally {
    process.env.PATH = priorPath;
  }
});

test('shallow cleanliness reports but does not block on ignored ownership', (t) => {
  const subject = repository(t);
  writeFileSync(join(subject.root, 'owned.secret'), 'owned\n');
  let observation = observeRepository({ repository: subject.root, profile: profile() });
  let canonical = observation.projections.find((item) => item.path === subject.root);
  assert.equal(observation.mode, 'shallow');
  assert.equal(observation.canonical.operationallyClean, true);
  assert.deepEqual(canonical.ownedPaths, ['owned.secret']);
  assert.equal(canonical.ownedPathCount, 1);
  assert.equal(canonical.trackedByteDriftPaths, null);

  rmSync(join(subject.root, 'owned.secret'));
  run(subject.root, 'update-index', '--assume-unchanged', 'tracked.txt');
  writeFileSync(join(subject.root, 'tracked.txt'), 'locally owned bytes\n');
  observation = observeRepository({ repository: subject.root, profile: profile() });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.equal(canonical.dirtyTracked, false);
  assert.deepEqual(canonical.hiddenPaths, ['tracked.txt']);
  assert.equal(canonical.trackedByteDriftPaths, null);
  assert.equal(observation.canonical.operationallyClean, false);

  observation = observeRepository({ repository: subject.root, profile: profile(), mode: 'deep' });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.equal(observation.mode, 'deep');
  assert.deepEqual(canonical.trackedByteDriftPaths, ['tracked.txt']);
  assert.equal(observation.canonical.operationallyClean, false);
});

test('shallow evidence keeps HEAD, index, and working-tree projections distinct', (t) => {
  const subject = repository(t);
  const added = join(subject.root, 'index-only.txt');
  writeFileSync(added, 'staged\n');
  run(subject.root, 'add', 'index-only.txt');
  let observation = observeRepository({ repository: subject.root, profile: profile() });
  let canonical = observation.projections.find((item) => item.path === subject.root);
  assert.deepEqual(canonical.headToIndex.map(({ path, status, oldMode, newMode }) => ({
    path, status, oldMode, newMode,
  })), [{ path: 'index-only.txt', status: 'A', oldMode: '000000', newMode: '100644' }]);
  assert.deepEqual(canonical.indexToWorkingTree, []);
  assert.equal(canonical.operationallyClean, false);

  run(subject.root, 'reset', '--quiet', 'HEAD', '--', 'index-only.txt');
  rmSync(added);
  chmodSync(join(subject.root, 'tracked.txt'), 0o755);
  run(subject.root, 'add', 'tracked.txt');
  observation = observeRepository({ repository: subject.root, profile: profile() });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.deepEqual(canonical.headToIndex.map(({ path, status, oldMode, newMode }) => ({
    path, status, oldMode, newMode,
  })), [{ path: 'tracked.txt', status: 'M', oldMode: '100644', newMode: '100755' }]);
  assert.deepEqual(canonical.indexToWorkingTree, []);

  run(subject.root, 'reset', '--quiet', 'HEAD', '--', 'tracked.txt');
  chmodSync(join(subject.root, 'tracked.txt'), 0o644);
  rmSync(join(subject.root, 'tracked.txt'));
  observation = observeRepository({ repository: subject.root, profile: profile() });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.deepEqual(canonical.headToIndex, []);
  assert.deepEqual(canonical.indexToWorkingTree.map(({ path, status, oldMode, newMode }) => ({
    path, status, oldMode, newMode,
  })), [{ path: 'tracked.txt', status: 'D', oldMode: '100644', newMode: '000000' }]);
});

test('adapter validates exact version and fully-qualified ref classes', (t) => {
  const subject = repository(t);
  const wrongVersion = profile({
    adapters: { repository: { id: 'git', version: '2' }, provider: null },
  });
  assert.throws(() => observeRepository({ repository: subject.root, profile: wrongVersion }),
    /version 1/);
  const unsafeRef = profile({
    canonical: {
      localRef: 'refs/heads/trunk..bad',
      remoteRef: 'refs/remotes/upstream/trunk..bad',
    },
  });
  assert.throws(() => observeRepository({ repository: subject.root, profile: unsafeRef }),
    /canonical ref/);

  const configured = writeProfile(subject.root);
  assert.deepEqual(loadRepositoryProfile({ repository: subject.root }), configured);
  const adapter = createGitRepositoryAdapter({ repository: subject.root });
  assert.deepEqual(Object.keys(adapter), ['id', 'version', 'capabilities', 'profile', 'observe']);
  assert.equal(Object.hasOwn(adapter, 'apply'), false);
  assert.equal(adapter.observe().observationDigest.length, 64);
});

test('registered worktree symlink replacement fails repository binding closed', (t) => {
  const subject = repository(t, 'source');
  const linked = join(subject.parent, 'linked');
  run(subject.root, 'branch', 'linked');
  run(subject.root, 'worktree', 'add', '--quiet', linked, 'linked');

  const unrelated = join(subject.parent, 'unrelated');
  mkdirSync(unrelated);
  run(unrelated, 'init', '--quiet', '--initial-branch=trunk');
  rmSync(linked, { recursive: true, force: true });
  symlinkSync(unrelated, linked, 'dir');

  assert.throws(() => observeRepository({ repository: subject.root, profile: profile() }),
    (error) => error?.reason === 'blocked-repository-identity');
});

test('factory captures one absolute repository before process cwd can change', (t) => {
  const first = repository(t, 'first');
  const second = repository(t, 'second');
  writeProfile(first.root);
  const prior = process.cwd();
  try {
    process.chdir(first.root);
    const adapter = createGitRepositoryAdapter({ repository: '.' });
    process.chdir(second.root);
    assert.equal(adapter.observe().observedRepository.root, first.root);
  } finally {
    process.chdir(prior);
  }
});

test('profile loader rejects floating and symlinked configuration', (t) => {
  const subject = repository(t);
  const outside = join(subject.parent, 'floating.json');
  writeFileSync(outside, JSON.stringify(profile()));
  assert.throws(() => loadRepositoryProfile({
    repository: subject.root,
    profilePath: outside,
  }), /must be \.agentic-os\.json at repository root/);
  symlinkSync(outside, join(subject.root, REPOSITORY_PROFILE_FILENAME));
  assert.throws(() => loadRepositoryProfile({ repository: subject.root }),
    (error) => error?.reason === 'blocked-repository-profile-identity');
});
