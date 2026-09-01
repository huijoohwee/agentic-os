/** Exact-path, quarantine-only Git worktree observation and mutation mechanics. */
import {
  lstatSync, mkdirSync, realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest, RETAIN_ALL_CLEANUP } from './governance.mjs';
import {
  loadRepositoryTrust, observeRepositoryProfileAtRef, resolveRepositoryRoot,
} from './git-repository.mjs';
import { collectRecoveryInventory } from './recovery-inventory.mjs';
import { commonDir, observeGit, worktreeInventory } from './git.mjs';
import { boundedDirectoryEntries, observeQuarantineManifest, readBoundedStableFile,
  sameCleanupNode as sameNode, strictCleanupStat as strictStat } from './cleanup-manifest.mjs';
export { observeQuarantineManifest } from './cleanup-manifest.mjs';
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const QUARANTINE_ROOT = 'agentic-os-cleanup-quarantine',
  OPERATION_SCHEMA = 'agentic-os/worktree-quarantine-operation/v1';
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen); return Object.freeze(value); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function absent(path, label) {
  try { lstatSync(path); return false; } catch (error) {
    if (error.code === 'ENOENT') return true;
    fail(`blocked-${label}`, `${label} absence is not proven`);
  }
}
function selectedManifest(root, names, limits, { allowMissing = false, label } = {}) {
  const rootBefore = strictStat(root, `${label}-root`);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()
    || new Set(names).size !== names.length
    || names.some((name) => !name || name === '.' || name === '..' || name.includes('/')))
    fail('blocked-cleanup-manifest', `${label} selection is unsafe`);
  let bytes = 0, entries = names.length;
  const items = [...names].sort().map((name) => {
    const path = join(root, name), stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!stat) {
      if (!allowMissing) fail('blocked-cleanup-manifest', `${label} path is absent`);
      return { name, manifest: null };
    }
    const manifest = observeQuarantineManifest(path, limits);
    bytes += manifest.bytes; entries += manifest.entries;
    if (!Number.isSafeInteger(bytes) || bytes > limits.byteCeiling
      || !Number.isSafeInteger(entries) || entries > limits.entryCeiling)
      fail('blocked-cleanup-manifest', `${label} ceiling exceeded`);
    return { name, manifest };
  });
  const rootAfter = lstatSync(root, { bigint: true, throwIfNoEntry: false });
  if (!sameNode(rootBefore, rootAfter))
    fail('blocked-cleanup-manifest', `${label} root changed during observation`);
  return frozen({ digest: governanceDigest({ schema: 'agentic-os/selected-manifest/v1',
    label, mode: (rootBefore.mode & 0o7777n).toString(8), items }), bytes, entries });
}
function sharedState(common, worktrees, excludedAdminId, plan) {
  if (process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES)
    fail('blocked-cleanup-object-alternate', 'alternate object environment is unsupported');
  for (const name of ['alternates', 'http-alternates']) {
    const stat = lstatSync(join(common, 'objects', 'info', name),
      { bigint: true, throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0n))
      fail('blocked-cleanup-object-alternate', 'alternate object stores are unsupported');
  }
  const limits = { byteCeiling: plan.sharedStateByteCeiling,
    entryCeiling: plan.sharedStateEntryCeiling };
  const adminRoot = join(common, 'worktrees');
  const adminNames = boundedDirectoryEntries(adminRoot, limits.entryCeiling,
    'peer worktree admin').map((entry) => entry.name)
    .filter((name) => name !== excludedAdminId);
  const peerPhysical = selectedManifest(adminRoot, adminNames, limits,
    { label: 'peer-worktree-admin' });
  const refs = selectedManifest(common, ['AUTO_MERGE', 'BISECT_HEAD', 'CHERRY_PICK_HEAD',
    'FETCH_HEAD', 'HEAD', 'MERGE_HEAD', 'ORIG_HEAD', 'REBASE_HEAD', 'REVERT_HEAD',
    'logs', 'packed-refs', 'refs', 'reftable'],
    limits, { allowMissing: true, label: 'shared-refs-reflogs' });
  const objects = selectedManifest(common, ['objects'], limits,
    { label: 'shared-object-store' });
  const sharedStateBytes = peerPhysical.bytes + refs.bytes + objects.bytes;
  const sharedStateEntries = peerPhysical.entries + refs.entries + objects.entries;
  if (sharedStateBytes > limits.byteCeiling || sharedStateEntries > limits.entryCeiling)
    fail('blocked-cleanup-manifest', 'aggregate shared state ceiling exceeded');
  const registrations = worktrees.filter((entry) => entry.path !== plan.targetPath)
    .sort((left, right) => left.path.localeCompare(right.path));
  return frozen({ peerRegistrationDigest: governanceDigest({
    schema: 'agentic-os/peer-registration-state/v1', registrations, peerPhysical }),
  sharedRefDigest: refs.digest, objectInventoryDigest: objects.digest,
  sharedStateBytes, sharedStateEntries });
}
function adminFor(targetPath, common, entryCeiling) {
  const root = join(common, 'worktrees'), rootStat = strictStat(root, 'worktree-admin-root');
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    fail('blocked-worktree-admin-root', 'worktree admin root is unsafe');
  const matches = [];
  for (const entry of boundedDirectoryEntries(root, entryCeiling, 'worktree admin')) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const adminPath = join(root, entry.name), gitdirPath = join(adminPath, 'gitdir');
    const stat = lstatSync(gitdirPath, { bigint: true, throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) continue;
    if (stat.size > 8_192n)
      fail('blocked-worktree-admin-backlink', 'worktree admin backlink exceeds its byte bound');
    const value = UTF8.decode(readBoundedStableFile(gitdirPath, 8_192,
      'worktree-admin-backlink'));
    if (value === `${join(targetPath, '.git')}\n`) matches.push({ id: entry.name, adminPath });
  }
  if (matches.length !== 1)
    fail('blocked-worktree-admin-backlink', 'target must have one exact worktree admin backlink');
  return matches[0];
}
function trustedState(plan, cwd) {
  const root = resolveRepositoryRoot(cwd), trust = loadRepositoryTrust(root);
  const observed = observeRepositoryProfileAtRef({ repository: root, ref: trust.canonical.localRef });
  const profile = observed.profile;
  if (!profile || trust.repository !== plan.repository || profile.repository !== plan.repository
    || trust.canonical.localRef !== plan.expectedCanonicalRef
    || profile.canonical.localRef !== plan.expectedCanonicalRef
    || profile.canonical.remoteRef !== trust.canonical.remoteRef
    || observed.revision !== plan.expectedCanonicalRevision
    || profile.profileDigest !== plan.profileDigest)
    fail('blocked-cleanup-profile', 'trusted repository, profile, or canonical ref changed');
  const expectedCleanup = { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine',
    worktreeRegistration: 'quarantine' };
  if (!same(profile.adapters.repository, { id: 'git', version: '1' })
    || !same(profile.cleanup, expectedCleanup))
    fail('blocked-cleanup-profile', 'trusted profile does not opt in to exact quarantine effects');
  return { root, trust, profile, canonicalRevision: observed.revision };
}
/** Observe the exact active projection, dirty recovery inventory, policy, refs, and admin bytes. */
export function observeWorktreeCleanupTarget(plan, { cwd = process.cwd() } = {}) {
  const trusted = trustedState(plan, cwd), controller = realpathSync(trusted.root);
  if (controller === plan.targetPath) fail('blocked-cleanup-controller', 'cleanup must run from a surviving peer worktree');
  const common = realpathSync(commonDir(controller));
  if (realpathSync(commonDir(plan.targetPath)) !== common)
    fail('blocked-target-registration', 'target belongs to a different clone');
  const entries = worktreeInventory(controller);
  const targets = entries.filter((entry) => entry.path === plan.targetPath);
  if (targets.length !== 1 || targets[0].bare || targets[0].locked)
    fail('blocked-target-registration', 'target registration is absent, ambiguous, bare, or locked');
  const entry = targets[0], projectionStat = strictStat(plan.targetPath, 'target-projection');
  if (`refs/heads/${entry.branch}` === trusted.profile.canonical.localRef)
    fail('blocked-cleanup-canonical-projection', 'canonical worktree projection must be retained');
  const retainedHead = observeGit(['rev-parse', '--verify', `refs/heads/${plan.expectedBranch}^{commit}`],
    { cwd: controller, allowFail: true });
  if (!projectionStat.isDirectory() || projectionStat.isSymbolicLink()
    || realpathSync(plan.targetPath) !== plan.targetPath)
    fail('blocked-target-projection', 'target projection is not one direct directory');
  if (entry.head !== plan.expectedHeadRevision || entry.branch !== plan.expectedBranch
    || retainedHead !== plan.expectedHeadRevision)
    fail('blocked-target-identity', 'target branch or head changed');
  const recoveryInventory = collectRecoveryInventory({ cwd: plan.targetPath,
    canonicalRef: plan.expectedCanonicalRef });
  const recoveryInventoryDigest = governanceDigest(recoveryInventory);
  if (recoveryInventoryDigest !== plan.recoveryInventoryDigest
    || recoveryInventory.inventoryEntries.content !== plan.recoveryInventoryContentEntries
    || recoveryInventory.headRevision !== plan.expectedHeadRevision
    || recoveryInventory.canonicalRevision !== plan.expectedCanonicalRevision
    || recoveryInventory.branch !== plan.expectedBranch)
    fail('blocked-recovery-inventory-drift', 'dirty recovery inventory changed or is unbound');
  const admin = adminFor(plan.targetPath, common, plan.sharedStateEntryCeiling);
  const projectionManifest = observeQuarantineManifest(plan.targetPath, {
    byteCeiling: plan.projectionByteCeiling, entryCeiling: plan.projectionEntryCeiling,
  });
  const registrationManifest = observeQuarantineManifest(admin.adminPath, {
    byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling,
  });
  const shared = sharedState(common, entries, admin.id, plan);
  const base = { repositoryRoot: controller, commonDirectory: common, worktreeId: admin.id,
    adminPath: admin.adminPath, profileDigest: trusted.profile.profileDigest,
    canonicalRevision: trusted.canonicalRevision, recoveryInventoryDigest,
    recoveryInventoryContentEntries: recoveryInventory.inventoryEntries.content,
    projectionManifest, registrationManifest, ...shared };
  return frozen({ ...base, observationDigest: governanceDigest(base) });
}
function privateDirectory(path, label) {
  const stat = strictStat(path, label);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.nlink < 2n
    || (stat.mode & 0o077n) !== 0n) fail(`blocked-${label}`, `${label} is not a private directory`);
}
function readOperation(path, eligibility) {
  const metadataPath = join(path, 'operation.json');
  let bytes, value;
  try { bytes = readBoundedStableFile(metadataPath, 64_000,
    'cleanup-retained-artifact'); }
  catch { fail('blocked-cleanup-retained-artifact', 'quarantine operation metadata is unsafe'); }
  try { value = JSON.parse(UTF8.decode(bytes)); }
  catch { fail('blocked-cleanup-retained-artifact', 'quarantine operation metadata is invalid'); }
  if (!value || Object.keys(value).sort().join(',') !== 'eligibility,executedAt,schema'
    || value.schema !== OPERATION_SCHEMA || !same(value.eligibility, eligibility)
    || !bytes.equals(Buffer.from(canonicalJson(value), 'utf8'))
    || !Number.isFinite(Date.parse(value.executedAt))
    || new Date(Date.parse(value.executedAt)).toISOString() !== value.executedAt
    || Date.parse(value.executedAt) < Date.parse(eligibility.evaluatedAt)
    || Date.parse(value.executedAt) >= Date.parse(eligibility.expiresAt))
    fail('blocked-cleanup-retained-artifact', 'quarantine operation metadata does not match');
  return value;
}
/** Classify an exact completed quarantine after response loss; partial coordinates remain blocked. */
export function classifyExistingWorktreeQuarantine(plan, eligibility, {
  cwd = process.cwd(),
} = {}) {
  const controller = resolveRepositoryRoot(cwd), common = realpathSync(commonDir(controller));
  const quarantineRoot = join(common, QUARANTINE_ROOT);
  if (absent(quarantineRoot, 'cleanup-existing-quarantine')) return null;
  privateDirectory(quarantineRoot, 'cleanup-quarantine-root');
  if (realpathSync(quarantineRoot) !== quarantineRoot)
    fail('blocked-cleanup-retained-artifact', 'cleanup quarantine root resolves elsewhere');
  const operationPath = join(quarantineRoot, plan.planDigest);
  if (absent(operationPath, 'cleanup-existing-quarantine')) return null;
  privateDirectory(operationPath, 'cleanup-operation-directory');
  const metadata = readOperation(operationPath, eligibility);
  const projectionPath = join(operationPath, 'projection');
  const registrationPath = join(operationPath, 'registration');
  const projection = lstatSync(projectionPath, { bigint: true, throwIfNoEntry: false });
  const registration = lstatSync(registrationPath, { bigint: true, throwIfNoEntry: false });
  if (!absent(plan.targetPath, 'target-detachment') || !projection || !registration
    || !projection.isDirectory() || projection.isSymbolicLink()
    || !registration.isDirectory() || registration.isSymbolicLink())
    fail('blocked-cleanup-retained-artifact', 'quarantine coordinate is partial or ambiguous');
  const projectionManifest = observeQuarantineManifest(projectionPath, {
    byteCeiling: plan.projectionByteCeiling, entryCeiling: plan.projectionEntryCeiling,
  });
  const registrationManifest = observeQuarantineManifest(registrationPath, {
    byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling,
  });
  const entries = worktreeInventory(controller), policy = trustedState(plan, controller);
  const shared = sharedState(common, entries, null, plan);
  if (entries.some((entry) => entry.path === plan.targetPath)
    || projectionManifest.digest !== eligibility.projectionManifestDigest
    || projectionManifest.bytes !== eligibility.projectionBytes
    || projectionManifest.entries !== eligibility.projectionEntries
    || registrationManifest.digest !== eligibility.registrationManifestDigest
    || registrationManifest.bytes !== eligibility.registrationBytes
    || registrationManifest.entries !== eligibility.registrationEntries
    || shared.peerRegistrationDigest !== eligibility.peerRegistrationDigest
    || shared.sharedRefDigest !== eligibility.sharedRefDigest
    || shared.objectInventoryDigest !== eligibility.objectInventoryDigest
    || shared.sharedStateBytes !== eligibility.sharedStateBytes
    || shared.sharedStateEntries !== eligibility.sharedStateEntries
    || policy.profile.profileDigest !== eligibility.profileDigest
    || policy.canonicalRevision !== eligibility.canonicalRevision)
    fail('blocked-cleanup-retained-artifact', 'completed quarantine evidence drifted');
  return { artifacts: { operationPath, projectionPath, registrationPath,
    projectionQuarantined: true, registrationQuarantined: true, replayed: true },
  result: frozen({ targetPath: plan.targetPath, projectionQuarantinePath: projectionPath,
    registrationQuarantinePath: registrationPath, executedAt: metadata.executedAt }) };
}
/** Move exact projection then exact registration into clone-private quarantine. Never delete. */
export function quarantineWorktreeTarget(plan, before, {
  cwd = process.cwd(), eligibility, authorizeEffects,
} = {}) {
  const controller = resolveRepositoryRoot(cwd), common = before.commonDirectory;
  if (realpathSync(commonDir(controller)) !== common)
    fail('blocked-cleanup-controller', 'cleanup controller clone changed');
  if (typeof authorizeEffects !== 'function')
    fail('blocked-cleanup-authorization', 'cleanup effect clock authorization is required');
  const executedAt = authorizeEffects();
  const quarantineRoot = join(common, QUARANTINE_ROOT);
  if (absent(quarantineRoot, 'cleanup-quarantine-root')) {
    try { mkdirSync(quarantineRoot, { mode: 0o700 }); }
    catch (error) { fail('blocked-cleanup-quarantine-root', `quarantine root creation failed: ${error.code}`); }
  }
  privateDirectory(quarantineRoot, 'cleanup-quarantine-root');
  const operationPath = join(quarantineRoot, plan.planDigest);
  try { mkdirSync(operationPath, { mode: 0o700 }); }
  catch (error) { fail('blocked-cleanup-quarantine-collision', `cleanup coordinate exists: ${error.code}`); }
  privateDirectory(operationPath, 'cleanup-operation-directory');
  const projectionPath = join(operationPath, 'projection');
  const registrationPath = join(operationPath, 'registration');
  const metadata = { schema: OPERATION_SCHEMA, eligibility, executedAt };
  try { writeFileSync(join(operationPath, 'operation.json'), canonicalJson(metadata),
    { flag: 'wx', mode: 0o600 }); }
  catch (error) { fail('blocked-cleanup-quarantine-collision',
    `cleanup metadata creation failed: ${error.code}`); }
  const artifacts = { operationPath, projectionPath, registrationPath,
    projectionQuarantined: false, registrationQuarantined: false };
  try {
    if (!absent(projectionPath, 'cleanup-quarantine-collision')
      || !absent(registrationPath, 'cleanup-quarantine-collision'))
      fail('blocked-cleanup-quarantine-collision', 'cleanup quarantine destination exists');
    renameSync(plan.targetPath, projectionPath);
    artifacts.projectionQuarantined = true;
    if (!absent(plan.targetPath, 'target-detachment'))
      fail('blocked-clean-detachment-unproven', 'target projection remained after quarantine');
    const detached = worktreeInventory(controller).find((entry) => entry.path === plan.targetPath);
    if (!detached || detached.locked || !detached.prunable
      || detached.head !== plan.expectedHeadRevision || detached.branch !== plan.expectedBranch)
      fail('blocked-clean-detachment-unproven', 'target registration is not exactly prunable');
    const admin = adminFor(plan.targetPath, common, plan.sharedStateEntryCeiling);
    const liveRegistration = observeQuarantineManifest(admin.adminPath, {
      byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling,
    });
    if (admin.id !== before.worktreeId || !same(liveRegistration, before.registrationManifest))
      fail('blocked-worktree-admin-backlink', 'worktree admin identity changed before quarantine');
    renameSync(admin.adminPath, registrationPath);
    artifacts.registrationQuarantined = true;
    const afterEntries = worktreeInventory(controller);
    const shared = sharedState(common, afterEntries, null, plan);
    const projectionManifest = observeQuarantineManifest(projectionPath, {
      byteCeiling: plan.projectionByteCeiling, entryCeiling: plan.projectionEntryCeiling,
    });
    const registrationManifest = observeQuarantineManifest(registrationPath, {
      byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling,
    });
    const policy = trustedState(plan, controller);
    if (afterEntries.some((entry) => entry.path === plan.targetPath)
      || shared.peerRegistrationDigest !== before.peerRegistrationDigest
      || !absent(plan.targetPath, 'target-detachment')
      || !absent(admin.adminPath, 'worktree-admin-detachment')
      || !same(projectionManifest, before.projectionManifest)
      || !same(registrationManifest, before.registrationManifest)
      || shared.sharedRefDigest !== before.sharedRefDigest
      || shared.objectInventoryDigest !== before.objectInventoryDigest
      || shared.sharedStateBytes !== before.sharedStateBytes
      || shared.sharedStateEntries !== before.sharedStateEntries
      || policy.profile.profileDigest !== before.profileDigest
      || policy.canonicalRevision !== before.canonicalRevision)
      fail('blocked-cleanup-postcondition', 'cleanup quarantine postconditions failed');
    return { artifacts, result: frozen({ targetPath: plan.targetPath,
      projectionQuarantinePath: projectionPath, registrationQuarantinePath: registrationPath,
      executedAt }) };
  } catch (error) {
    error.operationArtifacts = frozen(artifacts);
    throw error;
  }
}
