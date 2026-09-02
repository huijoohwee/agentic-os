/** Sanitized Git execution plus exact tracked-byte observation. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
export class GitError extends Error {
  constructor(args, status, stderr) {
    const safeArgs = args.map(redactGitArgument), safeStderr = redactGitText(stderr);
    super(`git ${safeArgs.join(' ')} failed (${status}): ${safeStderr.trim()}`);
    Object.assign(this, { name: 'GitError', args: safeArgs, status, stderr: safeStderr });
  }
}
const TRANSPORT_ARGUMENT = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|(?:[^@\s/:]+@)?[A-Za-z0-9.-]+:)[^\s'"]*/u;
const TRANSPORT_TEXT = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|(?:[^@\s/:]+@)?[A-Za-z0-9.-]+:)[^\s'"]*/gu;
function redactGitArgument(value) {
  const text = String(value);
  return TRANSPORT_ARGUMENT.test(text) ? '[redacted-transport]' : text;
}
function redactGitText(value) { return String(value).replace(TRANSPORT_TEXT, '[redacted-transport]'); }

const OBSERVATION_CONFIG = Object.freeze([
  ['core.fsmonitor', 'false'], ['core.untrackedCache', 'false'], ['diff.external', ''],
]);
const MUTATION_GIT_ENV_ALLOWLIST = new Set([
  'GIT_ASKPASS', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_TERMINAL_PROMPT',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
]);

function inheritedEnvironment({ preserveGit = false, preserveGlobalConfig = false } = {}) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (!upper.startsWith('GIT_') || preserveGit && MUTATION_GIT_ENV_ALLOWLIST.has(upper)
      || preserveGlobalConfig && upper === 'GIT_CONFIG_GLOBAL')
      environment[key] = value;
  }
  return environment;
}
function mutationEnvironment(extra = null, { preserveGlobalConfig = false } = {}) {
  const environment = { ...inheritedEnvironment({ preserveGit: true, preserveGlobalConfig }), ...(extra ?? {}) };
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  for (const key of Object.keys(environment)) {
    const upper = key.toUpperCase();
    if (/^GIT_TRACE/u.test(upper) || upper === 'GIT_REDIRECT_STDERR') delete environment[key];
  }
  return environment;
}
function observationEnvironment(extra = null) {
  const environment = { ...inheritedEnvironment(), ...(extra ?? {}) };
  for (const key of Object.keys(environment))
    if (key.toUpperCase().startsWith('GIT_')) delete environment[key];
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_NO_LAZY_FETCH = '1';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_CONFIG_COUNT = String(OBSERVATION_CONFIG.length);
  OBSERVATION_CONFIG.forEach(([key, value], index) => {
    environment[`GIT_CONFIG_KEY_${index}`] = key;
    environment[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return environment;
}
/** Execute a Git mutation with inherited repository redirection removed. */
export function git(args, { cwd = process.cwd(), allowFail = false, input, env,
  raw = false, binary = false, maxBuffer = 64 * 1024 * 1024, replaceEnv = false,
  preserveGlobalConfig = false } = {}) {
  try {
    const output = execFileSync('git', args, {
      cwd, input, env: replaceEnv ? env : mutationEnvironment(env, { preserveGlobalConfig }),
      encoding: binary ? undefined : 'utf8',
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      maxBuffer,
    });
    return binary || raw ? output : output.trim();
  } catch (error) {
    if (allowFail) return null;
    throw new GitError(args, error.status ?? -1, String(error.stderr ?? error.message));
  }
}
/** Local Git observation with optional writes, lazy fetches, replacements, and code disabled. */
export function observeGit(args, options = {}) {
  const safeArgs = args[0] === 'diff'
    ? ['diff', '--no-ext-diff', '--no-textconv', ...args.slice(1)] : args;
  return git(safeArgs, { ...options, env: observationEnvironment(options.env), replaceEnv: true });
}
function outputLines(result) {
  return result === null || result === '' ? [] : result.split('\n').filter((line) => line !== '');
}
export function gitLines(args, options = {}) { return outputLines(observeGit(args, options)); }
export function observeGitLines(args, options = {}) {
  return outputLines(observeGit(args, options));
}
export const TRACKED_FILE_LIMITS = Object.freeze({ rawComparisonBytes: 32 * 1024 * 1024 });
const FILTER_COMPARE = fileURLToPath(new URL('../bin/agentic-os-filter-compare.mjs', import.meta.url));

export function gitBlobOid(bytes, expectedOid) {
  if (!Buffer.isBuffer(bytes) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(expectedOid ?? ''))
    throw new TypeError('raw Git blob comparison requires bytes and a full object ID');
  const hash = createHash(expectedOid.length === 40 ? 'sha1' : 'sha256');
  hash.update(`blob ${bytes.length}\0`); hash.update(bytes);
  return hash.digest('hex');
}

function sameRawNode(left, right) {
  return Boolean(right) && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function childEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('GIT_') || upper === 'NODE_OPTIONS' || upper === 'NODE_PATH')
      delete environment[key];
  }
  return environment;
}
export function rawTrackedFileMatches({ absolute, path, oid, mode, before, cwd }) {
  let source = null;
  try {
    try {
      source = openSync(absolute, constants.O_RDONLY | constants.O_NONBLOCK
        | (constants.O_NOFOLLOW ?? 0));
    } catch { return false; }
    const opened = fstatSync(source, { bigint: true });
    if (!opened.isFile() || !sameRawNode(before, opened)
      || opened.size > BigInt(TRACKED_FILE_LIMITS.rawComparisonBytes)) return false;
    const compared = spawnSync(process.execPath, [
      FILTER_COMPARE, path, oid, String(TRACKED_FILE_LIMITS.rawComparisonBytes),
    ], { cwd, env: childEnvironment(), stdio: ['ignore', 'ignore', 'ignore', source],
      timeout: 7_000, killSignal: 'SIGKILL' });
    const matches = compared.status === 0 && compared.signal === null && !compared.error;
    const afterOpen = fstatSync(source, { bigint: true });
    const afterPath = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    const observedMode = afterOpen.mode & 0o111n ? '100755' : '100644';
    return matches && observedMode === mode && sameRawNode(opened, afterOpen)
      && sameRawNode(afterOpen, afterPath);
  } finally { if (source !== null) closeSync(source); }
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
  const paths = decodeNulFields(observeGit(args, { cwd, binary: true, allowFail: true }));
  if (paths) return paths;
  const error = new Error('Git path inventory is non-UTF-8, truncated, or unavailable');
  error.reason = 'blocked-invalid-path-inventory';
  throw error;
}

/** Owned paths outside HEAD/index. Deep cleanup inventory includes ignored files by default. */
export function untrackedPaths(cwd = process.cwd(), { includeIgnored = true } = {}) {
  const visible = strictGitPaths(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  if (!includeIgnored) return visible;
  const ignored = strictGitPaths(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], cwd,
  );
  return [...new Set([...visible, ...ignored])].sort((left, right) => left.localeCompare(right));
}

function sameTrackedNode(left, right) {
  return Boolean(right) && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function worktreeMode(stat) {
  if (!stat) return '000000';
  if (stat.isSymbolicLink()) return '120000';
  if (stat.isFile()) return stat.mode & 0o111n ? '100755' : '100644';
  if (stat.isDirectory()) return '160000';
  return '000000';
}

function trackedEntryMatches({ mode, oid, path }, cwd, includeIgnored) {
  const absolute = join(cwd, path);
  const stat = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (mode === '160000') {
    if (!stat) return true;
    if (!stat.isDirectory()) return false;
    const submoduleHead = observeGit(['rev-parse', '--verify', 'HEAD'], {
      cwd: absolute, allowFail: true,
    });
    if (!submoduleHead) return readdirSync(absolute).length === 0;
    const nested = worktreeCleanupRisks(absolute, { includeIgnored });
    return submoduleHead === oid && !nested.dirtyTracked && nested.hidden.length === 0
      && nested.owned.length === 0 && nested.tracked.length === 0;
  }
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    const bytes = readlinkSync(absolute, { encoding: 'buffer' });
    const after = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    return mode === '120000' && gitBlobOid(bytes, oid) === oid && sameTrackedNode(stat, after);
  }
  if (!stat.isFile()) return false;
  return rawTrackedFileMatches({ absolute, path, oid, mode, before: stat, cwd });
}

function parseIndexEntries(cwd) {
  const entries = [];
  for (const record of strictGitPaths(['ls-files', '--stage', '-z'], cwd)) {
    const tab = record.indexOf('\t');
    const match = tab < 0 ? null
      : record.slice(0, tab).match(/^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-3])$/u);
    if (!match) {
      const error = new Error('Git index inventory is malformed');
      error.reason = 'blocked-invalid-path-inventory';
      throw error;
    }
    entries.push({ mode: match[1], oid: match[2], stage: Number(match[3]),
      path: record.slice(tab + 1) });
  }
  return entries;
}

