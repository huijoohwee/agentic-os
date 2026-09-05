import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-status-economics-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), bin = join(parent, 'bin'), log = join(parent, 'calls.jsonl');
  mkdirSync(root); mkdirSync(bin); writeFileSync(log, '');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const git = (...args) => execFileSync(realGit, args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile)}\n`);
  git('add', '.agentic-os.json'); git('commit', '--quiet', '--message', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const helper = join(parent, 'git-wrapper.mjs');
  writeFileSync(helper, [
    "import { appendFileSync } from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    'const args = process.argv.slice(2);',
    "appendFileSync(process.env.STATUS_LOG, JSON.stringify(args) + '\\n');",
    "if (args.includes('rev-list') && process.env.STATUS_COUNT !== undefined) {",
    '  process.stdout.write(process.env.STATUS_COUNT); process.exit(0);',
    '}',
    "const result = spawnSync(process.env.STATUS_GIT, args, { stdio: 'inherit' });",
    'process.exit(Number.isInteger(result.status) ? result.status : 91);', '',
  ].join('\n'));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec "$STATUS_NODE" "$STATUS_HELPER" "$@"\n');
  chmodSync(join(bin, 'git'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STATUS_GIT: realGit,
    STATUS_NODE: process.execPath, STATUS_HELPER: helper, STATUS_LOG: log };
  delete env.STATUS_COUNT;
  const status = (extraEnv = {}) => {
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [CLI, 'status', '--device=test'], {
      cwd: root, encoding: 'utf8', env: { ...env, ...extraEnv },
    });
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return { ...result, calls };
  };
  const lane = (name) => {
    const path = join(parent, name);
    git('worktree', 'add', '--quiet', '-b', `agent/test/${name}`, path, 'main');
    return path;
  };
  return { root, git, realGit, lane, status };
}

test('status enumerates registrations once and counts history without materializing object IDs', t => {
  const f = fixture(t), first = f.lane('one'); f.lane('two');
  for (let index = 0; index < 3; index += 1) execFileSync(f.realGit,
    ['commit', '--quiet', '--allow-empty', '--message', `change ${index}`], { cwd: first });
  writeFileSync(join(first, 'untracked.txt'), 'keep\n');
  let result = f.status();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(args => args.includes('worktree') && args.includes('list')).length, 1);
  const counts = result.calls.filter(args => args.includes('rev-list'));
  assert.equal(counts.length, 2);
  assert.ok(counts.every(args => args.includes('--count')));
  assert.match(result.stdout, /agent\/test\/one/u);
  assert.match(result.stdout, /agent\/test\/one\s+active\s+3\s/u);
  assert.match(result.stdout, /1 owned untracked/u);
  t.diagnostic('2 lanes use 1 registry read instead of 3; history output is one number per lane.');

  execFileSync(f.realGit, ['commit', '--quiet', '--allow-empty', '--message', 'new state'], { cwd: first });
  result = f.status();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent\/test\/one\s+active\s+4\s/u);
  assert.equal(readFileSync(join(first, 'untracked.txt'), 'utf8'), 'keep\n');
});

test('malformed, unsafe or oversized history counts fail instead of implying zero commits', t => {
  const f = fixture(t); f.lane('one');
  for (const count of ['', '-1', '1.5', '9007199254740992', '9'.repeat(65)]) {
    const result = f.status({ STATUS_COUNT: count });
    assert.notEqual(result.status, 0, `accepted count ${JSON.stringify(count)}`);
    assert.doesNotMatch(result.stdout, /0 commit/u);
  }
});
