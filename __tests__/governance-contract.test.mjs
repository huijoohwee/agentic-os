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
    capabilities: ['a', 'z'],
  });
  assert.throws(() => validateRepositoryProfile({ ...profile, schema: 'evil' }), /schema/);
  assert.throws(() => validateRepositoryProfile({
    ...profile,
    capabilities: ['z', 'a'],
  }), /not canonical/);
});

test('repository profiles preserve consumer authority and every cleanup target', () => {
  const profile = createRepositoryProfile({
    schema: REPOSITORY_PROFILE_SCHEMA,
    repository: 'repo:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    capabilities: ['review-projection', 'repository-observation'],
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
  }), /must retain/);
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
