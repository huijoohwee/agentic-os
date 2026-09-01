import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import {
  CanonicalSyncError,
  PLAN_SCHEMA,
  RECEIPT_SCHEMA,
  applyCanonicalSync,
  planCanonicalSync,
} from '../src/canonical-sync.mjs';

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function fixture({ dirty = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-os-canonical-sync-'));
  const run = (args, options = {}) => git(args, { cwd: dir, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  write(join(dir, '.gitignore'), '.cache/\n');
  write(join(dir, 'tracked space.txt'), 'base tracked\n');
  write(join(dir, 'rename old.txt'), 'base rename\n');
  write(join(dir, 'delete me.txt'), 'base delete\n');
  run(['add', '.']);
  run(['commit', '--quiet', '--message', 'base']);
  const localSha = run(['rev-parse', 'HEAD']);

  run(['switch', '--quiet', '--create', 'target']);
  write(join(dir, 'tracked space.txt'), 'target tracked\n');
  write(join(dir, 'target only.txt'), 'target only\n');
  write(join(dir, 'target collision.txt'), 'target collision\n');
  rmSync(join(dir, 'delete me.txt'));
  run(['add', '-A']);
  run(['commit', '--quiet', '--message', 'target']);
  const targetSha = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', targetSha]);
  run(['switch', '--quiet', 'main']);
  run(['branch', '--delete', '--force', 'target']);

  if (dirty) {
    write(join(dir, 'tracked space.txt'), 'owned tracked\n');
    rmSync(join(dir, 'rename old.txt'));
    write(join(dir, 'rename new.txt'), 'owned rename\n');
    write(join(dir, 'untracked space.txt'), 'owned untracked\n');
    write(join(dir, 'target collision.txt'), 'owned collision\n');
    write(join(dir, '.cache', 'keep.bin'), 'ignored bytes\n');
  }
  return { dir, run, localSha, targetSha };
}

function reason(error, expected) {
  assert.ok(error instanceof CanonicalSyncError);
  assert.equal(error.reason, expected);
  return true;
}

test('plan is read-only and binds exact SHAs, inventory, authorization, and recovery ref', (t) => {
  const { dir, localSha, targetSha } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const before = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: dir });
  const plan = planCanonicalSync({ cwd: dir });
  const after = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: dir });

  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.expectedLocalSha, localSha);
  assert.equal(plan.expectedTargetSha, targetSha);
  assert.equal(plan.authorization, `agentic-os:canonical-sync:${plan.planDigest}`);
  assert.equal(
    plan.recoveryRef,
    `refs/agentic-os/recovery/canonical-sync/${plan.planDigest}`,
  );
  assert.deepEqual(plan.inventory.map((entry) => entry.path), [
    'rename new.txt',
    'rename old.txt',
    'target collision.txt',
    'tracked space.txt',
    'untracked space.txt',
  ]);
  assert.equal(after, before);
  assert.equal(git(['show-ref', '--verify', plan.recoveryRef], { cwd: dir, allowFail: true }), null);
});

test('apply refuses missing authorization and any byte drift before recovery or mutation', (t) => {
  const first = fixture();
  t.after(() => rmSync(first.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: first.dir });
  assert.throws(
    () => applyCanonicalSync(plan, { cwd: first.dir, authorization: 'almost' }),
    (error) => reason(error, 'blocked-authorization'),
  );
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: first.dir }), first.localSha);
  assert.equal(git(['show-ref', '--verify', plan.recoveryRef], { cwd: first.dir, allowFail: true }), null);

  write(join(first.dir, 'tracked space.txt'), 'drift after plan\n');
  assert.throws(
    () => applyCanonicalSync(plan, { cwd: first.dir, authorization: plan.authorization }),
    (error) => reason(error, 'blocked-plan-drift'),
  );
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: first.dir }), first.localSha);
  assert.equal(git(['show-ref', '--verify', plan.recoveryRef], { cwd: first.dir, allowFail: true }), null);
});

