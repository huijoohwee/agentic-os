import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RETAIN_ALL_CLEANUP, canonicalJson, createRepositoryProfile, governanceDigest, integrate, retire,
} from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import {
  createAuthenticatedTransitionOperationReceipt, createEffectPlan, effectPlanByteDigest,
  encodeEffectPlan,
} from '../src/completion.mjs';
import {
  CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS, INTEGRATION_RECORD_RETAINED_EFFECTS,
  RETAINED_EFFECTS, assessWorktreeCleanupEligibility,
  createCleanupEvidenceReceipt, createWorktreeCleanupPlan, deriveCleanupOwnerStateDigest,
  executeWorktreeCleanup, validateWorktreeCleanupReceipt, worktreeCleanupPlanByteDigest,
} from '../src/cleanup.mjs';

const NOW = Date.parse('2026-09-02T00:40:00.000Z');
const hash = (character) => character.repeat(64);
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function writeProfile(root, quarantine, repositoryAdapter = { id: 'git', version: '1' }) {
  const profile = createRepositoryProfile({ repository: 'github.com/example/repository',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: repositoryAdapter, provider: null },
    cleanup: quarantine ? { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } : RETAIN_ALL_CLEANUP });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  return profile;
}
function repository(t, quarantine = true, canonicalTarget = false, repositoryAdapter) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-cleanup-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repository'), target = join(parent, 'dirty-worktree');
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitignore'), 'runtime/\n');
  writeFileSync(join(root, 'tracked.txt'), 'canonical\n');
  const profile = writeProfile(root, quarantine, repositoryAdapter);
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '--message', 'trusted canonical profile');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  let controller = root, dirtyTarget = target, branch = 'agent/device/dirty';
  if (canonicalTarget) {
    controller = join(parent, 'controller-worktree'); dirtyTarget = root; branch = 'main';
    git(root, 'worktree', 'add', '--quiet', '-b', 'agent/device/controller', controller, 'main');
  } else git(root, 'worktree', 'add', '--quiet', '-b', branch, dirtyTarget, 'main');
  writeFileSync(join(dirtyTarget, 'tracked.txt'), 'dirty tracked bytes\n');
  writeFileSync(join(dirtyTarget, 'untracked.txt'), 'visible owner bytes\n');
  mkdirSync(join(dirtyTarget, 'runtime'));
  writeFileSync(join(dirtyTarget, 'runtime', 'state.bin'), Buffer.alloc(1024 * 1024 + 17, 7));
  return { parent, root: realpathSync(controller), target: realpathSync(dirtyTarget), branch,
    profile, head: git(root, 'rev-parse', 'HEAD') };
}
function effectPlan({ target, transition, claimId, leaseEpoch, fenceRevision,
  predecessorDigest, candidateDigest, snapshotDigest, parametersDigest, immutableRevision,
  cleanup = false }) {
  return createEffectPlan({ target: { repository: 'github.com/example/repository',
    resource: target, immutableRevision },
  authority: { requestedTransition: transition, authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42', claimId, leaseEpoch, fenceRevision,
    writeSetDigest: governanceDigest(['owner-bound-worktree']),
    reviewLocator: transition === 'integrate' ? target : null,
    predecessorDigest }, candidateDigest, snapshotDigest,
  effectClass: cleanup ? 'claim-retirement-with-cleanup' : 'protected-integration-record',
  allowedEffects: cleanup ? [...CLEANUP_EFFECTS, 'retire-claim'] : INTEGRATION_RECORD_EFFECTS,
  forbiddenEffects: cleanup ? RETAINED_EFFECTS : INTEGRATION_RECORD_RETAINED_EFFECTS,
  parametersDigest });
}
function request(plan) {
  const create = plan.authority.requestedTransition === 'integrate' ? integrate : retire;
  return create({ repository: plan.target.repository, authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42', scope: ['owner-bound-worktree'],
    claimId: plan.authority.claimId, leaseEpoch: plan.authority.leaseEpoch,
    fenceRevision: plan.authority.fenceRevision, immutableRevision: plan.target.immutableRevision,
    reviewLocator: plan.authority.reviewLocator,
    dependentWork: [`effect-plan:sha256:${effectPlanByteDigest(encodeEffectPlan(plan))}`],
    observedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z' });
}
function transitionVerifier(resultFenceRevision) {
  return async ({ request: source, plan: bound,
      planByteDigest }) => ({ adapter: { id: 'fixture-provider', version: '1' },
    authenticatedSubject: 'github-user:42', providerRecordLocator: 'provider://operation/1',
    providerRecordDigest: hash('4'), requestDigest: source.requestDigest,
    requestedTransition: source.requestedTransition, planDigest: bound.planDigest,
    planByteDigest, sourceClaimId: source.claimId, sourceLeaseEpoch: source.leaseEpoch,
    sourceFenceRevision: source.fenceRevision, resultClaimId: source.claimId,
    resultLeaseEpoch: source.leaseEpoch + 1, resultFenceRevision,
    resultState: source.requestedTransition === 'integrate' ? 'integrated' : 'retired',
    operationReceiptDigest: hash(source.requestedTransition === 'integrate' ? '5' : '8'),
    transitionedAt: '2026-09-02T00:25:00.000Z',
    verifiedAt: '2026-09-02T00:30:00.000Z', expiresAt: '2026-09-02T00:55:00.000Z' });
}
async function transitionReceipt(plan, resultFenceRevision) {
  return createAuthenticatedTransitionOperationReceipt({ request: request(plan),
    planBytes: encodeEffectPlan(plan) }, transitionVerifier(resultFenceRevision),
  { now: () => NOW });
}
async function lifecycle(t, { quarantine = true, projectionByteCeiling = 8 * 1024 * 1024,
  canonicalTarget = false, repositoryAdapter } = {}) {
  const repo = repository(t, quarantine, canonicalTarget, repositoryAdapter), candidateDigest = hash('a');
  const inventory = collectRecoveryInventory({ cwd: repo.target, canonicalRef: 'refs/heads/main' });
  const recoveryInventoryDigest = governanceDigest(inventory), snapshotDigest = hash('b');
  const integratedResource = 'https://github.com/example/repository/pull/7';
  const integratedImmutableRevision = 'f'.repeat(40), integrationProofDigest = hash('d');
  const integrationPlan = effectPlan({ target: integratedResource, transition: 'integrate',
    claimId: hash('1'), leaseEpoch: 7, fenceRevision: hash('2'), predecessorDigest: hash('6'),
    candidateDigest, snapshotDigest, parametersDigest: integrationProofDigest,
    immutableRevision: integratedImmutableRevision });
  const integrationPlanBytes = encodeEffectPlan(integrationPlan);
  const integrationRequest = request(integrationPlan);
  const verifyIntegrationAuthority = transitionVerifier(hash('3'));
  const integrationReceipt = await createAuthenticatedTransitionOperationReceipt({
    request: integrationRequest, planBytes: integrationPlanBytes }, verifyIntegrationAuthority,
  { now: () => NOW });
  const ownerStateDigest = deriveCleanupOwnerStateDigest({
    claimId: integrationReceipt.transitionReceipt.resultClaimId,
    leaseEpoch: integrationReceipt.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integrationReceipt.transitionReceipt.resultFenceRevision, state: 'integrated' });
  const evidence = (kind) => createCleanupEvidenceReceipt({ kind,
    repository: repo.profile.repository, targetPath: repo.target, candidateDigest, snapshotDigest,
    integrationReceiptDigest: integrationReceipt.receiptDigest, recoveryInventoryDigest,
    recoveryInventoryContentEntries: inventory.inventoryEntries.content, ownerStateDigest,
    archiveDigest: hash('e'), preservationComplete: kind === 'preservation' ? true : null,
    reachableFromRetainedRefs: kind === 'no-remaining-value' ? true : null,
    unpreservedValueCount: kind === 'no-remaining-value' ? 0 : null });
  const preservationReceipt = evidence('preservation');
  const noRemainingValueReceipt = evidence('no-remaining-value');
  const plan = createWorktreeCleanupPlan({ repository: repo.profile.repository,
    targetPath: repo.target, expectedBranch: repo.branch,
    expectedHeadRevision: repo.head, expectedCanonicalRef: 'refs/heads/main',
    expectedCanonicalRevision: repo.head, integratedResource, integratedImmutableRevision,
    candidateDigest, snapshotDigest, integrationProofDigest, profileDigest: repo.profile.profileDigest,
    recoveryInventoryDigest, recoveryInventoryContentEntries: inventory.inventoryEntries.content,
    ownerStateDigest, integrationReceiptDigest: integrationReceipt.receiptDigest,
    integrationPlanByteDigest: effectPlanByteDigest(integrationPlanBytes),
    integrationPredecessorDigest: integrationPlan.authority.predecessorDigest,
    preservationReceiptDigest: preservationReceipt.receiptDigest,
    noRemainingValueReceiptDigest: noRemainingValueReceipt.receiptDigest,
    projectionByteCeiling, projectionEntryCeiling: 20_000,
    registrationByteCeiling: 16 * 1024 * 1024, registrationEntryCeiling: 20_000,
    sharedStateByteCeiling: 64 * 1024 * 1024, sharedStateEntryCeiling: 100_000,
    authorizedEffects: CLEANUP_EFFECTS, retainedEffects: RETAINED_EFFECTS,
    expiresAt: '2026-09-02T01:00:00.000Z' });
  const retirementPlan = effectPlan({ target: repo.target, transition: 'retire',
    claimId: integrationReceipt.transitionReceipt.resultClaimId,
    leaseEpoch: integrationReceipt.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integrationReceipt.transitionReceipt.resultFenceRevision,
    predecessorDigest: integrationReceipt.receiptDigest, candidateDigest, snapshotDigest,
    parametersDigest: worktreeCleanupPlanByteDigest(plan),
    immutableRevision: integratedImmutableRevision, cleanup: true });
  const retirementReceipt = await transitionReceipt(retirementPlan, hash('7'));
  const retirementRequest = request(retirementPlan);
  const verifyRetirementAuthority = transitionVerifier(hash('7'));
  return { repo, input: { plan, integrationReceipt, integrationPlanBytes, integrationRequest,
    retirementReceipt, retirementRequest, retirementPlanBytes: encodeEffectPlan(retirementPlan),
    preservationReceipt, noRemainingValueReceipt }, verification: {
    verifyIntegrationAuthority, verifyRetirementAuthority } };
}
function cleanupOptions(fixture, overrides = {}) {
  return { cwd: fixture.repo.root, now: () => NOW, ...fixture.verification, ...overrides };
}

test('exact dirty projection and registration are quarantined with refs and bytes retained',
  async (t) => {
    const fixture = await lifecycle(t);
    const peer = join(fixture.repo.parent, 'retained-peer');
    git(fixture.repo.root, 'worktree', 'add', '--quiet', '-b', 'agent/device/peer', peer, 'main');
    git(fixture.repo.root, 'update-ref', 'refs/heads/retained-proof', fixture.repo.head);
    const unreachable = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: fixture.repo.root, encoding: 'utf8', input: 'retained unreachable object\n' }).trim();
    assert.notEqual(git(fixture.repo.target, 'status', '--porcelain', '--ignored'), '');
    const branchBefore = git(fixture.repo.root, 'rev-parse', 'refs/heads/agent/device/dirty');
    const eligibility = await assessWorktreeCleanupEligibility(fixture.input,
      cleanupOptions(fixture));
    assert.ok(eligibility.recoveryInventoryContentEntries >= 5);
    assert.ok(eligibility.sharedStateBytes > 0);
    assert.ok(eligibility.sharedStateEntries > 0);
    const receipt = await executeWorktreeCleanup({ ...fixture.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest },
    cleanupOptions(fixture));
    assert.deepEqual(validateWorktreeCleanupReceipt(receipt), receipt);
    assert.equal(existsSync(fixture.repo.target), false);
    assert.equal(git(fixture.repo.root, 'rev-parse', 'refs/heads/agent/device/dirty'), branchBefore);
    assert.equal(git(fixture.repo.root, 'rev-parse', 'refs/heads/retained-proof'), fixture.repo.head);
    assert.equal(git(fixture.repo.root, 'cat-file', '-t', unreachable), 'blob');
    assert.match(git(fixture.repo.root, 'worktree', 'list', '--porcelain'),
      new RegExp(peer.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.doesNotMatch(git(fixture.repo.root, 'worktree', 'list', '--porcelain'),
      new RegExp(fixture.repo.target.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.equal(readFileSync(join(receipt.projectionQuarantinePath, 'tracked.txt'), 'utf8'),
      'dirty tracked bytes\n');
    assert.equal(existsSync(receipt.registrationQuarantinePath), true);
    assert.equal(receipt.operatingSystemExclusivityProven, false);
    assert.equal(receipt.integrationPlanByteDigest,
      fixture.input.plan.integrationPlanByteDigest);
    assert.equal(receipt.sharedStateBytes, eligibility.sharedStateBytes);
    const replay = await executeWorktreeCleanup({ ...fixture.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest },
    cleanupOptions(fixture));
    assert.deepEqual(replay, receipt, 'response-loss retry returns the deterministic exact receipt');
    const expiredReplay = await executeWorktreeCleanup({ ...fixture.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest }, cleanupOptions(fixture, {
      now: () => Date.parse('2026-09-02T01:05:00.000Z') }));
    assert.deepEqual(expiredReplay, receipt, 'completed exact quarantine replays after expiry');
    const retainedDrift = join(receipt.projectionQuarantinePath, 'post-response-drift.txt');
    writeFileSync(retainedDrift, 'retain me\n');
    await assert.rejects(executeWorktreeCleanup({ ...fixture.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest },
    cleanupOptions(fixture)),
    (error) => error.reason === 'blocked-cleanup-retained-artifact');
    assert.equal(existsSync(retainedDrift), true);
  });

test('cleanup fails before effects on retain-only policy, inventory drift, bounds, or wrong authority',
  async (t) => {
    const retained = await lifecycle(t, { quarantine: false });
    await assert.rejects(assessWorktreeCleanupEligibility(retained.input,
      cleanupOptions(retained)), /does not opt in/u);
    assert.equal(existsSync(retained.repo.target), true);

    const wrongAdapter = await lifecycle(t, {
      repositoryAdapter: { id: 'fixture-not-git', version: '1' },
    });
    await assert.rejects(assessWorktreeCleanupEligibility(wrongAdapter.input,
      cleanupOptions(wrongAdapter)), /does not opt in/u);
    assert.equal(existsSync(wrongAdapter.repo.target), true);

    const drifted = await lifecycle(t);
    writeFileSync(join(drifted.repo.target, 'late-owner-byte.txt'), 'late\n');
    await assert.rejects(assessWorktreeCleanupEligibility(drifted.input,
      cleanupOptions(drifted)), /inventory changed|unbound/u);
    assert.equal(existsSync(drifted.repo.target), true);

    const bounded = await lifecycle(t, { projectionByteCeiling: 1024 });
    await assert.rejects(assessWorktreeCleanupEligibility(bounded.input,
      cleanupOptions(bounded)), /byte ceiling/u);
    assert.equal(existsSync(bounded.repo.target), true);

    const authorized = await lifecycle(t), eligibility = await assessWorktreeCleanupEligibility(
      authorized.input, cleanupOptions(authorized));
    await assert.rejects(executeWorktreeCleanup({ ...authorized.input, eligibility,
      authorizationDigest: hash('f') }, cleanupOptions(authorized)),
    /exact cleanup authorization/u);
    await assert.rejects(executeWorktreeCleanup({ ...authorized.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest }, {
      ...cleanupOptions(authorized), now: () => Date.parse('2026-09-02T00:55:00.000Z'),
    }), /not current/u);
    assert.equal(existsSync(authorized.repo.target), true);
    assert.equal(existsSync(join(git(authorized.repo.root, 'rev-parse', '--path-format=absolute',
      '--git-common-dir'), 'agentic-os-cleanup-quarantine')), false,
    'expiry sampled after reobservation creates no quarantine journal or rename');
    const common = git(authorized.repo.root, 'rev-parse', '--path-format=absolute',
      '--git-common-dir');
    writeFileSync(join(common, 'ORIG_HEAD'), `${authorized.repo.head}\n`);
    await assert.rejects(executeWorktreeCleanup({ ...authorized.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest },
    cleanupOptions(authorized)), /target changed/u);
    assert.equal(existsSync(authorized.repo.target), true);
  });

test('cleanup rejects canonical targets, alternate object stores, and cross-target integration',
  async (t) => {
    const canonical = await lifecycle(t, { canonicalTarget: true });
    await assert.rejects(assessWorktreeCleanupEligibility(canonical.input,
      cleanupOptions(canonical)), /canonical worktree projection/u);
    assert.equal(existsSync(canonical.repo.target), true);

    const alternate = await lifecycle(t);
    const common = git(alternate.repo.root, 'rev-parse', '--path-format=absolute',
      '--git-common-dir');
    const alternateObjects = join(alternate.repo.parent, 'alternate-objects');
    mkdirSync(alternateObjects);
    writeFileSync(join(common, 'objects', 'info', 'alternates'), `${alternateObjects}\n`);
    await assert.rejects(assessWorktreeCleanupEligibility(alternate.input,
      cleanupOptions(alternate)), /alternate object stores/u);
    assert.equal(existsSync(alternate.repo.target), true);

    const crossed = await lifecycle(t);
    const foreignSource = JSON.parse(crossed.input.integrationPlanBytes.toString('utf8'));
    delete foreignSource.planDigest;
    foreignSource.target.resource = 'review:github.com/example/repository/pull/other';
    foreignSource.candidateDigest = hash('9');
    const foreignPlan = createEffectPlan(foreignSource);
    const foreignBytes = encodeEffectPlan(foreignPlan);
    const foreignReceipt = await transitionReceipt(foreignPlan, hash('9'));
    const cleanupSource = JSON.parse(JSON.stringify(crossed.input.plan));
    delete cleanupSource.planDigest;
    cleanupSource.integrationReceiptDigest = foreignReceipt.receiptDigest;
    cleanupSource.integrationPlanByteDigest = effectPlanByteDigest(foreignBytes);
    const crossedPlan = createWorktreeCleanupPlan(cleanupSource);
    await assert.rejects(assessWorktreeCleanupEligibility({ ...crossed.input,
      plan: crossedPlan, integrationReceipt: foreignReceipt, integrationPlanBytes: foreignBytes,
    }, cleanupOptions(crossed)), /exact authenticated integration/u);
    assert.equal(existsSync(crossed.repo.target), true);
  });

test('cleanup requires live provider replay and retains partial quarantine coordinates', async (t) => {
  const unauthenticated = await lifecycle(t);
  await assert.rejects(assessWorktreeCleanupEligibility(unauthenticated.input, {
    cwd: unauthenticated.repo.root, now: () => NOW,
  }), /live integration and retirement provider/u);
  const eligibility = await assessWorktreeCleanupEligibility(unauthenticated.input,
    cleanupOptions(unauthenticated));
  const forgedVerifier = async (value) => ({
    ...await unauthenticated.verification.verifyIntegrationAuthority(value),
    providerRecordDigest: hash('9'),
  });
  await assert.rejects(executeWorktreeCleanup({ ...unauthenticated.input, eligibility,
    authorizationDigest: eligibility.eligibilityDigest }, cleanupOptions(unauthenticated, {
    verifyIntegrationAuthority: forgedVerifier,
  })), /live immutable provider winners/u);
  assert.equal(existsSync(unauthenticated.repo.target), true);
  const { receiptDigest: omittedEvidenceDigest, ...evidenceSource }
    = unauthenticated.input.preservationReceipt;
  assert.match(omittedEvidenceDigest, /^[0-9a-f]{64}$/u);
  const reminted = createCleanupEvidenceReceipt({ ...evidenceSource, archiveDigest: hash('9') });
  await assert.rejects(assessWorktreeCleanupEligibility({ ...unauthenticated.input,
    preservationReceipt: reminted }, cleanupOptions(unauthenticated)), /preservation evidence/u);

  for (const projectionOnly of [false, true]) {
    const fixture = await lifecycle(t);
    const eligible = await assessWorktreeCleanupEligibility(fixture.input, cleanupOptions(fixture));
    const common = git(fixture.repo.root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const root = join(common, 'agentic-os-cleanup-quarantine');
    const operation = join(root, fixture.input.plan.planDigest);
    mkdirSync(root, { mode: 0o700 }); mkdirSync(operation, { mode: 0o700 });
    writeFileSync(join(operation, 'operation.json'), canonicalJson({
      schema: 'agentic-os/worktree-quarantine-operation/v1', eligibility: eligible,
      executedAt: '2026-09-02T00:40:00.000Z',
    }), { mode: 0o600 });
    if (projectionOnly) renameSync(fixture.repo.target, join(operation, 'projection'));
    await assert.rejects(executeWorktreeCleanup({ ...fixture.input, eligibility: eligible,
      authorizationDigest: eligible.eligibilityDigest }, cleanupOptions(fixture)),
    (error) => error.reason === 'blocked-cleanup-retained-artifact');
    assert.equal(existsSync(operation), true);
    assert.equal(existsSync(fixture.repo.target), !projectionOnly);
  }
});

test('post-eligibility canonical, peer, ref, or object drift retains the exact target', async (t) => {
  const cases = [
    ['canonical profile', (fixture) => {
      writeProfile(fixture.repo.root, false);
      git(fixture.repo.root, 'add', '.agentic-os.json');
      git(fixture.repo.root, 'commit', '--quiet', '--message', 'late profile drift');
    }],
    ['peer admin', (fixture) => git(fixture.repo.root, 'worktree', 'add', '--quiet', '-b',
      `agent/device/late-${Date.now()}`, join(fixture.repo.parent, 'late-peer'), 'main')],
    ['shared ref', (fixture) => git(fixture.repo.root, 'update-ref',
      'refs/heads/late-proof', fixture.repo.head)],
    ['object store', (fixture) => execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: fixture.repo.root, input: 'late unreachable object\n' })],
  ];
  for (const [label, mutate] of cases) {
    const fixture = await lifecycle(t);
    const eligibility = await assessWorktreeCleanupEligibility(fixture.input,
      cleanupOptions(fixture));
    mutate(fixture);
    await assert.rejects(executeWorktreeCleanup({ ...fixture.input, eligibility,
      authorizationDigest: eligibility.eligibilityDigest }, cleanupOptions(fixture)),
    /changed|drift/u, label);
    assert.equal(existsSync(fixture.repo.target), true, label);
  }
});

test('evidence and receipt records reject unpreserved value and invented destructive effects', () => {
  assert.throws(() => createCleanupEvidenceReceipt({ kind: 'no-remaining-value',
    repository: 'github.com/example/repository', targetPath: '/tmp/exact-target',
    candidateDigest: hash('a'), snapshotDigest: hash('b'), integrationReceiptDigest: hash('c'),
    recoveryInventoryDigest: hash('d'), recoveryInventoryContentEntries: 7_270,
    ownerStateDigest: hash('e'), archiveDigest: hash('f'), preservationComplete: null,
    reachableFromRetainedRefs: false, unpreservedValueCount: 1 }), /claim is invalid/u);
  assert.throws(() => createWorktreeCleanupPlan({ repository: 'github.com/example/repository',
    targetPath: '/tmp/exact-target', expectedBranch: 'agent/device/dirty',
    expectedHeadRevision: 'a'.repeat(40), expectedCanonicalRef: 'refs/heads/main',
    expectedCanonicalRevision: 'b'.repeat(40), integratedResource: 'review:example/7',
    integratedImmutableRevision: 'c'.repeat(40), candidateDigest: hash('a'),
    snapshotDigest: hash('b'), integrationProofDigest: hash('3'), profileDigest: hash('c'),
    recoveryInventoryDigest: hash('d'), recoveryInventoryContentEntries: 7_270,
    ownerStateDigest: hash('e'), integrationReceiptDigest: hash('f'),
    integrationPlanByteDigest: hash('0'), integrationPredecessorDigest: hash('9'),
    preservationReceiptDigest: hash('1'), noRemainingValueReceiptDigest: hash('2'),
    projectionByteCeiling: 1024, projectionEntryCeiling: 10,
    registrationByteCeiling: 1024, registrationEntryCeiling: 10,
    sharedStateByteCeiling: 1024, sharedStateEntryCeiling: 10,
    authorizedEffects: [...CLEANUP_EFFECTS, 'delete-ref'], retainedEffects: RETAINED_EFFECTS,
    expiresAt: '2026-09-02T01:00:00.000Z' }), /closed effect set/u);
});
