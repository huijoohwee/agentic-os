import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync,
  writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import {
  applyCanonicalSync, CANONICAL_SYNC_LIMITS, CanonicalSyncError, planCanonicalSync,
} from '../src/canonical-sync.mjs';
import {
  assertProjectionBudget, buildCleanRetirementProjection, buildDirtyQuarantineProjection,
  CanonicalResourceError, parseTreeEntries,
} from '../src/canonical-resources.mjs';
import { installStagedEntries, stageTreeEntries } from '../src/canonical-staging.mjs';
import { runCanonicalSync } from '../bin/agentic-os-auxiliary.mjs';

function canonicalPlan(cwd) {
  return planCanonicalSync({
    cwd, branch: 'main', targetRef: 'refs/remotes/origin/main',
  });
}

function fixture(t, { largeTree = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-canonical-limits-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  if (largeTree) for (let index = 0; index < 3; index += 1)
    writeFileSync(join(root, `large-${index}.bin`), Buffer.alloc(22 * 1024 * 1024));
  run(['add', '.']);
  run(['commit', '--quiet', '--message', 'base']);
  const local = run(['rev-parse', 'HEAD']);
  const target = run(['commit-tree', `${local}^{tree}`, '-p', local], { input: 'target\n' });
  run(['update-ref', 'refs/remotes/origin/main', target]);
  return { root, run };
}

function rejectsReason(callback, expected) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CanonicalSyncError);
    assert.equal(error.reason, expected);
    return true;
  });
}

test('canonical plans publish explicit serialized-byte and inventory ceilings', () => {
  assert.deepEqual(CANONICAL_SYNC_LIMITS,
    { serializedPlanBytes: 500_000, quarantineManifestBytes: 500_000,
      inventoryEntries: 1_024, treeEntries: 50_000,
      targetDirectories: 50_000,
      sourceFileBytes: 32 * 1024 * 1024, aggregateSourceBytes: 128 * 1024 * 1024,
      targetFileBytes: 32 * 1024 * 1024, aggregateTargetBytes: 128 * 1024 * 1024 });
  assert.ok(Object.isFrozen(CANONICAL_SYNC_LIMITS));
});

