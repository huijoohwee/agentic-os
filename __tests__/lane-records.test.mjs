import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import {
  CACHE_LIMITS, SCHEMA, get, load, put, save, storePath,
} from '../src/lane-records.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repository(t, prefix = 'agentic-os-lane-cache-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  return root;
}
function validStore(ref = 'agent/device/cache') {
  return { schema: SCHEMA, lanes: { [ref]: { ref, state: 'active' } } };
}

test('a missing cache recovers empty and bounded records round-trip as non-authoritative hints', (t) => {
  const root = repository(t);
  assert.deepEqual(Object.keys(load(root).lanes), []);
  const ref = 'agent/device/cache';
  put({ ref, state: 'published', head: 'a'.repeat(40) }, root);
  assert.equal(get(ref, root).state, 'published');
  assert.equal(load(root).lanes[ref].head, 'a'.repeat(40));
});

test('a recognized legacy cache projects retired ejections without rewriting its bytes', (t) => {
  const root = repository(t);
  const ref = 'agent/device/legacy';
  const file = storePath(root);
  const legacy = { schema: SCHEMA, lanes: { [ref]: {
    ref, state: 'published', head: 'a'.repeat(40), ejections: 0,
  } } };
  mkdirSync(dirname(file), { recursive: true });
  const bytes = `${JSON.stringify(legacy, null, 2)}\n`;
  writeFileSync(file, bytes);

  assert.deepEqual(JSON.parse(JSON.stringify(load(root))), {
    schema: SCHEMA, lanes: { [ref]: { ref, state: 'published', head: 'a'.repeat(40) } },
  });
  writeFileSync(file, `${JSON.stringify({ schema: SCHEMA, lanes: { [ref]: {
    ref, state: 'published', ejections: -1,
  } } })}\n`);
  assert.throws(() => load(root), /record shape is invalid/u);
  writeFileSync(file, bytes);
  save(load(root), root);
  assert.equal(readFileSync(file, 'utf8'), bytes);
  assert.equal(get(ref, root).ejections, undefined);
});

test('concurrent distinct-ref cache updates retain every device projection', async (t) => {
  const root = repository(t, 'agentic-os-lane-cache-concurrent-');
  const moduleUrl = new URL('../src/lane-records.mjs', import.meta.url).href;
  const refs = Array.from({ length: 24 }, (_, index) => `agent/device-${index}/cache`);
  const updates = refs.map((ref) => new Promise((resolve, reject) => {
    const source = `import {put} from ${JSON.stringify(moduleUrl)};put({ref:${JSON.stringify(ref)},state:'active'},${JSON.stringify(root)});`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`cache writer failed (${code ?? signal}): ${stderr}`));
    });
  }));
  await Promise.all(updates);
  assert.deepEqual(Object.keys(load(root).lanes).sort(), refs.sort());
});

test('present malformed, invalid-UTF-8, oversized, and non-regular caches fail loudly', async (t) => {
  const root = repository(t);
  const file = storePath(root);
  mkdirSync(dirname(file), { recursive: true });
  await t.test('shape', () => {
    writeFileSync(file, JSON.stringify({ schema: SCHEMA, lanes: [] }));
    assert.throws(() => load(root), /blocked-lane-cache-invalid|schema is invalid/u);
  });
  await t.test('UTF-8', () => {
    writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => load(root), /must be UTF-8/u);
  });
  await t.test('bytes', () => {
    writeFileSync(file, Buffer.alloc(CACHE_LIMITS.bytes + 1, 0x20));
    assert.throws(() => load(root), /byte budget exceeded/u);
  });
  await t.test('FIFO', () => {
    rmSync(file);
    assert.equal(spawnSync('mkfifo', [file]).status, 0);
    const probe = spawnSync(process.execPath, [
      '--input-type=module', '--eval',
      `import {load} from ${JSON.stringify(new URL('../src/lane-records.mjs', import.meta.url).href)};load(${JSON.stringify(root)});`,
    ], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(probe.signal, null, 'lane cache FIFO read timed out');
    assert.equal(probe.status, 1);
    assert.match(probe.stderr, /lane cache must be a regular file/u);
  });
});

test('writes reject oversized, sparse, inherited, and over-count snapshots before publication', (t) => {
  const root = repository(t);
  const ref = 'agent/device/cache';
  const oversized = validStore(ref);
  oversized.lanes[ref].handoff = { note: 'x'.repeat(CACHE_LIMITS.stringBytes + 1) };
  assert.throws(() => save(oversized, root), /string byte budget exceeded/u);

  const sparse = validStore(ref);
  sparse.lanes[ref].handoff = { steps: [] };
  sparse.lanes[ref].handoff.steps[1] = 'gap';
  assert.throws(() => save(sparse, root), /arrays must be dense/u);

  const inherited = validStore(ref);
  inherited.lanes[ref].handoff = { receipt: Object.create({ inherited: true }) };
  assert.throws(() => save(inherited, root), /plain JSON values/u);

  const mistyped = validStore(ref);
  mistyped.lanes[ref].state = { active: true };
  assert.throws(() => save(mistyped, root), /record state is invalid/u);

  const many = { schema: SCHEMA, lanes: {} };
  for (let index = 0; index <= CACHE_LIMITS.lanes; index += 1) {
    const lane = `agent/device/cache-${index}`;
    many.lanes[lane] = { ref: lane, state: 'active' };
  }
  assert.throws(() => save(many, root), /lane count budget exceeded/u);
  assert.equal(existsSync(storePath(root)), false);
});

test('legacy temp residue is preserved and excluded from ref-backed cache publication', (t) => {
  const root = repository(t);
  const file = storePath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, 'foreign residue\n');
  save(validStore(), root);
  assert.equal(readFileSync(tmp, 'utf8'), 'foreign residue\n');
  assert.equal(existsSync(file), false);
  assert.deepEqual(JSON.parse(JSON.stringify(load(root))), validStore());
});

test('cache publication refuses a pre-existing symlink directory before writing through it', (t) => {
  const root = repository(t);
  const external = join(root, 'external-cache-target');
  mkdirSync(external);
  symlinkSync(external, dirname(storePath(root)), 'dir');
  assert.throws(() => save(validStore(), root), /directory is unsafe/u);
  assert.deepEqual(readdirSync(external), []);
});

test('status fails loudly on a present invalid cache instead of treating it as empty', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-status-cache-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repo',
    canonical: {
      localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(root, 'add', '.agentic-os.json');
  runGit(root, 'commit', '--quiet', '--message', 'fixture');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  const file = storePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{"schema":"wrong","lanes":{}}\n');
  const result = spawnSync(process.execPath, [CLI, 'status', '--device=device'], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-lane-cache-invalid/u);
});
