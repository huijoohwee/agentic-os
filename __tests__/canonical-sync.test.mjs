import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { installStagedEntries } from '../src/canonical-staging.mjs';
import {
  CanonicalSyncError,
  PLAN_SCHEMA,
  applyCanonicalSync,
  decodeNulFields,
  planCanonicalSync,
} from '../src/canonical-sync.mjs';
import { runCanonicalSync } from '../bin/agentic-os-auxiliary.mjs';

const FILTER_MATERIALIZE = fileURLToPath(
  new URL('../bin/agentic-os-filter-materialize.mjs', import.meta.url),
);

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function canonicalPlan(cwd, overrides = {}) {
  return planCanonicalSync({
    cwd, branch: 'main', targetRef: 'refs/remotes/origin/main', ...overrides,
  });
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
  const plan = canonicalPlan(dir);
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
    () => canonicalPlan(dir, { targetRef: 'refs/heads/unprotected' }),
    (error) => reason(error, 'blocked-canonical-identity'),
  );
  assert.throws(() => planCanonicalSync({ cwd: dir }),
    (error) => reason(error, 'blocked-canonical-identity'));
});

test('profile-selected non-main canonical identity plans and applies exactly', (t) => {
  const subject = fixture({ dirty: false });
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
  const plan = canonicalPlan(first.dir);
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
  const movedPlan = canonicalPlan(moved.dir);
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
  const occupiedPlan = canonicalPlan(occupied.dir);
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
  const plan = canonicalPlan(held.dir);
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
      () => canonicalPlan(hidden.dir),
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
  const plan = canonicalPlan(weird.dir);
  assert.deepEqual(plan.inventory.map((entry) => entry.path), [path]);

  let receipt;
  assert.throws(() => applyPlan(plan, weird.dir), (error) => {
    receipt = error; return reason(error, 'blocked-dirty-inventory-copy-only');
  });
  assert.equal(existsSync(join(weird.dir, path)), true);
  assert.equal(weird.run(['show', `${receipt.detail.recoveryRef}:${path}`]),
    'owned unusual path');
});

test('filesystem mode drift is recovered even when core.fileMode hides it', (t) => {
  const mode = fixture({ dirty: false });
  t.after(() => rmSync(mode.dir, { recursive: true, force: true }));
  const path = 'tracked space.txt';
  mode.run(['config', 'core.fileMode', 'false']);
  chmodSync(join(mode.dir, path), 0o755);
  assert.equal(mode.run(['status', '--porcelain=v1', '--untracked-files=all']), '');

  const plan = canonicalPlan(mode.dir);
  assert.deepEqual(plan.inventory.map((entry) => [entry.path, entry.mode]), [[path, '100755']]);
  let receipt;
  assert.throws(() => applyPlan(plan, mode.dir), (error) => {
    receipt = error; return reason(error, 'blocked-dirty-inventory-copy-only');
  });
  assert.match(mode.run(['ls-tree', receipt.detail.recoveryRef, '--', path]), /^100755 blob /u);
  assert.equal(statSync(join(mode.dir, path)).mode & 0o111, 0o111);
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

  const plan = canonicalPlan(normalized.dir);
  assert.deepEqual(plan.inventory.map((entry) => entry.path), [path]);
  let receipt;
  assert.throws(() => applyPlan(plan, normalized.dir), (error) => {
    receipt = error; return reason(error, 'blocked-dirty-inventory-copy-only');
  });
  const recovered = execFileSync(
    'git',
    ['cat-file', 'blob', `${receipt.detail.recoveryRef}:${path}`],
    { cwd: normalized.dir },
  );
  assert.deepEqual(recovered, Buffer.from('base tracked\r\n'));
});

