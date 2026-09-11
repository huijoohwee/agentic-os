/** Native, bounded source context. Git supplies visibility; current bytes supply freshness. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { observeGit, repoRoot, assertDirectoryAncestors } from '../src/git.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { freezeJson } from '../runtime/json-contract.mjs';

export const CONTEXT_LIMITS = Object.freeze({ files: 512, fileBytes: 128 * 1024,
  sourceBytes: 4 * 1024 * 1024, inventoryBytes: 128 * 1024, outputBytes: 16 * 1024,
  results: 20, lines: 80, queryBytes: 256, facts: 128, durationMs: 10_000 });
const EXTENSIONS = new Set('js mjs cjs jsx ts tsx md mdx json jsonc py go rs css html yaml yml toml sql sh'.split(' '));
const DENIED = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.ssh|\.aws|\.workspace|node_modules|dist|build|coverage|secrets?|credentials?)(?:\/|\.|$)/iu;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error(`blocked-context-${reason}`); };
const git = (root, args) => observeGit(args, { cwd: root, binary: true,
  maxBuffer: CONTEXT_LIMITS.inventoryBytes });
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function contextPath(value) {
  if (typeof value !== 'string' || value.length > 512 || !value
    || value.split('/').some(part => !part || part === '.' || part === '..')
    || /[\\:\x00-\x1f\x7f]/u.test(value) || DENIED.test(value)) fail('unsafe-path');
  return value;
}
export function contextInteger(value, min, max) {
  if (!/^\d+$/u.test(String(value)) || !Number.isSafeInteger(Number(value))
    || Number(value) < min || Number(value) > max) fail('numeric-budget');
  return Number(value);
}
export function boundedContext(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > CONTEXT_LIMITS.outputBytes) fail('output-budget-narrow-selection');
  return freezeJson(value);
}
function inventory(root, scope) {
  const raw = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', `:(literal)${scope}`]);
  const paths = [...new Set(decode(raw).split('\0').filter(Boolean))].sort(compare);
  if (paths.length > CONTEXT_LIMITS.files) fail('file-count-narrow-path');
  return paths;
}
function source(root, path) {
  contextPath(path);
  assertDirectoryAncestors(path, root);
  const absolute = join(root, path);
  const before = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink()) fail('regular-source-required');
  const bytes = readBoundedFile(absolute, CONTEXT_LIMITS.fileBytes, 'context source',
    { expectedIdentity: before, expectedPath: absolute });
  const after = lstatSync(absolute, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('source-changed-retry');
  const text = decode(bytes);
  if (text.includes('\0')) fail('text-required');
  return { path, sha256: hash(bytes), bytes: bytes.length, text, lines: text.split('\n') };
}
function structure(file) {
  const facts = [], imports = [];
  const add = (kind, value, line) => {
    if (facts.length + imports.length >= CONTEXT_LIMITS.facts) fail('structure-budget-narrow-file');
    const record = { kind, value: value.trim(), line };
    (kind === 'import' ? imports : facts).push(record);
  };
  const script = /\.[cm]?[jt]sx?$/u.test(file.path);
  file.lines.forEach((line, index) => {
    const heading = /\.mdx?$/u.test(file.path) && line.match(/^#{1,6}\s+(.+)$/u);
    if (heading) add('heading', heading[1], index + 1);
    // Lexical navigation hints, deliberately not a parser, call graph or executable claim.
    const exported = script && line.match(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/u);
    if (exported) add('export', exported[1], index + 1);
    const imported = script && line.match(/^\s*(?:import|export)\b.*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/u);
    if (imported) add('import', imported[1] ?? imported[2], index + 1);
  });
  return { facts, imports };
}

/** Each instance retains at most one scope's metadata; never retains source bodies between calls. */
export function createCodebaseContext({ root = process.cwd() } = {}) {
  root = realpathSync(resolve(root));
  if (realpathSync(repoRoot(root)) !== root) fail('repository-root-required');
  let previous = new Map();
  function snapshot(path) {
    const scope = contextPath(path), started = Date.now();
    const revision = decode(git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
    const paths = inventory(root, scope), files = [], excluded = [], next = new Map();
    let bytes = 0, reused = 0, parsed = 0;
    for (const path of paths) {
      if (Date.now() - started > CONTEXT_LIMITS.durationMs) fail('deadline-narrow-path');
      if (DENIED.test(path) || !EXTENSIONS.has(path.split('.').at(-1))) {
        excluded.push({ path, reason: 'excluded-path-or-format' }); continue;
      }
      const file = source(root, path);
      if (!file) { excluded.push({ path, reason: 'deleted-working-file' }); continue; }
      bytes += file.bytes;
      if (bytes > CONTEXT_LIMITS.sourceBytes) fail('source-byte-budget-narrow-path');
      const cached = previous.get(path);
      const metadata = cached?.sha256 === file.sha256 ? cached.metadata : structure(file);
      if (cached?.sha256 === file.sha256) reused += 1; else parsed += 1;
      next.set(path, { sha256: file.sha256, metadata });
      files.push({ ...file, ...metadata });
    }
    if (JSON.stringify(inventory(root, scope)) !== JSON.stringify(paths)
      || decode(git(root, ['rev-parse', '--verify', 'HEAD'])).trim() !== revision) fail('inventory-changed-retry');
    // Re-read exact bytes, including edits whose size and mtime were deliberately preserved.
    for (const file of files) {
      if (Date.now() - started > CONTEXT_LIMITS.durationMs) fail('deadline-narrow-path');
      if (source(root, file.path)?.sha256 !== file.sha256) fail('source-changed-retry');
    }
    previous = next;
    const digest = hash(JSON.stringify(files.map(file => [file.path, file.sha256])));
    return { files, receipt: { schema: 'agentic-os/codebase-context/v1', repositoryRoot: root, scope, revision,
      snapshotSha256: digest, sourceMode: 'working-tree', freshness: 'bytes-verified-during-read',
      atomicSnapshot: false, remoteFreshness: 'not-checked', grantsAuthority: false,
      untrustedSourceContent: true, fileCount: files.length, excludedCount: excluded.length,
      sourceBytes: bytes, parsedFiles: parsed, reusedFiles: reused,
      coverage: 'explicit-scope-text; lexical-navigation-only', excluded } };
  }
  const reference = file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes });
  function page(items, limit, after, key) {
    limit = contextInteger(limit, 1, CONTEXT_LIMITS.results);
    if (after !== null) contextPath(after);
    const remaining = items.filter(item => after === null || compare(key(item), after) > 0);
    const result = remaining.slice(0, limit);
    return { results: result, totalMatches: items.length,
      nextAfter: remaining.length > limit ? key(result.at(-1)) : null };
  }
  function map({ path, limit = 10, after = null }) {
    const { files, receipt } = snapshot(path), known = new Set(files.map(file => file.path));
    const result = page(files.map(file => ({ ...reference(file), facts: file.facts,
      imports: file.imports.map(item => {
        const target = item.value.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file.path), item.value)) : null;
        return { ...item, target: target && known.has(target) ? target : null,
          resolution: target && known.has(target) ? 'exact-relative-file' : 'unresolved' };
      }) })), limit, after, item => item.path);
    return boundedContext({ ...receipt, operation: 'map', ...result });
  }
  function search({ path, query, limit = 5, after = null }) {
    if (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query) > CONTEXT_LIMITS.queryBytes
      || /[\x00-\x1f\x7f]/u.test(query)) fail('query');
    const { files, receipt } = snapshot(path), needle = query.trim().toLowerCase();
    const matches = [];
    for (const file of files) {
      const lines = file.lines.flatMap((text, index) => text.toLowerCase().includes(needle) ? [index + 1] : []);
      const pathMatch = file.path.toLowerCase().includes(needle);
      if (!lines.length && !pathMatch) continue;
      const line = lines[0] ?? 1;
      matches.push({ ...reference(file), line, matchingLines: lines.length, pathMatch,
        excerpt: file.lines.slice(Math.max(0, line - 2), line + 2).join('\n'),
        excerptStartLine: Math.max(1, line - 1), read: { path: file.path, sha256: file.sha256, line } });
    }
    return boundedContext({ ...receipt, operation: 'search', query,
      selection: 'literal-case-insensitive; path-order; first-hit-per-file',
      ...page(matches, limit, after, item => item.path) });
  }
  function read({ path, sha256, line = 1, lines = 40 }) {
    contextPath(path);
    if (!/^[a-f0-9]{64}$/u.test(sha256 ?? '')) fail('exact-source-sha256-required');
    line = contextInteger(line, 1, 1_000_000); lines = contextInteger(lines, 1, CONTEXT_LIMITS.lines);
    const { files, receipt } = snapshot(path), file = files.find(item => item.path === path);
    if (!file || file.sha256 !== sha256) fail('missing-excluded-or-stale-source-search-again');
    if (line > file.lines.length) fail('line-out-of-range');
    const selected = file.lines.slice(line - 1, line - 1 + lines);
    return boundedContext({ ...receipt, operation: 'read', ...reference(file), line,
      content: selected.join('\n'), nextLine: line + selected.length <= file.lines.length
        ? line + selected.length : null });
  }
  return Object.freeze({ map, search, read });
}
