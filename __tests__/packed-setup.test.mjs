import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  assertPriorManagedRuntime, describeHookRuntime,
} from '../bin/agentic-os-hook-runtime.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function installPriorReleaseRuntime(selected, { authorityRelease = false } = {}) {
  const files = selected.files.map((file) => {
    let source = file.bytes.toString('utf8');
    if (file.path === 'src/git.mjs') source = source
      .replace('decodeNulFields, dirtyTracked, shallowTrackedChanges, trackedChanges',
        'decodeNulFields, dirtyTracked, trackedChanges')
      .replace(
        "/** Strict detailed worktree state for lifecycle decisions; includes head and retention flags. */\nexport function worktreeInventory(cwd = process.cwd()) {\n  return parseWorktreeList(observeGit([\n    'worktree', 'list', '--porcelain', '-z', '--expire=now',\n  ], { cwd, binary: true, maxBuffer: 16 * 1024 * 1024 }), { detailed: true });\n}\n\n", '\n');
    if (file.path === 'src/git-tracked.mjs') source = source
      .replace('/** Sanitized Git execution plus exact tracked-byte observation. */\n',
        '/** Sanitized Git execution plus exact tracked-byte observation. */\n\n')
      .replace("import { TextDecoder } from 'node:util';\nexport class GitError",
        "import { TextDecoder } from 'node:util';\n\nexport class GitError")
      .replace('\nfunction mutationEnvironment(', '\n\nfunction mutationEnvironment(')
      .replace('\nfunction observationEnvironment(', '\n\nfunction observationEnvironment(')
      .replace('\n/** Execute a Git mutation', '\n\n/** Execute a Git mutation')
      .replace('\n/** Local Git observation', '\n\n/** Local Git observation')
      .replace('\nfunction outputLines(', '\n\nfunction outputLines(')
      .replace('\nexport const TRACKED_FILE_LIMITS', '\n\nexport const TRACKED_FILE_LIMITS')
      .replace('\nfunction childEnvironment(', '\n\nfunction childEnvironment(')
      .replace('\nexport function rawTrackedFileMatches(',
        '\n\nexport function rawTrackedFileMatches(')
      .replace(/export function dirtyTracked[\s\S]+?\n\}\n\nconst UTF8/u,
        `export function dirtyTracked(cwd = process.cwd()) {
  const changes = trackedChanges(cwd);
  return changes.headToIndex.length > 0 || changes.indexToWorkingTree.length > 0;
}

/** Conservative exact-byte risks; publication can skip ignored-only ownership enumeration. */
export function worktreeCleanupRisks(cwd = process.cwd(), { includeIgnored = true } = {}) {
  const hidden = strictGitPaths(['ls-files', '-v', '-z'], cwd).filter((record) => {
    const tag = record[0];
    return tag >= 'a' && tag <= 'z' || tag?.toUpperCase() === 'S';
  }).map((record) => record.slice(2));
  const tracked = [];
  for (const record of strictGitPaths(['ls-tree', '-r', '-z', 'HEAD'], cwd)) {
    const tab = record.indexOf('\\t');
    if (tab < 0) { tracked.push('[malformed-tree-entry]'); continue; }
    const [mode, , oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (!trackedEntryMatches({ mode, oid, path }, cwd, includeIgnored)) tracked.push(path);
  }
  return { dirtyTracked: dirtyTracked(cwd), hidden,
    owned: untrackedPaths(cwd, { includeIgnored }), tracked };
}

const UTF8`)
      .replace(/function parseRawDiff\(cwd, args, label\) \{[\s\S]+?\n\}\n\nfunction headToIndexChanges[\s\S]+?\n\}\n\n\/\*\* Raw local tracked projections/u,
        `function parseRawDiff(cwd) {
  const fields = decodeNulFields(observeGit([
    'diff', '--cached', '--raw', '-z', '--no-renames', '--abbrev=64', 'HEAD', '--',
  ], { cwd, binary: true, allowFail: true }));
  if (!fields || fields.length % 2 !== 0) {
    const error = new Error('Git HEAD-to-index projection is unavailable');
    error.reason = 'blocked-invalid-path-inventory';
    throw error;
  }
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = fields[index].match(
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/u,
    );
    if (!match) {
      const error = new Error('Git HEAD-to-index projection is malformed');
      error.reason = 'blocked-invalid-path-inventory';
      throw error;
    }
    entries.push({ path: fields[index + 1], status: match[5], oldMode: match[1],
      newMode: match[2], oldObject: match[3], newObject: match[4] });
  }
  return entries;
}

/** Raw local tracked projections`)
      .replace('export function trackedChanges(cwd = process.cwd()) {\n  const indexToWorkingTree = [];\n  const entries = parseIndexEntries(cwd);\n  const headToIndex = headToIndexChanges(cwd);',
        'export function trackedChanges(cwd = process.cwd()) {\n  const headToIndex = parseRawDiff(cwd);\n  const indexToWorkingTree = [];\n  const entries = parseIndexEntries(cwd);')
      .replace('  const headToIndex = headToIndexChanges(cwd);\n  const hidden = strictGitPaths',
        '  const hidden = strictGitPaths')
      .replace(/  const headToIndexAfter = headToIndexChanges\(cwd\);[\s\S]+?  return \{ dirtyTracked: headToIndex.length > 0 \|\| tracked.length > 0, hidden,/u,
        '  return { dirtyTracked: dirtyTracked(cwd), hidden,')
      .replace('export function parseWorktreeList(raw, { detailed = false } = {}) {',
        'export function parseWorktreeList(raw) {')
      .replace("    entries.push(detailed ? { ...current }\n      : { path: current.path, branch: current.branch, detached: current.detached });",
        '    entries.push({ path: current.path, branch: current.branch, detached: current.detached });');
    if (file.path === 'src/git-repository.mjs') source = source
      .replace('  shallowTrackedChanges,\n', '')
      .replace("  'structural-health-observation',\n", '')
      .replace("  const { headToIndex, indexToWorkingTree } = mode === 'structural'\n    ? shallowTrackedChanges(path) : trackedChanges(path);",
        '  const { headToIndex, indexToWorkingTree } = trackedChanges(path);')
      .replace('    owned: exact?.owned ?? untrackedPaths(path, { includeIgnored: false }),',
        '    owned: untrackedPaths(path),')
      .replace('      ownedPathScope: null, ', '      ')
      .replace(/  const knownRisk = observedRisks\.dirtyTracked[\s\S]+?observedRisks\.tracked\.length > 0;\n/u, '')
      .replace("    operationallyClean: mode === 'structural' ? knownRisk ? false : null : !knownRisk,",
        '    operationallyClean: !observedRisks.dirtyTracked && observedRisks.hidden.length === 0\n      && (observedRisks.tracked === null || observedRisks.tracked.length === 0),')
      .replace("    ownedPathScope: mode === 'deep' ? 'visible-and-ignored' : 'visible',\n", '')
      .replace("  if (!['shallow', 'deep', 'structural'].includes(mode))\n    throw new TypeError('observation mode is invalid');",
        "  if (!['shallow', 'deep'].includes(mode)) throw new TypeError('observation mode is invalid');")
      .replace("import { governanceDigest, validateRepositoryProfile } from './governance.mjs';",
        "import {\n  RETAIN_ALL_CLEANUP,\n  governanceDigest,\n  validateRepositoryProfile,\n} from './governance.mjs';")
      .replace("  'quarantine-worktree-cleanup-opt-in',\n", '')
      .replace('    capabilities: [...profile.capabilities],',
        '    capabilities: [...GIT_CAPABILITIES],')
      .replace('    cleanup: { ...profile.cleanup },', '    cleanup: { ...RETAIN_ALL_CLEANUP },');
    if (file.path === 'src/governance.mjs') source = source
      .replace("  'quarantine-worktree-cleanup-opt-in required-check-policy:strict retain-all-cleanup ' +\n  'shallow-observation-default tested-protected-ordering:merge-queue'",
        "  'required-check-policy:strict retain-all-cleanup shallow-observation-default ' +\n  'tested-protected-ordering:merge-queue'")
      .replace('  return encoded; }', '  return encoded;\n}')
      .replace('  Object.values(value).forEach(frozen); return Object.freeze(value); }',
        '  Object.values(value).forEach(frozen);\n  return Object.freeze(value);\n}')
      .replace("  const quarantineKeys = ['worktreeProjection', 'worktreeRegistration'];\n  for (const key of CLEANUP_KEYS) if (value[key] !== 'retain'\n    && (!quarantineKeys.includes(key) || value[key] !== 'quarantine'))\n    fail(`cleanup.${key} selects an unsupported effect`);\n  if ((value.worktreeProjection === 'quarantine') !== (value.worktreeRegistration === 'quarantine')) fail('cleanup quarantine requires exact projection and registration opt-in');\n  return { ...value };",
        "  const result = Object.fromEntries(CLEANUP_KEYS.map((key) => {\n    if (value[key] !== 'retain') fail(`cleanup.${key} must retain consumer-owned state`);\n    return [key, 'retain'];\n  }));\n  return result;")
      .replace("  const cleanupPolicy = cleanup(source.cleanup);\n  const cleanupCapability = Object.values(cleanupPolicy).every((value) => value === 'retain')\n    ? 'retain-all-cleanup' : 'quarantine-worktree-cleanup-opt-in';\n  const requestedCapabilities = strings(source.capabilities ?? [], 'capabilities');\n  const conflicting = cleanupCapability === 'retain-all-cleanup'\n    ? 'quarantine-worktree-cleanup-opt-in' : 'retain-all-cleanup';\n  if (requestedCapabilities.includes(conflicting)) fail('cleanup capability conflicts with selected effects');\n  const capabilities = strings([...requestedCapabilities.filter((value) => value !== conflicting\n    && value !== cleanupCapability), cleanupCapability], 'capabilities');",
        "  const capabilities = strings(source.capabilities ?? [], 'capabilities');")
      .replace('    requiredChecks, capabilities,\n    authority: { ...CONSUMER_AUTHORITY }, cleanup: cleanupPolicy,',
        '    requiredChecks,\n    capabilities,\n    authority: { ...CONSUMER_AUTHORITY },\n    cleanup: cleanup(source.cleanup),')
      .replace('  const source = snapshot(input), payload = profilePayload(source), profileDigest = governanceDigest(payload);\n  if (source.profileDigest !== undefined && source.profileDigest !== profileDigest) fail(\'profileDigest mismatch\');',
        "  const source = snapshot(input);\n  const payload = profilePayload(source);\n  const profileDigest = governanceDigest(payload);\n  if (source.profileDigest !== undefined && source.profileDigest !== profileDigest)\n    fail('profileDigest does not match repository profile');")
      .replace('  const source = snapshot(value); exactKeys(source, PROFILE_KEYS, \'repository profile\');',
        "  const source = snapshot(value);\n  exactKeys(source, PROFILE_KEYS, 'repository profile');");
    if (file.path === 'src/governance.mjs' && !authorityRelease) source = source
      .replace(/export function deriveCoordinationClaimId\([^\n]+\n/u, '')
      .replace('source.claimId ?? deriveCoordinationClaimId(identity)',
        "source.claimId ?? governanceDigest({ schema: 'agentic-os/claim-id/v1', ...identity })");
    const bytes = Buffer.from(source);
    const expected = { 'src/git.mjs': '77d8b768ff6ce9d5b54a198b8463a5a54db0c175560aa8b6dd9d6cca3679ea24',
      'src/git-repository.mjs': 'd8e5d32a6ff57b18279d1d34c1ce338771442521d188a46228f1d3779fec0b3b',
      'src/git-tracked.mjs': '664364b8453ea69a6f5458abc038494eda2551320f58677dab9f24db68ec2503',
      'src/governance.mjs': authorityRelease
        ? '673b3fec205895ba72bb08519188225c049aa322e0cac563f7de304986c0c402'
        : '5c9790eb4dac5b7d2a41dd2287cd74327b6f21082646b4d69813606e36512bd2' }[file.path];
    if (expected === undefined) return file;
    assert.equal(digest(bytes), expected);
    return { ...file, bytes, sha256: digest(bytes) };
  });
  const identity = { schema: 'agentic-os/hook-runtime/v1',
    files: files.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })) };
  const runtimeId = `v1-${digest(Buffer.from(JSON.stringify(identity)))}`;
  assert.equal(runtimeId, authorityRelease
    ? 'v1-aeca6cdae21159346f98bbf744ae7a2b51d95b9040b048bb0cc64b40ea994c72'
    : 'v1-c738e450c02b8e6ea7cc322e41db9f79ebb9bca15de10545e2a2364973428bd0');
  const manifest = { schema: identity.schema, runtimeId, files: identity.files };
  const path = join(selected.managedRoot, runtimeId);
  mkdirSync(path, { mode: 0o700 });
  for (const name of ['.githooks', 'bin', 'src']) mkdirSync(join(path, name), { mode: 0o700 });
  for (const file of files) {
    const target = join(path, file.path);
    writeFileSync(target, file.bytes, { mode: file.mode }); chmodSync(target, file.mode);
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(path, 'runtime-manifest.json'), manifestBytes, { mode: 0o600 });
  chmodSync(join(path, 'runtime-manifest.json'), 0o600);
  return { path, hooksPath: join(path, '.githooks'), manifestBytes };
}

