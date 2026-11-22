import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateMatrix, checkOwnerAuthenticity, checkValueEquivalence,
  checkPaletteDerivation, checkIndirectConsumption, checkNoCentralOverrides,
} from '../scripts/check-design-conformance.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oid = 'a'.repeat(40);
const target = 'b'.repeat(40);
const ownerId = 'github.com/huijoohwee/agentic-design-system';

function makeRepo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'design-conformance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD').trim();
  const blob = (file, revision = head) => execFileSync('git', ['-C', root, 'show', `${revision}:${file}`], { maxBuffer: 500000 });
  return { head, path: root, blob, text: file => blob(file).toString(), json: file => JSON.parse(blob(file).toString()) };
}

const projectionBytes = Buffer.from(':root{--agentic-row-height:38px}\n');
const projectionSha = `sha256:${sha(projectionBytes)}`;
const sourceBytes = Buffer.from('{"tokens":[]}\n');
const sourceSha = `sha256:${sha(sourceBytes)}`;

function baseMatrix() {
  return {
    schema: 'agentic-os/design-consumer-matrix/v1',
    owner: 'github.com/huijoohwee/agentic-os',
    designSystemOwner: ownerId,
    alignment: {
      policy: 'unified-release-with-bounded-value-equivalent-skew',
      targetRevision: target, sharedUiSourceSha256: sourceSha, sharedUiProjectionSha256: projectionSha,
      convergence: 'next-design-system-release', note: 'fixture',
    },
    consumers: [{
      repository: 'github.com/huijoohwee/agentic-sheets', kind: 'vendored-pin',
      pinPath: 'design/shared-ui-profile.pin.json', registryRevision: oid, alignment: 'value-equivalent-skew',
      sharedUiProjectionPath: 'site/vendor/shared-ui-profile.css', ownedStylesheets: ['sheets/styles.css'],
    }],
  };
}

test('matrix self-check accepts a well-formed inventory and rejects drift', () => {
  validateMatrix(baseMatrix());
  const bad = baseMatrix();
  bad.alignment.targetRevision = 'short';
  assert.throws(() => validateMatrix(bad), /target revision/u);
  const dup = baseMatrix();
  dup.consumers.push({ ...dup.consumers[0] });
  assert.throws(() => validateMatrix(dup), /duplicate consumer/u);
  const policy = baseMatrix();
  policy.alignment.policy = 'free-version-choice';
  assert.throws(() => validateMatrix(policy), /alignment policy/u);
  const legacy = baseMatrix();
  legacy.consumers = [{ repository: 'github.com/huijoohwee/agentic-canvas-os', kind: 'indirect', via: 'github.com/huijoohwee/agentic-graph', consumptionPath: 'web/build.mjs', consumptionMarker: 'agentic-graph/observability-build/v1', legacyStylesheet: { path: 'web/styles.css', active: true, reachabilityEvidence: 'x' }, ownedStylesheets: [] }];
  assert.throws(() => validateMatrix(legacy), /inactive with reachability evidence/u);
});

test('owner authenticity rejects forked source or projection bytes', t => {
  const owner = makeRepo(t, { 'site/tokens/shared-ui-profile.json': sourceBytes, 'site/vendor/shared-ui-profile.css': projectionBytes });
  const pin = { sourceRevision: owner.head, sourceSha256: sourceSha, sourcePath: 'site/tokens/shared-ui-profile.json', registryRevision: owner.head, projectionSha256: projectionSha, projectionPath: 'site/vendor/shared-ui-profile.css' };
  checkOwnerAuthenticity(owner, pin, 'sheets');
  assert.throws(() => checkOwnerAuthenticity(owner, { ...pin, projectionSha256: `sha256:${sha(Buffer.from('fork'))}` }, 'sheets'), /projection differs/u);
  assert.throws(() => checkOwnerAuthenticity(owner, { ...pin, sourceSha256: `sha256:${sha(Buffer.from('fork'))}` }, 'sheets'), /source differs/u);
});

test('value equivalence rejects delivered-value drift', () => {
  checkValueEquivalence(projectionSha, projectionSha, 'sheets');
  assert.throws(() => checkValueEquivalence(`sha256:${sha(Buffer.from('other'))}`, projectionSha, 'sheets'), /drift from the alignment target/u);
});