test('target installation materializes core.autocrlf checkout bytes', (t) => {
  const normalized = fixture({ dirty: false });
  t.after(() => rmSync(normalized.dir, { recursive: true, force: true }));
  normalized.run(['config', 'core.autocrlf', 'true']);

  const receipt = applyPlan(canonicalPlan(normalized.dir), normalized.dir);

  assert.equal(receipt.targetHead, normalized.targetSha);
  assert.deepEqual(readFileSync(join(normalized.dir, 'target only.txt')),
    Buffer.from('target only\r\n'));
  assert.equal(normalized.run(['status', '--porcelain=v1', '--untracked-files=all']), '');
});

test('filter materialization binds supplied object identity instead of a mutable index entry', (t) => {
  const subject = fixture({ dirty: false });
  const indexRoot = mkdtempSync(join(tmpdir(), 'agentic-os-filter-index-'));
  t.after(() => rmSync(subject.dir, { recursive: true, force: true }));
  t.after(() => rmSync(indexRoot, { recursive: true, force: true }));
  const path = 'tracked space.txt';
  const expectedOid = subject.run(['rev-parse', `HEAD:${path}`]);
  const substituteOid = subject.run(['hash-object', '-w', '--stdin'], {
    input: 'substitute bytes\n',
  });
  const env = { GIT_INDEX_FILE: join(indexRoot, 'index') };
  subject.run(['read-tree', 'HEAD'], { env });
  subject.run(['update-index', '--cacheinfo', `100644,${substituteOid},${path}`], { env });

  const result = spawnSync(process.execPath, [
    FILTER_MATERIALIZE, path, expectedOid, '1024',
  ], {
    cwd: subject.dir, env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'], timeout: 5_000,
  });

  assert.equal(result.status, 0, String(result.stderr));
  assert.deepEqual(result.output[3], Buffer.from('base tracked\n'));
});

test('target installation uses target-tree attributes for a configured smudge filter', (t) => {
  const filtered = fixture({ dirty: false });
  t.after(() => rmSync(filtered.dir, { recursive: true, force: true }));
  filtered.run(['config', 'filter.decorate.clean', "sed 's/^smudged://'" ]);
  filtered.run(['config', 'filter.decorate.smudge', "sed 's/^/smudged:/'" ]);
  filtered.run(['config', 'filter.decorate.required', 'true']);
  filtered.run(['switch', '--quiet', '--detach', 'origin/main']);
  write(join(filtered.dir, '.gitattributes'), 'filtered.txt filter=decorate\n');
  write(join(filtered.dir, 'filtered.txt'), 'target filtered\n');
  filtered.run(['add', '.gitattributes', 'filtered.txt']);
  filtered.run(['commit', '--quiet', '--message', 'target filter']);
  const targetSha = filtered.run(['rev-parse', 'HEAD']);
  rmSync(join(filtered.dir, 'filtered.txt'));
  filtered.run(['checkout', '--', 'filtered.txt']);
  assert.equal(readFileSync(join(filtered.dir, 'filtered.txt'), 'utf8'),
    'smudged:target filtered\n');
  filtered.run(['update-ref', 'refs/remotes/origin/main', targetSha]);
  filtered.run(['switch', '--quiet', 'main']);

  const receipt = applyPlan(canonicalPlan(filtered.dir), filtered.dir);

  assert.equal(receipt.targetHead, targetSha);
  assert.equal(readFileSync(join(filtered.dir, 'filtered.txt'), 'utf8'),
    'smudged:target filtered\n');
  assert.equal(filtered.run(['status', '--porcelain=v1', '--untracked-files=all']), '');
});

