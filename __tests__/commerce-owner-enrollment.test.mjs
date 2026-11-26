import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOwnershipPolicy } from '../bin/agentic-os-fleet.mjs';

test('Commerce enrolls the shared Design System package with its owner', () => {
  const policy = validateOwnershipPolicy(JSON.parse(readFileSync(
    new URL('../catalog/fleet-ownership.json', import.meta.url), 'utf8')));
  const responsibility = policy.responsibilities.find(row => row.id === 'shared-ui-profile');
  assert.ok(responsibility.consumers.includes('github.com/huijoohwee/agentic-commerce-os'));
  assert.ok(responsibility.reuse.some(row => row.consumer === 'github.com/huijoohwee/agentic-commerce-os'
    && row.manifest === 'package.json' && row.package === 'agentic-design-system'));
});
