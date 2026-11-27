// Read-only cross-repository source check. Read committed Git blobs without executing consumer code.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const names = ['agentic-os', 'agentic-design-system', 'agentic-base', 'agentic-sheets',
  'agentic-commerce-os', 'agentic-graph', 'agentic-trading-platform'];
const oid = /^[0-9a-f]{40}$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ownerId = 'github.com/huijoohwee/agentic-design-system';
function need(condition, label) { if (!condition) throw new Error(label); }
function once(source, literal, label) {
  need(source.split(literal).length === 2, label + ' must include exactly one ' + literal);
}
// Read only stylesheet directives and static module imports in the supported entry files.
function importPaths(source, css = false) {
  const pattern = css ? /(?:^|;)\s*@import\s+["']([^"']+)["']/gmu
    : /(?:^|;)\s*import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/gmu;
  return Array.from(source.matchAll(pattern), match => match[1]);
}
function requireImport(paths, path, label) {
  need(paths.filter(item => item === path).length === 1, label + ' must import exactly one ' + path);
}
export function checkProjection(label, ownerBytes, consumerBytes, pin) {
  need(digest(ownerBytes) === pin && ownerBytes.equals(consumerBytes), label + ' differs from pinned owner bytes');
}
export function checkRouteEntries(entries, sharedImport, forbidden, baseImport) {
  for (const [label, source] of entries) {
    once(source, sharedImport, label);
    if (baseImport) once(source, baseImport, label);
    need(!forbidden.test(source), label + ' defines or imports a second toolbar or base stylesheet');
  }
}
function snapshot(path) {
  const git = (...args) => execFileSync('git', ['-C', path, ...args], { maxBuffer: 500000 });
  const head = git('rev-parse', '--verify', 'HEAD^{commit}').toString().trim();
  function blob(file, revision = head) {
    need(oid.test(revision), 'Invalid revision for ' + file);
    return git('show', revision + ':' + file);
  }
  return { head, blob, text: file => blob(file).toString(), json: file => JSON.parse(blob(file)) };
}

