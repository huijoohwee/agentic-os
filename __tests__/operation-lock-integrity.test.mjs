import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireOperationLock, finishOperationLock, git, OperationLockError,
} from '../src/git.mjs';
import { planCanonicalSync } from '../src/canonical-sync.mjs';
import { createCanonicalArtifacts } from '../src/canonical-recovery.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { ensure } from '../bin/agentic-os-config.mjs';
import {
  formatEffectReceipt, formatLaneProjectionRetained, formatRetainedOperation,
} from '../bin/agentic-os-report.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-lock-integrity-'));
  const root = join(parent, 'repo');
  mkdirSync(root);
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  run(['add', '.']);
  run(['commit', '--quiet', '--message', 'base']);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, run };
}

function gitWrapper(parent, lockPath) {
  const bin = join(parent, 'bin');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ -d "$LOCK_PATH" ]; then printf "foreign bytes\\n" > "$LOCK_PATH/foreign"; fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOCK_PATH: lockPath, REAL_GIT: realGit };
}

test('lock finalization retains nonempty and replaced locks with exact outcomes', (t) => {
  const { root } = fixture(t);
  const result = Object.freeze({ receipt: 'exact-success' });
  const artifacts = Object.freeze({ effectsRetained: true, path: '/exact/artifact' });
  const lock = acquireOperationLock('result-test', root);
  writeFileSync(join(lock.path, 'foreign'), 'foreign bytes\n');
  assert.throws(() => finishOperationLock(lock, {
    label: 'test', result, artifacts,
  }), (error) => {
    assert.ok(error instanceof OperationLockError);
    assert.equal(error.reason, 'blocked-test-lock-integrity');
    assert.equal(error.operationResult, result);
    assert.equal(error.operationError, null);
    assert.equal(error.operationArtifacts, artifacts);
    return true;
  });
  assert.equal(readFileSync(join(lock.path, 'foreign'), 'utf8'), 'foreign bytes\n');
  rmSync(lock.path, { recursive: true });

  const replaced = acquireOperationLock('replacement-test', root);
  rmdirSync(replaced.path);
  mkdirSync(replaced.path, { mode: 0o711 });
  assert.throws(() => finishOperationLock(replaced, { label: 'test', result }),
    { reason: 'blocked-test-lock-integrity' });
  assert.equal(existsSync(replaced.path), true);
});

test('lock finalization retains the exact original error instead of masking it', (t) => {
  const { root } = fixture(t);
  const original = Object.assign(new Error('original evidence'), {
    reason: 'blocked-original', detail: Object.freeze({ receipt: 'evidence' }),
  });
  const artifacts = Object.freeze({ residue: '/exact/residue' });
  const lock = acquireOperationLock('error-test', root);
  writeFileSync(join(lock.path, 'foreign'), 'foreign bytes\n');
  let retained;
  assert.throws(() => finishOperationLock(lock, {
    label: 'test', error: original, artifacts,
  }), (error) => {
    retained = JSON.parse(formatRetainedOperation(error));
    assert.equal(error.cause, original);
    assert.equal(error.operationError, original);
    assert.equal(error.operationArtifacts, artifacts);
    return true;
  });
  assert.equal(retained.operationCompleted, false);
  assert.equal(retained.effectsRetained, false);

  rmSync(lock.path, { recursive: true });
  const clean = acquireOperationLock('original-test', root);
  assert.throws(() => finishOperationLock(clean, { label: 'test', error: original }),
    (error) => error === original);
  assert.equal(existsSync(clean.path), false);
});

