import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = 'skills/canvas/SKILL.md';

test('a relocated offline consumer can resolve the skill and all of its selected resources', t => {
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

  // Verify actual installed link targets, without a sibling checkout or host SDK present.
  const skillFiles = [entry, ...packed.files.map(file => file.path)
    .filter(path => path.startsWith('skills/canvas/references/') && path.endsWith('.md'))];
  assert.equal(skillFiles.length, 5);
  for (const path of skillFiles) {
    const text = readFileSync(join(installed, path), 'utf8');
    assert.ok(Buffer.byteLength(text) < 8_192, `unbounded selected resource: ${path}`);
    for (const [, href] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (/^https:\/\//u.test(href)) continue;
      const target = realpathSync(resolve(join(installed, path, '..'), href.split('#')[0]));
      assert.ok(!relative(installed, target).startsWith('..'), `external resource: ${href}`);
      assert.ok(readFileSync(target).length > 0, `empty resource: ${href}`);
    }
  }
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json')));
  assert.deepEqual(manifest.dependencies, {});
});
