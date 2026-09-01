import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, OperationLockError } from '../src/git.mjs';
import { applyCanonicalSync, CanonicalSyncError, planCanonicalSync } from '../src/canonical-sync.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-canonical-cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']); run(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'base']);
  const local = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', '--create', 'target']);
  writeFileSync(join(root, 'base.txt'), 'target base\n');
  writeFileSync(join(root, 'target.txt'), 'target only\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'target']);
  const target = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', target]);
  run(['switch', '--quiet', 'main']); run(['branch', '--delete', '--force', 'target']);
  return { root, run, local, target };
}

function plan(cwd) {
  return planCanonicalSync({ cwd, branch: 'main', targetRef: 'refs/remotes/origin/main' });
}

function apply(value, cwd) {
  return applyCanonicalSync(value, {
    cwd, authorization: value.authorization, exclusive: value.exclusiveAuthorization,
  });
}

function useGitWrapper(t, prefix, lines, environment) {
  const bin = mkdtempSync(join(tmpdir(), prefix));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const wrapper = join(bin, 'git');
  writeFileSync(wrapper, ['#!/bin/sh', ...lines, ''].join('\n')); chmodSync(wrapper, 0o755);
  const next = { PATH: `${bin}:${process.env.PATH}`, REAL_GIT: realGit,
    ...environment({ bin }) };
  const prior = Object.fromEntries(Object.keys(next).map((key) => [key, process.env[key]]));
  Object.assign(process.env, next);
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(bin, { recursive: true, force: true });
  });
}

test('a preflight-only canonical refusal explicitly reports no retained effects', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  writeFileSync(join(raced.root, 'base.txt'), 'drift before apply\n');
  useGitWrapper(t, 'agentic-os-preflight-lock-', [
    'if [ -d "$LOCK_PATH" ] && [ ! -e "$LOCK_PATH/foreign" ]; then',
    '  printf "foreign lock residue\n" > "$LOCK_PATH/foreign"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  assert.equal(failure.operationError.reason, 'blocked-plan-drift');
  assert.equal(failure.operationArtifacts.effectsRetained, false);
  assert.equal(failure.operationArtifacts.recoveryCommit, null);
  assert.equal(raced.run(['show-ref', '--verify', candidate.recoveryRef],
    { allowFail: true }), null);
});

test('a recovery blob written before capture returns is reported behind lock residue', (t) => {
  const raced = fixture(t);
  writeFileSync(join(raced.root, 'base.txt'), 'owned dirty bytes\n');
  const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-recovery-object-boundary-', [
    'if [ "$1" = update-index ] && [ "$2" = --add ]; then',
    '  printf "foreign lock residue\n" > "$LOCK_PATH/foreign"',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const artifacts = failure.operationArtifacts;
  assert.equal(artifacts.effectsRetained, true);
  assert.equal(artifacts.recoveryObjectsWritten, true);
  assert.equal(artifacts.recoveryObjectOids.length, 1);
  assert.equal(raced.run(['cat-file', '-t', artifacts.recoveryObjectOids[0]]), 'blob');
  assert.equal(artifacts.recoveryTreeWritten, false);
  assert.equal(artifacts.recoveryCommitWritten, false);
  assert.equal(artifacts.recoveryRefPublished, false);
  assert.equal(artifacts.sourceRetired, false);
  assert.equal(artifacts.targetInstalledCount, 0);
  assert.equal(artifacts.indexPublished, false);
  assert.equal(artifacts.canonicalRefPublished, false);
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.local);
  assert.equal(raced.run(['show-ref', '--verify', candidate.recoveryRef],
    { allowFail: true }), null);
});

