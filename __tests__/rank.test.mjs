import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoundedFile } from '../src/bounded-read.mjs';
import { MAX_STRING_BYTES } from '../src/catalog-input.mjs';
import {
  FEATURE_CATALOG_SCHEMA,
  MAX_ARGUMENTS,
  MAX_CANDIDATES,
  MAX_CATALOG_BYTES,
  featureCatalogDigest,
  loadFeatureCatalog,
  validateFeatureCatalog,
} from '../src/feature-catalog.mjs';
import {
  DEMAND_EVIDENCE_SCHEMA,
  MAX_EVIDENCE_FILE_BYTES,
  demandClaimDigest,
} from '../src/feature-grounding.mjs';
import {
  CRITERIA,
  RANKING_RESULT_SCHEMA,
  dominates,
  groundedLabels,
  rankFeatures,
} from '../src/rank.mjs';

const clone = (value) => structuredClone(value);
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'agentic-os-rank-fixture-'));
writeFileSync(join(TEST_ROOT, 'README.md'), 'synthetic test evidence');
after(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

const TEST_NOW = Date.parse('2026-09-02T00:00:00.000Z');
const rankTestCatalog = (value) => rankFeatures(value, {
  root: TEST_ROOT,
  now: () => TEST_NOW,
  verifyDemandEvidence: (receipt) => ({
    verified: receipt.provider === 'fixture',
    verifier: 'fixture-verifier',
    receipt: `fixture:verification/${receipt.providerReceipt}`,
  }),
});
const validateTestCatalog = (value) => validateFeatureCatalog(value, { root: TEST_ROOT });

function candidate(id, estimates = {}) {
  const value = {
    id,
    offer: `Offer ${id}`,
    pain: {
      statement: `Pain ${id}`,
      namedProspectivePayer: 'Synthetic test payer',
      evidenceRefs: ['README.md'],
      demandEvidenceRefs: [`demand-${id}.json`],
    },
    solution: {
      statement: `Solution ${id}`,
      evidenceRefs: ['README.md'],
    },
    estimates: {
      codeDeltaLines: 1,
      firstDollarHours: 1,
      incrementalSpendUsd: 0,
      runtimeDependencies: 0,
      ...estimates,
    },
    requirements: {
      deployment: false,
      browserSurface: false,
      dependencies: [],
    },
  };
  writeFileSync(join(TEST_ROOT, `demand-${id}.json`), JSON.stringify({
    schema: DEMAND_EVIDENCE_SCHEMA,
    status: 'verified',
    provider: 'fixture',
    providerReceipt: `fixture:demand/${id}`,
    observedAt: '2026-09-01T00:00:00.000Z',
    candidate: { id, claimDigest: demandClaimDigest(value) },
    payer: 'Synthetic test payer',
    paidArtifact: 'Synthetic existing audit fixture',
    currentCost: { amount: 1, unit: 'hours' },
    acceptanceCriterion: 'The contract test receives a deterministic ranking result.',
  }));
  return value;
}

function argument(id, candidateId, role, attacks = []) {
  return {
    id,
    candidateId,
    role,
    statement: `${role} for ${candidateId}`,
    evidenceRefs: ['README.md'],
    attacks,
  };
}

function catalog(candidates, arguments_ = []) {
  const value = {
    schema: FEATURE_CATALOG_SCHEMA,
    profile: {
      maxCodeDeltaLines: 200,
      maxFirstDollarHours: 40,
      maxIncrementalSpendUsd: 0,
      maxRuntimeDependencies: 0,
      deploymentAllowed: false,
      browserSurfaceAvailable: false,
      fossOnly: true,
    },
    entryCount: candidates.length,
    digest: '',
    candidates,
    arguments: arguments_,
  };
  value.digest = featureCatalogDigest(value);
  return value;
}

function refresh(value) {
  value.entryCount = value.candidates.length;
  value.digest = featureCatalogDigest(value);
  return value;
}

function codes(result, candidateId) {
  return result.trail.constraints
    .find((item) => item.candidateId === candidateId)
    .findings.map((item) => item.code);
}

test('the seed catalog is valid and honestly has no admissible buyer-backed candidate', () => {
  const source = loadFeatureCatalog();
  assert.deepEqual(validateFeatureCatalog(source), { ok: true, findings: [] });
  assert.equal(source.entryCount, 5);
  assert.equal(source.digest, featureCatalogDigest(source));

  const result = rankFeatures(source);
  assert.equal(result.schema, RANKING_RESULT_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'no-admissible-candidate');
  assert.equal(result.selected, null);
  assert.equal(result.trail.constraints.length, 5);
  assert.ok(result.trail.constraints.every((item) => item.findings.length > 0));
  assert.deepEqual(result.trail.admitted, []);
  assert.deepEqual(result.trail.frontier, []);
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result.trail.constraints[0].findings), true);
  for (const id of ['repository-livelock-audit', 'branch-debt-cleanup', 'mcp-server']) {
    assert.ok(codes(result, id).includes('named-payer-missing'));
    assert.ok(codes(result, id).includes('demand-evidence-missing'));
  }
});

