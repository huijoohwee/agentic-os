import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { get, put, putExact } from '../src/lane-records.mjs';
import { applyLaneRebind, planLaneRebind, runLaneRebind } from '../bin/agentic-os-admission.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 }).trim();
const refs = cwd => git(cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes');
function write(root, path, value, mode = 0o644) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value); chmodSync(join(root, path), mode);
}
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'lane-rebind-'))), root = join(parent, 'repo'),
    lane = join(parent, 'lane'), other = join(parent, 'other'), remote = join(parent, 'remote.git');
  const oldGlobal = process.env.GIT_CONFIG_GLOBAL, oldSystem = process.env.GIT_CONFIG_NOSYSTEM;
  process.env.GIT_CONFIG_GLOBAL = join(parent, 'global-config'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, ''); mkdirSync(root);
  t.after(() => {
    if (oldGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = oldGlobal;
    if (oldSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = oldSystem;
    rmSync(parent, { recursive: true, force: true });
  });
  git(root, 'init', '--quiet', '--initial-branch=main');
  for (const [key, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid'], ['commit.gpgsign', 'false']]) git(root, 'config', key, value);
  write(root, 'base.txt', 'base\n'); git(root, 'add', '--all'); git(root, 'commit', '--quiet', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD'); git(root, 'init', '--quiet', '--bare', remote);
  git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '--quiet', '-u', 'origin', 'main');
  const ref = 'agent/test-device/rebind';
  git(root, 'worktree', 'add', '--quiet', '-b', ref, lane, base);
  const record = { ref, device: 'test-device', scope: 'rebind', state: 'active',
    base: 'refs/remotes/origin/main', baseSha: base, worktree: lane, pr: null,
    createdAt: '2026-01-01T00:00:00.000Z', head: base, writePaths: ['owned'] };
  put(record, root);
  return { root, lane, other, remote, parent, ref, base, record };
}
function commit(cwd, message) { git(cwd, 'add', '--all'); git(cwd, 'commit', '--quiet', '-m', message); return git(cwd, 'rev-parse', 'HEAD'); }
function savePlan(f, plan, name = 'plan.json') {
  const path = join(f.parent, name); writeFileSync(path, JSON.stringify(plan)); return path;
}
function authorize(plan) { return `agentic-os:lane-rebind:${plan.digest}`; }

test('mounted rebind extends the reservation and preserves committed, dirty and ref bytes', t => {
  const f = fixture(t); write(f.lane, 'owned/committed.txt', 'committed\n');
  const head = commit(f.lane, 'authored change'); write(f.lane, 'owned/untracked.bin', Buffer.from([0, 255, 13, 10]));
  const beforeRefs = refs(f.root), plan = planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'mounted' });
  assert.equal(plan.head, head); assert.deepEqual(plan.addedPaths, ['owned/committed.txt', 'owned/untracked.bin']);
  const receipt = applyLaneRebind({ cwd: f.root, planPath: savePlan(f, plan), authorization: authorize(plan), stopped: true });
  assert.equal(receipt.authoredBytesPreserved, true); assert.equal(receipt.integrationProof, false);
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), head); assert.equal(refs(f.root), beforeRefs);
  assert.deepEqual(readFileSync(join(f.lane, 'owned/untracked.bin')), Buffer.from([0, 255, 13, 10]));
  assert.deepEqual(get(f.ref, f.root).writePaths, plan.writePathsAfter);
  assert.equal(get(f.ref, f.root).head, head);
});

test('serialized plan command output round-trips through authenticated apply', t => {
  const f = fixture(t), output = [];
  assert.equal(runLaneRebind(f.root, ['plan', `--ref=${f.ref}`, '--mode=mounted'], value => output.push(value)), 0);
  const serialized = JSON.parse(output[0]), path = savePlan(f, serialized, 'cli-plan.json');
  assert.equal(serialized.authorization, authorize(serialized));
  const receipt = applyLaneRebind({ cwd: f.root, planPath: path,
    authorization: serialized.authorization, stopped: true });
  assert.equal(receipt.authoredBytesPreserved, true);
  assert.equal(get(f.ref, f.root).head, f.base);
});

test('mounted rebind refuses dirty-byte drift after planning without changing lane state', t => {
  const f = fixture(t); write(f.lane, 'owned/dirty.txt', 'before\0bytes');
  const plan = planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'mounted' }), path = savePlan(f, plan);
  writeFileSync(join(f.lane, 'owned/dirty.txt'), 'after bytes');
  const before = JSON.stringify(get(f.ref, f.root));
  assert.throws(() => applyLaneRebind({ cwd: f.root, planPath: path, authorization: authorize(plan), stopped: true }),
    error => ['blocked-lane-rebind-stale-plan', 'blocked-lane-rebind-dirty-drift'].includes(error.reason));
  assert.equal(JSON.stringify(get(f.ref, f.root)), before); assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.base);
  assert.equal(readFileSync(join(f.lane, 'owned/dirty.txt'), 'utf8'), 'after bytes');
});

test('mounted rebind rejects a competing live reservation before producing a plan', t => {
  const f = fixture(t); write(f.lane, 'owned/conflict.txt', 'candidate\n'); const head = commit(f.lane, 'candidate');
  const otherRef = 'agent/test-device/other'; git(f.root, 'worktree', 'add', '--quiet', '-b', otherRef, f.other, f.base);
  put({ ...f.record, ref: otherRef, scope: 'other', worktree: f.other, head: f.base,
    writePaths: ['owned/conflict.txt'] }, f.root);
  assert.throws(() => planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'mounted' }),
    error => error.reason === 'blocked-lane-rebind-path-overlap');
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), head);
});

