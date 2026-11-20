import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skills = ['canvas', 'trading'];

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
  const installed = realpathSync(join(directory, 'node_modules/agentic-os'));
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json')));
  assert.deepEqual(manifest.dependencies, {});

  const standalones = [];
  for (const skill of skills) {
    const entry = `skills/${skill}/SKILL.md`;
    const resolved = run(process.execPath, ['--input-type=module', '-e',
      `console.log(import.meta.resolve("agentic-os/${entry}"))`]).trim();
    const skillPath = fileURLToPath(resolved);
    assert.equal(realpathSync(skillPath), join(installed, entry));
    assert.deepEqual(readFileSync(skillPath), readFileSync(join(root, entry)));

    // Distribute just the skill directory, outside the package and any repository checkout.
    const standalone = join(realpathSync(directory), `standalone-${skill}`);
    cpSync(join(installed, `skills/${skill}`), standalone, { recursive: true });
    standalones.push({ skill, standalone });
  }
  const cli = join(installed, 'bin/agentic-os.mjs');
  const invoke = (verb, id) => JSON.parse(run(process.execPath, [cli, '/skill.' + verb, '#read-only', '@skill:' + id]));
  const discovered = invoke('discover', 'trading');
  assert.deepEqual(JSON.parse(run(process.execPath, [cli, '/skill.discover'])), discovered);
  const loaded = invoke('load', 'trading');
  assert.equal(discovered.ok, true);
  assert.equal(discovered.authority, false);
  assert.equal(discovered.content, undefined);
  assert.deepEqual(loaded.descriptor, discovered.descriptor);
  const { name, description, id, digest, source } = discovered.descriptor;
  assert.equal(id, name);
  assert.equal(source, 'agentic-os/skills/trading/SKILL.md');
  assert.equal(digest, 'sha256:' + createHash('sha256').update(loaded.content).digest('hex'));
  assert.deepEqual(loaded.content.split('\n').slice(0, 4), ['---', 'name: ' + name, 'description: ' + description, '---']);
  assert.ok(loaded.costRecords.every(record => record.promptTokens === 0 && record.completionTokens === 0 && record.estimatedCostUsd === 0));
  const unavailable = code => error => error.status === 1 && JSON.parse(error.stdout).code === code;
  assert.throws(() => invoke('load', '../other'), unavailable('skill-unavailable'));
  const sourceFile = join(installed, 'skills/trading/SKILL.md');
  writeFileSync(sourceFile, 'changed');
  assert.throws(() => invoke('load', 'trading'), unavailable('skill-digest-mismatch'));
  rmSync(sourceFile);
  assert.throws(() => invoke('load', 'trading'), unavailable('skill-source-unavailable'));
  assert.deepEqual(invoke('discover', 'trading'), discovered);
  rmSync(join(directory, 'node_modules'), { recursive: true, force: true });

  for (const { skill, standalone } of standalones) {
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
    const prefix = `skills/${skill}/`;
    const packaged = packed.files.map(file => file.path)
      .filter(path => path.startsWith(prefix) && path.endsWith('.md'))
      .map(path => path.slice(prefix.length)).sort();
    assert.deepEqual([...visited].map(path => relative(standalone, path)).sort(), packaged,
      `every packaged instruction resource must be reachable from the standalone entrypoint: ${skill}`);
  }
});
