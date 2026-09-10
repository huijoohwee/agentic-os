import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FLEET_SCHEMA, FLEET_LIMITS, evaluateFleetAllocation, runFleetCli } from '../bin/agentic-os-fleet.mjs';

const repository = 'example.org/owner/project';
const allocation = () => ({
  schema: FLEET_SCHEMA,
  source: { repository, revision: 'a'.repeat(40), path: 'docs/kanban.md' },
  requirements: [{ id: 'repair', acceptance: 'Release retries safely' },
    { id: 'verify', acceptance: 'Browser acceptance passes' }],
  tasks: [
    { id: 'implementation', owner: { subject: 'builder', device: 'device-a' },
      scope: '#release-retry', contextRef: 'docs/kanban.md#implementation', requirements: ['repair'],
      writes: [{ repository, paths: ['scripts/release.mjs', 'tests/release.test.mjs'] }], dependsOn: [] },
    { id: 'verification', owner: { subject: 'reviewer', device: 'device-b' },
      scope: '#browser-acceptance', contextRef: 'docs/kanban.md#verification', requirements: ['verify'],
      writes: [{ repository, paths: ['tests/browser'] }], dependsOn: [] },
  ],
});
const codes = input => evaluateFleetAllocation(input).findings.map(item => item.code);

test('complete disjoint work runs together without granting any authority', () => {
  const input = allocation(), before = structuredClone(input), report = evaluateFleetAllocation(input);
  assert.equal(report.ok, true);
  assert.deepEqual(report.waves, [['implementation', 'verification']]);
  assert.deepEqual(report.handoffs, []);
  assert.equal(report.authority, false);
  assert.equal(report.liveClaimsVerified, false);
  assert.match(report.inputDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(input, before);
});

test('each acceptance criterion requires exactly one accountable task', () => {
  const missing = allocation(); missing.tasks[1].requirements = ['repair'];
  assert.deepEqual(codes(missing), ['duplicate-requirement-owner', 'uncovered-requirement']);
  const unknown = allocation(); unknown.tasks[1].requirements = ['invented'];
  assert(codes(unknown).includes('unknown-requirement'));
});

test('read-only reviewers share inspected code without claiming writes', () => {
  const input = allocation(); input.tasks[1].writes = [];
  assert.equal(evaluateFleetAllocation(input).ok, true);
});

test('different scope labels and device names cannot hide overlapping directory writes', () => {
  const input = allocation(); input.tasks[1].writes[0].paths = ['scripts'];
  const report = evaluateFleetAllocation(input);
  assert.equal(report.ok, false);
  assert.deepEqual(report.waves, []);
  assert.equal(report.findings[0].code, 'concurrent-ownership-overlap');
  assert.deepEqual(report.findings[0].overlaps[0].paths, ['scripts/release.mjs', 'scripts']);
});

test('the same semantic scope also requires serialization with disjoint paths', () => {
  const input = allocation(); input.tasks[1].scope = input.tasks[0].scope;
  assert(codes(input).includes('concurrent-ownership-overlap'));
});

test('ordered shared writes produce a required handoff, never an automatic transfer', () => {
  const input = allocation(); input.tasks[1].writes[0].paths = ['scripts'];
  input.tasks[1].dependsOn = ['implementation'];
  const report = evaluateFleetAllocation(input);
  assert.equal(report.ok, true);
  assert.deepEqual(report.waves, [['implementation'], ['verification']]);
  assert.deepEqual(report.handoffs[0].order, ['implementation', 'verification']);
  assert.equal(report.handoffs[0].requires, 'verified-stop-and-authority-transfer');
  assert.equal(report.liveClaimsVerified, false);
});

test('transitive dependencies serialize ownership; unrelated wave depth does not', () => {
  const input = allocation();
  input.requirements.push({ id: 'review', acceptance: 'Review findings are resolved' });
  input.tasks.push({ ...structuredClone(input.tasks[1]), id: 'review', scope: '#review',
    requirements: ['review'], writes: [], dependsOn: ['implementation'] });
  input.tasks[1].writes[0].paths = ['scripts']; input.tasks[1].dependsOn = ['review'];
  assert.equal(evaluateFleetAllocation(input).ok, true);
  input.tasks[2].dependsOn = [];
  const report = evaluateFleetAllocation(input);
  assert.equal(report.ok, false);
  assert(report.findings.some(item => item.code === 'concurrent-ownership-overlap'));
});

test('cycles, self dependencies and absent tasks block proposed dispatch', () => {
  for (const dependencies of [['verification', 'implementation'], ['implementation', 'unknown']]) {
    const input = allocation();
    input.tasks[0].dependsOn = [dependencies[0]]; input.tasks[1].dependsOn = [dependencies[1]];
    const report = evaluateFleetAllocation(input);
    assert.equal(report.ok, false); assert.deepEqual(report.waves, []);
    assert(report.findings.some(item => item.code === 'unresolved-dependencies'));
  }
});

test('path boundaries distinguish sibling prefixes and repository owners', () => {
  const input = allocation(); input.tasks[1].writes[0].paths = ['scripts-other'];
  assert.equal(evaluateFleetAllocation(input).ok, true);
  input.tasks[1].writes[0] = { repository: 'example.org/owner/another', paths: ['scripts'] };
  assert.equal(evaluateFleetAllocation(input).ok, true);
});

test('portable case and Unicode aliases conflict across devices', () => {
  for (const [left, right] of [['Source/Module.ts', 'source/module.ts'], ['src/café.ts', 'src/cafe\u0301.ts']]) {
    const input = allocation(); input.tasks[0].writes[0].paths = [left]; input.tasks[1].writes[0].paths = [right];
    assert(codes(input).includes('concurrent-ownership-overlap'));
  }
});

test('malformed identities, paths, duplicate records and unknown fields fail closed', () => {
  const mutations = [
    value => { value.tasks[0].owner.subject = ''; },
    value => { value.tasks[0].owner.device = null; },
    value => { value.tasks[0].owner = ['device-a', 'device-b']; },
    value => { value.tasks[0].writes[0].paths = ['../escape']; },
    value => { value.tasks[0].writes[0].paths = ['src/*']; },
    value => { value.tasks[0].writes[0].paths = ['src/a,src/b']; },
    value => { value.tasks[0].writes[0].paths = ['src/a\n']; },
    value => { value.tasks[0].writes[0].repository = 'https://example.org/owner/project'; },
    value => { value.tasks[0].writes[0].repository = 'example.org/owner/project.git'; },
    value => { value.source.repository = 'Example.org/owner/project'; },
    value => { value.source.revision = 'main'; },
    value => { value.tasks[0].authority = true; },
    value => { value.tasks[1].id = value.tasks[0].id; },
    value => { value.requirements.push(value.requirements[0]); },
    value => { value.tasks[0].requirements.push('repair'); },
    value => { value.tasks[0].writes[0].paths = ['src/a', 'SRC/a']; },
    value => { value.tasks[0].writes.push(structuredClone(value.tasks[0].writes[0])); },
    value => { value.tasks = []; },
    value => { value.requirements = []; },
    value => { value.tasks[0].dependsOn = ['verification', 'verification']; },
  ];
  for (const mutate of mutations) {
    const input = allocation(); mutate(input);
    const report = evaluateFleetAllocation(input);
    assert.equal(report.ok, false); assert.equal(report.authority, false);
    assert.equal(report.findings[0].code, 'invalid-input');
  }
});

test('input bounds and hostile JavaScript objects cannot run accessors', () => {
  const input = allocation(); input.tasks = Array(FLEET_LIMITS.tasks + 1).fill(input.tasks[0]);
  assert(codes(input).includes('invalid-input'));
  const hostile = {}; Object.defineProperty(hostile, 'schema', { enumerable: true, get() { throw Error('ran getter'); } });
  const report = evaluateFleetAllocation(hostile);
  assert.equal(report.findings[0].code, 'invalid-input');
  assert(!report.findings[0].message.includes('ran getter'));
});

test('CLI checks a bounded explicit file and preserves its bytes', t => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'snapshot.json'), input = JSON.stringify(allocation());
  writeFileSync(file, input);
  const lines = [], errors = [], io = { log: value => lines.push(value), error: value => errors.push(value) };
  assert.equal(runFleetCli([`--input=${file}`], io), 0);
  assert.equal(JSON.parse(lines[0]).ok, true);
  assert.equal(readFileSync(file, 'utf8'), input);
  assert.equal(runFleetCli([`--input=${file}`, '--grant'], io), 1);
  assert.equal(runFleetCli([`--input=${root}`], io), 1);
  const link = join(root, 'link.json'); symlinkSync(file, link);
  assert.equal(runFleetCli([`--input=${link}`], io), 1);
  writeFileSync(file, Buffer.from([0xff, 0xfe]));
  assert.equal(runFleetCli([`--input=${file}`], io), 1);
  writeFileSync(file, ' '.repeat(FLEET_LIMITS.bytes + 1));
  assert.equal(runFleetCli([`--input=${file}`], io), 1);
});

test('CLI process exits nonzero for conflicting allocation and emits a non-authorizing report', t => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-process-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'snapshot.json'), input = allocation();
  input.tasks[1].writes[0].paths = ['scripts']; writeFileSync(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, ['bin/agentic-os-fleet.mjs', `--input=${file}`], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).authority, false);
});
