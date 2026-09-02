import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
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
  ensureRepositoryTrust,
  loadRepositoryTrust,
  loadRepositoryProfileAtRef,
  loadRepositoryProfile,
  observeRepositoryProfileAtRef,
  observeRepository,
  repositoryTrustPath,
} from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { commonDir, git, repoRoot, worktrees } from '../src/git.mjs';

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
  assert.equal(observation.projections[0].ownedPathScope, 'visible');
  assert.deepEqual(observation.authority, { runtime: 'consumer', release: 'consumer' });
  assert.ok(Object.values(observation.cleanup).every((effect) => effect === 'retain'));
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.canonical), true);
  assert.equal(Object.isFrozen(observation.projections[0].ownedPaths), true);
  assert.throws(() => { observation.canonical.operationallyClean = false; }, TypeError);
  assert.throws(() => observation.projections[0].ownedPaths.push('invented'), TypeError);
  assert.equal(observeRepository({ repository: subject.root, profile: profile(), mode: 'structural' })
    .canonical.operationallyClean, null);
  assert.equal(observeRepository({ repository: subject.root, profile: profile(), mode: 'deep' })
    .canonical.operationallyClean, true);
});

test('Git observation preserves the profile-selected exact quarantine opt-in', (t) => {
  const subject = repository(t), selected = profile({ cleanup: {
    worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine',
    remoteTrackingRef: 'retain', localBranch: 'retain', remoteBranch: 'retain',
    unreachableObjects: 'retain',
  } });
  const observation = observeRepository({ repository: subject.root, profile: selected });
  assert.deepEqual(observation.cleanup, selected.cleanup);
  assert.deepEqual(observation.capabilities, selected.capabilities);
  assert.equal(observation.capabilities.includes('retain-all-cleanup'), false);
  assert.equal(observation.capabilities.includes('quarantine-worktree-cleanup-opt-in'), true);
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

test('trusted profile loading rejects a committed symlink blob', (t) => {
  const subject = repository(t);
  symlinkSync('{}', join(subject.root, REPOSITORY_PROFILE_FILENAME));
  run(subject.root, 'add', REPOSITORY_PROFILE_FILENAME);
  run(subject.root, 'commit', '--quiet', '-m', 'symlink profile');
  assert.throws(() => observeRepositoryProfileAtRef({
    repository: subject.root, ref: 'refs/heads/trunk',
  }), /tree entry is invalid/u);
});

test('repository trust requires private single-link stable file identity', (t) => {
  const subject = repository(t);
  const expected = profile();
  ensureRepositoryTrust(subject.root, expected, { allowCreate: true });
  const path = repositoryTrustPath(subject.root);

  chmodSync(path, 0o644);
  assert.throws(() => loadRepositoryTrust(subject.root),
    (error) => error?.reason === 'blocked-repository-trust-invalid'
      && /mode must be 0600/u.test(error.message));

  chmodSync(path, 0o600);
  const alias = join(subject.parent, 'trust-hardlink.json');
  linkSync(path, alias);
  assert.throws(() => loadRepositoryTrust(subject.root),
    (error) => error?.reason === 'blocked-repository-trust-invalid'
      && /link count must be 1/u.test(error.message));
  rmSync(alias);
  assert.equal(loadRepositoryTrust(subject.root).repository, expected.repository);

  const directory = join(commonDir(subject.root), 'agentic-os');
  chmodSync(directory, 0o755);
  assert.throws(() => loadRepositoryTrust(subject.root),
    (error) => error?.reason === 'blocked-repository-trust-invalid'
      && /directory mode must be 0700/u.test(error.message));
  chmodSync(directory, 0o700);
  assert.equal(loadRepositoryTrust(subject.root).repository, expected.repository);
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

test('Git observation strips inherited identity and executable configuration overrides', (t) => {
  const subject = repository(t);
  const support = join(subject.parent, 'safe-observation-bin');
  mkdirSync(support);
  const wrapper = join(support, 'git');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(wrapper, [
    '#!/bin/sh',
    '[ -z "${GIT_INDEX_FILE+x}" ] || exit 81',
    '[ -z "${GIT_CONFIG_PARAMETERS+x}" ] || exit 82',
    '[ -z "${GIT_EXTERNAL_DIFF+x}" ] || exit 83',
    '[ -z "${GIT_TRACE+x}" ] || exit 84',
    '[ "$GIT_OPTIONAL_LOCKS" = 0 ] || exit 85',
    '[ "$GIT_NO_LAZY_FETCH" = 1 ] || exit 86',
    '[ "$GIT_NO_REPLACE_OBJECTS" = 1 ] || exit 87',
    '[ "$GIT_CONFIG_COUNT" = 3 ] || exit 88',
    '[ "$GIT_CONFIG_KEY_0" = core.fsmonitor ] || exit 89',
    `exec ${JSON.stringify(realGit)} "$@"`,
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const overrides = {
    PATH: `${support}:${process.env.PATH}`,
    GIT_INDEX_FILE: join(subject.parent, 'foreign-index'),
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor=/foreign/helper'",
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: '/foreign/helper',
    GIT_EXTERNAL_DIFF: '/foreign/diff',
    GIT_TRACE: join(subject.parent, 'trace'),
  };
  const prior = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => Object.entries(prior).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));
  assert.equal(repoRoot(subject.root), subject.root);
  assert.equal(observeRepository({ repository: subject.root, profile: profile() })
    .canonical.operationallyClean, true);
});

test('Git mutation strips inherited identity and config but honors explicit controlled index state', (t) => {
  const subject = repository(t);
  const foreign = join(subject.parent, 'foreign');
  mkdirSync(foreign);
  run(foreign, 'init', '--quiet', '--initial-branch=trunk');
  const support = join(subject.parent, 'safe-mutation-bin');
  mkdirSync(support);
  const wrapper = join(support, 'git');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(wrapper, [
    '#!/bin/sh',
    '[ -z "${GIT_DIR+x}" ] || exit 71',
    '[ -z "${GIT_WORK_TREE+x}" ] || exit 72',
    '[ -z "${GIT_INDEX_FILE+x}" ] || exit 73',
    '[ -z "${GIT_CONFIG_PARAMETERS+x}" ] || exit 74',
    '[ -z "${GIT_CONFIG_COUNT+x}" ] || exit 75',
    '[ "$GIT_NO_REPLACE_OBJECTS" = 1 ] || exit 76',
    `exec ${JSON.stringify(realGit)} "$@"`,
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const oid = run(subject.root, 'rev-parse', 'HEAD');
  const overrides = {
    PATH: `${support}:${process.env.PATH}`,
    GIT_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign,
    GIT_INDEX_FILE: join(foreign, '.git', 'index'),
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/foreign/hooks'",
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/foreign/hooks',
  };
  const prior = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    git(['update-ref', 'refs/heads/sanitized-mutation', oid], { cwd: subject.root });
  } finally {
    Object.entries(prior).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
  assert.equal(run(subject.root, 'rev-parse', 'refs/heads/sanitized-mutation'), oid);
  assert.equal(git(['rev-parse', '--verify', 'refs/heads/sanitized-mutation'], {
    cwd: foreign, allowFail: true,
  }), null);

  const controlledIndex = join(subject.parent, 'controlled-index');
  git(['read-tree', 'HEAD'], { cwd: subject.root, env: { GIT_INDEX_FILE: controlledIndex } });
  assert.equal(existsSync(controlledIndex), true);
});

test('shallow cleanliness skips ignored ownership while deep audit retains it', (t) => {
  const subject = repository(t);
  writeFileSync(join(subject.root, 'owned.secret'), 'owned\n');
  let observation = observeRepository({ repository: subject.root, profile: profile() });
  let canonical = observation.projections.find((item) => item.path === subject.root);
  assert.equal(observation.mode, 'shallow');
  assert.equal(observation.canonical.operationallyClean, true);
  assert.equal(canonical.ownedPathScope, 'visible');
  assert.deepEqual(canonical.ownedPaths, []);
  assert.equal(canonical.ownedPathCount, 0);
  assert.equal(canonical.trackedByteDriftPaths, null);

  observation = observeRepository({ repository: subject.root, profile: profile(), mode: 'deep' });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.equal(canonical.ownedPathScope, 'visible-and-ignored');
  assert.deepEqual(canonical.ownedPaths, ['owned.secret']);
  assert.equal(canonical.ownedPathCount, 1);

  rmSync(join(subject.root, 'owned.secret'));
  run(subject.root, 'update-index', '--assume-unchanged', 'tracked.txt');
  writeFileSync(join(subject.root, 'tracked.txt'), 'locally owned bytes\n');
  observation = observeRepository({ repository: subject.root, profile: profile() });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.equal(canonical.dirtyTracked, true);
  assert.deepEqual(canonical.hiddenPaths, ['tracked.txt']);
  assert.deepEqual(canonical.indexToWorkingTree.map(({ path, status }) => ({ path, status })), [
    { path: 'tracked.txt', status: 'M' },
  ]);
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

test('structural health defers content but reports deletion and executable-bit changes', (t) => {
  const subject = repository(t);
  writeFileSync(join(subject.root, 'tracked.txt'), 'same type, authored content\n');
  let observation = observeRepository({ repository: subject.root, profile: profile(),
    mode: 'structural' });
  let canonical = observation.projections.find((item) => item.path === subject.root);
  assert.deepEqual(canonical.indexToWorkingTree, []);
  assert.equal(canonical.operationallyClean, null);
  assert.equal(observeRepository({ repository: subject.root, profile: profile(), mode: 'deep' })
    .canonical.operationallyClean, false);

  writeFileSync(join(subject.root, 'tracked.txt'), 'original\n');
  chmodSync(join(subject.root, 'tracked.txt'), 0o755);
  observation = observeRepository({ repository: subject.root, profile: profile(),
    mode: 'structural' });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.deepEqual(canonical.indexToWorkingTree.map(({ path, status }) => ({ path, status })),
    [{ path: 'tracked.txt', status: 'M' }]);
  assert.equal(canonical.operationallyClean, false);

  chmodSync(join(subject.root, 'tracked.txt'), 0o644);
  rmSync(join(subject.root, 'tracked.txt'));
  observation = observeRepository({ repository: subject.root, profile: profile(),
    mode: 'structural' });
  canonical = observation.projections.find((item) => item.path === subject.root);
  assert.deepEqual(canonical.indexToWorkingTree.map(({ path, status }) => ({ path, status })),
    [{ path: 'tracked.txt', status: 'D' }]);
  assert.equal(canonical.operationallyClean, false);
});

test('structural health defers nested submodule bytes while deep mode detects them', (t) => {
  const subject = repository(t), nested = join(subject.parent, 'nested-source');
  mkdirSync(nested);
  run(nested, 'init', '--quiet', '--initial-branch=main');
  run(nested, 'config', 'user.name', 'Fixture');
  run(nested, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(nested, 'nested.txt'), 'nested original\n');
  run(nested, 'add', 'nested.txt');
  run(nested, 'commit', '--quiet', '-m', 'nested base');
  run(subject.root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', nested,
    'nested');
  run(subject.root, 'commit', '--quiet', '-am', 'add nested module');
  writeFileSync(join(subject.root, 'nested', 'nested.txt'), 'nested authored bytes\n');

  const structural = observeRepository({ repository: subject.root, profile: profile(),
    mode: 'structural' });
  assert.equal(structural.canonical.operationallyClean, null);
  assert.deepEqual(structural.projections.find((item) => item.path === subject.root)
    .indexToWorkingTree, []);
  const deep = observeRepository({ repository: subject.root, profile: profile(), mode: 'deep' });
  assert.equal(deep.canonical.operationallyClean, false);
  assert.deepEqual(deep.projections.find((item) => item.path === subject.root)
    .trackedByteDriftPaths, ['nested']);
});

test('adapter validates exact version and fully-qualified ref classes', (t) => {
  const subject = repository(t);
  const wrongVersion = profile({
    adapters: { repository: { id: 'git', version: '2' }, provider: null },
  });
  assert.throws(() => observeRepository({ repository: subject.root, profile: wrongVersion }),
    /version 1/);
  assert.throws(() => profile({
    canonical: {
      localRef: 'refs/heads/trunk..bad',
      remoteRef: 'refs/remotes/upstream/trunk..bad',
    },
  }), /portable direct Git ref/);

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

test('repository and worktree identities preserve trailing whitespace and newlines', async (t) => {
  for (const name of ['repo ', 'repo\n']) await t.test(JSON.stringify(name), (child) => {
    const subject = repository(child, name);
    assert.equal(repoRoot(subject.root), subject.root);
    assert.equal(commonDir(subject.root), realpathSync(join(subject.root, '.git')));
    assert.deepEqual(worktrees(subject.root), [{
      path: subject.root, branch: 'trunk', detached: false,
    }]);
  });
});
