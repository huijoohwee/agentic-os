import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompositionAdmissionProbe, isValidCompositionAdmissionInterfaceReport } from '../bin/composition-admission-probe.mjs';
import { CHECK_INPUT_SCHEMA, discoverRepositoryChecks } from '../bin/agentic-os-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureExport = 'agentic-os/test/contracts/admission-v2.fixture.json';
const manifestExport = 'agentic-os/test/contracts/admission-v2.fixture.sha256';

test('the packaged shared admission vector retains its exact acceptance bytes and public resolution', () => {
  const bytes = readFileSync(new URL(import.meta.resolve(fixtureExport)));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, 'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0');
  assert.equal(readFileSync(new URL(import.meta.resolve(manifestExport)), 'utf8'), `${digest}  admission-v2.fixture.json\n`);
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', maxBuffer: 500_000 }))[0];
  for (const name of ['test/contracts/admission-v2.fixture.json', 'test/contracts/admission-v2.fixture.sha256',
    'test/repositories.json', 'test/README.md', 'test/log.md']) {
    assert.ok(packed.files.some(file => file.path === name), `missing packaged asset: ${name}`);
  }
});

test('central discovery admits future owner rows within bounds without executing product suites', t => {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-os-central-tests-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const catalog = JSON.parse(readFileSync(new URL(import.meta.resolve('agentic-os/test/repositories.json'))));
  assert.ok(catalog.repositories.some(row => row.id === 'GameXR'));
  const row = index => ({ id: `future-${index}`, repository: `github.com/example/future-${index}`,
    packages: [{ path: 'package.json', scripts: ['test'] }], workflows: [] });
  const inputPath = join(directory, 'input.json'), catalogPath = join(directory, 'catalog.json');
  const inspect = (count, selected = count) => {
    writeFileSync(catalogPath, JSON.stringify({ ...catalog, repositories: Array.from({ length: count }, (_, i) => row(i)) }));
    writeFileSync(inputPath, JSON.stringify({ schema: CHECK_INPUT_SCHEMA,
      repositories: Array.from({ length: selected }, (_, i) => ({ id: row(i).id, root: `missing-${i}` })) }));
    return discoverRepositoryChecks(inputPath, { catalogPath });
  };
  for (const count of [1, 8, 32]) {
    const report = inspect(count);
    assert.equal(report.repositories.length, count);
    assert.ok(report.repositories.every(owner => owner.sourceStatus === 'unavailable'));
    assert.equal(report.candidateCodeExecuted, false); assert.equal(report.productionReady, false);
  }
  assert.throws(() => inspect(0), /catalog_requires_repository/);
  assert.throws(() => inspect(33), /invalid_array_bound/);
  assert.throws(() => inspect(32, 33), /invalid_array_bound/);
});

test('admission reads one upstream vector and binds each product contract without executing source', t => {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-os-shared-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const roots = {};
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const files = {
    'agentic-os': 'test/contracts/admission-v2.fixture.json',
    'agentic-canvas-os': 'agent-api/src/commerce-admission-contract.js',
    'agentic-commerce-os': 'src/core/acos-admission.ts',
  };
  for (const [owner, file] of Object.entries(files)) {
    const cwd = join(directory, owner); roots[owner] = cwd;
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    git(cwd, 'init', '-q'); git(cwd, 'config', 'user.name', 'Test');
    git(cwd, 'config', 'user.email', 'test@example.invalid');
    git(cwd, 'remote', 'add', 'origin', `https://github.com/huijoohwee/${owner}.git`);
    writeFileSync(join(cwd, file), owner === 'agentic-os'
      ? readFileSync(new URL(import.meta.resolve(fixtureExport)))
      : 'throw new Error("candidate code must not execute");\n');
    git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'source');
  }
  const args = { agenticOsRoot: roots['agentic-os'], acosRoot: roots['agentic-canvas-os'],
    commerceRoot: roots['agentic-commerce-os'] };
  const valid = runCompositionAdmissionProbe(args);
  assert.equal(valid.ok, true); assert.equal(isValidCompositionAdmissionInterfaceReport(valid), true);
  assert.equal(valid.sharedFixtureBlob, git(args.agenticOsRoot, 'rev-parse', `HEAD:${files['agentic-os']}`));
  assert.equal(Object.hasOwn(valid, 'consumerFixtureBlob'), false);
  assert.equal(runCompositionAdmissionProbe({ ...args, fixturePath: join(args.commerceRoot, files['agentic-commerce-os']) }).code,
    'composition_admission_fixture_not_owner_published');
  const target = join(args.agenticOsRoot, files['agentic-os']);
  const bytes = readFileSync(target); writeFileSync(target, Buffer.concat([bytes, Buffer.from(' ')]));
  const dirty = runCompositionAdmissionProbe(args);
  assert.equal(dirty.code, 'composition_admission_artifact_bytes_unbound');
  assert.equal(dirty.owner, 'agentic-os'); assert.equal(isValidCompositionAdmissionInterfaceReport(dirty), true);
  git(args.agenticOsRoot, 'add', '.'); git(args.agenticOsRoot, 'commit', '-qm', 'changed vector');
  assert.equal(runCompositionAdmissionProbe(args).code, 'composition_admission_fixture_digest_invalid');
});
