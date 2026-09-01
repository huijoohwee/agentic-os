import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { trustedRepositoryProfile } from '../bin/agentic-os-auxiliary.mjs';
import { formatRetainedOperation } from '../bin/agentic-os-report.mjs';
import {
  ensureRepositoryTrust, loadRepositoryTrust, repositoryTrustPath,
} from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function initializeRepository(t, prefix = 'agentic-os-trust-') {
  const parent = mkdtempSync(join(tmpdir(), prefix));
  const root = join(parent, 'repository');
  mkdirSync(root);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Trust Fixture');
  git('config', 'user.email', 'trust@example.invalid');
  return { parent, root, git };
}

function profile(capabilities = []) {
  return createRepositoryProfile({
    repository: 'example.invalid/owner/consumer',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    capabilities,
  });
}

test('a setup rejected by the clone-wide config lock publishes no repository trust', async (t) => {
  const { parent, root, git } = initializeRepository(t, 'agentic-os-trust-ordering-');
  const packed = join(parent, 'packed');
  mkdirSync(packed);
  const archive = join(packed, execFileSync('npm', [
    'pack', '--silent', '--pack-destination', packed,
  ], { cwd: ROOT, encoding: 'utf8' }).trim());
  writeFileSync(join(root, 'package.json'), '{"name":"consumer","private":true}\n');
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-package-lock', '--save-exact', archive,
  ], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile(), null, 2)}\n`);
  git('add', 'package.json', '.gitignore', '.agentic-os.json');
  git('commit', '--quiet', '--message', 'consumer');

  const commonDirectory = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const configLock = join(commonDirectory, 'agentic-os-configure.lock');
  mkdirSync(configLock);
  const cli = join(root, 'node_modules', '.bin', 'agentic-os');
  const result = spawnSync(cli, ['setup'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-concurrent-configure/u);
  assert.equal(statSync(repositoryTrustPath(root), { throwIfNoEntry: false }), undefined);

  rmSync(configLock, { recursive: true });
  const hooks = await import(pathToFileURL(join(
    root, 'node_modules', 'agentic-os', 'bin', 'agentic-os-hooks.mjs',
  )).href);
  const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
  let finalFailure;
  assert.throws(() => hooks.runHookSetup(root, policy, profile(), () => {}, {
    allowTrustCreation: true,
    beforeFinalInspection: () => {
      throw Object.assign(new Error('forced final setup inspection failure'), {
        reason: 'blocked-setup-integrity',
      });
    },
  }), (error) => {
    finalFailure = error;
    return error.retainedOperation === true;
  });
  const retained = JSON.parse(formatRetainedOperation(finalFailure));
  assert.equal(retained.operationCompleted, false);
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.artifacts.trustCreated, true);
  assert.equal(retained.artifacts.trustPath, repositoryTrustPath(root));
  assert.equal(retained.artifacts.stateDirectoryCreated, true);
  assert.equal(retained.artifacts.runtimeInstalled, true);
  assert.equal(retained.artifacts.configRetained, true);
  assert.ok(retained.artifacts.runtimeAncestorPaths.some(
    (path) => path.endsWith('/agentic-os/hook-runtimes')));
  const configured = spawnSync(cli, ['setup'], { cwd: root, encoding: 'utf8' });
  assert.equal(configured.status, 0, configured.stderr);
  const hooksPath = git('config', '--get', 'core.hooksPath');
  const configOutput = [];
  let configFailure;
  assert.throws(() => hooks.runHookSetup(root, policy, profile(),
    (line) => configOutput.push(line), {
      beforeFinalInspection: () => git(
        'config', '--local', '--replace-all', 'core.hooksPath', '.raced-hooks'),
    }), (error) => {
    configFailure = error;
    return error?.reason === 'blocked-config-race';
  });
  assert.ok(configFailure.findings.some(
    (entry) => entry.key === 'core.hooksPath' && entry.ok === false));
  assert.equal(configFailure.runtime.hooksPath, hooksPath);
  assert.equal(configOutput.some((line) => /configuration already correct|change\(s\) applied|verified/u
    .test(line)), false);
  assert.equal(git('config', '--get', 'core.hooksPath'), '.raced-hooks');
  git('config', '--local', '--replace-all', 'core.hooksPath', hooksPath);

  const trustOutput = [];
  let trustFailure;
  assert.throws(() => hooks.runHookSetup(root, policy, profile(),
    (line) => trustOutput.push(line), {
      beforeFinalInspection: () => rmSync(repositoryTrustPath(root)),
    }), (error) => {
    trustFailure = error;
    return error?.reason === 'blocked-setup-integrity'
      && error.cause?.reason === 'blocked-repository-trust-missing';
  });
  assert.ok(trustFailure.findings.some(
    (entry) => entry.key === 'repository.trust' && entry.ok === false));
  assert.equal(trustOutput.some((line) => /configuration already correct|change\(s\) applied|verified/u
    .test(line)), false);
  assert.equal(ensureRepositoryTrust(root, profile(), { allowCreate: true }).created, true);

  const statePath = join(commonDirectory, 'agentic-os');
  const displacedState = join(commonDirectory, 'agentic-os-displaced');
  const trustBytes = readFileSync(repositoryTrustPath(root));
  const swapOutput = [];
  let swapFailure;
  assert.throws(() => hooks.runHookSetup(root, policy, profile(),
    (line) => swapOutput.push(line), {
      beforeFinalTrustValidation: () => {
        renameSync(statePath, displacedState);
        mkdirSync(statePath, { mode: 0o700 });
        writeFileSync(repositoryTrustPath(root), trustBytes, { mode: 0o600 });
      },
    }), (error) => {
    swapFailure = error;
    return error?.reason === 'blocked-setup-integrity';
  });
  assert.ok(swapFailure.findings.some(
    (entry) => entry.key === 'setup.state' && entry.ok === false));
  assert.equal(swapOutput.some((line) => /configuration already correct|change\(s\) applied|verified/u
    .test(line)), false);
  assert.equal(statSync(join(statePath, 'hook-runtimes'), { throwIfNoEntry: false }), undefined,
    'replacement parent intentionally lacks the inspected runtime');
  rmSync(statePath, { recursive: true });
  renameSync(displacedState, statePath);
  rmSync(repositoryTrustPath(root));
  const lost = spawnSync(cli, ['setup'], { cwd: root, encoding: 'utf8' });
  assert.equal(lost.status, 1);
  assert.match(lost.stderr, /blocked-repository-trust-recovery-required/u);
  assert.equal(statSync(repositoryTrustPath(root), { throwIfNoEntry: false }), undefined);
});

test('same-canonical profile evolution preserves and satisfies stable repository trust', (t) => {
  const { root, git } = initializeRepository(t, 'agentic-os-trust-evolution-');
  const initial = profile();
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(initial, null, 2)}\n`);
  git('add', '.agentic-os.json');
  git('commit', '--quiet', '--message', 'initial profile');
  assert.equal(ensureRepositoryTrust(root, initial, { allowCreate: true }).created, true);
  const trustPath = repositoryTrustPath(root);
  const trustBytes = readFileSync(trustPath);

  const evolved = profile(['deep-byte-audit-opt-in']);
  assert.notEqual(evolved.profileDigest, initial.profileDigest);
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(evolved, null, 2)}\n`);
  git('add', '.agentic-os.json');
  git('commit', '--quiet', '--message', 'evolved profile');

  const observed = trustedRepositoryProfile(root);
  assert.equal(observed.profile.profileDigest, evolved.profileDigest);
  assert.equal(ensureRepositoryTrust(root, evolved).created, false);
  assert.deepEqual(readFileSync(trustPath), trustBytes);
});

test('setup cannot spend a first-setup allowance after a preloaded anchor disappears', async (t) => {
  const { parent, root, git } = initializeRepository(t, 'agentic-os-trust-stale-');
  const packed = join(parent, 'packed');
  mkdirSync(packed);
  const archive = join(packed, execFileSync('npm', [
    'pack', '--silent', '--pack-destination', packed,
  ], { cwd: ROOT, encoding: 'utf8' }).trim());
  writeFileSync(join(root, 'package.json'), '{"name":"consumer","private":true}\n');
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-package-lock', '--save-exact', archive,
  ], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  const committed = profile();
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(committed, null, 2)}\n`);
  git('add', 'package.json', '.gitignore', '.agentic-os.json');
  git('commit', '--quiet', '--message', 'consumer');

  assert.equal(ensureRepositoryTrust(root, committed, { allowCreate: true }).created, true);
  const preloaded = trustedRepositoryProfile(root);
  assert.notEqual(preloaded.trust, null);
  rmSync(repositoryTrustPath(root));
  const hooks = await import(pathToFileURL(join(
    root, 'node_modules', 'agentic-os', 'bin', 'agentic-os-hooks.mjs',
  )).href);
  assert.throws(() => hooks.runHookSetup(root, {
    protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main',
  }, committed, () => {}, { allowTrustCreation: preloaded.trust === null }),
  (error) => error?.reason === 'blocked-repository-trust-recovery-required');
  assert.equal(statSync(repositoryTrustPath(root), { throwIfNoEntry: false }), undefined);
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: root, encoding: 'utf8',
  }).status, 1, 'stale trust admission must stop before managed configuration');

  assert.equal(ensureRepositoryTrust(root, committed, { allowCreate: true }).created, true);
  const conflicting = createRepositoryProfile({
    repository: 'example.invalid/other/consumer',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  assert.throws(() => hooks.runHookSetup(root, {
    protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main',
  }, conflicting, () => {}, { allowTrustCreation: false }),
  (error) => error?.reason === 'blocked-repository-trust-conflict');
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: root, encoding: 'utf8',
  }).status, 1, 'trust conflict must stop before managed configuration');
});

