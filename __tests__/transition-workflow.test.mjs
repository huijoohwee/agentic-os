import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA, encodeGitHubTransitionPolicy, validateGitHubTransitionPolicy }
  from '../src/github-transition-policy.mjs';

const policyPath = new URL('../.agentic-os/github-transition-policy.json', import.meta.url);
const workflowPath = new URL('../.github/workflows/adlc-transition.yml', import.meta.url);

test('committed transition workflow is bound to the canonical authority policy', () => {
  const bytes = readFileSync(policyPath);
  const policy = validateGitHubTransitionPolicy(JSON.parse(bytes));
  assert.deepEqual(bytes, encodeGitHubTransitionPolicy(policy));
  assert.equal(policy.authorityRepository, 'github.com/huijoohwee/agentic-os');
  assert.equal(policy.authorityRef, 'refs/heads/main');
  assert.equal(policy.workflowPath, '.github/workflows/adlc-transition.yml');
  assert.deepEqual(policy.targetRepositories, [
    'github.com/huijoohwee/GameXR',
    'github.com/huijoohwee/agentic-graph',
    'github.com/huijoohwee/agentic-os',
  ]);

  assert.equal(policy.schema, GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA);
  assert.deepEqual(policy.historicalIntegrations.map(entry => entry.reviewLocator), [
    'https://github.com/huijoohwee/agentic-graph/pull/1492',
    'https://github.com/huijoohwee/agentic-graph/pull/1504',
    'https://github.com/huijoohwee/agentic-os/pull/425',
  ]);
  const historicalChecks = new Map([
    ['https://github.com/huijoohwee/agentic-graph/pull/1492', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-graph/pull/1504', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-os/pull/425', ['budgets', 'test']],
  ]);
  for (const entry of policy.historicalIntegrations) {
    assert.deepEqual(entry.checkContexts, historicalChecks.get(entry.reviewLocator));
    assert.deepEqual(entry.adoptionScope, [`recovery/current-historical-content/pr-${entry.reviewLocator.split('/').at(-1)}`]);
  }
  assert.deepEqual(policy.historicalIntegrations.find(entry => entry.reviewLocator.endsWith('/425')), {
    schema: 'agentic-os/historical-content-enrollment/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/425',
    baseRevision: '2834a81c5f7d7e30efaa2d0a712ddacd64cd063d',
    headRevision: 'afa0662ec056b849c0d7fb85ed80fb7e7cb641bc',
    mergeRevision: '7f4988180fc5fc369929757fc71a8c928ef8a620',
    treeRevision: 'e3c8a87c8495c4039d597f78d9b2c548112f2656',
    checkContexts: ['budgets', 'test'],
    adoptionScope: ['recovery/current-historical-content/pr-425'],
    rationale: 'Current recording of PR #425 merge content with historical protection, required-check policy, rule-suite and method authority unproven.',
  });
  assert.equal(policy.preservationAdoptions[0].historicalSuccessionAuthorityProven, false);
  assert.deepEqual(policy.retentionAdoptions, [{
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-cba000d3779d/software-forensics-preset',
    targetHead: 'e17b54e4a574a8086ecb53fd9b7d242dc79fbc82',
    merge: '3846c48dba4b40702451640e3e78e6bcc91408f4',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/397',
    quarantineCoordinate: '4b73b84c47d82b1ec6f4a70ce06e8c1ea1a56ac6e48000dbbaebeac944d505f6',
    originalReceiptDigest: 'fa4ed263252951ee38e86821285e64be81ad3d2f5255c4505c8df70aa9932265',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-graph',
    targetRef: 'agent/device-0232231d4a19/browser-history-authorization-stop',
    targetHead: 'bf533bf09735732b2f225fde161c859c4ba66ee3',
    merge: 'ebd4bc5e92cd283c04196ab77d024366a4f45ac3',
    reviewLocator: 'https://github.com/huijoohwee/agentic-graph/pull/1492',
    quarantineCoordinate: '4defda64b9a1b27648c9f058de59a85a01ee30c292f554cf0030ea3a7267dacd',
    originalReceiptDigest: 'd66754a10cb0decfdd527f930d89c52f2875f91cba2799611527518e4ac85696',
    historicalQuarantineAuthorityProven: false,
  }]);

  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /operation_payload:/u);
  assert.match(workflow, /operation_input_digest:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /agentic-os-transition\.mjs validate-event/u);
});
