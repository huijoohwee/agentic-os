import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS } from '../bin/agentic-os-test-inputs.mjs';
import { writeReceipt } from '../bin/agentic-os-test-receipt.mjs';

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'receipt-compaction-recovery-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function results(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `__tests__/affected-receipt-compaction-regression-${i}.test.mjs`,
    stage: 'behavior', exitCode: 0, reason: null, elapsedMs: 100,
    startedAt: 1000, finishedAt: 1100, validatedAt: 1100, reused: i === 0,
    outputDigest: 'a'.repeat(64), log: `check-${String(i).padStart(24, '0')}.log`,
    counts: { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
    resources: { status: 'measured', method: 'wait4', scope: 'waited-process-tree',
      memoryScope: 'maximum-single-process-rss', cpuMs: 3, cpuUserMs: 2,
      cpuSystemMs: 1, peakMemoryBytes: 65000000 },
  }));
}
function save(path, receipt) {
  assert.ok(Buffer.byteLength(JSON.stringify(receipt) + '\n') > LIMITS.receiptBytes,
    'fixture must exercise aggregate compaction rather than only remove indentation');
  writeReceipt(path, 'last.json', receipt);
  const bytes = readFileSync(join(path, 'last.json'));
  assert.ok(bytes.length <= LIMITS.receiptBytes);
  return JSON.parse(bytes);
}

test('affected reasons share exact defaults while differing suite metadata survives rehydration', t => {
  const path = directory(t), rows = results(145);
  const reasons = Array.from({ length: 15 }, (_, i) =>
    `dependency:src/accepted-successor-preservation-and-historical-transition-owner-${i}.mjs`);
  const suites = rows.slice(1).map(row => ({ path: row.name, stage: 'behavior', reasons }));
  suites[7] = { ...suites[7], stage: 'safety', reasons: ['safety-sentinel'], estimatedMs: 300 };
  suites[18] = { ...suites[18], reasons: [...reasons, 'dependency:src/distinct-owner.mjs'] };
  suites[23] = { ...suites[23], stage: 'packaging', reasons: [] };
  const receipt = { schema: 'agentic-os/test-receipt/v2', authority: false, outcome: 'passed',
    plan: { suites, stages: { behavior: suites.map(suite => suite.path) } }, results: rows };
  const original = structuredClone(receipt), saved = save(path, receipt);
  assert.deepEqual(saved.plan.suiteDefaults.reasons, reasons);
  assert.deepEqual(saved.plan.suites.map(suite => ({ ...saved.plan.suiteDefaults, ...suite })), suites);
  assert.equal(saved.diagnostics, 'per-check-receipts');
  assert.deepEqual(saved.results.map(row => ({ stage: saved.plan.suiteDefaults.stage, ...row, outputDigest: 'a'.repeat(64),
    resources: { ...saved.resourceDefaults, ...row.resources } })), rows);
  assert.deepEqual(receipt, original, 'compaction must not mutate the caller or per-check evidence');
});

test('empty suite plans retain the existing default without losing result rows', t => {
  const path = directory(t), rows = results(242);
  rows[0].stage = 'evaluators'; rows[17].stage = 'safety'; rows[29].stage = 'packaging';
  for (const row of rows) { row.startedAt += 1790993676513; row.finishedAt += 1790993676513;
    row.validatedAt += 1790993676513; row.elapsedMs = 3429.723500000001; }
  const saved = save(path, { schema: 'agentic-os/test-receipt/v2', authority: false,
    plan: { suites: [], stages: {} }, results: rows });
  assert.deepEqual(saved.plan.suiteDefaults, { stage: 'behavior', reasons: ['broad-impact'] });
  assert.deepEqual(saved.plan.suites, []);
  assert.equal(saved.results.length, rows.length);
  assert.deepEqual(saved.results.map(row => ({ stage: saved.plan.suiteDefaults.stage, ...row,
    outputDigest: 'a'.repeat(64), resources: { ...saved.resourceDefaults, ...row.resources } })), rows);
});

test('remaining oversized aggregate content still fails without writing a receipt', t => {
  const path = directory(t);
  const receipt = { schema: 'agentic-os/test-receipt/v2', authority: false,
    plan: { suites: [], stages: {} }, results: [], retained: 'x'.repeat(LIMITS.receiptBytes) };
  assert.throws(() => writeReceipt(path, 'last.json', receipt), /blocked-test-receipt-byte-budget/);
  assert.equal(existsSync(join(path, 'last.json')), false);
});