test('recovery preserves non-UTF-8 symlink target bytes and rejects non-UTF-8 paths', (t) => {
  const symlink = fixture({ dirty: false });
  t.after(() => rmSync(symlink.dir, { recursive: true, force: true }));
  const link = 'invalid-target-link';
  const target = Buffer.from([0xff]);
  symlinkSync(target, join(symlink.dir, link));
  const plan = canonicalPlan(symlink.dir);
  let receipt;
  assert.throws(() => applyPlan(plan, symlink.dir), (error) => {
    receipt = error; return reason(error, 'blocked-dirty-inventory-copy-only');
  });
  const recovered = execFileSync(
    'git',
    ['cat-file', 'blob', `${receipt.detail.recoveryRef}:${link}`],
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

  const receipt = applyPlan(canonicalPlan(target.dir), target.dir);
  assert.equal(receipt.targetHead, targetSha);
  assert.equal(statSync(join(target.dir, 'target executable')).mode & 0o111, 0o111);
  assert.deepEqual(readlinkSync(join(target.dir, 'target symlink'), { encoding: 'buffer' }),
    Buffer.from('target executable'));
});

test('a failure after recovery names the durable ref and commit', (t) => {
  const failed = fixture({ dirty: false });
  t.after(() => rmSync(failed.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(failed.dir);
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
  assert.equal(failed.run(['show', `${plan.recoveryRef}:tracked space.txt`]), 'base tracked');
});

test('planning refuses a target file over an existing directory', (t) => {
  const directory = fixture({ dirty: false });
  t.after(() => rmSync(directory.dir, { recursive: true, force: true }));
  mkdirSync(join(directory.dir, 'target collision.txt'));
  assert.throws(() => canonicalPlan(directory.dir),
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
    () => canonicalPlan(collision.dir),
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
    () => canonicalPlan(rules.dir),
    (error) => reason(error, 'blocked-ignore-rules-drift'),
  );
  assert.equal(readFileSync(join(rules.dir, '.cache', 'keep.bin'), 'utf8'), 'owned ignored bytes\n');
  assert.equal(
    rules.run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']),
    '',
  );
});

test('dirty apply retains a distinct copy receipt and has no target, index, or branch effects', (t) => {
  const { dir, run, localSha, targetSha } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plan = canonicalPlan(dir);
  const before = { index: readFileSync(join(dir, '.git', 'index')),
    status: run(['status', '--porcelain=v1', '--untracked-files=all']) };
  let receipt;
  assert.throws(() => applyPlan(plan, dir), (error) => {
    receipt = error; return reason(error, 'blocked-dirty-inventory-copy-only');
  });
  assert.equal(receipt.detail.copyOnly, true);
  assert.equal(receipt.detail.sourceRetired, false);
  assert.equal(existsSync(receipt.detail.quarantinePath), true);
  const manifestBytes = readFileSync(receipt.detail.quarantineManifestPath);
  assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),
    receipt.detail.quarantineManifestDigest);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.planDigest, plan.planDigest);
  assert.equal(manifest.entries.length, 4);
  assert.equal(receipt.detail.quarantineEntryCount, 4);
  assert.equal(run(['rev-parse', 'HEAD']), localSha);
  assert.equal(run(['rev-parse', 'refs/remotes/origin/main']), targetSha);
  assert.deepEqual(readFileSync(join(dir, '.git', 'index')), before.index);
  assert.equal(run(['status', '--porcelain=v1', '--untracked-files=all']), before.status);
  assert.equal(existsSync(join(dir, '.git', 'index.lock')), false);
  assert.deepEqual(readdirSync(join(dir, '.git')).filter((name) =>
    name.startsWith('agentic-os-canonical-sync-target-')), []);
  assert.equal(readFileSync(join(dir, 'tracked space.txt'), 'utf8'), 'owned tracked\n');
  assert.equal(readFileSync(join(dir, 'target collision.txt'), 'utf8'), 'owned collision\n');
  assert.equal(readFileSync(join(dir, '.cache', 'keep.bin'), 'utf8'), 'ignored bytes\n');
  assert.equal(run(['show', `${receipt.detail.recoveryRef}:tracked space.txt`]), 'owned tracked');
  assert.equal(run(['cat-file', '-e', `${plan.recoveryRef}:rename old.txt`],
    { allowFail: true }), null);
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
    () => canonicalPlan(dir),
    (error) => reason(error, 'blocked-ignored-target-collision'),
  );
  assert.equal(readFileSync(join(dir, '.cache', 'keep.bin'), 'utf8'), 'ignored bytes\n');
});