test('a deleted-only recovery tree response loss is retained as an attempted unknown write', (t) => {
  const raced = fixture(t);
  rmSync(join(raced.root, 'base.txt'));
  const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-recovery-tree-response-loss-', [
    'if [ "$1" = write-tree ]; then',
    '  "$REAL_GIT" "$@" >/dev/null || exit $?',
    '  printf "foreign lock residue\n" > "$LOCK_PATH/foreign"',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const artifacts = failure.operationArtifacts;
  assert.equal(artifacts.effectsRetained, true);
  assert.equal(artifacts.recoveryObjectsWritten, false);
  assert.equal(artifacts.recoveryTreeWriteAttempted, true);
  assert.equal(artifacts.recoveryTreeWriteResultUnknown, true);
  assert.equal(artifacts.recoveryTreeWritten, false);
  assert.equal(artifacts.recoveryTree, null);
  assert.equal(artifacts.recoveryCommitWriteAttempted, false);
  assert.equal(artifacts.recoveryRefPublished, false);
  assert.equal(artifacts.quarantineCreated, false);
  assert.equal(artifacts.sourceRetired, false);
  assert.equal(artifacts.targetInstallAttempted, false);
  assert.equal(artifacts.indexPublished, false);
  assert.equal(artifacts.canonicalRefPublished, false);
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.local);
  assert.equal(raced.run(['show-ref', '--verify', candidate.recoveryRef],
    { allowFail: true }), null);
});

test('late canonical-ref CAS failure reports every prior destructive boundary', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-late-ref-boundary-', [
    'if [ "$1" = update-ref ] && [ "$2" = --stdin ]; then',
    '  printf "foreign lock residue\n" > "$LOCK_PATH/foreign"',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const artifacts = failure.operationArtifacts;
  assert.equal(artifacts.recoveryTreeWritten, true);
  assert.equal(artifacts.recoveryCommitWritten, true);
  assert.equal(artifacts.recoveryRefPublished, true);
  assert.equal(artifacts.quarantineCreated, true);
  assert.equal(artifacts.sourceRetired, true);
  assert.ok(artifacts.retiredEntryCount > 0);
  assert.equal(artifacts.targetInstalled, true);
  assert.ok(artifacts.targetInstalledCount > 0);
  assert.equal(artifacts.indexPublished, true);
  assert.equal(artifacts.canonicalRefPublished, false);
  assert.equal(artifacts.canonicalRefCurrentOid, raced.local);
  assert.equal(artifacts.stagingRemoved, false);
  assert.equal(existsSync(artifacts.stagingPath), true);
  assert.equal(raced.run(['rev-parse', 'refs/heads/main']), raced.local);
});

test('a mid-loop target collision reports the exact completed installation prefix', (t) => {
  const raced = fixture(t);
  raced.run(['switch', '--quiet', '--detach', 'refs/remotes/origin/main']);
  writeFileSync(join(raced.root, '.gitattributes'), 'target.txt filter=collision\n');
  raced.run(['add', '.gitattributes']);
  raced.run(['commit', '--quiet', '--message', 'target filter']);
  raced.run(['update-ref', 'refs/remotes/origin/main', raced.run(['rev-parse', 'HEAD'])]);
  raced.run(['switch', '--quiet', 'main']);
  const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  let filter;
  useGitWrapper(t, 'agentic-os-partial-install-boundary-', ['exec "$REAL_GIT" "$@"'],
    ({ bin }) => {
      filter = join(bin, 'collision-filter');
      writeFileSync(filter, [
        '#!/bin/sh',
        'if [ ! -e "$COLLISION" ]; then',
        '  printf "foreign target bytes\\n" > "$COLLISION"',
        '  printf "foreign lock residue\\n" > "$LOCK_PATH/foreign"',
        'fi',
        'exec /bin/cat',
        '',
      ].join('\n'));
      chmodSync(filter, 0o755);
      return { COLLISION: join(raced.root, 'target.txt'), LOCK_PATH: lockPath };
    });
  raced.run(['config', 'filter.collision.smudge', filter]);
  raced.run(['config', 'filter.collision.required', 'true']);

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const artifacts = failure.operationArtifacts;
  assert.equal(failure.operationError.reason, 'blocked-after-recovery');
  assert.equal(failure.operationError.detail.cause, 'blocked-install-collision');
  assert.equal(artifacts.sourceRetired, true);
  assert.equal(artifacts.targetInstallAttempted, true);
  assert.equal(artifacts.targetInstalled, false);
  assert.equal(artifacts.targetInstalledCount, 2);
  assert.equal(artifacts.targetInstalledThrough, 'base.txt');
  assert.equal(artifacts.targetInstallFailedPath, 'target.txt');
  assert.equal(artifacts.indexPublished, false);
  assert.equal(artifacts.canonicalRefPublished, false);
  assert.equal(readFileSync(join(raced.root, 'base.txt'), 'utf8'), 'target base\n');
  assert.equal(readFileSync(join(raced.root, 'target.txt'), 'utf8'), 'foreign target bytes\n');
  assert.equal(raced.run(['rev-parse', 'refs/heads/main']), raced.local);
});

