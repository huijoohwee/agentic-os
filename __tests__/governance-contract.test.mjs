import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_TRANSITION_RECEIPT_SCHEMA,
  COORDINATION_REQUEST_SCHEMA,
  CONSUMER_AUTHORITY,
  REPOSITORY_PROFILE_SCHEMA,
  RETAIN_ALL_CLEANUP,
  canonicalJson,
  claim,
  continue as continueRequest,
  createAuthorityTransitionReceiptEnvelope,
  createRepositoryProfile,
  findExactReplay,
  governance,
  governanceDigest,
  integrate,
  isExactReplay,
  retire,
  validateAuthorityTransitionReceiptEnvelope,
  validateCoordinationRequest,
  validateRepositoryProfile,
} from '../src/governance.mjs';

const FENCE = 'f'.repeat(64);
const NEXT_FENCE = 'e'.repeat(64);
const OPERATION_RECEIPT = 'd'.repeat(64);
const EFFECT_PLAN = `effect-plan:sha256:${'c'.repeat(64)}`;
const base = (overrides = {}) => ({
  repository: 'repo:fixture',
  authoritySubject: 'feature:checkout',
  ownerSubject: 'actor:fixture',
  scope: ['src/z.mjs', 'src/a.mjs'],
  immutableRevision: 'a'.repeat(40),
  observedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-09-01T01:00:00.000Z',
  ...overrides,
});
const outcome = (request, overrides = {}) => ({
  resultClaimId: request.claimId,
  resultLeaseEpoch: request.requestedTransition === 'claim'
    ? request.leaseEpoch : request.leaseEpoch + 1,
  resultFenceRevision: NEXT_FENCE,
  resultState: request.requestedTransition === 'integrate' ? 'integrated'
    : request.requestedTransition === 'retire' ? 'retired' : 'current',
  operationReceiptDigest: OPERATION_RECEIPT,
  transitionedAt: '2026-09-01T00:30:00.000Z',
  ...overrides,
});

test('canonical JSON and digests are deterministic, bounded JSON data', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, x: null } }),
    canonicalJson({ a: { x: null, y: true }, z: 1 }));
  assert.equal(governanceDigest({ z: 1, a: 2 }), governanceDigest({ a: 2, z: 1 }));
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite/);
  assert.throws(() => canonicalJson(new Proxy({}, {})), /JSON data/);
});

test('canonical JSON bounds sparse shape, raw strings, and keys without invoking accessors', () => {
  const sparse = [];
  sparse.length = 1_000_000_000;
  assert.throws(() => canonicalJson(sparse), /node budget/);

  let getterCalled = false;
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() {
    getterCalled = true;
    throw new Error('must not execute');
  } });
  assert.throws(() => canonicalJson(accessor), /accessors/);
  assert.equal(getterCalled, false);

  assert.throws(() => canonicalJson('x'.repeat(500_001)), /byte budget/);
  assert.throws(() => canonicalJson({ ['x'.repeat(500_001)]: true }), /byte budget/);
  assert.throws(() => canonicalJson(new Array(5_000).fill('x'.repeat(101))), /byte budget/);

  const aggregateKeys = Object.create(null);
  for (let index = 0; index < 6_000; index += 1)
    aggregateKeys[`k${String(index).padStart(4, '0')}${'x'.repeat(90)}`] = true;
  assert.throws(() => canonicalJson(aggregateKeys), /byte budget/);

  const excessiveKeys = Object.create(null);
  for (let index = 0; index < 10_001; index += 1) excessiveKeys[`k${index}`] = true;
  assert.throws(() => canonicalJson(excessiveKeys), /node budget/);
});

