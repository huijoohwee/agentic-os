import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { selectPreservationAdoption, validateGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';

const POLICY = JSON.parse(readFileSync(new URL('../.agentic-os/github-transition-policy.json', import.meta.url), 'utf8'));
const ADOPTION = {
  schema: 'agentic-os/current-quarantine-adoption/v1',
  repository: 'github.com/huijoohwee/joohwee',
  targetRef: 'agent/device-0232231d4a19/cleanup-policy-quarantine',
  targetHead: '12a9f36769bcad5c9a4b3915f90907247d495ccc',
  merge: '07143e1a4a7e265fa0a3252e3ad57346fe5d6eda',
  reviewLocator: 'https://github.com/huijoohwee/joohwee/pull/8',
  quarantineCoordinate: '91f56f777a72b76703d71ed391a31cdaaab3ad297505981588e804b050cadd17',
  originalReceiptDigest: '14bc1d3e0b0d7c0d72ccb04446f3a4e9b45a7185cef2d805e1b5533dffe229dd',
  historicalQuarantineAuthorityProven: false,
};

test('policy enrolls the exact joohwee current-quarantine adoption', () => {
  const policy = validateGitHubTransitionPolicy(POLICY);
  assert.deepEqual(selectPreservationAdoption(policy, ADOPTION), ADOPTION);
});