test('failed source inspection reports every target parent created before installation', (t) => {
  const raced = fixture(t);
  raced.run(['switch', '--quiet', '--detach', 'refs/remotes/origin/main']);
  mkdirSync(join(raced.root, 'nested', 'leaf'), { recursive: true });
  writeFileSync(join(raced.root, 'nested', 'leaf', 'file.txt'), 'nested target\n');
  writeFileSync(join(raced.root, 'ztrigger.txt'), 'trigger\n');
  writeFileSync(join(raced.root, '.gitattributes'),
    'ztrigger.txt filter=remove-staged-source\n');
  raced.run(['add', '.']); raced.run(['commit', '--quiet', '--message', 'nested target']);
  raced.run(['update-ref', 'refs/remotes/origin/main', raced.run(['rev-parse', 'HEAD'])]);
  raced.run(['switch', '--quiet', 'main']);
  const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  let filter;
  useGitWrapper(t, 'agentic-os-parent-journal-', ['exec "$REAL_GIT" "$@"'], ({ bin }) => {
    filter = join(bin, 'remove-staged-source-filter');
    writeFileSync(filter, [
      '#!/bin/sh',
      'for staging in "$GIT_DIR"/agentic-os-canonical-sync-target-*; do',
      '  case "$staging" in *-index-*) continue ;; esac',
      '  source="$staging/nested/leaf/file.txt"',
      '  [ -f "$source" ] || continue',
      '  /bin/rm "$source" || exit',
      '  printf "foreign lock residue\\n" > "$LOCK_PATH/foreign"',
      '  break',
      'done',
      'exec /bin/cat',
      '',
    ].join('\n'));
    chmodSync(filter, 0o755);
    return { LOCK_PATH: lockPath };
  });
  raced.run(['config', 'filter.remove-staged-source.smudge', filter]);
  raced.run(['config', 'filter.remove-staged-source.required', 'true']);

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const artifacts = failure.operationArtifacts;
  assert.equal(failure.operationError.reason, 'blocked-after-recovery');
  assert.equal(artifacts.targetInstallFailedPath, 'nested/leaf/file.txt');
  assert.equal(artifacts.targetParentCreationAttempted, true);
  assert.equal(artifacts.targetParentCreationResultUnknown, false);
  assert.equal(artifacts.targetParentAttemptedPath, null);
  assert.equal(artifacts.targetParentCreationFailedPath, null);
  assert.deepEqual(artifacts.targetParentDirectoriesCreated, ['nested', 'nested/leaf']);
  assert.equal(artifacts.targetParentDirectoryCount, 2);
  assert.equal(artifacts.targetParentCreatedThrough, 'nested/leaf');
  assert.equal(artifacts.targetInstalled, false);
  assert.equal(artifacts.targetInstalledCount, 2);
  assert.equal(artifacts.targetInstalledThrough, 'base.txt');
  assert.equal(existsSync(join(raced.root, 'nested')), true);
  assert.equal(existsSync(join(raced.root, 'nested', 'leaf')), true);
  assert.equal(existsSync(join(raced.root, 'nested', 'leaf', 'file.txt')), false);
  assert.equal(artifacts.indexPublished, false);
  assert.equal(artifacts.canonicalRefPublished, false);
  assert.equal(raced.run(['rev-parse', 'refs/heads/main']), raced.local);
});

