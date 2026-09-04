/**
 * Lane worktree lifecycle: provision, inspect, retire.
 *
 * A lane worktree and its branch are requested in one Git command from one captured
 * canonical SHA, with no detached binding window. Worktrees live outside the tree so a lane never
 * appears as untracked state in another lane.
 */

import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  git,
  gitLines,
  headSha,
  observeGit,
  observeGitLines,
  repoRoot,
  worktrees,
  worktreeCleanupRisks,
  refExists,
  untrackedPaths,
} from './git.mjs';
import { isLaneRef, laneDirName } from './lane-id.mjs';

export const LANE_BRANCH_LIMIT = 256;

/** `<parent>/.worktrees/<repo>` by default; override with AGENTIC_OS_WORKTREE_ROOT. */
export function worktreeRoot(cwd = process.cwd()) {
  const override = process.env.AGENTIC_OS_WORKTREE_ROOT;
  const root = repoRoot(cwd);
  if (override) return resolve(override);
  return join(dirname(root), '.worktrees', basename(root));
}

export function lanePath(scope, device, cwd = process.cwd()) {
  return join(worktreeRoot(cwd), laneDirName(scope, device));
}

/** Lane branches that exist locally. */
export function laneBranches(cwd = process.cwd()) {
  const branches = observeGitLines([
    'for-each-ref', '--format=%(refname:short)', 'refs/heads/agent',
    `--count=${LANE_BRANCH_LIMIT + 1}`,
  ], { cwd });
  if (branches.length > LANE_BRANCH_LIMIT) {
    const error = new Error(`lane branch inventory exceeds ${LANE_BRANCH_LIMIT}; `
      + 'preserve every ref and recover or partition it before survey');
    error.reason = 'blocked-lane-inventory-over-budget';
    throw error;
  }
  return branches;
}

/** Bounded normal-path count; deep reap retains the strict full-inventory stop. */
export function laneBranchSummary(cwd = process.cwd()) {
  const branches = observeGitLines([
    'for-each-ref', '--format=%(refname:short)', 'refs/heads/agent',
    `--count=${LANE_BRANCH_LIMIT + 1}`,
  ], { cwd });
  return Object.freeze({
    count: branches.length,
    truncated: branches.length > LANE_BRANCH_LIMIT,
  });
}

/** One exact lane selection bypasses only the unrelated global inventory count. */
export function reapLaneBranches(ref = null, cwd = process.cwd()) {
  if (ref === null) return laneBranches(cwd);
  if (!isLaneRef(ref)) {
    const error = new TypeError(`invalid lane ref ${JSON.stringify(ref)}`);
    error.reason = 'blocked-invalid-lane-ref';
    throw error;
  }
  if (!refExists(`refs/heads/${ref}`, cwd)) {
    const error = new Error(`lane branch does not exist: ${ref}`);
    error.reason = 'blocked-lane-ref-missing';
    throw error;
  }
  return [ref];
}

/** Lane refs with a registered worktree, including preserved stale projections. */
export function registeredLaneBranches(cwd = process.cwd()) {
  return worktrees(cwd).map((entry) => entry.branch).filter(isLaneRef);
}

/** The registered worktree bound to a lane ref, or null. */
export function worktreeFor(ref, cwd = process.cwd()) {
  return worktrees(cwd).find((entry) => entry.branch === ref) ?? null;
}

/** Registered worktree paths that no longer exist on disk. */
export function staleWorktrees(cwd = process.cwd()) {
  return worktrees(cwd).filter((entry) => !existsSync(entry.path));
}

/** Refuse an already-occupied lane identity before any provider evidence is fetched. */
export function assertProvisionable({ ref, scope, device, cwd = process.cwd() }) {
  const path = lanePath(scope, device, cwd);
  const registered = worktrees(cwd).find((entry) => entry.branch === ref || entry.path === path);
  let detail = null;
  if (existsSync(path)) detail = `lane worktree already exists: ${path}`;
  else if (refExists(`refs/heads/${ref}`, cwd)) detail = `lane branch already exists: ${ref}`;
  else if (registered) detail = `lane worktree is already registered: ${registered.path}`;
  if (detail) throw Object.assign(new Error(detail), { reason: 'blocked-lane-already-exists' });
  return Object.freeze({ ref, path });
}

function directDirectory(path) {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata) return null;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw Object.assign(new Error(`worktree parent must be a direct directory: ${path}`), {
      reason: 'blocked-worktree-parent-identity',
    });
  }
  return Object.freeze({ path, dev: metadata.dev, ino: metadata.ino, mode: metadata.mode });
}

