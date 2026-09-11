#!/usr/bin/env node
/** On-demand storage compaction. Content preservation is distinct from lifecycle cleanup. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireOperationLock, finishOperationLock, commonDir, repoRoot } from '../src/git.mjs';
import { observeQuarantineManifest, readBoundedStableFile } from '../src/cleanup-manifest.mjs';

const SCHEMA = 'agentic-os/storage-plan/v1', MAX_OUTPUT = 16 * 1024 * 1024;
const LIMITS = { byteCeiling: 512 * 1024 * 1024, entryCeiling: 25000 };
const KINDS = ['git', 'dependencies', 'worktree-dependencies'];
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const fail = reason => { throw new Error(`blocked-storage-${reason}`); };
const same = (a, b) => digest(a) === digest(b);
const direct = path => {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) fail('directory-alias');
  return path;
};
function command(file, args, cwd, options = {}) {
  return execFileSync(file, args, { cwd, encoding: 'utf8', timeout: 1200000,
    maxBuffer: MAX_OUTPUT, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
      COPYFILE_DISABLE: '0', DITTOABORT: '1' }, ...options });
}
const git = (root, args, options) => command('git', ['--no-replace-objects', ...args], root, options);
function location(cwd) {
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_INDEX_FILE', 'GIT_SHALLOW_FILE'])
    if (process.env[name]) fail('git-environment');
  const root = direct(realpathSync(repoRoot(cwd))), common = direct(realpathSync(commonDir(root)));
  direct(join(common, 'objects'));
  for (const name of ['pack', 'info'])
    if (existsSync(join(common, 'objects', name))) direct(join(common, 'objects', name));
  for (const name of ['alternates', 'http-alternates'])
    if (existsSync(join(common, 'objects/info', name))) fail('object-alternates');
  return { root, common };
}
function allocated(path) {
  let entries = 0, bytes = 0;
  const visit = p => {
    if (++entries > 150000) fail('entry-ceiling');
    const stat = lstatSync(p); bytes += stat.blocks * 512;
    if (stat.isDirectory() && !stat.isSymbolicLink()) for (const n of readdirSync(p)) visit(join(p, n));
  };
  visit(path); return bytes;
}
function privateDirectory(path) {
  if (!existsSync(path)) { mkdirSync(path, { mode: 0o700 }); flushDirectory(resolve(path, '..')); }
  direct(path);
  if (lstatSync(path).mode & 0o077) fail('private-directory');
  return path;
}
function flushDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function durableJson(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  flushDirectory(resolve(path, '..'));
}
function flushTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) for (const name of readdirSync(path)) flushTree(join(path, name));
  else if (!stat.isFile()) fail('backup-special-file');
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function inventory(root, common) {
  const objects = git(root, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'])
    .trim().split('\n').filter(Boolean).sort();
  if (objects.length > 100000 || objects.some(x => !/^[a-f0-9]{40,64}$/u.test(x))) fail('object-inventory');
  const refs = git(root, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)']);
  const worktrees = git(root, ['worktree', 'list', '--porcelain']);
  const logs = existsSync(join(common, 'logs'))
    ? observeQuarantineManifest(join(common, 'logs'), LIMITS) : null;
  const worktreeLogs = {}, admin = join(common, 'worktrees');
  if (existsSync(admin)) for (const name of readdirSync(direct(admin)).sort()) {
    const log = join(direct(join(admin, name)), 'logs');
    if (existsSync(log)) worktreeLogs[name] = observeQuarantineManifest(log, LIMITS);
  }
  return { objects, refs, state: { objectDigest: digest(objects), objectCount: objects.length,
    refsDigest: hash(refs), worktreesDigest: hash(worktrees), logs, worktreeLogs } };
}
function dependencyState(common, quarantine) {
  if (!/^[a-f0-9]{64}$/u.test(quarantine ?? '')) fail('quarantine-id');
  const container = direct(join(common, 'agentic-os-cleanup-quarantine'));
  const coordinate = direct(join(container, quarantine)), projection = direct(join(coordinate, 'projection'));
  const target = direct(join(projection, 'node_modules'));
  const operationBytes = readBoundedStableFile(join(coordinate, 'operation.json'), 64000, 'storage-operation');
  const operation = JSON.parse(operationBytes), e = operation.eligibility;
  if (operation.schema !== 'agentic-os/worktree-quarantine-operation/v1'
    || e?.cleanupPlanDigest !== quarantine) fail('quarantine-operation');
  const projectionManifest = observeQuarantineManifest(projection, LIMITS);
  if (projectionManifest.digest !== e.projectionManifestDigest
    || projectionManifest.bytes !== e.projectionBytes || projectionManifest.entries !== e.projectionEntries)
    fail('quarantine-drift');
  const registration = direct(join(coordinate, 'registration'));
  return { target, state: { operationDigest: hash(operationBytes), projectionManifest,
    registrationManifest: observeQuarantineManifest(registration, LIMITS),
    dependencies: observeQuarantineManifest(target, LIMITS) } };
}
function worktreeDependencyState(root) {
  const target = direct(join(root, 'node_modules')), packageFiles = {};
  for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml',
    'yarn.lock', 'bun.lock', 'bun.lockb', '.npmrc', '.yarnrc.yml']) {
    const path = join(root, name), present = lstatSync(path, { throwIfNoEntry: false });
    packageFiles[name] = present ? hash(readBoundedStableFile(path, MAX_OUTPUT, 'package-source')) : null;
  }
  if (packageFiles['package.json'] === null) fail('package-source');
  if (git(root, ['ls-files', '-z', '--', 'node_modules']).length) fail('tracked-dependencies');
  return { target, state: { checkoutHead: git(root, ['rev-parse', 'HEAD']).trim(), packageFiles,
    dependencies: observeQuarantineManifest(target, LIMITS) } };
}
function dependencySelection(plan) {
  return plan.kind === 'worktree-dependencies' ? worktreeDependencyState(plan.root)
    : dependencyState(plan.common, plan.quarantine);
}
function idleWorktree(plan, original = null) {
  if (plan.kind !== 'worktree-dependencies') return;
  const within = (path, root) => path === root || path.startsWith(`${root}/`);
  const inspect = (args, relevant) => {
    const result = spawnSync('/usr/sbin/lsof', ['-nP', '-Fpn', ...args], {
      cwd: plan.common, encoding: 'utf8', timeout: 30000, maxBuffer: MAX_OUTPUT,
      stdio: ['ignore', 'pipe', 'pipe'] });
    // lsof may return 1 for unmatched entries even while reporting other open files.
    if (result.error || ![0, 1].includes(result.status) || result.stderr) fail('process-observation');
    let pid = null;
    for (const line of result.stdout.split('\n')) {
      if (/^p[0-9]+$/u.test(line)) pid = Number(line.slice(1));
      if (line.startsWith('n') && pid !== process.pid && relevant(line.slice(1)))
        fail(`dependencies-in-use-pid-${pid}`);
    }
  };
  // This is a bounded observation, not an OS-wide exclusion lock. --stopped remains required.
  inspect(['-d', 'cwd'], path => within(path, plan.root) && !within(path, plan.common));
  for (const target of [plan.target, original].filter(Boolean))
    inspect(['+D', target], () => true);
}
function observed(plan) {
  const where = location(plan.root);
  if (where.root !== plan.root || where.common !== plan.common) fail('repository-drift');
  return plan.kind === 'git' ? inventory(plan.root, plan.common).state
    : dependencySelection(plan).state;
}
export function planStorage({ cwd = process.cwd(), kind, quarantine = null }, now = Date.now()) {
  if (!KINDS.includes(kind) || kind !== 'dependencies' && quarantine !== null) fail('kind');
  if (kind !== 'git' && process.platform !== 'darwin') fail('compression-platform');
  const { root, common } = location(cwd);
  const target = kind === 'git' ? direct(join(common, 'objects'))
    : dependencySelection({ root, common, kind, quarantine }).target;
  const draft = { schema: SCHEMA, root, common, kind, quarantine, target, issuedAt: now,
    expiresAt: now + 3600000, before: null, beforeAllocatedBytes: allocated(target) };
  draft.before = observed(draft);
  return { ...draft, planDigest: digest(draft) };
}
function validate(plan) {
  const { planDigest, ...draft } = plan;
  if (Object.keys(plan).sort().join(',') !== 'before,beforeAllocatedBytes,common,expiresAt,issuedAt,kind,planDigest,quarantine,root,schema,target'
    || plan.schema !== SCHEMA || !KINDS.includes(plan.kind)
    || plan.kind !== 'dependencies' && plan.quarantine !== null
    || digest(draft) !== planDigest || !/^[a-f0-9]{64}$/u.test(planDigest)
    || !Number.isSafeInteger(plan.issuedAt) || plan.expiresAt !== plan.issuedAt + 3600000)
    fail('plan-binding');
  const where = location(plan.root);
  if (where.root !== plan.root || where.common !== plan.common) fail('repository-drift');
  const target = plan.kind === 'git' ? join(plan.common, 'objects')
    : dependencySelection(plan).target;
  if (plan.target !== target) fail('target-binding');
}
function locksAbsent(common) {
  for (const name of ['gc.pid', 'index.lock', 'packed-refs.lock', 'shallow.lock', 'config.lock'])
    if (existsSync(join(common, name))) fail('git-writer');
}
function compactGit(plan, operation, progress) {
  const before = inventory(plan.root, plan.common);
  git(plan.root, ['fsck', '--full', '--no-dangling']);
  progress('Packing a recovery copy of every Git object, including unreachable objects.');
  const backup = privateDirectory(join(operation, 'recovery'));
  const packHash = git(plan.root, ['pack-objects', '--threads=2', '--window-memory=128m',
    join(backup, 'objects')], { input: `${before.objects.join('\n')}\n` }).trim();
  if (!/^[a-f0-9]{40,64}$/u.test(packHash)) fail('backup-pack');
  const prefix = join(backup, `objects-${packHash}`);
  const verified = git(plan.root, ['verify-pack', '-v', `${prefix}.idx`]);
  const packed = verified.split('\n').filter(x => /^[a-f0-9]{40,64} (blob|tree|commit|tag) /u.test(x))
    .map(x => x.split(' ')[0]).sort();
  if (!same(before.objects, packed)) fail('backup-inventory');
  for (const name of ['HEAD', 'index', 'config', 'packed-refs', 'refs', 'logs', 'shallow']) {
    const source = join(plan.common, name);
    if (existsSync(source)) cpSync(source, join(backup, name), { recursive: true, preserveTimestamps: true });
  }
  const worktrees = join(plan.common, 'worktrees');
  if (existsSync(worktrees)) {
    const destination = privateDirectory(join(backup, 'worktrees'));
    for (const name of readdirSync(direct(worktrees))) {
      const source = direct(join(worktrees, name)), target = privateDirectory(join(destination, name));
      for (const file of ['HEAD', 'index', 'commondir', 'gitdir', 'logs', 'locked', 'config.worktree'])
        if (existsSync(join(source, file))) cpSync(join(source, file), join(target, file),
          { recursive: true, preserveTimestamps: true });
    }
  }
  flushTree(backup);
  durableJson(join(operation, 'backup.json'), { pack: `${prefix}.pack`, index: `${prefix}.idx`,
    objectDigest: plan.before.objectDigest, objectCount: packed.length });
  if (!same(observed(plan), plan.before)) fail('drift-before-repack');
  locksAbsent(plan.common);
  progress('Recovery pack verified; compacting the original object store.');
  git(plan.root, ['repack', '-a', '-d', '--keep-unreachable', '--threads=2', '--window-memory=128m']);
  git(plan.root, ['fsck', '--full', '--no-dangling']);
  if (!same(observed(plan), plan.before)) fail('drift-after-repack');
  return { backupDirectory: backup, backupAllocatedBytes: allocated(backup),
    objectIdsPreserved: true, refsPreserved: true, reflogsPreserved: true };
}
function compressDependencies(plan, operation, progress) {
  if (process.platform !== 'darwin') fail('compression-platform');
  const prepared = join(operation, 'compressed'), original = join(operation, 'original');
  progress('Compressing the exact dependency directory using native filesystem compression.');
  command('/usr/bin/ditto', ['--hfsCompression', '--noclone', '--rsrc', '--extattr', '--acl',
    plan.target, prepared], plan.root);
  const manifest = observeQuarantineManifest(prepared, LIMITS);
  if (!same(manifest, plan.before.dependencies)) fail('compressed-content-mismatch');
  const compressedBytes = allocated(prepared);
  if (compressedBytes >= plan.beforeAllocatedBytes) {
    rmSync(prepared, { recursive: true });
    return { skipped: 'no-space-saving', contentPreserved: true };
  }
  if (!same(observed(plan), plan.before)) fail('drift-before-swap');
  flushTree(prepared);
  idleWorktree(plan);
  if (lstatSync(plan.target).dev !== lstatSync(operation).dev) fail('cross-device-swap');
  durableJson(join(operation, 'swap.json'), { target: plan.target, prepared, original, manifest,
    recovery: 'Restore original to target only if target is absent; otherwise verify both manifests first.' });
  // Both renames stay on the same filesystem. A partial swap retains the original and the journal.
  renameSync(plan.target, original);
  renameSync(prepared, plan.target);
  flushDirectory(resolve(plan.target, '..')); flushDirectory(operation);
  progress('Dependency swap complete; verifying the retained original before removal.');
  return finishDependencySwap(plan, operation);
}
function finishDependencySwap(plan, operation) {
  const original = direct(join(operation, 'original')), prepared = join(operation, 'compressed');
  if (existsSync(prepared)) fail('resume-phase');
  const manifest = plan.before.dependencies, compressedBytes = allocated(plan.target);
  const journal = JSON.parse(readBoundedStableFile(join(operation, 'swap.json'), 64000, 'storage-swap'));
  if (!same(journal, { target: plan.target, prepared, original, manifest,
    recovery: 'Restore original to target only if target is absent; otherwise verify both manifests first.' }))
    fail('resume-journal');
  if (!same(observed(plan), plan.before)
    || !same(observeQuarantineManifest(original, LIMITS), manifest)) fail('drift-after-swap');
  idleWorktree(plan, original);
  const verifiedPath = join(operation, 'verified.json');
  const verified = { manifest, compressedBytes, originalVerified: true };
  if (existsSync(verifiedPath)) {
    if (!same(JSON.parse(readBoundedStableFile(verifiedPath, 64000, 'storage-verified')), verified)) fail('resume-verified');
  } else durableJson(verifiedPath, verified);
  rmSync(original, { recursive: true });
  flushDirectory(operation);
  return { contentPreserved: true,
    ...(plan.kind === 'dependencies' ? { quarantineReceiptPreserved: true }
      : { packageSourcesPreserved: true, idleProcessObservation: true }), dependenciesRemoved: false };
}
function storageReceipt(plan, operation, detail) {
  const afterAllocatedBytes = allocated(plan.target);
  const result = { schema: 'agentic-os/storage-receipt/v1', planDigest: plan.planDigest,
    kind: plan.kind, target: plan.target, beforeAllocatedBytes: plan.beforeAllocatedBytes,
    afterAllocatedBytes, targetBytesReclaimed: plan.beforeAllocatedBytes - afterAllocatedBytes,
    ...detail, completedAt: new Date().toISOString(), authority: 'explicit-user-consent',
    providerAuthority: false, operatingSystemExclusivityProven: false };
  const receiptPath = join(operation, 'receipt.json'); durableJson(receiptPath, result);
  return { ...result, receiptPath };
}
export function applyStorage(plan, { authorization, stopped = false, resume = false, now = Date.now(),
  progress = () => {} } = {}) {
  validate(plan);
  if (authorization !== `agentic-os:storage:${plan.planDigest}` || stopped !== true
    || typeof resume !== 'boolean') fail('authorization');
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', plan.root);
  if (!lock) fail('busy');
  let result, error;
  try {
    locksAbsent(plan.common);
    const parent = privateDirectory(join(plan.common, 'agentic-os-storage'));
    const operation = join(parent, plan.planDigest), receiptPath = join(operation, 'receipt.json');
    if (existsSync(operation)) {
      direct(operation);
      if (!existsSync(receiptPath)) {
        if (!resume || plan.kind === 'git') fail('partial-operation-retained');
        if (now < plan.issuedAt || now >= plan.expiresAt) fail('expired');
        if (!same(JSON.parse(readBoundedStableFile(join(operation, 'plan.json'), 64000, 'storage-plan')), plan))
          fail('resume-plan');
        progress('Revalidating the completed dependency swap and retained original.');
        result = storageReceipt(plan, operation, { ...finishDependencySwap(plan, operation), resumed: true });
      } else {
        const receipt = JSON.parse(readBoundedStableFile(receiptPath, 64000, 'storage-receipt'));
        if (receipt.planDigest !== plan.planDigest || !same(observed(plan), plan.before)) fail('replay-drift');
        result = { ...receipt, replayed: true };
      }
    } else {
      if (resume) fail('resume-missing-operation');
      if (now < plan.issuedAt || now >= plan.expiresAt) fail('expired');
      if (!same(observed(plan), plan.before)) fail('plan-drift');
      idleWorktree(plan);
      privateDirectory(operation); durableJson(join(operation, 'plan.json'), plan);
      const detail = plan.kind === 'git' ? compactGit(plan, operation, progress)
        : compressDependencies(plan, operation, progress);
      result = storageReceipt(plan, operation, detail);
    }
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'storage', result, error });
}
export function runStorage(argv) {
  const [action, ...tokens] = argv, args = {};
  if (!['plan', 'apply'].includes(action)) fail('action');
  for (const token of tokens) {
    const match = /^--([a-z-]+)(?:=(.+))?$/u.exec(token);
    if (!match || Object.hasOwn(args, match[1])) fail('arguments');
    args[match[1]] = match[2] ?? true;
  }
  const allowed = action === 'plan' ? ['repository', 'kind', 'quarantine'] : ['plan', 'authorize', 'stopped', 'resume'];
  if (Object.keys(args).some(k => !allowed.includes(k))) fail('arguments');
  let result;
  if (action === 'plan') {
    if (typeof args.repository !== 'string' || typeof args.kind !== 'string'
      || args.quarantine !== undefined && typeof args.quarantine !== 'string') fail('arguments');
    result = planStorage({ cwd: args.repository, kind: args.kind, quarantine: args.quarantine ?? null });
  } else {
    if (typeof args.plan !== 'string' || typeof args.authorize !== 'string' || args.stopped !== true
      || args.resume !== undefined && args.resume !== true) fail('arguments');
    const plan = JSON.parse(readBoundedStableFile(resolve(args.plan), 64000, 'storage-plan'));
    result = applyStorage(plan, { authorization: args.authorize, stopped: args.stopped, resume: args.resume ?? false,
      progress: message => process.stderr.write(`${message}\n`) });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = runStorage(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