test('retained operation formatting bounds oversized incidental fields without losing identities', () => {
  const formatted = formatRetainedOperation({
    name: 'OperationLockError', reason: 'blocked-canonical-sync-lock-integrity',
    operationResult: {
      schema: 'agentic-os-canonical-sync-receipt/v2', recoveryCommit: 'a'.repeat(40),
      quarantinePath: '/exact/quarantine', incidental: 'x'.repeat(600_001),
    },
    operationArtifacts: {
      effectsRetained: true, quarantinePath: '/exact/quarantine',
      recoveryTempPath: '/exact/recovery.tmp', recoveryTempCleanupCause: 'recovery cleanup failed',
      canonicalIndexLockPath: '/exact/index.lock',
      canonicalIndexCleanupCause: 'index cleanup failed',
      canonicalIndexTempPath: '/exact/index.tmp',
      candidateOid: 'b'.repeat(40), candidateObjectWritten: true, refPublished: false,
      runtimeAncestorResidue: true, runtimeAncestorPaths: ['/exact/state', '/exact/runtimes'],
      trustPath: '/exact/trust.json', trustCreated: true,
      trustWriteAttempted: true, trustWriteResultUnknown: false,
      trustWriteObservedPathExists: true, trustWriteObservedKind: 'file',
      trustWriteObservedSize: 128,
      statePath: '/exact/state', stateDirectoryCreated: true,
      stateDirectoryTightenAttempted: false, stateDirectoryTightenResultUnknown: false,
      stateDirectoryTightened: false,
    },
    operationError: null,
  });
  assert.ok(Buffer.byteLength(formatted) < 500_000);
  const receipt = JSON.parse(formatted);
  assert.equal(receipt.operationCompleted, true);
  assert.equal(receipt.effectsRetained, true);
  assert.equal(receipt.boundedProjection, true);
  assert.equal(receipt.result.recoveryCommit, 'a'.repeat(40));
  assert.equal(receipt.result.quarantinePath, '/exact/quarantine');
  assert.equal(receipt.artifacts.recoveryTempPath, '/exact/recovery.tmp');
  assert.equal(receipt.artifacts.recoveryTempCleanupCause, 'recovery cleanup failed');
  assert.equal(receipt.artifacts.canonicalIndexLockPath, '/exact/index.lock');
  assert.equal(receipt.artifacts.canonicalIndexCleanupCause, 'index cleanup failed');
  assert.equal(receipt.artifacts.canonicalIndexTempPath, '/exact/index.tmp');
  assert.equal(receipt.artifacts.candidateObjectWritten, true);
  assert.equal(receipt.artifacts.refPublished, false);
  assert.deepEqual(receipt.artifacts.runtimeAncestorPaths, ['/exact/state', '/exact/runtimes']);
  assert.equal(receipt.artifacts.trustPath, '/exact/trust.json');
  assert.equal(receipt.artifacts.trustWriteResultUnknown, false);
  assert.equal(receipt.artifacts.stateDirectoryCreated, true);
  assert.equal(receipt.artifacts.stateDirectoryTightenAttempted, false);
  assert.equal('incidental' in receipt.result, false);
});

test('bounded retained formatting preserves the complete canonical effect journal', () => {
  const artifacts = createCanonicalArtifacts({
    expectedTargetSha: 'c'.repeat(40), branch: 'trunk',
    expectedLocalSha: 'd'.repeat(40), recoveryRef: 'refs/agentic-os/recovery/exact',
  });
  artifacts.effectsRetained = true;
  artifacts.incidental = 'x'.repeat(600_001);
  const formatted = formatRetainedOperation({
    name: 'OperationLockError', reason: 'blocked-canonical-sync-lock-integrity',
    operationResult: null, operationArtifacts: artifacts, operationError: null,
  });
  assert.ok(Buffer.byteLength(formatted) < 500_000);
  const projected = JSON.parse(formatted);
  assert.equal(projected.boundedProjection, true);
  assert.deepEqual(Object.keys(projected.artifacts).sort(),
    Object.keys(createCanonicalArtifacts({
      expectedTargetSha: 'c'.repeat(40), branch: 'trunk',
      expectedLocalSha: 'd'.repeat(40), recoveryRef: 'refs/agentic-os/recovery/exact',
    })).sort());
});

