/** Bounded tree projections and recovery-manifest serialization for canonical sync. */

import { snapshotBoundedJson } from './catalog-input.mjs';
import { createHash } from 'node:crypto';
import {
  currentBranch, decodeNulFields, headSha, isAncestor, observeGit, worktreePreservationEntries,
} from './git.mjs';
import { integrationProof } from './patch-identity.mjs';

export class CanonicalResourceError extends Error {
  constructor(code, detail = {}) {
    super(code);
    Object.assign(this, { name: 'CanonicalResourceError', code, detail });
  }
}

function reject(code, detail) { throw new CanonicalResourceError(code, detail); }
function reconcileReject(code, detail = {}) {
  const reason = `blocked-${code}`;
  throw Object.assign(new Error(reason), { reason, detail });
}

const PLAN_KEYS = Object.freeze('authorization branch exclusiveAuthorization expectedLocalSha expectedTargetSha ignoredPathCount ignoredPathsDigest inventory inventoryDigest planDigest reconciliation recoveryRef relation repository schema targetRef'.split(' '));
const SHA256 = /^[0-9a-f]{64}$/u;
const RELATIONS = new Set(['equal', 'behind-fast-forwardable', 'squash-integrated-divergence']);
const SEMANTIC_SCOPE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u;
export const RECONCILIATION_STATUS_SCHEMA = 'agentic-os-reconciliation-status/v1';

const byteCompare = (left, right) => Buffer.from(left).compare(Buffer.from(right));
function repositoryPath(value) {
  const path = String(value ?? ''), components = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\')
      || components.some((part) => !part || part === '.' || part === '..'))
    reconcileReject('invalid-claim-path', { path });
  return path;
}
export function canonicalClaimScope(scope, paths) {
  if (!SEMANTIC_SCOPE.test(scope ?? '')) reconcileReject('invalid-semantic-scope', { scope });
  if (!Array.isArray(paths)) reconcileReject('invalid-claim-paths');
  const normalized = [...new Set(paths.map(repositoryPath))].sort(byteCompare);
  if (normalized.length === 0) reconcileReject('empty-claim-paths');
  return Object.freeze([...normalized.map((path) => `path:${path}`),
    `semantic:${scope}`].sort(byteCompare));
}
function changedPaths(cwd, localSha, targetSha) {
  const base = observeGit(['merge-base', localSha, targetSha], { cwd, allowFail: true });
  if (!base) return [];
  const raw = observeGit(['diff', '--name-only', '-z', '--no-renames', base, localSha],
    { cwd, binary: true, allowFail: true });
  return [...new Set(decodeNulFields(raw))].sort(byteCompare);
}
export function canonicalReconciliation(localSha, targetSha, receiptDigest, cwd) {
  if (isAncestor(localSha, targetSha, cwd)) return {
    relation: localSha === targetSha ? 'equal' : 'behind-fast-forwardable', reconciliation: null,
  };
  if (!SHA256.test(receiptDigest ?? '')) reject('non-fast-forward', { localSha, targetSha,
    remedy: 'run agentic-os reconcile plan with an exact integration receipt' });
  const proof = integrationProof(targetSha, localSha, { cwd });
  if (proof?.kind !== 'exact-tree-projection') reject('non-fast-forward', { localSha, targetSha,
    remedy: 'local commits are not exactly represented by the protected target' });
  return { relation: 'squash-integrated-divergence', reconciliation: Object.freeze({
    schema: 'agentic-os-canonical-reconciliation/v1', integrationReceiptDigest: receiptDigest,
    proof: Object.freeze({ kind: proof.kind, baseHead: proof.baseHead,
      head: proof.head, pathCount: proof.pathCount }),
  }) };
}
export function assertCanonicalReconciliationPlan(plan) {
  if (!RELATIONS.has(plan.relation)) reject('invalid-plan-relation');
  const proof = plan.reconciliation?.proof;
  if (plan.relation === 'squash-integrated-divergence'
    ? plan.reconciliation?.schema !== 'agentic-os-canonical-reconciliation/v1'
      || !SHA256.test(plan.reconciliation?.integrationReceiptDigest ?? '')
      || proof?.kind !== 'exact-tree-projection'
      || proof.baseHead !== plan.expectedTargetSha || proof.head !== plan.expectedLocalSha
      || !Number.isSafeInteger(proof.pathCount) || proof.pathCount < 1
    : plan.reconciliation !== null) reject('invalid-reconciliation-proof');
}
export function classifyCanonicalReconciliation({ cwd = process.cwd(), branch, targetRef, scope = null } = {}) {
  const observedBranch = currentBranch(cwd);
  if (observedBranch !== branch) reconcileReject('not-canonical-branch', { observedBranch, branch });
  const localSha = headSha(`refs/heads/${branch}`, cwd), targetSha = headSha(targetRef, cwd);
  if (!localSha || !targetSha) reconcileReject('canonical-ref-missing', { localSha, targetSha });
  let status, proof = null;
  if (localSha === targetSha) status = 'synced';
  else if (isAncestor(localSha, targetSha, cwd)) status = 'behind-fast-forwardable';
  else if (isAncestor(targetSha, localSha, cwd)) status = 'ahead-needs-pr';
  else {
    proof = integrationProof(targetSha, localSha, { cwd });
    status = proof?.kind === 'exact-tree-projection' ? 'squash-integrated-divergence' : 'true-conflict';
  }
  const paths = changedPaths(cwd, localSha, targetSha);
  const nextAction = { synced: 'none-push-unnecessary',
    'behind-fast-forwardable': 'apply-recovery-backed-canonical-sync',
    'ahead-needs-pr': 'preserve-local-main-into-admitted-lane',
    'squash-integrated-divergence': 'join-integration-receipt-and-sync',
    'true-conflict': 'reconcile-authored-differences-in-a-lane' }[status];
  return Object.freeze({ schema: RECONCILIATION_STATUS_SCHEMA, status, branch, targetRef,
    localSha, targetSha, changedPaths: Object.freeze(paths),
    claimScope: scope && paths.length > 0 ? canonicalClaimScope(scope, paths) : null,
    proof: proof ? Object.freeze({ kind: proof.kind, baseHead: proof.baseHead,
      head: proof.head, pathCount: proof.pathCount }) : null, nextAction });
}

