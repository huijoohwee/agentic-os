/**
 * Rendering. Takes data, returns strings. No I/O, no git, no provider calls, so
 * every output shape is testable without a repository.
 */

import { createHash } from 'node:crypto';

export const MARK = Object.freeze({ ok: 'ok  ', fail: 'FAIL', warn: 'warn' });
const RETAINED_RECEIPT_LIMIT = 480 * 1024;
const RETAINED_HANDOFF_LIMIT = 64 * 1024;
const PROJECTION_STRING_BYTES = 2_048;
const PROJECTION_ARRAY_BYTES = 16 * 1024;
const PROJECTION_ARRAY_ITEMS = 8;
const RESULT_KEYS = Object.freeze([
  'schema', 'planDigest', 'repository', 'priorHead', 'targetHead', 'inventoryDigest',
  'inventoryCount', 'ignoredPathsDigest', 'ignoredPathCount', 'recoveryRef', 'recoveryCommit',
  'recoveryTree', 'recoveryRefObservedBeforeReceipt', 'exclusiveContract', 'quarantinePath',
  'quarantineManifestPath', 'quarantineManifestDigest', 'quarantineEntryCount',
  'quarantineRemoved', 'stagingRemoved', 'visibleStatusClean', 'ignoredPathsPreservedInPlace',
]);
const ARTIFACT_KEYS = Object.freeze([
  'effectsRetained', 'operation', 'remote', 'url', 'urlDigest', 'ref', 'remoteRef', 'worktree',
  'baseSha', 'protectedRef', 'fetchedProtectedSha', 'fetchAttempted', 'fetchCompleted',
  'fetchHeadWritten', 'autoMaintenanceRun', 'writeResultUnknown',
  'objectWriteResultUnknown', 'reobservationExact', 'refsBefore', 'refsAfter',
  'refChanges', 'publicationAttempted', 'pushCompleted', 'priorOid',
  'remoteRefCurrentOid', 'provisioned', 'worktreeAddReturned', 'provisionCompleted',
  'fetchReceipt', 'publicationReceipt', 'provisionReceipt',
  'createdParentPaths', 'createdParents', 'branchSha', 'branchObservationExact',
  'registeredWorktree', 'registrationObservationExact', 'pathExists', 'pathIdentity',
  'pathObservationExact', 'postconditionHead', 'postconditionBranch',
  'runtimeId', 'runtimePath',
  'hooksPath', 'runtimeInstalled', 'runtimeResidue', 'configRetained', 'cacheRef',
  'configWriteAttempted', 'configWriteResultUnknown', 'configObservedState',
  'configObservedCount', 'configObservedDigest',
  'runtimeAncestorResidue', 'runtimeAncestorPaths', 'trustPath', 'trustCreated',
  'trustWriteAttempted', 'trustWriteResultUnknown', 'trustWriteObservedPathExists',
  'trustWriteObservedKind', 'trustWriteObservedSize', 'statePath',
  'stateDirectoryCreated', 'stateDirectoryTightenAttempted',
  'stateDirectoryTightenResultUnknown', 'stateDirectoryTightened',
  'candidateOid', 'candidateObjectWritten', 'refPublished', 'legacyCachePath',
  'targetHead', 'canonicalRef', 'canonicalRefPublished', 'canonicalRefCurrentOid',
  'recoveryRef', 'recoveryObjectWriteAttempted', 'recoveryObjectWriteResultUnknown',
  'recoveryObjectsWritten', 'recoveryObjectOids', 'recoveryTree', 'recoveryCommit',
  'recoveryTreeWriteAttempted', 'recoveryTreeWriteResultUnknown', 'recoveryTreeWritten',
  'recoveryCommitWriteAttempted', 'recoveryCommitWriteResultUnknown',
  'recoveryCommitWritten', 'recoveryCandidateTree', 'recoveryCandidateCommit',
  'recoveryRefPublished', 'recoveryRefCurrentOid', 'recoveryRefSymbolicTarget',
  'quarantineCreated', 'quarantinePath', 'quarantineManifestPath',
  'quarantineManifestDigest', 'quarantineManifestPublished',
  'quarantineManifestPublishedPaths', 'quarantineManifestFailedPath',
  'quarantineManifestWriteAttempted', 'quarantineManifestWriteResultUnknown',
  'quarantineEntryCount', 'copiedBytes', 'quarantineCopyResultUnknown',
  'quarantineFailedSlot', 'sourceRetired', 'retiredEntryCount', 'stagingPath',
  'stagedEntryCount', 'stagedBytes', 'stagingWriteResultUnknown', 'stagingAttemptedPath',
  'stagingRemoved', 'targetInstallAttempted', 'targetInstallResultUnknown',
  'targetInstallFailedPath', 'targetInstalled', 'targetInstalledCount',
  'targetInstalledThrough', 'targetParentCreationAttempted',
  'targetParentCreationResultUnknown', 'targetParentAttemptedPath',
  'targetParentCreationFailedPath', 'targetParentDirectoriesCreated',
  'targetParentDirectoryCount', 'targetParentCreatedThrough',
  'indexPublished', 'stagingCleanupCause', 'indexRoot',
  'indexPath', 'indexCleanupCause', 'recoveryTempPath', 'recoveryTempCleanupCause',
  'canonicalIndexLockCreated', 'canonicalIndexLockPath', 'canonicalIndexCleanupCause',
  'canonicalIndexTempPath',
]);

