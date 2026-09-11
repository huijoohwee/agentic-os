import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, realpathSync,
  utimesSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodebaseContext, CONTEXT_LIMITS } from 'agentic-os/context/codebase';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'native-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, '.gitignore'), 'src/ignored.js\n');
  writeFileSync(join(root, 'src/pay.js'), "import { authorize } from './auth.js';\nexport function pay() { return authorize('receipt'); }\n");
  writeFileSync(join(root, 'src/auth.js'), 'export const authorize = value => value;\n');
  writeFileSync(join(root, 'src/ignored.js'), 'private ignored input');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'source']);
  return { root, git, context: createCodebaseContext({ root }) };
}
test('native map/search/read joins current source bytes, preserves work, and pages complete file hits', t => {
  const { root, git, context } = fixture(t), before = git(['status', '--porcelain=v1']);
  const map = context.map({ path: 'src' });
  assert.equal(map.fileCount, 2);
  assert.equal(map.repositoryRoot, realpathSync(root));
  assert.equal(map.results[1].imports[0].target, 'src/auth.js');
  assert.equal(map.results[1].facts[0].value, 'pay');
  const first = context.search({ path: 'src', query: 'authorize', limit: 1 });
  assert.equal(first.results.length, 1); assert.equal(first.totalMatches, 2);
  assert.equal(first.parsedFiles, 0); assert.equal(first.reusedFiles, 2);
  const second = context.search({ path: 'src', query: 'authorize', after: first.nextAfter });
  assert.equal(second.results[0].path, 'src/pay.js'); assert.equal(second.nextAfter, null);
  const selected = context.read({ ...second.results[0].read, lines: 2 });
  assert.match(selected.content, /authorize/);
  assert.equal(selected.grantsAuthority, false); assert.equal(selected.atomicSnapshot, false);
  assert.equal(git(['status', '--porcelain=v1']), before);
  assert.equal(readFileSync(join(root, 'src/ignored.js'), 'utf8'), 'private ignored input');
  assert.throws(() => { map.results[0].facts[0].value = 'poison'; }, TypeError);
});
test('same-size edits with restored timestamps invalidate reuse and stale reads', t => {
  const { root, context } = fixture(t), path = join(root, 'src/auth.js');
  const first = context.map({ path: 'src' }), prior = first.results[0], stat = statSync(path);
  writeFileSync(path, readFileSync(path, 'utf8').replace('value => value', 'input => input'));
  utimesSync(path, stat.atime, stat.mtime);
  const second = context.map({ path: 'src' });
  assert.notEqual(first.snapshotSha256, second.snapshotSha256);
  assert.equal(second.parsedFiles, 1); assert.equal(second.reusedFiles, 1);
  assert.throws(() => context.read({ path: prior.path, sha256: prior.sha256 }), /stale/);
});
test('visible additions and removals refresh while ignored and secret paths are not ingested', t => {
  const { root, context } = fixture(t);
  writeFileSync(join(root, 'src/new.js'), 'export const added = true;\n');
  writeFileSync(join(root, 'src/secrets.json'), '{"private":"do not read"}');
  unlinkSync(join(root, 'src/auth.js'));
  const result = context.map({ path: 'src' });
  assert.deepEqual(result.results.map(item => item.path), ['src/new.js', 'src/pay.js']);
  assert.equal(result.excludedCount, 2);
  assert.equal(result.results[1].imports[0].resolution, 'unresolved');
  assert.throws(() => context.map({ path: 'src/secrets.json' }), /unsafe-path/);
});
test('path traversal, pathspec injection, symlink files and parents cannot expand scope', t => {
  const { root, context } = fixture(t);
  for (const path of ['../outside', '/tmp', 'src/../src', ':(glob)**', '.git/config', 'src\\auth.js'])
    assert.throws(() => context.map({ path }), /unsafe-path/);
  symlinkSync(join(root, 'src/auth.js'), join(root, 'src/link.js'));
  assert.throws(() => context.map({ path: 'src/link.js' }), /regular-source/);
  unlinkSync(join(root, 'src/link.js'));
  rmSync(join(root, 'src'), { recursive: true });
  symlinkSync(tmpdir(), join(root, 'src'));
  assert.throws(() => context.map({ path: 'src' }), /ancestor/);
});
test('resource limits fail explicitly, without silently truncating source or results', t => {
  const { root, context } = fixture(t);
  assert.throws(() => context.search({ path: 'src', query: 'x'.repeat(257) }), /query/);
  assert.throws(() => context.map({ path: 'src', limit: 0 }), /numeric-budget/);
  writeFileSync(join(root, 'src/large.js'), 'x'.repeat(CONTEXT_LIMITS.fileBytes + 1));
  assert.throws(() => context.map({ path: 'src' }), /byte budget/);
  writeFileSync(join(root, 'src/large.js'), 'needle' + 'x'.repeat(17000));
  assert.throws(() => context.search({ path: 'src', query: 'needle' }), /output-budget/);
  writeFileSync(join(root, 'src/large.js'), Buffer.from([0xff]));
  assert.throws(() => context.map({ path: 'src' }), /encoded data/);
});
test('independent working trees never share retained metadata or source bodies', t => {
  const { root, git, context } = fixture(t), peer = join(root, 'peer');
  git(['worktree', 'add', '--quiet', '--detach', peer, 'HEAD']);
  const other = createCodebaseContext({ root: peer });
  const first = context.map({ path: 'src' });
  writeFileSync(join(peer, 'src/auth.js'), 'export const peerOnly = true;\n');
  const changed = other.map({ path: 'src' });
  assert.notEqual(changed.snapshotSha256, first.snapshotSha256);
  assert.equal(context.map({ path: 'src' }).snapshotSha256, first.snapshotSha256);
});
test('CLI works offline in an unenrolled Git repository and rejects unknown arguments', t => {
  const { root } = fixture(t);
  const result = spawnSync(process.execPath, [CLI, 'context', 'search', '--path=src', '--query=receipt'],
    { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.results[0].path, 'src/pay.js');
  const invalid = spawnSync(process.execPath, [CLI, 'context', 'map', '--path=src', '--network'],
    { cwd: root, encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /invalid-arguments/);
});