export function canonicalPlanBody(plan) { return {
  schema: plan.schema, repository: plan.repository, branch: plan.branch, targetRef: plan.targetRef,
  expectedLocalSha: plan.expectedLocalSha, expectedTargetSha: plan.expectedTargetSha,
  inventoryDigest: plan.inventoryDigest, inventory: plan.inventory,
  ignoredPathsDigest: plan.ignoredPathsDigest, ignoredPathCount: plan.ignoredPathCount,
  relation: plan.relation, reconciliation: plan.reconciliation,
}; }

/** Snapshot one exact-shape canonical plan inside its resource ceilings. */
export function boundedCanonicalPlan(value, limits) {
  let plan;
  try { plan = snapshotBoundedJson(value, {
    maxDepth: 8, maxNodes: 20_000, maxStringBytes: limits.serializedPlanBytes,
    maxAggregateStringBytes: limits.serializedPlanBytes,
    maxArrayLength: limits.inventoryEntries, maxObjectKeys: 32,
    arrayBudgetCode: 'inventory-count-limit' }); } catch (error) {
    const code = error.code === 'inventory-count-limit' ? 'plan-inventory-limit'
      : ['string-budget', 'aggregate-string-budget'].includes(error.code) ? 'plan-byte-limit'
        : 'plan-resource-limit';
    reject(code, { cause: error.code ?? error.message });
  }
  if (!Array.isArray(plan?.inventory)) reject('invalid-plan-inventory');
  const bytes = Buffer.byteLength(JSON.stringify(plan), 'utf8');
  if (bytes > limits.serializedPlanBytes)
    reject('plan-byte-limit', { bytes, limit: limits.serializedPlanBytes });
  const keys = Object.keys(plan).sort();
  if (keys.length !== PLAN_KEYS.length || keys.some((key, index) => key !== PLAN_KEYS[index]))
    reject('invalid-plan-shape', { keys });
  return plan;
}

