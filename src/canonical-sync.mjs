/** Recovery-backed canonical sync: read-only plan, durable snapshot, then protected SHA-CAS. */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { abortCanonicalIndex, installStagedEntries, prepareCanonicalIndex, publishCanonicalIndex, removeStagedTree, stageTreeEntries } from './canonical-staging.mjs';
import { captureCanonicalRecovery, CanonicalSyncError, createCanonicalArtifacts, recordCanonicalFailureEffects, retainCanonicalEffect } from './canonical-recovery.mjs';
import { assertCanonicalReconciliationPlan, assertIgnoredProjectionSafe, assertProjectionBudget, boundedCanonicalPlan, buildCleanRetirementProjection, buildDirtyQuarantineProjection, canonicalPlanBody, canonicalReconciliation, CanonicalResourceError, parseTreeEntries } from './canonical-resources.mjs';
import { snapshotWorktreeEntry } from './file-integrity.mjs';
import { acquireOperationLock, assertDirectoryAncestors, atomicAdvanceRef, currentBranch, decodeNulFields as decodeGitNul, finishOperationLock, git, isAncestor, quarantineWorktreeEntries, repoRoot, retireCleanProjectionUnderExclusiveContract } from './git.mjs';
export const PLAN_SCHEMA = 'agentic-os-canonical-sync-plan/v2'; export const RECEIPT_SCHEMA = 'agentic-os-canonical-sync-receipt/v2';
export const CANONICAL_SYNC_LIMITS = Object.freeze({ serializedPlanBytes: 500_000,
  quarantineManifestBytes: 500_000, inventoryEntries: 1_024, treeEntries: 50_000,
  targetDirectories: 50_000,
  sourceFileBytes: 32 * 1024 * 1024, aggregateSourceBytes: 128 * 1024 * 1024,
  targetFileBytes: 32 * 1024 * 1024, aggregateTargetBytes: 128 * 1024 * 1024 });
export { CanonicalSyncError };
function refuse(reason, detail = {}) { throw new CanonicalSyncError(reason, detail); }
function resource(operation) { try { return operation(); } catch (error) { if (error instanceof CanonicalResourceError) refuse(`blocked-${error.code}`, error.detail);
  throw error; } }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function decodeNulFields(value) { const fields = decodeGitNul(value); if (!fields) refuse('blocked-invalid-path-inventory'); return fields; }
