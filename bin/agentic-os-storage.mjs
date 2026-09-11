#!/usr/bin/env node
/** On-demand storage compaction. Content preservation is distinct from lifecycle cleanup. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireOperationLock, finishOperationLock, commonDir, repoRoot } from '../src/git.mjs';
import { observeQuarantineManifest, readBoundedStableFile } from '../src/cleanup-manifest.mjs';

const SCHEMA = 'agentic-os/storage-plan/v1', MAX_OUTPUT = 64 * 1024 * 1024;
const LIMITS = { byteCeiling: 4 * 1024 * 1024 * 1024, entryCeiling: 100000 };
const KINDS = ['git', 'dependencies', 'worktree-dependencies', 'artifact-archive', 'artifact-compression', 'canonical-quarantine'];
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
  let entries = 0, bytes = 0; const seen = new Set();
  const visit = p => {
    if (++entries > 150000) fail('entry-ceiling');
    const stat = lstatSync(p), key = `${stat.dev}:${stat.ino}`;
    if (!stat.isFile() || !seen.has(key)) bytes += stat.blocks * 512;
    if (stat.isFile()) seen.add(key);
    if (stat.isDirectory() && !stat.isSymbolicLink()) for (const n of readdirSync(p)) visit(join(p, n));
  };
  visit(path); return bytes;
}
function storageManifest(path) {
  const groups = new Map(); let entries = 0;
  const visit = (p, relative) => {
    if (++entries > LIMITS.entryCeiling) fail('entry-ceiling');
    const stat = lstatSync(p);
    if (stat.isDirectory() && !stat.isSymbolicLink())
      for (const name of readdirSync(p)) visit(join(p, name), relative ? `${relative}/${name}` : name);
    else if (stat.isFile() && stat.nlink > 1) {
      const key = `${stat.dev}:${stat.ino}`, group = groups.get(key) ?? { count: stat.nlink, paths: [] };
      group.paths.push(relative); groups.set(key, group);
    }
  };
  visit(path, '');
  for (const group of groups.values()) if (group.paths.length !== group.count) fail('external-hardlink');
  const manifest = observeQuarantineManifest(path, { ...LIMITS, retainedHardlinks: true });
  return groups.size ? { ...manifest, hardlinkDigest: digest([...groups.values()].map(g => g.paths.sort())
    .sort((a, b) => a[0].localeCompare(b[0]))) } : manifest;
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
  if (objects.length > 500000 || objects.some(x => !/^[a-f0-9]{40,64}$/u.test(x))) fail('object-inventory');
  const refs = git(root, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)']);
  const worktrees = git(root, ['worktree', 'list', '--porcelain']);
  const logs = existsSync(join(common, 'logs'))
    ? storageManifest(join(common, 'logs')) : null;
  const worktreeLogs = {}, admin = join(common, 'worktrees');
  if (existsSync(admin)) for (const name of readdirSync(direct(admin)).sort()) {
    const log = join(direct(join(admin, name)), 'logs');
    if (existsSync(log)) worktreeLogs[name] = storageManifest(log);
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
  const projectionManifest = storageManifest(projection);
  if (projectionManifest.digest !== e.projectionManifestDigest
    || projectionManifest.bytes !== e.projectionBytes || projectionManifest.entries !== e.projectionEntries)
    fail('quarantine-drift');
  const registration = direct(join(coordinate, 'registration'));
  return { target, state: { operationDigest: hash(operationBytes), projectionManifest,
    registrationManifest: storageManifest(registration),
    dependencies: storageManifest(target) } };
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
    dependencies: storageManifest(target) } };
}
function artifactState(root, artifact) {
  if (typeof artifact !== 'string' || artifact.split('/').some(p => !p || ['.', '..', '.git', '.wrangler'].includes(p)))
    fail('artifact-path');
  let target = root;
  for (const part of artifact.split('/')) target = direct(join(target, part));
  if (git(root, ['--literal-pathspecs', 'ls-files', '-z', '--', artifact]).length) fail('tracked-artifact');
  return { target, state: { checkoutHead: git(root, ['rev-parse', 'HEAD']).trim(),
    artifactManifest: storageManifest(target) } };
}
function canonicalQuarantineState(common, quarantine) {
  if (!/^agentic-os-canonical-sync-quarantine-[A-Za-z0-9]{6}$/u.test(quarantine ?? '')) fail('quarantine-id');
  const target = direct(join(common, quarantine));
  const bytes = readBoundedStableFile(join(target, 'manifest.json'), MAX_OUTPUT, 'quarantine-manifest');
  const manifest = JSON.parse(bytes);
  if (!['agentic-os-canonical-sync-quarantine/v1', 'agentic-os-canonical-sync-quarantine/v2'].includes(manifest.schema)
    || !/^[a-f0-9]{64}$/u.test(manifest.planDigest ?? '') || !/^[a-f0-9]{64}$/u.test(manifest.inventoryDigest ?? ''))
    fail('quarantine-manifest');
  return { target, state: { receiptDigest: hash(bytes), dependencies: storageManifest(target) } };
}
function dependencySelection(plan) {
  if (plan.kind === 'canonical-quarantine') return canonicalQuarantineState(plan.common, plan.quarantine);
  return plan.kind === 'worktree-dependencies' ? worktreeDependencyState(plan.root)
    : dependencyState(plan.common, plan.quarantine);
}
function idleWorktree(plan, original = null) {
  if (!['worktree-dependencies', 'artifact-archive', 'artifact-compression'].includes(plan.kind)) return;
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
  inspect(['-d', 'cwd'], path => within(path, plan.kind === 'worktree-dependencies' ? plan.root : plan.target)
    && !within(path, plan.common));
  for (const target of [plan.target, original].filter(Boolean))
    inspect(['+D', target], () => true);
}
function observed(plan) {
  const where = location(plan.root);
  if (where.root !== plan.root || where.common !== plan.common) fail('repository-drift');
  return plan.kind === 'git' ? inventory(plan.root, plan.common).state
    : ['artifact-archive', 'artifact-compression'].includes(plan.kind) ? artifactState(plan.root, plan.artifact).state : dependencySelection(plan).state;
}
export function planStorage({ cwd = process.cwd(), kind, quarantine = null, artifact = null }, now = Date.now()) {
  if (!KINDS.includes(kind) || !['dependencies', 'canonical-quarantine'].includes(kind) && quarantine !== null
    || !['artifact-archive', 'artifact-compression'].includes(kind) && artifact !== null) fail('kind');
  if (kind !== 'git' && process.platform !== 'darwin') fail('compression-platform');
  const { root, common } = location(cwd);
  const selection = kind === 'git' ? { target: direct(join(common, 'objects')), state: inventory(root, common).state }
    : ['artifact-archive', 'artifact-compression'].includes(kind) ? artifactState(root, artifact)
      : dependencySelection({ root, common, kind, quarantine });
  const draft = { schema: SCHEMA, root, common, kind, quarantine, target: selection.target, issuedAt: now,
    expiresAt: now + 3600000, ...(['artifact-archive', 'artifact-compression'].includes(kind) ? { artifact } : {}),
    before: selection.state, beforeAllocatedBytes: allocated(selection.target) };
  return { ...draft, planDigest: digest(draft) };
}
function validate(plan) {
  const { planDigest, ...draft } = plan;
  if (Object.keys(plan).sort().join(',') !== `${['artifact-archive', 'artifact-compression'].includes(plan.kind) ? 'artifact,' : ''}before,beforeAllocatedBytes,common,expiresAt,issuedAt,kind,planDigest,quarantine,root,schema,target`
    || plan.schema !== SCHEMA || !KINDS.includes(plan.kind)
    || !['dependencies', 'canonical-quarantine'].includes(plan.kind) && plan.quarantine !== null
    || digest(draft) !== planDigest || !/^[a-f0-9]{64}$/u.test(planDigest)
    || !Number.isSafeInteger(plan.issuedAt) || plan.expiresAt !== plan.issuedAt + 3600000)
    fail('plan-binding');
  const where = location(plan.root);
  if (where.root !== plan.root || where.common !== plan.common) fail('repository-drift');
  const target = plan.kind === 'git' ? join(plan.common, 'objects')
    : plan.kind === 'worktree-dependencies' ? join(plan.root, 'node_modules')
      : plan.kind === 'dependencies' ? join(plan.common, 'agentic-os-cleanup-quarantine', plan.quarantine, 'projection/node_modules')
        : plan.kind === 'canonical-quarantine' ? join(plan.common, plan.quarantine) : resolve(plan.root, plan.artifact);
  if (plan.target !== target) fail('target-binding');
}
function locksAbsent(common) {
  for (const name of ['gc.pid', 'index.lock', 'packed-refs.lock', 'shallow.lock', 'config.lock'])
    if (existsSync(join(common, name))) fail('git-writer');
}
function compactGit(plan, operation, progress) {
  const counts = Object.fromEntries(git(plan.root, ['count-objects', '-v']).trim().split('\n')
    .map(line => line.split(': ').map((x, i) => i ? Number(x) : x)));
  if (counts.packs <= 1 && counts.count < 128 && counts.size < 8192)
    return { skipped: 'below-growth-threshold', backupAllocatedBytes: 0 };
  const before = inventory(plan.root, plan.common);
  git(plan.root, ['fsck', '--full', '--no-dangling']);
  progress('Packing a recovery copy of every Git object, including unreachable objects.');
  const backup = privateDirectory(join(operation, 'recovery'));
  const packHash = git(plan.root, ['pack-objects', '--threads=2', '--window-memory=128m',
    join(backup, 'objects')], { input: `${before.objects.join('\n')}\n` }).trim();
  if (!/^[a-f0-9]{40,64}$/u.test(packHash)) fail('backup-pack');
  const prefix = join(backup, `objects-${packHash}`);
  git(plan.root, ['verify-pack', `${prefix}.idx`]);
  const index = readBoundedStableFile(`${prefix}.idx`, MAX_OUTPUT, 'pack-index');
  const packed = git(plan.root, ['show-index'], { input: index }).trim().split('\n')
    .filter(Boolean).map(x => x.split(' ')[1]).sort();
  if (!same(before.objects, packed)) fail('backup-inventory');
  const packBytes = allocated(backup);
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
  if (!same(observed(plan), plan.before)) fail('drift-before-repack');
  const backupBytes = allocated(backup), estimatedRetainedBytes = backupBytes + packBytes;
  // This candidate is still a duplicate of the unchanged source; it is not committed recovery data.
  if (estimatedRetainedBytes >= plan.beforeAllocatedBytes) {
    rmSync(backup, { recursive: true }); flushDirectory(operation);
    return { skipped: 'no-estimated-net-saving', estimatedRetainedBytes, backupAllocatedBytes: 0 };
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
  const manifest = storageManifest(prepared);
  if (!same(manifest, (plan.before.dependencies ?? plan.before.artifactManifest))) fail('compressed-content-mismatch');
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
  const manifest = (plan.before.dependencies ?? plan.before.artifactManifest), compressedBytes = allocated(plan.target);
  const journal = JSON.parse(readBoundedStableFile(join(operation, 'swap.json'), 64000, 'storage-swap'));
  if (!same(journal, { target: plan.target, prepared, original, manifest,
    recovery: 'Restore original to target only if target is absent; otherwise verify both manifests first.' }))
    fail('resume-journal');
  if (!same(observed(plan), plan.before)
    || !same(storageManifest(original), manifest)) fail('drift-after-swap');
  idleWorktree(plan, original);
  const verifiedPath = join(operation, 'verified.json');
  const verified = { manifest, compressedBytes, originalVerified: true };
  if (existsSync(verifiedPath)) {
    if (!same(JSON.parse(readBoundedStableFile(verifiedPath, 64000, 'storage-verified')), verified)) fail('resume-verified');
  } else durableJson(verifiedPath, verified);
  rmSync(original, { recursive: true });
  flushDirectory(operation);
  return { contentPreserved: true,
    ...(['dependencies', 'canonical-quarantine'].includes(plan.kind) ? { quarantineReceiptPreserved: true }
      : { ...(plan.kind === 'worktree-dependencies' ? { packageSourcesPreserved: true } : { trackedSourcePreserved: true }),
        idleProcessObservation: true }), dependenciesRemoved: false };
}
function archiveArtifact(plan, operation, progress) {
  const archive = join(operation, 'artifact.tar.gz'), verification = privateDirectory(join(operation, 'verification'));
  progress('Archiving the exact untracked artifact and verifying a full extraction before removal.');
  command('tar', ['-czpf', archive, '-C', dirname(plan.target), '--', basename(plan.target)], plan.common);
  command('tar', ['-xzpf', archive, '-C', verification], plan.common);
  if (!same(storageManifest(join(verification, basename(plan.target))), plan.before.artifactManifest))
    fail('archive-content-mismatch');
  flushTree(archive);
  if (!same(observed(plan), plan.before)) fail('drift-before-archive-removal');
  idleWorktree(plan);
  durableJson(join(operation, 'verified.json'), { archive, manifest: plan.before.artifactManifest,
    recovery: `Extract artifact.tar.gz in an empty directory; verify the manifest before restoring ${plan.artifact}.` });
  rmSync(verification, { recursive: true });
  // Recovery bytes and the manifest are durable before removing this exact selected directory.
  rmSync(plan.target, { recursive: true }); flushDirectory(dirname(plan.target));
  return { archived: true, backupDirectory: operation, backupAllocatedBytes: allocated(archive),
    contentPreserved: true, trackedSourcePreserved: true };
}
function storageReceipt(plan, operation, detail) {
  const afterAllocatedBytes = detail.archived ? 0 : allocated(plan.target);
  const result = { schema: 'agentic-os/storage-receipt/v1', planDigest: plan.planDigest,
    kind: plan.kind, target: plan.target, beforeAllocatedBytes: plan.beforeAllocatedBytes,
    afterAllocatedBytes, targetBytesReclaimed: plan.beforeAllocatedBytes - afterAllocatedBytes,
    ...detail, netBytesReclaimed: plan.beforeAllocatedBytes - afterAllocatedBytes - (detail.backupAllocatedBytes ?? 0),
    completedAt: new Date().toISOString(), authority: 'explicit-user-consent',
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
        if (!resume || ['git', 'artifact-archive'].includes(plan.kind)) fail('partial-operation-retained');
        if (now < plan.issuedAt || now >= plan.expiresAt) fail('expired');
        if (!same(JSON.parse(readBoundedStableFile(join(operation, 'plan.json'), 64000, 'storage-plan')), plan))
          fail('resume-plan');
        progress('Revalidating the completed dependency swap and retained original.');
        result = storageReceipt(plan, operation, { ...finishDependencySwap(plan, operation), resumed: true });
      } else {
        const receipt = JSON.parse(readBoundedStableFile(receiptPath, 64000, 'storage-receipt'));
        const unchanged = plan.kind === 'artifact-archive'
          ? !existsSync(plan.target) && git(plan.root, ['rev-parse', 'HEAD']).trim() === plan.before.checkoutHead
          : same(observed(plan), plan.before);
        if (receipt.planDigest !== plan.planDigest || !unchanged) fail('replay-drift');
        result = { ...receipt, replayed: true };
      }
    } else {
      if (resume) fail('resume-missing-operation');
      if (now < plan.issuedAt || now >= plan.expiresAt) fail('expired');
      if (!same(observed(plan), plan.before)) fail('plan-drift');
      idleWorktree(plan);
      privateDirectory(operation); durableJson(join(operation, 'plan.json'), plan);
      const detail = plan.kind === 'git' ? compactGit(plan, operation, progress)
        : plan.kind === 'artifact-archive' ? archiveArtifact(plan, operation, progress)
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
  const allowed = action === 'plan' ? ['repository', 'kind', 'quarantine', 'artifact'] : ['plan', 'authorize', 'stopped', 'resume'];
  if (Object.keys(args).some(k => !allowed.includes(k))) fail('arguments');
  let result;
  if (action === 'plan') {
    if (typeof args.repository !== 'string' || typeof args.kind !== 'string'
      || args.quarantine !== undefined && typeof args.quarantine !== 'string'
      || args.artifact !== undefined && typeof args.artifact !== 'string') fail('arguments');
    result = planStorage({ cwd: args.repository, kind: args.kind, quarantine: args.quarantine ?? null, artifact: args.artifact ?? null });
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
