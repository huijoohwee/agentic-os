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

const ownershipModule = await import('../bin/agentic-os-fleet.mjs');
const { evaluateFleetOwnership, collectFleetOwnership, validateOwnershipPolicy } = ownershipModule;
const fleetPolicy = () => ({ schema: 'agentic-os/fleet-ownership-policy/v1',
  repositories: [repository, 'example.org/owner/consumer'].map((id, n) => ({ id,
    directory: n ? 'consumer' : 'project', role: 'source', planningRoots: ['docs'] })),
  responsibilities: [{ id: 'runtime', owner: repository, source: 'src/runtime.mjs',
    consumers: ['example.org/owner/consumer'] }], historical: [] });
const artifact = (path, continuityId = null, planningRevision = null, bodyDigest = null) =>
  ({ path, sha256: 'b'.repeat(64), continuityId, planningRevision, bodyDigest });
const fleetObservations = () => [
  { id: repository, revision: 'a'.repeat(40), artifacts: [artifact('src/runtime.mjs'),
    artifact('docs/plan.md', 'PLAN-1', '1.0.0', 'c'.repeat(64))] },
  { id: 'example.org/owner/consumer', revision: 'd'.repeat(40), artifacts: [] },
];
const ownershipCodes = (p, o) => evaluateFleetOwnership(p, o).findings.map(f => f.code);

test('fleet policy has one owner per responsibility and covers every observed repository', () => {
  const p = fleetPolicy(), o = fleetObservations();
  assert.equal(evaluateFleetOwnership(p, o).ok, true);
  const duplicate = structuredClone(p); duplicate.responsibilities.push({ ...p.responsibilities[0], owner: o[1].id, consumers: [] });
  assert.throws(() => validateOwnershipPolicy(duplicate), /duplicates/u);
  assert(ownershipCodes(p, o.slice(0, 1)).includes('invalid-ownership-input'));
  o[0].artifacts.shift(); assert(ownershipCodes(p, o).includes('missing-responsibility-source'));
});

test('a declared consumer cannot become a second source owner', () => {
  const p = fleetPolicy(), o = fleetObservations();
  o[1].artifacts.push(artifact('src/runtime.mjs'));
  assert(ownershipCodes(p, o).includes('competing-responsibility-source'));
  p.repositories[1].role = 'projection';
  assert.equal(evaluateFleetOwnership(p, o).ok, true);
  p.responsibilities[0].consumers = [repository];
  assert.throws(() => validateOwnershipPolicy(p), /recursive consumer/u);
});

test('planning identity aliases and revision conflicts fail across repository boundaries', () => {
  const p = fleetPolicy(), o = fleetObservations();
  o[1].artifacts.push(artifact('docs/renamed.md', 'plan-1', '1.0.0', 'e'.repeat(64)));
  assert(ownershipCodes(p, o).includes('conflicting-planning-authority'));
  o[1].artifacts = []; o[0].artifacts.push(artifact('docs/companion.md', 'PLAN-1', '1.0.1', 'e'.repeat(64)));
  assert(ownershipCodes(p, o).includes('conflicting-planning-authority'));
  o[0].artifacts[2].planningRevision = '1.0.0';
  assert.equal(evaluateFleetOwnership(p, o).ok, true);
});

test('renaming both the file and continuity ID does not hide an exact duplicate planning body', () => {
  const p = fleetPolicy(), o = fleetObservations();
  o[1].artifacts.push(artifact('docs/unrelated-name.md', 'PLAN-2', '9.0.0', 'c'.repeat(64)));
  assert(ownershipCodes(p, o).includes('duplicate-planning-body'));
});

test('historical authority exclusions bind exact bytes and cannot hide drift', () => {
  const p = fleetPolicy(), o = fleetObservations();
  p.historical = [{ repository, path: 'docs/plan.md', sha256: 'b'.repeat(64) }];
  assert.equal(evaluateFleetOwnership(p, o).ok, true);
  o[0].artifacts[1].sha256 = 'd'.repeat(64);
  assert(ownershipCodes(p, o).includes('immutable-authority-drift'));
});

test('unchanged observations stop failed loops or reuse passed evidence without granting authority', () => {
  const p = fleetPolicy(), o = fleetObservations();
  const passed = evaluateFleetOwnership(p, o);
  const reused = evaluateFleetOwnership(p, o, passed);
  assert.equal(reused.nextAction, 'reuse-passed-evidence'); assert.equal(reused.authority, false);
  o[1].artifacts.push(artifact('src/runtime.mjs'));
  const failed = evaluateFleetOwnership(p, o, passed);
  assert.equal(failed.nextAction, 'fix-owning-source');
  assert.equal(evaluateFleetOwnership(p, o, failed).nextAction, 'stop-unchanged-input');
  assert.equal(failed.liveClaimsVerified, false);
});

test('ownership collector rejects incomplete roots without recursively searching the filesystem', () => {
  assert.throws(() => collectFleetOwnership(fleetPolicy(), {}), /explicit repository roots/u);
});


test('planning metadata comments and quoted keys cannot hide conflicting identities', () => {
  const field = ownershipModule.readOwnershipField;
  assert.equal(field('doc_type: "PRD-TAD-ADR-MVP-GTM" # source owner', 'doc_type'), 'PRD-TAD-ADR-MVP-GTM');
  assert.equal(field('"continuity_id": PLAN-1 # source owner', 'continuity_id'), 'PLAN-1');
  assert.equal(field("'prd_revision': '1.0.0' # exact revision", 'prd_revision'), '1.0.0');
  assert.throws(() => field('continuity_id: PLAN-1\n"continuity_id": PLAN-2', 'continuity_id'), /duplicate/u);
  assert.throws(() => field('doc_type: |\n  PRD-TAD-ADR-MVP-GTM', 'doc_type'), /unsupported/u);
});
