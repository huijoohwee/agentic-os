import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, mkdirSync, readdirSync,
  rmSync, symlinkSync, linkSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generationManifest, generationKey, generateFile, writeGeneratedFile } from 'agentic-os/generation';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-generation-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'input'), 'first');
  let count = 0;
  const options = { destination: join(root, 'dist/output'), receipt: join(root, 'cache/receipt.json'),
    inputs: () => generationManifest(root, { paths: ['input'] }).digest,
    produce: () => { count++; return readFileSync(join(root, 'input')); } };
  return { root, options, count: () => count };
}
test('streaming manifest is deterministic, excluded paths are exact, every limit fails visibly', t => {
  const { root } = fixture(t); mkdirSync(join(root, 'nested')); writeFileSync(join(root, 'nested/a'), '123');
  const result = generationManifest(root, { exclude: ['nested'] });
  assert.deepEqual(result.files.map(f => f.path), ['input']); assert.equal(result.bytes, 5);
  assert.throws(() => generationManifest(root, { maxBytes: 4 }), /byte-budget/);
  assert.throws(() => generationManifest(root, { maxFileBytes: 4 }), /byte-budget/);
  assert.throws(() => generationManifest(root, { maxEntries: 1 }), /entry-depth/);
  mkdirSync(join(root, 'nested/deep'));
  assert.throws(() => generationManifest(root, { maxDepth: 1 }), /entry-depth/);
  assert.throws(() => generationManifest(root, { paths: ['../input'] }), /invalid-paths/);
  assert.throws(() => generationManifest(root, { timeoutMs: NaN }), /invalid-timeoutMs/);
  const all = generationManifest(root);
  assert.equal(all.digest, generationManifest(root, { paths: ['nested', 'input'] }).digest);
  assert.notEqual(generationKey({ files: all.digest, tool: 'a' }), generationKey({ files: all.digest, tool: 'b' }));
});
test('unchanged inputs and verified outputs reuse one receipt without rewriting either file', async t => {
  const { options, count } = fixture(t);
  assert.equal((await generateFile(options)).reused, false);
  const output = statSync(options.destination).mtimeMs, receipt = statSync(options.receipt).mtimeMs;
  assert.equal((await generateFile(options)).reused, true); assert.equal(count(), 1);
  assert.equal(statSync(options.destination).mtimeMs, output);
  assert.equal(statSync(options.receipt).mtimeMs, receipt);
});
test('same-size restored-timestamp edits invalidate cache and changed keys do not accumulate', async t => {
  const { root, options, count } = fixture(t); await generateFile(options);
  const before = statSync(join(root, 'input'));
  writeFileSync(join(root, 'input'), 'other'); utimesSync(join(root, 'input'), before.atime, before.mtime);
  assert.equal((await generateFile(options)).reused, false); assert.equal(count(), 2);
  for (let n = 0; n < 12; n++) { writeFileSync(join(root, 'input'), String(n)); await generateFile(options); }
  assert.deepEqual(readdirSync(join(root, 'cache')), ['receipt.json']);
  assert.deepEqual(readdirSync(join(root, 'dist')), ['output']);
});
test('deleted outputs, malformed receipts and corrupted bytes regenerate', async t => {
  const { options } = fixture(t); await generateFile(options);
  writeFileSync(options.destination, 'wrong'); assert.equal((await generateFile(options)).reused, false);
  rmSync(options.destination); assert.equal((await generateFile(options)).reused, false);
  writeFileSync(options.receipt, '{bad'); assert.equal((await generateFile(options)).reused, false);
  assert.equal(readFileSync(options.destination, 'utf8'), 'first');
});
test('oversized or failed production keeps the last working artifact and receipt', async t => {
  const { options, root } = fixture(t); await generateFile(options);
  const receipt = readFileSync(options.receipt, 'utf8'); writeFileSync(join(root, 'input'), 'next');
  await assert.rejects(generateFile({ ...options, maxOutputBytes: 6, produce: () => Buffer.alloc(7) }), /output-byte/);
  await assert.rejects(generateFile({ ...options, produce: () => { throw Error('producer failed'); } }), /producer failed/);
  assert.equal(readFileSync(options.destination, 'utf8'), 'first');
  assert.equal(readFileSync(options.receipt, 'utf8'), receipt);
});
test('input drift during generation prevents publishing stale output', async t => {
  const { options, root } = fixture(t);
  await assert.rejects(generateFile({ ...options, produce: () => {
    writeFileSync(join(root, 'input'), 'changed'); return 'old';
  } }), /input-drift/);
  assert.deepEqual(readdirSync(join(root, 'dist')), []);
});
test('one output lock rejects concurrent writers and is released after failure', async t => {
  const { options } = fixture(t); let release;
  const first = generateFile({ ...options, produce: () => new Promise(resolve => { release = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(generateFile(options), /output-busy/);
  release('first'); await first;
  assert.equal((await generateFile(options)).reused, true);
});
test('deadline aborts cooperative producers, never publishes their late result', async t => {
  const { root, options } = fixture(t); let aborted = false;
  await assert.rejects(generateFile({ ...options, timeoutMs: 30, produce: ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve('late'); });
  }) }), /time-budget/);
  assert.equal(aborted, true); assert.deepEqual(readdirSync(join(root, 'dist')), []);
});
test('symlink inputs, output aliases, receipt aliases and hardlink outputs are refused', async t => {
  const { root, options } = fixture(t); symlinkSync('input', join(root, 'link'));
  assert.throws(() => generationManifest(root), /aliased-input/);
  mkdirSync(join(root, 'dist')); symlinkSync('../input', options.destination);
  await assert.rejects(generateFile(options), /output-alias/); rmSync(options.destination);
  linkSync(join(root, 'input'), options.destination);
  await assert.rejects(generateFile(options), /output-alias/); rmSync(options.destination);
  symlinkSync('../input', options.receipt);
  await assert.rejects(generateFile(options), /output-alias/);
  assert.equal(readFileSync(join(root, 'input'), 'utf8'), 'first');
});
test('bounded atomic writes preserve identical bytes and reject overflow before creating paths', async t => {
  const { root } = fixture(t), path = join(root, 'out/value');
  assert.equal((await writeGeneratedFile(path, 'hello')).written, true);
  assert.equal((await writeGeneratedFile(path, 'hello')).written, false);
  assert.throws(() => writeGeneratedFile(join(root, 'absent/out'), 'large', { maxOutputBytes: 2 }), /output-byte/);
  assert.equal(readFileSync(path, 'utf8'), 'hello');
});
