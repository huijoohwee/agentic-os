import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const exports = Object.entries(pkg.exports).filter(([key]) => key.startsWith('./agents/'));

test('agent package closure has one JSON owner, no consumer imports and no cycles', () => {
  const visiting = new Set(), visited = new Set();
  function visit(path) {
    assert.equal(visiting.has(path), false, `import cycle: ${path}`);
    if (visited.has(path)) return;
    visiting.add(path);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()?["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier.endsWith('.js') && !specifier.endsWith('.mjs')) continue;
      assert.ok(specifier.startsWith('.'), `nonlocal runtime import: ${specifier}`);
      const dependency = resolve(dirname(path), specifier);
      assert.ok(dependency.startsWith(join(root, 'runtime') + '/'), dependency);
      visit(dependency);
    }
    visiting.delete(path); visited.add(path);
  }
  for (const [, path] of exports) visit(resolve(root, path));
  assert.ok(visited.has(join(root, 'runtime/json-contract.mjs')));
  assert.equal(readdirSync(join(root, 'runtime/agents')).includes('json-contract.js'), false);
  assert.deepEqual(pkg.dependencies ?? {}, {});
  const modules = readdirSync(join(root, 'runtime/agents')).filter(name => name.endsWith('.js'));
  let bytes = 0;
  for (const name of modules) {
    const source = readFileSync(join(root, 'runtime/agents', name), 'utf8');
    bytes += Buffer.byteLength(source);
    assert.ok(source.trimEnd().split('\n').length < 600, name);
  }
  assert.ok(modules.length <= 24);
  assert.ok(bytes <= 300_000);
});

test('packed agent subpaths import independently and lifecycle discovery stays lazy', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'agent-package-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
    { cwd: root, encoding: 'utf8', timeout: 30_000 }))[0];
  const modules = join(temp, 'node_modules'); mkdirSync(modules);
  execFileSync('tar', ['-xzf', join(temp, packed.filename), '-C', modules], { timeout: 10_000 });
  const packageRoot = join(modules, 'package');
  const script = `import assert from 'node:assert/strict';
    const pkg = JSON.parse((await import('node:fs')).readFileSync(new URL('./package.json', import.meta.url)));
    for (const [name, path] of Object.entries(pkg.exports).filter(([key]) => key.startsWith('./agents/'))) {
      const module = await import(new URL(path, import.meta.url));
      assert.ok(Object.keys(module).length, name);
    }
    const { createAgentSwarmRuntime } = await import('./runtime/agents/agent-swarm.js');
    assert.equal(createAgentSwarmRuntime().stats().configured, false);`;
  writeFileSync(join(packageRoot, 'probe.mjs'), script);
  execFileSync(process.execPath, ['probe.mjs'], { cwd: packageRoot, timeout: 10_000 });
  const loader = join(temp, 'no-agents.mjs');
  writeFileSync(loader, `export async function load(url, context, next) {
    if (url.includes('/runtime/agents/')) throw new Error('eager agent runtime import');
    return next(url, context);
  }`);
  execFileSync(process.execPath, ['--no-warnings', '--loader', pathToFileURL(loader).href,
    '--input-type=module', '-e', "await import('./src/governance.mjs'); await import('./src/invocation.mjs');"],
  { cwd: packageRoot, timeout: 10_000 });
});
