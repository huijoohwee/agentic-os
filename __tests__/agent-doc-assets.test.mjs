import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readinessClaims } from '../src/readiness-proof.mjs';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('runtime/agents/MIGRATION-DOCS.json'));
const pkg = JSON.parse(read('package.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('native documentation has bounded explicit assets, current links and separate historical proof', () => {
  assert.equal(manifest.continuityId, 'DURABLE-AGENT-WORKFLOWS-001');
  assert.equal(manifest.approvedRevision, '0.1.0');
  assert.equal(manifest.loadPolicy, 'on-demand');
  assert.equal(manifest.sourceHistoryRetained, true);
  assert.equal(manifest.phase, 'owner-assets-prepared-consumer-cutover-pending');
  assert.match(manifest.sourceRevision, /^[0-9a-f]{40}$/);
  assert.equal(manifest.files.length, 20);
  assert.equal(new Set(manifest.files.map(entry => entry.source)).size, 20);
  assert.equal(new Set(manifest.files.map(entry => entry.destination)).size, 20);
  assert.deepEqual(readdirSync(join(root, 'runtime/agents/docs')).sort(),
    manifest.files.map(entry => entry.destination.split('/').at(-1)).sort());
  let total = 0;
  for (const entry of manifest.files) {
    const path = join(root, entry.destination), bytes = readFileSync(path), text = bytes.toString('utf8');
    assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
    assert.match(entry.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(digest(bytes), entry.sha256, entry.destination);
    assert.equal(pkg.exports[entry.export], './' + entry.destination);
    assert.equal(fileURLToPath(import.meta.resolve('agentic-os/' + entry.export.slice(2))), path);
    assert.match(text, /^owner: "agentic-os"$/m);
    assert.match(text, /^load_policy: "on-demand"$/m);
    assert.match(text, /^status: "source-migrated-consumer-cutover-pending"$/m);
    assert.deepEqual(readinessClaims(text), [], entry.destination);
    assert.ok(text.trimEnd().split('\n').length < 600, entry.destination);
    total += bytes.length;
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#|\$)/.test(target)) continue;
      const actual = resolve(dirname(path), target.split('#')[0]);
      assert.ok(!relative(root, actual).startsWith('..'), target);
      assert.ok(lstatSync(actual).isFile(), `${entry.destination}: ${target}`);
    }
    for (const [, revision] of text.matchAll(/github\.com\/huijoohwee\/agentic-canvas-os\/blob\/([^/]+)\//g)) {
      assert.match(revision, /^[0-9a-f]{40}$/, 'Historical links require immutable revisions');
    }
  }
  assert.ok(total < 300_000, String(total));
});

test('packed documents retain exact asset bytes without executable entrypoints', t => {
  const temp = mkdtempSync(join(tmpdir(), 'agent-doc-assets-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
    { cwd: root, encoding: 'utf8', timeout: 30_000 }))[0];
  const inventory = new Set(pack.files.map(file => file.path));
  for (const entry of manifest.files) {
    assert.ok(inventory.has(entry.destination), entry.destination);
    const bytes = execFileSync('tar', ['-xOf', join(temp, pack.filename), 'package/' + entry.destination],
      { timeout: 10_000 });
    assert.equal(digest(bytes), entry.sha256);
    assert.match(entry.export, /^\.\/agent-docs\/[A-Z-]+\.md$/);
  }
});