test('palette derivation rejects local re-authoring and forked projection', t => {
  const paletteBytes = Buffer.from('{"intents":{"primary":{"text":"text-blue-600 dark:text-blue-400"}}}\n');
  const owner = makeRepo(t, { 'site/ui-intent-palette.json': paletteBytes });
  const palette = { ownerPath: 'site/ui-intent-palette.json', projectionPath: 'grph-shared/src/ui/ui-intent-palette.json', pinPath: 'grph-shared/src/ui/ui-intent-palette.pin.json', derivationPath: 'grph-shared/src/ui/intentTokens.ts', forbiddenLiteral: 'text-blue-600' };
  const good = makeRepo(t, {
    'grph-shared/src/ui/ui-intent-palette.json': paletteBytes,
    'grph-shared/src/ui/ui-intent-palette.pin.json': JSON.stringify({ owner: ownerId, sourceRevision: owner.head, sourceSha256: `sha256:${sha(paletteBytes)}` }),
    'grph-shared/src/ui/intentTokens.ts': "import palette from './ui-intent-palette.json';\nexport const UI_INTENT_TOKENS = palette.intents;\n",
  });
  // The owner target revision must equal the pin sourceRevision; use the owner's actual head as target.
  checkPaletteDerivation(owner, good, palette, owner.head, 'graph');
  const reauthored = makeRepo(t, {
    'grph-shared/src/ui/ui-intent-palette.json': paletteBytes,
    'grph-shared/src/ui/ui-intent-palette.pin.json': JSON.stringify({ owner: ownerId, sourceRevision: owner.head, sourceSha256: `sha256:${sha(paletteBytes)}` }),
    'grph-shared/src/ui/intentTokens.ts': "export const UI_INTENT_TOKENS = { primary: { text: 'text-blue-600 dark:text-blue-400' } };\n",
  });
  assert.throws(() => checkPaletteDerivation(owner, reauthored, palette, owner.head, 'graph'), /re-authors central intent values/u);
  const forked = makeRepo(t, {
    'grph-shared/src/ui/ui-intent-palette.json': Buffer.from('{"intents":{}}\n'),
    'grph-shared/src/ui/ui-intent-palette.pin.json': JSON.stringify({ owner: ownerId, sourceRevision: owner.head, sourceSha256: `sha256:${sha(paletteBytes)}` }),
    'grph-shared/src/ui/intentTokens.ts': "import palette from './ui-intent-palette.json';\nexport const UI_INTENT_TOKENS = palette.intents;\n",
  });
  assert.throws(() => checkPaletteDerivation(owner, forked, palette, owner.head, 'graph'), /vendored palette differs/u);
});

test('indirect consumption rejects a reachable legacy stylesheet', t => {
  const entry = { consumptionPath: 'web/build.mjs', consumptionMarker: 'agentic-graph/observability-build/v1', legacyStylesheet: { path: 'web/styles.css', active: false, reachabilityEvidence: 'unreferenced' } };
  const good = makeRepo(t, { 'web/build.mjs': "const schema='agentic-graph/observability-build/v1';\n", 'web/index.html': '<link href="./app.css">', 'web/styles.css': ':root{--bg:#000}' });
  checkIndirectConsumption(good, entry, 'canvas');
  const reachable = makeRepo(t, { 'web/build.mjs': "const schema='agentic-graph/observability-build/v1';\n", 'web/index.html': '<link href="./styles.css">', 'web/styles.css': ':root{--bg:#000}' });
  assert.throws(() => checkIndirectConsumption(reachable, entry, 'canvas'), /reachable/u);
  const noMarker = makeRepo(t, { 'web/build.mjs': "const schema='other';\n", 'web/styles.css': ':root{--bg:#000}' });
  assert.throws(() => checkIndirectConsumption(noMarker, entry, 'canvas'), /verified Graph output/u);
});

test('central-variable override scan rejects redeclaration in authored stylesheets', t => {
  const centralVars = new Set(['--agentic-row-height', '--agentic-font-size-body']);
  const clean = makeRepo(t, { 'sheets/styles.css': ':root{--local-gap:12px}' });
  checkNoCentralOverrides(clean, ['sheets/styles.css'], centralVars, 'sheets');
  const override = makeRepo(t, { 'sheets/styles.css': ':root{--agentic-row-height:40px}' });
  assert.throws(() => checkNoCentralOverrides(override, ['sheets/styles.css'], centralVars, 'sheets'), /redeclares centrally owned/u);
});