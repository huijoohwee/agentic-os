import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson, createRepositoryProfile, governanceDigest, RETAIN_ALL_CLEANUP } from '../src/governance.mjs';
import { commonDir } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { CACHE_LIMITS, load, newRecord, put, save } from '../src/lane-records.mjs';
import { observeQuarantineManifest } from '../src/cleanup-manifest.mjs';
import { applyQuarantineRetirement, createRetirementOpenReaderProbe, planQuarantineRetirement } from '../bin/agentic-os-cleanup-user.mjs';
import { applyUnpublishedLaneAbandonment, planUnpublishedLaneAbandonment } from '../bin/agentic-os-lane-abandon.mjs';
import { deriveCloseoutVerdict, inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { trustedRepositoryProfile } from '../bin/agentic-os-auxiliary.mjs';

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
function fixture(t, { registrationMode = 0o700, projectionFiles = 0, projectionHardlink = false,
  eligibilitySchema = 'agentic-os/user-cleanup-eligibility/v1', detached = false,
  legacyRegistrationManifest = false } = {}) {
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
  writeFileSync(join(registration, 'HEAD'), detached ? `${head}\n` : `ref: refs/heads/${branch}\n`, { mode: 0o600 });
  const checkout = detached ? `checkout: moving from ${branch} to ${head}` : `checkout: moving from main to ${branch}`;
  writeFileSync(join(registration, 'logs', 'HEAD'), `${'0'.repeat(40)} ${head} Fixture <fixture@example.invalid> 1791676800 +0000\t${checkout}\n`, { mode: 0o600 });
  const projectionManifest = observeQuarantineManifest(projection, {
    byteCeiling: 16 * 1024 ** 2, entryCeiling: 10_000, retainedHardlinks: projectionHardlink,
  });
  const retainedRegistration = legacyRegistrationManifest
    ? observeQuarantineManifest(registration, { byteCeiling: 16 * 1024 ** 2,
      entryCeiling: 10_000, retainedHardlinks: true }) : registrationManifest(registration);
  const eligibility = { schema: eligibilitySchema, ...(eligibilitySchema === 'agentic-os/worktree-cleanup-eligibility/v1'
    ? { cleanupPlanDigest: coordinate } : { planDigest: coordinate }),
    profileDigest: hash('b'), canonicalRevision: head,
    evaluatedAt: '2026-10-11T00:00:00.000Z', expiresAt: '2026-10-11T00:15:00.000Z',
    objectInventoryDigest: hash('c'), peerRegistrationDigest: hash('d'),
    ...(eligibilitySchema === 'local-owner-authorized-quarantine-eligibility/v1' ? {
      projectionManifest, registrationManifest: retainedRegistration,
    } : { projectionManifestDigest: projectionManifest.digest, projectionBytes: projectionManifest.bytes,
      projectionEntries: projectionManifest.entries, registrationManifestDigest: retainedRegistration.digest,
      registrationBytes: retainedRegistration.bytes, registrationEntries: retainedRegistration.entries }),
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
function unpublishedDirtyLane(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-abandonment-'))), root = join(parent, 'repo'), target = join(parent, 'lane');
  t.after(() => rmSync(parent, { recursive: true, force: true })); mkdirSync(root);
  g(root, 'init', '--quiet', '--initial-branch=main'); g(root, 'config', 'user.name', 'Fixture'); g(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({ repository: 'github.com/example/repository', canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' }, adapters: { repository: { id: 'git', version: '1' }, provider: null }, cleanup: { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`); writeFileSync(join(root, 'tracked.txt'), 'canonical\n');
  g(root, 'add', '.'); g(root, 'commit', '--quiet', '-m', 'trusted canonical profile'); const baseSha = g(root, 'rev-parse', 'HEAD');
  g(root, 'update-ref', 'refs/remotes/origin/main', baseSha); ensureRepositoryTrust(root, profile, { allowCreate: true });
  const ref = 'agent/device/unpublished-abandonment'; g(root, 'worktree', 'add', '--quiet', '-b', ref, target, 'main');
  writeFileSync(join(target, 'candidate.txt'), 'unreviewed candidate\n'); g(target, 'add', 'candidate.txt'); g(target, 'commit', '--quiet', '-m', 'local candidate');
  const head = g(target, 'rev-parse', 'HEAD'); writeFileSync(join(target, 'tracked.txt'), 'dirty tracked bytes\n'); writeFileSync(join(target, 'untracked.txt'), 'dirty untracked bytes\n');
  put({ ...newRecord({ ref, device: 'device', scope: 'unpublished-abandonment', base: 'refs/remotes/origin/main', baseSha, worktree: target, writePaths: ['candidate.txt', 'tracked.txt'] }), state: 'active', head }, root);
  return { root, target, ref, head, profile, publicationCheck: () => {} };
}
function interrupt(state) {
  const content = { schema: 'agentic-os/quarantine-retirement-intent/v2', planDigest: state.plan.planDigest,
    plan: state.plan, authorizationDigest: governanceDigest(state.authorization), authorizedAt: NOW + 1_000 };
  const intent = { ...content, intentDigest: governanceDigest(content) };
  writeFileSync(join(state.operationPath, 'retirement.intent.json'), canonicalJson(intent), { mode: 0o600 });
  chmodSync(state.projection, 0o700); rmSync(join(state.projection, 'recovery.txt'));
  return intent;
}

test('lane cache admits bounded records above the previous aggregate-string ceiling', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-cache-headroom-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  g(root, 'init', '--quiet', '--initial-branch=main');
  const ref = 'agent/device/cache-headroom', writePaths = Array.from({ length: 410 }, (_, index) =>
    `src/${String(index).padStart(4, '0')}-${'x'.repeat(980)}`);
  save({ schema: 'agentic-os/lanes/v1', lanes: {
    [ref]: { ref, state: 'planned', writePaths },
  } }, root);
  assert.equal(CACHE_LIMITS.aggregateStringBytes, 415_000);
  assert.equal(load(root).lanes[ref].writePaths.length, writePaths.length);
});

test('retirement reader probe catches process working directories and fails closed on incomplete lsof output', () => {
  const target = '/tmp/repo/.git/quarantine/projection';
  const output = ['p41', 'cnode', 'fcwd', 'n/tmp/repo/.git/quarantine/projection/canvas',
    'p42', 'cnode', 'fcwd', 'n/tmp/repo-other/canvas'].join('\n');
  const calls = [], probe = createRetirementOpenReaderProbe({ pid: 42, execute: args => {
    calls.push(args); return args[0] === '-t' ? '' : output;
  } });
  assert.throws(() => probe(target), error => error.reason === 'retirement-open-files');
  assert.deepEqual(calls, [['-t', '+D', target], ['-nP', '-Fpcfn', '-d', 'cwd']]);
  assert.doesNotThrow(() => createRetirementOpenReaderProbe({ pid: 42, execute: args => args[0] === '-t'
    ? '' : 'p42\ncnode\nfcwd\nn/tmp/repo-other/canvas' })(target));
  assert.throws(() => createRetirementOpenReaderProbe({ pid: 42, execute: args => args[0] === '-t'
    ? '' : 'p99\ncnode\nfcwd\nn/tmp/other' })(target),
    error => error.reason === 'retirement-open-scan');
  assert.throws(() => createRetirementOpenReaderProbe({ pid: 42, execute: args => args[0] === '-t'
    ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: output, stderr: 'warning: incomplete process list' } })(target),
    error => error.reason === 'retirement-open-scan');
  assert.throws(() => createRetirementOpenReaderProbe({ pid: 42, execute: args => args[0] === '-t'
    ? { status: 1, stdout: '41\n', stderr: '' } : { status: 0, stdout: output, stderr: '' } })(target),
    error => error.reason === 'retirement-open-files');
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-reader-alias-')), actual = join(root, 'actual'), alias = join(root, 'alias');
  mkdirSync(join(actual, 'canvas'), { recursive: true }); symlinkSync(actual, alias, 'dir');
  try { assert.throws(() => createRetirementOpenReaderProbe({ pid: 42, execute: args => args[0] === '-t'
    ? '' : `p42\ncnode\nfcwd\nn${alias}/canvas` })(actual), error => error.reason === 'retirement-open-files'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('unpublished abandonment archives dirty projection and registration without changing refs or objects', (t) => {
  const state = unpublishedDirtyLane(t), plan = planUnpublishedLaneAbandonment({ cwd: state.root, ref: state.ref,
    reason: 'Obsolete unpublished scratch source; reviewed successor already carries the feature.', now: () => NOW,
    publicationCheck: state.publicationCheck });
  const refsBefore = g(state.root, 'for-each-ref', '--format=%(refname) %(objectname)'), objectsBefore = g(state.root, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)');
  const receipt = applyUnpublishedLaneAbandonment(plan, { cwd: state.root,
    authorization: `agentic-os:unpublished-lane-abandonment:${plan.planDigest}`, stopped: true,
    now: () => NOW + 1000, probe: () => {}, publicationCheck: state.publicationCheck });
  assert.equal(receipt.sourceAbandoned, true); assert.equal(receipt.sourceIntegrated, false); assert.equal(receipt.sourceSuperseded, false);
  assert.equal(g(state.root, 'rev-parse', `refs/heads/${state.ref}`), state.head);
  assert.equal(g(state.root, 'for-each-ref', '--format=%(refname) %(objectname)'), refsBefore);
  assert.equal(g(state.root, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)'), objectsBefore);
  assert.equal(readFileSync(join(receipt.projectionPath, 'tracked.txt'), 'utf8'), 'dirty tracked bytes\n');
  assert.equal(readFileSync(join(receipt.projectionPath, 'untracked.txt'), 'utf8'), 'dirty untracked bytes\n');
  assert.equal(existsSync(state.target), false);
  const profile = trustedRepositoryProfile(state.root).profile, status = inspectCompletionStatus(state.root, state.ref,
    { protectedBranch: 'main' }, profile);
  assert.equal(status.closeout.sourceDisposition, 'abandoned'); assert.equal(status.closeout.sourceIntegrated, false);
  assert.equal(status.closeout.sourceSuperseded, false); assert.equal(status.closeout.missionState, 'source_complete');
  assert.equal(status.closeout.adlcState, 'complete'); assert.equal(status.closeout.cleanupSatisfied, true);
});

test('unpublished abandonment refuses dirty-byte drift before the quarantine effect', (t) => {
  const state = unpublishedDirtyLane(t), plan = planUnpublishedLaneAbandonment({ cwd: state.root, ref: state.ref,
    reason: 'Obsolete unpublished scratch source; reviewed successor already carries the feature.', now: () => NOW,
    publicationCheck: state.publicationCheck });
  writeFileSync(join(state.target, 'tracked.txt'), 'changed after the archive plan\n');
  assert.throws(() => applyUnpublishedLaneAbandonment(plan, { cwd: state.root,
    authorization: `agentic-os:unpublished-lane-abandonment:${plan.planDigest}`, stopped: true,
    now: () => NOW + 1000, probe: () => {}, publicationCheck: state.publicationCheck }), error => error.reason === 'blocked-lane-abandonment-recovery-drift');
  assert.equal(existsSync(state.target), true); assert.equal(g(state.root, 'rev-parse', `refs/heads/${state.ref}`), state.head);
});

test('closeout labels owner abandonment separately from integration and supersession', () => {
  const result = deriveCloseoutVerdict({ sourceIntegrated: false, sourceSuperseded: false, sourceAbandoned: true,
    canonicalCurrent: true, laneMounted: false, laneHead: true, quarantineProfile: true,
    quarantineObserved: true, deployBound: false, findingCodes: [] });
  assert.equal(result.sourceDisposition, 'abandoned'); assert.equal(result.sourceIntegrated, false);
  assert.equal(result.sourceSuperseded, false); assert.equal(result.sourceAbandoned, true);
  assert.equal(result.adlcState, 'complete'); assert.equal(result.cleanupSatisfied, true);
});

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
  assert.equal(state.plan.schema, 'agentic-os/quarantine-retirement-plan/v3');
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

test('legacy quarantine eligibility schemas retire only their exact retained projection', t => {
  for (const eligibilitySchema of ['agentic-os/worktree-cleanup-eligibility/v1',
    'agentic-os/empty-active-lane-retirement-eligibility/v1',
    'local-owner-authorized-quarantine-eligibility/v1']) {
    const state = fixture(t, { eligibilitySchema }), receipt = apply(state);
    assert.equal(receipt.bytesDeleted, true, eligibilitySchema);
    assert.equal(existsSync(state.projection), false, eligibilitySchema);
    assert.equal(existsSync(state.registration), true, eligibilitySchema);
  }
});

test('legacy full-tree registration manifests remain exactly bound during retirement', t => {
  const state = fixture(t, { eligibilitySchema: 'agentic-os/worktree-cleanup-eligibility/v1',
    legacyRegistrationManifest: true });
  const receipt = apply(state);
  assert.equal(receipt.bytesDeleted, true);
  assert.equal(existsSync(state.projection), false);
  assert.equal(existsSync(state.registration), true);
  assert.equal(g(state.root, 'show-ref').includes(state.branch), true);
});

test('detached retained HEAD retires only while its exact lane ref remains reachable', t => {
  const state = fixture(t, { detached: true }), receipt = apply(state);
  assert.equal(receipt.retainedHead, state.head);
  assert.equal(receipt.branch, state.branch);
  assert.equal(existsSync(state.projection), false);
  assert.equal(existsSync(state.registration), true);
});

test('detached retained HEAD without its source lane ref is ineligible', t => {
  const state = fixture(t, { detached: true });
  g(state.root, 'branch', '-D', state.branch);
  assert.throws(() => planQuarantineRetirement({ cwd: state.root, coordinate: state.coordinate, now: () => NOW }), /retirement-evidence/u);
  assert.equal(existsSync(join(state.projection, 'recovery.txt')), true);
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
  assert.equal(resume.schema, 'agentic-os/quarantine-retirement-plan/v4');
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

test('resume hashes and retires a residual tree larger than the governance node budget', t => {
  const state = fixture(t, { projectionFiles: 1100 }), intent = interrupt(state);
  const resume = planQuarantineRetirement({ cwd: state.root, coordinate: state.coordinate, now: () => NOW + 2_000 });
  assert.equal(resume.schema, 'agentic-os/quarantine-retirement-plan/v4');
  assert.equal(resume.resumeIntentDigest, intent.intentDigest);
  assert.ok(resume.projection.entries > 1000);
  const receipt = applyQuarantineRetirement(resume, { cwd: state.root,
    authorization: `agentic-os:quarantine-retirement:${resume.planDigest}`, stopped: true,
    discardRecovery: true, now: () => NOW + 3_000, probe: () => {} });
  assert.equal(receipt.resumedLogicalBytesUnlinked, resume.projection.bytes);
  assert.equal(receipt.logicalBytesUnlinked, state.plan.projection.bytes);
  assert.equal(existsSync(state.projection), false);
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