function runChild(file, args, options) {
  return new Promise((resolveResult) => {
    const child = spawn(file, args, options);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolveResult({ status, signal, stdout, stderr }));
  });
}

test('published files contain public JSON and adapters without deleted deep imports', () => {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  const files = new Set(packed[0].files.map((entry) => entry.path));
  for (const path of [
    '.agentic-os.json',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    'src/governance.mjs',
    'src/git-repository.mjs',
    'src/github-provider.mjs',
    'docs/GOVERNANCE.md',
    'docs/adlc-guidelines.md',
    'templates/SYSTEM-PROMPT-RUNTIME.md',
  ]) assert.equal(files.has(path), true, `${path} must be packed`);
  assert.equal(files.has('src/bounded-read.mjs'), false);
  assert.equal(files.has('src/readiness-test-reporter.mjs'), false);
  assert.equal(files.has('src/wip.mjs'), false);
});

test('packed setup is canonical, durable, integrity-bound, and no-clobber', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-installed-consumer-'));
  const repository = join(parent, 'repository');
  const lane = join(parent, 'lane');
  const packed = join(parent, 'packed');
  mkdirSync(repository);
  mkdirSync(packed);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const archive = join(packed, execFileSync('npm', [
    'pack', '--silent', '--pack-destination', packed,
  ], { cwd: ROOT, encoding: 'utf8' }).trim());
  writeFileSync(join(repository, 'package.json'), '{"name":"consumer","private":true}\n');
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-package-lock', '--save-exact', archive,
  ], { cwd: repository, stdio: 'pipe' });
  const legacyHooks = join(repository, '.githooks');
  mkdirSync(legacyHooks);
  for (const hook of ['pre-commit', 'pre-push']) {
    const source = join(repository, 'node_modules', 'agentic-os', '.githooks', hook);
    const target = join(legacyHooks, hook);
    copyFileSync(source, target); chmodSync(target, 0o755);
  }
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Consumer Fixture'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'consumer@example.invalid'], { cwd: repository });
  writeFileSync(join(repository, '.gitignore'), 'node_modules/\n');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/consumer',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(repository, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  execFileSync('git', ['add', 'package.json', '.gitignore', '.agentic-os.json', '.githooks'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '--message', 'consumer'], { cwd: repository });
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'agent/device/setup-test', lane, 'main'], {
    cwd: repository,
  });
  execFileSync('npm', ['install', '--ignore-scripts', '--no-package-lock'], {
    cwd: lane, stdio: 'pipe',
  });

  const cli = join(repository, 'node_modules', '.bin', 'agentic-os');
  const laneCli = join(lane, 'node_modules', '.bin', 'agentic-os');
  const nodeModules = join(repository, 'node_modules');
  const commonDirectory = execFileSync('git', [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ], { cwd: repository, encoding: 'utf8' }).trim();
  const managedRoot = join(commonDirectory, 'agentic-os', 'hook-runtimes');
  const laneBlocked = spawnSync(laneCli, ['setup'], { cwd: lane, encoding: 'utf8' });
  assert.equal(laneBlocked.status, 1);
  assert.match(laneBlocked.stderr, /blocked-canonical-setup-required/u);

  execFileSync('git', ['switch', '--quiet', '-c', 'feature/setup-wrong-branch'], { cwd: repository });
  for (const command of ['setup', 'git-configure', 'guard-install']) {
    const wrongBranch = spawnSync(cli, [command], { cwd: repository, encoding: 'utf8' });
    assert.equal(wrongBranch.status, 1);
    assert.match(wrongBranch.stderr,
      /blocked-canonical-branch-required|committed profile does not bind the primary canonical branch/u);
  }
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: repository });
  execFileSync('git', ['switch', '--quiet', '--detach'], { cwd: repository });
  const detached = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(detached.status, 1);
  assert.match(detached.stderr, /primary canonical worktree identity is unavailable/u);
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: repository });

  const inherited = join(parent, 'global.gitconfig');
  execFileSync('git', ['config', '--file', inherited, 'core.hooksPath', '.inherited-hooks']);
  const inheritedBlocked = spawnSync(cli, ['setup'], {
    cwd: repository, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: inherited },
  });
  assert.equal(inheritedBlocked.status, 1);
  assert.match(inheritedBlocked.stderr, /blocked-existing-hooks-path/u);

  execFileSync('git', ['config', 'core.hooksPath', '.legacy-hooks'], { cwd: repository });
  const blocked = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /blocked-existing-hooks-path/u);
  assert.equal(execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repository, encoding: 'utf8',
  }).trim(), '.legacy-hooks');
  assert.notEqual(spawnSync('git', ['config', '--get', 'rerere.enabled'], {
    cwd: repository,
  }).status, 0, 'hook preflight must precede every config write');

  execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: repository });
  const defaultHook = join(repository, '.git', 'hooks', 'pre-commit');
  writeFileSync(defaultHook, '#!/bin/sh\nexit 0\n');
  chmodSync(defaultHook, 0o755);
  const defaultBlocked = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(defaultBlocked.status, 1);
  assert.match(defaultBlocked.stderr, /blocked-existing-default-hooks/u);
  rmSync(defaultHook);

  assert.equal(spawnSync('mkfifo', [defaultHook]).status, 0);
  chmodSync(defaultHook, 0o755);
  const defaultFifoBlocked = spawnSync(cli, ['setup'], {
    cwd: repository, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(defaultFifoBlocked.signal, null, 'default hook FIFO inspection timed out');
  assert.equal(defaultFifoBlocked.status, 1);
  assert.match(defaultFifoBlocked.stderr, /blocked-existing-default-hooks/u);
  rmSync(defaultHook);

  assert.equal(statSync(managedRoot, { throwIfNoEntry: false }), undefined,
    'no-effect setup refusals must not create a managed runtime');

  const transitiveSource = join(nodeModules, 'agentic-os', 'src', 'guard-main.mjs');
  const exactTransitiveSource = readFileSync(transitiveSource);
  writeFileSync(transitiveSource, Buffer.concat([exactTransitiveSource, Buffer.from('\n')]));
  const sourceDrift = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(sourceDrift.status, 1);
  assert.match(sourceDrift.stderr, /blocked-hook-runtime-integrity/u);
  assert.equal(statSync(managedRoot, { throwIfNoEntry: false }), undefined,
    'ignored transitive package drift must fail before runtime publication');
  writeFileSync(transitiveSource, exactTransitiveSource);

  const filterHelper = join(nodeModules, 'agentic-os', 'bin', 'agentic-os-filter-compare.mjs');
  const exactFilterHelper = readFileSync(filterHelper);
  writeFileSync(filterHelper, Buffer.concat([exactFilterHelper, Buffer.from('\n') ]));
  const helperDrift = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(helperDrift.status, 1);
  assert.match(helperDrift.stderr, /blocked-hook-runtime-integrity/u);
  assert.equal(statSync(managedRoot, { throwIfNoEntry: false }), undefined,
    'ignored helper drift must fail before runtime publication');
  writeFileSync(filterHelper, exactFilterHelper);

  const contestedRuntime = describeHookRuntime(repository, {
    sourceRoot: join(nodeModules, 'agentic-os'),
  });
  mkdirSync(contestedRuntime.path, { recursive: true });
  const foreignEntry = join(contestedRuntime.path, 'foreign-entry');
  writeFileSync(foreignEntry, 'foreign\n');
  const contested = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(contested.status, 1);
  assert.match(contested.stderr, /blocked-repository-trust-recovery-required/u);
  assert.equal(readFileSync(foreignEntry, 'utf8'), 'foreign\n');
  rmSync(managedRoot, { recursive: true });

  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: repository });
  const migratedRootHooks = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(migratedRootHooks.status, 0, migratedRootHooks.stderr);
  assert.notEqual(execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repository, encoding: 'utf8',
  }).trim(), '.githooks');

  const attempts = await Promise.all([
    runChild(cli, ['setup'], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] }),
    runChild(cli, ['setup'], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] }),
  ]);
  assert.ok(attempts.some((attempt) => attempt.status === 0), JSON.stringify(attempts));
  for (const attempt of attempts.filter((entry) => entry.status !== 0))
    assert.match(attempt.stderr, /blocked-concurrent-configure/u);
  const localValues = execFileSync('git', [
    'config', '--local', '--get-all', 'core.hooksPath',
  ], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
  assert.equal(localValues.length, 1);
  const hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repository, encoding: 'utf8',
  }).trim();
  assert.equal(relative(managedRoot, dirname(hooksPath)).startsWith('..'), false);
  assert.equal(hooksPath.includes('node_modules'), false);
  for (const hook of ['pre-commit', 'pre-push'])
    assert.notEqual(statSync(join(hooksPath, hook)).mode & 0o111, 0, `${hook} must be executable`);

  const priorRuntime = installPriorReleaseRuntime(contestedRuntime);
  assert.notEqual(priorRuntime.hooksPath, hooksPath);
  execFileSync('git', ['config', '--local', '--fixed-value', '--replace-all',
    'core.hooksPath', priorRuntime.hooksPath, hooksPath], { cwd: repository });
  const releaseMigration = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(releaseMigration.status, 0, releaseMigration.stderr);
  const migratedValues = execFileSync('git', [
    'config', '--local', '--get-all', 'core.hooksPath',
  ], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(migratedValues, [hooksPath]);
  assert.equal(assertPriorManagedRuntime(priorRuntime.hooksPath, contestedRuntime), true);
  assert.deepEqual(readFileSync(join(priorRuntime.path, 'runtime-manifest.json')),
    priorRuntime.manifestBytes);
  const authorityRuntime = installPriorReleaseRuntime(contestedRuntime, { authorityRelease: true });
  assert.equal(assertPriorManagedRuntime(authorityRuntime.hooksPath, contestedRuntime), true);
  assert.deepEqual(readFileSync(join(authorityRuntime.path, 'runtime-manifest.json')),
    authorityRuntime.manifestBytes);
  const authorityGovernance = join(authorityRuntime.path, 'src/governance.mjs');
  writeFileSync(authorityGovernance, Buffer.concat([
    readFileSync(authorityGovernance), Buffer.from('\n'),
  ]));
  assert.throws(() => assertPriorManagedRuntime(authorityRuntime.hooksPath, contestedRuntime),
    /managed hook runtime integrity failed/u);
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: repository });
  const migratedDoctor = spawnSync(cli, ['doctor'], { cwd: repository, encoding: 'utf8' });
  assert.equal(migratedDoctor.status, 0, migratedDoctor.stderr || migratedDoctor.stdout);

  const installedCommit = spawnSync(join(hooksPath, 'pre-commit'), [], {
    cwd: repository, encoding: 'utf8',
  });
  assert.equal(installedCommit.status, 1, installedCommit.stderr);
  assert.match(installedCommit.stderr, /refusing to commit on "main"/u);
  const installedPush = spawnSync(join(hooksPath, 'pre-push'), ['origin', 'fixture'], {
    cwd: repository, encoding: 'utf8', input: `refs/heads/main ${'a'.repeat(40)} `
      + `refs/heads/main ${'0'.repeat(40)}\n`,
  });
  assert.equal(installedPush.status, 1, installedPush.stderr);
  assert.match(installedPush.stderr, /refusing to push directly to refs\/heads\/main/u);

  execFileSync('git', ['switch', '--quiet', 'feature/setup-wrong-branch'], { cwd: repository });
  const selfBinding = createRepositoryProfile({
    repository: profile.repository,
    canonical: {
      localRef: 'refs/heads/feature/setup-wrong-branch',
      remoteRef: 'refs/remotes/origin/feature/setup-wrong-branch',
    },
    adapters: profile.adapters,
  });
  writeFileSync(join(repository, '.agentic-os.json'), `${JSON.stringify(selfBinding, null, 2)}\n`);
  execFileSync('git', ['add', '.agentic-os.json'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '--message', 'self-binding candidate'], {
    cwd: repository, env: { ...process.env, AGENTIC_OS_ALLOW_CANONICAL_WRITE: '1' },
  });
  const reanchor = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(reanchor.status, 1);
  assert.match(reanchor.stderr, /expected canonical branch main/u);
  const anchoredGuard = join(hooksPath, '..', 'src', 'guard-main.mjs');
  const protectedRef = spawnSync(process.execPath, [anchoredGuard, 'protected-ref'], {
    cwd: repository, encoding: 'utf8',
  });
  assert.equal(protectedRef.status, 0, protectedRef.stderr);
  assert.equal(protectedRef.stdout.trim(), 'refs/heads/main');
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: repository });

  const unavailableModules = join(parent, 'node_modules-unavailable');
  renameSync(nodeModules, unavailableModules);
  try {
    const guardedWithoutPackage = spawnSync('git', [
      'commit', '--allow-empty', '--message', 'must remain blocked',
    ], { cwd: repository, encoding: 'utf8' });
    assert.equal(guardedWithoutPackage.status, 1);
    assert.match(guardedWithoutPackage.stderr, /refusing to commit on "main"/u);
  } finally {
    renameSync(unavailableModules, nodeModules);
  }

  const legacySelfHooks = join(nodeModules, 'agentic-os', '.githooks');
  execFileSync('git', ['config', 'core.hooksPath', legacySelfHooks], { cwd: repository });
  const migrated = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.equal(execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repository, encoding: 'utf8',
  }).trim(), hooksPath);

  const externalHookLink = join(parent, 'external-pre-commit-link');
  linkSync(join(hooksPath, 'pre-commit'), externalHookLink);
  const hardlinked = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(hardlinked.status, 1);
  assert.match(hardlinked.stderr, /blocked-hook-runtime-integrity/u);
  rmSync(externalHookLink);

  execFileSync('git', ['config', 'extensions.worktreeConfig', 'true'], { cwd: repository });
  execFileSync('git', ['config', '--worktree', 'core.hooksPath', '.bypass-hooks'], { cwd: lane });
  const worktreeBlocked = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(worktreeBlocked.status, 1);
  assert.match(worktreeBlocked.stderr, /blocked-existing-hooks-path/u);
  execFileSync('git', ['config', '--worktree', '--unset', 'core.hooksPath'], { cwd: lane });

  writeFileSync(join(hooksPath, 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const drifted = spawnSync(cli, ['setup'], { cwd: repository, encoding: 'utf8' });
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /blocked-hook-runtime-integrity/u);
  const doctor = spawnSync(cli, ['doctor'], { cwd: repository, encoding: 'utf8' });
  assert.match(doctor.stdout, /FAIL hook\.pre-commit/u);

  rmSync(join(hooksPath, 'pre-commit'));
  assert.equal(spawnSync('mkfifo', [join(hooksPath, 'pre-commit')]).status, 0);
  chmodSync(join(hooksPath, 'pre-commit'), 0o755);
  const fifoSetup = spawnSync(cli, ['setup'], {
    cwd: repository, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(fifoSetup.signal, null, 'managed hook FIFO setup inspection timed out');
  assert.equal(fifoSetup.status, 1);
  assert.match(fifoSetup.stderr, /blocked-hook-runtime-integrity/u);
  const fifoDoctor = spawnSync(cli, ['doctor'], {
    cwd: repository, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(fifoDoctor.signal, null, 'managed hook FIFO doctor inspection timed out');
  assert.match(fifoDoctor.stdout, /FAIL hook\.pre-commit/u);
});

test('managed hook runtime safely rebinds after a clone relocation', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-relocated-consumer-'));
  const before = join(parent, 'before');
  const after = join(parent, 'after');
  const packed = join(parent, 'packed');
  mkdirSync(before);
  mkdirSync(packed);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const archive = join(packed, execFileSync('npm', [
    'pack', '--silent', '--pack-destination', packed,
  ], { cwd: ROOT, encoding: 'utf8' }).trim());
  writeFileSync(join(before, 'package.json'), '{"name":"relocated","private":true}\n');
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-package-lock', '--save-exact', archive,
  ], { cwd: before, stdio: 'pipe' });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: before });
  execFileSync('git', ['config', 'user.name', 'Relocation Fixture'], { cwd: before });
  execFileSync('git', ['config', 'user.email', 'relocation@example.invalid'], { cwd: before });
  writeFileSync(join(before, '.gitignore'), 'node_modules/\n');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/relocated',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(before, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  execFileSync('git', ['add', 'package.json', '.gitignore', '.agentic-os.json'], { cwd: before });
  execFileSync('git', ['commit', '--quiet', '--message', 'fixture'], { cwd: before });
  const cli = join(before, 'node_modules', '.bin', 'agentic-os');
  assert.equal(spawnSync(cli, ['setup'], { cwd: before }).status, 0);
  const oldHooks = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: before, encoding: 'utf8',
  }).trim();

  renameSync(before, after);
  const movedCli = join(after, 'node_modules', '.bin', 'agentic-os');
  const rebound = spawnSync(movedCli, ['setup'], { cwd: after, encoding: 'utf8' });
  assert.equal(rebound.status, 0, rebound.stderr);
  const newHooks = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: after, encoding: 'utf8',
  }).trim();
  assert.notEqual(newHooks, oldHooks);
  assert.equal(statSync(newHooks).isDirectory(), true);
  const guarded = spawnSync('git', ['commit', '--allow-empty', '--message', 'blocked'], {
    cwd: after, encoding: 'utf8',
  });
  assert.equal(guarded.status, 1);
  assert.match(guarded.stderr, /refusing to commit on "main"/u);
});