test('effect receipts stay exact when bounded and explicitly project large ref inventories', () => {
  const exactReceipt = {
    schema: 'agentic-os/git-publication/v1', operation: 'publish-exact-new-ref',
    remote: 'upstream', remoteRef: 'refs/heads/agent/device/scope',
    candidateOid: 'a'.repeat(40), publicationAttempted: true,
    pushCompleted: true, refPublished: true,
  };
  assert.deepEqual(JSON.parse(formatEffectReceipt('publish-exact-new-ref', exactReceipt)),
    exactReceipt);

  const refsBefore = Array.from({ length: 3_000 }, (_, index) => ({
    ref: `refs/remotes/upstream/${String(index).padStart(4, '0')}-${'r'.repeat(180)}`,
    oid: String(index % 10).repeat(40), symbolicTarget: null,
  }));
  const refsAfter = refsBefore.map((entry, index) => ({
    ...entry, oid: String((index + 1) % 10).repeat(40),
  }));
  const refChanges = refsBefore.map((before, index) => ({ before,
    after: refsAfter[index], ref: before.ref }));
  const receipt = {
    schema: 'agentic-os/git-fetch/v1', effectsRetained: true, operation: 'fetch',
    remote: 'upstream', url: 'https://example.invalid/repository.git',
    fetchAttempted: true, fetchCompleted: false, fetchHeadWritten: false,
    autoMaintenanceRun: false, writeResultUnknown: true,
    objectWriteResultUnknown: true, reobservationExact: true,
    refsBefore, refsAfter, refChanges,
  };
  const formatted = formatEffectReceipt('fetch', receipt);
  assert.ok(Buffer.byteLength(formatted) < 500_000);
  const projected = JSON.parse(formatted);
  assert.equal(projected.schema, 'agentic-os/effect-receipt-projection/v1');
  assert.equal(projected.receiptProjection.writeResultUnknown, true);
  assert.equal(projected.receiptProjection.objectWriteResultUnknown, true);
  assert.equal(projected.receiptProjection.refsBeforeCount, refsBefore.length);
  assert.equal(projected.receiptProjection.refsBeforeProjectionTruncated, true);
  assert.equal(projected.receiptProjection.refsAfterCount, refsAfter.length);
  assert.equal(projected.receiptProjection.refChangesCount, refChanges.length);
  assert.equal(projected.receiptProjection.refsBeforeDigest,
    createHash('sha256').update(JSON.stringify(refsBefore.map(({ oid, ref, symbolicTarget }) =>
      ({ oid, ref, symbolicTarget })))).digest('hex'));
  assert.match(projected.receiptDigest, /^[0-9a-f]{64}$/u);
});

test('retained provision projection bounds parent receipts without losing effect identity', () => {
  const createdParents = Array.from({ length: 2_000 }, (_, index) => ({
    path: `/retained/${String(index).padStart(4, '0')}/${'p'.repeat(220)}`,
    creationReturned: true, observationExact: index % 2 === 0,
    dev: String(index), ino: String(index + 1), mode: 0o40700,
  }));
  const formatted = formatRetainedOperation({
    name: 'OperationLockError', reason: 'blocked-start-lock-integrity',
    operationResult: null, operationError: { reason: 'blocked-provision-recovery-required' },
    operationArtifacts: {
      effectsRetained: true, operation: 'provision-worktree',
      ref: 'agent/device/scope', path: '/exact/lane', baseSha: 'b'.repeat(40),
      worktreeAddReturned: false, provisionCompleted: false,
      createdParentPaths: createdParents.map((entry) => entry.path), createdParents,
      branchSha: 'c'.repeat(40), branchObservationExact: true,
      registrationObservationExact: true, pathExists: true,
      pathObservationExact: true,
    },
  });
  assert.ok(Buffer.byteLength(formatted) < 500_000);
  const receipt = JSON.parse(formatted);
  assert.equal(receipt.effectsRetained, true);
  assert.equal(receipt.artifacts.branchSha, 'c'.repeat(40));
  assert.equal(receipt.artifacts.createdParentsCount, createdParents.length);
  assert.equal(receipt.artifacts.createdParentsProjectionTruncated, true);
  assert.equal(receipt.artifacts.createdParentPathsCount, createdParents.length);
  assert.match(receipt.artifacts.createdParentsDigest, /^[0-9a-f]{64}$/u);
});

