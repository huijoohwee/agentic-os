import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { put } from '../src/lane-records.mjs';

test('invalid review input preserves authored bytes and stops before commit hooks or fetch', t => {
  const parent = mkdtempSync(join(tmpdir(), 'sprint-preflight-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), lane = join(parent, 'lane'), bare = join(parent, 'remote.git');
  mkdirSync(root);
  const run = (args, cwd = root) => git(args, { cwd });
  run(['init', '-q', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']); run(['config', 'user.email', 'fixture@example.invalid']);
  const profile = createRepositoryProfile({ repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile) + '\n');
  writeFileSync(join(root, 'source.txt'), 'base\n');
  run(['add', '.']); run(['commit', '-qm', 'base']);
  run(['init', '-q', '--bare', bare]); run(['remote', 'add', 'origin', bare]);
  run(['push', '-q', 'origin', 'main']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const ref = 'agent/test/sprint-preflight', head = run(['rev-parse', 'HEAD']);
  run(['worktree', 'add', '-q', '-b', ref, lane]);
  put({ ref, device: 'test', scope: 'sprint-preflight', state: 'active',
    base: 'refs/remotes/origin/main', baseSha: head, worktree: lane,
    writePaths: ['source.txt'] }, lane);
  writeFileSync(join(lane, 'source.txt'), 'authored change\n');
  const hooks = join(parent, 'hooks'), effect = join(parent, 'hook-ran');
  mkdirSync(hooks); writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\ntouch '${effect}'\n`, { mode: 0o755 });
  run(['config', 'core.hooksPath', hooks]);
  const body = join(parent, 'review.md'); writeFileSync(body, 'Source-Head: invented');
  const before = run(['status', '--porcelain'], lane);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url)),
    'land', '--message=change', `--body-file=${body}`], { cwd: lane, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /blocked-review-body-invalid/);
  assert.equal(run(['rev-parse', 'HEAD'], lane), head);
  assert.equal(run(['status', '--porcelain'], lane), before);
  assert.equal(readFileSync(join(lane, 'source.txt'), 'utf8'), 'authored change\n');
  assert.equal(existsSync(effect), false);
  assert.equal(existsSync(join(root, '.git', 'FETCH_HEAD')), false);
  assert.equal(run(['--git-dir', bare, 'for-each-ref', '--format=%(refname)', `refs/heads/${ref}`]), '');
});
