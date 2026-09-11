#!/usr/bin/env node
/** On-demand storage compaction. Content preservation is distinct from lifecycle cleanup. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireOperationLock, finishOperationLock, commonDir, repoRoot } from '../src/git.mjs';
import { observeQuarantineManifest, readBoundedStableFile } from '../src/cleanup-manifest.mjs';

const SCHEMA = 'agentic-os/storage-plan/v1', MAX_OUTPUT = 16 * 1024 * 1024;
const LIMITS = { byteCeiling: 512 * 1024 * 1024, entryCeiling: 25000 };
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
function observed(plan) {
  const where = location(plan.root);
  if (where.root !== plan.root || where.common !== plan.common) fail('repository-drift');
  return plan.kind === 'git' ? inventory(plan.root, plan.common).state
    : dependencyState(plan.common, plan.quarantine).state;
}
export function planStorage({ cwd = process.cwd(), kind, quarantine = null }, now = Date.now()) {
  if (!['git', 'dependencies'].includes(kind) || kind === 'git' && quarantine !== null) fail('kind');
  if (kind === 'dependencies' && process.platform !== 'darwin') fail('compression-platform');
  const { root, common } = location(cwd);
  const target = kind === 'git' ? direct(join(common, 'objects')) : dependencyState(common, quarantine).target;
  const draft = { schema: SCHEMA, root, common, kind, quarantine, target, issuedAt: now,
    expiresAt: now + 3600000, before: null, beforeAllocatedBytes: allocated(target) };
  draft.before = observed(draft);
  return { ...draft, planDigest: digest(draft) };
}
function validate(plan) {
  const { planDigest, ...draft } = plan;
  if (Object.keys(plan).sort().join(',') !== 'before,beforeAllocatedBytes,common,expiresAt,issuedAt,kind,planDigest,quarantine,root,schema,target'
    || plan.schema !== SCHEMA || !['git', 'dependencies'].includes(plan.kind)
    || digest(draft) !== planDigest || !/^[a-f0-9]{64}$/u.test(planDigest)
    || !Number.isSafeInteger(plan.issuedAt) || plan.expiresAt !== plan.issuedAt + 3600000)
    fail('plan-binding');
  const where = location(plan.root);
  if (where.root !== plan.root || where.common !== plan.common) fail('repository-drift');
  const target = plan.kind === 'git' ? join(plan.common, 'objects')
    : dependencyState(plan.common, plan.quarantine).target;
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
  durableJson(join(operation, 'swap.json'), { target: plan.target, prepared, original, manifest,
    recovery: 'Restore original to target only if target is absent; otherwise verify both manifests first.' });
  // Both renames stay on the same filesystem. A partial swap retains the original and the journal.
  renameSync(plan.target, original);
  renameSync(prepared, plan.target);
  flushDirectory(resolve(plan.target, '..')); flushDirectory(operation);
  if (!same(observed(plan), plan.before)
    || !same(observeQuarantineManifest(original, LIMITS), manifest)) fail('drift-after-swap');
  durableJson(join(operation, 'verified.json'), { manifest, compressedBytes, originalVerified: true });
  rmSync(original, { recursive: true });
  flushDirectory(operation);
  return { contentPreserved: true, quarantineReceiptPreserved: true, dependenciesRemoved: false };
}
export function applyStorage(plan, { authorization, stopped = false, now = Date.now(),
  progress = () => {} } = {}) {
  validate(plan);
  if (authorization !== `agentic-os:storage:${plan.planDigest}` || stopped !== true) fail('authorization');
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', plan.root);
  if (!lock) fail('busy');
  let result, error;
  try {
    locksAbsent(plan.common);
    const parent = privateDirectory(join(plan.common, 'agentic-os-storage'));
    const operation = join(parent, plan.planDigest), receiptPath = join(operation, 'receipt.json');
    if (existsSync(operation)) {
      direct(operation);
      if (!existsSync(receiptPath)) fail('partial-operation-retained');
      const receipt = JSON.parse(readBoundedStableFile(receiptPath, 64000, 'storage-receipt'));
      if (receipt.planDigest !== plan.planDigest || !same(observed(plan), plan.before)) fail('replay-drift');
      result = { ...receipt, replayed: true };
    } else {
      if (now < plan.issuedAt || now >= plan.expiresAt) fail('expired');
      if (!same(observed(plan), plan.before)) fail('plan-drift');
      privateDirectory(operation); durableJson(join(operation, 'plan.json'), plan);
      const detail = plan.kind === 'git' ? compactGit(plan, operation, progress)
        : compressDependencies(plan, operation, progress);
      const afterAllocatedBytes = allocated(plan.target);
      result = { schema: 'agentic-os/storage-receipt/v1', planDigest: plan.planDigest,
        kind: plan.kind, target: plan.target, beforeAllocatedBytes: plan.beforeAllocatedBytes,
        afterAllocatedBytes, targetBytesReclaimed: plan.beforeAllocatedBytes - afterAllocatedBytes,
        ...detail, completedAt: new Date().toISOString(), authority: 'explicit-user-consent',
        providerAuthority: false, operatingSystemExclusivityProven: false };
      durableJson(receiptPath, result); result = { ...result, receiptPath };
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
  const allowed = action === 'plan' ? ['repository', 'kind', 'quarantine'] : ['plan', 'authorize', 'stopped'];
  if (Object.keys(args).some(k => !allowed.includes(k))) fail('arguments');
  let result;
  if (action === 'plan') {
    if (typeof args.repository !== 'string' || typeof args.kind !== 'string'
      || args.quarantine !== undefined && typeof args.quarantine !== 'string') fail('arguments');
    result = planStorage({ cwd: args.repository, kind: args.kind, quarantine: args.quarantine ?? null });
  } else {
    if (typeof args.plan !== 'string' || typeof args.authorize !== 'string' || args.stopped !== true) fail('arguments');
    const plan = JSON.parse(readBoundedStableFile(resolve(args.plan), 64000, 'storage-plan'));
    result = applyStorage(plan, { authorization: args.authorize, stopped: args.stopped,
      progress: message => process.stderr.write(`${message}\n`) });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = runStorage(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
