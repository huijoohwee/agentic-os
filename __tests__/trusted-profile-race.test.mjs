import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-protected-race-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  const support = join(parent, 'bin');
  mkdirSync(root);
  mkdirSync(support);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  runGit(root, 'add', '.');
  runGit(root, 'commit', '--quiet', '--message', 'base');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const base = runGit(root, 'rev-parse', 'HEAD');
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  runGit(root, 'worktree', 'add', '--quiet', '-b', 'agent/test/protected-race', lane, base);
  writeFileSync(join(lane, 'lane.txt'), 'lane\n');
  runGit(lane, 'add', 'lane.txt');
  runGit(lane, 'commit', '--quiet', '--message', 'lane');
  const laneHead = runGit(lane, 'rev-parse', 'HEAD');
  const future = runGit(root, 'commit-tree', `${base}^{tree}`, '-p', base,
    '-m', 'future protected revision');
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, `#!/bin/sh
if [ "$AGENTIC_OS_TEST_RACE_MODE" = publication ] &&
   [ "$1" = rev-parse ] && [ "$2" = --verify ] &&
   [ "$3" = refs/remotes/origin/main ]; then
  count=0
  if [ -f "$AGENTIC_OS_TEST_RACE_MARKER" ]; then
    count=$(sed -n '1p' "$AGENTIC_OS_TEST_RACE_MARKER")
  fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$AGENTIC_OS_TEST_RACE_MARKER"
  if [ "$count" -eq 2 ]; then
    "$AGENTIC_OS_REAL_GIT" -C "$AGENTIC_OS_TEST_ROOT" update-ref \
      refs/remotes/origin/main "$AGENTIC_OS_TEST_MOVED" "$AGENTIC_OS_TEST_BASE" || exit
  fi
fi
if [ "$AGENTIC_OS_TEST_RACE_MODE" = reap ] && [ "$1" = for-each-ref ] &&
   [ "$3" = refs/heads/agent ] && [ ! -f "$AGENTIC_OS_TEST_RACE_MARKER" ]; then
  : > "$AGENTIC_OS_TEST_RACE_MARKER"
  "$AGENTIC_OS_REAL_GIT" -C "$AGENTIC_OS_TEST_ROOT" update-ref \
    refs/remotes/origin/main "$AGENTIC_OS_TEST_MOVED" "$AGENTIC_OS_TEST_BASE" || exit
fi
exec "$AGENTIC_OS_REAL_GIT" "$@"
`);
  chmodSync(wrapper, 0o755);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, bare, lane, support, base, laneHead, future };
}

function runCli(subject, command, cwd, mode, moved) {
  return spawnSync(process.execPath, [CLI, command], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_REAL_GIT: execFileSync('sh', ['-c', 'command -v git'], {
        encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH },
      }).trim(),
      AGENTIC_OS_TEST_BASE: subject.base,
      AGENTIC_OS_TEST_MOVED: moved,
      AGENTIC_OS_TEST_RACE_MARKER: join(subject.parent, `${mode}-marker`),
      AGENTIC_OS_TEST_RACE_MODE: mode,
      AGENTIC_OS_TEST_ROOT: subject.root,
    },
  });
}

test('land rejects a protected-ref move before publishing the exact lane', (t) => {
  const subject = fixture(t);
  const result = runCli(subject, 'land', subject.lane, 'publication', subject.future);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /blocked-protected-ref-race/u);
  assert.equal(runGit(subject.root, 'rev-parse', 'refs/remotes/origin/main'), subject.future);
  const published = spawnSync('git', ['--git-dir', subject.bare, 'show-ref', '--verify', '--quiet',
    'refs/heads/agent/test/protected-race']);
  assert.notEqual(published.status, 0, 'the race must be rejected before remote publication');
});

test('reap surveys the captured base when the symbolic protected ref moves', (t) => {
  const subject = fixture(t);
  const result = runCli(subject, 'reap', subject.root, 'reap', subject.laneHead);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(runGit(subject.root, 'rev-parse', 'refs/remotes/origin/main'), subject.laneHead);
  assert.match(result.stdout, /not-integrated lane projections:/u);
  assert.match(result.stdout, /agent\/test\/protected-race\s+1 pending/u);
  assert.doesNotMatch(result.stdout, /proven integrated/u);
});
