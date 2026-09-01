import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync,
  symlinkSync, unlinkSync, utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TRACKED_FILE_LIMITS, tightenLegacyPrivateDirectory,
} from '../src/file-integrity.mjs';
import { git, trackedChanges, worktreeCleanupRisks } from '../src/git.mjs';

function fixture(t, { filtered = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-tracked-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  if (filtered) {
    run(['config', 'filter.identity.clean', 'cat']);
    run(['config', 'filter.identity.smudge', 'cat']);
    writeFileSync(join(root, '.gitattributes'), 'tracked.txt filter=identity\n');
  }
  writeFileSync(join(root, 'tracked.txt'), 'first\nsecond\n');
  run(['add', '.']);
  run(['commit', '--quiet', '--message', 'base']);
  return { root, run };
}

test('a transformed core.autocrlf checkout is conservatively reported as raw-byte drift', (t) => {
  const { root, run } = fixture(t);
  run(['config', 'core.autocrlf', 'true']);
  rmSync(join(root, 'tracked.txt'));
  run(['checkout', '--', 'tracked.txt']);
  assert.equal(run(['status', '--porcelain=v1']), '');
  assert.deepEqual(readFileSync(join(root, 'tracked.txt')), Buffer.from('first\r\nsecond\r\n'));
  assert.deepEqual(worktreeCleanupRisks(root, { includeIgnored: false }).tracked, ['tracked.txt']);

  run(['update-index', '--assume-unchanged', 'tracked.txt']);
  writeFileSync(join(root, 'tracked.txt'), 'first\nsecond\n');
  assert.equal(run(['status', '--porcelain=v1']), '');
  assert.deepEqual(worktreeCleanupRisks(root, { includeIgnored: false }).tracked, []);

  writeFileSync(join(root, 'tracked.txt'), 'authored hidden drift\r\n');
  assert.equal(run(['status', '--porcelain=v1']), '');
  const risks = worktreeCleanupRisks(root, { includeIgnored: false });
  assert.ok(risks.hidden.includes('tracked.txt'));
  assert.ok(risks.tracked.includes('tracked.txt'));
});

test('raw tracked-byte observation never executes a configured checkout filter', (t) => {
  const { root, run } = fixture(t, { filtered: true });
  const filter = join(root, 'touch-filter.sh');
  writeFileSync(filter, '#!/bin/sh\ntouch "$RACE_PATH"\ncat\n');
  chmodSync(filter, 0o755);
  run(['config', 'filter.identity.smudge', filter]);
  utimesSync(join(root, 'tracked.txt'), new Date(1_000), new Date(1_000));
  const prior = process.env.RACE_PATH;
  process.env.RACE_PATH = join(root, 'tracked.txt');
  t.after(() => {
    if (prior === undefined) delete process.env.RACE_PATH;
    else process.env.RACE_PATH = prior;
  });

  const before = statSync(join(root, 'tracked.txt')).mtimeMs;
  const risks = worktreeCleanupRisks(root, { includeIgnored: false });
  assert.deepEqual(risks.tracked, []);
  assert.equal(statSync(join(root, 'tracked.txt')).mtimeMs, before);
});

test('oversized checkout-filter comparisons fail closed before reading source bytes', (t) => {
  const { root, run } = fixture(t);
  run(['update-index', '--assume-unchanged', 'tracked.txt']);
  writeFileSync(join(root, 'tracked.txt'), Buffer.alloc(
    TRACKED_FILE_LIMITS.rawComparisonBytes + 1,
  ));
  assert.ok(worktreeCleanupRisks(root, { includeIgnored: false }).tracked.includes('tracked.txt'));
});

test('an expanding checkout filter is not executed by raw tracked-byte observation', (t) => {
  const { root, run } = fixture(t, { filtered: true });
  const filter = join(root, 'expanding-filter.mjs');
  const marker = join(root, 'filter-ran');
  writeFileSync(filter, `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');
process.stdin.resume();
process.stdin.on('end', () => {
  const chunk = Buffer.alloc(64 * 1024);
  let remaining = ${TRACKED_FILE_LIMITS.rawComparisonBytes + 1};
  while (remaining > 0) {
    const count = Math.min(chunk.length, remaining);
    process.stdout.write(chunk.subarray(0, count));
    remaining -= count;
  }
});
`);
  chmodSync(filter, 0o755);
  run(['config', 'filter.identity.smudge', filter]);
  assert.deepEqual(worktreeCleanupRisks(root, { includeIgnored: false }).tracked, []);
  assert.equal(existsSync(marker), false);
});

test('tracked observation disables a configured fsmonitor hook', (t) => {
  const { root, run } = fixture(t);
  const marker = join(root, 'fsmonitor-ran');
  const hook = join(root, 'fsmonitor-hook');
  writeFileSync(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nprintf "0\\n"\n`);
  chmodSync(hook, 0o755);
  run(['config', 'core.fsmonitor', hook]);
  assert.deepEqual(trackedChanges(root), { headToIndex: [], indexToWorkingTree: [] });
  assert.equal(existsSync(marker), false);
});

test('tracked observation does not refresh or rewrite the Git index', (t) => {
  const { root } = fixture(t);
  const index = join(root, '.git', 'index');
  const beforeBytes = readFileSync(index);
  const before = statSync(index, { bigint: true });
  utimesSync(join(root, 'tracked.txt'), new Date(), new Date());
  assert.deepEqual(trackedChanges(root), { headToIndex: [], indexToWorkingTree: [] });
  const after = statSync(index, { bigint: true });
  assert.deepEqual(readFileSync(index), beforeBytes);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(after.ctimeNs, before.ctimeNs);
});

test('private-directory tightening reports the chmod effect before later path failure', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-tighten-effect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'state');
  const moved = join(root, 'tightened-state');
  mkdirSync(path, { mode: 0o755 });
  const attempts = [], effects = [];
  assert.throws(() => tightenLegacyPrivateDirectory(path, 'test state', {
    onTightenAttempt: (effect) => attempts.push(effect),
    onTightened: (effect) => {
      effects.push(effect);
      renameSync(path, moved);
      mkdirSync(path, { mode: 0o700 });
    },
  }), /identity changed after mode tightening/u);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0], effects[0]);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].path, path);
  assert.equal(effects[0].priorMode, 0o755);
  assert.equal(effects[0].mode, 0o700);
  assert.equal(statSync(moved).mode & 0o777, 0o700);
});

test('tracked symlink bytes use the same before-and-after identity guard', (t) => {
  const { root, run } = fixture(t);
  symlinkSync('first-target', join(root, 'tracked-link'));
  run(['add', 'tracked-link']);
  run(['commit', '--quiet', '--message', 'symlink']);
  assert.deepEqual(worktreeCleanupRisks(root, { includeIgnored: false }).tracked, []);
  unlinkSync(join(root, 'tracked-link'));
  symlinkSync('authored-target', join(root, 'tracked-link'));
  assert.ok(worktreeCleanupRisks(root, { includeIgnored: false }).tracked.includes('tracked-link'));
});