test('four root operations create exact canonical Coordination Requests', () => {
  const initial = claim(base());
  assert.equal(initial.schema, COORDINATION_REQUEST_SCHEMA);
  assert.deepEqual(initial.scope, ['src/a.mjs', 'src/z.mjs']);
  assert.equal(initial.fenceRevision, null);
  assert.equal(Object.hasOwn(initial, 'cleanup'), false);
  assert.deepEqual(Object.keys(governance), ['claim', 'continue', 'integrate', 'retire']);
  assert.equal(governance.claim, claim);
  assert.deepEqual(validateCoordinationRequest(initial), initial);
  assert.equal(continueRequest(base({ fenceRevision: FENCE })).requestedTransition, 'continue');
  assert.equal(integrate(base({ fenceRevision: FENCE })).requestedTransition, 'integrate');
  assert.throws(() => claim(base({ fenceRevision: FENCE })), /source fence/);
  assert.equal(retire(base({ fenceRevision: FENCE, dependentWork: [EFFECT_PLAN] }))
    .requestedTransition, 'retire');
  assert.throws(() => retire(base({ fenceRevision: FENCE })), /effect-plan/);
  assert.throws(() => retire(base({
    fenceRevision: FENCE,
    dependentWork: [`effect-plan:sha256:${'A'.repeat(64)}`],
  })), /effect-plan/);
});

test('validators reject repaired schemas and noncanonical wire shapes', () => {
  const request = claim(base());
  assert.throws(() => validateCoordinationRequest({ ...request, schema: 'evil' }), /schema/);
  assert.throws(() => validateCoordinationRequest({
    ...request,
    scope: [...request.scope].reverse(),
  }), /not canonical/);

  const profile = createRepositoryProfile({
    repository: 'repo:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    capabilities: ['deep-byte-audit-opt-in', 'retain-all-cleanup'],
  });
  assert.throws(() => validateRepositoryProfile({ ...profile, schema: 'evil' }), /schema/);
  assert.throws(() => validateRepositoryProfile({
    ...profile,
    capabilities: ['retain-all-cleanup', 'deep-byte-audit-opt-in'],
  }), /not canonical/);
  assert.throws(() => createRepositoryProfile({
    repository: 'repo:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    capabilities: ['future-capability'],
  }), /unsupported repository profile capabilities/u);
  for (const selected of [
    { capabilities: ['read-only-review-observation'] },
    { requiredChecks: ['test'] },
  ]) assert.throws(() => createRepositoryProfile({
    repository: 'repo:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    ...selected,
  }), /require a provider adapter/u);
});

