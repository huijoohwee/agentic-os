/** Recovery snapshot publication and the exact retained-effect journal for canonical sync. */

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import {
  captureExactTree, privateDirectoryIdentity, removeExactTree,
} from './file-integrity.mjs';
import { commonDir, finishOperationLock, git } from './git.mjs';

export class CanonicalSyncError extends Error {
  constructor(reason, detail = {}, cause = null) {
    super(`${reason}: ${JSON.stringify(detail)}`, cause ? { cause } : undefined);
    Object.assign(this, { name: 'CanonicalSyncError', reason, detail, originalError: cause });
  }
}

export function retainCanonicalEffect(artifacts, detail = {}) {
  Object.assign(artifacts, detail); artifacts.effectsRetained = true;
}

/** Retain the operation journal even when the owned lock is released successfully. */
export function finishCanonicalOperation(lock, { result, error, artifacts }) {
  try { return finishOperationLock(lock, { label: 'canonical-sync', result, error, artifacts }); }
  catch (failure) {
    if (artifacts.effectsRetained && !failure.operationArtifacts) Object.assign(failure, {
      retainedOperation: true, operationResult: result,
      operationError: Object.freeze({ reason: failure.reason ?? null, message: failure.message }),
      operationArtifacts: Object.freeze(Object.fromEntries(Object.entries(artifacts).map(
        ([key, value]) => [key, Array.isArray(value) ? Object.freeze([...value]) : value]))),
    });
    throw failure;
  }
}

const errorCause = (error) => error?.code ?? error?.message ?? null;

/** Project exact partial-effect evidence carried by a failed canonical resource operation. */
export function recordCanonicalFailureEffects(artifacts, error) {
  const observed = (key, fallback) => Object.hasOwn(error, key) ? error[key] : artifacts[key] ?? fallback;
  if (error.installPath) artifacts.targetInstallFailedPath = error.installPath;
  if (error.retiredEntryCount > 0)
    retainCanonicalEffect(artifacts, { retiredEntryCount: error.retiredEntryCount });
  if (error.quarantinePath) retainCanonicalEffect(artifacts, {
    quarantineCreated: true, quarantinePath: error.quarantinePath,
    quarantineManifestPath: observed('quarantineManifestPath', null),
    quarantineManifestPublished: observed('quarantineManifestPublished', false),
    quarantineManifestPublishedPaths: [...observed('quarantineManifestPublishedPaths', [])],
    quarantineManifestFailedPath: observed('quarantineManifestFailedPath', null),
    quarantineManifestWriteAttempted: observed('quarantineManifestWriteAttempted', false),
    quarantineManifestWriteResultUnknown: observed('quarantineManifestWriteResultUnknown', false),
    quarantineEntryCount: observed('quarantineEntryCount', 0),
    copiedBytes: observed('copiedBytes', 0),
    quarantineCopyResultUnknown: observed('quarantineCopyResultUnknown', false),
    quarantineFailedSlot: observed('quarantineFailedSlot', null),
  });
  if (error.stagingPath) retainCanonicalEffect(artifacts, {
    stagingPath: error.stagingPath, stagedEntryCount: error.stagedEntryCount ?? 0,
    stagedBytes: error.stagedBytes ?? 0,
    stagingAttemptedPath: error.stagingAttemptedPath ?? null,
    stagingWriteResultUnknown: error.stagingWriteResultUnknown === true,
    stagingCleanupCause: errorCause(error.stagingCleanupError),
  });
  if (error.indexRoot) retainCanonicalEffect(artifacts, { indexRoot: error.indexRoot,
    indexPath: error.indexPath ?? null, indexCleanupCause: errorCause(error.indexCleanupError) });
  if (error.recoveryTempPath) retainCanonicalEffect(artifacts, {
    recoveryTempPath: error.recoveryTempPath,
    recoveryTempCleanupCause: errorCause(error.recoveryTempCleanupError) });
  if (error.canonicalIndexLockCreated) retainCanonicalEffect(artifacts, {
    canonicalIndexLockCreated: true, canonicalIndexLockPath: error.canonicalIndexLockPath });
  if (error.canonicalIndexTempPath) retainCanonicalEffect(artifacts, {
    canonicalIndexTempPath: error.canonicalIndexTempPath,
    canonicalIndexCleanupCause: errorCause(error.canonicalIndexTempCleanupError) });
}

