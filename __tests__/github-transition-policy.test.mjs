import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';

const policy = JSON.parse(readFileSync(new URL('../.agentic-os/github-transition-policy.json', import.meta.url), 'utf8'));
const reviewLocator = 'https://github.com/huijoohwee/agentic-os/pull/487';

test('committed PR 487 recovery enrollment binds current merge facts and selected checks', () => {
  const entry = policy.historicalIntegrations.find(row => row.reviewLocator === reviewLocator);
  assert.deepEqual(entry, {
    adoptionScope: ['recovery/current-historical-content/pr-487'],
    baseRevision: '7ba0649e97f9c550c5e4d333d768b1cb7464397e',
    checkContexts: ['budgets', 'test'],
    headRevision: 'c9a88dc1bb69528c104b8e49b69ab58dcab0e45b',
    mergeRevision: '26a98d41c43bc8eefa5b9374b38951ce2ef755a3',
    rationale: 'Owner-delegated current recovery recording of PR #487 merge content; historical protection, required-check policy, Ruleset Suite and merge-method authority remain unproven.',
    repository: 'github.com/huijoohwee/agentic-os',
    reviewLocator,
    schema: 'agentic-os/historical-content-enrollment/v1',
    treeRevision: 'c08eda8f49bf377cd6a5916d9268a7b755eb0f83',
  });
  assert.ok(validateGitHubTransitionPolicy(policy).historicalIntegrations.some(row => row.reviewLocator === reviewLocator));
});

test('committed PR 493 recovery enrollment binds current merge facts and selected checks', () => {
  const locator = 'https://github.com/huijoohwee/agentic-os/pull/493';
  const entry = policy.historicalIntegrations.find(row => row.reviewLocator === locator);
  assert.deepEqual(entry, {
    adoptionScope: ['recovery/current-historical-content/pr-493'],
    baseRevision: '171e19525a35c85c7613d2a0573b005fdd58a463',
    checkContexts: ['budgets', 'test'],
    headRevision: '4446cffdb1f38843550dae6cca32a0148573c6cf',
    mergeRevision: '93183ba8748e8168bf2ed1fe29a95c7a89ff1e46',
    rationale: 'Owner-delegated current recovery recording of PR #493 merge content; historical protection, required-check policy, Ruleset Suite and merge-method authority remain unproven.',
    repository: 'github.com/huijoohwee/agentic-os',
    reviewLocator: locator,
    schema: 'agentic-os/historical-content-enrollment/v1',
    treeRevision: '360daf5126f5f079d2532c3c9dbf3a81bf8ba543',
  });
  assert.ok(validateGitHubTransitionPolicy(policy).historicalIntegrations.some(row => row.reviewLocator === locator));
});
