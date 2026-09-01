import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, installStagedEntries } from '../src/git.mjs';
import {
  CanonicalSyncError,
  PLAN_SCHEMA,
  RECEIPT_SCHEMA,
  applyCanonicalSync,
  decodeNulFields,
  planCanonicalSync,
} from '../src/canonical-sync.mjs';
import { runCanonicalSync } from '../bin/agentic-os-auxiliary.mjs';

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

test('canonical-sync apply rejects a plan outside the active profile target', (t) => {
  const target = fixture({ dirty: false });
  t.after(() => rmSync(target.dir, { recursive: true, force: true }));
  const planPath = join(target.dir, 'foreign-plan.json');
  writeFileSync(planPath, JSON.stringify({
    branch: 'dev', targetRef: 'refs/remotes/origin/dev',
  }));
  const before = target.run(['rev-parse', 'HEAD']);
  assert.equal(runCanonicalSync(target.dir, [
    'apply', `--plan=${planPath}`, '--authorize=x', '--exclusive=y',
  ], { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' }), 1);
  assert.equal(target.run(['rev-parse', 'HEAD']), before);
});

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

function applyPlan(plan, cwd) {
  return applyCanonicalSync(plan, {
    cwd, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization,
  });
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
    plan.exclusiveAuthorization,
    `agentic-os:canonical-sync:exclusive:${plan.planDigest}`,
  );
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
  assert.throws(
    () => planCanonicalSync({ cwd: dir, targetRef: 'refs/heads/unprotected' }),
    (error) => reason(error, 'blocked-canonical-identity'),
  );
});

test('profile-selected non-main canonical identity plans and applies exactly', (t) => {
  const subject = fixture();
  t.after(() => rmSync(subject.dir, { recursive: true, force: true }));
  subject.run(['branch', '--move', 'trunk']);
  subject.run(['update-ref', 'refs/remotes/origin/trunk', subject.targetSha]);
  subject.run(['update-ref', '-d', 'refs/remotes/origin/main']);

  const plan = planCanonicalSync({
    cwd: subject.dir,
    branch: 'trunk',
    targetRef: 'refs/remotes/origin/trunk',
  });
  const receipt = applyPlan(plan, subject.dir);

  assert.equal(plan.branch, 'trunk');
  assert.equal(plan.targetRef, 'refs/remotes/origin/trunk');
  assert.equal(subject.run(['symbolic-ref', '--short', 'HEAD']), 'trunk');
  assert.equal(subject.run(['rev-parse', 'HEAD']), subject.targetSha);
  assert.equal(receipt.targetHead, subject.targetSha);
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
  assert.throws(
    () => applyCanonicalSync(plan, { cwd: first.dir, authorization: plan.authorization }),
    (error) => reason(error, 'blocked-exclusive-authorization'),
  );

  write(join(first.dir, 'tracked space.txt'), 'drift after plan\n');
  assert.throws(
    () => applyPlan(plan, first.dir),
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
      exclusive: movedPlan.exclusiveAuthorization,
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
      exclusive: occupiedPlan.exclusiveAuthorization,
    }),
    (error) => reason(error, 'blocked-recovery-ref-exists'),
  );
  assert.equal(occupied.run(['rev-parse', 'HEAD']), occupied.localSha);
});

test('apply refuses a held cooperative lock before recovery or mutation', (t) => {
  const held = fixture();
  t.after(() => rmSync(held.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: held.dir });
  const lock = join(held.dir, '.git', 'agentic-os-canonical-sync.lock');
  mkdirSync(lock);

  assert.throws(() => applyPlan(plan, held.dir),
    (error) => reason(error, 'blocked-exclusive-lock-held'));
  assert.equal(held.run(['show-ref', '--verify', plan.recoveryRef], { allowFail: true }), null);
  assert.equal(readFileSync(join(held.dir, 'untracked space.txt'), 'utf8'), 'owned untracked\n');
});

