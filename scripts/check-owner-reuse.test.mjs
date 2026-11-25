import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { audit } from './check-owner-reuse.mjs';

test('committed candidates reject direct routes, new copies, projection drift and package substitutions', t => {
  const root = mkdtempSync(join(tmpdir(), 'owner-reuse-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
  const write = (path, data) => writeFileSync(join(root, path), data);
  const commit = () => {
    git('add', '-A');
    git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    return git('rev-parse','HEAD');
  };
  git('init', '-q');
  write('legacy.md', 'https://github.com/huijoohwee/site-owner/blob/main/guidelines/sample.md\n');
  write('existing.js', 'export const existing = 1;\n');
  const baseline = commit(), hash = git('rev-parse', baseline + ':existing.js');
  const policy = {pins:{'agentic-geo':baseline},references:[{owner:'site-owner',path:'guidelines/sample.md',id:'guideline/sample'}],
    assets:[['agentic-geo','src/core.mjs',hash]]};
  const check = rev => audit(root, 'product', baseline, rev, policy).errors;
  assert.deepEqual(check(baseline), []);
  write('renamed.mjs', readFileSync(join(root,'existing.js')));
  write('legacy.md', 'Use the Gateway index.\n');
  write('other.md', '../site-owner/guidelines/sample.md\n');
  write('existing.js', 'export const existing = 2;\n');
  write('package.json', JSON.stringify({dependencies:{'agentic-geo':'file:vendor/geo'},overrides:{'agentic-geo':'npm:substitute'}}));
  const errors = check(commit());
  for (const name of ['renamed.mjs','other.md','existing.js','owner package override','expected locked agentic-geo']) {
    assert.ok(errors.some(error => error.includes(name)), name);
  }
  git('reset','--hard',baseline);
  write('projection.mjs', readFileSync(join(root,'existing.js')));
  mkdirSync(join(root,'.agentic-os'));
  write('.agentic-os/owner-projections.json', JSON.stringify({'projection.mjs':{owner:'agentic-geo',source:'src/core.mjs',pin:baseline}}));
  assert.deepEqual(check(commit()), []);
  write('projection.mjs','divergent');
  assert.match(check(commit()).join('\n'),/does not match/);
});
