import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { exactCurrentIntegrationProof, integrationProof } from '../src/patch-identity.mjs';

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'adlc-historical-tree-'));
  const run = args => git(args, { cwd });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(cwd, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'base']);
  return { cwd, run };
}

function commitFile(run, cwd, path, content, message) {
  writeFileSync(join(cwd, path), content);
  run(['add', path]);
  run(['commit', '--quiet', '--message', message]);
}

test('historical exact full-tree match survives later protected edits', t => {
  const { cwd, run } = fixture();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  run(['switch', '--quiet', '--create', 'agent/dev/historical']);
  commitFile(run, cwd, 'lane.txt', 'lane\n', 'lane change');
  const lane = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/historical']);
  run(['commit', '--quiet', '--message', 'reviewed squash']);
  const merge = run(['rev-parse', 'HEAD']);
  commitFile(run, cwd, 'lane.txt', 'later lane bytes\n', 'later protected edit');
  const proof = integrationProof('main', lane, { cwd });
  assert.equal(proof.kind, 'historical-full-tree-match');
  assert.equal(proof.matchRevision, merge);
  assert.equal(proof.matchTree, run(['rev-parse', `${lane}^{tree}`]));
  assert.equal(proof.currentTreeDiffers, true);
  assert.equal(exactCurrentIntegrationProof('main', lane, { cwd }), null);
});

test('historical proof refuses a partial path match with a different full tree', t => {
  const { cwd, run } = fixture();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  run(['switch', '--quiet', '--create', 'agent/dev/historical']);
  commitFile(run, cwd, 'lane.txt', 'lane\n', 'lane change');
  const lane = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', 'main']);
  writeFileSync(join(cwd, 'lane.txt'), 'lane\n');
  writeFileSync(join(cwd, 'other.txt'), 'other\n');
  run(['add', 'lane.txt', 'other.txt']);
  run(['commit', '--quiet', '--message', 'partial match with extra content']);
  commitFile(run, cwd, 'lane.txt', 'changed later\n', 'later lane edit');
  assert.equal(integrationProof('main', lane, { cwd }), null);
});

test('an old tree before the lane fork does not prove its reversion was integrated', t => {
  const { cwd, run } = fixture();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  commitFile(run, cwd, 'obsolete.txt', 'obsolete\n', 'add obsolete file');
  run(['switch', '--quiet', '--create', 'agent/dev/revert']);
  run(['rm', '--quiet', '--', 'obsolete.txt']);
  run(['commit', '--quiet', '--message', 'remove obsolete file']);
  const lane = run(['rev-parse', 'HEAD']);
  assert.equal(integrationProof('main', lane, { cwd }), null);
});

test('empty lane-tip commits cannot reuse a historical tree match', t => {
  const { cwd, run } = fixture();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  run(['switch', '--quiet', '--create', 'agent/dev/historical']);
  commitFile(run, cwd, 'lane.txt', 'lane\n', 'lane change');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/historical']);
  run(['commit', '--quiet', '--message', 'reviewed squash']);
  run(['switch', '--quiet', 'agent/dev/historical']);
  run(['commit', '--quiet', '--allow-empty', '--message', 'empty lane advance']);
  const lane = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', 'main']);
  assert.equal(integrationProof('main', lane, { cwd }), null);
});
