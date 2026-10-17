import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyStartLockRecovery, createStartLockRecoveryMarker, planStartLockRecovery,
  recoveryDirectoryIdentity, runStartLockRecovery } from '../src/start-lock-recovery.mjs';
import { commonDir, git } from '../src/git.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'start-lock-recovery-')), root = join(parent, 'repo');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  const run = (...args) => git(args, { cwd: root });
  run('init', '--quiet', '--initial-branch=main');
  run('config', 'user.name', 'Test'); run('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'base.txt'), 'base\n'); run('add', '.');
  run('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base');
  const lock = join(commonDir(root), 'agentic-os-start.lock'); mkdirSync(lock);
  return { root, lock, common: commonDir(root) };
}
const apply = (root, plan, options = {}) => applyStartLockRecovery(root, {
  planDigest: plan.planDigest, authorization: `agentic-os:start-lock-recovery:${plan.planDigest}`,
  stopped: true, ...options,
});

test('recovery plan is read-only and binds only an empty exact START lock', t => {
  const f = fixture(t), plan = planStartLockRecovery(f.root);
  assert.equal(plan.phase, 'stale-empty-lock'); assert.equal(plan.lock.path, f.lock);
  assert.equal(plan.processOwnershipVerified, false); assert.equal(plan.requiresOperatorStoppedAcknowledgement, true);
  assert.equal(readdirSync(f.lock).length, 0); assert.equal(plan.planDigest.length, 64);
});

test('apply requires exact operator authorization and archives the recovered lock', t => {
  const f = fixture(t), plan = planStartLockRecovery(f.root);
  assert.throws(() => applyStartLockRecovery(f.root, { planDigest: plan.planDigest,
    authorization: `agentic-os:start-lock-recovery:${plan.planDigest}`, stopped: false }), /--stopped/);
  assert.throws(() => applyStartLockRecovery(f.root, { planDigest: plan.planDigest,
    authorization: 'wrong', stopped: true }), /exact plan digest authorization/);
  assert.equal(readdirSync(f.lock).length, 0);
  const receipt = apply(f.root, plan);
  assert.equal(receipt.status, 'recovered'); assert.equal(receipt.processOwnershipVerified, false);
  assert.equal(receipt.originalPlanDigest, plan.planDigest);
  assert.equal(readdirSync(receipt.archivePath).includes('recovery.json'), true);
  mkdirSync(f.lock);
});

test('changed and nonempty START locks refuse without removing caller bytes', t => {
  const f = fixture(t), plan = planStartLockRecovery(f.root);
  writeFileSync(join(f.lock, 'keep.txt'), 'authored');
  assert.throws(() => apply(f.root, plan), /nonempty|changed/);
  assert.equal(readFileSync(join(f.lock, 'keep.txt'), 'utf8'), 'authored');
  assert.throws(() => planStartLockRecovery(f.root), /nonempty/);
});

test('an interrupted atomic handoff is recognized and finalized under a fresh exact plan', t => {
  const f = fixture(t), original = planStartLockRecovery(f.root);
  const staging = join(f.common, '.test-start-recovery-stage'); mkdirSync(staging, { mode: 0o700 });
  const archivePath = join(f.common, `.agentic-os-start-recovered-${original.planDigest}`);
  const marker = createStartLockRecoveryMarker(original, recoveryDirectoryIdentity(staging), archivePath);
  writeFileSync(join(staging, 'recovery.json'), JSON.stringify(marker), { mode: 0o600 });
  rmdirSync(f.lock); renameSync(staging, f.lock);
  const interrupted = planStartLockRecovery(f.root);
  assert.equal(interrupted.phase, 'interrupted-recovery');
  const receipt = apply(f.root, interrupted);
  assert.equal(receipt.status, 'recovered'); assert.equal(receipt.originalPlanDigest, original.planDigest);
  assert.equal(receipt.recoveryPlanDigest, interrupted.planDigest);
  assert.equal(readdirSync(receipt.archivePath).includes('recovery.json'), true);
});

test('CLI accepts only the explicit recovery plan/apply arguments', t => {
  const f = fixture(t), output = [];
  assert.equal(validateCommandArguments('release-common', ['start-lock-recovery', 'plan']), null);
  const digest = 'a'.repeat(64);
  assert.equal(validateCommandArguments('release-common', ['start-lock-recovery', 'apply',
    `--plan-digest=${digest}`, `--authorize=agentic-os:start-lock-recovery:${digest}`, '--stopped']), null);
  assert.notEqual(validateCommandArguments('release-common', ['start-lock-recovery', 'apply',
    '--plan-digest=abc', '--authorize=wrong', '--stopped']), null);
  assert.equal(runStartLockRecovery(f.root, ['plan'], line => output.push(line)), 0);
  assert.match(output[0], /start-lock-recovery-plan/);
});
