/**
 * Thin git wrapper. Array argv only, never a shell string, so no path or scope
 * value can be interpolated into a command.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync, linkSync, mkdirSync, mkdtempSync, readlinkSync, renameSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

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

/** Serialize cooperating operations in a clone. A null result means another holder exists. */
export function acquireOperationLock(name, cwd = process.cwd()) {
  const path = join(commonDir(cwd), `${name}.lock`);
  try { mkdirSync(path); } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
  return path;
}

/** Verify a peer ref and advance another ref in one lock/prepare/commit transaction. */
export function atomicAdvanceRef(ref, newOid, oldOid, peerRef, peerOid, cwd = process.cwd()) {
  const input = [
    'start', `verify ${peerRef} ${peerOid}`, `update ${ref} ${newOid} ${oldOid}`,
    'prepare', 'commit', '',
  ].join('\n');
  git(['update-ref', '--stdin'], { cwd, input });
}

/** Atomically move exact worktree paths into same-filesystem Git-private storage. */
export function quarantineWorktreeEntries(name, entries, verify, cwd = process.cwd()) {
  const path = mkdtempSync(join(commonDir(cwd), `${name}-`));
  const moved = [];
  const checked = (entry, slot) => {
    try { verify(entry, slot, path); } catch (error) {
      error.quarantinePath = path;
      throw error;
    }
  };
  try {
    for (const entry of entries) {
      const slot = String(moved.length);
      renameSync(join(cwd, entry.path), join(path, slot));
      moved.push({ entry, path: entry.path, slot });
      checked(entry, slot);
    }
  } catch (error) {
    error.quarantinePath = path;
    throw error;
  }
  return { path, moved, verify: () => moved.forEach(({ entry, slot }) => checked(entry, slot)) };
}

/** Expand dirty inventory to every current tracked/nonignored path without changing bytes. */
export function worktreePreservationEntries(baseEntries, inventory) {
  const dirty = new Map(inventory.map((entry) => [entry.path, entry]));
  const entries = [];
  for (const [path, prior] of baseEntries) {
    const entry = dirty.get(path);
    dirty.delete(path);
    if (entry?.kind === 'deleted') continue;
    entries.push(entry ? { path, mode: entry.mode, sha256: entry.sha256 }
      : { path, mode: prior.mode, oid: prior.oid });
  }
  for (const entry of dirty.values()) {
    if (entry.kind !== 'deleted')
      entries.push({ path: entry.path, mode: entry.mode, sha256: entry.sha256 });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/** Materialize exact Git blobs in private same-filesystem storage. */
export function stageTreeEntries(name, entries, cwd = process.cwd()) {
  const path = mkdtempSync(join(commonDir(cwd), `${name}-`));
  try {
    if (statSync(path).dev !== statSync(cwd).dev) {
      const error = new Error('staging and worktree are on different filesystems');
      error.code = 'EXDEV';
      throw error;
    }
    for (const entry of entries) {
      const target = join(path, entry.path);
      mkdirSync(dirname(target), { recursive: true });
      const bytes = git(['cat-file', 'blob', entry.oid], { cwd, binary: true });
      if (entry.mode === '120000') symlinkSync(bytes, target);
      else {
        writeFileSync(target, bytes);
        chmodSync(target, entry.mode === '100755' ? 0o755 : 0o644);
      }
    }
  } catch (error) {
    error.stagingPath = path;
    throw error;
  }
  return path;
}

/** Install staged entries without overwriting any path recreated by a concurrent writer. */
export function installStagedEntries(stagingPath, entries, cwd = process.cwd()) {
  for (const entry of entries) {
    const source = join(stagingPath, entry.path);
    const target = join(cwd, entry.path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      if (entry.mode === '120000') symlinkSync(readlinkSync(source, { encoding: 'buffer' }), target);
      else linkSync(source, target);
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
        error.reason = 'blocked-install-collision';
      error.installPath = entry.path;
      throw error;
    }
  }
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