test('provider handoff retention bounds provider-controlled strings and keeps core identity', () => {
  const head = 'b'.repeat(40);
  const handoff = {
    schema: 'agentic-os-provider-handoff/v1', provider: 'github-gh', ok: false,
    reason: 'x'.repeat(600_001), ref: 'agent/device/bounded', headSha: head,
    sourceHeadBound: true, reviewMutationAttempted: true,
    reviewWriteResultUnknown: false, reviewReobservedAfterMutation: true,
    reviewReobservationExact: true, reviewRequiresAttention: true,
    orderingArmed: true, testedProtectedOrdering: true,
    queueEntry: { id: 'queue-77', position: 3, state: 'AWAITING_CHECKS' },
    pr: { number: 77, state: 'OPEN', url: `https://github.com/${'u'.repeat(600_001)}`,
      headRefOid: head, headRefName: 'agent/device/bounded', baseRefName: 'trunk',
      isCrossRepository: false },
  };
  const formatted = formatLaneProjectionRetained({
    ref: 'agent/device/bounded', head, state: 'queued', pr: 77, handoff,
  }, Object.assign(new Error('cache failed'), { reason: 'blocked-lane-cache-invalid' }));
  assert.ok(Buffer.byteLength(formatted) < 500_000);
  const receipt = JSON.parse(formatted);
  assert.equal(receipt.boundedProjection, true);
  assert.equal(receipt.truncated, true);
  assert.equal(receipt.laneProjection.head, head);
  assert.equal(receipt.laneProjection.state, 'queued');
  assert.equal(receipt.laneProjection.pr, 77);
  assert.equal(receipt.handoffDigest,
    createHash('sha256').update(JSON.stringify(handoff)).digest('hex'));
  assert.equal(receipt.handoffDigestAlgorithm, 'sha256-json');
  assert.equal(receipt.handoffProjection.receiptSchema,
    'agentic-os-provider-handoff/v1');
  assert.equal(receipt.handoffProjection.sourceHeadBound, true);
  assert.deepEqual(receipt.handoffProjection.queueEntry,
    { id: 'queue-77', position: 3, state: 'AWAITING_CHECKS' });
  assert.equal(receipt.handoffProjection.pr.number, 77);
  assert.equal(receipt.handoffProjection.pr.headRefOid, head);
});

test('start retains a created lane and foreign lock bytes when finalization fails', (t) => {
  const { parent, root, run } = fixture(t);
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'profile']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const remote = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', remote], { cwd: parent });
  run(['remote', 'add', 'origin', remote]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const lockPath = join(root, '.git', 'agentic-os-start.lock');
  const result = spawnSync(process.execPath,
    [CLI, 'start', 'lock-result', '--device=test-device'], {
      cwd: root, encoding: 'utf8', env: gitWrapper(parent, lockPath),
    });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-start-lock-integrity/u);
  const retainedLine = result.stderr.split('\n')
    .find((line) => line.startsWith('{"schema":"agentic-os/retained-operation/v1"'));
  const retained = JSON.parse(retainedLine);
  assert.equal(retained.operationCompleted, true);
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.artifacts.fetchCompleted, true);
  assert.equal(retained.artifacts.provisioned, true);
  assert.equal(retained.artifacts.fetchedProtectedSha, retained.artifacts.baseSha);
  assert.match(result.stdout, /lane agent\/test-device\/lock-result/u);
  const worktree = result.stdout.match(/^worktree (.+)$/mu)?.[1];
  assert.ok(worktree && existsSync(worktree));
  assert.equal(run(['rev-parse', 'refs/heads/agent/test-device/lock-result']).length, 40);
  assert.equal(readFileSync(join(lockPath, 'foreign'), 'utf8'), 'foreign bytes\n');
});

test('config preserves its exact failure when a foreign lock entry appears', (t) => {
  const { parent, root } = fixture(t);
  const lockPath = join(root, '.git', 'agentic-os-configure.lock');
  const priorPath = process.env.PATH;
  const environment = gitWrapper(parent, lockPath);
  process.env.PATH = environment.PATH;
  process.env.LOCK_PATH = environment.LOCK_PATH;
  process.env.REAL_GIT = environment.REAL_GIT;
  t.after(() => {
    process.env.PATH = priorPath;
    delete process.env.LOCK_PATH;
    delete process.env.REAL_GIT;
  });
  assert.throws(() => ensure(root, { sourceRoot: join(parent, 'missing-package') }), (error) => {
    assert.equal(error.reason, 'blocked-config-lock-integrity');
    assert.equal(error.operationError?.reason, 'blocked-hook-runtime-integrity');
    assert.equal(error.cause, error.operationError);
    return true;
  });
  assert.equal(readFileSync(join(lockPath, 'foreign'), 'utf8'), 'foreign bytes\n');
});

