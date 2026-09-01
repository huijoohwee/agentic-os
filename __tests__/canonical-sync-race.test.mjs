import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
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
import { git, OperationLockError } from '../src/git.mjs';
import { stageTreeEntries } from '../src/canonical-staging.mjs';
import {
  CanonicalSyncError,
  applyCanonicalSync,
  planCanonicalSync,
} from '../src/canonical-sync.mjs';

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function canonicalPlan(cwd) {
  return planCanonicalSync({
    cwd, branch: 'main', targetRef: 'refs/remotes/origin/main',
  });
}

function fixture({ targetAttributes = null, dirty = false } = {}) {
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
  if (targetAttributes !== null) write(join(dir, '.gitattributes'), targetAttributes);
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
  }
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

function useCleanupResidueFilter(t, raced, {
  fail = false, retainLock = false, hardlinkCycle = false,
} = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'agentic-os-index-cleanup-filter-'));
  const filter = join(bin, 'filter');
  write(filter, [
    '#!/bin/sh',
    'index_root=${GIT_INDEX_FILE%/*}',
    'residue="$index_root/foreign-residue"',
    ...(hardlinkCycle ? ['ln "$GIT_INDEX_FILE" "$index_root/transient-link"',
      'rm "$index_root/transient-link"']
      : ['[ -e "$residue" ] || printf "foreign index residue\\n" > "$residue"']),
    ...(retainLock ? ['printf "foreign lock residue\\n" > "$GIT_DIR/agentic-os-canonical-sync.lock/foreign"'] : []),
    'cat',
    `exit ${fail ? 23 : 0}`,
    '',
  ].join('\n'));
  chmodSync(filter, 0o755);
  raced.run(['config', 'filter.cleanup.smudge', filter]);
  raced.run(['config', 'filter.cleanup.required', 'true']);
  t.after(() => rmSync(bin, { recursive: true, force: true }));
}

function retainedBytes(path) {
  return readdirSync(path).map((name) => readFileSync(join(path, name), 'utf8'));
}

test('target index proof treats leading stage-like path bytes literally', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-os-literal-index-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args, options = {}) => git(args, { cwd: dir, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  write(join(dir, '0:foo'), 'literal stage-like path\n');
  write(join(dir, 'foo'), 'different ordinary path\n');
  run(['add', '--', '0:foo', 'foo']);
  run(['commit', '--quiet', '--message', 'literal paths']);
  const entries = [
    { path: '0:foo', mode: '100644', oid: run(['hash-object', '--stdin'], {
      input: 'literal stage-like path\n' }) },
    { path: 'foo', mode: '100644', oid: run(['hash-object', '--stdin'], {
      input: 'different ordinary path\n' }) },
  ];
  const staged = stageTreeEntries('agentic-os-literal-index', 'HEAD', entries,
    { maxEntryBytes: 1_024, maxAggregateBytes: 2_048 }, dir);
  t.after(() => rmSync(staged.path, { recursive: true, force: true }));
  assert.equal(readFileSync(join(staged.path, '0:foo'), 'utf8'), 'literal stage-like path\n');
  assert.equal(readFileSync(join(staged.path, 'foo'), 'utf8'), 'different ordinary path\n');
});