const WINDOWS_DEVICE = /^(?:aux|clock\$|com[1-9]|con|conin\$|conout\$|lpt[1-9]|nul|prn)(?:\..*)?$/iu;
const DOT_GIT_ALIAS = /^(?:\.git|\.?git~[1-9][0-9]*)$/iu;
function portableTreePath(path) {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((component) => {
    const portable = component.normalize('NFC');
    const ntfs = portable.replace(/[ .]+$/gu, '');
    return component !== '' && component !== '.' && component !== '..'
      && !/[<>:"|?*\u0000-\u001f\u007f]/u.test(component)
      && !/[ .]$/u.test(component) && !WINDOWS_DEVICE.test(ntfs)
      && !DOT_GIT_ALIAS.test(ntfs)
      && !/[\u200c-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(portable);
  });
}

/** Parse one Git response into a count-bounded tree projection. */
export function parseTreeEntries(fields, maxEntries, { portable = true } = {}) {
  if (!Array.isArray(fields) || fields.length > maxEntries)
    reject('tree-entry-limit', { entries: fields?.length ?? null, limit: maxEntries });
  const found = new Map();
  for (const field of fields) {
    const tab = field.indexOf('\t');
    const metadata = tab > 0 ? field.slice(0, tab).trim().split(/\s+/u) : [];
    const [mode, type, oid, sizeText] = metadata;
    const path = tab > 0 ? field.slice(tab + 1) : '';
    const size = sizeText === '-' ? null : Number(sizeText);
    if (!/^(?:100644|100755|120000|160000)$/u.test(mode ?? '')
      || !['blob', 'commit'].includes(type) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid ?? '')
      || portable && !portableTreePath(path) || found.has(path)
      || size !== null && (!Number.isSafeInteger(size) || size < 0))
      reject('tree-entry-invalid', { path });
    found.set(path, { mode, type, oid, size });
  }
  return found;
}

/** Refuse target topology that can reinterpret or overwrite ignored paths. */
export function assertIgnoredProjectionSafe(localTree, targetTree, ignored) {
  const ignoreRules = (tree) => [...tree].filter(
    ([path]) => path === '.gitignore' || path.endsWith('/.gitignore'))
    .sort(([left], [right]) => left.localeCompare(right));
  if (ignored.length > 0 && JSON.stringify(ignoreRules(localTree))
      !== JSON.stringify(ignoreRules(targetTree))) reject('ignore-rules-drift');
  const targetPaths = [...targetTree.keys()].sort();
  const targetSet = new Set(targetPaths);
  const collisions = ignored.filter((ignoredPath) => {
    let prefix = ignoredPath;
    while (prefix.includes('/')) {
      if (targetSet.has(prefix)) return true;
      prefix = prefix.slice(0, prefix.lastIndexOf('/'));
    }
    if (targetSet.has(prefix)) return true;
    const descendant = `${ignoredPath}/`;
    const candidate = targetPaths.find((tracked) => tracked >= descendant);
    return candidate ? ignoredPath === candidate || ignoredPath.startsWith(`${candidate}/`)
      || candidate.startsWith(descendant) : false;
  });
  if (collisions.length > 0) reject('ignored-target-collision', { paths: collisions });
}

/** Prove a materialization fits count, per-entry, and aggregate byte ceilings. */
export function assertEntryByteBudget(entries, {
  maxEntries, maxEntryBytes, maxAggregateBytes, label,
}) {
  if (!Array.isArray(entries) || entries.length > maxEntries)
    reject(`${label}-entry-limit`, { entries: entries?.length ?? null, limit: maxEntries });
  let total = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry?.size) || entry.size < 0)
      reject(`${label}-entry-size-invalid`, { path: entry?.path ?? null });
    if (entry.size > maxEntryBytes)
      reject(`${label}-file-limit`, { path: entry.path, bytes: entry.size, limit: maxEntryBytes });
    if (entry.size > maxAggregateBytes - total)
      reject(`${label}-aggregate-limit`, { bytes: total + entry.size, limit: maxAggregateBytes });
    total += entry.size;
  }
  return total;
}

/** Serialize each manifest entry separately and stop before the aggregate ceiling. */
export function quarantineManifest(plan, entries, maxBytes) {
  const header = JSON.stringify({ schema: 'agentic-os-canonical-sync-quarantine/v1',
    planDigest: plan.planDigest, inventoryDigest: plan.inventoryDigest });
  const chunks = [Buffer.from(`${header.slice(0, -1)},"entries":[`)];
  let total = chunks[0].length;
  entries.forEach((entry, index) => {
    const chunk = Buffer.from(`${index === 0 ? '' : ','}${JSON.stringify({
      slot: String(index), ...entry,
    })}`);
    if (chunk.length > maxBytes - total) reject('quarantine-manifest-limit', {
      entries: index + 1, bytes: total + chunk.length, limit: maxBytes,
    });
    chunks.push(chunk); total += chunk.length;
  });
  const suffix = Buffer.from(']}\n');
  if (suffix.length > maxBytes - total)
    reject('quarantine-manifest-limit', { bytes: total + suffix.length, limit: maxBytes });
  chunks.push(suffix);
  return Buffer.concat(chunks, total + suffix.length);
}

