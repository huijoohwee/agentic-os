/** Shared bounded filesystem and Git primitives for on-demand storage operations. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync,
  openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commonDir, repoRoot } from '../src/git.mjs';
import { observeQuarantineManifest } from '../src/cleanup-manifest.mjs';

const MAX_OUTPUT = 64 * 1024 * 1024;
const LIMITS = { byteCeiling: 4 * 1024 * 1024 * 1024, entryCeiling: 100000 };
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const fail = reason => { throw new Error(`blocked-storage-${reason}`); };
const same = (a, b) => digest(a) === digest(b);
const direct = path => {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) fail('directory-alias');
  return path;
};
function command(file, args, cwd, options = {}) {
  return execFileSync(file, args, { cwd, encoding: 'utf8', timeout: 1200000,
    maxBuffer: MAX_OUTPUT, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
      COPYFILE_DISABLE: '0', DITTOABORT: '1' }, ...options });
}
const git = (root, args, options) => command('git', ['--no-replace-objects', ...args], root, options);
function location(cwd) {
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_INDEX_FILE', 'GIT_SHALLOW_FILE'])
    if (process.env[name]) fail('git-environment');
  const root = direct(realpathSync(repoRoot(cwd))), common = direct(realpathSync(commonDir(root)));
  direct(join(common, 'objects'));
  for (const name of ['pack', 'info'])
    if (existsSync(join(common, 'objects', name))) direct(join(common, 'objects', name));
  for (const name of ['alternates', 'http-alternates'])
    if (existsSync(join(common, 'objects/info', name))) fail('object-alternates');
  return { root, common };
}
function allocated(path) {
  let entries = 0, bytes = 0; const seen = new Set();
  const visit = p => {
    if (++entries > 150000) fail('entry-ceiling');
    const stat = lstatSync(p), key = `${stat.dev}:${stat.ino}`;
    if (!stat.isFile() || !seen.has(key)) bytes += stat.blocks * 512;
    if (stat.isFile()) seen.add(key);
    if (stat.isDirectory() && !stat.isSymbolicLink()) for (const n of readdirSync(p)) visit(join(p, n));
  };
  visit(path); return bytes;
}
function storageManifest(path) {
  const groups = new Map(); let entries = 0;
  const visit = (p, relative) => {
    if (++entries > LIMITS.entryCeiling) fail('entry-ceiling');
    const stat = lstatSync(p);
    if (stat.isDirectory() && !stat.isSymbolicLink())
      for (const name of readdirSync(p)) visit(join(p, name), relative ? `${relative}/${name}` : name);
    else if (stat.isFile() && stat.nlink > 1) {
      const key = `${stat.dev}:${stat.ino}`, group = groups.get(key) ?? { count: stat.nlink, paths: [] };
      group.paths.push(relative); groups.set(key, group);
    }
  };
  visit(path, '');
  for (const group of groups.values()) if (group.paths.length !== group.count) fail('external-hardlink');
  const manifest = observeQuarantineManifest(path, { ...LIMITS, retainedHardlinks: true });
  return groups.size ? { ...manifest, hardlinkDigest: digest([...groups.values()].map(g => g.paths.sort())
    .sort((a, b) => a[0].localeCompare(b[0]))) } : manifest;
}
function privateDirectory(path) {
  if (!existsSync(path)) { mkdirSync(path, { mode: 0o700 }); flushDirectory(resolve(path, '..')); }
  direct(path);
  if (lstatSync(path).mode & 0o077) fail('private-directory');
  return path;
}
function flushDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function durableJson(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  flushDirectory(resolve(path, '..'));
}
function flushTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) for (const name of readdirSync(path)) flushTree(join(path, name));
  else if (!stat.isFile()) fail('backup-special-file');
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
export { MAX_OUTPUT, LIMITS, hash, digest, fail, same, direct, command, git, location,
  allocated, storageManifest, privateDirectory, flushDirectory, durableJson, flushTree };
