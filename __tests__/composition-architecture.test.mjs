import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { observeCompositionRuntime } from '../bin/composition-runtime-check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GUIDE_LINK = 'guides/COMPOSITION-ARCHITECTURE.md';
const GUIDE_PATH = path.join(ROOT, GUIDE_LINK);
const README_PATH = path.join(ROOT, 'README.md');
const WRITE_SCOPE = Object.freeze([
  GUIDE_LINK,
  'catalog/composition-source-lock.json',
  'bin/composition-git.mjs',
  'bin/composition-admission-probe.mjs',
  'bin/composition-deployment-topology.mjs',
  'bin/composition-source-lock.mjs',
  'bin/composition-runtime-check.mjs',
  '__tests__/composition-architecture.test.mjs',
  '__tests__/composition-deployment-topology.test.mjs',
  '__tests__/composition-runtime-check.test.mjs',
]);
function read(file) { return readFileSync(file, 'utf8'); }
test('composition architecture is discoverable and every authored artifact is bounded', () => {
  const readme = read(README_PATH), guide = read(GUIDE_PATH);
  assert.match(readme, new RegExp(`\\[composition architecture\\]\\(${GUIDE_LINK}\\)`));
  assert.ok(statSync(GUIDE_PATH).isFile());
  for (const file of WRITE_SCOPE) {
    const source = read(path.join(ROOT, file));
    assert.ok(Buffer.byteLength(source) < 500_000, file);
    assert.ok(source.split('\n').length - 1 < 600, file);
  }
  for (const removed of ['bin/composition-marketplace-probe.mjs',
    'bin/composition-module-loader.mjs', 'bin/composition-probe-sandbox.mjs']) {
    assert.equal(existsSync(path.join(ROOT, removed)), false, removed);
  }
  assert.equal(read(path.join(ROOT, GUIDE_LINK)), guide);
});

test('document binds imported evidence without turning it into runtime proof', () => {
  const guide = read(GUIDE_PATH);
  for (const evidence of [
    'sha256:5e646e3afce86c05415c3f2545282603f3e58d77440382c6ab3fb5dc78e39418',
    'sha256:4abee8d5d6aafcc71919d95e222b2d3dea6ebd4fe3cd6d115a361d32009b7a7e',
    '99dd3d18d573c2ccf7616e29dad15aad94359b84',
    '3c597227dbb1101a2d5d75cb83a8496e22357a0e',
    '9ba90b95bcde38db9f25f6b945ba66cfd264e735',
    'd5323bc35a62cf2dace300990d5ee0db228897d8',
    '499296c7830ca62f30a6b6ac4181474e2511bae9',
  ]) assert.ok(guide.includes(evidence), evidence);
  assert.match(guide, /version: "1\.4\.2"/);
  assert.match(guide, /adr_revision: "1\.4\.2"/);
  assert.match(guide, /execution_gate: "static-source-observation-authorized"/);
  assert.match(guide, /local_rung: "dev-proven"/);
  assert.match(guide, /delivered_rung: "undocumented"/);
});

test('document keeps agentic-os as SSOT without migrating runtime owners', () => {
  const guide = read(GUIDE_PATH), readme = read(README_PATH);
  assert.match(guide, /`agentic-os` is the lifecycle\/orchestration, admission-vocabulary, and composition source-lock SSOT/);
  assert.match(guide, /ACOS, Commerce, and Graph remain separate runtime, state, and deployment owners/);
  assert.match(guide, /does not physically migrate any of those repositories or their deployable assets into `agentic-os`/);
  assert.match(guide, /No repository, deployable asset, or state is physically migrated/);
  assert.match(readme, /`agentic-graph`/);
  assert.doesNotMatch(`${readme}\n${guide}`, /AgenticGraph|agenticgraph|\bKG(?:_|\b)/i);
  assert.doesNotMatch(guide, /Mercur/i);
});

test('central evidence is static, exact, and explicitly non-executing', () => {
  const guide = read(GUIDE_PATH);
  assert.match(guide, /every pass-contributing source read to its exact `HEAD` blob/);
  assert.match(guide, /provider and consumer canonical admission fixtures byte-for-byte/);
  assert.match(guide, /tracked Commerce topology manifest and digest/);
  assert.match(guide, /never imports, evaluates, spawns, or otherwise executes sibling candidate code/);
  for (const field of ['sourceInterfaceContractsReady', 'sourceCandidateReviewReady',
    'candidateCodeExecuted', 'ownerSuiteEvidenceObserved', 'protectedOwnerEvidenceObserved',
    'productionRuntimeReady']) assert.ok(guide.includes(`\`${field}\``), field);
  assert.match(guide, /Protected integration, authenticated\s+release authority, required secrets, nonzero operator x402 payee, Cloudflare activation\/readback/);
});