export function createCanonicalArtifacts(plan) {
  return {
    effectsRetained: false, targetHead: plan.expectedTargetSha,
    canonicalRef: `refs/heads/${plan.branch}`, canonicalRefPublished: false,
    canonicalRefCurrentOid: plan.expectedLocalSha,
    recoveryRef: plan.recoveryRef, recoveryObjectWriteAttempted: false,
    recoveryObjectWriteResultUnknown: false, recoveryObjectsWritten: false,
    recoveryObjectOids: [], recoveryTree: null, recoveryCommit: null,
    recoveryTreeWriteAttempted: false, recoveryTreeWriteResultUnknown: false,
    recoveryTreeWritten: false, recoveryCommitWriteAttempted: false,
    recoveryCommitWriteResultUnknown: false, recoveryCommitWritten: false,
    recoveryCandidateTree: null, recoveryCandidateCommit: null,
    recoveryRefPublished: false, recoveryRefCurrentOid: null,
    recoveryRefSymbolicTarget: null,
    quarantineCreated: false, quarantinePath: null, quarantineManifestPath: null,
    quarantineManifestDigest: null, quarantineManifestPublished: false,
    quarantineManifestPublishedPaths: [], quarantineManifestFailedPath: null,
    quarantineManifestWriteAttempted: false, quarantineManifestWriteResultUnknown: false,
    quarantineEntryCount: 0,
    copiedBytes: 0, quarantineCopyResultUnknown: false, quarantineFailedSlot: null,
    sourceRetired: false, retiredEntryCount: 0,
    stagingPath: null, stagedEntryCount: 0, stagedBytes: 0,
    stagingWriteResultUnknown: false, stagingAttemptedPath: null, stagingRemoved: false,
    targetInstallAttempted: false, targetInstallResultUnknown: false,
    targetInstallFailedPath: null, targetInstalled: false,
    targetInstalledCount: 0, targetInstalledThrough: null,
    targetParentCreationAttempted: false, targetParentCreationResultUnknown: false,
    targetParentAttemptedPath: null, targetParentCreationFailedPath: null,
    targetParentDirectoriesCreated: [], targetParentDirectoryCount: 0,
    targetParentCreatedThrough: null,
    indexPublished: false, stagingCleanupCause: null, indexRoot: null,
    indexPath: null, indexCleanupCause: null, recoveryTempPath: null,
    recoveryTempCleanupCause: null, canonicalIndexLockCreated: false,
    canonicalIndexLockPath: null,
    canonicalIndexCleanupCause: null, canonicalIndexTempPath: null,
  };
}

