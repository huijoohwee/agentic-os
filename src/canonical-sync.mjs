/**
 * Crash-safe synchronization of the canonical checkout.
 *
 * Planning is read-only. Apply accepts only the plan-derived authorization,
 * snapshots every nonignored dirty byte under a durable recovery ref, restores
 * the fetched target tree, then advances main with compare-and-swap.
 */

import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { git, commonDir, currentBranch, isAncestor, repoRoot } from './git.mjs';

export const PLAN_SCHEMA = 'agentic-os-canonical-sync-plan/v1';
export const RECEIPT_SCHEMA = 'agentic-os-canonical-sync-receipt/v1';

export class CanonicalSyncError extends Error {
  constructor(reason, detail = {}) {
    super(`${reason}: ${JSON.stringify(detail)}`);
    this.name = 'CanonicalSyncError';
    this.reason = reason;
    this.detail = detail;
  }
}

function refuse(reason, detail = {}) {
  throw new CanonicalSyncError(reason, detail);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nulFields(value) {
  if (!value) return [];
  const fields = value.split('\0');
  if (fields.at(-1) === '') fields.pop();
  return fields;
}

function parseNameStatus(raw) {
  const fields = nulFields(raw);
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
  const fields = nulFields(git(['ls-tree', '-r', '-z', ref], { cwd }));
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
  if (stat.isSymbolicLink()) {
    return { kind: 'symlink', mode: '120000', bytes: Buffer.from(readlinkSync(absolute)) };
  }
  if (!stat.isFile()) refuse('blocked-unsupported-dirty-path', { path });
  return {
    kind: 'file',
    mode: stat.mode & 0o111 ? '100755' : '100644',
    bytes: readFileSync(absolute),
  };
}

function assertCleanIndex(cwd) {
  if (git(['diff', '--cached', '--quiet', 'HEAD', '--'], { cwd, allowFail: true }) === null) {
    refuse('blocked-index-dirty');
  }
  if (git(['ls-files', '--unmerged'], { cwd }) !== '') refuse('blocked-index-unmerged');
}

function snapshotInventory(cwd, localSha) {
  const base = treeEntries(localSha, cwd);
  const dirty = parseNameStatus(
    git(['diff', '--name-status', '-z', '--no-renames', 'HEAD', '--'], { cwd }),
  );
  const untracked = nulFields(
    git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd }),
  ).map((path) => ({ path, status: '?' }));
  const byPath = new Map([...dirty, ...untracked].map((entry) => [entry.path, entry.status]));
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
    inventory.push({
      path,
      status,
      kind: content.kind,
      mode: content.mode,
      oid,
      sha256: sha256(content.bytes),
      prior,
    });
  }
  return inventory;
}

function ignoredPaths(cwd) {
  return nulFields(
    git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd }),
  )
    .map((path) => path.endsWith('/') ? path.slice(0, -1) : path)
    .sort();
}

