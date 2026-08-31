import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { claimLines, proofMarkers, violations } from '../src/readiness-proof.mjs';

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
      '<!-- readiness-proof kind=contract evidence=proof.test.mjs -->',
      'The bounded command is runtime-ready.',
    ].join('\n'),
    'proof.test.mjs': 'export const proven = true;\n',
  });
  assert.deepEqual(violations(root), []);
});

test('missing, unknown, absent, and none proofs fail loudly', async (t) => {
  const cases = [
    ['missing', 'This is production-ready.', 'proof-marker-count'],
    ['unknown', '<!-- readiness-proof kind=story evidence=x -->\nRuntime ready.', 'unknown-proof-kind'],
    ['absent', '<!-- readiness-proof kind=contract evidence=x -->\nRuntime ready.', 'missing-proof'],
    ['none', '<!-- readiness-proof kind=none evidence=- -->\nRuntime ready.', 'unsupported-readiness-claim'],
  ];
  for (const [name, text, expected] of cases) {
    await t.test(name, (child) => {
      const root = fixture(child, { 'docs/claim.md': text });
      assert.equal(violations(root)[0].kind, expected);
    });
  }
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
      const root = fixture(child, { 'docs/claim.md': `${marker}\nRuntime ready.` });
      assert.equal(violations(root)[0].kind, 'missing-proof');
    });
  }
});

test('this repository has no unsupported readiness claims', () => {
  assert.deepEqual(violations(), []);
});
