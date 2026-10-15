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
    'https://github.com/huijoohwee/agentic-os/pull/438',
    'https://github.com/huijoohwee/agentic-os/pull/441',
    'https://github.com/huijoohwee/agentic-os/pull/447',
    'https://github.com/huijoohwee/agentic-os/pull/448',
    'https://github.com/huijoohwee/agentic-os/pull/453',
    'https://github.com/huijoohwee/agentic-os/pull/454',
  ]);
  const historicalChecks = new Map([
    ['https://github.com/huijoohwee/agentic-graph/pull/1492', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-graph/pull/1504', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-os/pull/425', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/438', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/441', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/447', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/448', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/453', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/454', ['budgets', 'test']],
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
  for (const [number, baseRevision, headRevision, mergeRevision, treeRevision] of [
    ['438', 'df4f6f3c922e81f74c201946d183347430b376ac', '8cd0e1d4872fe8633f1470c6654ba219ad5d0c84', 'e1a08ce7467daeddd7d02bf37b5d81258137e5b8', 'ab4271f21113f65e9b4dc6be58ac4f6735ee6bee'],
    ['441', 'e1a08ce7467daeddd7d02bf37b5d81258137e5b8', '50c38ea3d45cdbfce817ad3e13bcc0c2886efb50', '0a62aae2c1d6dd60a1ac75164fad415dde4f809f', '0469f45ce0e1fd0ff8125b61ebdfff877f3600a7'],
    ['447', '3ee5b70fdf5d45fc67ee34ec69daf8d9dbf59835', '309f6238634a848e9b890e5ff9811db9b13ee2ad', '37948deff5d22b77425c543cc06b5ba716e88776', '264aa395dc473828718e9ea81e16d24482abc5e1'],
    ['448', '37948deff5d22b77425c543cc06b5ba716e88776', '4d7b3f6d2a5b05bfc7a02a7658f9ad8b27898953', 'b2fba11a6fec90ac7c9b2a5b1b8d9f395645532a', '276b30a5c485708fbc0a414a4e4a582b11c52a47'],
    ['453', 'a5be4e06925c6e25f176e83673283828029ce1b2', '9a366a1b98a81df2d9307091fadb1f3a55b4e791', 'aef072fbc887942055555e856ad8044d4b19d2e3', 'd58746d0eef789ec76780477b86dc9adf289f24b'],
    ['454', 'aef072fbc887942055555e856ad8044d4b19d2e3', '6076e762de5b5cc92fb53b2cb7856d6fd6aaeb5d', 'c3839e3f14f356a26e36d0211834cee4236c72cc', '17908d04eb3212a2ddd7e074f95183e0d8cb4d48'],
  ]) {
    const reviewLocator = `https://github.com/huijoohwee/agentic-os/pull/${number}`;
    assert.deepEqual(policy.historicalIntegrations.find(entry => entry.reviewLocator === reviewLocator), {
      schema: 'agentic-os/historical-content-enrollment/v1',
      repository: 'github.com/huijoohwee/agentic-os',
      reviewLocator,
      baseRevision,
      headRevision,
      mergeRevision,
      treeRevision,
      checkContexts: ['budgets', 'test'],
      adoptionScope: [`recovery/current-historical-content/pr-${number}`],
      rationale: `Current recording of PR #${number} merge content with historical protection, required-check policy, rule-suite and method authority unproven.`,
    });
  }
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
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/current-recovery-pr447',
    targetHead: '4d7b3f6d2a5b05bfc7a02a7658f9ad8b27898953',
    merge: 'b2fba11a6fec90ac7c9b2a5b1b8d9f395645532a',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/448',
    quarantineCoordinate: '242cb16bb2e2034465f883c1aa9612de6b060bc2eccee67d9955d2926b8e3dfe',
    originalReceiptDigest: '90c04dd8a9e33e945d2df291258e7b6cd29726e6bd6b7269f4d723e476117425',
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