function selected(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

function canonicalJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
  };
  return JSON.stringify(normalize(value));
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function truncateUtf8(value, limit) {
  if (Buffer.byteLength(value) <= limit) return value;
  let low = 0, high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low).replace(/[\uD800-\uDBFF]$/u, '');
}

function projectedObject(value, state, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  if (depth >= 6) {
    state.truncated = true;
    return { boundedProjection: true, digest: digest(value), digestAlgorithm: 'sha256-canonical-json' };
  }
  const projected = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && Buffer.byteLength(entry) > PROJECTION_STRING_BYTES) {
      state.truncated = true;
      projected[`${key}Count`] = Buffer.byteLength(entry);
      projected[`${key}Digest`] = digest(entry);
      projected[`${key}DigestAlgorithm`] = 'sha256-canonical-json';
      projected[`${key}Projection`] = truncateUtf8(entry, PROJECTION_STRING_BYTES);
      projected[`${key}ProjectionTruncated`] = true;
    } else if (Array.isArray(entry)) {
      const exact = canonicalJson(entry);
      if (entry.length <= PROJECTION_ARRAY_ITEMS
          && Buffer.byteLength(exact) <= PROJECTION_ARRAY_BYTES) {
        projected[key] = entry.map((item) => projectedValue(item, state, depth + 1));
      } else {
        state.truncated = true;
        projected[`${key}Count`] = entry.length;
        projected[`${key}Digest`] = createHash('sha256').update(exact).digest('hex');
        projected[`${key}DigestAlgorithm`] = 'sha256-canonical-json';
        projected[`${key}Projection`] = entry.slice(0, PROJECTION_ARRAY_ITEMS)
          .map((item) => projectedValue(item, state, depth + 1));
        projected[`${key}ProjectionTruncated`] = true;
      }
    } else projected[key] = projectedValue(entry, state, depth + 1);
  }
  return projected;
}

function projectedValue(value, state, depth = 0) {
  if (typeof value === 'string' && Buffer.byteLength(value) > PROJECTION_STRING_BYTES) {
    state.truncated = true;
    return { boundedProjection: true, byteCount: Buffer.byteLength(value),
      digest: digest(value), digestAlgorithm: 'sha256-canonical-json',
      projection: truncateUtf8(value, PROJECTION_STRING_BYTES), projectionTruncated: true };
  }
  if (value && typeof value === 'object' && !Array.isArray(value))
    return projectedObject(value, state, depth);
  return value ?? null;
}