test('late configuration failure reports the exact retained managed runtime', (t) => {
  const { root } = fixture(t);
  const lockPath = join(root, '.git', 'agentic-os-configure.lock');
  let failure;
  assert.throws(() => ensure(root, {
    sourceRoot: ROOT,
    afterConfigure: () => {
      writeFileSync(join(lockPath, 'foreign'), 'foreign bytes\n');
      throw Object.assign(new Error('late configuration failure'), {
        reason: 'blocked-config-race',
      });
    },
  }), (error) => {
    failure = error;
    return error instanceof OperationLockError;
  });
  const retained = JSON.parse(formatRetainedOperation(failure));
  assert.equal(retained.operationCompleted, false);
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.artifacts.runtimeInstalled, true);
  assert.equal(retained.artifacts.runtimeResidue, false);
  assert.equal(retained.artifacts.configRetained, false);
  assert.ok(existsSync(retained.artifacts.runtimePath));
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: root,
  }).status, 1, 'failed configuration must restore the prior value');
});

test('ancestor-only runtime installation failure reports every retained managed directory', (t) => {
  const { root } = fixture(t);
  let failure;
  assert.throws(() => ensure(root, {
    sourceRoot: ROOT,
    runtimeInstallOptions: {
      beforeRuntimeCreate: () => {
        throw Object.assign(new Error('stop after managed ancestors'), {
          reason: 'blocked-hook-runtime-integrity',
        });
      },
    },
  }), (error) => {
    failure = error;
    return error.retainedOperation === true;
  });
  const retained = JSON.parse(formatRetainedOperation(failure));
  assert.equal(retained.operationCompleted, false);
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.artifacts.runtimeInstalled, false);
  assert.equal(retained.artifacts.runtimeResidue, false);
  assert.equal(retained.artifacts.runtimeAncestorResidue, true);
  const managedRoot = dirname(retained.artifacts.runtimePath);
  assert.deepEqual(retained.artifacts.runtimeAncestorPaths, [dirname(managedRoot), managedRoot]);
  assert.equal(existsSync(retained.artifacts.runtimePath), false);
});

test('config response loss plus failed restoration retains an explicit unknown receipt', (t) => {
  const { parent, root } = fixture(t);
  const bin = join(parent, 'config-bin'); mkdirSync(bin);
  const wrapper = join(bin, 'git');
  const marker = join(parent, 'config-effect');
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = config ] && [ "$2" = --local ] && [ "$3" = --add ] && [ "$4" = core.hooksPath ]; then',
    '  "$REAL_GIT" "$@" || exit',
    '  : > "$CONFIG_EFFECT"',
    '  exit 23',
    'fi',
    'if [ -f "$CONFIG_EFFECT" ] && [ "$1" = config ] && [ "$2" = --local ] && [ "$3" = --null ] && [ "$4" = --get-all ]; then',
    '  printf malformed',
    '  exit 0',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n')); chmodSync(wrapper, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}:${priorPath}`;
  process.env.REAL_GIT = realGit;
  process.env.CONFIG_EFFECT = marker;
  t.after(() => {
    process.env.PATH = priorPath; delete process.env.REAL_GIT; delete process.env.CONFIG_EFFECT;
  });
  let failure;
  assert.throws(() => ensure(root, { sourceRoot: ROOT }), (error) => {
    failure = error; return error.retainedOperation === true;
  });
  const retained = JSON.parse(formatRetainedOperation(failure));
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.artifacts.configWriteAttempted, true);
  assert.equal(retained.artifacts.configWriteResultUnknown, true);
  assert.equal(retained.artifacts.configRetained, true);
  assert.equal(retained.artifacts.configObservedState, 'unavailable');
  assert.equal(spawnSync(realGit, ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: root, encoding: 'utf8', env: process.env,
  }).stdout.trim(), retained.artifacts.hooksPath);
});