/** Capture exact dirty bytes, then publish one direct recovery ref. */
export function captureCanonicalRecovery(plan, cwd, {
  artifacts, contentAt, digest,
}) {
  let temp = null, tempIdentity = null, index = null, env = null;
  let commit, tree, tempManifest = null, primaryError = null;
  const budget = { bytes: 0 };
  try {
    temp = mkdtempSync(join(commonDir(cwd), 'agentic-os-canonical-sync-'));
    tempIdentity = privateDirectoryIdentity(temp, 'canonical recovery temporary directory');
    if (!tempIdentity) throw new Error('canonical recovery temporary identity was not established');
    index = join(temp, 'index'); env = { GIT_INDEX_FILE: index };
    git(['read-tree', plan.expectedLocalSha], { cwd, env });
    for (const entry of plan.inventory) {
      if (entry.kind === 'deleted') {
        git(['update-index', '--force-remove', '--', entry.path], { cwd, env }); continue;
      }
      const content = contentAt(entry.path, cwd, budget);
      retainCanonicalEffect(artifacts, { recoveryObjectWriteAttempted: true,
        recoveryObjectWriteResultUnknown: true });
      const oid = git(['hash-object', '-w', '--stdin'], { cwd, env, input: content.bytes });
      artifacts.recoveryObjectOids.push(oid);
      retainCanonicalEffect(artifacts, { recoveryObjectWriteResultUnknown: false,
        recoveryObjectsWritten: true });
      if (oid !== entry.oid || content.mode !== entry.mode || digest(content.bytes) !== entry.sha256)
        throw new CanonicalSyncError('blocked-capture-drift', { path: entry.path });
      git(['update-index', '--add', '--cacheinfo', `${entry.mode},${oid},${entry.path}`], { cwd, env });
    }
    retainCanonicalEffect(artifacts, { recoveryTreeWriteAttempted: true,
      recoveryTreeWriteResultUnknown: true });
    tree = git(['write-tree'], { cwd, env });
    retainCanonicalEffect(artifacts, { recoveryTree: tree, recoveryCandidateTree: tree,
      recoveryTreeWriteResultUnknown: false, recoveryTreeWritten: true });
    tempManifest = captureExactTree(tempIdentity, [index],
      'canonical recovery temporary directory');
    const message = `agentic-os canonical recovery\n\nPlan-Digest: ${plan.planDigest}\n`;
    const identity = { GIT_AUTHOR_NAME: 'agentic-os recovery',
      GIT_AUTHOR_EMAIL: 'recovery@agentic-os.invalid', GIT_COMMITTER_NAME: 'agentic-os recovery',
      GIT_COMMITTER_EMAIL: 'recovery@agentic-os.invalid' };
    retainCanonicalEffect(artifacts, { recoveryCommitWriteAttempted: true,
      recoveryCommitWriteResultUnknown: true });
    commit = git(['commit-tree', tree, '-p', plan.expectedLocalSha], {
      cwd, input: message, env: identity });
    retainCanonicalEffect(artifacts, {
      recoveryCommit: commit, recoveryCandidateCommit: commit,
      recoveryCommitWriteResultUnknown: false, recoveryCommitWritten: true,
    });
  } catch (error) { primaryError = error; }
  let cleanupError = null;
  if (temp) try {
    if (!tempIdentity || !tempManifest)
      throw new Error('canonical recovery temporary manifest was not established');
    removeExactTree(tempIdentity, tempManifest, 'canonical recovery temporary directory');
  } catch (error) { cleanupError = error; }
  if (primaryError || cleanupError) {
    const error = primaryError ?? Object.assign(
      new Error('canonical recovery temporary cleanup failed', { cause: cleanupError }),
      { reason: 'blocked-recovery-temp-cleanup' });
    if (cleanupError) {
      retainCanonicalEffect(artifacts, { recoveryTempPath: temp,
        recoveryTempCleanupCause: cleanupError.code ?? cleanupError.message });
      Object.assign(error, { recoveryTempPath: temp,
        recoveryTempCleanupError: cleanupError, recoveryCommit: commit ?? null,
        recoveryTree: tree ?? null });
    }
    throw error;
  }
  const symbolicTarget = git(['symbolic-ref', '-q', plan.recoveryRef], {
    cwd, allowFail: true });
  if (symbolicTarget) {
    artifacts.recoveryRefSymbolicTarget = symbolicTarget;
    throw new CanonicalSyncError('blocked-recovery-ref-symbolic', {
    recoveryRef: plan.recoveryRef, candidateCommit: commit, candidateTree: tree,
    currentRecoveryOid: null, symbolicTarget });
  }
  try {
    git(['update-ref', '--no-deref', plan.recoveryRef, commit, '0'.repeat(commit.length)], { cwd });
    retainCanonicalEffect(artifacts, { recoveryRefPublished: true,
      recoveryRefCurrentOid: commit });
  } catch (error) {
    const symbolicTarget = git(['symbolic-ref', '-q', plan.recoveryRef], {
      cwd, allowFail: true });
    const currentRecoveryOid = git(['rev-parse', '--verify', plan.recoveryRef], {
      cwd, allowFail: true });
    Object.assign(artifacts, { recoveryRefCurrentOid: currentRecoveryOid,
      recoveryRefSymbolicTarget: symbolicTarget });
    if (!symbolicTarget && currentRecoveryOid === commit)
      retainCanonicalEffect(artifacts, { recoveryRefPublished: true });
    throw new CanonicalSyncError('blocked-recovery-ref-cas', {
      recoveryRef: plan.recoveryRef, candidateCommit: commit, candidateTree: tree,
      currentRecoveryOid, symbolicTarget, cause: error.message }, error);
  }
  return { commit, tree };
}