test('filtered materialization refuses a pathname swap away from its opened descriptor', (t) => {
  const raced = fixture({ targetAttributes: '*.txt filter=swap\n' });
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const bin = mkdtempSync(join(tmpdir(), 'agentic-os-filter-path-swap-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const filter = join(bin, 'filter');
  write(filter, [
    '#!/bin/sh',
    'for staging in "$GIT_DIR"/agentic-os-filter-path-swap-*; do',
    '  case "$staging" in *-index-*) continue ;; esac',
    '  target="$staging/tracked space.txt"',
    '  [ -e "$target" ] || continue',
    '  /bin/mv "$target" "$target.original" || exit',
    '  printf "substitute!\\n" > "$target"',
    '  printf "filtered-ok\\n"',
    '  exit 0',
    'done',
    'exit 93',
    '',
  ].join('\n'));
  chmodSync(filter, 0o755);
  raced.run(['config', 'filter.swap.smudge', filter]);
  raced.run(['config', 'filter.swap.required', 'true']);
  const entries = ['.gitattributes', 'tracked space.txt'].map((path) => ({
    path, mode: '100644', oid: raced.run(['rev-parse', `${raced.targetSha}:${path}`]),
  }));
  let failure;
  assert.throws(() => stageTreeEntries('agentic-os-filter-path-swap', raced.targetSha, entries,
    { maxEntryBytes: 1_024, maxAggregateBytes: 2_048 }, raced.dir), (error) => {
    failure = error; return error.reason === 'blocked-target-filter-race';
  });
  assert.equal(readFileSync(join(failure.stagingPath, 'tracked space.txt'), 'utf8'), 'substitute!\n');
  assert.equal(readFileSync(join(failure.stagingPath, 'tracked space.txt.original'), 'utf8'), 'filtered-ok\n');
});

test('target staging preserves its primary filter error and exact cleanup residue', (t) => {
  const raced = fixture({ targetAttributes: '*.txt filter=cleanup\n' });
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  useCleanupResidueFilter(t, raced, { fail: true });
  const entries = ['.gitattributes', 'tracked space.txt'].map((path) => ({
    path, mode: '100644', oid: raced.run(['rev-parse', `${raced.targetSha}:${path}`]),
  }));
  let failure;
  assert.throws(() => stageTreeEntries('agentic-os-primary-cleanup', raced.targetSha, entries,
    { maxEntryBytes: 1_024, maxAggregateBytes: 2_048 }, raced.dir), (error) => {
    failure = error;
    return error.reason === 'blocked-target-filter';
  });
  const residue = join(failure.indexRoot, 'foreign-residue');
  assert.equal(readFileSync(residue, 'utf8'), 'foreign index residue\n');
  assert.equal(existsSync(failure.stagingPath), true);
  assert.equal(failure.indexPath, join(failure.indexRoot, 'index'));
  assert.ok(failure.indexCleanupError);
  assert.equal(failure.stagedEntryCount, 1); assert.ok(failure.stagedBytes > 0);
  assert.equal(failure.stagingAttemptedPath, 'tracked space.txt'); assert.equal(failure.stagingWriteResultUnknown, true);
});

test('target-index cleanup detects a private hardlink cycle even after the link is removed', (t) => {
  const raced = fixture({ targetAttributes: '*.txt filter=cleanup\n' });
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  useCleanupResidueFilter(t, raced, { hardlinkCycle: true });
  const entries = ['.gitattributes', 'tracked space.txt'].map((path) => ({
    path, mode: '100644', oid: raced.run(['rev-parse', `${raced.targetSha}:${path}`]),
  }));
  let failure;
  assert.throws(() => stageTreeEntries('agentic-os-index-link-cycle', raced.targetSha, entries,
    { maxEntryBytes: 1_024, maxAggregateBytes: 2_048 }, raced.dir), (error) => {
    failure = error; return error.reason === 'blocked-target-index-cleanup';
  });
  assert.equal(failure.indexCleanupError.code, 'ERR_EXACT_TREE_DRIFT');
  assert.equal(existsSync(join(failure.indexRoot, 'index')), true);
  assert.equal(existsSync(join(failure.indexRoot, 'transient-link')), false);
});

test('apply reports staging and index residue when successful filtering cannot clean up', (t) => {
  const raced = fixture({ targetAttributes: '*.txt filter=cleanup\n' });
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  useCleanupResidueFilter(t, raced, { retainLock: true });
  const plan = canonicalPlan(raced.dir);
  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return error instanceof OperationLockError;
  });
  const primary = failure.operationError.originalError;
  assert.equal(failure.operationError.reason, 'blocked-after-recovery');
  const residue = join(primary.indexRoot, 'foreign-residue');
  assert.equal(primary.reason, 'blocked-target-index-cleanup');
  assert.equal(readFileSync(residue, 'utf8'), 'foreign index residue\n');
  assert.equal(existsSync(primary.stagingPath), true);
  assert.equal(failure.operationArtifacts.stagingPath, primary.stagingPath);
  assert.equal(failure.operationArtifacts.indexRoot, primary.indexRoot);
  assert.equal(failure.operationArtifacts.indexPath, primary.indexPath);
  assert.equal(failure.operationArtifacts.indexCleanupCause, primary.indexCleanupError.code);
  assert.match(raced.run(['rev-parse', plan.recoveryRef]), /^[0-9a-f]{40}$/u);
});

test('an immediate pre-quarantine replacement is retained and fails closed', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  useGitWrapper(t, 'agentic-os-race-git-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  printf "RACED UNIQUE\\n" > "$RACE_PATH"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({
    RECOVERY_REF: plan.recoveryRef,
    RACE_PATH: join(raced.dir, 'tracked space.txt'),
  }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.equal(failure.detail.cause, 'blocked-quarantine-drift');
  assert.ok(failure.detail.quarantinePath);
  assert.ok(retainedBytes(failure.detail.quarantinePath).includes('RACED UNIQUE\n'));
  assert.equal(readFileSync(join(raced.dir, 'tracked space.txt'), 'utf8'), 'RACED UNIQUE\n');
  assert.equal(raced.run(['show', `${plan.recoveryRef}:tracked space.txt`]), 'base tracked');
});

