import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync,
  symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { COMPOSITION_READ_LIMITS, compositionRevision, createCompositionHeadReader,
  readCompositionHeadFile, TRUSTED_COMPOSITION_GIT } from '../bin/composition-git.mjs';
import { observeCompositionRuntime } from '../bin/composition-runtime-check.mjs';

function fixture(t, sources = { 'one.txt': 'bound one\n', 'nested/two.txt': 'bound two\n' }) {
  const parent = mkdtempSync(path.join(tmpdir(), 'composition-read-')), root = path.join(parent, 'repo');
  t.after(() => rmSync(parent, { recursive: true, force: true })); mkdirSync(root);
  const git = (...args) => {
    const result = childProcess.spawnSync(TRUSTED_COMPOSITION_GIT, args, { cwd: root, encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '-q'); git('config', 'user.name', 'Read fixture');
  git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.hooksPath', '/dev/null');
  for (const [relative, bytes] of Object.entries(sources)) {
    const target = path.join(root, relative); mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  git('add', '.'); git('commit', '-qm', 'source fixture');
  return { parent, root, sources, git, revision: compositionRevision(root) };
}
const code = expected => error => error?.code === expected;
function countMetadata(t) {
  const original = childProcess.execFileSync, calls = [];
  t.mock.method(childProcess, 'execFileSync', (file, args, options) => {
    if (args.includes('ls-tree')) calls.push({ file, args, options });
    return original(file, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

test('one bounded metadata batch replaces repeated Git queries while every file is reread', t => {
  const sources = Object.fromEntries(Array.from({ length: 32 }, (_, index) =>
    [`source-${index}.txt`, `bound content ${index}\n`]));
  const f = fixture(t, sources), paths = Object.keys(sources), calls = countMetadata(t);
  const started = performance.now();
  for (let pass = 0; pass < 2; pass += 1) for (const relative of paths)
    assert.equal(readCompositionHeadFile(f.root, f.revision, relative, 1024, 'single').bytes.toString(), sources[relative]);
  const singleMs = performance.now() - started;
  assert.equal(calls.length, 64); calls.length = 0;
  const batchedStart = performance.now(), read = createCompositionHeadReader(f.root, f.revision, paths);
  for (let pass = 0; pass < 2; pass += 1) for (const relative of paths) {
    const observed = read(relative, 1024, 'batched');
    assert.equal(observed.bytes.toString(), sources[relative]);
    observed.bytes.fill(0);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, TRUSTED_COMPOSITION_GIT);
  assert.equal(calls[0].options.maxBuffer, COMPOSITION_READ_LIMITS.metadataBytes);
  assert.equal(calls[0].options.env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(calls[0].options.env.GIT_NO_LAZY_FETCH, '1');
  t.diagnostic(`32 files, two raw reads each: metadata processes 64 -> 1; single ${singleMs.toFixed(1)} ms, batch ${(performance.now() - batchedStart).toFixed(1)} ms.`);
});

test('same-size edits with restored mtime and later commits cannot reuse a byte verdict', t => {
  const f = fixture(t), read = createCompositionHeadReader(f.root, f.revision, ['one.txt']);
  const target = path.join(f.root, 'one.txt'), before = statSync(target);
  assert.equal(read('one.txt', 1024).bytes.toString(), 'bound one\n');
  writeFileSync(target, 'bound two\n'); utimesSync(target, before.atime, before.mtime);
  assert.throws(() => read('one.txt', 1024), code('composition_head_file_bytes_unbound'));
  f.git('add', '.'); f.git('commit', '-qm', 'later source');
  assert.throws(() => read('one.txt', 1024), code('composition_head_file_bytes_unbound'));
  assert.equal(createCompositionHeadReader(f.root, compositionRevision(f.root), ['one.txt'])
    ('one.txt', 1024).bytes.toString(), 'bound two\n');
});

test('runtime contract inspection batches missing references while preserving per-file findings', t => {
  const f = fixture(t), calls = countMetadata(t);
  const report = observeCompositionRuntime({ roots: { 'agentic-os': f.root },
    inspectGit: () => ({ ok: true, clean: true, revision: f.revision }) });
  const checks = report.components['agentic-os'].checks;
  assert.ok(checks.length > 1);
  assert.ok(checks.every(check => check.status === 'fail'));
  assert.equal(report.findings.filter(item => item.code === 'contract_file_unreadable_or_oversized').length, checks.length);
  assert.equal(calls.length, 1);
  assert.equal(report.productionRuntimeReady, false);
  assert.equal(report.ownerSuiteEvidenceObserved, false);
});

test('file and ancestor symlink replacement cannot redirect a captured reader', t => {
  const f = fixture(t), read = createCompositionHeadReader(f.root, f.revision, ['one.txt', 'nested/two.txt']);
  writeFileSync(path.join(f.parent, 'outside.txt'), f.sources['one.txt']);
  rmSync(path.join(f.root, 'one.txt')); symlinkSync(path.join(f.parent, 'outside.txt'), path.join(f.root, 'one.txt'));
  assert.throws(() => read('one.txt', 1024), code('composition_head_file_unreadable'));
  renameSync(path.join(f.root, 'nested'), path.join(f.parent, 'nested'));
  symlinkSync(path.join(f.parent, 'nested'), path.join(f.root, 'nested'));
  assert.throws(() => read('nested/two.txt', 1024), code('composition_head_file_unreadable'));
});

test('a canonical root replacement or supplied root alias retarget invalidates metadata', t => {
  const f = fixture(t), alias = path.join(f.parent, 'alias'); symlinkSync(f.root, alias);
  const read = createCompositionHeadReader(alias, f.revision, ['one.txt']);
  assert.equal(read('one.txt', 1024).bytes.toString(), f.sources['one.txt']);
  renameSync(f.root, path.join(f.parent, 'original')); mkdirSync(f.root);
  writeFileSync(path.join(f.root, 'one.txt'), f.sources['one.txt']);
  assert.throws(() => read('one.txt', 1024), code('composition_head_file_unreadable'));
  rmSync(alias); symlinkSync(path.join(f.parent, 'original'), alias);
  assert.throws(() => read('one.txt', 1024), code('composition_head_file_unreadable'));
});

test('missing or untracked siblings keep exact file errors without hiding valid tracked sources', t => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'untracked.txt'), 'untracked\n');
  const read = createCompositionHeadReader(f.root, f.revision, ['one.txt', 'absent.txt', 'untracked.txt', 'nested']);
  assert.equal(read('one.txt', 1024).bytes.toString(), f.sources['one.txt']);
  assert.throws(() => read('absent.txt', 1024), code('composition_head_file_unreadable'));
  assert.throws(() => read('untracked.txt', 1024), code('composition_head_file_untracked'));
  assert.throws(() => read('nested', 1024), code('composition_head_file_unreadable'));
  assert.throws(() => read('nested/two.txt', 1024), code('composition_head_file_untracked'));
  assert.throws(() => read('one.txt', 2), code('composition_head_file_unreadable'));
});

test('literal path syntax is preserved and subtree escape is rejected before Git', t => {
  const f = fixture(t, { ':literal.txt': 'colon\n', '[item].txt': 'brackets\n', '*.txt': 'star\n',
    'nested/child.txt': 'child\n', 'outside.txt': 'outside\n' });
  const read = createCompositionHeadReader(f.root, f.revision, Object.keys(f.sources));
  for (const [relative, bytes] of Object.entries(f.sources)) assert.equal(read(relative, 1024).bytes.toString(), bytes);
  const calls = countMetadata(t), nested = path.join(f.root, 'nested');
  for (const relative of ['..', '.', '../outside.txt', 'a/../../outside.txt', 'a/../outside.txt',
    '/outside.txt', 'nested\\child.txt', 'one\0.txt']) {
    assert.throws(() => createCompositionHeadReader(nested, f.revision, [relative]), code('composition_head_file_path_invalid'));
  }
  assert.equal(calls.length, 0);
});

test('tree and gitlink metadata cannot authorize replacement regular files', t => {
  const f = fixture(t);
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.revision},submodule`);
  f.git('commit', '-qm', 'gitlink fixture');
  const read = createCompositionHeadReader(f.root, compositionRevision(f.root), ['nested', 'submodule']);
  renameSync(path.join(f.root, 'nested'), path.join(f.parent, 'original-nested'));
  writeFileSync(path.join(f.root, 'nested'), 'replacement\n');
  writeFileSync(path.join(f.root, 'submodule'), 'replacement\n');
  for (const relative of ['nested', 'submodule'])
    assert.throws(() => read(relative, 1024), code('composition_head_file_untracked'));
});

test('inventory count, duplicate, path and total-byte limits reject before any Git query', t => {
  const f = fixture(t), calls = countMetadata(t);
  for (const paths of [[], ['one.txt', 'one.txt'], Array.from({ length: 65 }, (_, index) => `${index}.txt`),
    Array.from({ length: 9 }, (_, index) => `${index}${'a'.repeat(4095)}`)])
    assert.throws(() => createCompositionHeadReader(f.root, f.revision, paths), code('composition_head_file_inventory_invalid'));
  for (const relative of ['x'.repeat(4097), '字'.repeat(1366)])
    assert.throws(() => createCompositionHeadReader(f.root, f.revision, [relative]), code('composition_head_file_path_invalid'));
  assert.throws(() => createCompositionHeadReader(f.root, 'HEAD', ['one.txt']), code('composition_head_file_path_invalid'));
  assert.equal(calls.length, 0);
});

test('malformed or incomplete metadata never grants a file match', t => {
  const f = fixture(t), original = childProcess.execFileSync;
  let output = Buffer.from('100644 blob bad\tone.txt\0');
  t.mock.method(childProcess, 'execFileSync', (file, args, options) =>
    args.includes('ls-tree') ? output : original(file, args, options)); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const bytes of [output, Buffer.from(`100644 blob ${'a'.repeat(40)}\tone.txt`),
    Buffer.from(`100644 blob ${'a'.repeat(40)}\toutside.txt\0`),
    Buffer.from(`100644 blob ${'a'.repeat(40)}\tone.txt\0`.repeat(2))]) {
    output = bytes;
    assert.throws(() => createCompositionHeadReader(f.root, f.revision, ['one.txt']), code('composition_head_file_untracked'));
  }
  output = Buffer.alloc(0);
  assert.throws(() => createCompositionHeadReader(f.root, f.revision, ['one.txt'])('one.txt', 1024),
    code('composition_head_file_untracked'));
});
