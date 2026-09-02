import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const README_PATH = new URL('../README.md', import.meta.url);
const GUIDE_PATH = new URL('../guides/COMPOSITION-ARCHITECTURE.md', import.meta.url);
const GUIDE_LINK = 'guides/COMPOSITION-ARCHITECTURE.md';

function read(path) {
  return readFileSync(path, 'utf8');
}

function exactTableRow(text, first, second = null) {
  const prefix = second === null ? `| \`${first}\` |` : `| \`${first}\` | \`${second}\` |`;
  const rows = text.split('\n').filter((line) => line.startsWith(prefix));
  assert.equal(rows.length, 1, `expected one table row for ${first}${second ? ` -> ${second}` : ''}`);
  return rows[0];
}

test('composition architecture is discoverable and bounded', () => {
  const readme = read(README_PATH);
  const guide = read(GUIDE_PATH);

  assert.match(readme, new RegExp(`\\[composition architecture\\]\\(${GUIDE_LINK}\\)`));
  assert.ok(statSync(GUIDE_PATH).isFile());
  assert.ok(Buffer.byteLength(guide) < 500_000);
  assert.ok(guide.split('\n').length - 1 < 600);
  assert.equal(readFileSync(join(ROOT, GUIDE_LINK), 'utf8'), guide);
});

test('composition architecture binds its source and repository evidence', () => {
  const guide = read(GUIDE_PATH);
  const legacySlug = ['know', 'grph'].join('');
  const requiredEvidence = [
    'sha256:5e646e3afce86c05415c3f2545282603f3e58d77440382c6ab3fb5dc78e39418',
    '99dd3d18d573c2ccf7616e29dad15aad94359b84',
    '3c597227dbb1101a2d5d75cb83a8496e22357a0e',
    '9ba90b95bcde38db9f25f6b945ba66cfd264e735',
    'd5323bc35a62cf2dace300990d5ee0db228897d8',
    `https://github.com/huijoohwee/${legacySlug}/tree/9ba90b95bcde38db9f25f6b945ba66cfd264e735`,
  ];

  for (const evidence of requiredEvidence) assert.ok(guide.includes(evidence), evidence);
  assert.match(guide, /execution_gate: "runtime-source-authorized"/);
  assert.match(guide, /local_rung: "dev-proven"/);
  assert.match(guide, /delivered_rung: "undocumented"/);
});

test('composition architecture keeps product terminology canonical', () => {
  const readme = read(README_PATH);
  const guide = read(GUIDE_PATH);
  const legacySlug = ['know', 'grph'].join('');
  const legacySlugs = guide.match(new RegExp(legacySlug, 'gi')) ?? [];

  assert.match(readme, /`agentic-graph`/);
  assert.doesNotMatch(`${readme}\n${guide}`, /AgenticGraph/);
  assert.match(guide, /primary B2C Marketplace Storefront and\s+Orchestration Hub/);
  assert.doesNotMatch(`${readme}\n${guide}`, /\bKG(?:_|\b)/);
  assert.equal(legacySlugs.length, 1, 'only the immutable source locator may retain the legacy slug');
});

test('composition architecture carries the publication and runtime acceptance contracts', () => {
  const guide = read(GUIDE_PATH);
  const requiredSections = [
    '## Division of Work',
    'Diagram COMP-1',
    'Diagram TOP-1',
    '### DR-1',
    '### DR-2',
    '### DR-3',
    '### DR-4',
    '### DR-5',
    '## Cross-repository acceptance contract',
    '### Runtime RAO',
    'VCC-DOC-PUBLISH-01',
    'RAO-DOC-01',
    'RAO-DOC-02',
    'RAO-DOC-03',
    'RAO-DOC-04',
    'OP-20260903-FIX-RELEASE',
    '## Known gaps',
  ];

  for (const section of requiredSections) assert.ok(guide.includes(section), section);
  for (let index = 1; index <= 10; index += 1) {
    assert.ok(guide.includes(`RAO-RUNTIME-${String(index).padStart(2, '0')}`));
  }
  assert.match(guide, /directive_id: "DIR-DOC-PUBLISH-01"/);
  for (const rao of ['RAO-DOC-01', 'RAO-DOC-02', 'RAO-DOC-03', 'RAO-DOC-04']) {
    const row = exactTableRow(guide, rao);
    assert.match(row, /DIR-DOC-PUBLISH-01/);
    assert.match(row, /AC-DOC-PUBLISH-01/);
    assert.match(row, /DE-DOC-PUBLISH-01/);
  }
  for (const vcc of [
    'VCC-RUNTIME-OWNERSHIP-01',
    'VCC-RUNTIME-AUTHORITY-02',
    'VCC-RUNTIME-X402-03',
  ]) assert.match(exactTableRow(guide, vcc), /\| Unsatisfied;/);

  for (const [source, target, expected] of [
    ['CANVAS', 'AG', 'unverified'],
    ['COMMERCE', 'CANVAS', 'unverified'],
    ['AG', 'DISCOVERY', 'unverified'],
    ['AG', 'CHECKOUT', 'unverified'],
    ['AG', 'MARKET', 'unverified'],
    ['COMMERCE', 'DISCOVERY', 'unverified'],
    ['COMMERCE', 'CHECKOUT', 'unverified'],
    ['COMMERCE', 'MARKET', 'unverified'],
    ['COMMERCE_CORE', 'ACOS_ADM', 'unverified'],
    ['COMMERCE_CORE', 'DISCOVERY_RT', 'unverified'],
    ['COMMERCE_CORE', 'CHECKOUT_RT', 'unverified'],
    ['COMMERCE_CORE', 'MARKET_RT', 'unverified'],
    ['CHECKOUT_RT', 'MARKET_RT', 'unverified'],
    ['AG_PAY', 'X402_FAC', 'unverified'],
  ]) assert.match(exactTableRow(guide, source, target), new RegExp(expected));

  for (const edge of [
    'CANVAS -.->|"batch · shared invocation/safety contract"| AG',
    'COMMERCE -.->|"sync request · admission"| CANVAS',
    'COMMERCE_CORE -.->|"sync request · admission"| ACOS_ADM',
    'CHECKOUT_RT -.->|"sync request · MARKETPLACE_SERVICE"| MARKET_RT',
  ]) assert.ok(guide.includes(edge), edge);
  assert.match(guide, /runtime-source directive/i);
  assert.doesNotMatch(guide, /\| `VCC-RUNTIME-[^`]+` \|[^\n]+\| Satisfied/);
});