function pathCollision(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assertIgnoredSafe(cwd, targetSha) {
  const targetPaths = [...treeEntries(targetSha, cwd).keys()].sort();
  const targetSet = new Set(targetPaths);
  const collisions = ignoredPaths(cwd).filter((ignored) => {
    let prefix = ignored;
    while (prefix.includes('/')) {
      if (targetSet.has(prefix)) return true;
      prefix = prefix.slice(0, prefix.lastIndexOf('/'));
    }
    if (targetSet.has(prefix)) return true;
    const descendant = `${ignored}/`;
    const candidate = targetPaths.find((tracked) => tracked >= descendant);
    return candidate ? pathCollision(ignored, candidate) : false;
  });
  if (collisions.length > 0) refuse('blocked-ignored-target-collision', { paths: collisions });
}

function stablePlanBody(plan) {
  return {
    schema: plan.schema,
    repository: plan.repository,
    branch: plan.branch,
    targetRef: plan.targetRef,
    expectedLocalSha: plan.expectedLocalSha,
    expectedTargetSha: plan.expectedTargetSha,
    inventoryDigest: plan.inventoryDigest,
    inventory: plan.inventory,
  };
}

function calculatePlanDigest(plan) {
  return sha256(JSON.stringify(stablePlanBody(plan)));
}

function observed(cwd, targetRef) {
  const root = realpathSync(repoRoot(cwd));
  const branch = currentBranch(root);
  if (branch !== 'main') refuse('blocked-not-canonical-main', { branch });
  assertCleanIndex(root);
  const localSha = git(['rev-parse', '--verify', 'refs/heads/main'], { cwd: root });
  const headSha = git(['rev-parse', '--verify', 'HEAD'], { cwd: root });
  if (headSha !== localSha) refuse('blocked-head-ref-mismatch', { headSha, localSha });
  const targetSha = git(['rev-parse', '--verify', targetRef], { cwd: root, allowFail: true });
  if (!targetSha) refuse('blocked-target-ref-missing', { targetRef });
  if (!isAncestor(localSha, targetSha, root)) {
    refuse('blocked-non-fast-forward', { localSha, targetSha });
  }
  assertIgnoredSafe(root, targetSha);
  const inventory = snapshotInventory(root, localSha);
  return { root, localSha, targetSha, inventory };
}

export function planCanonicalSync({ cwd = process.cwd(), targetRef = 'origin/main' } = {}) {
  const state = observed(cwd, targetRef);
  const inventoryDigest = sha256(JSON.stringify(state.inventory));
  const plan = {
    schema: PLAN_SCHEMA,
    repository: state.root,
    branch: 'main',
    targetRef,
    expectedLocalSha: state.localSha,
    expectedTargetSha: state.targetSha,
    inventoryDigest,
    inventory: state.inventory,
  };
  plan.planDigest = calculatePlanDigest(plan);
  plan.authorization = `agentic-os:canonical-sync:${plan.planDigest}`;
  plan.recoveryRef = `refs/agentic-os/recovery/canonical-sync/${plan.planDigest}`;
  return plan;
}

function assertPlan(plan) {
  if (!plan || plan.schema !== PLAN_SCHEMA) refuse('blocked-invalid-plan-schema');
  const inventoryDigest = sha256(JSON.stringify(plan.inventory));
  if (plan.inventoryDigest !== inventoryDigest) {
    refuse('blocked-inventory-digest-mismatch', {
      expected: inventoryDigest,
      actual: plan.inventoryDigest,
    });
  }
  const digest = calculatePlanDigest(plan);
  if (plan.planDigest !== digest) {
    refuse('blocked-plan-digest-mismatch', { expected: digest, actual: plan.planDigest });
  }
  if (plan.authorization !== `agentic-os:canonical-sync:${digest}`) {
    refuse('blocked-plan-authorization-mismatch');
  }
  if (plan.recoveryRef !== `refs/agentic-os/recovery/canonical-sync/${digest}`) {
    refuse('blocked-plan-recovery-ref-mismatch');
  }
}

function assertUnchanged(plan, cwd, { recoveryCommit = null } = {}) {
  const state = observed(cwd, plan.targetRef);
  const digest = sha256(JSON.stringify(state.inventory));
  const facts = {
    repository: state.root,
    localSha: state.localSha,
    targetSha: state.targetSha,
    inventoryDigest: digest,
  };
  const expected = {
    repository: plan.repository,
    localSha: plan.expectedLocalSha,
    targetSha: plan.expectedTargetSha,
    inventoryDigest: plan.inventoryDigest,
  };
  if (JSON.stringify(facts) !== JSON.stringify(expected)) {
    refuse('blocked-plan-drift', { expected, actual: facts });
  }
  const existing = git(['rev-parse', '--verify', plan.recoveryRef], { cwd, allowFail: true });
  if (existing && existing !== recoveryCommit) {
    refuse('blocked-recovery-ref-exists', { recoveryRef: plan.recoveryRef, existing });
  }
  if (!recoveryCommit && existing) {
    refuse('blocked-recovery-ref-exists', { recoveryRef: plan.recoveryRef, existing });
  }
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
      git(['update-index', '--add', '--cacheinfo', `${entry.mode},${oid},${entry.path}`], {
        cwd,
        env,
      });
    }
    const tree = git(['write-tree'], { cwd, env });
    const message = `agentic-os canonical recovery\n\nPlan-Digest: ${plan.planDigest}\n`;
    const identity = {
      GIT_AUTHOR_NAME: 'agentic-os recovery',
      GIT_AUTHOR_EMAIL: 'recovery@agentic-os.invalid',
      GIT_COMMITTER_NAME: 'agentic-os recovery',
      GIT_COMMITTER_EMAIL: 'recovery@agentic-os.invalid',
    };
    const commit = git(['commit-tree', tree, '-p', plan.expectedLocalSha], {
      cwd,
      input: message,
      env: identity,
    });
    git(['update-ref', plan.recoveryRef, commit, '0'.repeat(commit.length)], { cwd });
    return { commit, tree };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function removePlannedUntracked(plan, targetPaths, cwd) {
  const removed = [];
  for (const entry of plan.inventory) {
    if (entry.status !== '?' || targetPaths.has(entry.path)) continue;
    const content = contentAt(entry.path, cwd);
    const oid = git(['hash-object', '--stdin'], { cwd, input: content.bytes });
    if (content.mode !== entry.mode || oid !== entry.oid || sha256(content.bytes) !== entry.sha256) {
      refuse('blocked-removal-drift', { path: entry.path });
    }
    rmSync(join(cwd, entry.path), { force: true });
    removed.push(entry.path);
  }
  return removed;
}

function cleanStatus(cwd) {
  return git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd });
}