/** Keep v1 bytes when they fit; otherwise bind bounded, ordered chunks through one index. */
export function quarantineManifestBundle(plan, entries, limits) {
  const maxBytes = limits.quarantineManifestBytes;
  const maxChunks = limits.quarantineManifestChunks;
  const maxAggregate = limits.aggregateQuarantineManifestBytes;
  if (![maxBytes, maxChunks, maxAggregate].every(value => Number.isSafeInteger(value) && value > 0))
    reject('quarantine-manifest-limits-invalid');
  try {
    const single = quarantineManifest(plan, entries, maxBytes);
    if (single.length > maxAggregate) reject('quarantine-manifest-aggregate-limit');
    return single;
  } catch (error) {
    if (!(error instanceof CanonicalResourceError) || error.code !== 'quarantine-manifest-limit') throw error;
  }
  const chunks = [], records = [], suffix = Buffer.from(']}\n');
  let parts, size, firstSlot = 0, count = 0, aggregate = 0;
  const begin = () => {
    const header = JSON.stringify({ schema: 'agentic-os-canonical-sync-quarantine-chunk/v1',
      planDigest: plan.planDigest, inventoryDigest: plan.inventoryDigest, firstSlot });
    parts = [Buffer.from(`${header.slice(0, -1)},"entries":[`)]; size = parts[0].length; count = 0;
  };
  const finish = () => {
    if (chunks.length >= maxChunks) reject('quarantine-manifest-chunk-limit', { limit: maxChunks });
    const bytes = size + suffix.length;
    if (bytes > maxAggregate - aggregate) reject('quarantine-manifest-aggregate-limit', { limit: maxAggregate });
    const chunk = Buffer.concat([...parts, suffix], bytes);
    records.push({ name: `manifest-chunk-${chunks.length}.json`, firstSlot, entryCount: count,
      bytes, sha256: createHash('sha256').update(chunk).digest('hex') });
    chunks.push(chunk); aggregate += bytes; firstSlot += count;
  };
  begin();
  entries.forEach((entry, slot) => {
    const text = JSON.stringify({ slot: String(slot), ...entry }), bytes = Buffer.byteLength(text);
    if (size + Number(count > 0) + bytes + suffix.length > maxBytes && count > 0) {
      finish(); begin();
    }
    if (size + bytes + suffix.length > maxBytes) reject('quarantine-manifest-entry-limit', { slot, limit: maxBytes });
    if (count > 0) { parts.push(Buffer.from(',')); size += 1; }
    parts.push(Buffer.from(text)); size += bytes; count += 1;
  });
  finish();
  const index = Buffer.from(`${JSON.stringify({ schema: 'agentic-os-canonical-sync-quarantine/v2',
    planDigest: plan.planDigest, inventoryDigest: plan.inventoryDigest,
    entryCount: entries.length, chunks: records })}\n`);
  if (index.length > maxBytes) reject('quarantine-manifest-index-limit', { limit: maxBytes });
  if (index.length > maxAggregate - aggregate)
    reject('quarantine-manifest-aggregate-limit', { limit: maxAggregate });
  return Object.freeze({ index, chunks: Object.freeze(chunks) });
}

export function assertProjectionBudget(entries, limits, label) {
  return assertEntryByteBudget(entries, {
    maxEntries: limits.treeEntries,
    maxEntryBytes: label === 'target' ? limits.targetFileBytes : limits.sourceFileBytes,
    maxAggregateBytes: label === 'target'
      ? limits.aggregateTargetBytes : limits.aggregateSourceBytes,
    label,
  });
}

/** Dirty authored bytes are copied independently; deleted state lives in the recovery commit. */
export function buildDirtyQuarantineProjection(plan, limits) {
  const entries = plan.inventory.filter(({ kind }) => kind !== 'deleted').map(
    ({ path, mode, size, sha256 }) => ({ path, mode, size, sha256 }));
  assertProjectionBudget(entries, limits, 'quarantine');
  return { entries, manifest: quarantineManifestBundle(plan, entries, limits) };
}

/** Clean tracked bytes may be retired only under the separately attested exclusive contract. */
export function buildCleanRetirementProjection(plan, baseEntries, limits) {
  if (plan.inventory.length !== 0) reject('clean-retirement-dirty-inventory', {
    entries: plan.inventory.length,
  });
  const entries = worktreePreservationEntries(baseEntries, []);
  assertProjectionBudget(entries, limits, 'quarantine');
  return { entries, manifest: quarantineManifestBundle(plan, entries, limits) };
}