function parseRawDiff(cwd, args, label) {
  const fields = decodeNulFields(observeGit(args, {
    cwd, binary: true, allowFail: true,
  }));
  if (!fields || fields.length % 2 !== 0) {
    const error = new Error(`Git ${label} projection is unavailable`);
    error.reason = 'blocked-invalid-path-inventory';
    throw error;
  }
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = fields[index].match(
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/u,
    );
    if (!match) {
      const error = new Error(`Git ${label} projection is malformed`);
      error.reason = 'blocked-invalid-path-inventory';
      throw error;
    }
    entries.push({ path: fields[index + 1], status: match[5], oldMode: match[1],
      newMode: match[2], oldObject: match[3], newObject: match[4] });
  }
  return entries;
}

function headToIndexChanges(cwd) {
  return parseRawDiff(cwd, [
    'diff', '--cached', '--raw', '-z', '--no-renames', '--abbrev=64',
    '--ita-visible-in-index', 'HEAD', '--',
  ], 'HEAD-to-index');
}

function shallowIndexToWorkingTree(entries, cwd) {
  const changes = [];
  const unmerged = new Set(entries.filter(({ stage }) => stage !== 0).map(({ path }) => path));
  for (const path of [...unmerged].sort()) {
    const entry = entries.find((candidate) => candidate.path === path);
    changes.push({ path, status: 'U', oldMode: entry.mode, newMode: '000000',
      oldObject: entry.oid, newObject: '0'.repeat(entry.oid.length) });
  }
  for (const entry of entries) {
    if (entry.stage !== 0) continue;
    const stat = lstatSync(join(cwd, entry.path), { bigint: true, throwIfNoEntry: false });
    const newMode = worktreeMode(stat);
    if (stat && newMode === entry.mode) continue;
    const sameType = entry.mode.startsWith('100') && newMode.startsWith('100');
    changes.push({ path: entry.path, status: !stat ? 'D' : sameType ? 'M' : 'T',
      oldMode: entry.mode, newMode, oldObject: entry.oid,
      newObject: '0'.repeat(entry.oid.length) });
  }
  return changes;
}

