/** Recovery-backed canonical sync: read-only plan, durable snapshot, then protected SHA-CAS. */
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { acquireOperationLock, assertDirectoryAncestors, atomicAdvanceRef, commonDir, currentBranch,
  decodeNulFields as decodeGitNul, git, installStagedEntries, isAncestor, quarantineWorktreeEntries, repoRoot, stageTreeEntries, worktreePreservationEntries,
} from './git.mjs';
export const PLAN_SCHEMA = 'agentic-os-canonical-sync-plan/v2';
export const RECEIPT_SCHEMA = 'agentic-os-canonical-sync-receipt/v2';
export const TARGET_REF = 'refs/remotes/origin/main';
export class CanonicalSyncError extends Error {
  constructor(reason, detail = {}) { super(`${reason}: ${JSON.stringify(detail)}`);
    Object.assign(this, { name: 'CanonicalSyncError', reason, detail }); }
}
function refuse(reason, detail = {}) { throw new CanonicalSyncError(reason, detail); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function decodeNulFields(value) {
  const fields = decodeGitNul(value);
  if (!fields) refuse('blocked-invalid-path-inventory');
  return fields; }
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
function treeEntries(ref, cwd) {
  const fields = decodeNulFields(git(['ls-tree', '-r', '-z', ref], { cwd, binary: true }));
  const found = new Map();
  for (const field of fields) {
    const tab = field.indexOf('\t');
    const [mode, type, oid] = field.slice(0, tab).split(' ');
    found.set(field.slice(tab + 1), { mode, type, oid });
  }
  return found;
}
function contentAt(path, cwd) {
  const absolute = join(cwd, path);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return { kind: 'symlink', mode: '120000',
    bytes: readlinkSync(absolute, { encoding: 'buffer' }) };
  if (!stat.isFile()) refuse('blocked-unsupported-dirty-path', { path });
  return { kind: 'file', mode: stat.mode & 0o111 ? '100755' : '100644', bytes: readFileSync(absolute) };
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
  const base = treeEntries(localSha, cwd);
  const dirty = parseNameStatus(git(['diff', '--name-status', '-z', '--no-renames', 'HEAD', '--'],
    { cwd, binary: true }));
  const untracked = decodeNulFields(git(['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd, binary: true })).map((path) => ({ path, status: '?' }));
  const byPath = new Map([...dirty, ...untracked].map((entry) => [entry.path, entry.status]));
  for (const [path, prior] of base) {
    const stat = lstatSync(join(cwd, path), { throwIfNoEntry: false });
    if (!stat) {
      if (!byPath.has(path)) byPath.set(path, 'D');
      continue;
    }
    if (prior.mode === '160000') continue;
    const content = contentAt(path, cwd);
    const rawDrift = rawTracked
      && git(['hash-object', '--stdin'], { cwd, input: content.bytes }) !== prior.oid;
    if ((content.mode !== prior.mode || rawDrift) && !byPath.has(path)) byPath.set(path, 'M');
  }
  const inventory = [];
  for (const [path, status] of [...byPath].sort(([a], [b]) => a.localeCompare(b))) {
    const prior = base.get(path) ?? null;
    if (prior?.mode === '160000') refuse('blocked-dirty-submodule', { path });
    if (status === 'D') {
      inventory.push({ path, status, kind: 'deleted', mode: null, oid: null, sha256: null, prior });
      continue;
    }
    const content = contentAt(path, cwd);
    const oid = git(['hash-object', '--stdin'], { cwd, input: content.bytes });
    inventory.push({ path, status, kind: content.kind, mode: content.mode, oid,
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
function pathCollision(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
function ignoreRuleEntries(ref, cwd) {
  return [...treeEntries(ref, cwd)]
    .filter(([path]) => path === '.gitignore' || path.endsWith('/.gitignore'))
    .sort(([left], [right]) => left.localeCompare(right));
}
function assertIgnoredSafe(cwd, localSha, targetSha, ignored) {
  if (
    ignored.length > 0
    && JSON.stringify(ignoreRuleEntries(localSha, cwd))
      !== JSON.stringify(ignoreRuleEntries(targetSha, cwd))
  ) refuse('blocked-ignore-rules-drift');
  const targetPaths = [...treeEntries(targetSha, cwd).keys()].sort();
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
    return candidate ? pathCollision(ignoredPath, candidate) : false;
  });
  if (collisions.length > 0) refuse('blocked-ignored-target-collision', { paths: collisions });
}
function stablePlanBody(plan) {
  return {
    schema: plan.schema, repository: plan.repository, branch: plan.branch, targetRef: plan.targetRef,
    expectedLocalSha: plan.expectedLocalSha, expectedTargetSha: plan.expectedTargetSha,
    inventoryDigest: plan.inventoryDigest, inventory: plan.inventory,
    ignoredPathsDigest: plan.ignoredPathsDigest, ignoredPathCount: plan.ignoredPathCount,
  };
}
function calculatePlanDigest(plan) { return sha256(JSON.stringify(stablePlanBody(plan))); }
function exclusiveAuthorization(digest) { return `agentic-os:canonical-sync:exclusive:${digest}`; }
function canonicalIdentity(branch, targetRef) {
  const match = targetRef?.match(/^refs\/remotes\/[^/]+\/(.+)$/u);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(branch ?? '') || match?.[1] !== branch
    || branch.includes('..') || branch.includes('//') || branch.includes('@{'))
    refuse('blocked-canonical-identity', { branch, targetRef });
  return `refs/heads/${branch}`;
}
function observed(cwd, targetRef, expectedBranch) {
  const root = realpathSync(repoRoot(cwd));
  const branch = currentBranch(root);
  if (branch !== expectedBranch) refuse('blocked-not-canonical-branch', { branch, expectedBranch });
  assertCleanIndex(root);
  const localSha = git(['rev-parse', '--verify', canonicalIdentity(branch, targetRef)], { cwd: root });
  const headSha = git(['rev-parse', '--verify', 'HEAD'], { cwd: root });
  if (headSha !== localSha) refuse('blocked-head-ref-mismatch', { headSha, localSha });
  const targetSha = git(['rev-parse', '--verify', targetRef], { cwd: root, allowFail: true });
  if (!targetSha) refuse('blocked-target-ref-missing', { targetRef });
  if (!isAncestor(localSha, targetSha, root)) refuse('blocked-non-fast-forward', { localSha, targetSha });
  const targetTree = treeEntries(targetSha, root);
  const localTree = treeEntries(localSha, root);
  if ([...localTree.values(), ...targetTree.values()]
    .some((entry) => entry.type !== 'blob')) refuse('blocked-submodule-topology');
  [...localTree.keys(), ...targetTree.keys()].forEach(
    (path) => assertDirectoryAncestors(path, root, { allowMissing: true }),
  );
  const directory = [...targetTree.keys()].find(
    (path) => lstatSync(join(root, path), { throwIfNoEntry: false })?.isDirectory());
  if (directory) refuse('blocked-directory-target-collision', { path: directory });
  const ignored = ignoredPaths(root);
  assertIgnoredSafe(root, localSha, targetSha, ignored);
  const inventory = snapshotInventory(root, localSha);
  return { root, localSha, targetSha, inventory, ignoredPathsDigest: sha256(JSON.stringify(ignored)),
    ignoredPathCount: ignored.length };
}
export function planCanonicalSync({ cwd = process.cwd(), targetRef = TARGET_REF, branch = 'main' } = {}) {
  const state = observed(cwd, targetRef, branch);
  const inventoryDigest = sha256(JSON.stringify(state.inventory));
  const plan = {
    schema: PLAN_SCHEMA, repository: state.root, branch, targetRef,
    expectedLocalSha: state.localSha, expectedTargetSha: state.targetSha,
    inventoryDigest, inventory: state.inventory,
    ignoredPathsDigest: state.ignoredPathsDigest, ignoredPathCount: state.ignoredPathCount,
  };
  plan.planDigest = calculatePlanDigest(plan);
  plan.authorization = `agentic-os:canonical-sync:${plan.planDigest}`;
  plan.exclusiveAuthorization = exclusiveAuthorization(plan.planDigest);
  plan.recoveryRef = `refs/agentic-os/recovery/canonical-sync/${plan.planDigest}`;
  return plan;
}
function assertPlan(plan) {
  if (!plan || plan.schema !== PLAN_SCHEMA) refuse('blocked-invalid-plan-schema');
  canonicalIdentity(plan.branch, plan.targetRef);
  const inventoryDigest = sha256(JSON.stringify(plan.inventory));
  if (plan.inventoryDigest !== inventoryDigest) {
    refuse('blocked-inventory-digest-mismatch', {
      expected: inventoryDigest, actual: plan.inventoryDigest });
  }
  const digest = calculatePlanDigest(plan);
  if (plan.planDigest !== digest)
    refuse('blocked-plan-digest-mismatch', { expected: digest, actual: plan.planDigest });
  if (plan.authorization !== `agentic-os:canonical-sync:${digest}`)
    refuse('blocked-plan-authorization-mismatch');
  if (plan.exclusiveAuthorization !== exclusiveAuthorization(digest))
    refuse('blocked-plan-exclusive-authorization-mismatch');
  if (plan.recoveryRef !== `refs/agentic-os/recovery/canonical-sync/${digest}`)
    refuse('blocked-plan-recovery-ref-mismatch');
}
function assertUnchanged(plan, cwd, { recoveryCommit = null } = {}) {
  const state = observed(cwd, plan.targetRef, plan.branch);
  const digest = sha256(JSON.stringify(state.inventory));
  const facts = { repository: state.root, localSha: state.localSha, targetSha: state.targetSha,
    inventoryDigest: digest,
    ignoredPathsDigest: state.ignoredPathsDigest,
    ignoredPathCount: state.ignoredPathCount,
  };
  const expected = { repository: plan.repository, localSha: plan.expectedLocalSha,
    targetSha: plan.expectedTargetSha, inventoryDigest: plan.inventoryDigest,
    ignoredPathsDigest: plan.ignoredPathsDigest,
    ignoredPathCount: plan.ignoredPathCount,
  };
  if (JSON.stringify(facts) !== JSON.stringify(expected))
    refuse('blocked-plan-drift', { expected, actual: facts });
  const existing = git(['rev-parse', '--verify', plan.recoveryRef], { cwd, allowFail: true });
  if (existing && existing !== recoveryCommit)
    refuse('blocked-recovery-ref-exists', { recoveryRef: plan.recoveryRef, existing });
  if (!recoveryCommit && existing)
    refuse('blocked-recovery-ref-exists', { recoveryRef: plan.recoveryRef, existing });
}
function assertRecoveryFidelity(plan, recovery, cwd) {
  const captured = treeEntries(recovery.commit, cwd);
  for (const entry of plan.inventory) {
    const actual = captured.get(entry.path) ?? null;
    if (entry.kind === 'deleted' ? actual !== null :
        !actual || actual.mode !== entry.mode || actual.oid !== entry.oid) {
      refuse('blocked-recovery-fidelity', { path: entry.path, expected: entry, actual });
    }
  }
}
function captureRecovery(plan, cwd) {
  const temp = mkdtempSync(join(commonDir(cwd), 'agentic-os-canonical-sync-'));
  const index = join(temp, 'index');
  const env = { GIT_INDEX_FILE: index };
  let commit;
  let tree;
  try {
    git(['read-tree', plan.expectedLocalSha], { cwd, env });
    for (const entry of plan.inventory) {
      if (entry.kind === 'deleted') {
        git(['update-index', '--force-remove', '--', entry.path], { cwd, env });
        continue;
      }
      const content = contentAt(entry.path, cwd);
      const oid = git(['hash-object', '-w', '--stdin'], { cwd, env, input: content.bytes });
      if (oid !== entry.oid || content.mode !== entry.mode || sha256(content.bytes) !== entry.sha256) {
        refuse('blocked-capture-drift', { path: entry.path });
      }
      git(['update-index', '--add', '--cacheinfo', `${entry.mode},${oid},${entry.path}`], { cwd, env });
    }
    tree = git(['write-tree'], { cwd, env });
    const message = `agentic-os canonical recovery\n\nPlan-Digest: ${plan.planDigest}\n`;
    const identity = {
      GIT_AUTHOR_NAME: 'agentic-os recovery',
      GIT_AUTHOR_EMAIL: 'recovery@agentic-os.invalid',
      GIT_COMMITTER_NAME: 'agentic-os recovery',
      GIT_COMMITTER_EMAIL: 'recovery@agentic-os.invalid',
    };
    commit = git(['commit-tree', tree, '-p', plan.expectedLocalSha], {
      cwd, input: message, env: identity });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  git(['update-ref', plan.recoveryRef, commit, '0'.repeat(commit.length)], { cwd });
  return { commit, tree };
}
function quarantineInventory(plan, cwd) {
  const entries = worktreePreservationEntries(treeEntries(plan.expectedLocalSha, cwd),
    plan.inventory);
  const manifest = `${JSON.stringify({
    schema: 'agentic-os-canonical-sync-quarantine/v1',
    planDigest: plan.planDigest,
    inventoryDigest: plan.inventoryDigest,
    entries: entries.map((entry, index) => ({ slot: String(index), ...entry })),
  }, null, 2)}\n`;
  return quarantineWorktreeEntries(
    'agentic-os-canonical-sync-quarantine',
    entries,
    (entry, slot, path) => {
      const content = contentAt(slot, path);
      const bytesMatch = entry.sha256 ? sha256(content.bytes) === entry.sha256
        : git(['hash-object', '--stdin'], { cwd, input: content.bytes }) === entry.oid;
      if (content.mode !== entry.mode || !bytesMatch)
        refuse('blocked-quarantine-drift', { path: entry.path, quarantinePath: path });
    },
    cwd,
    manifest,
  );
}
export function applyCanonicalSync(plan, { cwd = process.cwd(), authorization = null, exclusive = null } = {}) {
  assertPlan(plan);
  if (authorization !== plan.authorization)
    refuse('blocked-authorization', { expected: plan.authorization });
  if (exclusive !== plan.exclusiveAuthorization)
    refuse('blocked-exclusive-authorization', { expected: plan.exclusiveAuthorization });
  const root = realpathSync(repoRoot(cwd));
  if (root !== realpathSync(resolve(plan.repository)))
    refuse('blocked-repository-mismatch', { expected: plan.repository, actual: root });
  const lockPath = acquireOperationLock('agentic-os-canonical-sync', root);
  if (!lockPath) refuse('blocked-exclusive-lock-held');
  let recovery = null;
  let quarantine = null;
  let stagingPath = null;
  try {
    assertUnchanged(plan, root);
    const targetEntries = [...treeEntries(plan.expectedTargetSha, root)].map(
      ([path, entry]) => ({ path, ...entry }));
    stagingPath = stageTreeEntries('agentic-os-canonical-sync-target', targetEntries, root);
    recovery = captureRecovery(plan, root);
    assertRecoveryFidelity(plan, recovery, root);
    assertUnchanged(plan, root, { recoveryCommit: recovery.commit });
    quarantine = quarantineInventory(plan, root);
    if (git(['rev-parse', '--verify', plan.recoveryRef], { cwd: root }) !== recovery.commit)
      refuse('blocked-recovery-ref-drift');
    installStagedEntries(stagingPath, targetEntries, root);
    git(['read-tree', plan.expectedTargetSha], { cwd: root });
    atomicAdvanceRef(
      `refs/heads/${plan.branch}`,
      plan.expectedTargetSha,
      plan.expectedLocalSha,
      [[plan.targetRef, plan.expectedTargetSha], [plan.recoveryRef, recovery.commit]],
      root,
    );
    const actualHead = git(['rev-parse', 'HEAD'], { cwd: root });
    const actualTarget = git(['rev-parse', '--verify', plan.targetRef], { cwd: root });
    const actualRecovery = git(['rev-parse', '--verify', plan.recoveryRef],
      { cwd: root, allowFail: true });
    const status = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root });
    assertCleanIndex(root);
    const remaining = snapshotInventory(root, plan.expectedTargetSha);
    if (actualHead !== plan.expectedTargetSha || actualTarget !== plan.expectedTargetSha
        || actualRecovery !== recovery.commit || status !== '' || remaining.length > 0) {
      refuse('blocked-postcondition', {
        expectedHead: plan.expectedTargetSha,
        actualHead,
        actualTarget,
        actualRecovery,
        status,
        remaining,
      });
    }
    quarantine.verify();
    if (git(['rev-parse', '--verify', plan.recoveryRef], { cwd: root, allowFail: true })
        !== recovery.commit) {
      refuse('blocked-recovery-ref-drift');
    }
    rmSync(stagingPath, { recursive: true });
    return {
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
      quarantinePath: quarantine.path,
      quarantineManifestPath: quarantine.manifestPath,
      quarantineManifestDigest: sha256(readFileSync(quarantine.manifestPath)),
      quarantineEntryCount: quarantine.moved.length,
      quarantineRemoved: false,
      stagingRemoved: true,
      visibleStatusClean: true,
      ignoredPathsPreservedInPlace: true,
    };
  } catch (error) {
    if (!recovery) {
      const abandoned = stagingPath ?? error.stagingPath;
      if (abandoned) rmSync(abandoned, { recursive: true, force: true });
      throw error;
    }
    refuse('blocked-after-recovery', {
      recoveryRef: plan.recoveryRef,
      recoveryCommit: recovery.commit,
      quarantinePath: quarantine?.path ?? error.quarantinePath ?? error.detail?.quarantinePath ?? null,
      stagingPath: stagingPath ?? error.stagingPath ?? null,
      collisionPath: error.installPath ?? null,
      cause: error.reason ?? error.message,
    });
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
