import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedFile } from '../src/bounded-read.mjs';
import {
  FEATURE_CATALOG_SCHEMA,
  MAX_FINDINGS,
  featureCatalogDigest,
  loadFeatureCatalog,
  validateFeatureCatalog,
} from '../src/feature-catalog.mjs';
import {
  DEMAND_EVIDENCE_SCHEMA,
  MAX_EVIDENCE_FILE_BYTES,
  demandClaimDigest,
} from '../src/feature-grounding.mjs';
import { rankFeatures } from '../src/rank.mjs';

const NOW = Date.parse('2026-09-02T00:00:00.000Z');

function candidate(id, demandRef = `demand-${id}.json`) {
  return {
    id,
    offer: `Offer ${id}`,
    pain: {
      statement: `Pain ${id}`,
      namedProspectivePayer: 'Synthetic test payer',
      evidenceRefs: ['README.md'],
      demandEvidenceRefs: [demandRef],
    },
    solution: { statement: `Solution ${id}`, evidenceRefs: ['README.md'] },
    estimates: {
      codeDeltaLines: 1,
      firstDollarHours: 1,
      incrementalSpendUsd: 0,
      runtimeDependencies: 0,
    },
    requirements: { deployment: false, browserSurface: false, dependencies: [] },
  };
}

function catalog(candidates) {
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
    arguments: [],
  };
  value.digest = featureCatalogDigest(value);
  return value;
}

function receipt(value, overrides = {}) {
  return {
    schema: DEMAND_EVIDENCE_SCHEMA,
    status: 'verified',
    provider: 'fixture',
    providerReceipt: `fixture:demand/${value.id}`,
    observedAt: '2026-09-01T00:00:00.000Z',
    candidate: { id: value.id, claimDigest: demandClaimDigest(value) },
    payer: 'Synthetic test payer',
    paidArtifact: 'Synthetic audit fixture',
    currentCost: { amount: 1, unit: 'hours' },
    acceptanceCriterion: 'The contract test receives a deterministic ranking result.',
    ...overrides,
  };
}

function fixture(ids = ['a']) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-rank-security-'));
  writeFileSync(join(root, 'README.md'), 'fixture evidence');
  const candidates = ids.map((id) => candidate(id));
  for (const value of candidates) {
    writeFileSync(join(root, `demand-${value.id}.json`), JSON.stringify(receipt(value)));
  }
  return { root, candidates, catalog: catalog(candidates) };
}

const accepted = (suffix = 'accepted') => ({
  verified: true,
  verifier: 'security-fixture-verifier',
  receipt: `fixture:verification/${suffix}`,
});

test('proxy catalog values are rejected without executing their traps', () => {
  const source = structuredClone(loadFeatureCatalog());
  let trapCalls = 0;
  source.candidates = new Proxy(source.candidates, {
    get() {
      trapCalls += 1;
      throw new Error('proxy trap must not execute');
    },
  });
  const validation = validateFeatureCatalog(source);
  assert.ok(validation.findings.some((item) => item.code === 'proxy-object-invalid'));
  assert.equal(trapCalls, 0);
});