test('a post-quarantine directory is never removed by target installation', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  useGitWrapper(t, 'agentic-os-install-race-git-', [
    'if [ "$1" = hash-object ] && [ "$2" = --stdin ] &&',
    '   [ ! -e "$SOURCE_SENTINEL" ] && [ ! -e "$RACE_PATH" ]; then',
    '  mkdir "$RACE_PATH"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ SOURCE_SENTINEL: join(raced.dir, 'tracked space.txt'),
    RACE_PATH: join(raced.dir, 'target collision.txt') }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.equal(failure.detail.cause, 'blocked-install-collision');
  assert.equal(failure.detail.collisionPath, 'target collision.txt');
  assert.ok(failure.detail.quarantinePath);
  assert.ok(failure.detail.stagingPath);
  assert.equal(existsSync(join(raced.dir, 'target collision.txt')), true);
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.localSha);
});

test('a normalization-equivalent post-install replacement retains recovery and fails closed', (t) => {
  const raced = fixture({ targetAttributes: '*.txt text eol=crlf\n' });
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  const target = join(raced.dir, 'target only.txt');
  useGitWrapper(t, 'agentic-os-target-fidelity-git-', [
    'if [ "$1" = status ]; then',
    '  printf "target only\\n" > "$TARGET_REPLACEMENT"',
    '  /bin/mv "$TARGET_REPLACEMENT" "$TARGET_PATH"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], ({ bin }) => ({
    TARGET_PATH: target,
    TARGET_REPLACEMENT: join(bin, 'normalization-equivalent-replacement'),
  }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  assert.equal(failure.detail.cause, 'blocked-target-install-drift');
  assert.equal(readFileSync(target, 'utf8'), 'target only\n');
  assert.equal(raced.run(['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.targetSha);
  assert.equal(existsSync(failure.detail.quarantinePath), true);
  assert.equal(existsSync(failure.detail.stagingPath), true);
  assert.equal(raced.run(['rev-parse', plan.recoveryRef]), failure.detail.recoveryCommit);
});

test('a private target-index substitution is detected after filtered materialization', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  const targetPath = 'target only.txt';
  const substituteOid = raced.run(['hash-object', '-w', '--stdin'], {
    input: 'substitute target bytes\n',
  });
  useGitWrapper(t, 'agentic-os-target-index-race-git-', [
    'if [ "$1" = cat-file ] && [ "$2" = --filters ] &&',
    '   [ "$3" = "--path=$TARGET_PATH" ]; then',
    '  "$REAL_GIT" update-index --cacheinfo "100644,$SUBSTITUTE_OID,$TARGET_PATH" || exit',
    '  printf "foreign lock residue\\n" > "$LOCK_PATH/foreign"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ TARGET_PATH: targetPath, SUBSTITUTE_OID: substituteOid,
    LOCK_PATH: join(raced.dir, '.git', 'agentic-os-canonical-sync.lock') }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return error instanceof OperationLockError;
  });
  assert.equal(failure.operationError.reason, 'blocked-after-recovery');
  assert.equal(failure.operationError.originalError.reason, 'blocked-target-index-race');
  assert.equal(failure.operationError.originalError.detail.path, targetPath);
  assert.equal(failure.operationArtifacts.stagingPath,
    failure.operationError.originalError.stagingPath);
  assert.equal(existsSync(failure.operationArtifacts.stagingPath), true);
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.localSha);
  assert.match(raced.run(['rev-parse', plan.recoveryRef]), /^[0-9a-f]{40}$/u);
});

test('the ref transaction refuses a moved origin without advancing local main', (t) => {
  const moved = fixture();
  t.after(() => rmSync(moved.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(moved.dir);
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
  const plan = canonicalPlan(raced.dir);
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
  assert.ok(retainedBytes(failure.detail.quarantinePath).includes('base tracked\n'));
});

test('post-transaction recovery-ref loss retains both private preservation surfaces', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
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

test('final cleanup retains and reports a replaced target staging directory', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  let countFile;
  useGitWrapper(t, 'agentic-os-staging-cleanup-race-git-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  count=0',
    '  [ -f "$COUNT_FILE" ] && count=$(/bin/cat "$COUNT_FILE")',
    '  count=$((count + 1))',
    '  printf "%s\\n" "$count" > "$COUNT_FILE"',
    '  if [ "$count" -eq 4 ]; then',
    '    for staging in "$COMMON_DIR"/agentic-os-canonical-sync-target-*; do',
    '      case "$staging" in *-index-*) continue ;; esac',
    '      [ -d "$staging" ] || continue',
    '      /bin/mv "$staging" "$staging.original" || exit',
    '      /bin/mkdir -m 700 "$staging" || exit',
    '      printf "foreign staging residue\\n" > "$staging/foreign"',
    '      break',
    '    done',
    '  fi',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], ({ bin }) => {
    countFile = join(bin, 'recovery-ref-count');
    return { RECOVERY_REF: plan.recoveryRef, COUNT_FILE: countFile,
      COMMON_DIR: join(raced.dir, '.git') };
  });

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return reason(error, 'blocked-after-recovery');
  });
  const stagingPath = failure.detail.stagingPath;
  assert.equal(failure.detail.cause, 'blocked-target-staging-cleanup');
  assert.equal(readFileSync(join(stagingPath, 'foreign'), 'utf8'), 'foreign staging residue\n');
  assert.equal(existsSync(`${stagingPath}.original`), true);
  assert.notEqual(lstatSync(stagingPath, { bigint: true }).ino,
    failure.originalError.stagingIdentity.ino);
});

