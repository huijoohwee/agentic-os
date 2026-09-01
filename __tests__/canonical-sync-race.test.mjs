import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import {
  CanonicalSyncError,
  applyCanonicalSync,
  planCanonicalSync,
} from '../src/canonical-sync.mjs';

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-os-canonical-sync-race-'));
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

  write(join(dir, 'tracked space.txt'), 'owned tracked\n');
  rmSync(join(dir, 'rename old.txt'));
  write(join(dir, 'rename new.txt'), 'owned rename\n');
  write(join(dir, 'untracked space.txt'), 'owned untracked\n');
  write(join(dir, 'target collision.txt'), 'owned collision\n');
  write(join(dir, '.cache', 'keep.bin'), 'ignored bytes\n');
  return { dir, run, localSha, targetSha };
}

function reason(error, expected) {
  assert.ok(error instanceof CanonicalSyncError);
  assert.equal(error.reason, expected);
  return true;
}

function applyPlan(plan, cwd) {
  return applyCanonicalSync(plan, {
    cwd, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization,
  });
}

function useGitWrapper(t, prefix, body, extraEnvironment = () => ({})) {
  const bin = mkdtempSync(join(tmpdir(), prefix));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const wrapper = join(bin, 'git');
  write(wrapper, ['#!/bin/sh', ...body, ''].join('\n'));
  chmodSync(wrapper, 0o755);
  const next = {
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: realGit,
    ...extraEnvironment({ bin, realGit }),
  };
  const prior = Object.fromEntries(Object.keys(next).map((key) => [key, process.env[key]]));
  Object.assign(process.env, next);
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(bin, { recursive: true, force: true });
  });
  return { bin, realGit };
}

function retainedBytes(path) {
  return readdirSync(path).map((name) => readFileSync(join(path, name), 'utf8'));
}

test('an immediate pre-quarantine replacement is retained and fails closed', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: raced.dir });
  useGitWrapper(t, 'agentic-os-race-git-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  printf "RACED UNIQUE\\n" > "$RACE_PATH"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({
    RECOVERY_REF: plan.recoveryRef,
    RACE_PATH: join(raced.dir, 'untracked space.txt'),
  }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.equal(failure.detail.cause, 'blocked-quarantine-drift');
  assert.ok(failure.detail.quarantinePath);
  assert.ok(retainedBytes(failure.detail.quarantinePath).includes('RACED UNIQUE\n'));
  assert.equal(raced.run(['show', `${plan.recoveryRef}:untracked space.txt`]), 'owned untracked');
});

test('a post-quarantine directory is never removed by target installation', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: raced.dir });
  let countFile;
  useGitWrapper(t, 'agentic-os-install-race-git-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  count=0',
    '  [ -f "$COUNT_FILE" ] && count=$(/bin/cat "$COUNT_FILE")',
    '  count=$((count + 1))',
    '  printf "%s\\n" "$count" > "$COUNT_FILE"',
    '  [ "$count" -eq 2 ] && mkdir "$RACE_PATH"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], ({ bin }) => {
    countFile = join(bin, 'recovery-ref-count');
    return {
      RECOVERY_REF: plan.recoveryRef,
      COUNT_FILE: countFile,
      RACE_PATH: join(raced.dir, 'target collision.txt'),
    };
  });

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.equal(failure.detail.cause, 'blocked-install-collision');
  assert.equal(failure.detail.collisionPath, 'target collision.txt');
  assert.ok(failure.detail.quarantinePath);
  assert.ok(failure.detail.stagingPath);
  assert.equal(raced.run(['show', `${plan.recoveryRef}:target collision.txt`]), 'owned collision');
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.localSha);
  assert.equal(readFileSync(countFile, 'utf8').trim(), '2');
});

