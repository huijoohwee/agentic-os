/**
 * Lane worktree lifecycle: provision, inspect, retire.
 *
 * A lane worktree is created detached at one captured fetched canonical SHA, then bound to
 * exactly one lane branch. Worktrees live outside the repository tree so a lane
 * never appears as untracked state in another lane.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  git,
  gitLines,
  repoRoot,
  worktrees,
  refExists,
  untrackedPaths,
} from './git.mjs';
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
export function provision({ ref, scope, device, baseSha, cwd = process.cwd() }) {
  if (typeof baseSha !== 'string' || !/^[0-9a-f]{40,64}$/u.test(baseSha)) {
    throw new TypeError('provision requires one captured base object ID');
  }
  const path = lanePath(scope, device, cwd);
  if (existsSync(path)) throw new Error(`lane worktree already exists: ${path}`);
  if (refExists(`refs/heads/${ref}`, cwd)) throw new Error(`lane branch already exists: ${ref}`);
  mkdirSync(dirname(path), { recursive: true });
  git(['worktree', 'add', '--detach', path, baseSha], { cwd });
  git(['switch', '--create', ref], { cwd: path });
  const observed = git(['rev-parse', 'HEAD'], { cwd: path });
  if (observed !== baseSha) throw new Error('provisioned worktree does not match captured base');
  return { path, ref, baseSha };
}

/** Observed facts for the lane state machine. */
export function inspect(ref, cwd = process.cwd(), baseRef = PROTECTED_REF) {
  const entry = worktreeFor(ref, cwd);
  if (!entry) return { registered: false, path: null, untracked: [], commits: 0 };
  const path = entry.path;
  return {
    registered: true,
    path,
    untracked: untrackedPaths(path),
    commits: gitLines(['rev-list', `${baseRef}..${ref}`], { cwd }).length,
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
