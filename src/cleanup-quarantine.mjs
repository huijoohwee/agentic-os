/** Exact-path, quarantine-only Git worktree observation and mutation mechanics. */
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest, RETAIN_ALL_CLEANUP } from './governance.mjs';
import { loadRepositoryTrust, observeRepositoryProfileAtRef, resolveRepositoryRoot } from './git-repository.mjs';
import { validateAuthenticatedTransitionOperationReceipt } from './completion.mjs';
import { collectRecoveryInventory } from './recovery-inventory.mjs';
import { commonDir, isAncestor, observeGit, worktreeInventory } from './git.mjs';
import { isLaneRef } from './lane-id.mjs';
import { boundedDirectoryEntries, observeQuarantineManifest, readBoundedStableFile, sameCleanupNode as sameNode, strictCleanupStat as strictStat } from './cleanup-manifest.mjs';
import { freezeCleanupRecord as frozen, validateCurrentQuarantineReconciliation,
  validateWorktreeCleanupEligibility } from './cleanup-records.mjs';
export { observeQuarantineManifest } from './cleanup-manifest.mjs';
const UTF8 = new TextDecoder('utf-8', { fatal: true }), QUARANTINE_ROOT = 'agentic-os-cleanup-quarantine',
  OPERATION_SCHEMA = 'agentic-os/worktree-quarantine-operation/v1';
