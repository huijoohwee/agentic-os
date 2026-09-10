/** Opt-in, Git-backed memory retrieval. Source records never grant execution authority. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { acquireOperationLock, commonDir, finishOperationLock, git, observeGit,
  remoteTransport, repoRoot, worktrees } from '../src/git.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { assertPathIdentity, pathIdentity, unlinkExactPath,
  writePrivateFileExclusive } from '../src/file-integrity.mjs';

const CONFIG = '.agentic-os-memory.json';
const LIMIT = Object.freeze({ config: 4096, tree: 65536, shard: 65536,
  total: 262144, cache: 480000, shards: 32, entries: 512, fetchMs: 15000 });
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(`blocked-memory-${reason}`); };
const read = (cwd, args, maxBuffer = LIMIT.tree) => observeGit(args, { cwd, maxBuffer });
const blob = (cwd, oid, cap) => observeGit(['cat-file', 'blob', oid], { cwd, binary: true, maxBuffer: cap });
function tree(cwd, revision, path) {
  const raw = observeGit(['ls-tree', '-z', revision, '--', ...(path ? [path] : [])], { cwd, raw: true, maxBuffer: LIMIT.tree });
  return raw.split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d{6}) (blob|tree|commit) ([a-f0-9]+)\t(.+)$/u);
    if (!match || !SHA.test(match[3])) fail('tree-invalid');
    return { mode: match[1], kind: match[2], blob: match[3], path: match[4] };
  });
}
function configuration(root, revision) {
  const item = tree(root, revision, CONFIG)[0];
  if (!item) return null;
  if (item.mode !== '100644' || item.path !== CONFIG) fail('config-file');
  return JSON.parse(decode(blob(root, item.blob, LIMIT.config)));
}
export function validateSource(config, root) {
  if (!config || typeof config.remote !== 'string' || /[\s\x00-\x1f]/u.test(config.remote)
    || !(config.remote.startsWith('https://') || config.remote.startsWith('ssh://') || isAbsolute(config.remote))
    || typeof config.branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(config.branch))
    fail('source-invalid');
  if (config.remote.includes('://')) {
    const url = new URL(config.remote);
    if (url.password || url.search || url.hash || url.protocol === 'https:' && url.username) fail('remote-credentials');
  }
  read(root, ['check-ref-format', `refs/heads/${config.branch}`]);
}
function memoryConfiguration(config, root) {
  if (!config || Object.keys(config).sort().join(',') !== 'branch,directory,remote,schema'
    || config.schema !== 'agentic-os/memory-source/v1'
    || typeof config.directory !== 'string' || config.directory.length > 128
    || !config.directory.split('/').every(part => /^\.?[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(part)))
    fail('config-invalid');
  validateSource(config, root);
  return { schema: config.schema, remote: config.remote, branch: config.branch, directory: config.directory };
}

function sourceRoot(root, selected, policy) {
  const canonical = worktrees(root).filter(item => item.branch === policy.protectedBranch);
  if (canonical.length !== 1) fail('canonical-root');
  const source = realpathSync(resolve(canonical[0].path, selected));
  if (realpathSync(repoRoot(source)) !== source || commonDir(source) === commonDir(root)) fail('source-root');
  return source;
}
function assertRemote(source, config) {
  if (remoteTransport('origin', source).fetchUrl !== config.remote) fail('remote-identity');
}
/** Deadline includes transport descendants; no inherited repository redirection or interactive prompt. */
function refresh(source, config, ref) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.toUpperCase().startsWith('GIT_') || ['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT'].includes(key)));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_NO_REPLACE_OBJECTS: '1' });
  const args = ['-c', 'credential.interactive=false', '-c', 'core.hooksPath=',
    '-c', 'fetch.writeCommitGraph=false', '-c', 'gc.auto=0', 'fetch', '--quiet', '--no-tags',
    '--no-recurse-submodules', '--no-auto-maintenance', '--no-write-fetch-head', '--',
    config.remote, `+refs/heads/${config.branch}:${ref}`];
  const result = spawnSync('git', args, { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', timeout: LIMIT.fetchMs, killSignal: 'SIGKILL', maxBuffer: LIMIT.tree });
  try {
    if (result.pid && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(result.pid), '/T', '/F'],
      { timeout: 1000, stdio: 'ignore', windowsHide: true });
    else if (result.pid) process.kill(-result.pid, 'SIGKILL');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  // Never echo remote/helper stderr, which can contain private content or credentials.
  return result.status === 0 && !result.error ? null : result.error?.code === 'ETIMEDOUT' ? 'timeout' : 'fetch-failed';
}
function scalar(text) {
  const value = text.trim();
  if (!value || /[\x00-\x1f\x7f]/u.test(value)) fail('scalar-invalid');
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'string' || !parsed || /[\x00-\x1f\x7f]/u.test(parsed)) fail('scalar-invalid');
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/u.test(value)) fail('scalar-invalid');
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[!&*|>{[\]}]/u.test(value)) fail('scalar-profile');
  return value;
}
/** Existing memory-log/v1 sigil blocks, restricted to its flat, single-line scalar profile. */
function entriesFor(bytes, shard) {
  const text = decode(bytes).replaceAll('\r\n', '\n');
  const front = text.match(/^---\n([\s\S]*?)\n---\n/u);
  if (!front) fail('frontmatter-required');
  const fields = Object.create(null);
  for (const line of front[1].split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = line.match(/^([a-z_]+): (.+)$/u);
    if (!match || Object.hasOwn(fields, match[1])) fail('frontmatter-profile');
    fields[match[1]] = scalar(match[2]);
  }
  const period = shard.path.match(/\/(\d{4}-\d{2})\.md$/u)?.[1];
  if (fields.schema !== 'memory-log/v1' || fields.period !== period
    || fields.timestamp_format !== 'YYYYMMDDTHHmmssZ' || fields.append_policy !== 'append-only'
    || !fields.agent || !fields.device || !fields.source_contract) fail('frontmatter-contract');
  const body = text.slice(front[0].length), headings = [...body.matchAll(/^## (.*)$/gmu)];
  const entries = [];
  for (let i = 0; i < headings.length; i++) {
    const id = headings[i][1], date = id.match(/^@mem-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u);
    if (!date) fail('entry-id');
    const iso = `${date[1]}-${date[2]}-${date[3]}T${date[4]}:${date[5]}:${date[6]}Z`;
    if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString() !== iso.replace('Z', '.000Z')
      || iso.slice(0, 7) !== period || i > 0 && id <= headings[i - 1][1]) fail('entry-order');
    const block = body.slice(headings[i].index + headings[i][0].length, headings[i + 1]?.index ?? body.length);
    const values = Object.create(null);
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const match = line.match(/^(type|scope|summary|refs): (.+)$/u);
      if (!match || Object.hasOwn(values, match[1])) fail('entry-fields');
      if (match[1] === 'refs') {
        if (!/^\[[^\[\]\n]+\]$/u.test(match[2])) fail('entry-refs');
        values.refs = match[2].slice(1, -1).split(',').map(scalar);
        if (values.refs.length > 16 || values.refs.some(value => Buffer.byteLength(value) > 1024)) fail('refs-budget');
      } else values[match[1]] = scalar(match[2]);
    }
    if (Object.keys(values).sort().join(',') !== 'refs,scope,summary,type'
      || Buffer.byteLength(values.summary) > 1024 || Buffer.byteLength(values.scope) > 128
      || Buffer.byteLength(values.type) > 64) fail('entry-budget-or-fields');
    entries.push({ id, ...values, path: shard.path, blob: shard.blob });
  }
  if (!entries.length && body.includes('@mem-')) fail('entry-heading');
  return entries;
}
export function memoryIndexFor(source, config, revision, previous = null) {
  if (previous && observeGit(['merge-base', '--is-ancestor', previous.source.revision, revision],
    { cwd: source, allowFail: true, maxBuffer: LIMIT.tree }) === null)
    fail('history-not-forward');
  const parts = config.directory.split('/');
  for (let i = 1; i < parts.length; i++) {
    const parent = tree(source, revision, parts.slice(0, i).join('/'));
    if (parent.length !== 1 || parent[0].kind !== 'tree') fail('shard-parent');
  }
  const directory = tree(source, revision, config.directory);
  if (directory.length && directory[0].kind !== 'tree') fail('shard-directory');
  const shards = directory.length ? tree(source, `${revision}:${config.directory}`, '') : [];
  if (shards.length > LIMIT.shards) fail('shard-count');
  const entries = [];
  let total = 0;
  for (const shard of shards) {
    if (shard.mode !== '100644' || !/^\d{4}-\d{2}\.md$/u.test(shard.path)) fail('shard-file');
    shard.path = `${config.directory}/${shard.path}`;
    const bytes = blob(source, shard.blob, LIMIT.shard);
    total += bytes.length;
    if (total > LIMIT.total) fail('source-byte-budget');
    const old = previous?.shards.find(item => item.path === shard.path);
    if (old && old.blob !== shard.blob) {
      const before = blob(source, old.blob, LIMIT.shard);
      if (!bytes.subarray(0, before.length).equals(before)) fail('append-only');
    }
    entries.push(...entriesFor(bytes, shard));
    if (entries.length > LIMIT.entries) fail('entry-count');
  }
  if (previous?.shards.some(old => !shards.some(item => item.path === old.path))) fail('shard-removed');
  return { schema: 'agentic-os/memory-index/v1', source: { ...config, revision },
    shards: shards.map(({ path, blob }) => ({ path, blob })), entries };
}
function cached(file, config) {
  if (!lstatSync(file, { throwIfNoEntry: false })) return null;
  const saved = JSON.parse(decode(readBoundedFile(file, LIMIT.cache, 'memory cache')));
  const value = saved.index;
  if (!value || saved.digest !== digest(JSON.stringify(value)) || value.schema !== 'agentic-os/memory-index/v1'
    || !SHA.test(value.source?.revision ?? '')
    || JSON.stringify({ ...value.source, revision: undefined }) !== JSON.stringify(config)
    || !Array.isArray(value.shards) || value.shards.length > LIMIT.shards
    || !Array.isArray(value.entries) || value.entries.length > LIMIT.entries) fail('cache-invalid');
  // Cache integrity is not authorization. Re-read cited blobs before using memory to make a decision.
  return value;
}
function save(file, value) {
  const prior = lstatSync(file, { throwIfNoEntry: false }) ? pathIdentity(file) : null;
  if (prior && (prior.kind !== 'file' || prior.nlink !== 1n)) fail('cache-file');
  const temporary = `${file}.${randomUUID()}.tmp`;
  const bytes = Buffer.from(JSON.stringify({ digest: digest(JSON.stringify(value)), index: value }) + '\n');
  const created = writePrivateFileExclusive(temporary, bytes, { maxBytes: LIMIT.cache, label: 'memory index' });
  try {
    if (prior) assertPathIdentity(prior, 'memory index');
    else if (lstatSync(file, { throwIfNoEntry: false })) fail('cache-race');
    assertPathIdentity(created, 'memory temporary index');
    renameSync(temporary, file);
  } catch (error) { unlinkExactPath(created, 'memory temporary index'); throw error; }
}

