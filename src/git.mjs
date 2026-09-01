/**
 * Thin git wrapper. Array argv only, never a shell string, so no path or scope
 * value can be interpolated into a command.
 */

import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  constructor(args, status, stderr) {
    super(`git ${args.join(' ')} failed (${status}): ${stderr.trim()}`);
    this.name = 'GitError';
    this.args = args;
    this.status = status;
    this.stderr = stderr;
  }
}

/** Run git and return stdout. Trim human-oriented output unless `raw` is requested. */
export function git(
  args,
  { cwd = process.cwd(), allowFail = false, input, env, raw = false, binary = false } = {},
) {
  try {
    const output = execFileSync('git', args, {
      cwd,
      input,
      env: env ? { ...process.env, ...env } : process.env,
      encoding: binary ? undefined : 'utf8',
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return binary || raw ? output : output.trim();
  } catch (error) {
    if (allowFail) return null;
    throw new GitError(args, error.status ?? -1, String(error.stderr ?? error.message));
  }
}

/** Non-empty stdout lines. */
export function gitLines(args, options = {}) {
  const out = git(args, options);
  if (out === null || out === '') return [];
  return out.split('\n').filter((line) => line !== '');
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd });
}

/** Shared across every worktree of one clone. rerere's cache lives here. */
export function commonDir(cwd = process.cwd()) {
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
}

export function currentBranch(cwd = process.cwd()) {
  const name = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, allowFail: true });
  return name || null;
}

export function headSha(ref = 'HEAD', cwd = process.cwd()) {
  return git(['rev-parse', '--verify', ref], { cwd, allowFail: true });
}

export function refExists(ref, cwd = process.cwd()) {
  return git(['rev-parse', '--verify', '--quiet', ref], { cwd, allowFail: true }) !== null;
}

/** Tracked, staged, or unmerged changes. Untracked files are reported separately. */
export function dirtyTracked(cwd = process.cwd()) {
  return gitLines(['status', '--porcelain=v1', '--untracked-files=no'], { cwd }).length > 0;
}

/** Owned untracked authored state. Never deleted, never relocated. */
export function untrackedPaths(cwd = process.cwd()) {
  return gitLines(['ls-files', '--others', '--exclude-standard'], { cwd });
}

export function isAncestor(maybeAncestor, descendant, cwd = process.cwd()) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', maybeAncestor, descendant], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function fetch(remote = 'origin', cwd = process.cwd()) {
  git(['fetch', '--prune', remote], { cwd });
}

export function worktrees(cwd = process.cwd()) {
  const out = git(['worktree', 'list', '--porcelain'], { cwd });
  const entries = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, detached: false };
      entries.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === 'detached' && current) {
      current.detached = true;
    }
  }
  return entries;
}

/** Commits on `ref` that are not on `base`, oldest first. */
export function commitsAhead(base, ref, cwd = process.cwd()) {
  return gitLines(['rev-list', '--reverse', `${base}..${ref}`], { cwd });
}

export function configGet(key, cwd = process.cwd()) {
  return git(['config', '--get', key], { cwd, allowFail: true });
}

export function configSet(key, value, cwd = process.cwd()) {
  git(['config', key, value], { cwd });
}