/** Fast no-code structural projection. Content identity is explicitly deferred. */
export function shallowTrackedChanges(cwd = process.cwd()) {
  const entries = parseIndexEntries(cwd);
  return { headToIndex: headToIndexChanges(cwd),
    indexToWorkingTree: shallowIndexToWorkingTree(entries, cwd) };
}

/** Raw local tracked projections that never execute checkout filters or refresh the index. */
export function trackedChanges(cwd = process.cwd()) {
  const indexToWorkingTree = [];
  const entries = parseIndexEntries(cwd);
  const headToIndex = headToIndexChanges(cwd);
  const unmerged = new Set(entries.filter(({ stage }) => stage !== 0).map(({ path }) => path));
  for (const path of [...unmerged].sort()) {
    const entry = entries.find((candidate) => candidate.path === path);
    const zero = '0'.repeat(entry.oid.length);
    indexToWorkingTree.push({ path, status: 'U', oldMode: entry.mode, newMode: '000000',
      oldObject: entry.oid, newObject: zero });
  }
  for (const entry of entries) {
    if (entry.stage !== 0 || trackedEntryMatches(entry, cwd, false)) continue;
    const stat = lstatSync(join(cwd, entry.path), { bigint: true, throwIfNoEntry: false });
    const newMode = worktreeMode(stat);
    const status = !stat ? 'D' : newMode !== entry.mode ? 'T' : 'M';
    indexToWorkingTree.push({ path: entry.path, status, oldMode: entry.mode, newMode,
      oldObject: entry.oid, newObject: '0'.repeat(entry.oid.length) });
  }
  return { headToIndex, indexToWorkingTree };
}