test('repository profiles preserve consumer authority and truthful cleanup capabilities', () => {
  const profile = createRepositoryProfile({
    schema: REPOSITORY_PROFILE_SCHEMA,
    repository: 'repo:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    capabilities: ['read-only-review-observation', 'read-only-repository-observation'],
    requiredChecks: ['test'],
  });
  assert.deepEqual(profile.authority, CONSUMER_AUTHORITY);
  assert.deepEqual(profile.cleanup, RETAIN_ALL_CLEANUP);
  assert.deepEqual(validateRepositoryProfile(profile), profile);
  const { profileDigest, ...profilePayload } = profile;
  assert.throws(() => createRepositoryProfile({
    ...profilePayload,
    authority: { runtime: 'adapter', release: 'consumer' },
  }), /consumer-owned/);
  assert.throws(() => createRepositoryProfile({
    ...profilePayload,
    cleanup: { ...RETAIN_ALL_CLEANUP, localBranch: 'delete' },
  }), /unsupported effect/);
  const quarantine = createRepositoryProfile({ ...profilePayload,
    capabilities: profilePayload.capabilities.filter((entry) => entry !== 'retain-all-cleanup'),
    cleanup: { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } });
  assert.equal(quarantine.capabilities.includes('retain-all-cleanup'), false);
  assert.equal(quarantine.capabilities.includes('quarantine-worktree-cleanup-opt-in'), true);
  assert.equal(quarantine.cleanup.worktreeProjection, 'quarantine');
  assert.throws(() => createRepositoryProfile({ ...profilePayload,
    cleanup: { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine' } }),
  /exact projection and registration/u);
  assert.throws(() => createRepositoryProfile({ ...profilePayload,
    cleanup: { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } }), /capability conflicts/u);
  assert.throws(() => createRepositoryProfile({ ...profilePayload,
    capabilities: [...profilePayload.capabilities, 'quarantine-worktree-cleanup-opt-in'] }),
  /capability conflicts/u);
});

test('repository profiles reject malformed canonical Git refs before adapter access', () => {
  const baseProfile = {
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  };
  for (const branch of ['main..other', 'main@{1}', 'release.lock', '.hidden', 'bad?name']) {
    assert.throws(() => createRepositoryProfile({
      ...baseProfile,
      canonical: {
        localRef: `refs/heads/${branch}`,
        remoteRef: `refs/remotes/origin/${branch}`,
      },
    }), /portable direct Git ref/u);
  }
  for (const remote of ['bad remote', 'a..b', 'a.', 'a.lock']) {
    assert.throws(() => createRepositoryProfile({
      ...baseProfile,
      canonical: { localRef: 'refs/heads/main', remoteRef: `refs/remotes/${remote}/main` },
    }), /portable configured remote/u);
  }
});

test('receipts bind exact requests, time windows, identities, and monotonic transitions', () => {
  const request = claim(base());
  const receipt = createAuthorityTransitionReceiptEnvelope(request, outcome(request));
  assert.equal(receipt.schema, AUTHORITY_TRANSITION_RECEIPT_SCHEMA);
  assert.deepEqual(validateAuthorityTransitionReceiptEnvelope(receipt), receipt);
  assert.equal(isExactReplay(request, receipt), true);
  assert.deepEqual(findExactReplay(request, [receipt, receipt]), receipt);
  assert.throws(() => createAuthorityTransitionReceiptEnvelope(request, outcome(request, {
    resultClaimId: '0'.repeat(64),
  })), /claim identity/);
  assert.throws(() => createAuthorityTransitionReceiptEnvelope(request, outcome(request, {
    resultLeaseEpoch: request.leaseEpoch + 1,
  })), /does not advance/);
  assert.throws(() => createAuthorityTransitionReceiptEnvelope(request, outcome(request, {
    transitionedAt: request.expiresAt.replace('01:00', '02:00'),
  })), /validity window/);

  const continued = continueRequest(base({ fenceRevision: FENCE, leaseEpoch: 4 }));
  const continuedReceipt = createAuthorityTransitionReceiptEnvelope(continued, outcome(continued));
  assert.equal(isExactReplay(continued, continuedReceipt), true);
  assert.throws(() => createAuthorityTransitionReceiptEnvelope(continued, outcome(continued, {
    resultFenceRevision: FENCE,
  })), /must advance/);
});

test('exact replay bounds its dense aggregate without rejecting identical duplicates', () => {
  const request = claim(base());
  const receipt = createAuthorityTransitionReceiptEnvelope(request, outcome(request));
  assert.deepEqual(findExactReplay(request, [receipt, receipt]), receipt);

  const sparse = [];
  sparse.length = 1_000_000_000;
  assert.throws(() => findExactReplay(request, sparse), /node budget/);

  let getterCalled = false;
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() {
    getterCalled = true;
    return receipt;
  } });
  assert.throws(() => findExactReplay(request, accessor), /accessors/);
  assert.equal(getterCalled, false);
  assert.throws(() => findExactReplay(request, new Array(600).fill(receipt)), /node budget/);

  const largeRequest = claim(base({ repository: 'r'.repeat(4_096) }));
  const largeReceipt = createAuthorityTransitionReceiptEnvelope(largeRequest, outcome(largeRequest));
  assert.throws(() => findExactReplay(
    largeRequest,
    new Array(126).fill(largeReceipt),
  ), /byte budget/);
});

test('exact replay rejects structurally valid but request-inapplicable receipts', () => {
  const request = claim(base());
  const receipt = createAuthorityTransitionReceiptEnvelope(request, outcome(request));
  const { receiptDigest: ignored, ...latePayload } = {
    ...receipt,
    transitionedAt: '2026-09-01T02:00:00.000Z',
  };
  const late = { ...latePayload, receiptDigest: governanceDigest(latePayload) };
  assert.doesNotThrow(() => validateAuthorityTransitionReceiptEnvelope(late));
  assert.equal(isExactReplay(request, late), false);
  assert.throws(() => findExactReplay(request, [late]), /conflicting receipts/);

  const evil = { ...receipt, schema: 'evil' };
  const { receiptDigest: prior, ...evilPayload } = evil;
  evil.receiptDigest = governanceDigest(evilPayload);
  assert.throws(() => validateAuthorityTransitionReceiptEnvelope(evil), /semantics/);
});
