/** Bounded committed-content checks. Planning grammar and runtime evidence retain their existing owners. */
import { createHash } from 'node:crypto';
import { posix, resolve } from 'node:path';
import { observeGit } from '../src/git.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { memoryIndexFor } from './agentic-os-memory.mjs';
import { validateWorkspaceConfiguration } from './agentic-os-workspace.mjs';

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const CAP = 499999;
const fail = reason => { throw new Error(`blocked-workspace-check-${reason}`); };
const read = (root, args, options = {}) => observeGit(args, { cwd: root, maxBuffer: 65536, ...options });
function entry(root, revision, path) {
  const raw = read(root, ['ls-tree', '-z', revision, '--', path]);
  if (!raw) return null;
  const match = raw.match(/^(\d{6}) (blob|tree|commit) ([a-f0-9]+)\t([^\0]+)\0$/u);
  if (!match || match[4] !== path || !SHA.test(match[3])) fail('tree-entry');
  return { mode: match[1], kind: match[2], blob: match[3] };
}
function regular(root, revision, path) {
  const item = entry(root, revision, path);
  if (!item || !['100644', '100755'].includes(item.mode) || item.kind !== 'blob') fail('regular-file');
  return item;
}
function safePath(path) {
  return typeof path === 'string' && path.length <= 512 && !/[\x00-\x1f\x7f\\]/u.test(path)
    && path.split('/').every(part => part && !['.', '..', '.git'].includes(part));
}
function checkReference(root, revision, record, reference) {
  if (/^https?:\/\//u.test(reference)) {
    const url = new URL(reference);
    if (url.username || url.password || !url.hostname) fail('reference-url');
    return; // Network availability and cross-repository ownership belong to the cited evaluator.
  }
  if (/^[a-z]+:/iu.test(reference) || reference.startsWith('/')) fail('reference-path');
  const path = posix.normalize(posix.join(posix.dirname(record.path), reference.split('#')[0]));
  if (!safePath(path) || !entry(root, revision, path)) fail('reference-missing');
}
export function checkWorkspace({ root, base, head, config }) {
  if (!SHA.test(base ?? '') || !SHA.test(head ?? '')) fail('exact-revisions-required');
  config = validateWorkspaceConfiguration(config, root);
  if (config.schema !== 'agentic-os/workspace/v2') fail('requires-v2');
  for (const revision of [base, head]) read(root, ['cat-file', '-e', `${revision}^{commit}`]);
  if (read(root, ['merge-base', '--is-ancestor', base, head], { allowFail: true }) === null) fail('history-not-forward');
  for (const source of Object.values(config.sources)) {
    if (entry(root, head, source.path)?.kind !== 'tree') fail('source-tree');
  }
  const memory = config.sources.memory, todo = config.sources.todo, artifacts = config.sources.artifacts;
  regular(root, head, `${todo.path}/${todo.entry}`);
  const memoryConfig = { schema: 'agentic-os/memory-source/v1', remote: config.remote,
    branch: config.branch, directory: `${memory.path}/${memory.directory}` };
  const previous = memoryIndexFor(root, memoryConfig, base);
  const index = memoryIndexFor(root, memoryConfig, head, previous);
  const accepted = new Set(previous.entries.map(item => item.id));
  for (const record of index.entries.filter(item => !accepted.has(item.id)))
    for (const reference of record.refs) checkReference(root, head, record, reference);
  const paths = read(root, ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head, '--'],
    { raw: true }).split('\0').filter(Boolean);
  if (paths.length > 512 || paths.some(path => !safePath(path))) fail('changed-path-budget');
  const integrity = [];
  const changed = { memory: 0, todo: 0, artifacts: 0, configuration: 0 };
  for (const path of paths) {
    const role = Object.entries(config.sources).find(([, source]) => path.startsWith(`${source.path}/`))?.[0];
    changed[role ?? 'configuration']++;
    if (role === 'todo' && (path.startsWith(`${todo.path}/todo/`)
      || path === `${todo.path}/migration-from-website.json`) && entry(root, base, path)) fail('immutable-planning-record');
    if (!role) continue;
    const item = entry(root, head, path);
    if (!item) {
      if (role === 'artifacts') fail('retained-artifact-removed');
      continue;
    }
    regular(root, head, path);
    const size = Number(read(root, ['cat-file', '-s', item.blob]));
    if (!Number.isSafeInteger(size) || size > CAP) fail('changed-blob-budget');
    if (role === 'artifacts') {
      const bytes = observeGit(['cat-file', 'blob', item.blob], { cwd: root, binary: true, maxBuffer: CAP });
      integrity.push({ path, blob: item.blob, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return { schema: 'agentic-os/workspace-check/v1', status: 'passed', base, head, changed,
    memoryEntries: index.entries.length, artifacts: integrity,
    planningGrammar: 'source-owner-check-required', artifactSemantics: 'producer-check-required',
    grantsAuthority: false };
}
export function runWorkspaceCheck(argv, out = console.log) {
  const option = name => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const config = JSON.parse(readBoundedFile(resolve(option('config')), 4096, 'workspace configuration').toString('utf8'));
  const result = checkWorkspace({ root: resolve(option('repository')), base: option('base'), head: option('head'), config });
  out(`workspace-check ${JSON.stringify(result)}`);
  return 0;
}
