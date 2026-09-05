import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { applyCanonicalSync, planCanonicalSync } from '../src/canonical-sync.mjs';

const rawBytes = Buffer.from([0, 255, 13, 10, 195, 169, 0]);
const targetBytes = Buffer.from([255, 0, 10, 13, 128]);
const planFor = cwd => planCanonicalSync({ cwd, branch: 'main', targetRef: 'refs/remotes/origin/main' });
const apply = (plan, cwd) => applyCanonicalSync(plan, {
  cwd, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization,
});

function fixture(t, format, { normalized = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), `agentic-os-native-hash-${format}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'); mkdirSync(cwd);
  const run = (args, options = {}) => git(args, { cwd, ...options });
  run(['init', '--quiet', '--initial-branch=main', `--object-format=${format}`]);
  run(['config', 'user.name', 'ADLC Test']); run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'core.autocrlf', 'false']);
  if (normalized) writeFileSync(join(cwd, '.gitattributes'), 'data.bin text eol=lf\n');
  writeFileSync(join(cwd, 'data.bin'), normalized ? 'tracked\n' : rawBytes);
  writeFileSync(join(cwd, 'empty.bin'), Buffer.alloc(0));
  symlinkSync('data.bin', join(cwd, 'link'));
  run(['add', '.']); run(['commit', '--quiet', '-m', 'base']);
  const localSha = run(['rev-parse', 'HEAD']);
  const original = Object.fromEntries(['data.bin', 'empty.bin', 'link',
    ...(normalized ? ['.gitattributes'] : [])].map(path => [path, {
    oid: run(['rev-parse', `${localSha}:${path}`]),
    bytes: path === 'link' ? Buffer.from('data.bin') : readFileSync(join(cwd, path)),
  }]));
  run(['switch', '--quiet', '-c', 'target']);
  writeFileSync(join(cwd, 'data.bin'), normalized ? 'target\n' : targetBytes);
  run(['add', '.']); run(['commit', '--quiet', '-m', 'target']);
  const targetSha = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', targetSha]); run(['switch', '--quiet', 'main']);
  run(['branch', '-D', 'target']);
  return { root, cwd, run, localSha, targetSha, original };
}

function denyPureHashes(t, fixture) {
  const bin = join(fixture.root, 'bin'), log = join(fixture.root, 'hash-calls.log');
  mkdirSync(bin); writeFileSync(log, '');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), [
    '#!/bin/sh',
    'if [ "$1" = hash-object ]; then',
    '  case " $* " in',
    '    *" -w "*) printf "write\\n" >> "$HASH_CALL_LOG" ;;',
    '    *) printf "pure\\n" >> "$HASH_CALL_LOG"; exit 93 ;;',
    '  esac',
    'fi',
    'exec "$REAL_GIT" "$@"', '',
  ].join('\n')); chmodSync(join(bin, 'git'), 0o755);
  const next = { PATH: `${bin}:${process.env.PATH}`, REAL_GIT: realGit, HASH_CALL_LOG: log };
  const prior = Object.fromEntries(Object.keys(next).map(key => [key, process.env[key]]));
  Object.assign(process.env, next);
  t.after(() => { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  return () => readFileSync(log, 'utf8');
}

for (const format of ['sha1', 'sha256']) {
  test(`${format}: clean binary, empty, and symlink blobs survive canonical quarantine without pure hash processes`, t => {
    const f = fixture(t, format), calls = denyPureHashes(t, f), plan = planFor(f.cwd);
    assert.equal(plan.inventory.length, 0);
    assert.equal(plan.expectedLocalSha.length, format === 'sha1' ? 40 : 64);
    const receipt = apply(plan, f.cwd);
    assert.equal(receipt.sourceRetired, true); assert.equal(f.run(['rev-parse', 'HEAD']), f.targetSha);
    assert.deepEqual(readFileSync(join(f.cwd, 'data.bin')), targetBytes);
    assert.equal(readlinkSync(join(f.cwd, 'link')), 'data.bin');
    const manifest = JSON.parse(readFileSync(receipt.quarantineManifestPath));
    assert.equal(manifest.entries.length, Object.keys(f.original).length);
    for (const entry of manifest.entries) {
      assert.equal(entry.oid, f.original[entry.path].oid);
      const saved = join(receipt.quarantinePath, entry.slot);
      const bytes = entry.mode === '120000' ? Buffer.from(readlinkSync(saved)) : readFileSync(saved);
      assert.deepEqual(bytes, f.original[entry.path].bytes);
    }
    assert.equal(calls(), '');
  });

  test(`${format}: normalization-hidden raw drift and new bytes retain exact recovery writes`, t => {
    const f = fixture(t, format, { normalized: true });
    const changed = Buffer.from('tracked\r\n'); writeFileSync(join(f.cwd, 'data.bin'), changed);
    assert.equal(f.run(['diff', '--quiet', '--', 'data.bin'], { allowFail: true }), '');
    writeFileSync(join(f.cwd, 'new.bin'), rawBytes);
    const expected = new Map([['data.bin', changed], ['new.bin', rawBytes]].map(([path, bytes]) =>
      [path, f.run(['hash-object', '-w', '--stdin'], { input: bytes })]));
    const calls = denyPureHashes(t, f), plan = planFor(f.cwd);
    assert.deepEqual(plan.inventory.map(entry => [entry.path, entry.status]), [['data.bin', 'M'], ['new.bin', '?']]);
    for (const entry of plan.inventory) assert.equal(entry.oid, expected.get(entry.path));
    let failure;
    assert.throws(() => apply(plan, f.cwd), error => {
      failure = error; return error.reason === 'blocked-dirty-inventory-copy-only';
    });
    assert.equal(f.run(['rev-parse', 'HEAD']), f.localSha);
    assert.deepEqual(f.run(['show', `${plan.recoveryRef}:data.bin`], { binary: true }), changed);
    assert.deepEqual(f.run(['show', `${plan.recoveryRef}:new.bin`], { binary: true }), rawBytes);
    assert.deepEqual(readFileSync(join(f.cwd, 'data.bin')), changed);
    assert.equal(failure.operationArtifacts.quarantineEntryCount, 2);
    assert.equal(calls(), 'write\nwrite\n');
  });

  test(`${format}: raw bytes changing after planning refuse before recovery or quarantine effects`, t => {
    const f = fixture(t, format), calls = denyPureHashes(t, f), plan = planFor(f.cwd);
    const changed = Buffer.from(rawBytes); changed[0] = 1; writeFileSync(join(f.cwd, 'data.bin'), changed);
    assert.throws(() => apply(plan, f.cwd), error => error.reason === 'blocked-plan-drift');
    assert.equal(f.run(['rev-parse', '--verify', plan.recoveryRef], { allowFail: true }), null);
    assert.equal(existsSync(join(f.cwd, '.git', 'agentic-os-canonical-sync.lock')), false);
    assert.equal(f.run(['rev-parse', 'HEAD']), f.localSha);
    assert.deepEqual(readFileSync(join(f.cwd, 'data.bin')), changed); assert.equal(calls(), '');
  });
}
