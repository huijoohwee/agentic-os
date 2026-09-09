import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = 'skills/canvas/SKILL.md';

test('the offline package export and standalone skill resolve without repository or SDK dependencies', t => {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-os-skill-consumer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = (command, args, cwd = directory) => execFileSync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 500_000,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts',
    '--pack-destination', directory], root))[0];
  writeFileSync(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    join(directory, packed.filename)]);
  const resolved = run(process.execPath, ['--input-type=module', '-e',
    'console.log(import.meta.resolve("agentic-os/skills/canvas/SKILL.md"))']).trim();
  const installed = realpathSync(join(directory, 'node_modules/agentic-os'));
  const skillPath = fileURLToPath(resolved);
  assert.equal(realpathSync(skillPath), join(installed, entry));
  assert.deepEqual(readFileSync(skillPath), readFileSync(join(root, entry)));

  // Distribute just the skill directory, outside the package and any repository checkout.
  const standalone = join(realpathSync(directory), 'standalone-canvas');
  cpSync(join(installed, 'skills/canvas'), standalone, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json')));
  assert.deepEqual(manifest.dependencies, {});
  rmSync(join(directory, 'node_modules'), { recursive: true, force: true });
  const pending = [join(standalone, 'SKILL.md')], visited = new Set();
  while (pending.length) {
    const path = realpathSync(pending.pop());
    if (visited.has(path)) continue;
    visited.add(path);
    const text = readFileSync(path, 'utf8');
    assert.ok(Buffer.byteLength(text) < 8_192, `unbounded selected resource: ${path}`);
    for (const [, href] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (/^https:\/\//u.test(href)) continue;
      const target = realpathSync(resolve(join(path, '..'), href.split('#')[0]));
      assert.ok(!relative(standalone, target).startsWith('..'), `external resource: ${href}`);
      assert.ok(readFileSync(target).length > 0, `empty resource: ${href}`);
      pending.push(target);
    }
  }
  const packaged = packed.files.map(file => file.path)
    .filter(path => path.startsWith('skills/canvas/') && path.endsWith('.md'))
    .map(path => path.slice('skills/canvas/'.length)).sort();
  assert.deepEqual([...visited].map(path => relative(standalone, path)).sort(), packaged,
    'every packaged instruction resource must be reachable from the standalone entrypoint');
});