export function dirtyTracked(cwd = process.cwd()) { const changes = trackedChanges(cwd);
  return changes.headToIndex.length > 0 || changes.indexToWorkingTree.length > 0; }

function hiddenIndexPaths(cwd) {
  return strictGitPaths(['ls-files', '-v', '-z'], cwd).filter((record) => record[0] >= 'a'
    && record[0] <= 'z' || record[0]?.toUpperCase() === 'S').map((record) => record.slice(2));
}
/** Conservative exact-byte risks; publication can skip ignored-only ownership enumeration. */
export function worktreeCleanupRisks(cwd = process.cwd(), { includeIgnored = true } = {}) {
  const headToIndex = headToIndexChanges(cwd);
  const hidden = hiddenIndexPaths(cwd);
  const tracked = [];
  for (const record of strictGitPaths(['ls-tree', '-r', '-z', 'HEAD'], cwd)) {
    const tab = record.indexOf('\t');
    if (tab < 0) { tracked.push('[malformed-tree-entry]'); continue; }
    const [mode, , oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (!trackedEntryMatches({ mode, oid, path }, cwd, includeIgnored)) tracked.push(path);
  }
  const owned = untrackedPaths(cwd, { includeIgnored });
  const headToIndexAfter = headToIndexChanges(cwd), hiddenAfter = hiddenIndexPaths(cwd);
  if (JSON.stringify(headToIndexAfter) !== JSON.stringify(headToIndex)
    || JSON.stringify(hiddenAfter) !== JSON.stringify(hidden)) {
    const error = new Error('Git index projection moved during exact byte observation');
    error.reason = 'blocked-repository-observation-race';
    throw error;
  }
  return { dirtyTracked: headToIndex.length > 0 || tracked.length > 0, hidden, owned, tracked };
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
function invalidWorktreeInventory(detail) {
  return Object.assign(new Error(`invalid Git worktree inventory: ${detail}`), {
    reason: 'blocked-invalid-worktree-inventory',
  });
}

/** Strict parser for Git's NUL-delimited worktree porcelain format. */
export function parseWorktreeList(raw, { detailed = false } = {}) {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.at(-1) !== 0)
    throw invalidWorktreeInventory('output is not NUL-terminated');
  let text;
  try { text = UTF8.decode(raw); } catch { throw invalidWorktreeInventory('output is not UTF-8'); }
  const fields = text.slice(0, -1).split('\0').filter((field) => field !== '');
  const entries = [];
  let current = null;
  const finish = () => {
    if (!current || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(current.head ?? '')
      || Number(current.branch !== null) + Number(current.detached) + Number(current.bare) !== 1)
      throw invalidWorktreeInventory('record identity is incomplete or conflicting');
    entries.push(detailed ? { ...current }
      : { path: current.path, branch: current.branch, detached: current.detached });
  };
  for (const field of fields) {
    if (field.startsWith('worktree ')) {
      if (current) finish();
      const path = field.slice('worktree '.length);
      if (!path || entries.some((entry) => entry.path === path))
        throw invalidWorktreeInventory('duplicate path');
      current = { path, head: null, branch: null, detached: false, bare: false,
        locked: false, prunable: false };
    } else if (!current) throw invalidWorktreeInventory('field precedes worktree path');
    else if (field.startsWith('HEAD ') && current.head === null)
      current.head = field.slice('HEAD '.length);
    else if (field.startsWith('branch refs/heads/') && current.branch === null)
      current.branch = field.slice('branch refs/heads/'.length);
    else if (field === 'detached' && !current.detached) current.detached = true;
    else if (field === 'bare' && !current.bare) current.bare = true;
    else if (field === 'locked' || field.startsWith('locked ')) {
      if (current.locked) throw invalidWorktreeInventory('duplicate locked field');
      current.locked = true;
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      if (current.prunable) throw invalidWorktreeInventory('duplicate prunable field');
      current.prunable = true;
    } else throw invalidWorktreeInventory(`unsupported or duplicate field ${field.split(' ')[0]}`);
  }
  if (current) finish();
  if (entries.length === 0 || new Set(entries.map((entry) => entry.branch)
    .filter(Boolean)).size !== entries.filter((entry) => entry.branch).length)
    throw invalidWorktreeInventory('empty inventory or duplicate branch');
  return entries;
}
