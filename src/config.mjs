/**
 * Repo-owned local git configuration.
 *
 * These four settings are the difference between resolving a conflict once and
 * resolving it on every restack on every device. They are native git, cost
 * nothing, and apply per clone, so every worktree in the clone shares them.
 */

import { configGet, configSet, repoRoot } from './git.mjs';

export const REQUIRED_CONFIG = Object.freeze([
  {
    key: 'rerere.enabled',
    value: 'true',
    why: 'record each conflict resolution once and replay it on every later rebase',
  },
  {
    key: 'rerere.autoupdate',
    value: 'true',
    why: 'stage the replayed resolution instead of asking again',
  },
  {
    key: 'merge.conflictStyle',
    value: 'zdiff3',
    why: 'smaller conflict regions, so fewer hunks need a decision at all',
  },
  {
    key: 'rebase.updateRefs',
    value: 'true',
    why: 'restack an entire stack in one rebase, moving every intermediate lane ref',
  },
  {
    key: 'pull.ff',
    value: 'only',
    why: 'a pull can never create a merge commit on a protected checkout',
  },
  {
    key: 'core.hooksPath',
    value: '.githooks',
    why: 'the read-only main guard travels with the repository',
  },
]);

/** Current value of every required key. */
export function inspect(cwd = process.cwd()) {
  return REQUIRED_CONFIG.map((entry) => {
    const actual = configGet(entry.key, cwd);
    return { ...entry, actual, ok: actual === entry.value };
  });
}

/** Write the missing or drifted keys. Local only; never touches global config. */
export function ensure(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const changed = [];
  for (const entry of inspect(root)) {
    if (entry.ok) continue;
    configSet(entry.key, entry.value, root);
    changed.push({ key: entry.key, from: entry.actual, to: entry.value });
  }
  return changed;
}