function createWorktreeParents(path, created) {
  const missing = [];
  for (let cursor = dirname(path);;) {
    if (directDirectory(cursor)) break;
    missing.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('worktree parent has no existing directory ancestor');
    cursor = parent;
  }
  for (const directory of missing.reverse()) {
    try {
      mkdirSync(directory);
      const receipt = { path: directory, creationReturned: true, observationExact: false };
      created.push(receipt);
      Object.assign(receipt, directDirectory(directory), { observationExact: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      directDirectory(directory);
    }
  }
}

function provisionArtifacts({
  ref, path, baseSha, cwd, createdParents, worktreeAddReturned,
  postconditionHead = null, postconditionBranch = null, provisionCompleted = false,
}) {
  let branchSha = null, branchObservationExact = true;
  try { branchSha = headSha(`refs/heads/${ref}`, cwd); } catch { branchObservationExact = false; }
  let registeredWorktree = null, registrationObservationExact = true;
  try { registeredWorktree = worktreeFor(ref, cwd); } catch { registrationObservationExact = false; }
  let pathIdentity = null, pathObservationExact = true;
  try {
    const metadata = lstatSync(path, { throwIfNoEntry: false });
    if (metadata) pathIdentity = Object.freeze({ path, dev: metadata.dev, ino: metadata.ino,
      mode: metadata.mode, kind: metadata.isDirectory() && !metadata.isSymbolicLink()
        ? 'directory' : metadata.isSymbolicLink() ? 'symlink' : 'other' });
  } catch { pathObservationExact = false; }
  const artifacts = {
    effectsRetained: createdParents.length > 0 || branchSha !== null
      || registeredWorktree !== null || pathIdentity !== null,
    operation: 'provision-worktree', ref, path, baseSha, worktreeAddReturned,
    provisionCompleted,
    createdParentPaths: createdParents.map((entry) => entry.path),
    createdParents: createdParents.map((entry) => Object.freeze({ ...entry })),
    branchSha, branchObservationExact,
    registeredWorktree, registrationObservationExact,
    pathExists: pathIdentity !== null, pathIdentity, pathObservationExact,
    postconditionHead, postconditionBranch,
  };
  return Object.freeze(artifacts);
}

/**
 * Request the branch-bound lane worktree from the captured protected SHA in one
 * command. A failed checkout is re-observed and retained for explicit recovery.
 */
export function provision({ ref, scope, device, baseSha, cwd = process.cwd() }) {
  if (typeof baseSha !== 'string' || !/^[0-9a-f]{40,64}$/u.test(baseSha)) {
    throw new TypeError('provision requires one captured base object ID');
  }
  const { path } = assertProvisionable({ ref, scope, device, cwd });
  const createdParents = [];
  let worktreeAddReturned = false, observed = null, branch = null;
  try {
    createWorktreeParents(path, createdParents);
    git(['worktree', 'add', '-b', ref, path, baseSha], { cwd });
    worktreeAddReturned = true;
    observed = observeGit(['rev-parse', 'HEAD'], { cwd: path });
    branch = observeGit(['branch', '--show-current'], { cwd: path });
    if (observed !== baseSha || branch !== ref) {
      throw Object.assign(new Error('provisioned worktree does not match captured base and lane ref'), {
        reason: 'blocked-provision-postcondition',
      });
    }
  } catch (cause) {
    const artifacts = provisionArtifacts({ ref, path, baseSha, cwd, createdParents,
      worktreeAddReturned, postconditionHead: observed, postconditionBranch: branch });
    throw Object.assign(new Error(
      `lane provisioning failed; recovery required; retained artifacts ${JSON.stringify(artifacts)}`,
      { cause }), {
      reason: 'blocked-provision-recovery-required', artifacts, retainedOperation: true,
      operationArtifacts: artifacts, operationError: cause, operationResult: null,
    });
  }
  const artifacts = provisionArtifacts({ ref, path, baseSha, cwd, createdParents,
    worktreeAddReturned, postconditionHead: observed, postconditionBranch: branch,
    provisionCompleted: true });
  return Object.freeze({ schema: 'agentic-os/git-provision/v1', ...artifacts });
}

/** Observed facts for the lane state machine. */
export function inspect(ref, cwd = process.cwd(), baseRef, { includeIgnored = true } = {}) {
  if (typeof baseRef !== 'string' || baseRef.length === 0)
    throw new TypeError('lane inspection requires an explicit canonical base ref');
  const entry = worktreeFor(ref, cwd);
  if (!entry) return { registered: false, path: null, untracked: [], commits: 0 };
  const path = entry.path;
  return {
    registered: true,
    path,
    untracked: untrackedPaths(path, { includeIgnored }),
    commits: observeGitLines(['rev-list', `${baseRef}..${ref}`], { cwd }).length,
  };
}

/**
 * Compatibility cleanup is intentionally unavailable. Authority retirement and
 * filesystem cleanup require the public authenticated contract and separate
 * target-specific receipts; a local integration projection cannot grant them.
 */
export function retire() {
  const error = new Error('retirement requires an authenticated authority-transition receipt');
  error.reason = 'blocked-authenticated-cleanup-required';
  throw error;
}

function writeScopeError(reason, message, detail = {}) {
  return Object.assign(new Error(message), { reason, ...detail });
}

export function parseWritePaths(value) {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError('at least one --write=<path[,path...]> reservation is required');
  const paths = [...new Set(value.split(',').map((path) => path.trim()))].sort();
  for (const path of paths) {
    const segments = path.split('/');
    if (!path || path.startsWith('/') || path.endsWith('/') || path.startsWith(':')
      || /[*?[]/u.test(path) || path.includes('\\') || path.includes('\0')
      || segments.some((part) => !part || part === '.' || part === '..'))
      throw writeScopeError('blocked-invalid-write-scope', `invalid Git write scope: ${path}`);
  }
  return paths;
}

const pathsOverlap = (left, right) => left === right
  || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const pathIsReserved = (path, reservations) => reservations.some((reservation) =>
  path === reservation || path.startsWith(`${reservation}/`));

function observedLanePaths(entry, record, protectedRef, cwd) {
  const observed = worktreeCleanupRisks(entry.path, { includeIgnored: false });
  const dirty = [...new Set([...observed.tracked, ...observed.owned, ...observed.hidden])];
  const committed = gitLines(['diff', '--name-only',
    `${record?.baseSha ?? protectedRef}...refs/heads/${entry.branch}`], { cwd, allowFail: true });
  const reserved = (record?.writePaths ?? []).flatMap((path) => parseWritePaths(path));
  return [...new Set([...reserved, ...dirty, ...committed])].sort();
}

export function assertDisjointReservation({ cwd, ref, writePaths, protectedRef, records }) {
  const active = worktrees(cwd).filter((entry) => isLaneRef(entry.branch) && entry.branch !== ref);
  if (active.length > 0 && writePaths.length === 0) throw writeScopeError(
    'blocked-write-scope-missing', 'concurrent admission requires --write=<path[,path...]>');
  for (const entry of active) {
    const occupied = observedLanePaths(entry, records[entry.branch], protectedRef, cwd);
    if (occupied.length === 0) throw writeScopeError('blocked-unproven-write-scope',
      `active lane has no declared or observable write scope: ${entry.branch}`, { ref: entry.branch });
    for (const requested of writePaths) for (const path of occupied) {
      if (pathsOverlap(requested, path)) throw writeScopeError('blocked-write-scope-overlap',
        `${ref} overlaps ${entry.branch}: ${requested} <> ${path}`,
        { ref: entry.branch, requested, occupied: path });
    }
  }
  return writePaths;
}

export function commitReservedChanges({ cwd, writePaths, message }) {
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 500)
    throw writeScopeError('blocked-invalid-commit-message', '--message must contain 1-500 characters');
  const before = worktreeCleanupRisks(cwd, { includeIgnored: false });
  const changed = [...new Set([...before.tracked, ...before.owned, ...before.hidden])].sort();
  if (changed.length === 0) return null;
  const outside = changed.filter((path) => !pathIsReserved(path, writePaths));
  if (outside.length > 0) throw writeScopeError('blocked-write-outside-reservation',
    `preserve ${outside.length} path(s) outside this lane reservation`, { paths: outside });
  git(['add', '--', ...writePaths], { cwd });
  const staged = gitLines(['diff', '--cached', '--name-only'], { cwd });
  if (staged.length === 0) throw writeScopeError('blocked-empty-commit', 'no reserved changes were staged');
  const stagedOutside = staged.filter((path) => !pathIsReserved(path, writePaths));
  if (stagedOutside.length > 0) throw writeScopeError('blocked-staged-outside-reservation',
    `index contains ${stagedOutside.length} path(s) outside this lane reservation`,
    { paths: stagedOutside });
  git(['commit', '--message', message], { cwd });
  return Object.freeze({ head: git(['rev-parse', 'HEAD'], { cwd }), paths: staged });
}