test('target parent creation is count-bounded before filesystem effects', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-parent-limit-root-'));
  const staging = mkdtempSync(join(tmpdir(), 'agentic-os-parent-limit-stage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(staging, { recursive: true, force: true }));
  mkdirSync(join(staging, 'one', 'two'), { recursive: true });
  writeFileSync(join(staging, 'one', 'two', 'file.txt'), 'target\n');
  assert.throws(() => installStagedEntries(staging, [
    { path: 'one/two/file.txt', mode: '100644' },
  ], root, { maxEntryBytes: 1024, maxAggregateBytes: 1024,
    maxParentDirectories: 1 }), (error) => error.reason === 'blocked-target-directory-limit');
  assert.equal(existsSync(join(root, 'one')), false);
});

test('clean-tree quarantine manifests and target materialization are independently bounded', () => {
  const oid = 'a'.repeat(40);
  const base = new Map(Array.from({ length: 8_192 }, (_, index) => {
    const path = `clean-${String(index).padStart(4, '0')}.txt`;
    return [path, { mode: '100644', type: 'blob', oid, size: 1 }];
  }));
  assert.throws(() => buildCleanRetirementProjection({
    planDigest: 'b'.repeat(64), inventoryDigest: 'c'.repeat(64), inventory: [],
  }, base, CANONICAL_SYNC_LIMITS), (error) => {
    assert.ok(error instanceof CanonicalResourceError);
    assert.equal(error.code, 'quarantine-manifest-limit');
    return true;
  });

  const dirty = buildDirtyQuarantineProjection({
    planDigest: 'b'.repeat(64), inventoryDigest: 'c'.repeat(64), inventory: [
      { path: 'changed.txt', kind: 'file', mode: '100644', size: 7, sha256: 'd'.repeat(64) },
      { path: 'deleted.txt', kind: 'deleted', mode: null, size: null, sha256: null },
    ],
  }, CANONICAL_SYNC_LIMITS);
  assert.deepEqual(dirty.entries.map(({ path }) => path), ['changed.txt']);

  assert.throws(() => assertProjectionBudget([{
    path: 'large.bin', size: CANONICAL_SYNC_LIMITS.targetFileBytes + 1,
  }], CANONICAL_SYNC_LIMITS, 'target'), (error) => {
    assert.ok(error instanceof CanonicalResourceError);
    assert.equal(error.code, 'target-file-limit');
    return true;
  });
  const aggregate = Array.from({ length: 5 }, (_, index) => ({
    path: `part-${index}.bin`, size: 30 * 1024 * 1024,
  }));
  assert.throws(() => assertProjectionBudget(aggregate, CANONICAL_SYNC_LIMITS, 'target'),
    (error) => error instanceof CanonicalResourceError
      && error.code === 'target-aggregate-limit');
});

test('planning rejects portable-unsafe target paths before any allocation or mutation', (t) => {
  const { root, run } = fixture(t);
  const local = run(['rev-parse', 'HEAD']);
  const blob = run(['hash-object', '-w', '--stdin'], { input: 'malicious attributes\n' });
  const leaf = run(['mktree', '-z'], {
    input: Buffer.from(`100644 blob ${blob}\t.gitattributes\0`),
  });
  const parent = run(['mktree', '-z'], { input: Buffer.from(`040000 tree ${leaf}\t..\0`) });
  const tree = run(['mktree', '-z'], { input: Buffer.from(`040000 tree ${parent}\t..\0`) });
  const target = run(['commit-tree', tree, '-p', local], { input: 'unsafe target tree\n' });
  run(['update-ref', 'refs/remotes/origin/main', target]);
  const before = { head: run(['rev-parse', 'HEAD']), bytes: readFileSync(join(root, 'base.txt')),
    recovery: run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']) };

  rejectsReason(() => canonicalPlan(root), 'blocked-tree-entry-invalid');
  assert.equal(run(['rev-parse', 'HEAD']), before.head);
  assert.deepEqual(readFileSync(join(root, 'base.txt')), before.bytes);
  assert.equal(run(['for-each-ref', '--format=%(refname)', 'refs/agentic-os/recovery']),
    before.recovery);
  assert.equal(existsSync(join(root, '.git', 'index.lock')), false);
  assert.deepEqual(readdirSync(join(root, '.git')).filter((name) =>
    name.startsWith('agentic-os-canonical-')), []);

  for (const path of ['.GIT/config', 'git~1/config', 'C:escape', 'bad\\path', 'AUX.txt'])
    assert.throws(() => parseTreeEntries([
      `100644 blob ${blob} 1\t${path}`,
    ], 1), (error) => error instanceof CanonicalResourceError
      && error.code === 'tree-entry-invalid');
});

test('checkout-filter expansion is stopped at the materialized target ceiling', (t) => {
  const { root, run } = fixture(t);
  run(['config', 'filter.expand.clean', 'cat']);
  run(['config', 'filter.expand.smudge',
    "awk 'BEGIN { for (i = 0; i < 100; i++) printf \"0123456789\" }'"]);
  run(['config', 'filter.expand.required', 'true']);
  writeFileSync(join(root, '.gitattributes'), 'filtered.txt filter=expand\n');
  writeFileSync(join(root, 'filtered.txt'), 'x\n');
  run(['add', '.gitattributes', 'filtered.txt']);
  run(['commit', '--quiet', '--message', 'filtered target']);
  const ref = run(['rev-parse', 'HEAD']);
  const oid = run(['rev-parse', 'HEAD:filtered.txt']);

  assert.throws(() => stageTreeEntries('agentic-os-filter-limit', ref, [{
    path: 'filtered.txt', mode: '100644', type: 'blob', oid, size: 2,
  }], { maxEntryBytes: 64, maxAggregateBytes: 128 }, root), (error) =>
    error.reason === 'blocked-target-file-limit' && error.detail.limit === 64);
});

test('apply bounds plan structure before digest validation', (t) => {
  const { root } = fixture(t);
  const plan = canonicalPlan(root);
  const apply = (candidate) => applyCanonicalSync(candidate, {
    cwd: root, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization,
  });
  rejectsReason(() => apply({ ...plan,
    inventory: new Array(CANONICAL_SYNC_LIMITS.inventoryEntries + 1).fill({}),
  }), 'blocked-plan-inventory-limit');
  rejectsReason(() => apply({ ...plan,
    padding: 'x'.repeat(CANONICAL_SYNC_LIMITS.serializedPlanBytes),
  }), 'blocked-plan-byte-limit');
  const sparse = { ...plan, inventory: new Array(8) };
  sparse.inventory[0] = {};
  rejectsReason(() => apply(sparse), 'blocked-plan-resource-limit');
});

test('apply rejects unknown v2 plan claims before reusing authorization', (t) => {
  const { root, run } = fixture(t);
  const plan = canonicalPlan(root);
  rejectsReason(() => applyCanonicalSync({ ...plan, cleanupAuthorized: true }, {
    cwd: root, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization,
  }), 'blocked-invalid-plan-shape');
  assert.equal(run(['rev-parse', 'HEAD']), plan.expectedLocalSha);
  assert.equal(run(['show-ref', '--verify', plan.recoveryRef], { allowFail: true }), null);
});

test('planning refuses excessive inventory before hashing every owned file', (t) => {
  const { root } = fixture(t);
  for (let index = 0; index <= CANONICAL_SYNC_LIMITS.inventoryEntries; index += 1)
    writeFileSync(join(root, `owned-${String(index).padStart(4, '0')}.txt`), 'x');
  rejectsReason(() => canonicalPlan(root), 'blocked-plan-inventory-limit');
});

test('planning refuses an oversized tracked file before allocating its bytes', (t) => {
  const { root } = fixture(t);
  truncateSync(join(root, 'base.txt'), CANONICAL_SYNC_LIMITS.sourceFileBytes + 1);
  rejectsReason(() => canonicalPlan(root), 'blocked-source-file-limit');
});

test('canonical apply input is bounded, regular, and strict UTF-8', (t) => {
  const { root } = fixture(t);
  const args = (path) => ['apply', `--plan=${path}`, '--authorize=x', '--exclusive=y'];
  const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
  const fifo = join(root, 'plan.fifo');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  assert.throws(() => runCanonicalSync(root, args(fifo), policy), /regular file/u);
  const oversized = join(root, 'oversized.json');
  writeFileSync(oversized, Buffer.alloc(CANONICAL_SYNC_LIMITS.serializedPlanBytes + 1));
  assert.throws(() => runCanonicalSync(root, args(oversized), policy), /byte budget/u);
  const invalid = join(root, 'invalid.json'); writeFileSync(invalid, Buffer.from([0xff]));
  assert.throws(() => runCanonicalSync(root, args(invalid), policy), /must be UTF-8/u);
});

test('each complete quarantine verification receives a fresh aggregate budget', (t) => {
  const { root, run } = fixture(t, { largeTree: true });
  const plan = canonicalPlan(root);
  const receipt = applyCanonicalSync(plan, { cwd: root, authorization: plan.authorization,
    exclusive: plan.exclusiveAuthorization });
  assert.equal(receipt.targetHead, run(['rev-parse', 'refs/remotes/origin/main']));
});
