import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { commitReservedChanges } from '../src/worktree.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-os-reserved-commit-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (args) => git(args, { cwd });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(cwd, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'base']);
  return { cwd, run };
}

test('reserved commit includes a new file staged before publish', (t) => {
  const { cwd, run } = fixture(t), path = 'docs/demo.md';
  mkdirSync(join(cwd, 'docs'));
  writeFileSync(join(cwd, path), 'candidate\n');
  run(['add', '--', path]);

  const result = commitReservedChanges({ cwd, writePaths: [path], message: 'docs: add demo' });

  assert.deepEqual(result.paths, [path]);
  assert.equal(run(['log', '-1', '--format=%s']), 'docs: add demo');
  assert.equal(run(['status', '--porcelain']), '');
});

test('reserved commit rejects a staged new file outside the reservation', (t) => {
  const { cwd, run } = fixture(t), path = 'unsafe.txt', head = run(['rev-parse', 'HEAD']);
  writeFileSync(join(cwd, path), 'unreserved\n');
  run(['add', '--', path]);

  assert.throws(() => commitReservedChanges({ cwd, writePaths: ['docs'], message: 'docs: add demo' }),
    { reason: 'blocked-write-outside-reservation' });
  assert.equal(run(['rev-parse', 'HEAD']), head);
  assert.match(run(['status', '--porcelain']), /^A  unsafe\.txt$/u);
});