function boundedProjection(value, keys = null) {
  const state = { truncated: false };
  const source = keys ? selected(value, keys) : value;
  const projection = projectedObject(source, state);
  return { projection, truncated: state.truncated };
}

/** Exact effect receipt when bounded; otherwise an explicitly digested projection. */
export function formatEffectReceipt(operation, receipt) {
  if (typeof operation !== 'string' || operation.length === 0
      || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const exact = JSON.stringify(receipt);
  if (Buffer.byteLength(exact) <= RETAINED_RECEIPT_LIMIT) return exact;
  const { projection, truncated } = boundedProjection(receipt);
  const output = JSON.stringify({
    schema: 'agentic-os/effect-receipt-projection/v1', operation,
    receiptSchema: typeof receipt.schema === 'string' ? receipt.schema : null,
    receiptDigest: digest(receipt), receiptDigestAlgorithm: 'sha256-canonical-json',
    boundedProjection: true, projectionTruncated: truncated, receiptProjection: projection,
  });
  if (Buffer.byteLength(output) > RETAINED_RECEIPT_LIMIT)
    throw new RangeError('bounded effect receipt projection exceeds its output limit');
  return output;
}

/** Bounded machine-readable evidence for effects retained behind a failed operation lock. */
export function formatRetainedOperation(error) {
  if (error?.name !== 'OperationLockError' && error?.retainedOperation !== true) return null;
  const operationError = error.operationError ? {
    reason: error.operationError.reason ?? null,
    message: String(error.operationError.message ?? '').slice(0, 2_048),
  } : null;
  const operationCompleted = error.operationError == null;
  const artifacts = error.operationArtifacts;
  const effectsRetained = artifacts?.effectsRetained === true;
  const envelope = {
    schema: 'agentic-os/retained-operation/v1', reason: error.reason ?? null,
    operationCompleted, effectsRetained, result: error.operationResult ?? null,
    artifacts: artifacts ?? null, operationError,
  };
  try {
    const exact = JSON.stringify(envelope);
    if (Buffer.byteLength(exact) <= RETAINED_RECEIPT_LIMIT) return exact;
  } catch { /* project the controlled receipt fields below */ }
  const resultProjection = boundedProjection(error.operationResult, RESULT_KEYS);
  const artifactProjection = boundedProjection(error.operationArtifacts, ARTIFACT_KEYS);
  const output = JSON.stringify({ ...envelope, boundedProjection: true,
    projectionTruncated: true, result: resultProjection.projection,
    artifacts: artifactProjection.projection });
  if (Buffer.byteLength(output) > RETAINED_RECEIPT_LIMIT)
    throw new RangeError('bounded retained operation projection exceeds its output limit');
  return output;
}

/** Bounded lane evidence retained whenever its best-effort cache projection fails. */
export function formatLaneProjectionRetained(record, error) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const state = { truncated: false };
  let handoffDigest = null;
  if (record.handoff && typeof record.handoff === 'object') try {
    handoffDigest = createHash('sha256').update(JSON.stringify(record.handoff)).digest('hex');
  } catch { state.truncated = true; }
  const text = (value, max = 1_024) => {
    if (typeof value !== 'string') return null;
    if (value.length <= max) return value;
    state.truncated = true;
    return value.slice(0, max);
  };
  const bool = (value) => typeof value === 'boolean' ? value : null;
  const integer = (value) => Number.isSafeInteger(value) ? value : null;
  const handoff = record.handoff && typeof record.handoff === 'object' ? record.handoff : null;
  const review = handoff?.pr;
  const queueEntry = handoff?.queueEntry;
  const handoffProjection = handoff ? {
    receiptSchema: text(handoff.schema, 128), provider: text(handoff.provider, 128),
    ok: bool(handoff.ok), reason: text(handoff.reason, 256),
    ref: text(handoff.ref, 512), headSha: text(handoff.headSha, 128),
    sourceHeadBound: bool(handoff.sourceHeadBound),
    reviewMutationAttempted: bool(handoff.reviewMutationAttempted),
    reviewWriteResultUnknown: bool(handoff.reviewWriteResultUnknown),
    reviewReobservedAfterMutation: bool(handoff.reviewReobservedAfterMutation),
    reviewReobservationExact: bool(handoff.reviewReobservationExact),
    reviewRequiresAttention: bool(handoff.reviewRequiresAttention),
    orderingArmed: bool(handoff.orderingArmed),
    testedProtectedOrdering: bool(handoff.testedProtectedOrdering),
    queueEntry: queueEntry && typeof queueEntry === 'object' ? {
      id: text(queueEntry.id, 1_024), position: integer(queueEntry.position),
      state: text(queueEntry.state, 128),
    } : null,
    pr: review && typeof review === 'object' ? {
      number: integer(review.number), state: text(review.state, 64), url: text(review.url, 2_048),
      mergeStateStatus: text(review.mergeStateStatus, 64),
      headRefOid: text(review.headRefOid, 128), headRefName: text(review.headRefName, 512),
      baseRefName: text(review.baseRefName, 512),
      isCrossRepository: bool(review.isCrossRepository),
    } : null,
  } : null;
  const envelope = {
    schema: 'agentic-os/lane-projection-retained/v1',
    boundedProjection: true, truncated: state.truncated,
    laneProjection: {
      ref: text(record.ref, 512), state: text(record.state, 64), head: text(record.head, 128),
      baseSha: text(record.baseSha, 128), worktree: text(record.worktree, 4_096),
      pr: integer(record.pr), mode: text(record.mode, 128), device: text(record.device, 128),
      scope: text(record.scope, 256), base: text(record.base, 512),
      createdAt: text(record.createdAt, 128),
    },
    handoffDigest, handoffDigestAlgorithm: 'sha256-json', handoffProjection,
    cacheError: {
      reason: text(error?.reason, 256), message: text(String(error?.message ?? ''), 2_048),
      cacheRef: text(error?.cacheRef ?? error?.operationArtifacts?.cacheRef, 512),
      candidateOid: text(error?.candidateOid ?? error?.operationArtifacts?.candidateOid, 128),
    },
  };
  envelope.truncated = state.truncated;
  const output = JSON.stringify(envelope);
  if (Buffer.byteLength(output) <= RETAINED_HANDOFF_LIMIT) return output;
  return JSON.stringify({
    schema: envelope.schema, boundedProjection: true, truncated: true,
    laneProjection: envelope.laneProjection,
    handoffDigest, handoffDigestAlgorithm: envelope.handoffDigestAlgorithm,
    handoffProjection: handoffProjection ? {
      receiptSchema: handoffProjection.receiptSchema, provider: handoffProjection.provider,
      ok: handoffProjection.ok, reason: handoffProjection.reason,
      ref: handoffProjection.ref, headSha: handoffProjection.headSha,
      sourceHeadBound: handoffProjection.sourceHeadBound,
      reviewRequiresAttention: handoffProjection.reviewRequiresAttention,
      testedProtectedOrdering: handoffProjection.testedProtectedOrdering,
      queueEntry: handoffProjection.queueEntry,
      pr: handoffProjection.pr ? { number: handoffProjection.pr.number,
        state: handoffProjection.pr.state, headRefOid: handoffProjection.pr.headRefOid } : null,
    } : null,
    cacheError: envelope.cacheError,
  });
}