test('restore mode remounts the exact existing branch and leaves every ref unchanged', t => {
  const f = fixture(t); write(f.lane, 'owned/committed.txt', 'retained commit\n');
  const head = commit(f.lane, 'retained branch'), beforeRefs = refs(f.root);
  git(f.root, 'worktree', 'remove', f.lane);
  const plan = planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'restore' });
  assert.equal(plan.head, head); assert.equal(plan.restoredDirtyState, 'unobservable-at-missing-path');
  const receipt = applyLaneRebind({ cwd: f.root, planPath: savePlan(f, plan, 'restore.json'),
    authorization: authorize(plan), stopped: true });
  assert.equal(receipt.refsPreserved, true); assert.equal(receipt.authoredBytesPreserved, false);
  assert.equal(refs(f.root), beforeRefs); assert.equal(git(f.lane, 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(join(f.lane, 'owned/committed.txt'), 'utf8'), 'retained commit\n');
  assert.equal(get(f.ref, f.root).head, head); assert.equal(existsSync(f.lane), true);
});

test('published restore requires an exact live remote head and preserves refs without claiming dirty bytes', t => {
  const f = fixture(t); write(f.lane, 'owned/published.txt', 'retained commit\n');
  const head = commit(f.lane, 'published candidate');
  git(f.lane, 'push', '--quiet', 'origin', f.ref);
  const current = get(f.ref, f.root);
  putExact({ ...current, state: 'published', pr: 42, head }, current, f.root);
  const beforeRefs = refs(f.root);
  git(f.root, 'worktree', 'remove', f.lane);
  const plan = planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'restore' });
  assert.equal(plan.remoteHead, head); assert.equal(plan.restoredDirtyState, 'unobservable-at-missing-path');
  const receipt = applyLaneRebind({ cwd: f.root, planPath: savePlan(f, plan, 'published-restore.json'),
    authorization: authorize(plan), stopped: true });
  assert.equal(receipt.authoredBytesPreserved, false); assert.equal(receipt.providerAuthority, false);
  assert.equal(receipt.cleanupAuthority, false); assert.equal(refs(f.root), beforeRefs);
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), head);
  assert.equal(get(f.ref, f.root).state, 'published'); assert.equal(get(f.ref, f.root).head, head);
  assert.equal(readFileSync(join(f.lane, 'owned/published.txt'), 'utf8'), 'retained commit\n');
});

test('published restore refuses a missing or moved remote lane ref before mounting', t => {
  const f = fixture(t); write(f.lane, 'owned/published.txt', 'candidate\n');
  const head = commit(f.lane, 'candidate'), current = get(f.ref, f.root);
  putExact({ ...current, state: 'published', pr: 43, head }, current, f.root);
  git(f.root, 'worktree', 'remove', f.lane);
  const beforeRefs = refs(f.root);
  assert.throws(() => planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'restore' }),
    error => error.reason === 'blocked-lane-rebind-published-head');
  assert.equal(existsSync(f.lane), false); assert.equal(refs(f.root), beforeRefs);
});

test('published lane cannot use mounted rebind mode', t => {
  const f = fixture(t), current = get(f.ref, f.root);
  putExact({ ...current, state: 'published', pr: 44 }, current, f.root);
  assert.throws(() => planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'mounted' }),
    error => error.reason === 'blocked-lane-rebind-record');
  assert.equal(existsSync(f.lane), true);
});

test('record drift and missing stopped-writer attestation fail before any worktree mutation', t => {
  const f = fixture(t); write(f.lane, 'owned/committed.txt', 'authored\n'); commit(f.lane, 'authored');
  git(f.root, 'worktree', 'remove', f.lane);
  const plan = planLaneRebind({ cwd: f.root, ref: f.ref, mode: 'restore' }), path = savePlan(f, plan, 'drift.json');
  const current = get(f.ref, f.root); putExact({ ...current, scope: 'concurrent-owner' }, current, f.root);
  assert.throws(() => applyLaneRebind({ cwd: f.root, planPath: path, authorization: authorize(plan), stopped: true }),
    error => error.reason === 'blocked-lane-rebind-record-drift');
  assert.throws(() => applyLaneRebind({ cwd: f.root, planPath: path, authorization: authorize(plan), stopped: false }),
    error => error.reason === 'blocked-lane-rebind-stopped');
  assert.equal(existsSync(f.lane), false); assert.equal(git(f.root, 'show-ref').includes(plan.head), true);
});

test('dedicated command grammar rejects extra plan fields and unsupported modes', async () => {
  const { validateCommandArguments } = await import('../bin/agentic-os-argv.mjs');
  assert.equal(validateCommandArguments('release-common', ['rebind', 'plan', '--ref=agent/x/y', '--mode=mounted']), null);
  assert.match(validateCommandArguments('release-common', ['rebind', 'plan', '--ref=agent/x/y', '--mode=unknown']), /mode/u);
  assert.match(validateCommandArguments('release-common', ['rebind', 'apply', '--plan=x', '--authorize=y']), /missing --stopped/u);
});
