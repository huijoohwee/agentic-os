#!/usr/bin/env node
// Reviewed, single-document Markdown template maintenance. No network or hooks.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBoundLane } from '../src/guard-main.mjs';
import { acquireOperationLock, finishOperationLock } from '../src/git.mjs';
import { list as laneRecords } from '../src/lane-records.mjs';

const START = '<!-- agentic-os:doc-sync:start -->';
const END = '<!-- agentic-os:doc-sync:end -->';
const SOURCE = 'https://github.com/huijoohwee/huijoohwee.github.io/blob/';
const TEMPLATE = 'template/document-maintenance-template.md';
const MAX_BYTES = 499999;

function fail(message) { throw new Error(message); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BYTES + 1024 });
}
function options(argv) {
  const allowed = new Set(['mode', 'repo', 'source-repo', 'document', 'to', 'expected-head']);
  const result = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    if (!match || !allowed.has(match[1]) || result[match[1]]) fail(`unknown or duplicate option: ${arg}`);
    result[match[1]] = match[2];
  }
  for (const key of ['mode', 'repo', 'source-repo', 'document', 'to']) {
    if (!result[key]) fail(`missing --${key}`);
  }
  if (!['check', 'dry-run', 'apply'].includes(result.mode)) fail('invalid mode');
  if (!/^[a-f0-9]{40}$/u.test(result.to)) fail('target revision must be a full SHA-1 commit');
  return result;
}
function regularUnder(root, path) {
  const absolute = resolve(root, path);
  const inside = relative(root, absolute);
  if (!inside || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) fail('path escapes repository');
  let current = root;
  for (const piece of inside.split(sep)) {
    current = join(current, piece);
    if (!existsSync(current)) fail(`missing path: ${inside}`);
    if (lstatSync(current).isSymbolicLink()) fail(`symlink path: ${inside}`);
  }
  if (!lstatSync(absolute).isFile()) fail(`non-regular file: ${inside}`);
  if (lstatSync(absolute).size > MAX_BYTES) fail(`oversize file: ${inside}`);
  return absolute;
}
function boundedText(bytes, label) {
  if (bytes.length > MAX_BYTES || bytes.includes(0)) fail(`oversize or binary ${label}`);
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (value.split('\n').length >= 600) fail(`line budget exceeded: ${label}`);
  if (value.includes('\r')) fail(`unsupported CRLF: ${label}`);
  return value;
}
function region(text, label) {
  if (text.split(START).length !== 2 || text.split(END).length !== 2) fail(`ambiguous markers: ${label}`);
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= end || text[start + START.length] !== '\n' || text[end - 1] !== '\n') fail(`invalid markers: ${label}`);
  return { start, end, body: text.slice(start + START.length + 1, end) };
}
function provenance(text) {
  if (!text.startsWith('---\n')) fail('YAML frontmatter required');
  const close = text.indexOf('\n---\n', 4);
  if (close < 0) fail('unterminated frontmatter');
  const front = text.slice(4, close);
  if ((front.match(/^source_docs\s*:/gmu) ?? []).length !== 1) fail('one source_docs field required');
  if (/^doc_type:\s*(?:["']?)(?:Prompt|Skill|Agent|Runtime|Workflow)/imu.test(front)) fail('executable document excluded');
  const lines = front.split('\n');
  const sourceLine = lines.findIndex((line) => /^source_docs:[ \t]*$/u.test(line));
  if (sourceLine < 0) fail('source_docs must be a block list');
  const sourceLines = [];
  for (const line of lines.slice(sourceLine + 1)) {
    if (line && !/^[ \t]/u.test(line)) break;
    sourceLines.push(line);
  }
  const matches = [...sourceLines.join('\n').matchAll(/^[ \t]+-[ \t]*["']?(https:\/\/github\.com\/huijoohwee\/huijoohwee\.github\.io\/blob\/([a-f0-9]{40})\/template\/document-maintenance-template\.md)["']?[ \t]*$/gmu)];
  if (matches.length !== 1) fail('one exact template source_docs entry required');
  const sourceHeader = /^source_docs:[ \t]*$/mu.exec(front);
  const firstSourceLine = front.indexOf('\n', sourceHeader.index) + 1;
  const urlOffset = 4 + firstSourceLine + matches[0].index + matches[0][0].indexOf(matches[0][1]);
  return { url: matches[0][1], from: matches[0][2], urlOffset };
}
function sourceText(sourceRepo, revision) {
  const object = execFileSync('git', ['show', `${revision}:${TEMPLATE}`],
    { cwd: sourceRepo, maxBuffer: MAX_BYTES + 1024 });
  return boundedText(object, `template ${revision}`);
}
function mergedBody(local, base, next) {
  if (local === base) return next;
  if (next === base) return local;
  const dir = mkdtempSync(join(tmpdir(), 'agentic-os-doc-sync-'));
  try {
    const paths = ['local', 'base', 'next'].map((name) => join(dir, name));
    for (const [index, data] of [local, base, next].entries()) writeFileSync(paths[index], data, { flag: 'wx', mode: 0o600 });
    const result = spawnSync('git', ['merge-file', '-p', '--', ...paths], { encoding: 'utf8', maxBuffer: MAX_BYTES + 1024 });
    if (result.status !== 0) fail(result.status === 1 ? 'overlapping managed edits' : 'merge failed');
    return result.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function previewDiff(document, before, after) {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-os-doc-diff-'));
  try {
    writeFileSync(join(dir, 'before.md'), before, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(dir, 'after.md'), after, { flag: 'wx', mode: 0o600 });
    const result = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--', 'before.md', 'after.md'],
      { cwd: dir, encoding: 'utf8', maxBuffer: MAX_BYTES });
    if (result.status !== 1 || result.error) fail('bounded diff generation failed');
    const diff = result.stdout.replace(/^diff --git a\/before\.md b\/after\.md\n/u,
      `diff --git a/${document} b/${document}\n`)
      .replace(/^--- a\/before\.md$/mu, `--- a/${document}`)
      .replace(/^\+\+\+ b\/after\.md$/mu, `+++ b/${document}`);
    if (Buffer.byteLength(diff) > MAX_BYTES) fail('diff exceeds report budget');
    return diff;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function applyFile(path, previous, next) {
  const temporary = join(dirname(path), `.agentic-os-doc-sync-${randomUUID()}.tmp`);
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) fail('document identity changed before apply');
  if (readFileSync(path, 'utf8') !== previous) fail('document changed during preparation');
  let created = false;
  try {
    writeFileSync(temporary, next, { flag: 'wx', mode: before.mode & 0o777 });
    created = true;
    const after = lstatSync(path);
    if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) {
      fail('document identity changed before rename');
    }
    if (readFileSync(path, 'utf8') !== previous) fail('document changed before apply');
    renameSync(temporary, path);
  } finally { if (created && existsSync(temporary)) rmSync(temporary); }
}

export { mergedBody as mergeManagedRegion };

export function run(argv) {
  const args = options(argv);
  const repo = realpathSync(args.repo);
  const sourceRepo = realpathSync(args['source-repo']);
  if (git(repo, 'rev-parse', '--show-toplevel').trim() !== repo) fail('--repo must name repository root');
  if (git(sourceRepo, 'rev-parse', '--show-toplevel').trim() !== sourceRepo) fail('--source-repo must name repository root');
  const document = args.document;
  if (isAbsolute(document) || document.includes('\\') || /[\x00-\x1f\x7f]/u.test(document)
    || !document.endsWith('.md') || /(?:^|\/)(?:\.github|AGENTS\.md|SKILL\.md|SYSTEM-PROMPT|prompt|runtime)(?:\/|$)/iu.test(document)) fail('document is outside non-executable Markdown scope');
  const path = regularUnder(repo, document);
  const content = boundedText(readFileSync(path), document);
  const old = provenance(content);
  if (old.url !== `${SOURCE}${old.from}/${TEMPLATE}`) fail('untrusted source_docs locator');
  if (git(sourceRepo, 'rev-parse', `${old.from}^{commit}`).trim() !== old.from) fail('missing baseline commit');
  if (git(sourceRepo, 'rev-parse', `${args.to}^{commit}`).trim() !== args.to) fail('missing target commit');
  if (spawnSync('git', ['merge-base', '--is-ancestor', old.from, args.to], { cwd: sourceRepo }).status !== 0) {
    fail('target template revision must descend from the pinned baseline');
  }
  const localRegion = region(content, document);
  if (localRegion.start < content.indexOf('\n---\n', 4) + 5) fail('managed region must follow frontmatter');
  const base = region(sourceText(sourceRepo, old.from), 'baseline template').body;
  const next = region(sourceText(sourceRepo, args.to), 'target template').body;
  const merged = mergedBody(localRegion.body, base, next);
  const updated = content.slice(0, localRegion.start + START.length + 1) + merged + content.slice(localRegion.end);
  const candidate = updated.slice(0, old.urlOffset) + `${SOURCE}${args.to}/${TEMPLATE}`
    + updated.slice(old.urlOffset + old.url.length);
  if (candidate === content) { process.stdout.write(`${document}: current\n`); return 0; }
  boundedText(Buffer.from(candidate), 'candidate');
  if (args.mode === 'check') fail(`${document}: template revision drift ${old.from} -> ${args.to}`);
  if (args.mode === 'dry-run') {
    process.stdout.write(JSON.stringify({ document, from: old.from, to: args.to,
      before: sha(content), after: sha(candidate), changed: true }) + '\n');
    process.stdout.write(previewDiff(document, content, candidate));
    return 0;
  }
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  if (args['expected-head'] !== head) fail('apply requires matching --expected-head');
  const branch = git(repo, 'symbolic-ref', '--short', 'HEAD').trim();
  if (!isBoundLane(branch, repo)) fail('apply requires a bound native lane');
  const record = laneRecords(repo).find((row) => row.ref === branch);
  if (!record || record.state !== 'active' || record.pr !== null
    || realpathSync(record.worktree) !== repo || !record.writePaths.includes(document)) {
    fail('apply requires active admission of the exact document');
  }
  const lock = acquireOperationLock('agentic-os-doc-sync', repo);
  if (!lock) fail('another document sync is active');
  let error = null;
  try {
    if (git(repo, 'rev-parse', 'HEAD').trim() !== head) fail('head changed before apply');
    if (git(repo, 'status', '--porcelain', '--untracked-files=all').trim()) fail('apply requires a clean lane');
    applyFile(path, content, candidate);
  } catch (caught) { error = caught; }
  finishOperationLock(lock, { label: 'doc-sync', result: null, error });
  process.stdout.write(JSON.stringify({ document, from: old.from, to: args.to,
    before: sha(content), after: sha(candidate), applied: true }) + '\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`doc-sync: ${error.message}\n`); process.exitCode = 1; }
}