export function applyCanonicalSync(
  plan,
  { cwd = process.cwd(), authorization = null } = {},
) {
  assertPlan(plan);
  if (authorization !== plan.authorization) {
    refuse('blocked-authorization', { expected: plan.authorization });
  }
  const root = realpathSync(repoRoot(cwd));
  if (root !== realpathSync(resolve(plan.repository))) {
    refuse('blocked-repository-mismatch', { expected: plan.repository, actual: root });
  }
  assertUnchanged(plan, root);
  const recovery = captureRecovery(plan, root);
  assertRecoveryFidelity(plan, recovery, root);
  assertUnchanged(plan, root, { recoveryCommit: recovery.commit });
  const targetPaths = new Set(treeEntries(plan.expectedTargetSha, root).keys());
  const removedUntracked = removePlannedUntracked(plan, targetPaths, root);

  git(
    ['restore', `--source=${plan.expectedTargetSha}`, '--staged', '--worktree', '--', '.'],
    { cwd: root },
  );
  git(
    ['update-ref', 'refs/heads/main', plan.expectedTargetSha, plan.expectedLocalSha],
    { cwd: root },
  );

  const actualHead = git(['rev-parse', 'HEAD'], { cwd: root });
  const actualTarget = git(['rev-parse', '--verify', plan.targetRef], { cwd: root });
  const status = cleanStatus(root);
  if (actualHead !== plan.expectedTargetSha || actualTarget !== plan.expectedTargetSha || status !== '') {
    refuse('blocked-postcondition', {
      expectedHead: plan.expectedTargetSha,
      actualHead,
      actualTarget,
      status,
      recoveryRef: plan.recoveryRef,
    });
  }
  return {
    schema: RECEIPT_SCHEMA,
    planDigest: plan.planDigest,
    repository: root,
    priorHead: plan.expectedLocalSha,
    targetHead: plan.expectedTargetSha,
    inventoryDigest: plan.inventoryDigest,
    inventoryCount: plan.inventory.length,
    recoveryRef: plan.recoveryRef,
    recoveryCommit: recovery.commit,
    recoveryTree: recovery.tree,
    removedUntracked,
    clean: true,
  };
}