test('final recovery-ref observation cannot outlive its retained quarantine anchor', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  let countFile;
  useGitWrapper(t, 'agentic-os-final-ref-race-git-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  count=0',
    '  [ -f "$COUNT_FILE" ] && count=$(/bin/cat "$COUNT_FILE")',
    '  count=$((count + 1))',
    '  printf "%s\\n" "$count" > "$COUNT_FILE"',
    '  if [ "$count" -eq 5 ]; then',
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

  assert.equal(readFileSync(countFile, 'utf8').trim(), '5');
  assert.equal(receipt.recoveryRefObservedBeforeReceipt, true);
  assert.equal('recoveryRefDurable' in receipt, false);
  assert.equal(raced.run(['show-ref', '--verify', plan.recoveryRef], { allowFail: true }), null);
  assert.equal(receipt.quarantineRemoved, false);
  assert.equal(existsSync(receipt.quarantinePath), true);
  assert.ok(retainedBytes(receipt.quarantinePath).includes('base tracked\n'));
  assert.equal(receipt.stagingRemoved, true);
  assert.deepEqual(
    readdirSync(join(raced.dir, '.git'))
      .filter((name) => name.startsWith('agentic-os-canonical-sync-target-')),
    [],
  );
});

test('a successful canonical receipt remains exact when foreign lock bytes appear', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  const lockPath = join(raced.dir, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-receipt-lock-git-', [
    'if [ "$1" = status ] && [ -d "$LOCK_PATH" ]; then',
    '  printf "foreign lock bytes\\n" > "$LOCK_PATH/foreign"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return error instanceof OperationLockError;
  });
  assert.equal(failure.reason, 'blocked-canonical-sync-lock-integrity');
  assert.equal(failure.operationError, null);
  assert.equal(failure.operationResult.schema, 'agentic-os-canonical-sync-receipt/v2');
  assert.equal(failure.operationArtifacts.effectsRetained, true);
  assert.equal(failure.operationArtifacts.recoveryRefPublished, true);
  assert.equal(failure.operationArtifacts.quarantineCreated, true);
  assert.equal(failure.operationArtifacts.sourceRetired, true);
  assert.equal(failure.operationArtifacts.targetInstalled, true);
  assert.equal(failure.operationArtifacts.indexPublished, true);
  assert.equal(failure.operationArtifacts.canonicalRefPublished, true);
  assert.equal(failure.operationArtifacts.stagingRemoved, true);
  assert.equal(failure.operationResult.targetHead, raced.targetSha);
  assert.equal(failure.operationArtifacts.quarantinePath,
    failure.operationResult.quarantinePath);
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.targetSha);
  assert.equal(readFileSync(join(lockPath, 'foreign'), 'utf8'), 'foreign lock bytes\n');
});

test('post-recovery evidence remains exact when its nonempty lock also fails', (t) => {
  const raced = fixture();
  t.after(() => rmSync(raced.dir, { recursive: true, force: true }));
  const plan = canonicalPlan(raced.dir);
  const lockPath = join(raced.dir, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-evidence-lock-git-', [
    'if [ "$1" = update-ref ] && [ "$2" = --stdin ]; then',
    '  printf "foreign lock bytes\\n" > "$LOCK_PATH/foreign"',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => applyPlan(plan, raced.dir), (error) => {
    failure = error;
    return error instanceof OperationLockError;
  });
  assert.equal(failure.reason, 'blocked-canonical-sync-lock-integrity');
  assert.ok(failure.operationError instanceof CanonicalSyncError);
  assert.equal(failure.operationError.reason, 'blocked-after-recovery');
  assert.equal(failure.operationArtifacts.effectsRetained, true);
  assert.equal(failure.cause, failure.operationError);
  assert.equal(failure.operationError.cause, failure.operationError.originalError);
  assert.match(failure.operationError.originalError.message, /update-ref --stdin/u);
  assert.equal(failure.operationArtifacts.recoveryCommit,
    failure.operationError.detail.recoveryCommit);
  assert.equal(readFileSync(join(lockPath, 'foreign'), 'utf8'), 'foreign lock bytes\n');
});