export function checkWorkspace(workspace, overrides = {}) {
  const repos = Object.fromEntries(names.map(name => [name, snapshot(overrides[name] ?? join(workspace, name))]));
  const owner = repos['agentic-design-system'];
  const entry = owner.json('package.json').exports;
  need(entry['./toolbar.css'] === './site/toolbar.css' && entry['./panels.css'] === './site/panels.css', 'Design System CSS exports');
  requireImport(importPaths(owner.text('site/panels.css'), true), './toolbar.css', 'Design System panel bundle');
  const projections = [];
  function verify(repo, local, revision, source, hash) {
    const label = repo + '/' + local;
    checkProjection(label, owner.blob(source, revision), repos[repo].blob(local), hash.replace(/^sha256:/u, ''));
    projections.push({ repo, local, revision, source });
  }
  for (const [repo, pins, files] of [
    ['agentic-base', ['packages/views-react/src/controls/toolbar.pin.json', 'packages/views-react/src/panels/floatingPanelShell.pin.json'],
      ['packages/views-react/src/controls/toolbar.css', 'packages/views-react/src/panels/floatingPanelShell.css']],
    ['agentic-commerce-os', ['config/toolbar.pin.json', 'config/floating-panel.pin.json', 'config/collection-layout.pin.json'],
      ['public/local-first/toolbar.css', 'public/local-first/floating-panel.css', 'public/local-first/collection-layout.css']],
  ]) {
    pins.forEach((file, i) => {
      const pin = repos[repo].json(file), source = ['site/toolbar.css', 'site/floating-panel.css', 'site/collection-layout.css'][i];
      need(pin.owner === ownerId && pin.path === source, repo + ' owner mismatch at ' + file);
      verify(repo, files[i], pin.revision, source, pin.sha256);
    });
  }
  const sheets = repos['agentic-sheets'].json('design/shared-ui-profile.pin.json');
  need(sheets.profile.owner === ownerId, 'Sheets owner mismatch');
  for (const [key, file] of [['toolbar', 'toolbar.css'], ['collectionLayoutStyles', 'collection-layout.css'], ['floatingPanelStyles', 'floating-panel.css'], ['skillsCommandsStyles', 'skills-commands.css']]) {
    const pin = sheets[key];
    need(pin.sourcePath === 'site/' + file, 'Sheets owner path for ' + key);
    verify('agentic-sheets', 'design/' + file, pin.registryRevision ?? sheets.profile.registryRevision, pin.sourcePath, pin.sha256);
  }
  const commerce = repos['agentic-commerce-os'];
  for (const file of ['workspace-pack.js', 'workspace-navigation.js']) {
    requireImport(importPaths(commerce.text('public/local-first/' + file)), './commerce-toolbar.js', file);
  }
  const graph = repos['agentic-graph'];
  const spec = graph.json('canvas/package.json').dependencies['agentic-design-system'];
  const pin = spec.split('#')[1];
  need(spec === 'github:huijoohwee/agentic-design-system#' + pin && oid.test(pin), 'Graph Design System revision');
  need(graph.json('package.json').dependencies?.['agentic-design-system'] === spec ||
    graph.json('package.json').devDependencies?.['agentic-design-system'] === spec, 'Graph root Design System pin drift');
  requireImport(importPaths(owner.blob('site/panels.css', pin).toString(), true), './toolbar.css', 'Graph pinned panel bundle');
  const graphEntry = importPaths(graph.text('canvas/src/index.css'), true);
  requireImport(graphEntry, 'agentic-design-system/panels.css', 'Graph shared stylesheet');
  need(!graphEntry.includes('@agentic-base/views-react/toolbar.css'), 'Graph redirects toolbar ownership through Base');
  for (const file of ['main', 'observability']) {
    const imports = importPaths(graph.text('canvas/src/' + file + '.tsx'));
    requireImport(imports, './index.css', file);
    need(!imports.some(path => /(?:profile|toolbar|panels)\.css$/u.test(path)), file + ' imports a second toolbar stylesheet');
  }
  const trading = repos['agentic-trading-platform'];
  const pages = ['desk', 'dashboard-page'].map(file => [file, trading.text('web/' + file + '.html')]);
  checkRouteEntries(pages, '<!-- trading-toolbar -->', /class\s*=\s*["'][^"']*\bagentic-toolbar\b/iu, 'href="./trading.css"');
  for (const [label, html] of pages) once(html, 'href="./owners/design/site/toolbar.css"', label);
  const template = trading.text('web/trading-toolbar.html');
  once(template, 'id="trading-toolbar"', 'Trading toolbar');
  const journalContent = trading.text('web/index.html');
  need(!/<!-- trading-toolbar -->|id=["']trading-toolbar["']/u.test(journalContent), 'Journal content must use the shared dashboard shell');
  for (const href of ['./desk.html', './', './coverage.html']) once(template, 'href="' + href + '"', 'Trading toolbar');
  const os = repos['agentic-os'];
  need(os.text('guides/DESIGN-SYSTEM-OWNERSHIP.md').includes('scripts/check-shared-toolbar.mjs'), 'OS contract must identify executable conformance check');
  return { scope: 'committed toolbar source and projections', revisions: Object.fromEntries(names.map(name => [name, repos[name].head])), projections };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [workspace, ...args] = process.argv.slice(2);
  need(workspace, 'Usage: node scripts/check-shared-toolbar.mjs WORKSPACE [repo=checkout ...]');
  const overrides = {};
  for (const arg of args) {
    const key = arg.slice(0, arg.indexOf('=')), path = arg.slice(arg.indexOf('=') + 1);
    need(names.includes(key) && path && !Object.hasOwn(overrides, key), 'Invalid checkout binding: ' + key);
    overrides[key] = resolve(path);
  }
  console.log(JSON.stringify(checkWorkspace(resolve(workspace), overrides), null, 2));
}
