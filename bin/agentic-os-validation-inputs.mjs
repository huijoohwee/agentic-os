/** Streaming source identities for large consumers; cached bytes live only within this invocation. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { executionEnvironment, hash, readGit, safePath, validationGitConfiguration } from './agentic-os-test-inputs.mjs';
export const CONSUMER_LIMITS = Object.freeze({ files: 50_000, fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024, commandMs: 900_000, runMs: 3_600_000 });
const fields = text => {
  if (!text) return [];
  if (!text.endsWith('\0')) throw new Error('blocked-validation-git-fields');
  const result = text.slice(0, -1).split('\0');
  if (result.length > CONSUMER_LIMITS.files) throw new Error('blocked-validation-file-budget');
  return result;
};
const revision = (root, ref) => {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\x00-\x20]/u.test(ref)) throw new Error('blocked-validation-ref');
  const oid = readGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(oid)) throw new Error('blocked-validation-ref');
  return oid;
};
const stamp = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
function readWorkingFile(root, path, algorithm, cache, budget) {
  safePath(path);
  const absolute = join(root, path);
  for (let parent = dirname(absolute); parent !== root; parent = dirname(parent)) {
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isDirectory()) throw new Error('blocked-validation-parent');
  }
  const before = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!before) return null;
  if (!before.isFile() && !before.isSymbolicLink() || before.size > BigInt(CONSUMER_LIMITS.fileBytes))
    throw new Error('blocked-validation-source-type-or-budget');
  budget.bytes += Number(before.size);
  if (budget.bytes > CONSUMER_LIMITS.totalBytes) throw new Error('blocked-validation-source-byte-budget');
  const identity = stamp(before), previous = cache.get(path);
  if (previous?.identity === identity) return previous.file;
  const mode = before.isSymbolicLink() ? '120000' : before.mode & 0o111n ? '100755' : '100644';
  const object = createHash(algorithm).update(`blob ${before.size}\0`), content = createHash('sha256');
  const consume = bytes => { object.update(bytes); content.update(bytes); };
  if (before.isSymbolicLink()) consume(readlinkSync(absolute, { encoding: 'buffer' }));
  else {
    const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (stamp(fstatSync(descriptor, { bigint: true })) !== identity) throw new Error('blocked-validation-source-race');
      const buffer = Buffer.alloc(256 * 1024); let total = 0;
      for (let size; (size = readSync(descriptor, buffer, 0, buffer.length, null));) {
        total += size;
        if (total > Number(before.size)) throw new Error('blocked-validation-source-growth');
        consume(buffer.subarray(0, size));
      }
      if (total !== Number(before.size) || stamp(fstatSync(descriptor, { bigint: true })) !== identity)
        throw new Error('blocked-validation-source-race');
    } finally { closeSync(descriptor); }
  }
  if (stamp(lstatSync(absolute, { bigint: true })) !== identity) throw new Error('blocked-validation-source-race');
  const file = { mode, oid: object.digest('hex'), digest: content.digest('hex') };
  cache.set(path, { identity, file });
  return file;
}
const tree = (root, ref) => new Map(fields(readGit(root, ['ls-tree', '-r', '-z', ref])).map(record => {
  const match = /^(100644|100755|120000) blob ([a-f0-9]{40,64})\t(.+)$/su.exec(record);
  if (!match) throw new Error('blocked-validation-tree-entry');
  return [safePath(match[3]), { mode: match[1], oid: match[2] }];
}));
export const sourceDigest = files => hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))
  .map(([path, file]) => [path, file.mode, file.oid])));
export function consumerSnapshotReader({ root, base = 'origin/main', head = 'HEAD', committed = false }) {
  root = realpathSync(root);
  const cache = new Map(), trees = new Map();
  const committedTree = ref => {
    if (!trees.has(ref)) trees.set(ref, tree(root, ref));
    return trees.get(ref);
  };
  return () => {
    if (resolve(readGit(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('blocked-validation-root');
    const headRevision = revision(root, head), actualHead = revision(root, 'HEAD'), requestedBase = revision(root, base);
    if (headRevision !== actualHead) throw new Error('blocked-validation-checkout');
    const bases = readGit(root, ['merge-base', '--all', requestedBase, headRevision]).trim().split('\n');
    if (bases.length !== 1 || !bases[0]) throw new Error('blocked-validation-merge-base');
    const hidden = fields(readGit(root, ['ls-files', '-v', '-z']));
    if (hidden.some(record => record[0] !== 'H')) throw new Error('blocked-validation-hidden-source');
    const names = [...new Set(fields(readGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])))].sort();
    const index = readGit(root, ['ls-files', '--stage', '-z']);
    if (fields(index).some(record => !/ 0\t/u.test(record))) throw new Error('blocked-validation-unmerged-index');
    const algorithm = readGit(root, ['rev-parse', '--show-object-format']).trim();
    if (!['sha1', 'sha256'].includes(algorithm)) throw new Error('blocked-validation-object-format');
    const after = new Map(), budget = { bytes: 0 };
    for (const path of names) {
      const file = readWorkingFile(root, path, algorithm, cache, budget);
      if (file) after.set(path, file);
    }
    const before = committedTree(bases[0]);
    if (committed && sourceDigest(committedTree(headRevision)) !== sourceDigest(after)) throw new Error('blocked-validation-dirty-ci');
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => {
      const a = before.get(path), b = after.get(path); return a?.oid !== b?.oid || a?.mode !== b?.mode;
    }).sort();
    const identity = { root, requestedBase, baseRevision: bases[0], headRevision,
      sourceDigest: sourceDigest(after), indexDigest: hash(index),
      configurationDigest: hash(validationGitConfiguration(root)),
      environmentDigest: hash(JSON.stringify(executionEnvironment())),
      node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch };
    if (revision(root, 'HEAD') !== actualHead || hash(readGit(root, ['ls-files', '--stage', '-z'])) !== identity.indexDigest)
      throw new Error('blocked-validation-observation-race');
    return { before, after, changed, identity, observedBytes: budget.bytes };
  };
}
