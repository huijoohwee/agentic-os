import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, OVERRIDE_ENV } from '../src/guard-main.mjs';

const GUARD = fileURLToPath(new URL('../src/guard-main.mjs', import.meta.url));

test('the guard refuses commits on the protected branch', () => {
  const verdict = evaluate({ branch: 'main', phase: 'commit', protectedBranch: 'main' });
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'blocked-canonical-authoring');
  assert.match(verdict.message, /npm run lane/u);
});

test('the guard allows lanes and refuses every unbound authoring surface', () => {
  assert.equal(evaluate({
    branch: 'agent/dev/scope', phase: 'commit', protectedBranch: 'main',
  }).allow, true);
  for (const branch of [null, 'feature/unbound']) {
    const verdict = evaluate({ branch, phase: 'commit', protectedBranch: 'main' });
    assert.equal(verdict.allow, false);
    assert.equal(verdict.reason, 'blocked-non-lane-authoring');
  }
});

test('the guard has an explicit, named override', () => {
  const verdict = evaluate({
    branch: 'main', phase: 'commit', override: '1', protectedBranch: 'main',
  });
  assert.equal(verdict.allow, true);
  assert.match(verdict.note, new RegExp(OVERRIDE_ENV));
  assert.equal(evaluate({ branch: 'main', phase: 'commit', override: '1' }).allow, true);
  assert.throws(() => evaluate({ branch: 'main', phase: 'commit' }),
    /canonical branch identity is required/u);
});

test('explicit guard override precedes trust while ordinary missing trust fails closed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-guard-bootstrap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });

  const ordinary = spawnSync(process.execPath, [GUARD, 'commit'], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(ordinary.status, 1);
  assert.match(ordinary.stderr, /repository trust anchor is missing/u);

  const overridden = spawnSync(process.execPath, [GUARD, 'commit'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, [OVERRIDE_ENV]: '1' },
  });
  assert.equal(overridden.status, 0, overridden.stderr);
});