test('recovery-temp cleanup preserves the primary Git error and exact additive residue', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-recovery-temp-race-', [
    'if [ "$1" = commit-tree ]; then',
    '  for temp in "$COMMON_DIR"/agentic-os-canonical-sync-*; do',
    '    case "$temp" in *-target-*) continue ;; esac',
    '    [ -f "$temp/index" ] || continue',
    '    printf "foreign recovery residue\\n" > "$temp/foreign"',
    '    break',
    '  done',
    '  printf "foreign lock residue\\n" > "$LOCK_PATH/foreign"',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ COMMON_DIR: join(raced.root, '.git'), LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  assert.match(failure.operationError.message, /commit-tree/u);
  assert.equal(failure.operationError.recoveryTempCleanupError.code, 'ERR_EXACT_TREE_DRIFT');
  assert.equal(readFileSync(join(failure.operationArtifacts.recoveryTempPath, 'foreign'), 'utf8'),
    'foreign recovery residue\n');
  assert.equal(failure.operationArtifacts.recoveryTempCleanupCause, 'ERR_EXACT_TREE_DRIFT');
  assert.equal(raced.run(['show-ref', '--verify', candidate.recoveryRef], { allowFail: true }), null);
  assert.equal(existsSync(join(raced.root, '.git', 'index.lock')), false);
});

test('recovery-ref CAS retains the winner and reports the rejected candidate objects', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-recovery-ref-cas-', [
    'if [ "$1" = update-ref ] && [ "$2" = --no-deref ] && [ "$3" = "$RECOVERY_REF" ]; then',
    '  "$REAL_GIT" update-ref "$RECOVERY_REF" "$WINNER"',
    '  printf "foreign lock residue\n" > "$LOCK_PATH/foreign"',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ RECOVERY_REF: candidate.recoveryRef, WINNER: raced.local, LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const primary = failure.operationError;
  assert.equal(primary.reason, 'blocked-recovery-ref-cas');
  assert.equal(primary.detail.recoveryRef, candidate.recoveryRef);
  assert.equal(primary.detail.currentRecoveryOid, raced.local);
  assert.equal(raced.run(['rev-parse', candidate.recoveryRef]), raced.local);
  assert.equal(raced.run(['cat-file', '-t', primary.detail.candidateCommit]), 'commit');
  assert.equal(raced.run(['cat-file', '-t', primary.detail.candidateTree]), 'tree');
  assert.equal(failure.operationArtifacts.recoveryCandidateCommit,
    primary.detail.candidateCommit);
  assert.equal(failure.operationArtifacts.effectsRetained, true);
  assert.equal(failure.operationArtifacts.recoveryCandidateTree, primary.detail.candidateTree);
  assert.equal(failure.operationArtifacts.recoveryRefCurrentOid, raced.local);
  assert.equal(raced.run(['rev-parse', 'HEAD']), raced.local);
  assert.equal(existsSync(join(raced.root, '.git', 'index.lock')), false);
});

