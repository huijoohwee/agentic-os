import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(join(root, 'catalog/costs.json')));
const roadmap = JSON.parse(readFileSync(join(root, 'catalog/feature-roadmap.json')));
const ownId = 'github.com/huijoohwee/agentic-os';
const sha = /^[0-9a-f]{40}$/u;
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', timeout: 10000, maxBuffer: 500000, stdio: ['ignore', 'pipe', 'pipe'],
}).trimEnd();
const field = (source, name) => source.match(new RegExp(`^${name}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'mu'))?.[1]?.trim();
const frontmatter = source => source.startsWith('---\n') ? source.split('\n---\n')[0] : '';
function safeRef(ref) {
  assert.match(ref.revision, sha);
  assert.ok(typeof ref.path === 'string' && ref.path.length > 0 && !ref.path.startsWith('/')
    && !ref.path.includes('\\') && ref.path.split('/').every(part => part && part !== '.' && part !== '..'));
}
function observe(repo, ref, roots) {
  if (!roots[repo]) return null;
  const checkout = realpathSync(roots[repo]);
  assert.equal(git(checkout, 'rev-parse', '--show-toplevel'), checkout);
  const origin = git(checkout, 'config', '--get', 'remote.origin.url')
    .replace(/\.git$/u, '').replace(/^git@github\.com:/u, 'github.com/').replace(/^https:\/\//u, '');
  assert.equal(origin, repo);
  return git(checkout, 'show', `${ref.revision}:${ref.path}`);
}

test('every roadmap feature joins one owner cost scope without duplicate attribution', () => {
  assert.equal(index.schema, 'agentic-os/cost-index/v1');
  assert.equal(index.incrementalPaidSpendCapUsd, 0);
  assert.ok(index.scopes.length > 0 && index.scopes.length <= 256);
  for (const ref of [index.guideline, index.financialContract]) {
    safeRef(ref);
    assert.equal(ref.repository, 'github.com/huijoohwee/huijoohwee.github.io');
    assert.match(ref.version, /^\d+\.\d+\.\d+$/u);
  }
  const features = new Map(roadmap.entries.map(feature => [feature.id, feature]));
  const ids = new Set(), joined = new Set();
  for (const scope of index.scopes) {
    assert.match(scope.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(!ids.has(scope.id), `unique scope ${scope.id}`); ids.add(scope.id);
    assert.ok(scope.featureIds.length > 0 && scope.featureIds.length <= 16);
    assert.equal(new Set(scope.featureIds).size, scope.featureIds.length);
    for (const id of scope.featureIds) {
      const feature = features.get(id);
      assert.ok(feature, `known feature ${id}`);
      assert.equal(feature.costScopeId, scope.id, `${id} cost join`);
      assert.equal(feature.owner, scope.owner, `${id} owner`);
      assert.ok(!joined.has(id), `single attribution ${id}`); joined.add(id);
    }
    safeRef(scope.source);
    if (scope.financialModel.status === 'not-recorded') assert.equal(scope.financialModel.path, undefined);
    else {
      assert.equal(scope.financialModel.status, 'incomplete-discovery');
      safeRef(scope.financialModel);
      assert.match(scope.financialModel.anchor, /^[a-z0-9-]+$/u);
    }
    assert.ok(['unreported', 'reported'].includes(scope.actuals.status));
    assert.ok(Array.isArray(scope.actuals.receiptRefs));
    assert.equal(scope.actuals.status === 'unreported', scope.actuals.receiptRefs.length === 0);
    assert.ok(['unknown', 'incomplete', 'complete'].includes(scope.forecast.status));
    assert.ok(Array.isArray(scope.forecast.scenarioRefs));
    if (scope.forecast.status === 'complete') assert.equal(scope.forecast.scenarioRefs.length, 3);
    else assert.equal(scope.forecast.scenarioRefs.length, 0);
  }
  assert.deepEqual([...joined].sort(), [...features.keys()].sort());
});

test('pinned cost sources and financial contract resolve to their owners', t => {
  const rootsFile = process.env.AGENTIC_OS_FEATURE_ROADMAP_ROOTS;
  assert.ok(!rootsFile || isAbsolute(rootsFile), 'roots map must be absolute');
  const roots = rootsFile ? JSON.parse(readFileSync(rootsFile)) : { [ownId]: root };
  const guideline = observe(index.guideline.repository, index.guideline, roots);
  const contract = observe(index.financialContract.repository, index.financialContract, roots);
  if (guideline) assert.equal(field(frontmatter(guideline), 'version'), index.guideline.version);
  else t.diagnostic('website guideline blob awaits explicit checkout mapping');
  if (contract) {
    assert.equal(field(frontmatter(contract), 'version'), index.financialContract.version);
    assert.match(contract, /^### ADLC Cost Ledger$/mu);
  } else t.diagnostic('website financial contract blob awaits explicit checkout mapping');
  for (const scope of index.scopes) {
    const source = observe(scope.owner, scope.source, roots);
    if (!source) { t.diagnostic(`${scope.owner}: cost source awaits explicit checkout mapping`); continue; }
    if (scope.source.kind === 'observation-contract') assert.match(source, /costUsd: null/u);
    if (scope.source.kind === 'authoring-ledger') assert.match(source, /^### ADLC cost ledger$/mu);
    if (scope.source.kind === 'tco-assumptions') assert.match(source, /^## TCO comparison$/mu);
    if (scope.financialModel.path) {
      const model = observe(scope.owner, scope.financialModel, roots);
      assert.match(model, /^### Discovery financial model$/mu);
    }
    if (scope.finding === 'owner-tco-includes-paid-variant') assert.match(source, /\$15[–-]40\/mo/u);
  }
});

test('portfolio view links the registry, pinned guideline and all distinct scopes', () => {
  const source = readFileSync(join(root, 'guides/COSTS.md'), 'utf8');
  assert.match(source, /\.\.\/catalog\/costs\.json/u);
  for (const ref of [index.guideline, index.financialContract]) {
    assert.ok(source.includes(`https://${ref.repository}/blob/${ref.revision}/${ref.path}`));
  }
  for (const scope of index.scopes) assert.ok(source.includes(`\`${scope.id}\``), scope.id);
});
