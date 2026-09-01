/** Bounded tree projections and recovery-manifest serialization for canonical sync. */

import { snapshotBoundedJson } from './catalog-input.mjs';
import { worktreePreservationEntries } from './git.mjs';

export class CanonicalResourceError extends Error {
  constructor(code, detail = {}) {
    super(code);
    Object.assign(this, { name: 'CanonicalResourceError', code, detail });
  }
}

function reject(code, detail) { throw new CanonicalResourceError(code, detail); }

const PLAN_KEYS = Object.freeze('authorization branch exclusiveAuthorization expectedLocalSha expectedTargetSha ignoredPathCount ignoredPathsDigest inventory inventoryDigest planDigest recoveryRef repository schema targetRef'.split(' '));

export function canonicalPlanBody(plan) { return {
  schema: plan.schema, repository: plan.repository, branch: plan.branch, targetRef: plan.targetRef,
  expectedLocalSha: plan.expectedLocalSha, expectedTargetSha: plan.expectedTargetSha,
  inventoryDigest: plan.inventoryDigest, inventory: plan.inventory,
  ignoredPathsDigest: plan.ignoredPathsDigest, ignoredPathCount: plan.ignoredPathCount,
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
  return { entries, manifest: quarantineManifest(plan, entries, limits.quarantineManifestBytes) };
}

/** Clean tracked bytes may be retired only under the separately attested exclusive contract. */
export function buildCleanRetirementProjection(plan, baseEntries, limits) {
  if (plan.inventory.length !== 0) reject('clean-retirement-dirty-inventory', {
    entries: plan.inventory.length,
  });
  const entries = worktreePreservationEntries(baseEntries, []);
  assertProjectionBudget(entries, limits, 'quarantine');
  return { entries, manifest: quarantineManifest(plan, entries, limits.quarantineManifestBytes) };
}
