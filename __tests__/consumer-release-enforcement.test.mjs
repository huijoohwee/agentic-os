import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumerReleaseEnforcementFindings } from '../bin/agentic-os-auxiliary.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { providerPolicy } from '../src/lane-state.mjs';

function fixture(t, { scripts, workflowJobName = null }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-consumer-enforcement-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true, scripts }, null, 2)}\n`);
  if (workflowJobName !== null) {
    const workflows = join(root, '.github', 'workflows');
    mkdirSync(workflows, { recursive: true });
    writeFileSync(join(workflows, 'integration.yml'), `name: Integration\njobs:\n  integration-gate:\n    name: ${workflowJobName}\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`);
  }
  return root;
}

test('consumer release enforcement flags weak GitHub consumer profiles', (t) => {
  const root = fixture(t, {
    scripts: {
      doctor: 'agentic-os doctor',
      lane: 'agentic-os start',
      land: 'agentic-os land',
    },
  });
  const profile = createRepositoryProfile({
    repository: 'github.com/example/weak-consumer',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: null,
    },
    requiredChecks: [],
    capabilities: [],
  });
  const findings = consumerReleaseEnforcementFindings(root, profile, providerPolicy(profile));
  const failed = findings.filter((entry) => !entry.ok).map((entry) => entry.id);
  assert.deepEqual(failed, [
    'consumer-provider-adapter',
    'consumer-protected-integration',
    'consumer-required-checks',
    'consumer-cleanup-policy',
    'consumer-script-release:common',
    'consumer-script-sync:canonical',
  ]);
});

test('consumer release enforcement accepts a fully governed GitHub consumer profile', (t) => {
  const root = fixture(t, {
    scripts: {
      doctor: 'agentic-os doctor',
      lane: 'agentic-os start',
      land: 'agentic-os land',
      'release:common': 'agentic-os release-common',
      'sync:canonical': 'agentic-os canonical-sync',
    },
    workflowJobName: 'Integration Gate',
  });
  const profile = createRepositoryProfile({
    repository: 'github.com/example/strong-consumer',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    requiredChecks: ['Integration Gate'],
    capabilities: ['protected-integration:pull-request'],
    cleanup: {
      localBranch: 'retain',
      remoteBranch: 'retain',
      remoteTrackingRef: 'retain',
      unreachableObjects: 'retain',
      worktreeProjection: 'remove-clean',
      worktreeRegistration: 'remove-clean',
    },
  });
  const findings = consumerReleaseEnforcementFindings(root, profile, providerPolicy(profile));
  assert.equal(findings.every((entry) => entry.ok), true);
});

test('consumer release enforcement rejects unbound required checks', (t) => {
  const root = fixture(t, {
    scripts: {
      doctor: 'agentic-os doctor',
      lane: 'agentic-os start',
      land: 'agentic-os land',
      'release:common': 'agentic-os release-common',
      'sync:canonical': 'agentic-os canonical-sync',
    },
    workflowJobName: 'Different Check',
  });
  const profile = createRepositoryProfile({
    repository: 'github.com/example/unbound-consumer',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    requiredChecks: ['Integration Gate'],
    capabilities: ['protected-integration:pull-request'],
    cleanup: {
      localBranch: 'retain',
      remoteBranch: 'retain',
      remoteTrackingRef: 'retain',
      unreachableObjects: 'retain',
      worktreeProjection: 'remove-clean',
      worktreeRegistration: 'remove-clean',
    },
  });
  const findings = consumerReleaseEnforcementFindings(root, profile, providerPolicy(profile));
  const failed = findings.filter((entry) => !entry.ok).map((entry) => entry.id);
  assert.deepEqual(failed, ['consumer-required-check-bindings']);
});