test('plan refuses index visibility flags without losing hidden authored bytes', (t) => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const hidden = fixture({ dirty: false });
    t.after(() => rmSync(hidden.dir, { recursive: true, force: true }));
    const path = 'tracked space.txt';
    hidden.run(['update-index', flag, '--', path]);
    write(join(hidden.dir, path), `owned unique ${flag}\n`);
    const before = {
      bytes: readFileSync(join(hidden.dir, path), 'utf8'),
      head: hidden.run(['rev-parse', 'HEAD']),
      status: hidden.run(['status', '--porcelain=v1', '--untracked-files=all']),
      flags: hidden.run(['ls-files', '-v', '--', path]),
      recoveryRefs: hidden.run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']),
    };

    assert.throws(
      () => planCanonicalSync({ cwd: hidden.dir }),
      (error) => reason(error, 'blocked-index-visibility-flags'),
    );
    assert.deepEqual({
      bytes: readFileSync(join(hidden.dir, path), 'utf8'),
      head: hidden.run(['rev-parse', 'HEAD']),
      status: hidden.run(['status', '--porcelain=v1', '--untracked-files=all']),
      flags: hidden.run(['ls-files', '-v', '--', path]),
      recoveryRefs: hidden.run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']),
    }, before);
  }
});

test('NUL inventory preserves a leading-space and newline path through recovery', (t) => {
  const weird = fixture({ dirty: false });
  t.after(() => rmSync(weird.dir, { recursive: true, force: true }));
  const path = ' leading\nname.txt';
  write(join(weird.dir, path), 'owned unusual path\n');
  const plan = planCanonicalSync({ cwd: weird.dir });
  assert.deepEqual(plan.inventory.map((entry) => entry.path), [path]);

  const receipt = applyPlan(plan, weird.dir);
  assert.equal(existsSync(join(weird.dir, path)), false);
  assert.equal(
    weird.run(['show', `${receipt.recoveryRef}:${path}`]),
    'owned unusual path',
  );
});

test('filesystem mode drift is recovered even when core.fileMode hides it', (t) => {
  const mode = fixture({ dirty: false });
  t.after(() => rmSync(mode.dir, { recursive: true, force: true }));
  const path = 'tracked space.txt';
  mode.run(['config', 'core.fileMode', 'false']);
  chmodSync(join(mode.dir, path), 0o755);
  assert.equal(mode.run(['status', '--porcelain=v1', '--untracked-files=all']), '');

  const plan = planCanonicalSync({ cwd: mode.dir });
  assert.deepEqual(plan.inventory.map((entry) => [entry.path, entry.mode]), [[path, '100755']]);
  const receipt = applyPlan(plan, mode.dir);
  assert.match(mode.run(['ls-tree', receipt.recoveryRef, '--', path]), /^100755 blob /u);
  assert.equal(statSync(join(mode.dir, path)).mode & 0o111, 0);
});

test('raw tracked bytes are recovered when Git normalization hides them', (t) => {
  const normalized = fixture({ dirty: false });
  t.after(() => rmSync(normalized.dir, { recursive: true, force: true }));
  const path = 'tracked space.txt';
  normalized.run(['config', 'core.autocrlf', 'true']);
  rmSync(join(normalized.dir, path));
  normalized.run(['checkout', '--', path]);
  assert.deepEqual(readFileSync(join(normalized.dir, path)), Buffer.from('base tracked\r\n'));
  assert.equal(normalized.run(['status', '--porcelain=v1', '--untracked-files=all']), '');

  const plan = planCanonicalSync({ cwd: normalized.dir });
  assert.deepEqual(plan.inventory.map((entry) => entry.path), [path]);
  const receipt = applyPlan(plan, normalized.dir);
  const recovered = execFileSync(
    'git',
    ['cat-file', 'blob', `${receipt.recoveryRef}:${path}`],
    { cwd: normalized.dir },
  );
  assert.deepEqual(recovered, Buffer.from('base tracked\r\n'));
});

