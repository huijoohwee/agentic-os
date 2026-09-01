import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim, governanceDigest } from '../src/governance.mjs';
import {
  EXTERNAL_AUTHORITY_EVIDENCE_SCHEMA,
  createExternalAuthorityEvidence,
  createExternalAuthorityReplayKey,
  deriveExternalAuthorityReplayKey,
  isEvidenceBoundToRequest,
  validateExternalAuthorityEvidence,
} from '../src/authority-record.mjs';

const DIGESTS = Object.freeze({
  providerRecordDigest: 'a'.repeat(64),
  challengeDigest: 'b'.repeat(64),
  responseDigest: 'c'.repeat(64),
  candidateInventoryDigest: 'd'.repeat(64),
});

function request(overrides = {}) {
  return claim({
    repository: 'github.com/example/repository',
    authoritySubject: 'github-user:42',
    ownerSubject: 'legacy-claim:fixture',
    scope: ['recovery:fixture'],
    immutableRevision: 'candidate:sha256:fixture',
    observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
    ...overrides,
  });
}

function input(overrides = {}) {
  return {
    adapter: { id: 'github', version: '1' },
    authenticatedSubject: 'github-user:42',
    providerRecordLocator: 'https://github.example/runs/42',
    ...DIGESTS,
    issuedAt: '2026-09-02T00:10:00.000Z',
    expiresAt: '2026-09-02T00:50:00.000Z',
    ...overrides,
  };
}

function rehash(evidence, overrides = {}) {
  const { evidenceDigest: ignored, ...payload } = { ...evidence, ...overrides };
  return { ...payload, evidenceDigest: governanceDigest(payload) };
}

test('External Authority Evidence is deterministic, exact, and request-bound', () => {
  const source = request();
  const evidence = createExternalAuthorityEvidence(source, input());
  assert.equal(evidence.schema, EXTERNAL_AUTHORITY_EVIDENCE_SCHEMA);
  assert.equal(evidence.requestDigest, source.requestDigest);
  assert.equal(evidence.authenticatedSubject, source.authoritySubject);
  assert.equal(evidence.replayKey, deriveExternalAuthorityReplayKey(source, input()));
  assert.equal(evidence.replayKey, createExternalAuthorityReplayKey(source, input()));
  assert.deepEqual(validateExternalAuthorityEvidence(source, evidence), evidence);
  assert.equal(isEvidenceBoundToRequest(source, evidence), true);

  const repeated = createExternalAuthorityEvidence(source, {
    ...input(),
    requestDigest: source.requestDigest,
    replayKey: evidence.replayKey,
    evidenceDigest: evidence.evidenceDigest,
  });
  assert.deepEqual(repeated, evidence);
});

test('External Authority Evidence rejects unknown, accessor, alias, and noncanonical input', () => {
  const source = request();
  const evidence = createExternalAuthorityEvidence(source, input());
  assert.throws(() => validateExternalAuthorityEvidence(source, { ...evidence, unexpected: true }),
    /fields are invalid/u);

  let getterCalled = false;
  const accessor = { ...evidence };
  Object.defineProperty(accessor, 'providerRecordLocator', { enumerable: true, get() {
    getterCalled = true;
    throw new Error('must not execute');
  } });
  assert.throws(() => validateExternalAuthorityEvidence(source, accessor), /accessors/u);
  assert.equal(getterCalled, false);

  const shared = { id: 'github', version: '1' };
  assert.throws(() => createExternalAuthorityEvidence(source, input({
    adapter: shared,
    providerRecordLocator: shared,
  })), /alias/u);

  assert.throws(() => validateExternalAuthorityEvidence(source, rehash(evidence, {
    issuedAt: '2026-09-02T00:10:00Z',
  })), /exact UTC instant/u);
});

test('External Authority Evidence rejects digest, time, subject, and replay drift', () => {
  const source = request();
  const evidence = createExternalAuthorityEvidence(source, input());
  assert.throws(() => validateExternalAuthorityEvidence(source, {
    ...evidence, challengeDigest: 'B'.repeat(64),
  }), /challengeDigest/u);
  assert.throws(() => validateExternalAuthorityEvidence(source, rehash(evidence, {
    issuedAt: '2026-09-01T23:59:59.999Z',
  })), /nested/u);
  assert.throws(() => validateExternalAuthorityEvidence(source, rehash(evidence, {
    expiresAt: '2026-09-02T01:00:00.001Z',
  })), /nested/u);
  assert.throws(() => validateExternalAuthorityEvidence(source, rehash(evidence, {
    expiresAt: evidence.issuedAt,
  })), /after issuedAt/u);
  assert.throws(() => validateExternalAuthorityEvidence(source, rehash(evidence, {
    authenticatedSubject: 'github-user:other',
  })), /authoritySubject/u);
  assert.throws(() => validateExternalAuthorityEvidence(source, rehash(evidence, {
    replayKey: 'e'.repeat(64),
  })), /replayKey/u);
});

test('External Authority Evidence fails closed for another request or invalid evidence', () => {
  const source = request();
  const evidence = createExternalAuthorityEvidence(source, input());
  const other = request({ scope: ['recovery:other'] });
  assert.equal(isEvidenceBoundToRequest(other, evidence), false);
  assert.equal(isEvidenceBoundToRequest(source, { ...evidence, evidenceDigest: '0'.repeat(64) }), false);
});