export function hydrateMemory(root, policy, { revision = null, offline = false } = {}) {
  const selected = observeGit(['config', '--local', '--get-all', 'agentic-os.memoryRoot'], { cwd: root, allowFail: true });
  if (selected === null) return { status: 'disabled', reason: 'local-enrollment-required' };
  if (!selected || /[\r\n\x00]/u.test(selected)) fail('root-selection');
  const configRevision = revision ?? read(root, ['rev-parse', '--verify', `${policy.protectedRef}^{commit}`]);
  if (!SHA.test(configRevision)) fail('config-revision');
  const config = configuration(root, configRevision);
  if (!config) fail('config-missing');
  return hydrateSelectedMemory(root, policy, selected, config, { configRevision, offline });
}
export function hydrateSelectedMemory(root, policy, selected, supplied,
  { configRevision, offline = false, inspect = null, advertise = false }) {
  const config = memoryConfiguration(supplied, root);
  if (!SHA.test(configRevision ?? '')) fail('config-revision');
  const source = sourceRoot(root, selected, policy);
  assertRemote(source, config);
  const key = digest(JSON.stringify(config));
  const storage = join(commonDir(source), 'agentic-os-memory');
  try { mkdirSync(storage, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const directory = pathIdentity(storage);
  if (directory.kind !== 'directory' || Number(directory.mode & 0o077n)) fail('cache-directory');
  const lock = acquireOperationLock('agentic-os-memory', source);
  if (!lock) fail('busy');
  let result, error;
  try {
    const file = join(storage, `${key}.json`), previous = cached(file, config);
    const ref = `refs/agentic-os/memory/fetched-${key}`;
    let unchanged = false, advertisementFailed = false;
    if (!offline && advertise && previous) {
      const advertised = observeGit(['ls-remote', '--refs', config.remote, `refs/heads/${config.branch}`],
        { cwd: source, allowFail: true, maxBuffer: 4096, remoteReadTimeoutMs: 5000 });
      advertisementFailed = advertised === null;
      if (!advertisementFailed) {
        const match = advertised.match(/^([a-f0-9]{40}(?:[a-f0-9]{24})?)\t(.+)$/u);
        if (!match || match[2] !== `refs/heads/${config.branch}`) fail('remote-branch');
        unchanged = match[1] === previous.source.revision;
      }
    }
    const refreshError = offline ? 'offline-requested' : advertisementFailed ? 'fetch-failed'
      : unchanged ? null : refresh(source, config, ref);
    assertRemote(source, config);
    const revision = refreshError || unchanged ? previous?.source.revision
      : read(source, ['rev-parse', '--verify', `${ref}^{commit}`]);
    if (!revision) fail('unavailable-no-cache');
    if (refreshError) read(source, ['cat-file', '-e', `${revision}^{commit}`]);
    const reused = previous?.source.revision === revision;
    const index = reused ? previous : memoryIndexFor(source, config, revision, previous);
    // Validate every composed source before publishing the single accepted snapshot pointer.
    const context = inspect ? inspect(revision, { refreshError, reused }) : null;
    // The accepted ref keeps the last valid source reachable after a refused rewrite or interrupted refresh.
    // This retention ref is not the published cache pointer. Advance it before the atomic rename,
    // so a ref-lock failure cannot publish a snapshot; ancestry keeps the prior snapshot reachable.
    git(['update-ref', '--no-deref', `refs/agentic-os/memory/accepted-${key}`, revision], { cwd: source });
    if (!reused) save(file, index);
    result = { status: refreshError ? 'offline-cache' : 'ready', sourceRevision: revision,
      configRevision, index: file, entries: index.entries.length, reused, refreshError, grantsAuthority: false };
    if (context !== null) result.context = context;
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'memory', result, error });
}

export function runMemory(root, policy, options = {}, out = console.log) {
  const receipt = hydrateMemory(root, policy, options);
  out(`memory ${JSON.stringify(receipt)}`);
  return 0;
}
