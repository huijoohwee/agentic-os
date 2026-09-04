import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TRUSTED_COMPOSITION_GIT } from '../bin/composition-git.mjs';
import {
  COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA, executeCompositionDeploymentTopology,
  inspectCompositionDeploymentTopology, isValidCompositionDeploymentTopologyReport,
} from '../bin/composition-deployment-topology.mjs';

const expected = Object.freeze({
  ACOS_ADMISSION: 'agentic-canvas-os',
  CHECKOUT_PROVIDER: 'agentic-travel-commerce-production',
  COMMERCE_SANDBOX: 'agentic-commerce-sandbox-production',
  DOCS_MCP: 'agentic-mcp',
  MARKETPLACE_PROVIDER: 'agentic-marketplace-production',
});
const manifest = `${JSON.stringify({
  schema: 'agentic-commerce-production-core-services/v1',
  services: Object.entries(expected).map(([binding, service]) => ({ binding, service })),
})}\n`;

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'composition-topology-'));
  const roots = Object.fromEntries([
    'agentic-os', 'agentic-canvas-os', 'agentic-graph', 'agentic-commerce-os',
  ].map(component => [component, path.join(base, component)]));
  const write = (component, file, source) => {
    const target = path.join(roots[component], file);
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, source);
  };
  for (const root of Object.values(roots)) mkdirSync(root);
  write('agentic-os', '.keep', 'fixture\n');
  write('agentic-canvas-os', 'wrangler.jsonc', '{"name":"agentic-canvas-os"}\n');
  write('agentic-commerce-os', 'wrangler.core.jsonc', JSON.stringify({
    env: { production: { services: Object.entries(expected)
      .map(([binding, service]) => ({ binding, service })) } },
  }));
  write('agentic-commerce-os', 'wrangler.sandbox.jsonc', JSON.stringify({
    env: { production: { name: expected.COMMERCE_SANDBOX } },
  }));
  write('agentic-commerce-os', 'config/production-core-services.json', manifest);
  write('agentic-graph', 'cloudflare/workers/agentic-graph-mcp/wrangler.toml',
    `name = "${expected.DOCS_MCP}"\n[env.staging]\nname = "agentic-mcp-staging"\n`);
  write('agentic-graph', 'cloudflare/workers/agentic-graph-travel-commerce/wrangler.jsonc',
    JSON.stringify({ env: { production: { name: expected.CHECKOUT_PROVIDER } } }));
  write('agentic-graph', 'cloudflare/workers/agentic-graph-marketplace/wrangler.jsonc',
    JSON.stringify({ env: { production: { name: expected.MARKETPLACE_PROVIDER } } }));
  for (const root of Object.values(roots)) {
    git(root, ['init', '-q']); git(root, ['add', '.']);
    git(root, ['-c', 'user.name=Composition Test',
      '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'fixture']);
  }
  return { base, roots };
}
function git(cwd, args) {
  const result = spawnSync(TRUSTED_COMPOSITION_GIT, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('joins exact Worker declarations through the tracked canonical Commerce manifest', () => {
  const value = fixture();
  try {
    const report = inspectCompositionDeploymentTopology(value.roots);
    assert.equal(report.schema, COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA);
    assert.equal(report.ok, true);
    assert.equal(report.candidateCodeExecuted, false);
    assert.match(report.topologyManifestDigest, /^[0-9a-f]{64}$/u);
    assert.match(report.topologyManifestBlob, /^[0-9a-f]{40}$/u);
    assert.deepEqual(report.expectedServices, expected);
    assert.deepEqual(report.configuredServices, expected);
    assert.deepEqual(report.releaseServices, expected);
    assert.equal(isValidCompositionDeploymentTopologyReport(report), true);
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});

test('fails closed when the topology manifest is absent from HEAD or differs from its HEAD blob', () => {
  for (const mutation of ['untracked', 'modified']) {
    const value = fixture();
    try {
      if (mutation === 'untracked') {
        git(value.roots['agentic-commerce-os'], [
          'rm', '--cached', 'config/production-core-services.json',
        ]);
        git(value.roots['agentic-commerce-os'], ['-c', 'user.name=Composition Test',
          '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'remove manifest']);
      }
      else writeFileSync(path.join(value.roots['agentic-commerce-os'],
        'config/production-core-services.json'), `${manifest} `);
      const report = inspectCompositionDeploymentTopology(value.roots);
      assert.equal(report.ok, false);
      const expectedCode = mutation === 'untracked'
        ? 'commerce_release_manifest_untracked' : 'commerce_release_manifest_bytes_unbound';
      assert(report.findings.some(item => item.code === expectedCode));
    } finally { rmSync(value.base, { recursive: true, force: true }); }
  }
});

test('preserves typed target mismatches when the manifest evidence remains bound', () => {
  const value = fixture();
  try {
    const core = path.join(value.roots['agentic-commerce-os'], 'wrangler.core.jsonc');
    const services = Object.entries(expected).map(([binding, service]) => ({ binding, service }));
    services.find(item => item.binding === 'DOCS_MCP').service = 'legacy-mcp';
    writeFileSync(core, JSON.stringify({ env: { production: { services } } }));
    git(value.roots['agentic-commerce-os'], ['add', 'wrangler.core.jsonc']);
    git(value.roots['agentic-commerce-os'], ['-c', 'user.name=Composition Test',
      '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'change core']);
    const inspected = inspectCompositionDeploymentTopology(value.roots);
    assert.equal(inspected.ok, false);
    assert.match(inspected.topologyManifestDigest, /^[0-9a-f]{64}$/u);
    assert.equal(isValidCompositionDeploymentTopologyReport(inspected), true);
    const report = executeCompositionDeploymentTopology(value.roots);
    assert(report.findings.some(item => item.code === 'commerce_production_service_target_mismatch'
      && item.binding === 'DOCS_MCP' && item.observed === 'legacy-mcp'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});

test('rejects manifest target drift independently of checked-in Wrangler configuration', () => {
  const value = fixture();
  try {
    const target = path.join(value.roots['agentic-commerce-os'],
      'config/production-core-services.json');
    const changed = JSON.parse(manifest);
    changed.services.find(item => item.binding === 'MARKETPLACE_PROVIDER').service = 'legacy-market';
    writeFileSync(target, `${JSON.stringify(changed)}\n`);
    git(value.roots['agentic-commerce-os'], ['add', 'config/production-core-services.json']);
    git(value.roots['agentic-commerce-os'], ['-c', 'user.name=Composition Test',
      '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'change manifest']);
    const report = executeCompositionDeploymentTopology(value.roots);
    assert(report.findings.some(item => item.code === 'commerce_release_service_target_mismatch'
      && item.binding === 'MARKETPLACE_PROVIDER'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});

test('rejects noncanonical, duplicate, extra-key, and executable manifest decoys', () => {
  const decoys = [
    JSON.stringify(JSON.parse(manifest), null, 2),
    `${manifest.trim()}\n${manifest.trim()}\n`,
    JSON.stringify({ ...JSON.parse(manifest), extra: true }),
    `globalThis.compromised = true; ${manifest}`,
  ];
  for (const source of decoys) {
    const value = fixture();
    try {
      delete globalThis.compromised;
      const target = path.join(value.roots['agentic-commerce-os'],
        'config/production-core-services.json');
      writeFileSync(target, `${source}\n`); git(value.roots['agentic-commerce-os'], ['add',
        'config/production-core-services.json']);
      git(value.roots['agentic-commerce-os'], ['-c', 'user.name=Composition Test',
        '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'manifest decoy']);
      const report = inspectCompositionDeploymentTopology(value.roots);
      assert.equal(report.ok, false);
      assert.equal(globalThis.compromised, undefined);
      assert(report.findings.some(item => item.code === 'commerce_release_manifest_invalid'));
    } finally { delete globalThis.compromised;
      rmSync(value.base, { recursive: true, force: true }); }
  }
});

test('rejects injected or mutated success reports', () => {
  const value = fixture();
  try {
    const report = inspectCompositionDeploymentTopology(value.roots);
    assert.equal(isValidCompositionDeploymentTopologyReport({ ...report, surprise: true }), false);
    assert.equal(isValidCompositionDeploymentTopologyReport({ ...report,
      candidateCodeExecuted: true }), false);
    const mutated = { ...report, configuredServices: {
      ...report.configuredServices, DOCS_MCP: 'wrong-worker',
    } };
    assert.equal(isValidCompositionDeploymentTopologyReport(mutated), false);
    const rejected = executeCompositionDeploymentTopology({}, undefined, () => mutated);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.findings[0].code, 'cross_repository_deployment_topology_invalid');
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