test('the command prints the full fail-closed trail and exits with the typed no-selection code', () => {
  const run = spawnSync(process.execPath, ['src/rank.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(run.status, 2, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'no-admissible-candidate');
  assert.equal(result.trail.constraints.length, 5);
});

test('catalog count, digest, shape, weighting, and numeric drift are typed', () => {
  const cases = [];
  const count = clone(loadFeatureCatalog());
  count.entryCount += 1;
  cases.push([count, 'entry-count-drift']);

  const digest = clone(loadFeatureCatalog());
  digest.candidates[0].offer = 'changed';
  cases.push([digest, 'digest-drift']);

  const weighting = clone(loadFeatureCatalog());
  weighting.candidates[0].score = 99;
  refresh(weighting);
  cases.push([weighting, 'unsupported-weighting']);

  const unknown = clone(loadFeatureCatalog());
  unknown.profile.threshold = 1;
  refresh(unknown);
  cases.push([unknown, 'field-unknown']);

  const numeric = clone(loadFeatureCatalog());
  numeric.candidates[0].estimates.codeDeltaLines = Number.NaN;
  cases.push([numeric, 'nonnegative-integer-required']);

  const invalidDigestType = clone(loadFeatureCatalog());
  invalidDigestType.digest = Number.NaN;
  cases.push([invalidDigestType, 'digest-invalid']);

  for (const [value, code] of cases) {
    const validation = validateFeatureCatalog(value);
    assert.equal(validation.ok, false, code);
    assert.ok(validation.findings.some((item) => item.code === code), code);
    assert.equal(rankFeatures(value).status, 'rejected');
  }
});

test('catalog and result are invariant to set-like input permutations', () => {
  const source = clone(loadFeatureCatalog());
  const permuted = clone(source);
  permuted.candidates.reverse();
  for (const item of permuted.candidates) {
    item.pain.evidenceRefs.reverse();
    item.solution.evidenceRefs.reverse();
  }
  assert.equal(featureCatalogDigest(source), featureCatalogDigest(permuted));
  assert.deepEqual(rankFeatures(source), rankFeatures(permuted));
});

test('evidence references cannot escape through traversal or a symlink', () => {
  const traversal = catalog([candidate('safe')]);
  traversal.candidates[0].pain.evidenceRefs = ['../outside'];
  refresh(traversal);
  assert.ok(validateTestCatalog(traversal).findings.some((item) => item.code === 'evidence-ref-invalid'));

  const absolute = catalog([candidate('absolute')]);
  absolute.candidates[0].solution.evidenceRefs = ['/etc/hosts'];
  refresh(absolute);
  assert.ok(validateTestCatalog(absolute).findings.some((item) => item.code === 'evidence-ref-invalid'));

  const root = mkdtempSync(join(tmpdir(), 'agentic-os-rank-'));
  try {
    writeFileSync(join(root, 'README.md'), 'evidence');
    mkdirSync(join(root, 'links'));
    symlinkSync('/etc/hosts', join(root, 'links', 'outside'));
    const escaped = catalog([candidate('safe')]);
    escaped.candidates[0].pain.evidenceRefs = ['links/outside'];
    refresh(escaped);
    const validation = validateFeatureCatalog(escaped, { root });
    assert.ok(validation.findings.some((item) => item.code === 'evidence-ref-invalid'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a named payer still needs a matching structured demand receipt', () => {
  const ungrounded = candidate('ungrounded');
  ungrounded.pain.demandEvidenceRefs = ['README.md'];
  const result = rankTestCatalog(catalog([ungrounded]));
  assert.equal(result.status, 'no-admissible-candidate');
  assert.ok(codes(result, 'ungrounded').includes('demand-evidence-invalid'));
});

test('self-attested, stale, and candidate-mismatched demand receipts fail closed', () => {
  const a = candidate('a');
  const source = catalog([a]);
  assert.equal(rankFeatures(source, { root: TEST_ROOT, now: () => TEST_NOW }).status,
    'no-admissible-candidate');

  const b = candidate('b');
  b.pain.demandEvidenceRefs = ['demand-a.json'];
  const mismatched = rankTestCatalog(catalog([b]));
  assert.ok(codes(mismatched, 'b').includes('demand-evidence-invalid'));

  const stale = JSON.parse(readFileSync(join(TEST_ROOT, 'demand-a.json'), 'utf8'));
  stale.observedAt = '2026-01-01T00:00:00.000Z';
  writeFileSync(join(TEST_ROOT, 'demand-a.json'), JSON.stringify(stale));
  const expired = rankTestCatalog(source);
  assert.ok(codes(expired, 'a').includes('demand-evidence-invalid'));
});

test('inherited fields and verifier-side catalog mutation cannot escape the digest fence', () => {
  const base = candidate('prototype');
  const inherited = catalog([base]);
  inherited.candidates[0] = Object.create(base);
  const inheritedValidation = validateTestCatalog(inherited);
  assert.ok(inheritedValidation.findings.some((item) => {
    return item.code === 'object-prototype-invalid';
  }));
  assert.equal(rankTestCatalog(inherited).status, 'rejected');

  const slow = catalog([candidate('callback-mutation', { firstDollarHours: 999 })]);
  const originalDigest = slow.digest;
  const result = rankFeatures(slow, {
    root: TEST_ROOT,
    now: () => TEST_NOW,
    verifyDemandEvidence: (receipt) => {
      slow.candidates[0].estimates.firstDollarHours = 1;
      slow.candidates[0].id = 'mutated-by-callback';
      assert.throws(() => { receipt.provider = 'mutated-provider'; }, TypeError);
      return {
        verified: true,
        verifier: 'mutation-fixture-verifier',
        receipt: 'fixture:verification/mutation',
      };
    },
  });
  assert.equal(result.catalogDigest, originalDigest);
  assert.equal(result.status, 'no-admissible-candidate');
  assert.ok(codes(result, 'callback-mutation').includes('time-budget-exceeded'));
  assert.equal(result.trail.constraints[0].demandVerification.provider, 'fixture');
  assert.notEqual(featureCatalogDigest(slow), originalDigest);
});

test('accessors, symbols, and over-budget property names are rejected without evaluation', () => {
  const accessor = clone(loadFeatureCatalog());
  let getterCalls = 0;
  Object.defineProperty(accessor.profile, 'maxFirstDollarHours', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 40;
    },
  });
  const accessorResult = rankFeatures(accessor);
  assert.equal(accessorResult.status, 'rejected');
  assert.ok(accessorResult.findings.some((item) => item.code === 'accessor-property-invalid'));
  assert.equal(getterCalls, 0);

  const symbol = clone(loadFeatureCatalog());
  symbol[Symbol('hidden')] = 'value';
  assert.ok(validateFeatureCatalog(symbol).findings.some((item) => {
    return item.code === 'symbol-property-invalid';
  }));

  const arrayExtra = clone(loadFeatureCatalog());
  Object.defineProperty(arrayExtra.candidates, '4294967295', {
    value: { score: 999 },
    enumerable: true,
  });
  assert.ok(validateFeatureCatalog(arrayExtra).findings.some((item) => {
    return item.code === 'array-property-invalid';
  }));

  const hugeKey = 'x'.repeat(MAX_STRING_BYTES + 1);
  const named = clone(loadFeatureCatalog());
  named[hugeKey] = true;
  const namedValidation = validateFeatureCatalog(named);
  assert.ok(namedValidation.findings.some((item) => item.code === 'string-budget-exceeded'));
  assert.equal(JSON.stringify(namedValidation).includes(hugeKey), false);
});

test('hard constraints remove a superficially stronger candidate before comparison', () => {
  const strongButBlocked = candidate('blocked', {
    codeDeltaLines: 0,
    firstDollarHours: 0,
  });
  strongButBlocked.requirements.deployment = true;
  const admitted = candidate('admitted', { codeDeltaLines: 5, firstDollarHours: 5 });
  const result = rankTestCatalog(catalog([strongButBlocked, admitted]));
  assert.equal(result.status, 'selected');
  assert.equal(result.selected, 'admitted');
  assert.ok(codes(result, 'blocked').includes('deployment-boundary'));
  assert.deepEqual(result.trail.comparisons, []);

  const slow = candidate('slow', { firstDollarHours: 41 });
  const timed = rankTestCatalog(catalog([slow]));
  assert.ok(codes(timed, 'slow').includes('time-budget-exceeded'));
});

test('catalog work and referenced evidence bytes are bounded', () => {
  const base = candidate('base');
  const candidates = Array.from({ length: MAX_CANDIDATES + 1 }, (_, index) => ({
    ...clone(base),
    id: `candidate-${index}`,
  }));
  const oversizedCatalog = catalog(candidates);
  const rejected = rankTestCatalog(oversizedCatalog);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.findings.some((item) => item.code === 'candidate-budget-exceeded'));

  writeFileSync(join(TEST_ROOT, 'oversized.txt'), Buffer.alloc(MAX_EVIDENCE_FILE_BYTES + 1));
  const evidenceHeavy = candidate('evidence-heavy');
  evidenceHeavy.solution.evidenceRefs = ['oversized.txt'];
  const evidenceRejected = rankTestCatalog(catalog([evidenceHeavy]));
  assert.equal(evidenceRejected.code, 'evidence-read-failed');

  const oversizedPath = join(TEST_ROOT, 'oversized-catalog.json');
  writeFileSync(oversizedPath, Buffer.alloc(MAX_CATALOG_BYTES + 1));
  assert.throws(() => loadFeatureCatalog(oversizedPath), /catalog byte budget exceeded/);

  const deep = clone(loadFeatureCatalog());
  let cursor = {};
  deep.unknown = cursor;
  for (let depth = 0; depth < 20; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.ok(validateFeatureCatalog(deep).findings.some((item) => {
    return item.code === 'catalog-depth-budget-exceeded';
  }));

  const hugeField = clone(loadFeatureCatalog());
  hugeField.candidates[0].pain.evidenceRefs = Array(MAX_ARGUMENTS + 1).fill('README.md');
  assert.ok(validateFeatureCatalog(hugeField).findings.some((item) => {
    return item.code === 'catalog-collection-budget-exceeded';
  }));

  const retained = [];
  for (let index = 0; index < 32; index += 1) {
    const path = join(TEST_ROOT, `tiny-${index}.txt`);
    writeFileSync(path, 'x');
    retained.push(readBoundedFile(path, MAX_EVIDENCE_FILE_BYTES));
  }
  assert.equal(retained.reduce((sum, bytes) => sum + bytes.byteLength, 0), 32);
  assert.equal(retained.reduce((sum, bytes) => sum + bytes.buffer.byteLength, 0), 32);
});

test('Pareto dominance requires all-no-worse and one-strict criterion', () => {
  const equalLeft = candidate('equal-left');
  const equalRight = candidate('equal-right');
  assert.equal(dominates(equalLeft, equalRight), false);
  equalLeft.estimates.codeDeltaLines = null;
  assert.equal(dominates(equalLeft, equalRight), false);
  equalLeft.estimates.codeDeltaLines = 1;

  const better = candidate('better', { codeDeltaLines: 1, firstDollarHours: 2 });
  const worse = candidate('worse', { codeDeltaLines: 2, firstDollarHours: 2 });
  assert.equal(dominates(better, worse), true);
  assert.equal(dominates(worse, better), false);

  const fast = candidate('fast', { codeDeltaLines: 3, firstDollarHours: 1 });
  assert.equal(dominates(better, fast), false);
  assert.equal(dominates(fast, better), false);
  assert.deepEqual(CRITERIA.map((item) => item.key), [
    'codeDeltaLines',
    'firstDollarHours',
    'incrementalSpendUsd',
  ]);
});

test('the trail records every admitted pair, all dominators, and the Pareto frontier', () => {
  const a = candidate('a', { codeDeltaLines: 1, firstDollarHours: 4 });
  const b = candidate('b', { codeDeltaLines: 2, firstDollarHours: 5 });
  const c = candidate('c', { codeDeltaLines: 3, firstDollarHours: 1 });
  const result = rankTestCatalog(catalog([c, b, a]));
  assert.equal(result.status, 'unresolved');
  assert.equal(result.trail.comparisons.length, 3);
  assert.deepEqual(result.trail.dominated, [{ candidateId: 'b', by: ['a'] }]);
  assert.deepEqual(result.trail.frontier, ['a', 'c']);
  assert.deepEqual(result.trail.argumentation.findings, [
    { code: 'reason-count', detail: 'a:0' },
    { code: 'reason-count', detail: 'c:0' },
  ]);
});

test('grounded argumentation selects the sole surviving frontier reason', () => {
  const a = candidate('a', { codeDeltaLines: 1, firstDollarHours: 4 });
  const b = candidate('b', { codeDeltaLines: 4, firstDollarHours: 1 });
  const arguments_ = [
    argument('a-reason', 'a', 'reason'),
    argument('a-counter', 'a', 'counter', ['a-reason']),
    argument('a-defense', 'a', 'defense', ['a-counter']),
    argument('b-reason', 'b', 'reason'),
    argument('b-counter', 'b', 'counter', ['b-reason']),
  ];
  const result = rankTestCatalog(catalog([b, a], arguments_.toReversed()));
  assert.equal(result.status, 'selected');
  assert.equal(result.selected, 'a');
  assert.deepEqual(result.trail.argumentation.reasons, [
    { candidateId: 'a', argumentId: 'a-reason', label: 'accepted' },
    { candidateId: 'b', argumentId: 'b-reason', label: 'rejected' },
  ]);
  assert.ok(result.trail.argumentation.rounds.length >= 2);
});

test('argumentation refuses missing counters, multiple survivors, and invalid attack graphs', () => {
  const a = candidate('a', { codeDeltaLines: 1, firstDollarHours: 4 });
  const b = candidate('b', { codeDeltaLines: 4, firstDollarHours: 1 });
  const missing = catalog([a, b], [argument('a-reason', 'a', 'reason'), argument('b-reason', 'b', 'reason')]);
  assert.equal(rankTestCatalog(missing).status, 'unresolved');
  assert.ok(rankTestCatalog(missing).trail.argumentation.findings.some((item) => item.code === 'counter-missing'));

  const bothSurvive = catalog([a, b], [
    argument('a-reason', 'a', 'reason'),
    argument('a-counter', 'a', 'counter', ['a-reason']),
    argument('a-defense', 'a', 'defense', ['a-counter']),
    argument('b-reason', 'b', 'reason'),
    argument('b-counter', 'b', 'counter', ['b-reason']),
    argument('b-defense', 'b', 'defense', ['b-counter']),
  ]);
  assert.equal(rankTestCatalog(bothSurvive).status, 'unresolved');

  const dangling = clone(bothSurvive);
  dangling.arguments[1].attacks = ['missing'];
  refresh(dangling);
  assert.equal(rankTestCatalog(dangling).status, 'rejected');
  assert.ok(validateTestCatalog(dangling).findings.some((item) => item.code === 'attack-target-missing'));

  const cycle = clone(bothSurvive);
  cycle.arguments[0].attacks = ['a-defense'];
  refresh(cycle);
  assert.equal(rankTestCatalog(cycle).status, 'rejected');
  assert.ok(validateTestCatalog(cycle).findings.some((item) => item.code === 'argument-attack-role-invalid'));
});

test('grounded labels leave an unsupported cycle undecided', () => {
  const labels = groundedLabels([
    { id: 'one', attacks: ['two'] },
    { id: 'two', attacks: ['one'] },
  ]);
  assert.deepEqual(labels.accepted, []);
  assert.deepEqual(labels.rejected, []);
  assert.deepEqual(labels.undecided, ['one', 'two']);
});

test('material catalog changes alter both catalog and decision receipts', () => {
  const first = catalog([candidate('a')]);
  const second = clone(first);
  second.candidates[0].estimates.firstDollarHours = 2;
  refresh(second);
  const firstResult = rankTestCatalog(first);
  const secondResult = rankTestCatalog(second);
  assert.notEqual(first.digest, second.digest);
  assert.notEqual(firstResult.digest, secondResult.digest);
});

test('evidence byte changes alter the decision receipt without changing the catalog', () => {
  const source = catalog([candidate('a')]);
  const first = rankTestCatalog(source);
  const changedReceipt = {
    schema: DEMAND_EVIDENCE_SCHEMA,
    status: 'verified',
    provider: 'fixture',
    providerReceipt: 'fixture:demand/a',
    observedAt: '2026-09-01T00:00:00.000Z',
    candidate: { id: 'a', claimDigest: demandClaimDigest(source.candidates[0]) },
    payer: 'Synthetic test payer',
    paidArtifact: 'Changed synthetic audit fixture',
    currentCost: { amount: 1, unit: 'hours' },
    acceptanceCriterion: 'The contract test receives a deterministic ranking result.',
  };
  writeFileSync(join(TEST_ROOT, 'demand-a.json'), JSON.stringify(changedReceipt));
  const second = rankTestCatalog(source);

  assert.equal(first.status, 'selected');
  assert.equal(second.status, 'selected');
  assert.equal(first.catalogDigest, second.catalogDigest);
  assert.notDeepEqual(first.evidence, second.evidence);
  assert.notEqual(first.digest, second.digest);
});

test('the selected external verification is explicit and changes the decision receipt', () => {
  const subject = candidate('proof-switch');
  const baseReceipt = JSON.parse(
    readFileSync(join(TEST_ROOT, 'demand-proof-switch.json'), 'utf8'),
  );
  for (const suffix of ['a', 'b']) {
    writeFileSync(join(TEST_ROOT, `demand-proof-switch-${suffix}.json`), JSON.stringify({
      ...baseReceipt,
      providerReceipt: `fixture:demand/proof-switch/${suffix}`,
    }));
  }
  subject.pain.demandEvidenceRefs = [
    'demand-proof-switch-b.json',
    'demand-proof-switch-a.json',
  ];
  const source = catalog([subject]);
  const run = (accepted) => {
    let nowCalls = 0;
    const result = rankFeatures(source, {
      root: TEST_ROOT,
      now: () => {
        nowCalls += 1;
        return TEST_NOW;
      },
      verifyDemandEvidence: (receipt) => receipt.providerReceipt.endsWith(`/${accepted}`)
        ? {
            verified: true,
            verifier: 'switch-fixture-verifier',
            receipt: `fixture:verification/${accepted}`,
          }
        : { verified: false },
    });
    assert.equal(nowCalls, 1);
    return result;
  };
  const first = run('a');
  const second = run('b');

  assert.equal(first.status, 'selected');
  assert.equal(second.status, 'selected');
  assert.equal(first.catalogDigest, second.catalogDigest);
  assert.equal(first.trail.constraints[0].demandVerification.ref,
    'demand-proof-switch-a.json');
  assert.equal(second.trail.constraints[0].demandVerification.ref,
    'demand-proof-switch-b.json');
  assert.notDeepEqual(first.trail.constraints[0].demandVerification,
    second.trail.constraints[0].demandVerification);
  assert.notEqual(first.digest, second.digest);
});