const QUARANTINE_OBSERVATION_ENTRY_CEILING = 16_384;
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function absent(path, label) {
  try { lstatSync(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; fail(`blocked-${label}`, `${label} absence is not proven`); }
}
function selectedManifest(root, names, limits, { allowMissing = false, label, retainedHardlinks = false, observe = observeQuarantineManifest, modeOverride = null } = {}) {
  const rootBefore = strictStat(root, `${label}-root`);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() || new Set(names).size !== names.length || names.some((name) => !name || name === '.' || name === '..' || name.includes('/'))) fail('blocked-cleanup-manifest', `${label} selection is unsafe`);
  let bytes = 0, entries = names.length;
  const items = [...names].sort().map((name) => {
    const path = join(root, name), stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!stat) {
      if (!allowMissing) fail('blocked-cleanup-manifest', `${label} path is absent`);
      return { name, manifest: null };
    }
    const manifest = observe(path, { ...limits, retainedHardlinks });
    bytes += manifest.bytes; entries += manifest.entries;
    if (!Number.isSafeInteger(bytes) || bytes > limits.byteCeiling || !Number.isSafeInteger(entries) || entries > limits.entryCeiling) fail('blocked-cleanup-manifest', `${label} ceiling exceeded`);
    return { name, manifest };
  });
  const rootAfter = lstatSync(root, { bigint: true, throwIfNoEntry: false }); if (!sameNode(rootBefore, rootAfter)) fail('blocked-cleanup-manifest', `${label} root changed during observation`);
  return frozen({ digest: governanceDigest({ schema: 'agentic-os/selected-manifest/v1', label, mode: modeOverride ?? (rootBefore.mode & 0o7777n).toString(8), items }), bytes, entries });
}
function observeRegistrationManifest(root, limits, modeOverride = null) {
  const ignored = new Set(['fsmonitor--daemon', 'fsmonitor--daemon.ipc']);
  const names = boundedDirectoryEntries(root, limits.entryCeiling, 'worktree registration').map((entry) => entry.name).filter((name) => !ignored.has(name));
  return selectedManifest(root, names, limits, { label: 'worktree-registration', modeOverride });
}
function sharedState(common, worktrees, excludedAdminId, plan) {
  if (process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES)
    fail('blocked-cleanup-object-alternate', 'alternate object environment is unsupported');
  for (const name of ['alternates', 'http-alternates']) {
    const stat = lstatSync(join(common, 'objects', 'info', name), { bigint: true, throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0n))
      fail('blocked-cleanup-object-alternate', 'alternate object stores are unsupported');
  }
  const limits = { byteCeiling: plan.sharedStateByteCeiling, entryCeiling: plan.sharedStateEntryCeiling };
  const adminRoot = join(common, 'worktrees');
  const adminNames = boundedDirectoryEntries(adminRoot, limits.entryCeiling, 'peer worktree admin').map((entry) => entry.name).filter((name) => name !== excludedAdminId);
  const peerPhysical = selectedManifest(adminRoot, adminNames, limits, { label: 'peer-worktree-admin', observe: observeRegistrationManifest });
  const refs = selectedManifest(common, ['AUTO_MERGE', 'BISECT_HEAD', 'CHERRY_PICK_HEAD', 'FETCH_HEAD', 'HEAD', 'MERGE_HEAD', 'ORIG_HEAD', 'REBASE_HEAD', 'REVERT_HEAD', 'logs', 'packed-refs', 'refs', 'reftable'], limits, { allowMissing: true, label: 'shared-refs-reflogs' });
  const objects = selectedManifest(common, ['objects'], limits, { label: 'shared-object-store', retainedHardlinks: true });
  const sharedStateBytes = peerPhysical.bytes + refs.bytes + objects.bytes;
  const sharedStateEntries = peerPhysical.entries + refs.entries + objects.entries;
  if (sharedStateBytes > limits.byteCeiling || sharedStateEntries > limits.entryCeiling) fail('blocked-cleanup-manifest', 'aggregate shared state ceiling exceeded');
  const registrations = worktrees.filter((entry) => entry.path !== plan.targetPath).sort((left, right) => left.path.localeCompare(right.path));
  return frozen({ peerRegistrationDigest: governanceDigest({ schema: 'agentic-os/peer-registration-state/v1', registrations, peerPhysical }), sharedRefDigest: refs.digest, objectInventoryDigest: objects.digest, sharedStateBytes, sharedStateEntries });
}
function adminFor(targetPath, common, entryCeiling) {
  const root = join(common, 'worktrees'), rootStat = strictStat(root, 'worktree-admin-root');
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('blocked-worktree-admin-root', 'worktree admin root is unsafe');
  const matches = [];
  for (const entry of boundedDirectoryEntries(root, entryCeiling, 'worktree admin')) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const adminPath = join(root, entry.name), gitdirPath = join(adminPath, 'gitdir');
    const stat = lstatSync(gitdirPath, { bigint: true, throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) continue;
    if (stat.size > 8_192n) fail('blocked-worktree-admin-backlink', 'worktree admin backlink exceeds its byte bound');
    const value = UTF8.decode(readBoundedStableFile(gitdirPath, 8_192, 'worktree-admin-backlink'));
    if (value === `${join(targetPath, '.git')}\n`) matches.push({ id: entry.name, adminPath });
  }
  if (matches.length !== 1) fail('blocked-worktree-admin-backlink', 'target must have one exact worktree admin backlink');
  return matches[0];
}
function trustedState(plan, cwd) {
  const root = resolveRepositoryRoot(cwd), trust = loadRepositoryTrust(root);
  const observed = observeRepositoryProfileAtRef({ repository: root, ref: trust.canonical.localRef });
  const profile = observed.profile;
  if (!profile || trust.repository !== plan.repository || profile.repository !== plan.repository || trust.canonical.localRef !== plan.expectedCanonicalRef || profile.canonical.localRef !== plan.expectedCanonicalRef || profile.canonical.remoteRef !== trust.canonical.remoteRef || observed.revision !== plan.expectedCanonicalRevision || profile.profileDigest !== plan.profileDigest) fail('blocked-cleanup-profile', 'trusted repository, profile, or canonical ref changed');
  const expectedCleanup = { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine' };
  if (!same(profile.adapters.repository, { id: 'git', version: '1' }) || !same(profile.cleanup, expectedCleanup)) fail('blocked-cleanup-profile', 'trusted profile does not opt in to exact quarantine effects');
  return { root, trust, profile, canonicalRevision: observed.revision };
}
/** Observe the exact active projection, dirty recovery inventory, policy, refs, and admin bytes. */
export function observeWorktreeCleanupTarget(plan, { cwd = process.cwd(), observePolicy = trustedState, reuseRecoveryInventory = false, forceFreshRecoveryInventory = false, now = Date.now } = {}) {
  const trusted = observePolicy(plan, cwd), controller = realpathSync(trusted.root);
  if (controller === plan.targetPath) fail('blocked-cleanup-controller', 'cleanup must run from a surviving peer worktree');
  const common = realpathSync(commonDir(controller));
  if (realpathSync(commonDir(plan.targetPath)) !== common) fail('blocked-target-registration', 'target belongs to a different clone');
  const entries = worktreeInventory(controller);
  const targets = entries.filter((entry) => entry.path === plan.targetPath);
  if (targets.length !== 1 || targets[0].bare || targets[0].locked) fail('blocked-target-registration', 'target registration is absent, ambiguous, bare, or locked');
  const entry = targets[0], projectionStat = strictStat(plan.targetPath, 'target-projection');
  if (`refs/heads/${entry.branch}` === trusted.profile.canonical.localRef)
    fail('blocked-cleanup-canonical-projection', 'canonical worktree projection must be retained');
  const detachedRecovery = plan.mode === 'explicit-local-user-consent-recovery' && plan.detachedRecovery === true && plan.expectedBranch === null;
  const retainedHead = detachedRecovery ? null : observeGit(['rev-parse', '--verify', `refs/heads/${plan.expectedBranch}^{commit}`], { cwd: controller, allowFail: true });
  if (!projectionStat.isDirectory() || projectionStat.isSymbolicLink() || realpathSync(plan.targetPath) !== plan.targetPath) fail('blocked-target-projection', 'target projection is not one direct directory');
  if (entry.head !== plan.expectedHeadRevision || entry.branch !== plan.expectedBranch || (detachedRecovery ? !entry.detached : retainedHead !== plan.expectedHeadRevision)) fail('blocked-target-identity', 'target branch or head changed');
  const remaining = Date.parse(plan.expiresAt) - now(), canReuse = reuseRecoveryInventory && !forceFreshRecoveryInventory
    && Number.isSafeInteger(remaining) && remaining > 0 && remaining <= 900_000
    && /^[0-9a-f]{64}$/u.test(plan.recoveryInventoryDigest ?? '') && Number.isSafeInteger(plan.recoveryInventoryContentEntries) && plan.recoveryInventoryContentEntries >= 0;
  const recoveryInventory = canReuse ? null : collectRecoveryInventory({ cwd: plan.targetPath, canonicalRef: plan.expectedCanonicalRef, allowDetached: detachedRecovery, maxContentEntries: plan.projectionEntryCeiling });
  const recoveryInventoryDigest = recoveryInventory ? governanceDigest(recoveryInventory) : plan.recoveryInventoryDigest, recoveryInventoryContentEntries = recoveryInventory?.inventoryEntries.content ?? plan.recoveryInventoryContentEntries;
  if (recoveryInventory && (recoveryInventoryDigest !== plan.recoveryInventoryDigest || recoveryInventoryContentEntries !== plan.recoveryInventoryContentEntries || recoveryInventory.headRevision !== plan.expectedHeadRevision || recoveryInventory.canonicalRevision !== plan.expectedCanonicalRevision || recoveryInventory.branch !== plan.expectedBranch)) fail('blocked-recovery-inventory-drift', 'dirty recovery inventory changed or is unbound');
  const admin = adminFor(plan.targetPath, common, plan.sharedStateEntryCeiling);
  const projectionManifest = observeQuarantineManifest(plan.targetPath, { byteCeiling: plan.projectionByteCeiling, entryCeiling: plan.projectionEntryCeiling, retainedHardlinks: plan.mode === 'explicit-local-user-consent-recovery' }), registrationManifest = observeRegistrationManifest(admin.adminPath, { byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling });
  const shared = sharedState(common, entries, admin.id, plan);
  const base = { repositoryRoot: controller, commonDirectory: common, worktreeId: admin.id, adminPath: admin.adminPath, profileDigest: trusted.profile.profileDigest, canonicalRevision: trusted.canonicalRevision, recoveryInventoryDigest, recoveryInventoryContentEntries, projectionManifest, registrationManifest, ...shared };
  return frozen({ ...base, observationDigest: governanceDigest(base) });
}
function privateDirectory(path, label) { const stat = strictStat(path, label); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.nlink < 2n || (stat.mode & 0o077n) !== 0n) fail(`blocked-${label}`, `${label} is not a private directory`); }
function readOperation(path, eligibility = null) {
  const metadataPath = join(path, 'operation.json');
  let bytes, value;
  try { bytes = readBoundedStableFile(metadataPath, 64_000, 'cleanup-retained-artifact'); }
  catch { fail('blocked-cleanup-retained-artifact', 'quarantine operation metadata is unsafe'); }
  try { value = JSON.parse(UTF8.decode(bytes)); }
  catch { fail('blocked-cleanup-retained-artifact', 'quarantine operation metadata is invalid'); }
  eligibility ??= value?.eligibility;
  if (!eligibility || !value || Object.keys(value).sort().join(',') !== 'eligibility,executedAt,schema'
    || value.schema !== OPERATION_SCHEMA || !same(value.eligibility, eligibility)
    || !bytes.equals(Buffer.from(canonicalJson(value), 'utf8'))
    || !Number.isFinite(Date.parse(value.executedAt))
    || new Date(Date.parse(value.executedAt)).toISOString() !== value.executedAt
    || Date.parse(value.executedAt) < Date.parse(eligibility.evaluatedAt)
    || Date.parse(value.executedAt) >= Date.parse(eligibility.expiresAt))
    fail('blocked-cleanup-retained-artifact', 'quarantine operation metadata does not match'); return value;
}
export const retirementEligibility = e => {
  const schema = e?.schema, local = schema === 'local-owner-authorized-quarantine-eligibility/v1', coordinate = schema === 'agentic-os/worktree-cleanup-eligibility/v1' ? e.cleanupPlanDigest : e?.planDigest, manifest = key => local ? e?.[`${key}Manifest`] : { digest: e?.[`${key}ManifestDigest`], bytes: e?.[`${key}Bytes`], entries: e?.[`${key}Entries`] }, projection = manifest('projection'), registration = manifest('registration');
  if (!['agentic-os/worktree-cleanup-eligibility/v1', 'agentic-os/user-cleanup-eligibility/v1', 'agentic-os/empty-active-lane-retirement-eligibility/v1', 'local-owner-authorized-quarantine-eligibility/v1'].includes(schema) || !/^[a-f0-9]{64}$/u.test(coordinate ?? '') || ![projection?.bytes, projection?.entries, registration?.bytes, registration?.entries].every(value => Number.isSafeInteger(value) && value >= 0) || projection.bytes > 4 * 1024 ** 3 || projection.entries > 250000 || registration.bytes > 16 * 1024 ** 2 || registration.entries > 20000) return null;
  return { coordinate, projection, registration };
};
function detachedReviewedHead(root, registered, receipt, head) {
  const oid = receipt?.detachedHead; if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid ?? '') || registered !== `${oid}\n`) return null;
  const trees = [oid, head].map(revision => observeGit(['rev-parse', '--verify', `${revision}^{tree}`], { cwd: root, allowFail: true })); return trees[0] && trees[0] === trees[1] ? oid : null;
}
function detachedReceiptMatches(receipt, detachedHead, reviewedHead) {
  const i=receipt?.integration,p=i?.detached?.inclusion,exact=i?.kind==='equal-tree'&&i.headTree===i.mergeTree&&i.detached?.head===detachedHead&&i.detached?.reviewedHead===reviewedHead&&p?.kind==='equal-tree'&&p.headTree===i.headTree&&p.mergeTree===i.mergeTree;
  return exact||i?.kind==='reviewed-equivalent-superseded-transition'&&i.detachedHead===detachedHead&&i.reviewedCommit===reviewedHead&&i.sourceIntegrated===false&&i.reviewedSource?.kind==='equal-tree'&&i.reviewedSource.headTree===i.reviewedSource.mergeTree&&receipt.historicalDraft==='superseded';
}
function exactManifest(value, expected) { return value?.digest === expected.digest && value?.bytes === expected.bytes && value?.entries === expected.entries; }
function observeBoundRegistrationManifest(root, expected) {
  const limits = { byteCeiling: expected.bytes, entryCeiling: expected.entries, retainedHardlinks: true };
  for (const observe of [observeQuarantineManifest, observeRegistrationManifest]) { try { const manifest = observe(root, limits); if (exactManifest(manifest, expected)) return manifest; } catch { /* Exact fallback only. */ } } return null;
}
function retainedTargetPath(registration) {
  const backlink = UTF8.decode(readBoundedStableFile(join(registration, 'gitdir'), 8192, 'retained-worktree-backlink'));
  if (!backlink.endsWith('/.git\n')) fail('blocked-cleanup-retained-artifact', 'retained worktree backlink does not identify a direct checkout');
  const target = backlink.slice(0, -6);
  if (!target.startsWith('/') || target === '/' || resolve(target) !== target) fail('blocked-cleanup-retained-artifact', 'retained worktree backlink path is invalid');
  return target;
}
function protectedRetirementReceipt(originalReceipt, eligibility, coordinate) {
  const receipt = validateAuthenticatedTransitionOperationReceipt(originalReceipt), transition = receipt.transitionReceipt, cleanup = validateWorktreeCleanupEligibility(eligibility);
  if (receipt.requestedTransition !== 'retire' || transition.resultState !== 'retired' || transition.immutableRevision !== cleanup.canonicalRevision || cleanup.cleanupPlanDigest !== coordinate || cleanup.retirementReceiptDigest !== receipt.receiptDigest || cleanup.retirementPlanByteDigest !== receipt.planByteDigest) fail('blocked-cleanup-retained-artifact', 'protected retirement receipt does not bind the retained cleanup operation');
  return receipt;
}
function reconciliationCandidate(value, { originalReceipt, originalRegistrationManifest,
  ref, head, coordinate }) {
  const basis = validateCurrentQuarantineReconciliation(value);
  if (basis.targetRef !== ref || basis.targetHead !== head || basis.quarantineCoordinate !== coordinate || basis.merge !== originalReceipt?.review?.merge || basis.originalReceiptDigest !== governanceDigest(originalReceipt) || !exactManifest(basis.originalRegistrationManifest, originalRegistrationManifest)) fail('blocked-cleanup-retained-artifact', 'reconciliation basis does not bind retained registration facts');
  return basis;
}
function reconciliationMatches(basis, currentRegistrationManifest) { if (!exactManifest(basis.currentRegistrationManifest, currentRegistrationManifest)) fail('blocked-cleanup-retained-artifact', 'reconciliation basis current registration differs'); return basis; }
function retainedInventorySnapshot(root, operation, registration, canonicalRef, detachedRegistration,
  detachedHead, maxContentEntries) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-retained-index-'), { encoding: 'utf8' }));
  try {
    const sourceIndex = join(registration, 'index'), sourceHead = join(registration, 'HEAD'), index = readBoundedStableFile(sourceIndex, 16 * 1024 ** 2, 'retained-index'), head = readBoundedStableFile(sourceHead, 256, 'retained-index-head');
    writeFileSync(join(directory, 'index'), index, { encoding: null, flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'HEAD'), head, { encoding: null, flag: 'wx', mode: 0o600 });
    const common = realpathSync(commonDir(root)), inventory = collectRecoveryInventory({ cwd: join(operation, 'projection'), canonicalRef, allowDetached: detachedRegistration, retainedHeadRevision: detachedRegistration ? detachedHead : null, maxContentEntries, repositoryContext: { commonDirectory: common, gitDirectory: common, worktree: join(operation, 'projection'), indexFile: join(directory, 'index') } });
    if (!readBoundedStableFile(sourceIndex, 16 * 1024 ** 2, 'retained-index-after').equals(index) || !readBoundedStableFile(sourceHead, 256, 'retained-index-head-after').equals(head))
      fail('blocked-cleanup-retained-artifact', 'retained index changed during inventory observation');
    return inventory;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function observeRetainedQuarantineEvidence(root, ref, head, coordinate = null, { originalReceipt = null, canonicalRef, reconciliation = null, diagnostic = false, retirementTarget = false } = {}) {
  try {
    const base = join(realpathSync(commonDir(root)), QUARANTINE_ROOT); privateDirectory(base, 'cleanup-quarantine-root');
    const exactStat = typeof coordinate === 'string' && /^[a-f0-9]{64}$/u.test(coordinate) ? lstatSync(join(base, coordinate), { throwIfNoEntry: false }) : null, entries = coordinate === null ? boundedDirectoryEntries(base, QUARANTINE_OBSERVATION_ENTRY_CEILING, 'cleanup-quarantine-root') : exactStat?.isDirectory() ? [{ name: coordinate, isDirectory: () => true, isSymbolicLink: () => false }] : [];
    for (const entry of entries) {
      if (coordinate !== null && entry.name !== coordinate) continue;
      if (!/^[a-f0-9]{64}$/u.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const operation = join(base, entry.name), registration = join(operation, 'registration'); privateDirectory(operation, 'cleanup-operation-directory');
        const registrationHead = UTF8.decode(readBoundedStableFile(join(registration, 'HEAD'), 256, 'retained-head')),
          log = UTF8.decode(readBoundedStableFile(join(registration, 'logs', 'HEAD'), 16 * 1024 ** 2, 'retained-head-log')).trimEnd().split('\n'),
          [prior, next] = log.at(-1)?.split(' ') ?? [], retainedHead = /^0{40}(?:0{24})?$/u.test(next ?? '') ? prior : next;
        let branchTip = null;
        if (retirementTarget) {
          const attached = /^ref: refs\/heads\/(.+)\n$/u.exec(registrationHead), headEntry = !attached && [...log].reverse().map(line => /\tcheckout: moving from (.+) to ([a-f0-9]{40}(?:[a-f0-9]{24})?)$/u.exec(line)).find(match => match?.[2] === retainedHead); head = retainedHead; ref = attached?.[1] ?? headEntry?.[1];
          if (!isLaneRef(ref) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head ?? '') || !attached && registrationHead !== `${head}\n`) continue;
          branchTip = observeGit(['rev-parse', '--verify', `refs/heads/${ref}^{commit}`], { cwd: root, allowFail: true }); if (!branchTip || !isAncestor(head, branchTip, root)) continue;
        }
        const detachedHead = detachedReviewedHead(root, registrationHead, originalReceipt, head) ?? (retirementTarget && branchTip && registrationHead === `${head}\n` ? head : null), detachedRegistration = detachedHead !== null;
        if (registrationHead !== `ref: refs/heads/${ref}\n` && !detachedRegistration) continue;
        const record = readOperation(operation), e = record.eligibility, binding = retirementEligibility(e); if (binding?.coordinate !== entry.name) continue;
        const protectedReceipt = ['agentic-os/authenticated-transition-operation-receipt/v1', 'agentic-os/authenticated-transition-operation-receipt/v2'].includes(originalReceipt?.schema);
        if (protectedReceipt) protectedRetirementReceipt(originalReceipt, e, entry.name);
        const targetPath = protectedReceipt ? retainedTargetPath(registration) : originalReceipt?.targetPath;
        if (originalReceipt && !protectedReceipt && (originalReceipt.schema !== 'agentic-os/user-cleanup-receipt/v1'
          || originalReceipt.mode !== 'explicit-local-user-consent-recovery' || originalReceipt.planDigest !== entry.name
          || originalReceipt.review?.branch !== ref || originalReceipt.review?.head !== head
          || originalReceipt.operationPath !== operation || originalReceipt.projectionQuarantinePath !== join(operation, 'projection')
          || originalReceipt.registrationQuarantinePath !== registration || originalReceipt.executedAt !== record.executedAt
          || originalReceipt.result !== 'quarantined' || originalReceipt.projectionQuarantined !== true
          || originalReceipt.registrationQuarantined !== true || originalReceipt.stoppedAcknowledged !== true
          || detachedRegistration && !detachedReceiptMatches(originalReceipt, detachedHead, head)
          || Boolean(originalReceipt.detachedHead) !== detachedRegistration
          || ['providerAuthority', 'claimRetired', 'bytesDeleted', 'branchesMutated', 'objectsMutated'].some(key => originalReceipt[key] !== false)
          )) continue;
        if (originalReceipt && (!targetPath || !absent(targetPath, 'retained-target') || worktreeInventory(root).some(row => row.path === targetPath || row.branch === ref))) continue;
        const originalRegistrationManifest = binding.registration;
        const candidate = reconciliation !== null ? reconciliationCandidate(reconciliation,
          { originalReceipt, originalRegistrationManifest, ref, head, coordinate: entry.name }) : null;
        const projection = observeQuarantineManifest(join(operation, 'projection'), { byteCeiling: binding.projection.bytes, entryCeiling: binding.projection.entries, retainedHardlinks: true }),
          retained = retirementTarget ? observeBoundRegistrationManifest(registration, candidate?.currentRegistrationManifest ?? originalRegistrationManifest)
            : observeRegistrationManifest(registration, { byteCeiling: candidate?.currentRegistrationManifest.bytes ?? binding.registration.bytes,
              entryCeiling: candidate?.currentRegistrationManifest.entries ?? binding.registration.entries });
        if (!retained) continue;
        const registrationMatches = exactManifest(retained, originalRegistrationManifest);
        const basis = !registrationMatches && candidate !== null
          ? reconciliationMatches(candidate, retained) : null;
        if (projection.digest === binding.projection.digest && projection.bytes === binding.projection.bytes
          && projection.entries === binding.projection.entries && (registrationMatches || basis !== null)
          && retainedHead === (detachedRegistration ? detachedHead : head)) {
          const inventory = originalReceipt ? retainedInventorySnapshot(root, operation, registration,
            canonicalRef, detachedRegistration, detachedHead, binding.projection.entries) : null;
          if (inventory && (inventory.branch !== (detachedRegistration ? null : ref) || inventory.headRevision !== (detachedRegistration ? detachedHead : head) || !same(record, readOperation(operation)) || !absent(targetPath, 'retained-target') || worktreeInventory(root).some(row => row.path === targetPath || row.branch === ref))) continue;
          for (const path of [base, operation]) privateDirectory(path, 'cleanup-operation-directory');
          return frozen({ coordinate: entry.name, operationDigest: governanceDigest(record), registrationRef: ref,
            retainedHead, projectionManifest: projection, registrationManifest: retained, ...(retirementTarget ? { branchTip, registrationHead } : {}),
            ...(basis ? { reconciliationDigest: basis.basisDigest,
              originalRegistrationManifest: basis.originalRegistrationManifest,
              registrationReconciled: true } : {}),
            ...(inventory ? { originalReceiptDigest: protectedReceipt ? originalReceipt.receiptDigest : governanceDigest(originalReceipt),
              retainedIndexInventoryDigest: inventory.indexInventoryDigest, recoveryInventoryDigest: governanceDigest(inventory) } : {}) });
        }
      } catch (error) {
        if (diagnostic) throw error;
        /* A partial, changed or unbound coordinate cannot establish completion. */
      }
    }
  } catch (error) {
    if (diagnostic) throw error;
    /* No bounded retained proof is available. */
  }
  return null;
}
export const observeRetainedWorktreeQuarantine = (root, ref, head, originalReceipt = null, canonicalRef = null) => observeRetainedQuarantineEvidence(root, ref, head, originalReceipt?.planDigest ?? null, { originalReceipt, ...(canonicalRef ? { canonicalRef } : {}) }) !== null;
/** Verify prior discard evidence without treating the deleted projection as preserved. */ export function observeDiscardedQuarantineEvidence(root, ref, head, coordinate, { originalReceipt } = {}) { try {
  const common = realpathSync(commonDir(root)), operation = join(common, QUARANTINE_ROOT, coordinate), registration = join(operation, 'registration'), receiptPath = join(operation, 'retirement.json'); privateDirectory(join(common, QUARANTINE_ROOT), 'cleanup-quarantine-root'); privateDirectory(operation, 'cleanup-operation-directory'); const names = boundedDirectoryEntries(operation, 8, 'discarded-quarantine-operation').map(entry => entry.name).sort(), record = readOperation(operation), binding = retirementEligibility(record.eligibility);
  if (!same(names, ['operation.json', 'registration', 'retirement.json']) || !absent(join(operation, 'projection'), 'discarded-quarantine-projection')) return null; const receiptBytes = readBoundedStableFile(receiptPath, 64_000, 'discarded-quarantine-receipt'), receipt = JSON.parse(UTF8.decode(receiptBytes)), { receiptDigest, ...payload } = receipt, worktrees = worktreeInventory(root);
  if (!binding || binding.coordinate !== coordinate || !['agentic-os/user-cleanup-eligibility/v1', 'agentic-os/worktree-cleanup-eligibility/v1'].includes(record.eligibility.schema) || !receiptBytes.equals(Buffer.from(canonicalJson(receipt), 'utf8')) || receipt.schema !== 'agentic-os/quarantine-retirement-receipt/v2' || governanceDigest(payload) !== receiptDigest || !same(receipt, originalReceipt) || receipt.coordinate !== coordinate || !/^[a-f0-9]{64}$/u.test(receipt.planDigest) || receipt.receiptPath !== receiptPath || receipt.operationDigest !== governanceDigest(record) || receipt.eligibilityDigest !== governanceDigest(record.eligibility) || receipt.branch !== ref || receipt.retainedHead !== head || receipt.branchTip !== head || !Number.isSafeInteger(receipt.executedAt) || receipt.executedAt < Date.parse(record.executedAt) || receipt.logicalBytesUnlinked !== binding.projection.bytes || receipt.recoveryBytesDiscarded !== true || receipt.bytesDeleted !== true || receipt.registrationRetained !== true || receipt.physicalFreeSpaceIncreaseProven !== false || receipt.branchRefsMutated !== false || receipt.objectDatabaseMutated !== false || receipt.providerAuthority !== false || receipt.claimRetired !== false || ![0o700, 0o755].includes(receipt.registrationRootModeBefore) || receipt.registrationRootPermissionsTightened !== (receipt.registrationRootModeBefore === 0o755) || observeGit(['rev-parse', '--verify', `refs/heads/${ref}^{commit}`], { cwd: root, allowFail: true }) !== head || worktrees.some(row => row.path === retainedTargetPath(registration) || row.branch === ref)) return null;
  privateDirectory(registration, 'discarded-quarantine-registration'); const registrationMode = Number(lstatSync(registration, { bigint: true }).mode & 0o7777n); if (registrationMode !== 0o700) return null; const retained = observeRegistrationManifest(registration, { byteCeiling: binding.registration.bytes, entryCeiling: binding.registration.entries }, receipt.registrationRootModeBefore.toString(8)); if (!exactManifest(retained, binding.registration)) return null; const targetPath = retainedTargetPath(registration), headBytes = readBoundedStableFile(join(registration, 'HEAD'), 256, 'discarded-quarantine-head'), indexBytes = readBoundedStableFile(join(registration, 'index'), 16 * 1024 ** 2, 'discarded-quarantine-index');
  if (UTF8.decode(headBytes) !== `ref: refs/heads/${ref}\n` || Number(lstatSync(registration, { bigint: true }).mode & 0o7777n) !== registrationMode || !absent(targetPath, 'discarded-quarantine-target') || !same(worktrees, worktreeInventory(root)) || !exactManifest(observeRegistrationManifest(registration, { byteCeiling: binding.registration.bytes, entryCeiling: binding.registration.entries }, receipt.registrationRootModeBefore.toString(8)), retained) || !readBoundedStableFile(receiptPath, 64_000, 'discarded-quarantine-receipt-after').equals(receiptBytes) || observeGit(['rev-parse', '--verify', `refs/heads/${ref}^{commit}`], { cwd: root, allowFail: true }) !== head || !absent(join(operation, 'projection'), 'discarded-quarantine-projection-after') || !absent(targetPath, 'discarded-quarantine-target-after')) return null; return frozen({ coordinate, operationDigest: governanceDigest(record), registrationRef: ref, retainedHead: head, projectionManifest: binding.projection, registrationManifest: retained, originalReceiptDigest: receiptDigest, retainedIndexBytesDigest: createHash('sha256').update(indexBytes).digest('hex'), retainedHeadBytesDigest: createHash('sha256').update(headBytes).digest('hex'), projectionRetained: false, recoveryBytesDiscarded: true });
} catch { return null; } }
export function classifyExistingWorktreeQuarantine(plan, eligibility, {
  cwd = process.cwd(), observePolicy = trustedState,
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
    retainedHardlinks: plan.mode === 'explicit-local-user-consent-recovery',
  });
  const retainedRegistrationManifest = observeRegistrationManifest(registrationPath, {
    byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling,
  });
  const entries = worktreeInventory(controller), policy = observePolicy(plan, controller);
  const shared = sharedState(common, entries, null, plan);
  if (entries.some((entry) => entry.path === plan.targetPath)
    || projectionManifest.digest !== eligibility.projectionManifestDigest
    || projectionManifest.bytes !== eligibility.projectionBytes
    || projectionManifest.entries !== eligibility.projectionEntries
    || retainedRegistrationManifest.digest !== eligibility.registrationManifestDigest
    || retainedRegistrationManifest.bytes !== eligibility.registrationBytes
    || retainedRegistrationManifest.entries !== eligibility.registrationEntries
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
  cwd = process.cwd(), eligibility, authorizeEffects, observePolicy = trustedState,
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
    const liveRegistration = observeRegistrationManifest(admin.adminPath, {
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
      retainedHardlinks: plan.mode === 'explicit-local-user-consent-recovery',
    });
    const retainedRegistrationManifest = observeRegistrationManifest(registrationPath, {
      byteCeiling: plan.registrationByteCeiling, entryCeiling: plan.registrationEntryCeiling,
    });
    const policy = observePolicy(plan, controller);
    if (afterEntries.some((entry) => entry.path === plan.targetPath)
      || shared.peerRegistrationDigest !== before.peerRegistrationDigest
      || !absent(plan.targetPath, 'target-detachment')
      || !absent(admin.adminPath, 'worktree-admin-detachment')
      || !same(projectionManifest, before.projectionManifest)
      || !same(retainedRegistrationManifest, before.registrationManifest)
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