test('source lock has exact owner and artifact vocabulary', () => {
  const lock = JSON.parse(read(path.join(ROOT, 'catalog/composition-source-lock.json')));
  assert.equal(lock.schema, 'agentic-os/composition-source-lock/v1');
  assert.deepEqual(Object.keys(lock.owners).sort(), [
    'agentic-canvas-os', 'agentic-commerce-os', 'agentic-graph',
  ]);
  assert.deepEqual(Object.keys(lock.artifacts).sort(), [
    'admissionConsumerContract', 'admissionConsumerFixture', 'admissionProviderContract',
    'admissionProviderFixture', 'marketplaceConsumerAuthoringHeaders',
    'marketplaceConsumerContract', 'marketplaceConsumerResponse', 'marketplaceProviderContract',
    'marketplaceProviderResponse', 'topologyManifest',
  ]);
  assert.equal(lock.artifacts.marketplaceConsumerResponse.blob,
    lock.artifacts.marketplaceProviderResponse.blob);
  assert.equal(lock.topology.manifestPath, 'config/production-core-services.json');
  assert.equal(lock.topology.manifestBlob, lock.artifacts.topologyManifest.blob);
  assert.match(lock.topology.manifestSha256, /^[0-9a-f]{64}$/u);
});

test('observer source has no sibling evaluation path and uses the trusted Git root', () => {
  const combined = ['bin/composition-admission-probe.mjs',
    'bin/composition-deployment-topology.mjs', 'bin/composition-source-lock.mjs',
    'bin/composition-runtime-check.mjs'].map(file => read(path.join(ROOT, file))).join('\n');
  assert.doesNotMatch(combined, /withContainedModules|runCompositionMarketplaceProbe|node:vm/);
  assert.doesNotMatch(combined, /\bimport\s*\(/);
  assert.match(combined, /candidateCodeExecuted: false/);
  const git = read(path.join(ROOT, 'bin/composition-git.mjs'));
  assert.match(git, /\['\/usr\/bin\/git', '\/bin\/git'\]/);
  assert.match(git, /GIT_CONFIG_NOSYSTEM/);
  assert.doesNotMatch(git, /execFileSync\(['"]git['"]/);
});

test('required decisions, RAOs, VCCs, and owner controllers remain explicit', () => {
  const guide = read(GUIDE_PATH);
  for (const section of ['## Division of Work', 'Diagram COMP-1', 'Diagram TOP-1',
    '## Cross-repository acceptance contract', '### Runtime RAO', '## Known gaps']) {
    assert.ok(guide.includes(section), section);
  }
  for (let index = 1; index <= 9; index += 1) assert.ok(guide.includes(`### DR-${index}`));
  for (let index = 1; index <= 10; index += 1) {
    assert.ok(guide.includes(`RAO-RUNTIME-${String(index).padStart(2, '0')}`));
  }
  for (const vcc of ['VCC-RUNTIME-OWNERSHIP-01', 'VCC-RUNTIME-AUTHORITY-02',
    'VCC-RUNTIME-X402-03']) {
    const rows = guide.split('\n').filter(line => line.startsWith('|') && line.includes(vcc));
    assert(rows.some(line => /Unsatisfied/.test(line)), vcc);
  }
  assert.match(guide, /ACOS uses its own protected production controller/);
  assert.match(guide, /Commerce separately seals its tracked `config\/production-core-services\.json`/);
  assert.match(guide, /No composed repository may add an external agent-orchestration SDK/);
  assert.match(guide, /no endpoint is admissible before real micro-SME interviews and willingness-to-pay evidence/);
});

test('native observer rejects execution from a different agentic-os checkout root', () => {
  const base = path.join(ROOT, '__definitely_missing_composition_root__');
  const report = observeCompositionRuntime({ roots: {
    'agentic-os': base, 'agentic-canvas-os': `${base}-acos`,
    'agentic-graph': `${base}-graph`, 'agentic-commerce-os': `${base}-commerce`,
  } });
  assert.equal(report.observationMode, 'native');
  assert.equal(report.sourceCandidateReviewReady, false);
  assert.equal(report.productionRuntimeReady, false);
  assert(report.findings.some(item => item.component === 'agentic-os'
    && item.code === 'component_root_unreadable'));
});
