/**
 * Thin git wrapper. Array argv only, never a shell string, so no path or scope
 * value can be interpolated into a command.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync, linkSync, mkdirSync, mkdtempSync, readlinkSync, renameSync,
  lstatSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
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
/** Verify every depended-on ref and advance one ref in a single reference transaction. */
export function atomicAdvanceRef(ref, newOid, oldOid, expectedRefs, cwd = process.cwd()) {
  const input = [
    'start',
    ...expectedRefs.map(([expectedRef, expectedOid]) => `verify ${expectedRef} ${expectedOid}`),
    `update ${ref} ${newOid} ${oldOid}`,
    'prepare', 'commit', '',
  ].join('\n');
  git(['update-ref', '--stdin'], { cwd, input });
}
/** Refuse pre-existing symlink/non-directory parents; exclusivity covers swaps after this check. */
export function assertDirectoryAncestors(path, cwd = process.cwd(), { allowMissing = false } = {}) {
  const parts = path.split('/').slice(0, -1);
  let cursor = cwd;
  for (const part of parts) {
    cursor = join(cursor, part);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      const error = new Error(`unsafe directory ancestor for ${path}: ${cursor}`);
      error.reason = 'blocked-directory-ancestor';
      throw error;
    }
  }
}
/** Atomically move exact worktree paths into same-filesystem Git-private storage. */
export function quarantineWorktreeEntries(
  name, entries, verify, cwd = process.cwd(), manifest = null,
) {
  entries.forEach((entry) => assertDirectoryAncestors(entry.path, cwd));
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
    if (manifest !== null) {
      writeFileSync(join(path, 'manifest.json'), manifest, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    error.quarantinePath = path;
    throw error;
  }
  return {
    path,
    moved,
    manifestPath: manifest === null ? null : join(path, 'manifest.json'),
    verify: () => moved.forEach(({ entry, slot }) => checked(entry, slot)),
  };
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
      assertDirectoryAncestors(entry.path, cwd, { allowMissing: true });
      mkdirSync(dirname(target), { recursive: true });
      assertDirectoryAncestors(entry.path, cwd);
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
/** Exact configured remote name, safe as a positional Git argument. */
export function configuredRemote(remote, cwd = process.cwd()) {
  if (typeof remote !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(remote)
    || !gitLines(['remote'], { cwd }).includes(remote))
    throw Object.assign(new Error(`configured Git remote is unavailable: ${String(remote)}`),
      { reason: 'blocked-configured-remote' });
  return remote;
}
/** One captured transport; hidden push URLs and ambiguous URL sets fail closed. */
export function remoteTransport(remote, cwd = process.cwd()) {
  const name = configuredRemote(remote, cwd);
  const fetchUrls = gitLines(['remote', 'get-url', '--all', name], { cwd });
  const pushUrls = gitLines(['remote', 'get-url', '--push', '--all', name], { cwd });
  if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0])
    throw Object.assign(new Error(`Git remote transport is ambiguous: ${name}`),
      { reason: 'blocked-remote-transport-identity' });
  return Object.freeze({ name, fetchUrl: fetchUrls[0], pushUrl: pushUrls[0] });
}
function transportRace(message) {
  return Object.assign(new Error(message), { reason: 'blocked-remote-transport-race' });
}
function capturedTransport(remote, cwd, expectedUrl) {
  const transport = remoteTransport(remote, cwd);
  if (expectedUrl !== null && transport.fetchUrl !== expectedUrl)
    throw transportRace('Git remote changed before the captured operation');
  return transport;
}
/** Exact SHA currently advertised for one remote branch, or null. */
export function remoteRefSha(remote, ref, cwd = process.cwd(), expectedUrl = null) {
  const transport = capturedTransport(remote, cwd, expectedUrl);
  const output = git(['ls-remote', '--refs', '--', transport.fetchUrl,
    `refs/heads/${ref}`], { cwd, allowFail: true });
  if (remoteTransport(remote, cwd).fetchUrl !== transport.fetchUrl)
    throw transportRace('Git remote changed during observation');
  if (!output) return null;
  const [sha, advertised] = output.split(/\s+/u);
  return advertised === `refs/heads/${ref}` ? sha : null;
}
/** Create one remote ref at one captured OID; refuse if the ref already exists. */
export function publishExactNewRef(remote, ref, oid, cwd = process.cwd(), expectedUrl = null) {
  const transport = capturedTransport(remote, cwd, expectedUrl);
  const remoteRef = `refs/heads/${ref}`;
  git([
    'push',
    `--force-with-lease=${remoteRef}:`,
    '--',
    transport.fetchUrl,
    `${oid}:${remoteRef}`,
  ], { cwd });
  if (remoteTransport(remote, cwd).fetchUrl !== transport.fetchUrl)
    throw transportRace('Git remote changed during publication');
  const advertised = git(['ls-remote', '--refs', '--', transport.fetchUrl, remoteRef], { cwd });
  if (advertised.split(/\s+/u)[0] !== oid)
    throw Object.assign(new Error('published Git ref does not advertise the captured OID'),
      { reason: 'blocked-remote-publication-proof' });
  return Object.freeze({ remote: transport.name, remoteRef, oid, url: transport.fetchUrl });
}
export function refExists(ref, cwd = process.cwd()) {
  return git(['rev-parse', '--verify', '--quiet', ref], { cwd, allowFail: true }) !== null;
}
/** Tracked, staged, or unmerged changes. Untracked files are reported separately. */
export function dirtyTracked(cwd = process.cwd()) {
  return gitLines(['status', '--porcelain=v1', '--untracked-files=no'], { cwd }).length > 0;
}
/** Strict UTF-8 decode for NUL-delimited Git path output. */
export function decodeNulFields(value) {
  if (!Buffer.isBuffer(value)) return null;
  const paths = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) continue;
    const bytes = value.subarray(start, index);
    start = index + 1;
    if (bytes.length === 0) continue;
    const path = bytes.toString('utf8');
    if (!Buffer.from(path, 'utf8').equals(bytes)) return null;
    paths.push(path);
  }
  return start === value.length ? paths : null;
}
function strictGitPaths(args, cwd) {
  const paths = decodeNulFields(git(args, { cwd, binary: true, allowFail: true }));
  if (paths) return paths;
  const error = new Error('Git path inventory is non-UTF-8, truncated, or unavailable');
  error.reason = 'blocked-invalid-path-inventory';
  throw error;
}
/** Owned paths outside HEAD/index, including ignored files. Never delete them. */
export function untrackedPaths(cwd = process.cwd()) {
  const visible = strictGitPaths(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  const ignored = strictGitPaths(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
    cwd,
  );
  return [...new Set([...visible, ...ignored])].sort((left, right) => left.localeCompare(right));
}
/** Conservative exact-byte risks that make worktree removal ineligible. */
export function worktreeCleanupRisks(cwd = process.cwd()) {
  const hidden = strictGitPaths(['ls-files', '-v', '-z'], cwd).filter((record) => {
    const tag = record[0];
    return tag >= 'a' && tag <= 'z' || tag?.toUpperCase() === 'S';
  }).map((record) => record.slice(2));
  const tracked = [];
  for (const record of strictGitPaths(['ls-tree', '-r', '-z', 'HEAD'], cwd)) {
    const tab = record.indexOf('\t');
    if (tab < 0) {
      tracked.push('[malformed-tree-entry]');
      continue;
    }
    const [mode, , oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    const absolute = join(cwd, path);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (mode === '160000') {
      if (!stat) continue;
      if (!stat.isDirectory()) {
        tracked.push(path);
        continue;
      }
      const submoduleHead = git(['rev-parse', '--verify', 'HEAD'], {
        cwd: absolute,
        allowFail: true,
      });
      if (!submoduleHead) {
        if (readdirSync(absolute).length > 0) tracked.push(path);
        continue;
      }
      const nested = worktreeCleanupRisks(absolute);
      if (submoduleHead !== oid || nested.dirtyTracked || nested.hidden.length > 0
          || nested.owned.length > 0 || nested.tracked.length > 0) tracked.push(path);
      continue;
    }
    if (!stat) {
      tracked.push(path);
      continue;
    }
    let observedMode;
    let bytes;
    if (stat.isSymbolicLink()) {
      observedMode = '120000';
      bytes = readlinkSync(absolute, { encoding: 'buffer' });
    } else if (stat.isFile()) {
      observedMode = stat.mode & 0o111 ? '100755' : '100644';
      bytes = readFileSync(absolute);
    } else {
      tracked.push(path);
      continue;
    }
    const observedOid = git(['hash-object', '--stdin'], { cwd, input: bytes });
    if (observedMode !== mode || observedOid !== oid) tracked.push(path);
  }
  return {
    dirtyTracked: dirtyTracked(cwd),
    hidden,
    owned: untrackedPaths(cwd),
    tracked,
  };
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

export function fetch(remote = 'origin', cwd = process.cwd(), expectedUrl = null) {
  // Remote-tracking-ref pruning is a separately governed cleanup effect.
  const transport = capturedTransport(remote, cwd, expectedUrl);
  git(['fetch', '--no-tags', '--', transport.fetchUrl,
    `+refs/heads/*:refs/remotes/${transport.name}/*`], { cwd });
  const after = remoteTransport(remote, cwd);
  if (after.fetchUrl !== transport.fetchUrl)
    throw transportRace('Git remote changed during fetch');
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
