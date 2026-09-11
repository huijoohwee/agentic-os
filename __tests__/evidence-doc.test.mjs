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
  claims: ['sha256:8cd1bd5fe8880326a1ea1c36134b6c0f6c3b9458e1ee6f612dff54e8d377acab'],
});

test('the documented proof kinds and freshness bound are executable policy', () => {
  assert.deepEqual(PROOF_KINDS, ['live-provider', 'contract', 'doc-parse', 'none']);
  assert.equal(LIVE_PROOF_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(pkg.files.includes('docs'));
  assert.ok(pkg.files.includes('__tests__'));
});
