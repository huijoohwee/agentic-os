/** Bounded task retrieval and handoff reuse; no network, model, source write or publication. */
import { createHash } from 'node:crypto';
import { posix, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { observeGit } from '../src/git.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { acceptedMemorySnapshot, memoryEntriesFor } from './agentic-os-memory.mjs';
import { selectedSources, workspaceConfiguration } from './agentic-os-workspace.mjs';
import { sharedWorkspacePath } from './agentic-os-workspace-publication.mjs';
import { option } from './agentic-os-argv.mjs';

export const TASK_MEMORY_LIMITS = Object.freeze({ blob: 499999, output: 16384, handoff: 16384,
  proposal: 4096, results: 20, lines: 80, query: 256 });
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const fail = reason => { throw new Error(`blocked-memory-task-${reason}`); };
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 8192, ...options });
const safePath = path => typeof path === 'string' && path.length <= 256
  && path.split('/').every(part => /^[A-Za-z0-9._-]+$/u.test(part) && !['.', '..', '.git'].includes(part));
function integer(value, min, max) {
  if (!/^\d+$/u.test(String(value)) || !Number.isSafeInteger(Number(value))
    || Number(value) < min || Number(value) > max) fail('numeric-budget');
  return Number(value);
}
function bounded(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > TASK_MEMORY_LIMITS.output) fail('output-budget-narrow-selection');
  return value;
}
export function memoryTaskContext(root, policy, revision) {
  if (!SHA.test(revision ?? '')) fail('exact-snapshot-required');
  const selected = git(root, ['config', '--local', '--get-all', 'agentic-os.workspaceRoot'], { allowFail: true });
  if (!selected || /[\r\n\x00]/u.test(selected)) fail('workspace-enrollment-required');
  if (git(root, ['config', '--local', '--get-all', 'agentic-os.memoryRoot'], { allowFail: true }) !== null)
    fail('duplicate-enrollment');
  const configRevision = git(root, ['rev-parse', '--verify', `${policy.protectedRef}^{commit}`]);
  const config = workspaceConfiguration(root, configRevision);
  if (config.schema !== 'agentic-os/workspace/v2') fail('requires-workspace-v2');
  const { container, sources } = selectedSources(root, policy, selected, config, ['memory']);
  const { remote, branch, directory } = sources.get('memory').spec;
  const snapshot = acceptedMemorySnapshot(container,
    { schema: 'agentic-os/memory-source/v1', remote, branch, directory }, revision);
  return { root: container, config, configRevision, revision, directory, ...snapshot };
}
function entry(context, path) {
  if (!safePath(path)) fail('path');
  const raw = git(context.root, ['ls-tree', '-z', context.revision, '--', path]);
  if (!raw) return null;
  const match = raw.match(/^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/u);
  if (!match || match[3] !== path) fail('regular-file');
  return { path, blob: match[2] };
}
function content(context, path, optional = false) {
  if (!safePath(path) || !path.startsWith(`${context.config.sources.memory.path}/`)
    || context.config.publication && !sharedWorkspacePath(context.config, path)) fail('memory-path');
  const item = entry(context, path);
  if (!item) { if (optional) return null; fail('missing-file'); }
  const size = Number(git(context.root, ['cat-file', '-s', item.blob]));
  if (!Number.isSafeInteger(size) || size > TASK_MEMORY_LIMITS.blob) fail('blob-budget');
  const bytes = git(context.root, ['cat-file', 'blob', item.blob],
    { binary: true, maxBuffer: TASK_MEMORY_LIMITS.blob });
  const text = decode(bytes);
  if (text.includes('\0')) fail('text-required');
  return { ...item, text, bytes };
}
function receipt(context, operation, result) {
  return bounded({ schema: 'agentic-os/task-memory/v1', operation, sourceRevision: context.revision,
    configRevision: context.configRevision, indexReused: context.indexReused,
    remoteFreshness: 'not-checked-refresh-before-effects', grantsAuthority: false, ...result });
}
export function searchMemory(context, { query, path = null, limit = 5, afterLine = 0 }) {
  if (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query) > TASK_MEMORY_LIMITS.query
    || /[\x00-\x1f\x7f]/u.test(query)) fail('query');
  limit = integer(limit, 1, TASK_MEMORY_LIMITS.results); afterLine = integer(afterLine, 0, 1000000);
  const needle = query.trim().toLowerCase();
  if (!path) {
    if (afterLine) fail('pagination-requires-path');
    const matches = context.index.entries.filter(item =>
      `${item.id} ${item.type} ${item.scope} ${item.summary}`.toLowerCase().includes(needle))
      .sort((left, right) => right.id.localeCompare(left.id));
    return receipt(context, 'search', { corpus: 'curated', matches: matches.slice(0, limit),
      totalMatches: matches.length, hasMore: matches.length > limit });
  }
  const file = content(context, path), matches = [], lines = file.text.split('\n');
  let nextLine = null;
  for (let index = afterLine; index < lines.length; index++) {
    if (!lines[index].toLowerCase().includes(needle)) continue;
    if (matches.length === limit) { nextLine = matches.at(-1).line; break; }
    matches.push({ line: index + 1, text: lines[index] });
  }
  return receipt(context, 'search', { corpus: 'explicit-file', path, blob: file.blob, matches,
    hasMore: nextLine !== null, nextAfterLine: nextLine });
}
export function readMemory(context, { path, line = 1, lines = 40 }) {
  line = integer(line, 1, 1000000); lines = integer(lines, 1, TASK_MEMORY_LIMITS.lines);
  const file = content(context, path), all = file.text.split('\n');
  if (line > all.length) fail('line-range');
  const selected = all.slice(line - 1, line - 1 + lines), next = line + selected.length;
  return receipt(context, 'read', { path, blob: file.blob, line, lines: selected,
    hasMore: next <= all.length, nextLine: next <= all.length ? next : null });
}
function references(context, record) {
  for (const ref of record.refs) {
    if (/^https?:\/\//u.test(ref)) {
      const url = new URL(ref); if (!url.hostname || url.username || url.password) fail('reference-url');
    } else {
      if (/^[a-z]+:/iu.test(ref) || ref.startsWith('/')) fail('reference-path');
      const path = posix.normalize(posix.join(posix.dirname(record.path), ref.split('#')[0]));
      if (!entry(context, path)) fail('reference-missing');
    }
  }
}
/** Reuse one explicitly authored memory-log/v1 block in the normal handoff, never summarize it with a model. */
export function captureMemory(context, handoff) {
  if (context.revision !== context.acceptedRevision) fail('refresh-before-capture');
  if (typeof handoff !== 'string' || Buffer.byteLength(handoff) > TASK_MEMORY_LIMITS.handoff) fail('handoff-budget');
  const blocks = [...handoff.matchAll(/^```memory-log\/v1\n([\s\S]*?)^```[ \t]*$/gmu)];
  if (blocks.length !== 1 || Buffer.byteLength(blocks[0][1]) > TASK_MEMORY_LIMITS.proposal) fail('one-bounded-memory-block');
  const payload = blocks[0][1], headings = [...payload.matchAll(/^## @mem-(\d{4})(\d{2})\d{2}T\d{6}Z$/gmu)];
  if (headings.length !== 1) fail('one-record-required');
  const path = `${context.directory}/${headings[0][1]}-${headings[0][2]}.md`;
  const before = content(context, path, true), suppliedHeader = payload.match(/^---\n[\s\S]*?\n---\n/u)?.[0];
  const header = before?.text.match(/^---\n[\s\S]*?\n---\n/u)?.[0] ?? suppliedHeader;
  if (!header || before && suppliedHeader && suppliedHeader !== header) fail('source-header-required');
  const body = suppliedHeader ? payload.slice(suppliedHeader.length) : payload;
  const [record] = memoryEntriesFor(Buffer.from(header + body), { path, blob: before?.blob ?? '0'.repeat(40) });
  if (!record) fail('one-record-required');
  references(context, record);
  const existing = context.index.entries.find(item => item.id === record.id);
  if (existing) {
    if (['type', 'scope', 'summary', 'refs'].some(key => JSON.stringify(existing[key]) !== JSON.stringify(record[key])))
      fail('record-id-conflict');
    return receipt(context, 'capture', { status: 'already-present', path, recordId: record.id, append: '' });
  }
  const append = before ? `\n${body}` : payload;
  const after = Buffer.concat([before?.bytes ?? Buffer.alloc(0), Buffer.from(append)]);
  if (after.length > 65536) fail('shard-budget');
  memoryEntriesFor(after, { path, blob: before?.blob ?? '0'.repeat(40) });
  return receipt(context, 'capture', { status: 'proposal', path, recordId: record.id,
    baseBlob: before?.blob ?? null, baseSha256: hash(before?.bytes ?? Buffer.alloc(0)),
    append, create: !before, publication: 'scoped-branch-check-review-required', sourceWritten: false });
}
export function runMemoryTask(root, policy, argv, out = console.log) {
  const context = memoryTaskContext(root, policy, option(argv, 'revision'));
  const result = argv[0] === 'search' ? searchMemory(context, { query: option(argv, 'query'),
    path: option(argv, 'path'), limit: option(argv, 'limit', 5), afterLine: option(argv, 'after-line', 0) })
    : argv[0] === 'read' ? readMemory(context, { path: option(argv, 'path'),
      line: option(argv, 'line', 1), lines: option(argv, 'lines', 40) })
      : argv[0] === 'capture' ? captureMemory(context, decode(readBoundedFile(resolve(option(argv, 'handoff')),
        TASK_MEMORY_LIMITS.handoff, 'task memory handoff'))) : fail('operation');
  out(`memory-task ${JSON.stringify(result)}`); return 0;
}
