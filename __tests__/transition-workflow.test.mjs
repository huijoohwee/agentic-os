import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeGitHubTransitionPolicy, validateGitHubTransitionPolicy }
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
  assert.deepEqual(policy.targetRepositories, ['github.com/huijoohwee/agentic-os']);

  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /operation_payload:/u);
  assert.match(workflow, /operation_input_digest:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /agentic-os-transition\.mjs validate-event/u);
});