test('recovery-ref CAS rejects a raced symbolic ref without creating its target', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  const absent = 'refs/heads/hostile-absent';
  const lockPath = join(raced.root, '.git', 'agentic-os-canonical-sync.lock');
  useGitWrapper(t, 'agentic-os-recovery-ref-symref-', [
    'if [ "$1" = commit-tree ]; then',
    '  candidate=$("$REAL_GIT" "$@") || exit',
    '  "$REAL_GIT" symbolic-ref "$RECOVERY_REF" "$ABSENT_REF"',
    '  printf "foreign lock residue\n" > "$LOCK_PATH/foreign"',
    '  printf "%s\n" "$candidate"',
    '  exit 0',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], () => ({ RECOVERY_REF: candidate.recoveryRef, ABSENT_REF: absent, LOCK_PATH: lockPath }));

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof OperationLockError;
  });
  const primary = failure.operationError;
  assert.equal(primary.reason, 'blocked-recovery-ref-symbolic');
  assert.equal(primary.detail.symbolicTarget, absent);
  assert.equal(primary.detail.currentRecoveryOid, null);
  assert.equal(raced.run(['symbolic-ref', candidate.recoveryRef]), absent);
  assert.equal(raced.run(['show-ref', '--verify', absent], { allowFail: true }), null);
  assert.equal(raced.run(['cat-file', '-t', primary.detail.candidateCommit]), 'commit');
  assert.equal(raced.run(['cat-file', '-t', primary.detail.candidateTree]), 'tree');
  assert.equal(failure.operationArtifacts.recoveryCandidateCommit,
    primary.detail.candidateCommit);
  assert.equal(failure.operationArtifacts.effectsRetained, true);
  assert.equal(failure.operationArtifacts.recoveryCandidateTree, primary.detail.candidateTree);
});

test('the canonical index lock refuses a late ordinary git add before target publication', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  let marker, countFile;
  useGitWrapper(t, 'agentic-os-late-index-add-', [
    'if [ "$1" = rev-parse ] && [ "$2" = --verify ] && [ "$3" = "$RECOVERY_REF" ] &&',
    '   "$REAL_GIT" show-ref --verify --quiet "$RECOVERY_REF"; then',
    '  count=0; [ -f "$COUNT_FILE" ] && count=$(/bin/cat "$COUNT_FILE")',
    '  count=$((count + 1)); printf "%s\\n" "$count" > "$COUNT_FILE"',
    '  if [ "$count" -eq 3 ]; then',
    '    printf "late staged bytes\\n" > "$RACE_PATH"',
    '    "$REAL_GIT" add -- "$RACE_PATH" >/dev/null 2>&1',
    '    printf "%s\\n" "$?" > "$MARKER"',
    '  fi',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], ({ bin }) => {
    marker = join(bin, 'add-status');
    countFile = join(bin, 'ref-count');
    return { RECOVERY_REF: candidate.recoveryRef, MARKER: marker, COUNT_FILE: countFile,
      RACE_PATH: join(raced.root, 'target.txt') };
  });

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof CanonicalSyncError
      && error.reason === 'blocked-after-recovery';
  });
  assert.notEqual(readFileSync(marker, 'utf8').trim(), '0');
  assert.equal(failure.detail.cause, 'blocked-install-collision');
  assert.equal(readFileSync(join(raced.root, 'target.txt'), 'utf8'), 'late staged bytes\n');
  assert.notEqual(raced.run(['diff', '--cached', '--quiet'], { allowFail: true }), null);
  assert.equal(existsSync(join(raced.root, '.git', 'index.lock')), false);
});

test('target cleanup retains every owned entry when an additive path appears', (t) => {
  const raced = fixture(t); const candidate = plan(raced.root);
  let countFile;
  useGitWrapper(t, 'agentic-os-target-additive-race-', [
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
    '      printf "foreign target residue\\n" > "$staging/foreign"',
    '      break',
    '    done',
    '  fi',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ], ({ bin }) => {
    countFile = join(bin, 'recovery-count');
    return { RECOVERY_REF: candidate.recoveryRef, COUNT_FILE: countFile,
      COMMON_DIR: join(raced.root, '.git') };
  });

  let failure;
  assert.throws(() => apply(candidate, raced.root), (error) => {
    failure = error; return error instanceof CanonicalSyncError
      && error.reason === 'blocked-after-recovery';
  });
  const staging = failure.detail.stagingPath;
  assert.equal(failure.detail.cause, 'blocked-target-staging-cleanup');
  assert.equal(failure.originalError.stagingCleanupError.code, 'ERR_EXACT_TREE_DRIFT');
  assert.equal(readFileSync(join(staging, 'foreign'), 'utf8'), 'foreign target residue\n');
  assert.equal(readFileSync(join(staging, 'target.txt'), 'utf8'), 'target only\n');
});