test('trust creation requires an explicit first-setup allowance', (t) => {
  const { root } = initializeRepository(t, 'agentic-os-trust-allowance-');
  assert.throws(() => ensureRepositoryTrust(root, profile()),
    (error) => error?.reason === 'blocked-repository-trust-missing');
  assert.equal(statSync(repositoryTrustPath(root), { throwIfNoEntry: false }), undefined);
  assert.equal(ensureRepositoryTrust(root, profile(), { allowCreate: true }).created, true);
});

test('first setup identity-binds and tightens a legacy lane-cache parent without byte loss', (t) => {
  const { root, git } = initializeRepository(t, 'agentic-os-trust-legacy-parent-');
  const committed = profile();
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(committed, null, 2)}\n`);
  git('add', '.agentic-os.json');
  git('commit', '--quiet', '--message', 'profile');
  const directory = join(git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'agentic-os');
  mkdirSync(directory, { mode: 0o755 });
  chmodSync(directory, 0o755);
  const lanes = join(directory, 'lanes.json');
  const laneBytes = Buffer.from('{"schema":"agentic-os/lanes/v1","lanes":{}}\n');
  writeFileSync(lanes, laneBytes, { mode: 0o600 });

  assert.throws(() => loadRepositoryTrust(root, { required: false }),
    (error) => error?.reason === 'blocked-repository-trust-invalid');
  const admitted = trustedRepositoryProfile(root, { allowUnanchored: true });
  assert.equal(admitted.trust, null);
  const effects = [];
  assert.equal(ensureRepositoryTrust(root, committed, {
    allowCreate: true, onEffect: (effect) => effects.push(effect),
  }).created, true);
  assert.deepEqual(effects, [
    { statePath: directory, stateDirectoryTightenAttempted: true,
      stateDirectoryTightenResultUnknown: true },
    { statePath: directory, stateDirectoryTightenResultUnknown: false,
      stateDirectoryTightened: true },
    { trustPath: repositoryTrustPath(root), trustWriteAttempted: true,
      trustWriteResultUnknown: true },
    { trustPath: repositoryTrustPath(root), trustCreated: true,
      trustWriteResultUnknown: false },
  ]);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(lanes), laneBytes);
  assert.equal(loadRepositoryTrust(root).repository, committed.repository);
});

test('post-fchmod replacement still reports the exact retained directory tightening', (t) => {
  const { root, git } = initializeRepository(t, 'agentic-os-trust-tighten-race-');
  const committed = profile();
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(committed, null, 2)}\n`);
  git('add', '.agentic-os.json'); git('commit', '--quiet', '--message', 'profile');
  const directory = join(git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'agentic-os');
  const displaced = `${directory}-displaced`;
  mkdirSync(directory, { mode: 0o755 }); chmodSync(directory, 0o755);
  const effects = [];
  assert.throws(() => ensureRepositoryTrust(root, committed, {
    allowCreate: true,
    onEffect: (effect) => {
      effects.push({ ...effect });
      if (effect.stateDirectoryTightened) {
        renameSync(directory, displaced); mkdirSync(directory, { mode: 0o700 });
      }
    },
  }), (error) => error.reason === 'blocked-repository-trust-invalid');
  assert.deepEqual(effects, [{
    statePath: directory, stateDirectoryTightenAttempted: true,
    stateDirectoryTightenResultUnknown: true,
  }, {
    statePath: directory, stateDirectoryTightenResultUnknown: false,
    stateDirectoryTightened: true,
  }]);
  assert.equal(statSync(displaced).mode & 0o777, 0o700);
  assert.equal(statSync(repositoryTrustPath(root), { throwIfNoEntry: false }), undefined);
});

test('failed trust creation reobserves and retains a partial no-overwrite path', (t) => {
  const { root, git } = initializeRepository(t, 'agentic-os-trust-write-race-');
  const committed = profile();
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(committed, null, 2)}\n`);
  git('add', '.agentic-os.json'); git('commit', '--quiet', '--message', 'profile');
  const effects = [];
  let injected = false;
  assert.throws(() => ensureRepositoryTrust(root, committed, {
    allowCreate: true,
    onEffect: (effect) => {
      effects.push({ ...effect });
      if (!injected && effect.trustWriteAttempted) {
        injected = true; writeFileSync(effect.trustPath, 'partial', { flag: 'wx', mode: 0o600 });
        throw new Error('injected write response loss');
      }
    },
  }), /injected write response loss/u);
  const observed = effects.at(-1);
  assert.equal(observed.trustWriteResultUnknown, true);
  assert.equal(observed.trustWriteObservedPathExists, true);
  assert.equal(observed.trustWriteObservedKind, 'file');
  assert.equal(observed.trustWriteObservedSize, 7);
  assert.equal(readFileSync(repositoryTrustPath(root), 'utf8'), 'partial');
});
