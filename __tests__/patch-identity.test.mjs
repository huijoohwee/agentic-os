import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { integrationProof, cherry, sourceHeadTrailer } from '../src/patch-identity.mjs';

/** Real repository fixture: patch identity cannot be tested against a mock. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'adlc-'));
  const run = (args) => git(args, { cwd: dir });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'base']);
  return { dir, run };
}

function commitFile(run, dir, name, body, message) {
  writeFileSync(join(dir, name), body);
  run(['add', name]);
  run(['commit', '--quiet', '--message', message]);
}

test('ancestor proof when the lane is merged fast-forward', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/one']);
  commitFile(run, dir, 'one.txt', 'one\n', 'add one');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--ff-only', 'agent/dev/one']);

  const proof = integrationProof('main', 'agent/dev/one', { cwd: dir });
  assert.equal(proof.kind, 'ancestor');
});

test('squash merge destroys ancestry but patch identity still proves it', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/two']);
  commitFile(run, dir, 'two.txt', 'two\n', 'add two');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/two']);
  run(['commit', '--quiet', '--message', 'squashed two']);

  // Ancestry is gone: the lane tip is not reachable from main.
  const laneTip = git(['rev-parse', 'agent/dev/two'], { cwd: dir });
  const reachable = git(['merge-base', '--is-ancestor', laneTip, 'main'], {
    cwd: dir,
    allowFail: true,
  });
  assert.equal(reachable, null, 'squash must break ancestry for this test to mean anything');

  const proof = integrationProof('main', 'agent/dev/two', { cwd: dir });
  assert.equal(proof.kind, 'patch-identity');
  assert.deepEqual(proof.pending, []);
});

test('Source-Head trailer proves integration even when the patch differs', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/three']);
  commitFile(run, dir, 'three.txt', 'three\n', 'add three');
  const laneTip = git(['rev-parse', 'HEAD'], { cwd: dir });

  run(['switch', '--quiet', 'main']);
  // Deliberately different content, so patch identity cannot succeed.
  commitFile(run, dir, 'three.txt', 'three, adjusted in the queue\n', 'add three\n\nqueue squash');
  run(['commit', '--quiet', '--amend', '--message', `add three\n\n${sourceHeadTrailer(laneTip)}`]);

  const { pending } = cherry('main', 'agent/dev/three', { cwd: dir });
  assert.equal(pending.length, 1, 'patch identity must not be the proof here');

  const proof = integrationProof('main', 'agent/dev/three', { cwd: dir });
  assert.equal(proof.kind, 'source-head-trailer');
});

test('a multi-commit squash is proven by combined diff, not per-commit identity', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/multi']);
  commitFile(run, dir, 'p.txt', 'p\n', 'add p');
  commitFile(run, dir, 'q.txt', 'q\n', 'add q');

  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/multi']);
  run(['commit', '--quiet', '--message', 'landed both, no trailer']);

  // Per-commit identity cannot see it: neither lane commit matches the squash.
  const { pending } = cherry('main', 'agent/dev/multi', { cwd: dir });
  assert.equal(pending.length, 2, 'both lane commits look pending to per-commit identity');

  const proof = integrationProof('main', 'agent/dev/multi', { cwd: dir });
  assert.equal(proof.kind, 'squash-identity');
});

test('squash identity does not fire when the combined diff differs', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/partial']);
  commitFile(run, dir, 'r.txt', 'r\n', 'add r');
  commitFile(run, dir, 's.txt', 's\n', 'add s');

  run(['switch', '--quiet', 'main']);
  commitFile(run, dir, 'r.txt', 'r\n', 'only r landed');

  assert.equal(integrationProof('main', 'agent/dev/partial', { cwd: dir }), null);
});

test('an unintegrated lane yields no proof at all', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/four']);
  commitFile(run, dir, 'four.txt', 'four\n', 'add four');
  run(['switch', '--quiet', 'main']);

  assert.equal(integrationProof('main', 'agent/dev/four', { cwd: dir }), null);
});

test('partially landed lane is not proven and reports the pending remainder', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/five']);
  commitFile(run, dir, 'a.txt', 'a\n', 'add a');
  const first = git(['rev-parse', 'HEAD'], { cwd: dir });
  commitFile(run, dir, 'b.txt', 'b\n', 'add b');

  run(['switch', '--quiet', 'main']);
  run(['cherry-pick', first]);
  // A cherry-pick can reproduce the original commit byte for byte, which makes
  // it the same SHA rather than an equivalent one. Reword so the SHA differs and
  // only the patch identity matches, which is the case this test is about.
  run(['commit', '--quiet', '--amend', '--message', 'add a (landed by the queue)']);

  assert.equal(integrationProof('main', 'agent/dev/five', { cwd: dir }), null);
  const { upstream, pending } = cherry('main', 'agent/dev/five', { cwd: dir });
  assert.equal(upstream.length, 1, 'the landed commit is equivalent, not identical');
  assert.equal(pending.length, 1, 'the remaining commit is genuinely pending');
});
