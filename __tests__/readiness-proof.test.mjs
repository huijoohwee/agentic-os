import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { claimLines, LIVE_PROOF_SCHEMA, proofMarkers, violations } from '../src/readiness-proof.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-readiness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('a readiness claim is accepted only with one existing named proof', (t) => {
  const root = fixture(t, {
    'README.md': [
      '<!-- readiness-proof kind=contract evidence=__tests__/proof.test.mjs -->',
      'The bounded checker is contract-ready.',
    ].join('\n'),
    '__tests__/proof.test.mjs': 'export const proven = true;\n',
  });
  assert.deepEqual(violations(root), []);
});

test('a strong readiness claim requires a structured passed live-provider receipt', (t) => {
  const receipt = {
    schema: LIVE_PROOF_SCHEMA,
    status: 'passed',
    provider: 'fixture',
    sourceRevision: 'a'.repeat(40),
    observedAt: '2026-09-01T00:00:00.000Z',
    check: { name: 'fixture-live-check', exitCode: 0 },
  };
  const root = fixture(t, {
    'README.md': '<!-- readiness-proof kind=live-provider evidence=proof.json -->\nRuntime ready.',
    'proof.json': `${JSON.stringify(receipt)}\n`,
  });
  assert.deepEqual(violations(root), []);
});

test('missing, unknown, absent, and none proofs fail loudly', async (t) => {
  const cases = [
    ['missing', 'This is production-ready.', 'proof-marker-count'],
    ['unknown', '<!-- readiness-proof kind=story evidence=x -->\nRuntime ready.', 'unknown-proof-kind'],
    ['absent', '<!-- readiness-proof kind=live-provider evidence=x -->\nRuntime ready.', 'missing-proof'],
    ['none', '<!-- readiness-proof kind=none evidence=- -->\nRuntime ready.', 'unsupported-readiness-claim'],
  ];
  for (const [name, text, expected] of cases) {
    await t.test(name, (child) => {
      const root = fixture(child, { 'docs/claim.md': text });
      assert.equal(violations(root)[0].kind, expected);
    });
  }
});

test('contract evidence cannot promote a runtime claim', (t) => {
  const root = fixture(t, {
    'docs/claim.md': [
      '<!-- readiness-proof kind=contract evidence=__tests__/proof.test.mjs -->',
      'Runtime ready.',
    ].join('\n'),
    '__tests__/proof.test.mjs': 'export const proof = true;\n',
  });
  assert.equal(violations(root)[0].kind, 'insufficient-proof-kind');
});

test('an arbitrary existing file is not executable contract evidence', (t) => {
  const root = fixture(t, {
    'docs/claim.md': '<!-- readiness-proof kind=contract evidence=notes.txt -->\nContract ready.',
    'notes.txt': 'trust me\n',
  });
  assert.equal(violations(root)[0].kind, 'invalid-proof-artifact');
});

test('a malformed or failed provider receipt cannot support readiness', (t) => {
  const root = fixture(t, {
    'docs/claim.md': '<!-- readiness-proof kind=live-provider evidence=proof.json -->\nProduction ready.',
    'proof.json': JSON.stringify({ schema: LIVE_PROOF_SCHEMA, status: 'failed' }),
  });
  assert.equal(violations(root)[0].kind, 'invalid-proof-artifact');
});

test('claims in fenced examples do not assert repository readiness', () => {
  assert.deepEqual(claimLines('```yaml\nstatus: runtime-ready\n```'), []);
  assert.deepEqual(proofMarkers('<!-- readiness-proof kind=doc-parse evidence=docs/x.md -->'), [
    { kind: 'doc-parse', evidence: 'docs/x.md' },
  ]);
});

test('proof paths cannot escape the repository or name a directory', async (t) => {
  for (const [name, evidence] of [['escape', '../outside'], ['directory', 'docs']]) {
    await t.test(name, (child) => {
      const marker = `<!-- readiness-proof kind=contract evidence=${evidence} -->`;
      const root = fixture(child, { 'docs/claim.md': `${marker}\nContract ready.` });
      assert.equal(violations(root)[0].kind, 'missing-proof');
    });
  }
});

test('this repository has no unsupported readiness claims', () => {
  assert.deepEqual(violations(), []);
});
