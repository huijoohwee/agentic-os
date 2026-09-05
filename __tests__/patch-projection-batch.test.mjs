import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from '../src/git.mjs';
import { exactTreeProjectionProof } from '../src/patch-identity.mjs';

function fixture(t, format = 'sha1') {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-projection-batch-'));
  const cwd = join(root, 'repo'); mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args, options = {}) => git(args, { cwd, ...options });
  run(['init', '--quiet', '--initial-branch=main', `--object-format=${format}`]);
  run(['config', 'user.name', 'Projection Test']);
  run(['config', 'user.email', 'projection@example.invalid']);
  run(['config', 'core.filemode', 'true']);
  const put = (path, bytes) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), bytes);
  };
  const commit = (message) => {
    run(['add', '--all']); run(['commit', '--quiet', '--message', message]);
  };
  put('baseline.txt', 'baseline\n'); commit('base');
  const start = () => run(['switch', '--quiet', '--create', 'lane']);
  const squash = () => {
    run(['switch', '--quiet', 'main']); run(['merge', '--quiet', '--squash', 'lane']);
    run(['commit', '--quiet', '--message', 'squash lane']);
  };
  const proof = () => exactTreeProjectionProof('main', 'lane', { cwd });
  return { root, cwd, run, put, commit, start, squash, proof };
}

/** Only fixture-owned subprocesses are wrapped; actual Git still supplies every normal tree. */
function observeTreeCalls(t, { root }) {
  const bin = join(root, 'bin'), log = join(root, 'tree-calls.jsonl');
  mkdirSync(bin); writeFileSync(log, '');
  const helper = join(root, 'git-wrapper.mjs');
  writeFileSync(helper, [
    "import { appendFileSync } from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    'const args = process.argv.slice(2);',
    "if (args.includes('ls-tree')) {",
    "  appendFileSync(process.env.PROJECTION_LOG, JSON.stringify(args) + '\\n');",
    '  const injected = process.env.PROJECTION_RESPONSE;',
    "  if (injected === 'failure') process.exit(91);",
    "  if (injected === 'malformed') { process.stdout.write('invalid\\0'); process.exit(0); }",
    "  if (injected === 'utf8') { process.stdout.write(Buffer.from([255, 0])); process.exit(0); }",
    "  if (injected === 'overflow') { process.stdout.write(Buffer.alloc(65537, 97)); process.exit(0); }",
    '}',
    'const result = spawnSync(process.env.PROJECTION_GIT, args, { stdio: \'inherit\' });',
    'process.exit(Number.isInteger(result.status) ? result.status : 92);', '',
  ].join('\n'));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec "$PROJECTION_NODE" "$PROJECTION_HELPER" "$@"\n');
  chmodSync(join(bin, 'git'), 0o755);
  const next = {
    PATH: `${bin}:${process.env.PATH}`,
    PROJECTION_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
    PROJECTION_NODE: process.execPath, PROJECTION_HELPER: helper, PROJECTION_LOG: log,
    PROJECTION_RESPONSE: '',
  };
  const previous = Object.fromEntries(Object.keys(next).map(key => [key, process.env[key]]));
  Object.assign(process.env, next);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  return {
    calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    reset: () => writeFileSync(log, ''),
    inject: (mode) => { process.env.PROJECTION_RESPONSE = mode; },
  };
}

function assertBounded(calls) {
  for (const args of calls) {
    assert.ok(args.includes('--literal-pathspecs'));
    assert.equal(args.includes('-r'), false);
    const paths = args.slice(args.indexOf('--') + 1);
    assert.ok(paths.length > 0 && paths.length <= 128);
    assert.ok(paths.reduce((sum, path) => sum + Buffer.byteLength(path) + 1, 0) <= 32 * 1024);
  }
}

test('258 touched files need at most six tree reads and fresh mismatches stop after one batch', t => {
  const f = fixture(t); f.start();
  for (let index = 0; index < 258; index += 1)
    f.put(`file-${String(index).padStart(3, '0')}.txt`, `lane ${index}\n`);
  f.commit('many paths'); f.squash();
  const observed = observeTreeCalls(t, f);
  assert.equal(f.proof()?.pathCount, 258);
  assert.equal(observed.calls().length, 6);
  assertBounded(observed.calls());
  t.diagnostic('258 paths: 6 tree reads; the previous per-path loop required 516.');

  f.put('file-000.txt', 'upstream changed\n'); f.commit('change first touched path');
  observed.reset(); assert.equal(f.proof(), null);
  assert.equal(observed.calls().length, 2);
  f.put('file-000.txt', 'lane 0\n'); f.commit('restore exact projection');
  observed.reset(); assert.equal(f.proof()?.pathCount, 258);
  assert.equal(observed.calls().length, 6);
  f.run(['switch', '--quiet', 'lane']);
  f.put('file-000.txt', 'lane changed\n'); f.commit('move lane head');
  observed.reset(); assert.equal(f.proof(), null);
  assert.equal(observed.calls().length, 2);
});