test('recovery preserves non-UTF-8 symlink target bytes and rejects non-UTF-8 paths', (t) => {
  const symlink = fixture({ dirty: false });
  t.after(() => rmSync(symlink.dir, { recursive: true, force: true }));
  const link = 'invalid-target-link';
  const target = Buffer.from([0xff]);
  symlinkSync(target, join(symlink.dir, link));
  const plan = planCanonicalSync({ cwd: symlink.dir });
  const receipt = applyPlan(plan, symlink.dir);
  const recovered = execFileSync(
    'git',
    ['cat-file', 'blob', `${receipt.recoveryRef}:${link}`],
    { cwd: symlink.dir },
  );
  assert.deepEqual(recovered, target);

  assert.throws(
    () => decodeNulFields(Buffer.from([0xfe, 0x00])),
    (error) => reason(error, 'blocked-invalid-path-inventory'),
  );
  assert.throws(
    () => decodeNulFields(Buffer.from('unterminated')),
    (error) => reason(error, 'blocked-invalid-path-inventory'),
  );
});

test('target installation preserves executable modes and symlink targets', (t) => {
  const target = fixture({ dirty: false });
  t.after(() => rmSync(target.dir, { recursive: true, force: true }));
  target.run(['switch', '--quiet', '--detach', 'origin/main']);
  write(join(target.dir, 'target executable'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(target.dir, 'target executable'), 0o755);
  symlinkSync(Buffer.from('target executable'), join(target.dir, 'target symlink'));
  target.run(['add', '--', 'target executable', 'target symlink']);
  target.run(['commit', '--quiet', '--message', 'target modes']);
  const targetSha = target.run(['rev-parse', 'HEAD']);
  target.run(['update-ref', 'refs/remotes/origin/main', targetSha]);
  target.run(['switch', '--quiet', 'main']);

  const receipt = applyPlan(planCanonicalSync({ cwd: target.dir }), target.dir);
  assert.equal(receipt.targetHead, targetSha);
  assert.equal(statSync(join(target.dir, 'target executable')).mode & 0o111, 0o111);
  assert.deepEqual(readlinkSync(join(target.dir, 'target symlink'), { encoding: 'buffer' }),
    Buffer.from('target executable'));
});

test('a failure after recovery names the durable ref and commit', (t) => {
  const failed = fixture();
  t.after(() => rmSync(failed.dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: failed.dir });
  const hook = join(failed.dir, '.git', 'hooks', 'reference-transaction');
  write(hook, [
    '#!/bin/sh',
    'if [ "$1" = prepared ]; then',
    '  while read old new ref; do',
    '    [ "$ref" = refs/heads/main ] && exit 1',
    '  done',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(hook, 0o755);

  let failure;
  assert.throws(
    () => applyPlan(plan, failed.dir),
    (error) => {
      failure = error;
      return reason(error, 'blocked-after-recovery');
    },
  );
  assert.equal(failure.detail.recoveryRef, plan.recoveryRef);
  assert.match(failure.detail.recoveryCommit, /^[0-9a-f]{40}$/u);
  assert.equal(failed.run(['rev-parse', 'HEAD']), failed.localSha);
  assert.equal(failed.run(['show', `${plan.recoveryRef}:tracked space.txt`]), 'owned tracked');
});

test('planning refuses a target file over an existing directory', (t) => {
  const directory = fixture({ dirty: false });
  t.after(() => rmSync(directory.dir, { recursive: true, force: true }));
  mkdirSync(join(directory.dir, 'target collision.txt'));
  assert.throws(() => planCanonicalSync({ cwd: directory.dir }),
    (error) => reason(error, 'blocked-directory-target-collision'));
  assert.equal(statSync(join(directory.dir, 'target collision.txt')).isDirectory(), true);
  assert.equal(directory.run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']), '');
});

test('nested installation refuses a pre-existing symlink-parent escape without external writes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-install-root-'));
  const staging = mkdtempSync(join(tmpdir(), 'agentic-os-install-stage-'));
  const outside = mkdtempSync(join(tmpdir(), 'agentic-os-install-outside-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(staging, { recursive: true, force: true }));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(staging, 'dir'));
  writeFileSync(join(staging, 'dir', 'file.txt'), 'target\n');
  symlinkSync(outside, join(root, 'dir'));
  assert.throws(
    () => installStagedEntries(staging, [{ path: 'dir/file.txt', mode: '100644' }], root),
    (error) => error.reason === 'blocked-directory-ancestor',
  );
  assert.equal(existsSync(join(outside, 'file.txt')), false);
});

test('ignored leading-space collisions are rejected before recovery or overwrite', (t) => {
  const collision = fixture({ dirty: false });
  t.after(() => rmSync(collision.dir, { recursive: true, force: true }));
  const path = ' leading.txt';
  collision.run(['switch', '--quiet', '--detach', 'origin/main']);
  write(join(collision.dir, path), 'target bytes\n');
  collision.run(['add', '--force', '--', path]);
  collision.run(['commit', '--quiet', '--message', 'target owns leading path']);
  const target = collision.run(['rev-parse', 'HEAD']);
  collision.run(['update-ref', 'refs/remotes/origin/main', target]);
  collision.run(['switch', '--quiet', 'main']);
  write(join(collision.dir, '.git', 'info', 'exclude'), `${path}\n`);
  write(join(collision.dir, path), 'owned ignored bytes\n');

  assert.throws(
    () => planCanonicalSync({ cwd: collision.dir }),
    (error) => reason(error, 'blocked-ignored-target-collision'),
  );
  assert.equal(readFileSync(join(collision.dir, path), 'utf8'), 'owned ignored bytes\n');
  assert.equal(
    collision.run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']),
    '',
  );
});

test('ignore-rule drift is rejected while ignored bytes remain untouched', (t) => {
  const rules = fixture({ dirty: false });
  t.after(() => rmSync(rules.dir, { recursive: true, force: true }));
  rules.run(['switch', '--quiet', '--detach', 'origin/main']);
  rules.run(['rm', '--quiet', '.gitignore']);
  rules.run(['commit', '--quiet', '--message', 'target changes ignore rules']);
  const target = rules.run(['rev-parse', 'HEAD']);
  rules.run(['update-ref', 'refs/remotes/origin/main', target]);
  rules.run(['switch', '--quiet', 'main']);
  write(join(rules.dir, '.cache', 'keep.bin'), 'owned ignored bytes\n');

  assert.throws(
    () => planCanonicalSync({ cwd: rules.dir }),
    (error) => reason(error, 'blocked-ignore-rules-drift'),
  );
  assert.equal(readFileSync(join(rules.dir, '.cache', 'keep.bin'), 'utf8'), 'owned ignored bytes\n');
  assert.equal(
    rules.run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']),
    '',
  );
});

test('apply recovers dirty bytes, restores target, preserves ignored files, and emits a receipt', (t) => {
  const { dir, run, localSha, targetSha } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plan = planCanonicalSync({ cwd: dir });

  const receipt = applyPlan(plan, dir);

  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.priorHead, localSha);
  assert.equal(receipt.targetHead, targetSha);
  assert.equal(receipt.recoveryRef, plan.recoveryRef);
  assert.equal(receipt.recoveryRefObservedBeforeReceipt, true);
  assert.equal(receipt.quarantineRemoved, false);
  assert.equal(existsSync(receipt.quarantinePath), true);
  assert.equal(existsSync(receipt.quarantineManifestPath), true);
  const manifestBytes = readFileSync(receipt.quarantineManifestPath);
  assert.equal(
    createHash('sha256').update(manifestBytes).digest('hex'),
    receipt.quarantineManifestDigest,
  );
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, 'agentic-os-canonical-sync-quarantine/v1');
  assert.equal(manifest.planDigest, plan.planDigest);
  assert.equal(manifest.entries.length, receipt.quarantineEntryCount);
  assert.equal(receipt.visibleStatusClean, true);
  assert.equal(receipt.ignoredPathsPreservedInPlace, true);
  assert.equal(receipt.stagingRemoved, true);
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