test('bounded reads reject descriptor identity drift and do not block on FIFOs', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-bounded-read-'));
  try {
    const path = join(root, 'regular.txt');
    writeFileSync(path, 'x');
    assert.throws(() => readBoundedFile(path, 10, 'fixture', {
      expectedIdentity: { dev: -1, ino: -1 },
    }), /fixture identity changed/);

    const fifo = join(root, 'input.fifo');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const moduleUrl = pathToFileURL(join(import.meta.dirname, '../src/bounded-read.mjs')).href;
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', [
      `import {readBoundedFile} from ${JSON.stringify(moduleUrl)};`,
      `try { readBoundedFile(${JSON.stringify(fifo)}, 10); process.exitCode = 2; }`,
      `catch (error) { if (!/regular file/.test(error.message)) process.exitCode = 3; }`,
    ].join('')], { timeout: 1_000 });
    assert.equal(probe.signal, null, 'FIFO read timed out');
    assert.equal(probe.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifier failures are typed, bounded, and decision-digest distinct', () => {
  const subject = fixture();
  try {
    const run = (verifyDemandEvidence) => rankFeatures(subject.catalog, {
      root: subject.root,
      now: () => NOW,
      ...(verifyDemandEvidence ? { verifyDemandEvidence } : {}),
    });
    const results = [
      run(),
      run(() => ({ verified: false, verifier: 'fixture', receipt: 'fixture:rejected' })),
      run(() => { throw new Error('secret-verifier-message'); }),
      run(() => ({ verified: true })),
    ];
    assert.deepEqual(results.map((result) => {
      return result.trail.constraints[0].demandAttempts[0].outcome;
    }), [
      'demand-verifier-unavailable',
      'demand-verifier-rejected',
      'demand-verifier-error',
      'demand-verifier-result-invalid',
    ]);
    assert.equal(new Set(results.map((result) => result.digest)).size, results.length);
    assert.equal(JSON.stringify(results).includes('secret-verifier-message'), false);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('receipt freshness and claim failures remain distinct in the per-ref trail', () => {
  const subject = fixture();
  try {
    writeFileSync(join(subject.root, 'demand-a.json'), JSON.stringify(receipt(
      subject.candidates[0],
      { observedAt: '2026-01-01T00:00:00.000Z' },
    )));
    const stale = rankFeatures(subject.catalog, {
      root: subject.root,
      now: () => NOW,
      verifyDemandEvidence: accepted,
    });
    assert.equal(stale.trail.constraints[0].demandAttempts[0].outcome, 'demand-receipt-stale');

    writeFileSync(join(subject.root, 'demand-a.json'), JSON.stringify(receipt(
      subject.candidates[0],
      { payer: 'Different payer' },
    )));
    const invalid = rankFeatures(subject.catalog, {
      root: subject.root,
      now: () => NOW,
      verifyDemandEvidence: accepted,
    });
    assert.equal(invalid.trail.constraints[0].demandAttempts[0].outcome, 'demand-receipt-invalid');
    assert.notEqual(stale.digest, invalid.digest);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('verifier filesystem side effects cannot change the captured evidence snapshot', () => {
  const subject = fixture(['a', 'b']);
  try {
    const result = rankFeatures(subject.catalog, {
      root: subject.root,
      now: () => NOW,
      verifyDemandEvidence: (value) => {
        if (value.candidate.id === 'a') rmSync(join(subject.root, 'demand-b.json'));
        return accepted(value.candidate.id);
      },
    });
    assert.ok(result.trail.constraints.every((item) => item.admitted));
    assert.ok(result.trail.constraints.every((item) => {
      return item.demandAttempts[0].outcome === 'accepted';
    }));
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('catalog findings and unique evidence validation remain explicitly bounded', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-rank-budget-'));
  try {
    const refs = Array.from({ length: 64 }, (_, index) => `x${index}`);
    const candidates = Array.from({ length: 200 }, (_, index) => {
      const value = candidate(`candidate-${index}`);
      value.pain.evidenceRefs = [...refs];
      value.pain.demandEvidenceRefs = [...refs];
      value.solution.evidenceRefs = [...refs];
      return value;
    });
    const validation = validateFeatureCatalog(catalog(candidates), { root });
    assert.equal(validation.findings.length, MAX_FINDINGS);
    assert.ok(validation.findings.some((item) => item.code === 'findings-omitted'));
    assert.ok(Buffer.byteLength(JSON.stringify(validation)) < 100_000);

    const paths = Array.from({ length: 501 }, (_, index) => `evidence-${index}`);
    for (const path of paths) writeFileSync(join(root, path), 'x');
    const uniqueCandidates = Array.from({ length: 3 }, (_, index) => {
      const value = candidate(`unique-${index}`);
      value.pain.evidenceRefs = paths.slice(index * 192, index * 192 + 64);
      value.pain.demandEvidenceRefs = paths.slice(index * 192 + 64, index * 192 + 128);
      value.solution.evidenceRefs = paths.slice(index * 192 + 128, (index + 1) * 192);
      return value;
    });
    uniqueCandidates[2].solution.evidenceRefs = paths.slice(448, 501);
    const unique = validateFeatureCatalog(catalog(uniqueCandidates), { root });
    assert.ok(unique.findings.some((item) => item.code === 'evidence-reference-budget-exceeded'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid embedding options return typed rejection receipts', () => {
  const source = loadFeatureCatalog();
  assert.equal(rankFeatures(source, null).findings[0].code, 'ranking-options-invalid');
  assert.equal(rankFeatures(source, { root: null }).findings[0].code, 'ranking-root-invalid');
  assert.equal(rankFeatures(source, new Proxy({}, {})).findings[0].code,
    'ranking-options-invalid');
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(rankFeatures(source, revoked.proxy).findings[0].code, 'ranking-options-invalid');
  const hostile = { message: 'not read' };
  Object.defineProperty(hostile, 'message', { get() { throw new Error('getter executed'); } });
  const timed = rankFeatures(source, { now: () => { throw hostile; } });
  assert.equal(timed.findings[0].code, 'evaluation-time-invalid');
});
