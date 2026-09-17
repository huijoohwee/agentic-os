import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_REF, SCHEMA, load, save, put, putExact } from '../src/lane-records.mjs';
import { workspaceLaneCache, WORKSPACE_CACHE_SCHEMA } from '../src/lane-cache-legacy.mjs';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lane-workspace-')), root = join(dir, 'repo');
  mkdirSync(root); git(root, 'init', '-q');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { root, workspace: join(dir, '.workspace'), enroll: () => git(root, 'config', '--local', 'agentic-os.laneCacheStorage', 'workspace-v1') };
}
const record = ref => ({ ref, state: 'active', writePaths: ['src/'] });
test('enrolled clone migrates without deleting its v1 blob or immutable local records', t => {
  const { root, enroll } = fixture(t), ref = 'agent/device/first';
  put(record(ref), root); const prior = git(root, 'rev-parse', CACHE_REF); enroll();
  put({ ...record(ref), state: 'published' }, root);
  const index = JSON.parse(git(root, 'cat-file', 'blob', CACHE_REF));
  assert.equal(index.schema, WORKSPACE_CACHE_SCHEMA);
  assert.equal(JSON.parse(git(root, 'cat-file', 'blob', prior)).schema, SCHEMA);
  assert.equal(load(root).lanes[ref].state, 'published');
  const files = readdirSync(workspaceLaneCache(root).directory), before = files.map(file => readFileSync(join(workspaceLaneCache(root).directory, file)));
  put(record('agent/device/second'), root);
  files.forEach((file, i) => assert.deepEqual(readFileSync(join(workspaceLaneCache(root).directory, file)), before[i]));
  assert.throws(() => putExact(record(ref), record(ref), root), /record drifted/);
});
test('shards retain more than 500KB of metadata while each file and Git index stays bounded', t => {
  const { root, enroll } = fixture(t); enroll();
  const lanes = Object.fromEntries(Array.from({ length: 80 }, (_, i) => {
    const ref = `agent/device/lane-${i}`; return [ref, { ...record(ref), handoff: { note: 'x'.repeat(8000) } }];
  }));
  assert(Buffer.byteLength(JSON.stringify(lanes)) > 500000);
  save({ schema: SCHEMA, lanes }, root);
  assert.equal(Object.keys(load(root).lanes).length, 80);
  assert(Number(git(root, 'cat-file', '-s', CACHE_REF)) < 500000);
  for (const file of readdirSync(workspaceLaneCache(root).directory)) assert(readFileSync(join(workspaceLaneCache(root).directory, file)).length < 500000);
});
test('corruption, symlink records and changed enrollment fail closed', t => {
  const { root, enroll, workspace } = fixture(t); enroll(); put(record('agent/device/one'), root);
  const index = JSON.parse(git(root, 'cat-file', 'blob', CACHE_REF));
  const path = join(workspaceLaneCache(root).directory, `${Object.values(index.records)[0].digest}.json`), bytes = readFileSync(path);
  writeFileSync(path, Buffer.alloc(bytes.length, 32)); assert.throws(() => load(root), /digest differs/);
  rmSync(path); writeFileSync(join(workspace, 'foreign'), bytes); symlinkSync(join(workspace, 'foreign'), path);
  assert.throws(() => load(root), /single-link file/);
  git(root, 'config', '--local', 'agentic-os.workspaceRoot', '../other'); assert.throws(() => load(root), /enrollment changed/);
});
test('concurrent publishers retain both records through the existing clone lock', async t => {
  const { root, enroll } = fixture(t); enroll();
  const module = new URL('../src/lane-records.mjs', import.meta.url).href;
  await Promise.all(['one', 'two'].map(name => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {put} from ${JSON.stringify(module)}; put(${JSON.stringify(record(`agent/device/${name}`))},${JSON.stringify(root)})`]);
    let stderr = ''; child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(stderr)));
  })));
  assert.deepEqual(Object.keys(load(root).lanes).sort(), ['agent/device/one', 'agent/device/two']);
});
