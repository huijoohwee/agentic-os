import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, worktreeCleanupRisks } from '../src/git.mjs';
import { cherry, integrationProof, surveyLanes } from '../src/patch-identity.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import { retire } from '../src/worktree.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'adlc-'));
  const run = (args, options = {}) => git(args, { cwd: dir, ...options });
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

test('partially landed lane is not proven and reports the pending remainder', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['switch', '--quiet', '--create', 'agent/dev/five']);
  commitFile(run, dir, 'a.txt', 'a\n', 'add a');
  const first = git(['rev-parse', 'HEAD'], { cwd: dir });
  commitFile(run, dir, 'b.txt', 'b\n', 'add b');
  run(['switch', '--quiet', 'main']);
  run(['cherry-pick', first]);
  run(['commit', '--quiet', '--amend', '--message', 'add a (landed by the queue)']);
  assert.equal(integrationProof('main', 'agent/dev/five', { cwd: dir }), null);
  const { upstream, pending } = cherry('main', 'agent/dev/five', { cwd: dir });
  assert.equal(upstream.length, 1, 'the landed commit is equivalent, not identical');
  assert.equal(pending.length, 1, 'the remaining commit is genuinely pending');
});

test('compatibility retirement cannot delete even a clean exact worktree', (t) => {
  const { dir, run } = fixture();
  const parent = mkdtempSync(join(tmpdir(), 'adlc-retire-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ref = 'agent/dev/retire';
  run(['switch', '--quiet', '--create', ref]);
  commitFile(run, dir, 'retire.txt', 'retire\n', 'retire candidate');
  const tip = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--ff-only', ref]);
  const path = join(parent, 'lane');
  run(['worktree', 'add', '--quiet', path, ref]);
  assert.equal(isBoundLane(ref, path), true);
  assert.equal(isBoundLane(ref, dir), false);
  assert.throws(() => retire(ref, { cwd: dir, expectedHead: tip }),
    (error) => error.reason === 'blocked-authenticated-cleanup-required');
  assert.equal(run(['rev-parse', ref]), tip);
  assert.match(run(['worktree', 'list', '--porcelain']), /adlc-retire-/u);
  assert.equal(existsSync(path), true);
});

test('cleanup inventory sees ignored authored bytes and hidden tracked drift', (t) => {
  const { dir, run } = fixture();
  const parent = mkdtempSync(join(tmpdir(), 'adlc-owned-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.gitignore'), '*.secret\n');
  run(['add', '.gitignore']);
  run(['commit', '--quiet', '--message', 'ignore secrets']);
  const ref = 'agent/dev/owned';
  run(['switch', '--quiet', '--create', ref]);
  commitFile(run, dir, 'owned.txt', 'integrated\n', 'owned lane');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--ff-only', ref]);
  const ignoredPath = join(parent, 'ignored-lane');
  run(['worktree', 'add', '--quiet', ignoredPath, ref]);
  writeFileSync(join(ignoredPath, 'owned.secret'), 'must survive\n');
  assert.ok(worktreeCleanupRisks(ignoredPath).owned.includes('owned.secret'));
  assert.equal(worktreeCleanupRisks(ignoredPath, { includeIgnored: false })
    .owned.includes('owned.secret'), false);
  assert.equal(existsSync(join(ignoredPath, 'owned.secret')), true);
  unlinkSync(join(ignoredPath, 'owned.secret'));
  run(['update-index', '--assume-unchanged', 'owned.txt'], { cwd: ignoredPath });
  writeFileSync(join(ignoredPath, 'owned.txt'), 'hidden changed bytes\n');
  const risks = worktreeCleanupRisks(ignoredPath);
  assert.ok(risks.hidden.includes('owned.txt'));
  assert.ok(risks.tracked.includes('owned.txt'));
  assert.equal(readFileSync(join(ignoredPath, 'owned.txt'), 'utf8'), 'hidden changed bytes\n');
});

test('a survey binds proof to exact base and lane heads before a ref can move', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ref = 'agent/dev/moving';
  run(['switch', '--quiet', '--create', ref]);
  commitFile(run, dir, 'moving.txt', 'moving\n', 'moving candidate');
  const provenHead = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--ff-only', ref]);
  const baseHead = run(['rev-parse', 'main']);
  const [proof] = surveyLanes('main', [ref], { cwd: dir }).integrated;
  assert.equal(proof.head, provenHead);
  assert.equal(proof.baseHead, baseHead);
  const movedHead = run(['commit-tree', `${provenHead}^{tree}`, '-p', provenHead], {
    input: 'unintegrated ref advance\n',
  });
  run(['update-ref', `refs/heads/${ref}`, movedHead, provenHead]);
  assert.equal(run(['rev-parse', ref]), movedHead);
  assert.equal(integrationProof('main', ref, { cwd: dir }), null);
});
