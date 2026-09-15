import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readinessClaims } from '../src/readiness-proof.mjs';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path));
const manifest = JSON.parse(read('runtime/agents/MIGRATION-DOCS.json'));
const pkg = JSON.parse(read('package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('historical provider proof retains exact original bytes and cannot become current runtime authority', () => {
  assert.equal(manifest.history.length, 1);
  const [entry] = manifest.history, bytes = read(entry.destination);
  assert.equal(entry.sourceRevision, 'dae927d40f3e8e55687334ed47c2be5dffe14b36');
  assert.equal(entry.sourceSha256, '563f38ae5325d06fbdf6b701b77eb7a9300ffc211700ab9cd6b0b48392addf4a');
  assert.equal(hash(bytes), entry.sha256);
  const text = bytes.toString('utf8');
  assert.equal(entry.encoding, 'fenced-original-markdown/v1');
  const original = text.split('<!-- historical-source-begin -->\n````markdown\n')[1]?.split('````\n<!-- historical-source-end -->')[0];
  assert.equal(hash(original), entry.sourceSha256);
  assert.equal(Buffer.byteLength(original), entry.sourceBytes);
  assert.deepEqual(readinessClaims(text), []);
  assert.equal(entry.editable, false);
  assert.equal(entry.currentRuntimeProof, false);
  assert.match(entry.scope, /Historical.*no current free-core or production authority/);
  assert.equal(entry.sourceUrl, 'https://github.com/huijoohwee/agentic-canvas-os/blob/'
    + entry.sourceRevision + '/' + entry.source);
  assert.equal(pkg.exports[entry.export], './' + entry.destination);
  assert.equal(fileURLToPath(import.meta.resolve('agentic-os/' + entry.export.slice(2))), join(root, entry.destination));
  assert.ok(lstatSync(join(root, entry.destination)).isFile());
  assert.deepEqual(readdirSync(join(root, 'runtime/agents/history')), ['LIVE-AGENT-PROVIDER-PROOF.md']);
  assert.ok(!manifest.files.some(file => file.destination === entry.destination));
});

test('packed historical proof is an explicit data asset with unchanged bytes', t => {
  const temp = mkdtempSync(join(tmpdir(), 'agent-doc-history-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
    { cwd: root, encoding: 'utf8', timeout: 30000 }))[0];
  const [entry] = manifest.history;
  assert.ok(pack.files.some(file => file.path === entry.destination));
  const bytes = execFileSync('tar', ['-xOf', join(temp, pack.filename), 'package/' + entry.destination], { timeout: 10000 });
  assert.equal(hash(bytes), entry.sha256);
});

test('fleet discovery resolves transferred capabilities to their existing native source owner', () => {
  const policy = JSON.parse(read('catalog/fleet-ownership.json'));
  for (const id of ['agent-facade', 'chat-prompt-presets', 'skills-catalog']) {
    const entries = policy.responsibilities.filter(entry => entry.id === id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].owner, 'github.com/huijoohwee/agentic-os');
    assert.ok(lstatSync(join(root, entries[0].source)).isFile());
  }
});
