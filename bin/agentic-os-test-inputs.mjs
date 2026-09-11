/** Bounded Git and working-byte snapshots used only by the repository's test runner. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

export const LIMITS = Object.freeze({ files: 2048, fileBytes: 499_000, bytes: 16 * 1024 * 1024,
  gitMs: 10_000, testMs: 540_000, outputBytes: 480_000, receiptBytes: 128_000 });
export const hash = value => createHash('sha256').update(value).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value);
export function executionEnvironment(environment = process.env) {
  // npm nesting changes these transport labels; remove them from both execution and the digest.
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !['npm_lifecycle_event', 'npm_lifecycle_script', 'npm_command', '_', 'NODE_TEST_CONTEXT'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)));
}
export function readGit(root, args, { input, binary = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' });
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-c', 'diff.external=', ...args], { cwd: root, env, input, timeout: LIMITS.gitMs,
      maxBuffer: LIMITS.bytes, encoding: binary ? undefined : 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { throw new Error(`blocked-test-git:${args[0]}`); }
}
const oid = (root, ref) => {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\x00-\x20]/u.test(ref))
    throw new Error('blocked-test-ref');
  const result = readGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!sha(result)) throw new Error('blocked-test-ref');
  return result;
};
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\')
    || /[\x00-\x1f]/u.test(path) || path.split('/').some(part => ['.', '..', '.git', ''].includes(part)))
    throw new Error('blocked-test-path');
  return path;
}
function fields(value) {
  if (!value.endsWith('\0')) throw new Error('blocked-test-listing');
  const result = value.slice(0, -1).split('\0');
  if (result.length > LIMITS.files) throw new Error('blocked-test-file-count');
  return result;
}
export function readRegular(root, path, limit = LIMITS.fileBytes, cache = null) {
  const absolute = join(root, safePath(path));
  let parent = dirname(absolute);
  while (parent !== root) {
    if (!lstatSync(parent).isDirectory()) throw new Error(`blocked-test-non-directory:${path}`);
    parent = dirname(parent);
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.size > limit) throw new Error(`blocked-test-file:${path}`);
  const stamp = value => [value.dev, value.ino, value.mode, value.size, value.mtimeNs, value.ctimeNs].join(':');
  const identity = stamp(lstatSync(absolute, { bigint: true }));
  const previous = cache?.get(absolute);
  if (previous?.identity === identity) return previous.file;
  const bytes = readFileSync(absolute), after = lstatSync(absolute);
  if (bytes.length !== stat.size || after.ino !== stat.ino || after.dev !== stat.dev
    || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
    throw new Error(`blocked-test-file-drift:${path}`);
  if (stamp(lstatSync(absolute, { bigint: true })) !== identity) throw new Error(`blocked-test-file-drift:${path}`);
  const file = Object.freeze({ mode: stat.mode & 0o111 ? '100755' : '100644', digest: hash(bytes), text: utf8.decode(bytes) });
  cache?.set(absolute, { identity, file });
  return file;
}
function committedFiles(root, revision, cache) {
  const key = `${root}:${revision}`;
  if (cache?.has(key)) return cache.get(key);
  const listing = readGit(root, ['ls-tree', '-r', '-z', revision]);
  if (!listing) throw new Error('blocked-test-empty-source');
  const entries = fields(listing).map(record => {
    const match = record.match(/^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/su);
    if (!match) throw new Error('blocked-test-tree-entry');
    return { mode: match[1], oid: match[2], path: safePath(match[3]) };
  });
  const output = readGit(root, ['cat-file', '--batch'], {
    input: entries.map(entry => entry.oid).join('\n') + '\n', binary: true });
  let offset = 0;
  const files = new Map();
  for (const entry of entries) {
    const newline = output.indexOf(10, offset);
    const header = output.subarray(offset, newline).toString('ascii').split(' ');
    const size = Number(header[2]);
    if (newline < 0 || header[0] !== entry.oid || header[1] !== 'blob'
      || !Number.isSafeInteger(size) || size < 0 || size > LIMITS.fileBytes)
      throw new Error('blocked-test-blob');
    const bytes = output.subarray(newline + 1, newline + 1 + size);
    offset = newline + 1 + size + 1;
    if (bytes.length !== size || output[offset - 1] !== 10) throw new Error('blocked-test-blob-truncated');
    files.set(entry.path, { mode: entry.mode, digest: hash(bytes), text: utf8.decode(bytes) });
  }
  if (offset !== output.length) throw new Error('blocked-test-blob-trailing');
  if (cache?.size >= 4) cache.clear();
  cache?.set(key, files);
  return files;
}
function worktreeFiles(root, cache) {
  const listing = readGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const names = new Set(listing ? fields(listing) : []);
  // These are ignored in the dependency-free source package but can affect npm execution.
  for (const path of ['package-lock.json', '.npmrc']) {
    try { lstatSync(join(root, path)); names.add(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const files = new Map(); let bytes = 0;
  for (const path of [...names].sort()) {
    let file;
    try { file = readRegular(root, path, LIMITS.fileBytes, cache); } catch (error) {
      if (error.code === 'ENOENT') continue; throw error;
    }
    bytes += Buffer.byteLength(file.text);
    if (bytes > LIMITS.bytes) throw new Error('blocked-test-source-byte-budget');
    files.set(path, file);
  }
  return files;
}
export const manifestDigest = files => hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))
  .map(([path, file]) => [path, file.mode, file.digest])));

// Cache lifetime is one runner invocation. Every boundary still inventories names, index,
// refs, environment and file identities; only unchanged bytes and immutable Git blobs are reused.
export function snapshotReader(options) {
  const cache = { committed: new Map(), working: new Map() };
  return () => snapshot(options, cache);
}
export function snapshot({ root, base = 'origin/main', head = 'HEAD', committed = false }, cache = null) {
  root = realpathSync(root);
  if (resolve(readGit(root, ['rev-parse', '--show-toplevel']).trim()) !== root)
    throw new Error('blocked-test-repository-root');
  const headRevision = oid(root, head), requestedBase = oid(root, base);
  const actualHead = oid(root, 'HEAD');
  if (actualHead !== headRevision) throw new Error('blocked-test-checkout-head');
  const bases = readGit(root, ['merge-base', '--all', requestedBase, headRevision]).trim().split('\n');
  if (bases.length !== 1 || !sha(bases[0])) throw new Error('blocked-test-merge-base');
  const baseRevision = bases[0], before = committedFiles(root, baseRevision, cache?.committed);
  const headFiles = committedFiles(root, headRevision, cache?.committed), after = worktreeFiles(root, cache?.working);
  if (committed && manifestDigest(headFiles) !== manifestDigest(after))
    throw new Error('blocked-test-dirty-ci-source');
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => {
    const a = before.get(path), b = after.get(path); return a?.digest !== b?.digest || a?.mode !== b?.mode;
  }).sort();
  const identity = { root, requestedBase, baseRevision, headRevision,
    baseTree: readGit(root, ['rev-parse', `${baseRevision}^{tree}`]).trim(),
    headTree: readGit(root, ['rev-parse', `${headRevision}^{tree}`]).trim(),
    sourceDigest: manifestDigest(after),
    indexDigest: hash(readGit(root, ['ls-files', '--stage', '-z'])),
    configurationDigest: hash(readGit(root, ['config', '--null', '--list', '--show-origin'])),
    refsDigest: hash(readGit(root, ['for-each-ref', '--format=%(refname) %(objectname)'])),
    environmentDigest: hash(JSON.stringify(executionEnvironment())),
    node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
    git: readGit(root, ['--version']).trim(),
    packageDigest: after.get('package.json')?.digest ?? null };
  if (oid(root, 'HEAD') !== actualHead) throw new Error('blocked-test-head-drift');
  return { before, after, changed, identity };
}