function parseNameStatus(raw) {
  const fields = decodeNulFields(raw);
  const entries = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    const paths = status.startsWith('R') || status.startsWith('C') ? 2 : 1;
    for (let count = 0; count < paths; count += 1) {
      const path = fields[index++];
      if (path === undefined) refuse('blocked-malformed-git-status', { status });
      entries.push({ path, status: count === 0 ? status[0] : '?' });
    }
  }
  return entries;
}
function treeEntries(ref, cwd, options = {}) {
  const fields = decodeNulFields(git(['ls-tree', '-r', '-l', '-z', ref], { cwd, binary: true }));
  return resource(() => parseTreeEntries(fields, CANONICAL_SYNC_LIMITS.treeEntries, options));
}
function contentAt(path, cwd, budget = { bytes: 0 }) {
  let content;
  try { content = snapshotWorktreeEntry(join(cwd, path), {
    maxBytes: CANONICAL_SYNC_LIMITS.sourceFileBytes, aggregateBytes: CANONICAL_SYNC_LIMITS.aggregateSourceBytes, budget,
    label: `canonical source ${path}` }); } catch (error) {
    const reason = error.code === 'ERR_FILE_TOO_LARGE' ? 'blocked-source-file-limit'
      : error.code === 'ERR_AGGREGATE_TOO_LARGE' ? 'blocked-source-aggregate-limit' : 'blocked-source-inspection';
    refuse(reason, { path, cause: error.message });
  } return content;
}
function assertCleanIndex(cwd) {
  if (git(['diff', '--cached', '--quiet', 'HEAD', '--'], { cwd, allowFail: true }) === null)
    refuse('blocked-index-dirty');
  if (git(['ls-files', '--unmerged'], { cwd }) !== '') refuse('blocked-index-unmerged');
  const hidden = decodeNulFields(git(['ls-files', '-v', '-z'], { cwd, binary: true }))
    .map((record) => {
      if (record.length < 3 || record[1] !== ' ') refuse('blocked-malformed-index-flags');
      const tag = record[0];
      const assumeUnchanged = tag >= 'a' && tag <= 'z';
      const skipWorktree = tag.toUpperCase() === 'S';
      return { path: record.slice(2), assumeUnchanged, skipWorktree };
    })
    .filter((entry) => entry.assumeUnchanged || entry.skipWorktree);
  if (hidden.length > 0) refuse('blocked-index-visibility-flags', { entries: hidden });
}
function snapshotInventory(cwd, localSha, { rawTracked = true } = {}) {
  const budget = { bytes: 0 };
  const base = treeEntries(localSha, cwd);
  const dirty = parseNameStatus(git(['diff', '--name-status', '-z', '--no-renames', 'HEAD', '--'],
    { cwd, binary: true }));
  const untracked = decodeNulFields(git(['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd, binary: true })).map((path) => ({ path, status: '?' }));
  const byPath = new Map([...dirty, ...untracked].map((entry) => [entry.path, entry.status]));
  const assertCount = () => { if (byPath.size > CANONICAL_SYNC_LIMITS.inventoryEntries) refuse('blocked-plan-inventory-limit', { entries: byPath.size, limit: CANONICAL_SYNC_LIMITS.inventoryEntries }); };
  assertCount();
  for (const [path, prior] of base) {
    const stat = lstatSync(join(cwd, path), { throwIfNoEntry: false });
    if (!stat) {
      if (!byPath.has(path)) byPath.set(path, 'D'); assertCount();
      continue;
    }
    if (prior.mode === '160000') continue;
    const content = contentAt(path, cwd, budget);
    const rawDrift = rawTracked
      && git(['hash-object', '--stdin'], { cwd, input: content.bytes }) !== prior.oid;
    if ((content.mode !== prior.mode || rawDrift) && !byPath.has(path)) byPath.set(path, 'M');
    assertCount();
  }
  const inventory = [];
  for (const [path, status] of [...byPath].sort(([a], [b]) => a.localeCompare(b))) {
    const prior = base.get(path) ?? null;
    if (prior?.mode === '160000') refuse('blocked-dirty-submodule', { path });
    if (status === 'D') {
      inventory.push({ path, status, kind: 'deleted', mode: null, size: null,
        oid: null, sha256: null, prior });
      continue;
    }
    const content = contentAt(path, cwd, budget);
    const oid = git(['hash-object', '--stdin'], { cwd, input: content.bytes });
    inventory.push({ path, status, kind: content.kind, mode: content.mode,
      size: content.bytes.length, oid,
      sha256: sha256(content.bytes), prior });
  }
  return inventory;
}
function ignoredPaths(cwd) {
  return decodeNulFields(git(['ls-files', '--others', '--ignored', '--exclude-standard',
    '--directory', '-z'], { cwd, binary: true }))
    .map((path) => path.endsWith('/') ? path.slice(0, -1) : path)
    .sort();
}
function calculatePlanDigest(plan) { return sha256(JSON.stringify(canonicalPlanBody(plan))); }
function exclusiveAuthorization(digest) { return `agentic-os:canonical-sync:exclusive:${digest}`; }
function canonicalIdentity(branch, targetRef) {
  const match = targetRef?.match(/^refs\/remotes\/[^/]+\/(.+)$/u);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(branch ?? '') || match?.[1] !== branch
    || branch.includes('..') || branch.includes('//') || branch.includes('@{'))
    refuse('blocked-canonical-identity', { branch, targetRef });
  return `refs/heads/${branch}`;
}
function observed(cwd, targetRef, expectedBranch, { integrationReceiptDigest = null } = {}) {
  const root = realpathSync(repoRoot(cwd));
  const branch = currentBranch(root);
  if (branch !== expectedBranch) refuse('blocked-not-canonical-branch', { branch, expectedBranch });
  assertCleanIndex(root);
  const localSha = git(['rev-parse', '--verify', canonicalIdentity(branch, targetRef)], { cwd: root });
  const headSha = git(['rev-parse', '--verify', 'HEAD'], { cwd: root });
  if (headSha !== localSha) refuse('blocked-head-ref-mismatch', { headSha, localSha });
  const targetSha = git(['rev-parse', '--verify', targetRef], { cwd: root, allowFail: true });
  if (!targetSha) refuse('blocked-target-ref-missing', { targetRef });
  const { relation, reconciliation } = resource(() =>
    canonicalReconciliation(localSha, targetSha, integrationReceiptDigest, root));
  const targetTree = treeEntries(targetSha, root), localTree = treeEntries(localSha, root);
  if ([...localTree.values(), ...targetTree.values()]
    .some((entry) => entry.type !== 'blob')) refuse('blocked-submodule-topology');
  [...localTree.keys(), ...targetTree.keys()].forEach((path) =>
    assertDirectoryAncestors(path, root, { allowMissing: true }));
  const directory = [...targetTree.keys()].find((path) => lstatSync(join(root, path), { throwIfNoEntry: false })?.isDirectory());
  if (directory) refuse('blocked-directory-target-collision', { path: directory });
  const ignored = ignoredPaths(root);
  resource(() => assertIgnoredProjectionSafe(localTree, targetTree, ignored));
  const inventory = snapshotInventory(root, localSha);
  return { root, localSha, targetSha, inventory, relation, reconciliation,
    ignoredPathsDigest: sha256(JSON.stringify(ignored)), ignoredPathCount: ignored.length };
}
export function planCanonicalSync({
  cwd = process.cwd(), targetRef, branch, integrationReceiptDigest = null,
} = {}) {
  canonicalIdentity(branch, targetRef);
  const state = observed(cwd, targetRef, branch, { integrationReceiptDigest });
  const inventoryDigest = sha256(JSON.stringify(state.inventory));
  const plan = {
    schema: PLAN_SCHEMA, repository: state.root, branch, targetRef,
    expectedLocalSha: state.localSha, expectedTargetSha: state.targetSha,
    inventoryDigest, inventory: state.inventory,
    ignoredPathsDigest: state.ignoredPathsDigest, ignoredPathCount: state.ignoredPathCount,
    relation: state.relation, reconciliation: state.reconciliation,
  };
  plan.planDigest = calculatePlanDigest(plan);
  plan.authorization = `agentic-os:canonical-sync:${plan.planDigest}`;
  plan.exclusiveAuthorization = exclusiveAuthorization(plan.planDigest);
  plan.recoveryRef = `refs/agentic-os/recovery/canonical-sync/${plan.planDigest}`;
  resource(() => boundedCanonicalPlan(plan, CANONICAL_SYNC_LIMITS)); return plan;
}
function assertPlan(value) {
  const plan = resource(() => boundedCanonicalPlan(value, CANONICAL_SYNC_LIMITS));
  if (!plan || plan.schema !== PLAN_SCHEMA) refuse('blocked-invalid-plan-schema');
  resource(() => assertCanonicalReconciliationPlan(plan));
  canonicalIdentity(plan.branch, plan.targetRef);
  const inventoryDigest = sha256(JSON.stringify(plan.inventory));
  if (plan.inventoryDigest !== inventoryDigest) refuse('blocked-inventory-digest-mismatch',
    { expected: inventoryDigest, actual: plan.inventoryDigest });
  const digest = calculatePlanDigest(plan);
  if (plan.planDigest !== digest)
    refuse('blocked-plan-digest-mismatch', { expected: digest, actual: plan.planDigest });
  if (plan.authorization !== `agentic-os:canonical-sync:${digest}`)
    refuse('blocked-plan-authorization-mismatch');
  if (plan.exclusiveAuthorization !== exclusiveAuthorization(digest))
    refuse('blocked-plan-exclusive-authorization-mismatch');
  if (plan.recoveryRef !== `refs/agentic-os/recovery/canonical-sync/${digest}`)
    refuse('blocked-plan-recovery-ref-mismatch');
  return plan;
}
function assertUnchanged(plan, cwd, { recoveryCommit = null } = {}) {
  const state = observed(cwd, plan.targetRef, plan.branch, {
    integrationReceiptDigest: plan.reconciliation?.integrationReceiptDigest ?? null,
  });
  const digest = sha256(JSON.stringify(state.inventory));
  const facts = { repository: state.root, localSha: state.localSha, targetSha: state.targetSha,
    inventoryDigest: digest, ignoredPathsDigest: state.ignoredPathsDigest,
    ignoredPathCount: state.ignoredPathCount, relation: state.relation,
    reconciliation: state.reconciliation };
  const expected = { repository: plan.repository, localSha: plan.expectedLocalSha,
    targetSha: plan.expectedTargetSha, inventoryDigest: plan.inventoryDigest,
    ignoredPathsDigest: plan.ignoredPathsDigest, ignoredPathCount: plan.ignoredPathCount,
    relation: plan.relation, reconciliation: plan.reconciliation };
  if (JSON.stringify(facts) !== JSON.stringify(expected))
    refuse('blocked-plan-drift', { expected, actual: facts });
  const symbolicTarget = git(['symbolic-ref', '-q', plan.recoveryRef], { cwd, allowFail: true }); if (symbolicTarget) refuse('blocked-recovery-ref-symbolic', { recoveryRef: plan.recoveryRef, symbolicTarget });
  const existing = git(['rev-parse', '--verify', plan.recoveryRef], { cwd, allowFail: true });
  if (existing && existing !== recoveryCommit)
    refuse('blocked-recovery-ref-exists', { recoveryRef: plan.recoveryRef, existing });
  if (!recoveryCommit && existing)
    refuse('blocked-recovery-ref-exists', { recoveryRef: plan.recoveryRef, existing });
}
function assertRecoveryFidelity(plan, recovery, cwd) {
  const captured = treeEntries(recovery.commit, cwd, { portable: false });
  for (const entry of plan.inventory) {
    const actual = captured.get(entry.path) ?? null;
    if (entry.kind === 'deleted' ? actual !== null :
        !actual || actual.mode !== entry.mode || actual.oid !== entry.oid) {
      refuse('blocked-recovery-fidelity', { path: entry.path, expected: entry, actual });
    }
  }
}
function copyProjection(cwd, projection) { const budget = { bytes: 0 };
  const { entries, manifest } = projection;
  return quarantineWorktreeEntries(
    'agentic-os-canonical-sync-quarantine',
    entries,
    (entry, slot, path) => {
      if (slot === '0') budget.bytes = 0;
      const content = contentAt(slot, path, budget);
      const bytesMatch = entry.sha256 ? sha256(content.bytes) === entry.sha256
        : git(['hash-object', '--stdin'], { cwd, input: content.bytes }) === entry.oid;
      if (content.mode !== entry.mode || !bytesMatch)
        refuse('blocked-quarantine-drift', { path: entry.path, quarantinePath: path });
    },
    cwd,
    manifest,
    { maxEntryBytes: CANONICAL_SYNC_LIMITS.sourceFileBytes,
      maxAggregateBytes: CANONICAL_SYNC_LIMITS.aggregateSourceBytes,
      maxManifestBytes: CANONICAL_SYNC_LIMITS.quarantineManifestBytes },
  );
}
export function applyCanonicalSync(value, { cwd = process.cwd(), authorization = null, exclusive = null } = {}) {
  const plan = assertPlan(value);
  if (authorization !== plan.authorization) refuse('blocked-authorization', { expected: plan.authorization });
  if (exclusive !== plan.exclusiveAuthorization) refuse('blocked-exclusive-authorization', { expected: plan.exclusiveAuthorization });
  const root = realpathSync(repoRoot(cwd));
  if (root !== realpathSync(resolve(plan.repository))) refuse('blocked-repository-mismatch', { expected: plan.repository, actual: root });
  const lock = acquireOperationLock('agentic-os-canonical-sync', root);
  if (!lock) refuse('blocked-exclusive-lock-held');
  const artifacts = createCanonicalArtifacts(plan);
  let recovery = null, quarantine = null, retirement = null, staging = null, canonicalIndex = null, result, operationError = null;
  try {
    assertUnchanged(plan, root);
    const preserved = resource(() => plan.inventory.length > 0
      ? buildDirtyQuarantineProjection(plan, CANONICAL_SYNC_LIMITS)
      : buildCleanRetirementProjection(
        plan, treeEntries(plan.expectedLocalSha, root), CANONICAL_SYNC_LIMITS));
    recovery = captureCanonicalRecovery(plan, root, {
      artifacts, contentAt, digest: sha256,
    });
    assertRecoveryFidelity(plan, recovery, root);
    assertUnchanged(plan, root, { recoveryCommit: recovery.commit });
    quarantine = copyProjection(root, preserved);
    retainCanonicalEffect(artifacts, {
      quarantineCreated: true, quarantinePath: quarantine.path,
      quarantineManifestPath: quarantine.manifestPath,
      quarantineManifestPublished: quarantine.manifestPath !== null,
      quarantineManifestWriteAttempted: quarantine.manifestPath !== null,
      quarantineEntryCount: quarantine.copied.length, copiedBytes: quarantine.copiedBytes,
    });
    quarantine.verify();
    if (git(['rev-parse', '--verify', plan.recoveryRef], { cwd: root }) !== recovery.commit)
      refuse('blocked-recovery-ref-drift');
    const preservation = { recoveryRef: plan.recoveryRef, recoveryCommit: recovery.commit,
      quarantinePath: quarantine.path, quarantineManifestPath: quarantine.manifestPath,
      quarantineManifestDigest: sha256(readFileSync(quarantine.manifestPath)),
      quarantineEntryCount: quarantine.copied.length, copiedBytes: quarantine.copiedBytes,
      copyOnly: true, sourceRetired: false };
    artifacts.quarantineManifestDigest = preservation.quarantineManifestDigest;
    if (plan.inventory.length > 0)
      refuse('blocked-dirty-inventory-copy-only', preservation);
    canonicalIndex = prepareCanonicalIndex(plan.expectedTargetSha, root,
      CANONICAL_SYNC_LIMITS.aggregateTargetBytes);
    assertUnchanged(plan, root, { recoveryCommit: recovery.commit });
    const targetEntries = [...treeEntries(plan.expectedTargetSha, root)].map(
      ([path, entry]) => ({ path, ...entry }));
    resource(() => assertProjectionBudget(targetEntries, CANONICAL_SYNC_LIMITS, 'target'));
    const targetLimits = { maxEntryBytes: CANONICAL_SYNC_LIMITS.targetFileBytes,
      maxAggregateBytes: CANONICAL_SYNC_LIMITS.aggregateTargetBytes,
      maxParentDirectories: CANONICAL_SYNC_LIMITS.targetDirectories };
    staging = stageTreeEntries('agentic-os-canonical-sync-target',
      plan.expectedTargetSha, targetEntries, targetLimits, root);
    Object.assign(artifacts, { stagingPath: staging.path,
      stagedEntryCount: staging.stagedEntryCount, stagedBytes: staging.stagedBytes });
    retirement = retireCleanProjectionUnderExclusiveContract(quarantine, {
      exclusiveContract: exclusive, inventoryCount: plan.inventory.length });
    retainCanonicalEffect(artifacts, { sourceRetired: retirement.sourceRetired,
      retiredEntryCount: retirement.retiredEntryCount });
    const installedTarget = installStagedEntries(staging.path, targetEntries, root, targetLimits, {
      before: (entry) => retainCanonicalEffect(artifacts, {
        targetInstallAttempted: true, targetInstallResultUnknown: true,
        targetInstallFailedPath: entry.path,
      }),
      after: (entry, count) => retainCanonicalEffect(artifacts, {
        targetInstallResultUnknown: false, targetInstallFailedPath: null,
        targetInstalledCount: count, targetInstalledThrough: entry.path,
      }),
      beforeParent: (path) => retainCanonicalEffect(artifacts, {
        targetParentCreationAttempted: true, targetParentCreationResultUnknown: true,
        targetParentAttemptedPath: path, targetParentCreationFailedPath: path,
      }),
      afterParent: (path, count) => retainCanonicalEffect(artifacts, {
        targetParentCreationResultUnknown: false, targetParentAttemptedPath: null,
        targetParentCreationFailedPath: null, targetParentDirectoryCount: count,
        targetParentCreatedThrough: path,
        targetParentDirectoriesCreated: [...artifacts.targetParentDirectoriesCreated, path],
      }),
      parentFailure: (path, _count, _error, created) => Object.assign(artifacts, {
        targetParentCreationResultUnknown: created === true,
        targetParentAttemptedPath: created ? path : null,
        targetParentCreationFailedPath: path,
      }),
    });
    artifacts.targetInstalled = true;
    try { publishCanonicalIndex(canonicalIndex); }
    finally {
      if (canonicalIndex.published) retainCanonicalEffect(artifacts, { indexPublished: true });
    }
    try {
      atomicAdvanceRef(artifacts.canonicalRef, plan.expectedTargetSha, plan.expectedLocalSha,
        [[plan.targetRef, plan.expectedTargetSha], [plan.recoveryRef, recovery.commit]], root);
      retainCanonicalEffect(artifacts, { canonicalRefPublished: true,
        canonicalRefCurrentOid: plan.expectedTargetSha });
    } catch (error) {
      const current = git(['rev-parse', '--verify', artifacts.canonicalRef], {
        cwd: root, allowFail: true });
      Object.assign(artifacts, { canonicalRefCurrentOid: current });
      if (current === plan.expectedTargetSha)
        retainCanonicalEffect(artifacts, { canonicalRefPublished: true });
      throw error;
    }
    const actualHead = git(['rev-parse', 'HEAD'], { cwd: root });
    const actualTarget = git(['rev-parse', '--verify', plan.targetRef], { cwd: root });
    const actualRecovery = git(['rev-parse', '--verify', plan.recoveryRef],
      { cwd: root, allowFail: true });
    const status = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root });
    assertCleanIndex(root);
    const remaining = snapshotInventory(root, plan.expectedTargetSha, { rawTracked: false });
    if (actualHead !== plan.expectedTargetSha || actualTarget !== plan.expectedTargetSha
        || actualRecovery !== recovery.commit || status !== '' || remaining.length > 0) {
      refuse('blocked-postcondition', { expectedHead: plan.expectedTargetSha, actualHead,
        actualTarget, actualRecovery, status, remaining });
    }
    quarantine.verify();
    if (git(['rev-parse', '--verify', plan.recoveryRef], { cwd: root, allowFail: true })
        !== recovery.commit)
      refuse('blocked-recovery-ref-drift');
    installedTarget.verify();
    removeStagedTree(staging);
    artifacts.stagingRemoved = true;
    result = {
      schema: RECEIPT_SCHEMA, planDigest: plan.planDigest, repository: root,
      priorHead: plan.expectedLocalSha, targetHead: plan.expectedTargetSha,
      inventoryDigest: plan.inventoryDigest, inventoryCount: plan.inventory.length,
      ignoredPathsDigest: plan.ignoredPathsDigest, ignoredPathCount: plan.ignoredPathCount,
      recoveryRef: plan.recoveryRef,
      recoveryCommit: recovery.commit,
      recoveryTree: recovery.tree,
      recoveryRefObservedBeforeReceipt: true,
      quarantinedUntracked: plan.inventory.filter((entry) => entry.status === '?').map((entry) => entry.path),
      exclusiveContract: plan.exclusiveAuthorization,
      ...preservation, copyOnly: false, sourceRetired: true,
      cleanSourceRetired: retirement.sourceRetired,
      cleanRetirementSchema: retirement.schema,
      exclusivityBasis: retirement.exclusivityBasis,
      operatingSystemExclusivityProven: retirement.operatingSystemExclusivityProven,
      quarantineRemoved: false, stagingRemoved: true, visibleStatusClean: true,
      ignoredPathsPreservedInPlace: true,
    };
  } catch (error) {
    recordCanonicalFailureEffects(artifacts, error);
    if (canonicalIndex && !canonicalIndex.published) try { abortCanonicalIndex(canonicalIndex); }
    catch (cleanupError) {
      Object.assign(error, { canonicalIndexLockPath: canonicalIndex.lockPath,
        canonicalIndexCleanupError: cleanupError });
      retainCanonicalEffect(artifacts, { canonicalIndexLockCreated: true,
        canonicalIndexLockPath: canonicalIndex.lockPath,
        canonicalIndexCleanupCause: errorCause(cleanupError) });
    }
    if (!recovery || error.reason === 'blocked-dirty-inventory-copy-only') operationError = error;
    else operationError = new CanonicalSyncError('blocked-after-recovery', {
        recoveryRef: plan.recoveryRef, recoveryCommit: recovery.commit,
        quarantinePath: quarantine?.path ?? error.quarantinePath ?? error.detail?.quarantinePath ?? null,
        stagingPath: staging?.path ?? error.stagingPath ?? null,
        collisionPath: error.installPath ?? null,
        cause: error.reason ?? error.message,
      }, error);
  }
  return finishOperationLock(lock, { label: 'canonical-sync', result, error: operationError, artifacts });
}
