import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { validateRepositoryProfile } from '../src/governance.mjs';
import { deviceSegment, isLaneRef, laneRef } from '../src/lane-id.mjs';
import { runPinCheck } from '../bin/agentic-os-pin.mjs';
const ROOT = resolve(import.meta.dirname, '..');
const run = (cwd, cmd, args, env = {}) => spawnSync(cmd, args, {
  cwd, encoding: 'utf8', timeout: 60_000,
  env: { ...process.env, AGENTIC_OS_DEVICE: 'clone-test', ...env },
});
function must(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
const git = (cwd, ...args) => must(run(cwd, 'git', args));
const cli = (cwd, ...args) => run(cwd, process.execPath, ['bin/agentic-os.mjs', ...args]);
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'aos-clone-smoke-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const seed = join(parent, 'seed'); mkdirSync(seed);
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of new Set(files)) {
    if (!existsSync(join(ROOT, file))) continue;
    mkdirSync(dirname(join(seed, file)), { recursive: true });
    cpSync(join(ROOT, file), join(seed, file));
  }
  git(seed, 'init', '--quiet', '--initial-branch=main');
  git(seed, 'config', 'user.name', 'Clone Smoke'); git(seed, 'config', 'user.email', 'clone@example.invalid');
  git(seed, 'add', '.'); git(seed, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'candidate source');
  const clone = name => {
    const root = join(parent, name);
    git(parent, 'clone', '--quiet', '--no-local', seed, root);
    git(root, 'config', 'user.name', 'Clone Smoke'); git(root, 'config', 'user.email', 'clone@example.invalid');
    return root;
  };
  return { clone, parent };
}

