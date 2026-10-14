import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { commonDir } from '../src/git.mjs';
import { observeQuarantineManifest } from '../src/cleanup-manifest.mjs';
import { applyQuarantineRetirement, planQuarantineRetirement } from '../bin/agentic-os-cleanup-user.mjs';

const NOW = Date.parse('2026-10-11T00:05:00Z');
const g = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hash = value => value.repeat(64);
function registrationManifest(path) {
  const names = ['HEAD', 'logs'];
  const items = names.map(name => ({ name, manifest: observeQuarantineManifest(join(path, name), {
    byteCeiling: 16 * 1024 ** 2, entryCeiling: 10_000, retainedHardlinks: false,
  }) }));
  return { digest: governanceDigest({ schema: 'agentic-os/selected-manifest/v1',
    label: 'worktree-registration', mode: (statSync(path).mode & 0o777).toString(8), items }),
  bytes: items.reduce((sum, item) => sum + item.manifest.bytes, 0),
  entries: names.length + items.reduce((sum, item) => sum + item.manifest.entries, 0) };
}
function fixture(t, { registrationMode = 0o700, projectionFiles = 0, projectionHardlink = false } = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-retirement-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'); mkdirSync(root);
  g(root, 'init', '--quiet', '--initial-branch=main'); g(root, 'config', 'user.name', 'Fixture');
  g(root, 'config', 'user.email', 'fixture@example.invalid'); writeFileSync(join(root, 'base.txt'), 'base\n');
  g(root, 'add', '.'); g(root, 'commit', '--quiet', '-m', 'base');
  const head = g(root, 'rev-parse', 'HEAD'), branch = 'agent/device/retained-lane';
  g(root, 'branch', branch, head);
  const coordinate = hash('a'), common = realpathSync(commonDir(root)), quarantine = join(common, 'agentic-os-cleanup-quarantine');
  const operationPath = join(quarantine, coordinate), projection = join(operationPath, 'projection');
  const registration = join(operationPath, 'registration');
  mkdirSync(quarantine, { mode: 0o700 }); mkdirSync(operationPath, { mode: 0o700 });
  mkdirSync(projection, { mode: 0o755 }); writeFileSync(join(projection, 'recovery.txt'), 'discard me\n', { mode: 0o600 });
  if (projectionHardlink) { writeFileSync(join(projection, 'shared-a'), 'shared bytes\n'); linkSync(join(projection, 'shared-a'), join(projection, 'shared-b')); }
  for (let index = 0; index < projectionFiles; index += 1)
    writeFileSync(join(projection, `entry-${String(index).padStart(4, '0')}`), 'x', { mode: 0o600 });
  mkdirSync(registration, { mode: registrationMode }); chmodSync(registration, registrationMode);
  mkdirSync(join(registration, 'logs'), { mode: 0o700 });
  writeFileSync(join(registration, 'HEAD'), `ref: refs/heads/${branch}\n`, { mode: 0o600 });
  writeFileSync(join(registration, 'logs', 'HEAD'), `${'0'.repeat(40)} ${head} Fixture <fixture@example.invalid> 1791676800 +0000\tcheckout: moving from main to ${branch}\n`, { mode: 0o600 });
  const projectionManifest = observeQuarantineManifest(projection, {
    byteCeiling: 16 * 1024 ** 2, entryCeiling: 10_000, retainedHardlinks: projectionHardlink,
  });
  const retainedRegistration = registrationManifest(registration);
  const eligibility = { schema: 'agentic-os/user-cleanup-eligibility/v1', planDigest: coordinate,
    profileDigest: hash('b'), canonicalRevision: head,
    evaluatedAt: '2026-10-11T00:00:00.000Z', expiresAt: '2026-10-11T00:15:00.000Z',
    objectInventoryDigest: hash('c'), peerRegistrationDigest: hash('d'),
    projectionManifestDigest: projectionManifest.digest, projectionBytes: projectionManifest.bytes,
    projectionEntries: projectionManifest.entries, registrationManifestDigest: retainedRegistration.digest,
    registrationBytes: retainedRegistration.bytes, registrationEntries: retainedRegistration.entries,
    sharedRefDigest: hash('e'), sharedStateBytes: 0, sharedStateEntries: 0 };
  writeFileSync(join(operationPath, 'operation.json'), canonicalJson({
    schema: 'agentic-os/worktree-quarantine-operation/v1', eligibility,
    executedAt: '2026-10-11T00:01:00.000Z',
  }), { mode: 0o600 });
  const plan = planQuarantineRetirement({ cwd: root, coordinate, now: () => NOW });
  const authorization = `agentic-os:quarantine-retirement:${plan.planDigest}`;
  return { root, coordinate, operationPath, projection, registration, branch, head, plan, authorization };
}
function apply(state, extra = {}) {
  return applyQuarantineRetirement(state.plan, { cwd: state.root,
    authorization: state.authorization, stopped: true, discardRecovery: true,
    now: () => NOW + 1_000, probe: () => {}, ...extra });
}
function interrupt(state) {
  const content = { schema: 'agentic-os/quarantine-retirement-intent/v2', planDigest: state.plan.planDigest,
    plan: state.plan, authorizationDigest: governanceDigest(state.authorization), authorizedAt: NOW + 1_000 };
  const intent = { ...content, intentDigest: governanceDigest(content) };
  writeFileSync(join(state.operationPath, 'retirement.intent.json'), canonicalJson(intent), { mode: 0o600 });
  chmodSync(state.projection, 0o700); rmSync(join(state.projection, 'recovery.txt'));
  return intent;
}