test('literal Unicode, whitespace, wildcard and option-like filenames retain exact selection', t => {
  const f = fixture(t);
  f.put('unrelated', 'before\n'); f.commit('unrelated baseline'); f.start();
  const names = [':literal', '-option', '*', '[ab]', 'line\nbreak', 'tab\tname', 'space name', 'unicodé'];
  for (const name of names) f.put(name, Buffer.from([0, 255, 13, 10]));
  f.commit('literal paths'); f.squash();
  f.put('unrelated', 'upstream-only change\n'); f.commit('unrelated upstream edit');
  assert.equal(f.proof()?.pathCount, names.length);
  f.put('*', Buffer.from([0, 255, 10])); f.commit('literal wildcard bytes changed');
  assert.equal(f.proof(), null);
});

for (const format of ['sha1', 'sha256']) {
  test(`${format}: deletion, executable mode, symlink and gitlink identity stay exact`, t => {
    const f = fixture(t, format), original = f.run(['rev-parse', 'HEAD']);
    f.put('removed.txt', 'remove me\n'); f.put('script.sh', '#!/bin/sh\nexit 0\n');
    symlinkSync('baseline.txt', join(f.cwd, 'link'));
    mkdirSync(join(f.cwd, 'module'));
    f.run(['update-index', '--add', '--cacheinfo', `160000,${original},module`]);
    f.commit('tracked kinds');
    const target = f.run(['rev-parse', 'HEAD']); f.start();
    unlinkSync(join(f.cwd, 'removed.txt')); chmodSync(join(f.cwd, 'script.sh'), 0o755);
    unlinkSync(join(f.cwd, 'link')); symlinkSync('script.sh', join(f.cwd, 'link'));
    f.run(['update-index', '--cacheinfo', `160000,${target},module`]);
    f.commit('change tracked kinds'); f.squash();
    assert.equal(f.proof()?.pathCount, 4);
    chmodSync(join(f.cwd, 'script.sh'), 0o644); f.commit('mode differs');
    assert.equal(f.proof(), null);
    chmodSync(join(f.cwd, 'script.sh'), 0o755); f.commit('restore mode');
    assert.equal(f.proof()?.pathCount, 4);
    unlinkSync(join(f.cwd, 'link')); symlinkSync('baseline.txt', join(f.cwd, 'link'));
    f.commit('link target differs'); assert.equal(f.proof(), null);
    unlinkSync(join(f.cwd, 'link')); symlinkSync('script.sh', join(f.cwd, 'link'));
    f.commit('restore link'); assert.equal(f.proof()?.pathCount, 4);
    f.run(['update-index', '--cacheinfo', `160000,${original},module`]);
    f.commit('gitlink target differs'); assert.equal(f.proof(), null);
    f.run(['update-index', '--cacheinfo', `160000,${target},module`]);
    f.commit('restore gitlink'); assert.equal(f.proof()?.pathCount, 4);
    f.put('removed.txt', 'remove me\n'); f.commit('deleted file reappears');
    assert.equal(f.proof(), null);
  });
}

for (const direction of ['file-to-directory', 'directory-to-file']) {
  test(`${direction}: overlapping parent and child paths preserve nonrecursive tree identity`, t => {
    const f = fixture(t), fileFirst = direction === 'file-to-directory';
    f.put(fileFirst ? 'node' : 'node/leaf', 'before\n'); f.commit('initial node'); f.start();
    rmSync(join(f.cwd, 'node'), { recursive: true });
    f.put(fileFirst ? 'node/leaf' : 'node', 'after\n'); f.commit('replace node type'); f.squash();
    const observed = observeTreeCalls(t, f);
    assert.equal(f.proof()?.pathCount, 2);
    assertBounded(observed.calls());
    for (const args of observed.calls()) {
      const paths = args.slice(args.indexOf('--') + 1);
      assert.equal(paths.includes('node') && paths.includes('node/leaf'), false);
    }
    if (fileFirst) f.put('node/sibling', 'upstream sibling\n');
    else f.put('node', 'upstream changed\n');
    f.commit('upstream touched state differs'); assert.equal(f.proof(), null);
  });
}

test('long paths split on argument bytes before the path-count limit', t => {
  const f = fixture(t); f.start();
  for (let index = 0; index < 80; index += 1) {
    const path = `${String(index).padStart(3, '0')}-${'a'.repeat(180)}/${'b'.repeat(180)}/${'c'.repeat(180)}`;
    f.put(path, 'lane\n');
  }
  f.commit('long paths'); f.squash();
  const observed = observeTreeCalls(t, f);
  assert.equal(f.proof()?.pathCount, 80);
  assert.equal(observed.calls().length, 4);
  assertBounded(observed.calls());
});

test('failed, malformed, invalid UTF-8 and oversized tree output never proves integration', t => {
  const f = fixture(t); f.start(); f.put('lane.txt', 'lane\n'); f.commit('lane'); f.squash();
  const observed = observeTreeCalls(t, f);
  for (const mode of ['failure', 'malformed', 'utf8', 'overflow']) {
    observed.inject(mode); observed.reset();
    assert.equal(f.proof(), null, mode);
    assert.ok(observed.calls().length > 0 && observed.calls().length <= 2);
  }
  observed.inject(''); assert.equal(f.proof()?.pathCount, 1);
});
