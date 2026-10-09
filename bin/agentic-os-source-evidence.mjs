#!/usr/bin/env node
/** Build a local, immutable, public-readonly source-evidence bundle. It never uploads. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCodebaseContext } from './agentic-os-context-index.mjs';
import { option } from './agentic-os-argv.mjs';
import {
  SOURCE_EVIDENCE_CATALOG_SCHEMA, SOURCE_EVIDENCE_LIMITS, SOURCE_EVIDENCE_MANIFEST_SCHEMA,
  isSourceEvidenceId, isSourceEvidencePath,
} from '../runtime/source-evidence-contract.mjs';

const fail = reason => { throw new Error(`blocked-source-evidence-${reason}`); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = value => JSON.stringify(value, null, 2) + '\n';
function outputDirectory(value) {
  const directory = resolve(value || '');
  if (!value || (existsSync(directory) && readdirSync(directory).length)) fail('output-directory-must-be-empty');
  return directory;
}
function emitFile(root, relative, content) {
  const target = resolve(root, relative);
  if (!target.startsWith(root + '/')) fail('output-escape');
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
}

export function buildSourceEvidenceBundle({ root = process.cwd(), scope, id, label, output } = {}) {
  root = resolve(root); output = outputDirectory(output);
  if (!isSourceEvidenceId(id) || typeof label !== 'string' || !label.trim() || label.length > 160 || !isSourceEvidencePath(scope || '')) fail('arguments');
  if (output === root || output.startsWith(root + '/')) fail('output-must-not-be-inside-source-root');
  const revision = git(root, ['rev-parse', '--verify', 'HEAD']), tree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']);
  if (!/^[a-f0-9]{40}$/u.test(revision) || !/^[a-f0-9]{40}$/u.test(tree) || git(root, ['status', '--porcelain', '--untracked-files=normal'])) fail('clean-committed-source-required');
  const context = createCodebaseContext({ root }), entries = [];
  let after = null;
  do {
    const page = context.map({ path: scope, limit: 20, after });
    entries.push(...page.results); after = page.nextAfter;
  } while (after);
  if (!entries.length || entries.length > SOURCE_EVIDENCE_LIMITS.files) fail('narrow-scope-required');
  const trace = context.traceSession(), source = entries.map(entry => trace.traceSource(entry.path).file);
  trace.verify();
  const snapshotSha256 = sha256(JSON.stringify(source.map(file => [file.path, file.sha256])));
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  const files = source.map(file => {
    const metadata = byPath.get(file.path), objectKey = `source-evidence/${id}/${snapshotSha256}/${file.sha256}.txt`;
    emitFile(output, objectKey, file.text);
    return { path: file.path, sha256: file.sha256, bytes: file.bytes, objectKey,
      facts: (metadata.facts || []).slice(0, SOURCE_EVIDENCE_LIMITS.factsPerFile),
      imports: (metadata.imports || []).slice(0, SOURCE_EVIDENCE_LIMITS.importsPerFile) };
  });
  const manifest = { schema: SOURCE_EVIDENCE_MANIFEST_SCHEMA, repository: { id, label: label.trim() }, revision, tree,
    snapshotSha256, sourceMode: 'committed-clean', files };
  const manifestBody = json(manifest);
  if (Buffer.byteLength(manifestBody) > SOURCE_EVIDENCE_LIMITS.manifestBytes) fail('narrow-metadata-required');
  const manifestKey = `source-evidence/${id}/${snapshotSha256}/manifest.json`;
  emitFile(output, manifestKey, manifestBody);
  const catalog = { schema: SOURCE_EVIDENCE_CATALOG_SCHEMA, title: 'Published source evidence', readOnly: true,
    repositories: [{ id, label: label.trim(), manifestKey }] };
  emitFile(output, 'source-evidence/catalog.json', json(catalog));
  return Object.freeze({ schema: 'agentic-os/source-evidence-bundle/v1', repository: { id, label: label.trim() }, revision, tree,
    snapshotSha256, files: files.length, output, catalogKey: 'source-evidence/catalog.json', manifestKey });
}

export function runSourceEvidenceBundle(argv, out = value => process.stdout.write(`${value}\n`)) {
  if (argv[0] !== 'bundle') fail('command');
  const result = buildSourceEvidenceBundle({ root: option(argv, 'root') ?? process.cwd(), scope: option(argv, 'scope'),
    id: option(argv, 'id'), label: option(argv, 'label'), output: option(argv, 'output') });
  out(JSON.stringify(result)); return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) runSourceEvidenceBundle(process.argv.slice(2));
