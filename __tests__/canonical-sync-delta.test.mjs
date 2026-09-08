import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { canonicalDeltaEntries } from '../src/canonical-resources.mjs';
import { planCanonicalSync, applyCanonicalSync } from '../src/canonical-sync.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-delta-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'ADLC Test']); run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'core.autocrlf', 'false']);
  return { root, run };
}
function commit(run, message) {
  run(['add', '.']); run(['commit', '--quiet', '-m', message]); return run(['rev-parse', 'HEAD']);
}
function sync(root) {
  const plan = planCanonicalSync({ cwd: root, branch: 'main', targetRef: 'refs/remotes/origin/main' });
  return applyCanonicalSync(plan, { cwd: root, authorization: plan.authorization,
    exclusive: plan.exclusiveAuthorization });
}

test('large unchanged payloads stay in place while the changed file is recovered and installed', t => {
  const { root, run } = fixture(t), payload = Buffer.alloc(27 * 1024 * 1024, 7);
  for (let i = 0; i < 5; i++) writeFileSync(join(root, `payload-${i}.bin`), payload);
  writeFileSync(join(root, 'version.txt'), 'before\n');
  const local = commit(run, 'base');
  writeFileSync(join(root, 'version.txt'), 'after\n');
  const target = commit(run, 'target'); run(['update-ref', 'refs/remotes/origin/main', target]);
  run(['reset', '--hard', local]);
  const identities = Array.from({ length: 5 }, (_, i) => statSync(join(root, `payload-${i}.bin`)).ino);
  const receipt = sync(root);
  assert.equal(run(['rev-parse', 'HEAD']), target);
  assert.equal(readFileSync(join(root, 'version.txt'), 'utf8'), 'after\n');
  assert.equal(receipt.quarantineEntryCount, 1);
  assert.equal(receipt.copiedBytes, Buffer.byteLength('before\n'));
  assert.equal(run(['show', `${receipt.recoveryCommit}:version.txt`]), 'before');
  for (let i = 0; i < 5; i++) {
    assert.equal(statSync(join(root, `payload-${i}.bin`)).ino, identities[i]);
    assert.deepEqual(readFileSync(join(root, `payload-${i}.bin`)), payload);
  }
  assert.equal(run(['status', '--porcelain']), '');
});

test('changed files use unchanged target-tree attributes during delta staging', t => {
  const { root, run } = fixture(t);
  run(['config', 'filter.decorate.clean', "sed 's/^smudged://'" ]);
  run(['config', 'filter.decorate.smudge', "sed 's/^/smudged:/'" ]);
  run(['config', 'filter.decorate.required', 'true']);
  writeFileSync(join(root, '.gitattributes'), 'filtered.txt filter=decorate\n');
  writeFileSync(join(root, 'filtered.txt'), 'before\n');
  const local = commit(run, 'base');
  writeFileSync(join(root, 'filtered.txt'), 'after\n');
  const target = commit(run, 'target'); run(['update-ref', 'refs/remotes/origin/main', target]);
  run(['reset', '--hard', local]); writeFileSync(join(root, 'filtered.txt'), 'before\n');
  const attributesInode = statSync(join(root, '.gitattributes')).ino;
  const receipt = sync(root);
  assert.equal(readFileSync(join(root, 'filtered.txt'), 'utf8'), 'smudged:after\n');
  assert.equal(statSync(join(root, '.gitattributes')).ino, attributesInode);
  assert.equal(receipt.quarantineEntryCount, 1);
  assert.equal(run(['status', '--porcelain']), '');
});

test('attribute changes invalidate unchanged payloads; ordinary deltas include modes and deletions', () => {
  const blob = (oid, mode = '100644') => ({ oid, mode, type: 'blob', size: 3 });
  const base = new Map([['keep', blob('a')], ['edit', blob('b')], ['remove', blob('c')], ['mode', blob('d')]]);
  const target = new Map([['keep', blob('a')], ['edit', blob('e')], ['add', blob('f')], ['mode', blob('d', '100755')]]);
  const delta = canonicalDeltaEntries(base, target);
  assert.deepEqual([...delta.source.keys()], ['edit', 'remove', 'mode']);
  assert.deepEqual([...delta.target.keys()], ['edit', 'add', 'mode']);
  target.set('nested/.gitattributes', blob('g'));
  const invalidated = canonicalDeltaEntries(base, target);
  assert.deepEqual(invalidated.source, base); assert.deepEqual(invalidated.target, target);
  base.set('nested/.gitattributes', blob('g')); target.delete('nested/.gitattributes');
  assert.deepEqual(canonicalDeltaEntries(base, target).target, target);
});

test('normalization-hidden drift in an untouched entry during staging prevents success', t => {
  const { root, run } = fixture(t);
  run(['config', 'filter.decorate.clean', "sed 's/^smudged://'" ]);
  run(['config', 'filter.decorate.smudge', "sed 's/^/smudged:/'" ]);
  run(['config', 'filter.decorate.required', 'true']);
  writeFileSync(join(root, '.gitattributes'), 'filtered.txt filter=decorate\nuntouched.txt text eol=lf\n');
  writeFileSync(join(root, 'untouched.txt'), 'keep\n');
  writeFileSync(join(root, 'filtered.txt'), 'before\n');
  const local = commit(run, 'base');
  writeFileSync(join(root, 'filtered.txt'), 'after\n');
  const target = commit(run, 'target'); run(['update-ref', 'refs/remotes/origin/main', target]);
  run(['reset', '--hard', local]); writeFileSync(join(root, 'filtered.txt'), 'before\n');
  // Only this test-owned filter mutates the test-owned checkout while target staging runs.
  run(['config', 'filter.decorate.smudge',
    `printf 'keep\\r\\n' > '${join(root, 'untouched.txt')}'; sed 's/^/smudged:/'`]);
  assert.throws(() => sync(root), error => error.reason === 'blocked-after-recovery'
    && error.detail.cause === 'blocked-postcondition');
  assert.equal(readFileSync(join(root, 'untouched.txt'), 'utf8'), 'keep\r\n');
  assert.equal(run(['diff', '--quiet', '--', 'untouched.txt'], { allowFail: true }), '');
});