test('partial provision failure reports exact retained branch and worktree artifacts', (t) => {
  const { parent, root, run } = fixture(t);
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', '.agentic-os.json']); run(['commit', '--quiet', '--message', 'profile']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const remote = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', remote], { cwd: parent });
  run(['remote', 'add', 'origin', remote]); run(['push', '--quiet', 'origin', 'main']);
  const bin = join(parent, 'partial-bin'); mkdirSync(bin);
  const wrapper = join(bin, 'git');
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const lockPath = join(root, '.git', 'agentic-os-start.lock');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = worktree ] && [ "$2" = add ]; then',
    '  "$REAL_GIT" "$@" || exit',
    '  printf "foreign bytes\\n" > "$LOCK_PATH/foreign"',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n')); chmodSync(wrapper, 0o755);
  const result = spawnSync(process.execPath, [
    CLI, 'start', 'partial-provision', '--device=test-device',
  ], { cwd: root, encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_GIT: realGit, LOCK_PATH: lockPath,
  } });
  assert.equal(result.status, 1, result.stderr);
  const line = result.stderr.split('\n')
    .find((entry) => entry.startsWith('{"schema":"agentic-os/retained-operation/v1"'));
  assert.ok(line, result.stderr);
  const retained = JSON.parse(line);
  assert.equal(retained.operationCompleted, false);
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.artifacts.fetchCompleted, true);
  assert.equal(retained.artifacts.provisioned, false);
  assert.equal(retained.artifacts.fetchedProtectedSha,
    run(['rev-parse', 'refs/remotes/origin/main']));
  assert.match(retained.artifacts.branchSha, /^[0-9a-f]{40}$/u);
  assert.equal(retained.artifacts.pathExists, true);
  assert.equal(retained.artifacts.registeredWorktree.branch,
    'agent/test-device/partial-provision');
  assert.equal(retained.artifacts.registeredWorktree.path, retained.artifacts.worktree);
  assert.ok(existsSync(retained.artifacts.worktree));
});

test('canonical-sync CLI emits its retained success receipt when lock finalization fails', (t) => {
  const { parent, root, run } = fixture(t);
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'profile']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  run(['switch', '--quiet', '--create', 'target']);
  writeFileSync(join(root, 'base.txt'), 'target bytes\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'target']);
  const target = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', target]);
  run(['switch', '--quiet', 'main']);
  const plan = planCanonicalSync({
    cwd: root, branch: 'main', targetRef: 'refs/remotes/origin/main',
  });
  const planPath = join(parent, 'plan.json');
  writeFileSync(planPath, `${JSON.stringify(plan)}\n`);
  const lockPath = join(root, '.git', 'agentic-os-canonical-sync.lock');
  const result = spawnSync(process.execPath, [
    CLI, 'canonical-sync', 'apply', `--plan=${planPath}`,
    `--authorize=${plan.authorization}`, `--exclusive=${plan.exclusiveAuthorization}`,
  ], { cwd: root, encoding: 'utf8', env: gitWrapper(parent, lockPath) });
  assert.equal(result.status, 1, result.stderr);
  const retainedLine = result.stderr.split('\n')
    .find((line) => line.startsWith('{"schema":"agentic-os/retained-operation/v1"'));
  assert.ok(retainedLine, result.stderr);
  const retained = JSON.parse(retainedLine);
  assert.equal(retained.reason, 'blocked-canonical-sync-lock-integrity');
  assert.equal(retained.operationCompleted, true);
  assert.equal(retained.effectsRetained, true);
  assert.equal(retained.result.targetHead, target);
  assert.equal(retained.result.stagingRemoved, true);
  assert.equal(retained.result.quarantineRemoved, false);
  assert.equal(retained.artifacts.quarantinePath, retained.result.quarantinePath);
  assert.equal(retained.operationError, null);
  assert.equal(existsSync(retained.result.quarantinePath), true);
  assert.equal(readFileSync(join(lockPath, 'foreign'), 'utf8'), 'foreign bytes\n');
});
