/**
 * Lane worktree lifecycle: provision, inspect, retire.
 *
 * A lane worktree is created detached at fetched `origin/main`, then bound to
 * exactly one lane branch. Worktrees live outside the repository tree so a lane
 * never appears as untracked state in another lane.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { git, gitLines, repoRoot, worktrees, refExists, untrackedPaths } from './git.mjs';
import { laneDirName } from './lane-id.mjs';

export const PROTECTED_BRANCH = 'main';
export const PROTECTED_REF = 'origin/main';

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
  return gitLines(['for-each-ref', '--format=%(refname:short)', 'refs/heads/agent'], { cwd });
}

/** The registered worktree bound to a lane ref, or null. */
export function worktreeFor(ref, cwd = process.cwd()) {
  return worktrees(cwd).find((entry) => entry.branch === ref) ?? null;
}

/** Registered worktree paths that no longer exist on disk. */
export function staleWorktrees(cwd = process.cwd()) {
  return worktrees(cwd).filter((entry) => !existsSync(entry.path));
}

/**
 * Create the lane worktree and bind the branch in one step.
 * Detach at the fetched protected ref first so the lane never inherits local
 * `main`, which may be behind or dirty.
 */
export function provision({ ref, scope, device, cwd = process.cwd() }) {
  const path = lanePath(scope, device, cwd);
  if (existsSync(path)) throw new Error(`lane worktree already exists: ${path}`);
  if (refExists(`refs/heads/${ref}`, cwd)) throw new Error(`lane branch already exists: ${ref}`);
  mkdirSync(dirname(path), { recursive: true });
  git(['worktree', 'add', '--detach', path, PROTECTED_REF], { cwd });
  git(['switch', '--create', ref], { cwd: path });
  return { path, ref, baseSha: git(['rev-parse', PROTECTED_REF], { cwd }) };
}

/** Observed facts for the lane state machine. */
export function inspect(ref, cwd = process.cwd()) {
  const entry = worktreeFor(ref, cwd);
  if (!entry) return { registered: false, path: null, untracked: [], commits: 0 };
  const path = entry.path;
  return {
    registered: true,
    path,
    untracked: untrackedPaths(path),
    commits: gitLines(['rev-list', `${PROTECTED_REF}..${ref}`], { cwd }).length,
  };
}

/**
 * Retire a lane. Callers must already hold an integration proof; this function
 * performs no proof of its own and refuses only on owned untracked state.
 */
export function retire(ref, { cwd = process.cwd(), deleteBranch = true } = {}) {
  const entry = worktreeFor(ref, cwd);
  const removed = [];
  if (entry) {
    const owned = untrackedPaths(entry.path);
    if (owned.length > 0) {
      const error = new Error(`lane ${ref} has ${owned.length} owned untracked path(s)`);
      error.reason = 'blocked-owned-untracked';
      error.paths = owned;
      throw error;
    }
    git(['worktree', 'remove', entry.path], { cwd });
    removed.push(entry.path);
  }
  git(['worktree', 'prune'], { cwd });
  if (deleteBranch && refExists(`refs/heads/${ref}`, cwd)) {
    git(['branch', '--delete', '--force', ref], { cwd });
    removed.push(`refs/heads/${ref}`);
  }
  return removed;
}

/** Remove registrations whose directory is gone. Never touches real directories. */
export function pruneStale(cwd = process.cwd()) {
  const stale = staleWorktrees(cwd).map((entry) => entry.path);
  git(['worktree', 'prune'], { cwd });
  return stale;
}

/** Delete an abandoned empty lane directory that git no longer tracks. */
export function removeEmptyDir(path) {
  if (existsSync(path)) rmSync(path, { recursive: false });
}