test('the ref transaction refuses a moved origin without advancing local main', (t) => {
  const moved = fixture();
  t.after(() => rmSync(moved.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: moved.dir });
  const nextTarget = moved.run(
    ['commit-tree', `${moved.targetSha}^{tree}`, '-p', moved.targetSha],
    { input: 'target moved during apply\n' },
  );
  useGitWrapper(t, 'agentic-os-ref-race-git-', [
    'if [ "$1" = update-ref ] && [ "$2" = --stdin ]; then',
    '  "$REAL_GIT" update-ref refs/remotes/origin/main "$MOVED_TARGET" "$EXPECTED_TARGET"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ MOVED_TARGET: nextTarget, EXPECTED_TARGET: moved.targetSha }));

  let failure;
  assert.throws(() => applyPlan(plan, moved.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.match(failure.detail.cause, /update-ref --stdin/u);
  assert.equal(moved.run(['rev-parse', 'refs/heads/main']), moved.localSha);
  assert.equal(moved.run(['rev-parse', 'HEAD']), moved.localSha);
  assert.equal(moved.run(['rev-parse', 'refs/remotes/origin/main']), nextTarget);
  assert.match(moved.run(['rev-parse', plan.recoveryRef]), /^[0-9a-f]{40}$/u);
});

test('the ref transaction refuses recovery-ref loss and retains quarantine', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: raced.dir });
  useGitWrapper(t, 'agentic-os-recovery-ref-race-git-', [
    'if [ "$1" = update-ref ] && [ "$2" = --stdin ]; then',
    '  "$REAL_GIT" update-ref -d "$RECOVERY_REF"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ RECOVERY_REF: plan.recoveryRef }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.match(failure.detail.cause, /update-ref --stdin/u);
  assert.equal(raced.run(['rev-parse', 'refs/heads/main']), raced.localSha);
  assert.equal(raced.run(['show-ref', '--verify', plan.recoveryRef], { allowFail: true }), null);
  assert.ok(failure.detail.quarantinePath);
  assert.ok(failure.detail.stagingPath);
  assert.ok(retainedBytes(failure.detail.quarantinePath).includes('owned tracked\n'));
});

test('post-transaction recovery-ref loss retains both private preservation surfaces', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: raced.dir });
  useGitWrapper(t, 'agentic-os-post-ref-race-git-', [
    'if [ "$1" = update-ref ] && [ "$2" = --stdin ]; then',
    '  "$REAL_GIT" "$@"',
    '  status=$?',
    '  "$REAL_GIT" update-ref -d "$RECOVERY_REF"',
    '  exit $status',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ RECOVERY_REF: plan.recoveryRef }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.equal(failure.detail.cause, 'blocked-postcondition');
  assert.equal(raced.run(['rev-parse', 'refs/heads/main']), raced.targetSha);
  assert.equal(raced.run(['show-ref', '--verify', plan.recoveryRef], { allowFail: true }), null);
  assert.equal(existsSync(failure.detail.quarantinePath), true);
  assert.equal(existsSync(failure.detail.stagingPath), true);
});

test('final recovery-ref observation cannot outlive its retained quarantine anchor', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: raced.dir });
  let countFile;
  useGitWrapper(t, 'agentic-os-final-ref-race-git-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  count=0',
    '  [ -f "$COUNT_FILE" ] && count=$(/bin/cat "$COUNT_FILE")',
    '  count=$((count + 1))',
    '  printf "%s\\n" "$count" > "$COUNT_FILE"',
    '  if [ "$count" -eq 4 ]; then',
    '    observed=$("$REAL_GIT" "$@")',
    '    status=$?',
    '    "$REAL_GIT" update-ref -d "$RECOVERY_REF"',
    '    printf "%s\\n" "$observed"',
    '    exit "$status"',
    '  fi',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], ({ bin }) => {
    countFile = join(bin, 'recovery-ref-count');
    return { RECOVERY_REF: plan.recoveryRef, COUNT_FILE: countFile };
  });

  const receipt = applyPlan(plan, raced.dir);

  assert.equal(readFileSync(countFile, 'utf8').trim(), '4');
  assert.equal(receipt.recoveryRefObservedBeforeReceipt, true);
  assert.equal('recoveryRefDurable' in receipt, false);
  assert.equal(raced.run(['show-ref', '--verify', plan.recoveryRef], { allowFail: true }), null);
  assert.equal(receipt.quarantineRemoved, false);
  assert.equal(existsSync(receipt.quarantinePath), true);
  assert.ok(retainedBytes(receipt.quarantinePath).includes('owned tracked\n'));
  assert.equal(receipt.stagingRemoved, true);
  assert.deepEqual(
    readdirSync(join(raced.dir, '.git'))
      .filter((name) => name.startsWith('agentic-os-canonical-sync-target-')),
    [],
  );
});
