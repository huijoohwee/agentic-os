import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson } from '../src/governance.mjs';
import {
  CURRENT_QUARANTINE_RECONCILIATION_SCHEMA,
  createCurrentQuarantineReconciliation,
  validateCurrentQuarantineReconciliation,
} from '../src/cleanup-records.mjs';

const hex = value => value.repeat(64).slice(0, 64);
const revision = value => value.repeat(40).slice(0, 40);
const basis = () => ({ schema: CURRENT_QUARANTINE_RECONCILIATION_SCHEMA,
  repository: 'github.com/example/retained', reviewLocator: 'https://github.com/example/retained/pull/7',
  targetRef: 'agent/device/retained', targetHead: revision('a'), merge: revision('b'),
  quarantineCoordinate: hex('c'), originalReceiptDigest: hex('d'),
  originalRegistrationManifest: { digest: hex('e'), bytes: 36889, entries: 15 },
  currentRegistrationManifest: { digest: hex('f'), bytes: 36963, entries: 15 },
  historicalQuarantineAuthorityProven: false, historicalRegistrationManifestProven: false,
  registrationMutationCauseProven: false, physicalCleanupPerformed: false,
  providerAuthority: false, claimRetired: false });

test('current retained-index reconciliation is canonical and binds both manifests', () => {
  const created = createCurrentQuarantineReconciliation(basis());
  assert.equal(created.schema, CURRENT_QUARANTINE_RECONCILIATION_SCHEMA);
  assert.equal(created.basisDigest.length, 64);
  assert.deepEqual(validateCurrentQuarantineReconciliation(created), created);
  assert.equal(Object.isFrozen(created.originalRegistrationManifest), true);
});

test('current retained-index reconciliation rejects equivalence and upgraded claims', () => {
  const created = createCurrentQuarantineReconciliation(basis());
  const unsigned = structuredClone(created); delete unsigned.basisDigest;
  for (const changed of [
    { ...unsigned, currentRegistrationManifest: structuredClone(unsigned.originalRegistrationManifest) },
    { ...unsigned, registrationMutationCauseProven: true },
    { ...unsigned, physicalCleanupPerformed: true },
  ]) assert.throws(() => createCurrentQuarantineReconciliation(changed),
    /reconciliation claims are invalid/u);
  const noncanonical = { ...created, originalReceiptDigest: hex('0') };
  assert.throws(() => validateCurrentQuarantineReconciliation(noncanonical),
    /reconciliation.*canonical|basisDigest|reconciliation digest/u);
  assert.equal(canonicalJson(created).includes('registrationMutationCauseProven'), true);
});