test('fresh clone install and setup stay clean; fork refuses upstream trust then bootstraps', async t => {
  const { clone } = fixture(t), root = clone('upstream');
  const profile = JSON.parse(readFileSync(join(root, '.agentic-os.json')));
  git(root, 'remote', 'set-url', 'origin', `https://${profile.repository}.git`);
  must(run(root, 'npm', ['install'], { npm_config_audit: 'false', npm_config_fund: 'false' }));
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.ok(existsSync(join(root, 'package-lock.json')));
  must(cli(root, 'setup'));
  assert.equal(git(root, 'status', '--porcelain'), '');
  const trust = join(root, '.git/agentic-os/repository-trust.json');
  assert.equal(JSON.parse(readFileSync(trust)).repository, profile.repository);

  const fork = clone('fork'), forkRepository = 'github.com/forker-example/company-os';
  git(fork, 'remote', 'set-url', 'origin', `git@github.com:forker-example/company-os.git`);
  const refused = cli(fork, 'setup');
  assert.equal(refused.status, 1); assert.match(refused.stderr, /blocked-setup-repository-identity/);
  assert.equal(existsSync(join(fork, '.git/agentic-os/repository-trust.json')), false);
  assert.equal(run(fork, 'git', ['config', '--local', '--get', 'core.hooksPath']).status, 1);
  const original = readFileSync(join(fork, '.agentic-os.json'), 'utf8');
  const emitted = must(cli(fork, 'profile', 'init', `--repository=${forkRepository}`));
  const generated = validateRepositoryProfile(JSON.parse(emitted));
  assert.equal(generated.repository, forkRepository);
  assert.deepEqual(generated.capabilities, profile.capabilities);
  assert.deepEqual(generated.cleanup, profile.cleanup);
  assert.equal(readFileSync(join(fork, '.agentic-os.json'), 'utf8'), original);
  writeFileSync(join(fork, '.agentic-os.json'), `${emitted}\n`);
  git(fork, 'add', '.agentic-os.json'); git(fork, 'commit', '-qm', 'fork profile');
  // Simulate the fetched fork commit without contacting a real hosted repository.
  git(fork, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  must(cli(fork, 'setup'));
  const forkTrust = join(fork, '.git/agentic-os/repository-trust.json');
  const anchored = readFileSync(forkTrust, 'utf8');
  assert.equal(JSON.parse(anchored).repository, forkRepository);
  must(cli(fork, 'setup'));
  assert.equal(readFileSync(forkTrust, 'utf8'), anchored);
  git(fork, 'remote', 'set-url', 'origin', 'https://github.com/another/company-os.git');
  assert.equal(cli(fork, 'setup').status, 1);
  assert.equal(readFileSync(forkTrust, 'utf8'), anchored);

  const hooks = await import(pathToFileURL(join(root, 'bin/agentic-os-hooks.mjs')));
  assert.throws(() => hooks.runHookSetup(root, {
    protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main',
  }, profile, () => {}, { beforeFinalInspection: () => {
    git(root, 'remote', 'set-url', 'origin', 'https://github.com/another/company-os.git');
  } }), /final setup integrity failed/);
  assert.equal(JSON.parse(readFileSync(trust)).repository, profile.repository);

  const lockPath = join(root, 'catalog/composition-source-lock.json');
  const lock = JSON.parse(readFileSync(lockPath));
  lock.repository = 'forker-example/company-os';
  for (const [owner, value] of Object.entries(lock.owners)) value.repository = `forker-example/${owner}`;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const composition = await import(pathToFileURL(join(root, 'bin/composition-runtime-check.mjs')));
  git(root, 'remote', 'set-url', 'origin', `https://github.com/${lock.repository}.git`);
  const observed = composition.observeCompositionRuntime({ roots: { 'agentic-os': root } });
  assert.equal(observed.components['agentic-os'].repositoryIdentity, lock.repository);
  assert.equal(observed.components['agentic-os'].gitStatusCode, 'worktree_dirty');
  git(root, 'remote', 'set-url', 'origin', 'https://github.com/wrong/owner.git');
  assert.equal(composition.observeCompositionRuntime({ roots: { 'agentic-os': root } })
    .components['agentic-os'].gitStatusCode, 'git_origin_unexpected');
});

test('device aliases are explicit and hashed defaults retain old lane compatibility', () => {
  const old = process.env.AGENTIC_OS_DEVICE;
  delete process.env.AGENTIC_OS_DEVICE;
  try {
    assert.match(deviceSegment('Private Laptop.local'), /^device-[a-f0-9]{12}$/);
    assert.equal(deviceSegment('Private Laptop.local'), deviceSegment('private laptop.local'));
    assert.equal(deviceSegment('host', 'travel'), 'travel');
    assert.throws(() => deviceSegment('host', ''), /invalid device/);
    process.env.AGENTIC_OS_DEVICE = 'office';
    assert.equal(laneRef('fix'), 'agent/office/fix');
    assert.ok(isLaneRef('agent/legacy-host.local/fix'));
  } finally { old === undefined ? delete process.env.AGENTIC_OS_DEVICE : process.env.AGENTIC_OS_DEVICE = old; }
});

test('consumer pin check binds repository, revision, form, and lock without writes', t => {
  const root = mkdtempSync(join(tmpdir(), 'aos-consumer-pin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = JSON.parse(readFileSync(join(ROOT, '.agentic-os.json'))).repository.slice(11);
  const revision = git(ROOT, 'rev-parse', 'HEAD');
  const pin = `github:${repository}#${revision}`;
  const manifest = { devDependencies: { 'agentic-os': pin } };
  const lock = { lockfileVersion: 3, requires: true, packages: { '': manifest,
    'node_modules/agentic-os': { resolved: `git+ssh://git@github.com/${repository}.git#${revision}`,
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}` } } };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  let report;
  const check = () => runPinCheck(ROOT, [`--consumer=${root}`, `--revision=${revision}`], s => { report = JSON.parse(s); });
  assert.equal(check(), 0); assert.equal(report.observationOnly, true);
  lock.packages['node_modules/agentic-os'].resolved = `git+ssh://git@github.com/wrong/repo.git#${revision}`;
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.equal(check(), 1); assert.deepEqual(report.findings, ['consumer_lock_pin_invalid']);
});
