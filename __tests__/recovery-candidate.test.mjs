import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import {
  RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
  RECOVERY_CANDIDATE_SCHEMA,
  RECOVERY_WORKING_STATE_SCHEMA,
  createRecoveryCandidate,
  deriveRecoveryWorkingStateDigest,
  validateRecoveryCandidate,
} from '../src/recovery-candidate.mjs';

const digest = (character) => character.repeat(64);

function observation(overrides = {}) {
  return {
    targetRepository: 'github.com/example/recovery-target',
    branch: 'agent/device/recovery-candidate',
    canonicalBranch: 'main',
    headRevision: 'a'.repeat(40),
    canonicalRevision: 'b'.repeat(40),
    reviewLocator: 'https://example.invalid/reviews/42',
    predecessorEvidenceDigest: digest('c'),
    inventoryAlgorithm: RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
    inventoryEntries: {
      index: 7,
      tracked: 7,
      visibleUntracked: 0,
      hidden: 0,
      ignoredRuntime: 0,
      content: 7,
    },
    indexInventoryDigest: digest('2'),
    trackedInventoryDigest: digest('d'),
    visibleUntrackedInventoryDigest: digest('e'),
    hiddenInventoryDigest: digest('f'),
    ignoredRuntimeInventoryDigest: digest('0'),
    contentInventoryDigest: digest('1'),
    observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
    ...overrides,
  };
}

test('creates a portable canonical record that binds every observation digest', () => {
  const candidate = createRecoveryCandidate(observation());
  assert.equal(candidate.schema, RECOVERY_CANDIDATE_SCHEMA);
  assert.equal(RECOVERY_WORKING_STATE_SCHEMA, 'agentic-os/recovery-working-state/v1');
  assert.equal(candidate.inventoryAlgorithm, RECOVERY_CANDIDATE_INVENTORY_ALGORITHM);
  assert.equal(candidate.canonicalBranch, 'main');
  assert.deepEqual(candidate.inventoryEntries, {
    index: 7,
    tracked: 7,
    visibleUntracked: 0,
    hidden: 0,
    ignoredRuntime: 0,
    content: 7,
  });
  assert.equal(candidate.indexInventoryDigest, digest('2'));
  assert.equal(candidate.contentInventoryDigest, digest('1'));
  assert.equal(candidate.workingStateDigest,
    'f23c6c29842380f0323582308b93dd35430d6f567947f9f9d03fd1415b300417');
  assert.equal(deriveRecoveryWorkingStateDigest(candidate), candidate.workingStateDigest);
  assert.equal(candidate.candidateDigest,
    '0dae58988a98739cfa3b30fde4cac6534f477e1985b65da2ff9964a9454d412f');
  const { candidateDigest, ...payload } = candidate;
  assert.equal(candidateDigest, governanceDigest(payload));
  assert.deepEqual(validateRecoveryCandidate(candidate), candidate);
  assert.equal(Object.isFrozen(candidate), true);
});

test('candidate identity changes for any bound inventory, revision, review, or predecessor fact', () => {
  const candidate = createRecoveryCandidate(observation());
  for (const [field, value] of [
    ['headRevision', '4'.repeat(40)],
    ['canonicalRevision', '5'.repeat(40)],
    ['canonicalBranch', 'trunk'],
    ['reviewLocator', null],
    ['predecessorEvidenceDigest', digest('6')],
    ['indexInventoryDigest', digest('3')],
    ['trackedInventoryDigest', digest('7')],
    ['visibleUntrackedInventoryDigest', digest('8')],
    ['hiddenInventoryDigest', digest('9')],
    ['ignoredRuntimeInventoryDigest', digest('a')],
    ['contentInventoryDigest', digest('b')],
    ['inventoryEntries', { ...observation().inventoryEntries, index: 8 }],
  ]) {
    const changed = createRecoveryCandidate(observation({ [field]: value }));
    assert.notEqual(changed.candidateDigest, candidate.candidateDigest, field);
  }
});

