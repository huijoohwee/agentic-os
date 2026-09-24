import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeManagedRegion } from '../scripts/doc-sync.mjs';

const cli = fileURLToPath(new URL('../scripts/doc-sync.mjs', import.meta.url));
const templatePath = 'template/document-maintenance-template.md';
const sourcePrefix = 'https://github.com/huijoohwee/huijoohwee.github.io/blob/';
const markerStart = '<!-- agentic-os:doc-sync:start -->';
const markerEnd = '<!-- agentic-os:doc-sync:end -->';
const cleanup = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'doc-sync-test-'));
  cleanup.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Doc Sync Test');
  git(root, 'config', 'user.email', 'doc-sync@example.invalid');
  return root;
}
function commit(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  git(root, 'add', path);
  git(root, 'commit', '-qm', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}
function template(body) { return `${markerStart}\n${body}${markerEnd}\n`; }
function document(revision, body, notes = 'Local notes stay here.\n') {
  return `---\ntitle: "Pilot"\ndoc_type: "PRD-TAD-ADR-MVP-GTM"\nsource_docs:\n  - "${sourcePrefix}${revision}/${templatePath}"\n---\n# Pilot\n${markerStart}\n${body}${markerEnd}\n${notes}`;
}
function fixture(baseBody, nextBody, localBody = baseBody) {
  const source = repository();
  const repo = repository();
  const from = commit(source, templatePath, template(baseBody));
  const to = commit(source, templatePath, template(nextBody));
  const path = 'docs/pilot.md';
  const original = document(from, localBody);
  commit(repo, path, original);
  return { source, repo, from, to, path, original };
}
function invoke(f, mode, more = []) {
  return spawnSync(process.execPath, [cli, `--mode=${mode}`, `--repo=${f.repo}`,
    `--source-repo=${f.source}`, `--document=${f.path}`, `--to=${f.to}`, ...more],
  { encoding: 'utf8' });
}

test('disjoint managed edits merge while local notes stay out of the region', () => {
  const base = 'alpha\nkeep\nbeta\n';
  const local = 'alpha local\nkeep\nbeta\n';
  const next = 'alpha\nkeep\nbeta new\n';
  assert.equal(mergeManagedRegion(local, base, next), 'alpha local\nkeep\nbeta new\n');
  const f = fixture(base, next, local);
  const result = invoke(f, 'dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"changed":true/u);
  assert.equal(readFileSync(join(f.repo, f.path), 'utf8'), f.original);
  const check = invoke(f, 'check');
  assert.equal(check.status, 1);
  assert.match(check.stderr, /template revision drift/u);
});

test('overlap, missing baseline, and path escape fail without writing', () => {
  const f = fixture('alpha\n', 'alpha new\n', 'alpha local\n');
  const conflict = invoke(f, 'dry-run');
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /overlapping managed edits/u);
  assert.equal(readFileSync(join(f.repo, f.path), 'utf8'), f.original);
  const missing = invoke({ ...f, to: 'a'.repeat(40) }, 'dry-run');
  assert.equal(missing.status, 1);
  const escape = invoke({ ...f, path: '../pilot.md' }, 'dry-run');
  assert.equal(escape.status, 1);
});

test('same pinned source is current; apply requires a native lane', () => {
  const f = fixture('alpha\n', 'beta\n');
  const current = invoke({ ...f, to: f.from }, 'check');
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /current/u);
  const unbound = invoke(f, 'apply', [`--expected-head=${git(f.repo, 'rev-parse', 'HEAD')}`]);
  assert.equal(unbound.status, 1);
  assert.match(unbound.stderr, /bound native lane/u);
  assert.equal(readFileSync(join(f.repo, f.path), 'utf8'), f.original);
});