export const formatProviderHandoffRetained = formatLaneProjectionRetained;

function pad(value, width) {
  return String(value).padEnd(width);
}

export function formatFindings(title, findings) {
  const lines = [`${title}:`];
  for (const finding of findings) {
    const mark = finding.ok ? MARK.ok : MARK.fail;
    lines.push(`  ${mark} ${pad(finding.id, 18)} ${finding.detail}`);
    if (!finding.ok && finding.remedy) lines.push(`       remedy: ${finding.remedy}`);
  }
  return lines.join('\n');
}

export function formatDoctorConclusion(failures, cleanlinessDeferred = false) {
  if (!Number.isSafeInteger(failures) || failures < 0)
    throw new TypeError('doctor conclusion requires a non-negative finding count');
  if (failures > 0) return `${failures} finding(s) need attention. Nothing was changed.`;
  return cleanlinessDeferred
    ? 'shallow harness invariants hold; tracked content identity was not evaluated.'
    : 'harness invariants hold.';
}

export function formatConfig(entries) {
  const lines = ['local git configuration:'];
  for (const entry of entries) {
    const mark = entry.ok ? MARK.ok : MARK.fail;
    const actual = entry.actual === null ? 'unset' : entry.actual;
    lines.push(`  ${mark} ${pad(entry.key, 22)} ${pad(actual, 10)} want ${entry.value}`);
    if (!entry.ok) lines.push(`       ${entry.why}`);
  }
  return lines.join('\n');
}