test('exact local-consent retirement removes only the projection and leaves branch evidence', t => {
  const state = fixture(t), refs = g(state.root, 'show-ref');
  const receipt = apply(state);
  assert.equal(receipt.schema, 'agentic-os/quarantine-retirement-receipt/v2');
  assert.equal(receipt.logicalBytesUnlinked, Buffer.byteLength('discard me\n'));
  assert.equal(receipt.bytesDeleted, true); assert.equal(receipt.physicalFreeSpaceIncreaseProven, false);
  assert.equal(receipt.recoveryBytesDiscarded, true); assert.equal(receipt.registrationRetained, true);
  assert.equal(receipt.projectionRootPermissionsTightened, true);
  assert.equal(receipt.registrationRootModeBefore, 0o700);
  assert.equal(receipt.registrationRootPermissionsTightened, false);
  assert.equal(receipt.branchRefsMutated, false); assert.equal(receipt.objectDatabaseMutated, false);
  assert.equal(existsSync(state.projection), false); assert.equal(existsSync(state.registration), true);
  assert.equal(readFileSync(join(state.operationPath, 'operation.json'), 'utf8').length > 0, true);
  assert.equal(g(state.root, 'show-ref'), refs);
  assert.equal(receipt.receiptDigest, governanceDigest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptDigest'))));
  assert.equal(existsSync(join(state.operationPath, 'retirement.json')), true);
  assert.throws(() => apply(state, { now: () => NOW + 2_000_000 }), /retirement-evidence/u);
});

test('legacy registration roots are bound, probed, and tightened before projection deletion', t => {
  const state = fixture(t, { registrationMode: 0o755 }), probed = [];
  assert.equal(state.plan.schema, 'agentic-os/quarantine-retirement-plan/v2');
  assert.equal(state.plan.registrationRoot[3], 0o755);
  assert.equal(statSync(state.registration).mode & 0o777, 0o755);
  const receipt = apply(state, { probe: path => probed.push(path) });
  assert.deepEqual(probed, [state.projection, state.registration]);
  assert.equal(receipt.registrationRootModeBefore, 0o755);
  assert.equal(receipt.registrationRootPermissionsTightened, true);
  assert.equal(statSync(state.registration).mode & 0o777, 0o700);
  assert.equal(existsSync(state.projection), false);
  assert.equal(existsSync(join(state.registration, 'HEAD')), true);
});

test('large retirement trees use bounded row comparisons and complete without partial intents', t => {
  const state = fixture(t, { projectionFiles: 1200 });
  const receipt = apply(state);
  assert.equal(receipt.bytesDeleted, true);
  assert.equal(receipt.logicalBytesUnlinked, Buffer.byteLength('discard me\n') + 1200);
  assert.equal(existsSync(state.projection), false);
  assert.equal(existsSync(join(state.operationPath, 'retirement.intent.json')), false);
  assert.equal(existsSync(join(state.operationPath, 'retirement.json')), true);
  assert.equal(existsSync(join(state.registration, 'HEAD')), true);
});

test('quarantine retirement removes same-tree hard links without a false drift stop', t => {
  const state = fixture(t, { projectionHardlink: true });
  const receipt = apply(state);
  assert.equal(receipt.bytesDeleted, true);
  assert.equal(receipt.logicalBytesUnlinked, Buffer.byteLength('discard me\n') + 2 * Buffer.byteLength('shared bytes\n'));
  assert.equal(existsSync(state.projection), false);
  assert.equal(existsSync(join(state.operationPath, 'retirement.intent.json')), false);
  assert.equal(existsSync(join(state.registration, 'HEAD')), true);
});

test('retirement requires the exact plan digest and both irreversible acknowledgments', t => {
  const state = fixture(t);
  for (const input of [
    { authorization: 'wrong' }, { stopped: false }, { discardRecovery: false },
  ]) assert.throws(() => apply(state, input), /retirement-authorization/u);
  assert.equal(existsSync(state.projection), true);
});

test('open readers, plan drift, and noncanonical or protected coordinates retain recovery bytes', t => {
  const state = fixture(t);
  assert.throws(() => apply(state, { probe: () => { throw new Error('blocked-open-files'); } }), /blocked-open-files/u);
  writeFileSync(join(state.projection, 'recovery.txt'), 'changed after plan\n');
  assert.throws(() => apply(state), /evidence/u);
  assert.equal(existsSync(state.projection), true);
  assert.throws(() => planQuarantineRetirement({ cwd: state.root, coordinate: '../outside', now: () => NOW }), /coordinate/u);
});

test('retirement refuses a replaced registration root even when its files are moved intact', t => {
  const state = fixture(t), replacement = join(tmpdir(), `agentic-os-registration-replacement-${process.pid}`);
  renameSync(state.registration, replacement);
  mkdirSync(state.registration, { mode: 0o700 });
  renameSync(join(replacement, 'HEAD'), join(state.registration, 'HEAD'));
  renameSync(join(replacement, 'logs'), join(state.registration, 'logs'));
  rmSync(replacement, { recursive: true, force: true });
  assert.throws(() => apply(state), /retirement-drift/u);
  assert.equal(existsSync(join(state.projection, 'recovery.txt')), true);
  assert.equal(existsSync(join(state.operationPath, 'retirement.intent.json')), false);
});

test('registration roots with unsupported permissions remain ineligible', t => {
  assert.throws(() => fixture(t, { registrationMode: 0o750 }), /retirement-registration/u);
});

test('stale plans and interrupted intents fail closed', t => {
  const state = fixture(t);
  assert.throws(() => apply(state, { now: () => NOW + 900_000 }), /expired/u);
  writeFileSync(join(state.operationPath, 'retirement.intent.json'), '{}', { mode: 0o600 });
  assert.throws(() => apply(state), /state/u);
  assert.equal(existsSync(state.projection), true);
});

test('an exact fresh resume plan finishes a partially unlinked projection and retains prior consent evidence', t => {
  const state = fixture(t), intent = interrupt(state);
  const resume = planQuarantineRetirement({ cwd: state.root, coordinate: state.coordinate, now: () => NOW + 2_000 });
  assert.equal(resume.schema, 'agentic-os/quarantine-retirement-plan/v3');
  assert.equal(resume.resumeIntentDigest, intent.intentDigest);
  assert.equal(resume.projection.bytes, 0);
  const receipt = applyQuarantineRetirement(resume, { cwd: state.root,
    authorization: `agentic-os:quarantine-retirement:${resume.planDigest}`, stopped: true,
    discardRecovery: true, now: () => NOW + 3_000, probe: () => {} });
  assert.equal(receipt.originalIntentDigest, intent.intentDigest);
  assert.equal(receipt.logicalBytesUnlinked, state.plan.projection.bytes);
  assert.equal(receipt.resumedLogicalBytesUnlinked, 0);
  assert.equal(existsSync(state.projection), false);
  assert.equal(existsSync(state.registration), true);
  assert.equal(existsSync(join(state.operationPath, 'retirement.intent.json')), false);
});

test('resume refuses residual projection drift after planning', t => {
  const state = fixture(t); interrupt(state);
  const resume = planQuarantineRetirement({ cwd: state.root, coordinate: state.coordinate, now: () => NOW + 2_000 });
  writeFileSync(join(state.projection, 'new.txt'), 'unreviewed residual\n', { mode: 0o600 });
  assert.throws(() => applyQuarantineRetirement(resume, { cwd: state.root,
    authorization: `agentic-os:quarantine-retirement:${resume.planDigest}`, stopped: true,
    discardRecovery: true, now: () => NOW + 3_000, probe: () => {} }), /retirement-drift/u);
  assert.equal(existsSync(join(state.projection, 'new.txt')), true);
  assert.equal(existsSync(join(state.operationPath, 'retirement.intent.json')), true);
});

test('cleanup CLI routes the nested retire command to its exact argument grammar', t => {
  const state = fixture(t), cli = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [cli, 'cleanup-user', 'retire', 'plan', '--unknown=x'], {
    cwd: state.root, stdio: ['ignore', 'pipe', 'pipe'],
  }), error => /retirement-arguments/u.test(error.stderr.toString())
    && !/blocked-invalid-arguments/u.test(error.stderr.toString()));
});
