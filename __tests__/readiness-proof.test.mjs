import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  claimLines,
  CONTRACT_PROOF_SCHEMA,
  LIVE_PROOF_SCHEMA,
  proofMarkers,
  violations,
} from '../src/readiness-proof.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-readiness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const digest = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
function executableTest(claim) {
  return [
    "import { test } from 'node:test';",
    `export const READINESS_PROOF = ${JSON.stringify({
      schema: CONTRACT_PROOF_SCHEMA,
      claims: [digest(claim)],
    })};`,
    "test('claim-bound proof', () => {});",
    '',
  ].join('\n');
}

test('a readiness claim is accepted only with one existing named proof', (t) => {
  const claim = [
    '<!-- readiness-proof kind=contract evidence=__tests__/proof.test.mjs -->',
    'The bounded checker is contract-ready.',
  ].join('\n');
  const root = fixture(t, {
    'README.md': claim,
    '__tests__/proof.test.mjs': executableTest(claim),
  });
  assert.deepEqual(violations(root), []);
});

test('a strong readiness claim requires a structured passed live-provider receipt', (t) => {
  const claim = '<!-- readiness-proof kind=live-provider evidence=proof.json -->\nRuntime ready.';
  const receipt = {
    schema: LIVE_PROOF_SCHEMA,
    status: 'passed',
    provider: 'fixture',
    target: 'fixture-runtime',
    sourceRevision: 'a'.repeat(40),
    observedAt: '2026-09-01T00:00:00.000Z',
    claim: { path: 'README.md', digest: digest(claim) },
    check: { name: 'fixture-live-check', exitCode: 0, receipt: 'fixture:run/1' },
  };
  const root = fixture(t, {
    'README.md': claim,
    'proof.json': `${JSON.stringify(receipt)}\n`,
  });
  const options = {
    headRevision: 'a'.repeat(40),
    isSourceClean: () => true,
    verifyLiveProvider: () => true,
    now: () => Date.parse('2026-09-02T00:00:00.000Z'),
  };
  assert.deepEqual(violations(root, options), []);
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
  const claim = [
    '<!-- readiness-proof kind=contract evidence=__tests__/proof.test.mjs -->',
    'Runtime ready.',
  ].join('\n');
  const root = fixture(t, {
    'docs/claim.md': claim,
    '__tests__/proof.test.mjs': executableTest(claim),
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

test('a self-attested live receipt cannot promote readiness', (t) => {
  const claim = '<!-- readiness-proof kind=live-provider evidence=proof.json -->\nProduction ready.';
  const receipt = {
    schema: LIVE_PROOF_SCHEMA,
    status: 'passed',
    provider: 'fixture',
    target: 'prod',
    sourceRevision: 'a'.repeat(40),
    observedAt: '2026-09-01T00:00:00.000Z',
    claim: { path: 'docs/claim.md', digest: digest(claim) },
    check: { name: 'live', exitCode: 0, receipt: 'locally-written' },
  };
  const root = fixture(t, {
    'docs/claim.md': claim,
    'proof.json': JSON.stringify(receipt),
  });
  const options = {
    headRevision: 'a'.repeat(40),
    isSourceClean: () => true,
    now: () => Date.parse('2026-09-02T00:00:00.000Z'),
  };
  assert.equal(violations(root, options)[0].kind, 'invalid-proof-artifact');
});

test('same-line markers cannot hide claims', (t) => {
  const text = 'Runtime ready. <!-- readiness-proof kind=none evidence=- -->';
  const root = fixture(t, { 'docs/claim.md': text });
  assert.equal(violations(root)[0].kind, 'unsupported-readiness-claim');
});

test('live proof is bound to current source, exact claim bytes, target, and time', async (t) => {
  const claim = '<!-- readiness-proof kind=live-provider evidence=proof.json -->\nProduction ready.';
  const valid = {
    schema: LIVE_PROOF_SCHEMA,
    status: 'passed',
    provider: 'fixture',
    target: 'prod',
    sourceRevision: 'a'.repeat(40),
    observedAt: '2026-09-01T00:00:00.000Z',
    claim: { path: 'docs/claim.md', digest: digest(claim) },
    check: { name: 'live', exitCode: 0, receipt: 'fixture:1' },
  };
  for (const [name, change] of [
    ['source', { sourceRevision: 'c'.repeat(40) }],
    ['future', { observedAt: '2026-09-03T00:00:00.000Z' }],
    ['claim', { claim: { ...valid.claim, digest: `sha256:${'0'.repeat(64)}` } }],
    ['target', { target: '' }],
  ]) {
    await t.test(name, (child) => {
      const root = fixture(child, {
        'docs/claim.md': claim,
        'proof.json': JSON.stringify({ ...valid, ...change }),
      });
      const options = {
        headRevision: 'a'.repeat(40),
        isSourceClean: () => true,
        verifyLiveProvider: () => true,
        now: () => Date.parse('2026-09-02T00:00:00.000Z'),
      };
      assert.equal(violations(root, options)[0].kind, 'invalid-proof-artifact');
    });
  }
});

test('live proof rejects committed and dirty source drift', (t) => {
  const claim = '<!-- readiness-proof kind=live-provider evidence=proof.json -->\nProduction ready.';
  const root = fixture(t, {
    'docs/claim.md': claim,
    'src/runtime.mjs': 'export const value = 1;\n',
  });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const receipt = {
    schema: LIVE_PROOF_SCHEMA,
    status: 'passed',
    provider: 'fixture',
    target: 'prod',
    sourceRevision: head,
    observedAt: '2026-09-01T00:00:00.000Z',
    claim: { path: 'docs/claim.md', digest: digest(claim) },
    check: { name: 'live', exitCode: 0, receipt: 'fixture:1' },
  };
  writeFileSync(join(root, 'proof.json'), JSON.stringify(receipt));
  const options = {
    now: () => Date.parse('2026-09-02T00:00:00.000Z'),
    verifyLiveProvider: () => true,
  };
  assert.deepEqual(violations(root, options), []);

  writeFileSync(join(root, 'src/runtime.mjs'), 'export const value = 2;\n');
  assert.equal(violations(root, options)[0].kind, 'invalid-proof-artifact');

  writeFileSync(join(root, 'src/runtime.mjs'), 'export const value = 1;\n');
  execFileSync('git', ['update-index', '--assume-unchanged', 'src/runtime.mjs'], { cwd: root });
  writeFileSync(join(root, 'src/runtime.mjs'), 'export const value = 3;\n');
  assert.equal(violations(root, options)[0].kind, 'invalid-proof-artifact');
  execFileSync('git', ['update-index', '--no-assume-unchanged', 'src/runtime.mjs'], { cwd: root });
  writeFileSync(join(root, 'src/runtime.mjs'), 'export const value = 4;\n');

  execFileSync('git', ['add', 'src/runtime.mjs'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'runtime drift'], { cwd: root });
  assert.equal(violations(root, options)[0].kind, 'invalid-proof-artifact');
});

test('claims in fenced examples do not assert repository readiness', () => {
  assert.deepEqual(claimLines('```yaml\nstatus: runtime-ready\n```'), []);
  assert.deepEqual(claimLines('~~~~\nRuntime ready.\n~~~~'), []);
  assert.deepEqual(claimLines('````\n```\nRuntime ready.\n````'), []);
  assert.deepEqual(claimLines('```lang`oops\nProduction ready.'), [2]);
  assert.deepEqual(claimLines('This is not production-ready.'), []);
  assert.deepEqual(claimLines("This isn't production-ready."), []);
  assert.deepEqual(claimLines('Do not call this runtime-ready.'), []);
  assert.deepEqual(claimLines('Although this is not certified, it is production-ready.'), [1]);
  assert.deepEqual(claimLines('This was not production-ready yesterday, but it is production-ready today.'), [1]);
  assert.deepEqual(claimLines('This is not only contract-ready; it is useful.'), [1]);
  assert.deepEqual(claimLines('    ```\nRuntime ready.\n    ```'), [2]);
  assert.deepEqual(proofMarkers('<!-- readiness-proof kind=doc-parse evidence=docs/x.md -->'), [
    { kind: 'doc-parse', evidence: 'docs/x.md' },
  ]);
});

test('only direct executable tests can support contract claims', async (t) => {
  for (const [name, path, body] of [
    ['nested', '__tests__/nested/proof.test.mjs', executableTest('Contract ready.')],
    ['hidden', '__tests__/.proof.test.mjs', executableTest('Contract ready.')],
    ['not-executable', '__tests__/proof.test.mjs', 'export const proof = true;\n'],
    ['spoofed', '__tests__/proof.test.mjs', "// from 'node:test'; test('proof', () => {});\n"],
    ['tap-spoofed', '__tests__/proof.test.mjs', [
      `export const READINESS_PROOF = ${JSON.stringify({
        schema: CONTRACT_PROOF_SCHEMA,
        claims: [digest('<!-- readiness-proof kind=contract evidence=__tests__/proof.test.mjs -->\nContract ready.')],
      })};`,
      "console.log('# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');",
    ].join('\n')],
    ['skipped', '__tests__/proof.test.mjs', [
      "import { test } from 'node:test';",
      `export const READINESS_PROOF = ${JSON.stringify({
        schema: CONTRACT_PROOF_SCHEMA,
        claims: [digest('<!-- readiness-proof kind=contract evidence=__tests__/proof.test.mjs -->\nContract ready.')],
      })};`,
      "test.skip('not executed', () => { throw new Error('unproven'); });",
    ].join('\n')],
    ['unbound', '__tests__/proof.test.mjs', executableTest('Some other contract-ready claim.')],
  ]) {
    await t.test(name, (child) => {
      const marker = `<!-- readiness-proof kind=contract evidence=${path} -->`;
      const root = fixture(child, { 'docs/claim.md': `${marker}\nContract ready.`, [path]: body });
      assert.equal(violations(root)[0].kind, 'invalid-proof-artifact');
    });
  }
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
