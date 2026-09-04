import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOP = fileURLToPath(new URL('../bin/agentic-os-checkin-checkout.mjs', import.meta.url));
const ROOT = new URL('..', import.meta.url);

function run(args) {
  return spawnSync(process.execPath, [LOOP, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('checkout/checkin loop documents its two bounded actions', () => {
  const result = run(['help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /checkout <scope> --write=/u);
  assert.match(result.stdout, /checkin --message=/u);
});

test('checkout requires one explicit write reservation', () => {
  const missing = run(['checkout', 'focused-change']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /requires --write/u);

  const malformed = run(['checkout', 'one', 'two', '--write=src/a.mjs']);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /exactly one scope/u);
});

test('checkin cannot run from a canonical checkout', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-checkin-canonical-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet', '--initial-branch=main'], {
    cwd, encoding: 'utf8',
  }).status, 0);
  const result = spawnSync(process.execPath, [LOOP, 'checkin', '--message=docs: focused change'], {
    cwd, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-checkin-requires-lane/u);
});
