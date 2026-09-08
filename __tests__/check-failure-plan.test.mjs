import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_INPUT_SCHEMA, CHECK_RESULT_SCHEMA, discoverRepositoryChecks, runChecksProcess } from '../bin/agentic-os-checks.mjs';

const failure = (id, source = 'tests/payment.test.mjs', occurrence = 1) => ({ id, occurrence, source });
function receipt(failures = [failure('paid'), failure('retry')], failed = failures.length) {
  return { schema: CHECK_RESULT_SCHEMA, repository: 'github.com/huijoohwee/agentic-os',
    revision: 'a'.repeat(40),
    command: { package: 'package.json', script: 'test', sourceSha256: 'b'.repeat(64), argv: ['npm', 'test'] },
    coverage: { scope: 'full owner suite', complete: true, counts: { total: failed + 3, passed: 3, failed, skipped: 0 } },
    outcome: 'failed', failures };
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-failure-plan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'input.json');
  const save = (...results) => {
    const names = results.map((result, index) => {
      const name = `result-${index}.json`; writeFileSync(join(root, name), JSON.stringify(result)); return name;
    });
    // Deliberately unavailable source: historical failure reports must not become current execution proof.
    writeFileSync(input, JSON.stringify({ schema: CHECK_INPUT_SCHEMA, repositories: [], results: names }));
    return input;
  };
  const read = (...results) => discoverRepositoryChecks(save(...results));
  return { input, save, read, results: (...results) => read(...results).repositories[0].results };
}

test('failure grouping partitions occurrences, ranks larger groups and retains missing detail', t => {
  const f = fixture(t), failures = [failure('paid'), failure('paid', 'tests/payment.test.mjs', 2),
    failure('alpha', 'tests/a.test.mjs'), failure('zulu', 'tests/z.test.mjs'), failure('unknown', null)];
  const report = f.read(receipt(failures, 8)), observation = report.repositories[0].results[0];
  const plan = observation.failurePlan;
  assert.equal(observation.binding, 'source_unavailable');
  assert.equal(observation.authenticated, false);
  assert.deepEqual(plan.sourceGroups.map(group => group.source),
    ['tests/payment.test.mjs', 'tests/a.test.mjs', 'tests/z.test.mjs']);
  assert.deepEqual(plan.sourceGroups[0].failures, [{ id: 'paid', occurrence: 1 }, { id: 'paid', occurrence: 2 }]);
  assert.deepEqual(plan.unmappedFailures, [{ id: 'unknown', occurrence: 1 }]);
  assert.equal(plan.reportedFailed, 8); assert.equal(plan.listedFailures, 5); assert.equal(plan.unlistedFailures, 3);
  const listed = [...plan.sourceGroups.flatMap(group => group.failures), ...plan.unmappedFailures];
  assert.equal(listed.length, failures.length);
  assert.equal(new Set(listed.map(value => JSON.stringify([value.id, value.occurrence]))).size, failures.length);
  assert.equal(plan.fullValidationRequired, true); assert.equal(plan.status, 'advisory');
  assert.equal(report.candidateCodeExecuted, false); assert.equal(report.productionReady, false);
  assert.equal(report.integrationAuthorized, false); assert.equal(report.authenticatedEvidenceObserved, false);
});

test('legacy aggregate results keep their shape and separate scopes never erase failures', t => {
  const f = fixture(t), older = receipt(), newer = receipt();
  delete older.failures;
  newer.coverage.scope = 'focused repair'; newer.command.argv.push('--', '--test-name-pattern=paid');
  const results = f.results(older, newer);
  assert.equal('failurePlan' in results[0], false);
  assert.equal(results[0].coverage.counts.failed, 2);
  assert.equal(results[1].failurePlan.listedFailures, 2);
  assert.equal(results[1].coverage.scope, 'focused repair');
  const interrupted = receipt([], 7); interrupted.outcome = 'interrupted'; interrupted.coverage.complete = false;
  assert.equal(f.results(interrupted)[0].failurePlan.unlistedFailures, 7);
});

test('failure records reject duplicate occurrences, invalid source paths and contradictory totals', t => {
  const f = fixture(t);
  const invalid = [];
  invalid.push(receipt([failure('paid'), failure('paid', 'tests/other.mjs')]));
  invalid.push(receipt([failure('paid')], 0));
  for (const source of ['../outside.mjs', '/absolute.mjs', 'tests/../hidden.mjs', 'tests\\a.mjs', '.', 'tests/', 'x:y', 'x\n'])
    invalid.push(receipt([failure('paid', source)]));
  for (const occurrence of [0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER + 1])
    invalid.push(receipt([failure('paid', null, occurrence)]));
  for (const id of ['', ' ', 'x\n', 'x'.repeat(1025)]) invalid.push(receipt([failure(id)]));
  const missingCounts = receipt(); delete missingCounts.coverage.counts; invalid.push(missingCounts);
  const passed = receipt([], 0); passed.outcome = 'passed'; invalid.push(passed);
  const unknown = receipt(); unknown.outcome = 'unknown'; invalid.push(unknown);
  const extra = receipt(); extra.failures[0].rootCause = 'guessed'; invalid.push(extra);
  const missing = receipt(); delete missing.failures[0].source; invalid.push(missing);
  const notArray = receipt(); notArray.failures = {}; invalid.push(notArray);
  for (const value of invalid) assert.throws(() => f.read(value), undefined, JSON.stringify(value.failures));
});

test('256 failure details are bounded and larger suites retain the unlisted remainder', t => {
  const f = fixture(t), failures = Array.from({ length: 256 }, (_, index) => failure(String(index)));
  const plan = f.results(receipt(failures, 400))[0].failurePlan;
  assert.equal(plan.sourceGroups.length, 1); assert.equal(plan.listedFailures, 256); assert.equal(plan.unlistedFailures, 144);
  assert.throws(() => f.read(receipt([...failures, failure('257')])));
  assert.throws(() => f.read(receipt(failures.map((value, index) => failure(`${index}-${'x'.repeat(900)}`)))));
});

test('source groups use Map keys and structural case identities without delimiter collisions', t => {
  const f = fixture(t), values = [failure('__proto__', '__proto__'), failure('constructor', 'constructor'),
    failure('a|1', 'tests/a|b.mjs', 2), failure('a', 'tests/a|b.mjs', 12)];
  const plan = f.results(receipt(values))[0].failurePlan;
  assert.equal(plan.sourceGroups.length, 3); assert.equal(plan.listedFailures, 4);
  assert.equal(plan.sourceGroups[0].source, 'tests/a|b.mjs');
});

test('bounded discovery process emits the same advisory partition without running owner code', async t => {
  const f = fixture(t); f.save(receipt([failure('paid'), failure('retry')]));
  const result = await runChecksProcess(f.input);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  const report = JSON.parse(result.stdout), plan = report.repositories[0].results[0].failurePlan;
  assert.equal(plan.sourceGroups[0].failures.length, 2);
  assert.equal(report.candidateCodeExecuted, false); assert.equal(report.integrationAuthorized, false);
});
