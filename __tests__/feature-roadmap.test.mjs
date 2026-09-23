import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ownId = 'github.com/huijoohwee/agentic-os';
const catalog = JSON.parse(readFileSync(join(root, 'catalog/feature-roadmap.json')));
const owners = new Set(JSON.parse(readFileSync(join(root, 'catalog/fleet-ownership.json'))).repositories.map(row => row.id));
const candidates = new Set(JSON.parse(readFileSync(join(root, 'catalog/features.json'))).candidates.map(row => row.id));
const stage = { proposed: 'Future', planned: 'Future', developing: 'Current', active: 'Current', retired: 'Past', cancelled: 'Past' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 500000, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const field = (source, name) => source.match(new RegExp(`^${name}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'mu'))?.[1]?.trim();
const ref = (value, label) => {
  assert.ok(value && typeof value === 'object', `${label} exists`);
  assert.match(value.revision, /^[0-9a-f]{40}$/u, `${label} exact revision`);
  assert.ok(typeof value.path === 'string' && value.path && !value.path.startsWith('/') && !value.path.includes('\\')
    && value.path.split('/').every(part => part && part !== '.' && part !== '..'), `${label} safe path`);
};
function validate(entries) {
  const ids = new Set();
  for (const row of entries) {
    assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(!ids.has(row.id), `unique feature ${row.id}`); ids.add(row.id);
    assert.ok(owners.has(row.owner), `registered owner ${row.id}`);
    assert.ok(stage[row.lifecycle], `lifecycle ${row.id}`);
    assert.ok(['spec-only', 'source-observed'].includes(row.readiness), `readiness ${row.id}`);
    for (const key of ['title', 'nextAction']) assert.ok(typeof row[key] === 'string' && row[key].length > 0 && row[key].length <= 240);
    ref(row.plan, `${row.id} plan`);
    assert.ok(row.plan.continuityId && row.plan.version, `${row.id} plan identity`);
    ref(row.guideline, `${row.id} guideline`);
    assert.equal(row.guideline.repository, 'github.com/huijoohwee/huijoohwee.github.io');
    assert.equal(row.guideline.path, 'guidelines/prd-tad-adr-mvp-gtm-guidelines.md');
    assert.ok(/^\d+\.\d+\.\d+$/u.test(row.guideline.version), `${row.id} guideline version`);
    if (row.implementation) ref(row.implementation, `${row.id} implementation`);
    if (row.check) ref(row.check, `${row.id} check`);
    if (row.readiness === 'source-observed') assert.ok(row.implementation, `${row.id} source observation`);
    if (row.lifecycle === 'active') assert.equal(row.readiness, 'source-observed');
    if (row.commercialCandidateId) assert.ok(candidates.has(row.commercialCandidateId));
    if (row.reviewUrl) assert.match(row.reviewUrl, new RegExp(`^https://${row.owner}/pull/[1-9][0-9]*$`, 'u'));
    assert.ok(Array.isArray(row.dependencies) && row.dependencies.length <= 16);
    assert.equal(new Set(row.dependencies).size, row.dependencies.length);
  }
  const byId = new Map(entries.map(row => [row.id, row]));
  const visited = new Set(), visiting = new Set();
  const walk = feature => {
    assert.ok(!visiting.has(feature), `acyclic dependency ${feature}`);
    if (visited.has(feature)) return;
    visiting.add(feature);
    for (const dependency of byId.get(feature).dependencies) {
      assert.ok(byId.has(dependency), `existing dependency ${dependency}`);
      walk(dependency);
    }
    visiting.delete(feature); visited.add(feature);
  };
  for (const feature of byId.keys()) walk(feature);
}
function observe(entry, checkout, roots) {
  const canonical = realpathSync(checkout);
  assert.equal(git(canonical, 'rev-parse', '--show-toplevel'), canonical);
  const origin = git(canonical, 'config', '--get', 'remote.origin.url').replace(/\.git$/u, '').replace(/^git@github\.com:/u, 'github.com/').replace(/^https:\/\//u, '');
  assert.equal(origin, entry.owner, `${entry.id} owner origin`);
  const source = git(canonical, 'show', `${entry.plan.revision}:${entry.plan.path}`);
  const document = source.startsWith('---\n') ? source.split('\n---\n')[0] : '';
  assert.equal(field(document, 'doc_type'), 'PRD-TAD-ADR-MVP-GTM');
  assert.equal(field(document, 'continuity_id'), entry.plan.continuityId);
  assert.equal(field(document, 'version'), entry.plan.version);
  for (const role of ['prd', 'tad', 'adr', 'mvp', 'gtm']) assert.equal(field(document, `${role}_revision`), entry.plan.version, `${entry.id} ${role} join`);
  assert.equal(field(document, 'guideline_revision'), entry.guideline.version, `${entry.id} guideline version join`);
  assert.equal(field(document, 'guideline_source'), `https://${entry.guideline.repository}/blob/${entry.guideline.revision}/${entry.guideline.path}`, `${entry.id} guideline source join`);
  for (const item of [entry.implementation, entry.check].filter(Boolean)) assert.equal(git(canonical, 'cat-file', '-t', `${item.revision}:${item.path}`), 'blob');
  if (roots[entry.guideline.repository]) {
    const guidelineRoot = realpathSync(roots[entry.guideline.repository]);
    const guideline = git(guidelineRoot, 'show', `${entry.guideline.revision}:${entry.guideline.path}`);
    assert.equal(field(guideline.startsWith('---\n') ? guideline.split('\n---\n')[0] : '', 'version'), entry.guideline.version);
  }
}

test('central roadmap admits registered owners, unique IDs and acyclic dependencies', () => {
  assert.equal(catalog.schema, 'agentic-os/feature-roadmap/v1');
  assert.ok(catalog.entries.length > 0 && catalog.entries.length <= 256);
  validate(catalog.entries);
  assert.throws(() => validate([catalog.entries[0], catalog.entries[0]]), /unique feature/u);
  assert.throws(() => validate([{ ...catalog.entries[0], owner: 'github.com/unregistered/repo' }]), /registered owner/u);
  assert.throws(() => validate([{ ...catalog.entries[0], dependencies: ['missing'] }]), /existing dependency/u);
});

test('past, current and future navigation matches the central records', () => {
  const source = readFileSync(join(root, 'guides/FEATURES.md'), 'utf8');
  const rows = [...source.matchAll(/^\| (Past|Current|Future) \| ([^|]+) \|/gmu)].map(([, view, name]) => ({ view, name: name.match(/`([a-z0-9-]+)`/u)?.[1] }));
  for (const view of ['Past', 'Current', 'Future']) assert.deepEqual(rows.filter(row => row.view === view).map(row => row.name).filter(Boolean).sort(),
    catalog.entries.filter(row => stage[row.lifecycle] === view).map(row => row.id).sort(), `${view} view`);
  for (const row of catalog.entries) {
    assert.ok(source.includes(`https://${row.owner}/blob/${row.plan.revision}/${row.plan.path}`), `${row.id} exact plan link`);
    assert.ok(source.includes(`https://${row.guideline.repository}/blob/${row.guideline.revision}/${row.guideline.path}`), `${row.id} exact guideline link`);
  }
});

test('exact local plans join five roles and optional owner clones resolve pinned blobs', t => {
  const rootsFile = process.env.AGENTIC_OS_FEATURE_ROADMAP_ROOTS;
  assert.ok(!rootsFile || isAbsolute(rootsFile), 'roots map must be absolute');
  const roots = rootsFile ? JSON.parse(readFileSync(rootsFile)) : { [ownId]: root };
  for (const row of catalog.entries) {
    if (roots[row.owner]) observe(row, roots[row.owner], roots);
    else t.diagnostic(`${row.owner}: exact local blob observation pending`);
  }
});