export function formatLocal(local) {
  const lines = ['local repository:'];
  const branch = local.protectedBranch;
  const protectedRef = local.protectedRef;
  if (typeof branch !== 'string' || branch.length === 0
    || typeof protectedRef !== 'string' || !protectedRef.startsWith('refs/remotes/')) {
    throw new TypeError('local report requires explicit canonical branch and remote-tracking ref');
  }
  const target = protectedRef.slice('refs/remotes/'.length);
  const push = (ok, id, detail, remedy) => {
    lines.push(`  ${ok ? MARK.ok : MARK.fail} ${pad(id, 18)} ${detail}`);
    if (!ok && remedy) lines.push(`       remedy: ${remedy}`);
  };
  if (local.canonicalDirty) push(false, 'canonical-clean',
    `canonical ${branch} has shallow tracked/index structural or hidden-flag risk (${local.trackedRiskPaths.length} tracked, ${local.hiddenPaths.length} hidden)`,
    'preserve the bytes in place; use agentic-os observe --deep for an exact byte audit');
  else if (local.canonicalCleanlinessDeferred) lines.push(
    `  ${MARK.warn} ${pad('canonical-clean', 18)} canonical ${branch} has no shallow risk; tracked content identity is deferred`,
    '       remedy: use agentic-os observe --deep when exact byte cleanliness is required',
  );
  else push(true, 'canonical-clean', `canonical ${branch} is exact-byte clean`);
  lines.push(`  ${MARK.warn} ${pad('owned-paths', 18)} ${local.ownedPathCount ?? local.ownedPaths.length} visible untracked path(s); deep audit includes ignored paths`);
  const relationDetail = local.relation === 'equal'
    ? `canonical ${branch} equals cached ${target}`
    : local.relation === 'behind'
      ? `canonical ${branch} is ${local.behind} behind cached ${target}`
      : local.relation === 'ahead'
        ? `canonical ${branch} is ${local.ahead} ahead of cached ${target}`
        : local.relation === 'diverged'
          ? `canonical ${branch} diverged from cached ${target} (${local.ahead} ahead, ${local.behind} behind)`
          : `canonical ${branch} relation to cached ${target} is unknown`;
  push(
    local.relation === 'equal',
    'canonical-current',
    relationDetail,
    'run the recovery-backed canonical flow: npm run sync:canonical',
  );
  push(
    local.staleWorktrees.length === 0,
    'worktrees',
    local.staleWorktrees.length === 0
      ? `${local.worktreeCount} registered worktree(s), none stale`
      : `${local.staleWorktrees.length} registration(s) point at missing directories`,
    'require authenticated retirement and target-specific cleanup eligibility before unregistering',
  );
  lines.push(
    `  ${MARK.warn} ${pad('retained-refs', 18)} ${local.laneBranches}${local.laneBranchesTruncated ? '+' : ''} local lane ref(s); retention does not imply active authority`,
  );
  return lines.join('\n');
}