test('apply refuses target-ref drift and a pre-existing recovery ref', (t) => {
  const moved = fixture();
  t.after(() => rmSync(moved.dir, { recursive: true, force: true }));
  const movedPlan = planCanonicalSync({ cwd: moved.dir });
  const nextTarget = moved.run(
    ['commit-tree', `${moved.targetSha}^{tree}`, '-p', moved.targetSha],
    { input: 'target moved\n' },
  );
  moved.run(['update-ref', 'refs/remotes/origin/main', nextTarget, moved.targetSha]);
  assert.throws(
    () => applyCanonicalSync(movedPlan, {
      cwd: moved.dir,
      authorization: movedPlan.authorization,
    }),
    (error) => reason(error, 'blocked-plan-drift'),
  );
  assert.equal(moved.run(['rev-parse', 'HEAD']), moved.localSha);

  const occupied = fixture();
  t.after(() => rmSync(occupied.dir, { recursive: true, force: true }));
  const occupiedPlan = planCanonicalSync({ cwd: occupied.dir });
  occupied.run(['update-ref', occupiedPlan.recoveryRef, occupied.localSha]);
  assert.throws(
    () => applyCanonicalSync(occupiedPlan, {
      cwd: occupied.dir,
      authorization: occupiedPlan.authorization,
    }),
    (error) => reason(error, 'blocked-recovery-ref-exists'),
  );
  assert.equal(occupied.run(['rev-parse', 'HEAD']), occupied.localSha);
});

test('apply recovers dirty bytes, restores target, preserves ignored files, and emits a receipt', (t) => {
  const { dir, run, localSha, targetSha } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: dir });

  const receipt = applyCanonicalSync(plan, { cwd: dir, authorization: plan.authorization });

  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.priorHead, localSha);
  assert.equal(receipt.targetHead, targetSha);
  assert.equal(receipt.recoveryRef, plan.recoveryRef);
  assert.equal(run(['rev-parse', 'HEAD']), targetSha);
  assert.equal(run(['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.equal(readFileSync(join(dir, 'tracked space.txt'), 'utf8'), 'target tracked\n');
  assert.equal(readFileSync(join(dir, 'target collision.txt'), 'utf8'), 'target collision\n');
  assert.equal(readFileSync(join(dir, '.cache', 'keep.bin'), 'utf8'), 'ignored bytes\n');
  assert.equal(existsSync(join(dir, 'rename new.txt')), false);
  assert.equal(existsSync(join(dir, 'untracked space.txt')), false);

  assert.equal(run(['show', `${plan.recoveryRef}:tracked space.txt`]), 'owned tracked');
  assert.equal(run(['show', `${plan.recoveryRef}:rename new.txt`]), 'owned rename');
  assert.equal(run(['show', `${plan.recoveryRef}:untracked space.txt`]), 'owned untracked');
  assert.equal(run(['show', `${plan.recoveryRef}:target collision.txt`]), 'owned collision');
  assert.equal(
    run(['cat-file', '-e', `${plan.recoveryRef}:rename old.txt`], { allowFail: true }),
    null,
  );
});

test('ignored bytes that collide with a newly tracked target fail before planning', (t) => {
  const { dir, run } = fixture({ dirty: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['switch', '--quiet', '--detach', 'origin/main']);
  write(join(dir, '.cache', 'keep.bin'), 'target owns cache\n');
  run(['add', '--force', '.cache/keep.bin']);
  run(['commit', '--quiet', '--message', 'target tracks formerly ignored path']);
  const target = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', target]);
  run(['switch', '--quiet', 'main']);
  write(join(dir, '.cache', 'keep.bin'), 'ignored bytes\n');

  assert.throws(
    () => planCanonicalSync({ cwd: dir }),
    (error) => reason(error, 'blocked-ignored-target-collision'),
  );
  assert.equal(readFileSync(join(dir, '.cache', 'keep.bin'), 'utf8'), 'ignored bytes\n');
});
