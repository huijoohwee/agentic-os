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
  claims: ['sha256:254d6133d0e3cc2c922ed4114b3e227810540bdf6d34a43415a671446ed5c244'],
});

test('the documented proof kinds and freshness bound are executable policy', () => {
  assert.deepEqual(PROOF_KINDS, ['live-provider', 'contract', 'doc-parse', 'none']);
  assert.equal(LIVE_PROOF_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(pkg.files.includes('docs'));
  assert.ok(pkg.files.includes('__tests__'));
});