export function formatStatus({ device, lanes, queue }) {
  const lines = [`device ${device}`, ''];
  if (lanes.length === 0) {
    lines.push('no lanes. open one with: npm run lane -- <scope>');
  } else {
    lines.push(`${pad('LANE', 44)} ${pad('CACHED_STATE', 13)} ${pad('AHEAD', 6)} CACHED_NEXT`);
    for (const lane of lanes) {
      lines.push(
        `${pad(lane.ref, 44)} ${pad(lane.state, 13)} ${pad(lane.commits, 6)} ${lane.next.join(', ')}`,
      );
      if (lane.stale) {
        lines.push(`  stale registration preserved; worktree directory is missing: ${lane.path}`);
      }
      if (lane.untracked > 0) {
        lines.push(`  ${lane.untracked} owned untracked path(s); they stay in place`);
      }
    }
  }
  lines.push('');
  if (queue) {
    if (!queue.available) {
      const reason = queue.reason === 'unsupported' ? 'unsupported' : 'unavailable';
      lines.push(`provider observation UNKNOWN/${reason}`);
      lines.push(`merge queue UNKNOWN; provider adapter observation is ${reason}`);
      lines.push('run npm run doctor after restoring provider access');
      return lines.join('\n');
    }
    const count = Array.isArray(queue.openPrs)
      ? `${queue.openPrsTruncated ? 'at least ' : ''}${queue.openPrs.length}` : 'unknown';
    const errors = (queue.blockingObservationErrors ?? queue.observationErrors ?? []).map((value) => String(value)
      .replace(/[^a-z0-9._-]/giu, '?').slice(0, 64));
    if (errors.length > 0) {
      const labels = errors.slice(0, 5).join(', ');
      const omitted = errors.length > 5 ? `, +${errors.length - 5} more` : '';
      lines.push(`provider observation UNKNOWN/incomplete (${labels}${omitted})`);
      lines.push(`merge queue UNKNOWN; ${count} open pull request(s) in the bounded observation`);
      lines.push('run npm run doctor after restoring complete provider observation');
    } else {
      const state = queue.queueEnabled ? 'enabled' : 'NOT ENABLED';
      lines.push(`merge queue ${state}; ${count} open pull request(s) in the bounded observation`);
      if (!queue.queueEnabled) lines.push('run npm run doctor for the exact drift');
    }
  }
  return lines.join('\n');
}

export function formatSurvey(survey) {
  const lines = [];
  if (survey.integrated.length === 0) {
    lines.push('no lane has an exact integration projection.');
  } else {
    lines.push('proven integrated (cleanup remains separately governed):');
    for (const lane of survey.integrated) {
      lines.push(`  ${pad(lane.branch, 44)} ${lane.proof}`);
      lines.push(`       ${lane.detail}`);
    }
  }
  if (survey.open.length > 0) {
    lines.push('');
    lines.push('not-integrated lane projections:');
    for (const lane of survey.open) {
      const note =
        lane.alreadyUpstream > 0
          ? `${lane.pending} pending, ${lane.alreadyUpstream} already upstream by patch identity`
          : `${lane.pending} pending`;
      lines.push(`  ${pad(lane.branch, 44)} ${note}`);
    }
  }
  if (survey.blocked?.length) {
    lines.push('');
    lines.push('blocked:');
    for (const lane of survey.blocked) {
      lines.push(`  ${pad(lane.branch, 44)} ${lane.reason}`);
      for (const path of lane.paths ?? []) lines.push(`       ${path}`);
    }
  }
  return lines.join('\n');
}

export function formatRefusal(result, advice) {
  const lines = [`refused: ${result.reason}`];
  if (result.guard) lines.push(`guard: ${result.guard} (${result.from} --${result.event}-->)`);
  if (advice) lines.push(advice);
  return lines.join('\n');
}

export function formatPlan(plan) {
  return ['capability projection for repository-authority review:', '', JSON.stringify(plan, null, 2)].join(
    '\n',
  );
}