test('records reject absolute paths, raw content, invalid counts, and malformed identifiers', () => {
  assert.throws(() => createRecoveryCandidate(observation({
    targetRepository: '/private/tmp/recovery-target',
  })), /absolute filesystem location/);
  assert.throws(() => createRecoveryCandidate(observation({ reviewLocator: 'file:///private/review' })),
  /absolute filesystem location/);
  assert.throws(() => createRecoveryCandidate(observation({ reviewLocator: '\\private\\review' })),
  /absolute filesystem location/);
  assert.throws(() => createRecoveryCandidate(observation({
    inventoryAlgorithm: 'example/inventory/v1',
  })), /inventoryAlgorithm is unsupported/);
  assert.throws(() => createRecoveryCandidate(observation({
    inventoryEntries: { ...observation().inventoryEntries, tracked: -1 },
  })), /inventoryEntries.tracked must be a non-negative safe integer/);
  assert.throws(() => createRecoveryCandidate(observation({
    inventoryEntries: { ...observation().inventoryEntries, content: 8 },
  })), /content must equal/);
  assert.throws(() => createRecoveryCandidate(observation({
    inventoryEntries: { ...observation().inventoryEntries, hidden: 8 },
  })), /hidden must not exceed tracked/);
  assert.throws(() => createRecoveryCandidate(observation({
    inventoryEntries: { ...observation().inventoryEntries, index: 6 },
  })), /index must not be less than tracked/);
  assert.throws(() => createRecoveryCandidate(observation({
    inventoryEntries: { ...observation().inventoryEntries, authoredBytes: 1 },
  })), /inventoryEntries fields are invalid/);
  assert.throws(() => createRecoveryCandidate(observation({
    contentInventoryDigest: 'not-a-digest',
  })), /contentInventoryDigest/);
  assert.throws(() => createRecoveryCandidate(observation({
    indexInventoryDigest: 'not-a-digest',
  })), /indexInventoryDigest/);
  assert.throws(() => createRecoveryCandidate(observation({
    contentEntries: 7,
  })), /fields are invalid/);
  assert.throws(() => createRecoveryCandidate(observation({ branch: 'refs/heads/main' })),
  /portable short Git branch/);
  assert.throws(() => createRecoveryCandidate(observation({ canonicalBranch: 'refs/heads/main' })),
  /canonicalBranch must be a portable short Git branch/);
  const missingCanonicalBranch = observation();
  delete missingCanonicalBranch.canonicalBranch;
  assert.throws(() => createRecoveryCandidate(missingCanonicalBranch), /fields are invalid/);
  assert.throws(() => createRecoveryCandidate(observation({ headRevision: 'HEAD' })),
  /object identifier/);
  assert.throws(() => createRecoveryCandidate(observation({
    headRevision: 'a'.repeat(64), canonicalRevision: 'b'.repeat(40),
  })), /one object identifier format/);
});

test('received records fail closed on added fields, mismatched digests, invalid time windows, and accessors', () => {
  const candidate = createRecoveryCandidate(observation());
  assert.throws(() => validateRecoveryCandidate({ ...candidate, authoredBytes: 'never' }),
    /fields are invalid/);
  assert.throws(() => validateRecoveryCandidate({ ...candidate, candidateDigest: digest('0') }),
    /candidateDigest/);
  assert.throws(() => createRecoveryCandidate(observation({ workingStateDigest: digest('0') })),
    /workingStateDigest does not match/);
  assert.throws(() => createRecoveryCandidate(observation({
    expiresAt: '2026-09-02T00:00:00.000Z',
  })), /expiresAt must be after/);

  let read = false;
  const accessor = observation();
  Object.defineProperty(accessor, 'targetRepository', {
    enumerable: true,
    get() { read = true; throw new Error('must not execute'); },
  });
  assert.throws(() => createRecoveryCandidate(accessor));
  assert.equal(read, false);

  const proxy = new Proxy(observation(), {});
  assert.throws(() => createRecoveryCandidate(proxy));
  assert.equal(canonicalJson(candidate), canonicalJson(validateRecoveryCandidate(candidate)));
});
