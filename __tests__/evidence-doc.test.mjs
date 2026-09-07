import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTRACT_PROOF_SCHEMA,
  LIVE_PROOF_MAX_AGE_MS,
  PROOF_KINDS,
} from '../src/readiness-proof.mjs';

export const READINESS_PROOF = Object.freeze({
  schema: CONTRACT_PROOF_SCHEMA,
  claims: ['sha256:68d1a742d8f46ee9fe30f7452017a1978e7d746dab5a1bf1738e9dda1da152d7'],
});

test('the documented proof kinds and freshness bound are executable policy', () => {
  assert.deepEqual(PROOF_KINDS, ['live-provider', 'contract', 'doc-parse', 'none']);
  assert.equal(LIVE_PROOF_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(pkg.files.includes('docs'));
  assert.ok(pkg.files.includes('__tests__'));
});
