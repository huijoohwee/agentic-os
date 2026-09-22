import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { put } from '../src/lane-records.mjs';
import { provision } from '../src/worktree.mjs';
import { startWorkflow, readSelectedWorkflow } from '../bin/agentic-os-workflow.mjs';
import { cmdLand } from '../bin/agentic-os-publication.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
function fixture(t, { published = true, repository = 'local:fixture' } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-early-publication-'));
  const root = join(parent, 'repo'), bare = join(parent, 'remote.git');
  mkdirSync(root);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const run = (args, cwd = root) => git(args, { cwd });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  const profile = createRepositoryProfile({ repository,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'change.txt'), 'base\n');
  writeFileSync(join(root, 'native-prd-tad-adr-mvp-gtm.md'), '# Native plan\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'base']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]); run(['push', '--quiet', 'origin', 'main']);
  const ref = 'agent/test-device/published', baseSha = run(['rev-parse', 'HEAD']);
  const lane = provision({ ref, scope: 'published', device: 'test-device', baseSha, cwd: root });
  const file = join(lane.path, 'change.txt');
  writeFileSync(file, 'candidate\n');
  run(['add', 'change.txt'], lane.path); run(['commit', '--quiet', '--message', 'candidate'], lane.path);
  const head = run(['rev-parse', 'HEAD'], lane.path);
  if (published) run(['push', '--quiet', 'origin', ref], lane.path);
  put({ ref, device: 'test-device', scope: 'published', state: 'active',
    base: 'refs/remotes/origin/main', baseSha, worktree: lane.path, head,
    createdAt: new Date(0).toISOString(), writePaths: ['change.txt'] }, lane.path);
  const support = join(parent, 'bin'), calls = join(parent, 'git-calls');
  mkdirSync(support); writeFileSync(calls, '');
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AGENTIC_OS_TEST_GIT_CALLS"\nexec "$AGENTIC_OS_TEST_REAL_GIT" "$@"\n');
  chmodSync(wrapper, 0o755);
  const invoke = () => spawnSync(process.execPath, [CLI, 'land', '--message=repair'], {
    cwd: lane.path, encoding: 'utf8', env: { ...process.env,
      PATH: `${support}:${process.env.PATH}`, AGENTIC_OS_TEST_GIT_CALLS: calls,
      AGENTIC_OS_TEST_REAL_GIT: realGit } });
  return { root, run, ref, lane, head, file, bare, calls, invoke };
}

test('published correction refuses before commit or fetch, including stale active cache', async t => {
  for (const kind of ['unstaged', 'staged', 'committed']) await t.test(kind, child => {
    const s = fixture(child);
    writeFileSync(s.file, 'candidate\nrepair\n');
    if (kind !== 'unstaged') s.run(['add', 'change.txt'], s.lane.path);
    if (kind === 'committed') s.run(['commit', '--quiet', '--message', 'repair'], s.lane.path);
    const before = { head: s.run(['rev-parse', 'HEAD'], s.lane.path),
      index: s.run(['write-tree'], s.lane.path), bytes: readFileSync(s.file, 'utf8') };
    const result = s.invoke();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /blocked-published-head-drift/u);
    assert.ok(result.stderr.includes(`--expected-head=${s.head}`));
    assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), before.head);
    assert.equal(s.run(['write-tree'], s.lane.path), before.index);
    assert.equal(readFileSync(s.file, 'utf8'), before.bytes);
    assert.equal(s.run(['--git-dir', s.bare, 'rev-parse', `refs/heads/${s.ref}`]), s.head);
    const calls = readFileSync(s.calls, 'utf8').split('\n');
    assert.ok(calls.some(call => call.includes('ls-remote')));
    assert.ok(!calls.some(call => /^(?:fetch|commit|add|push) /u.test(call)), calls.join('\n'));
  });
});

test('exact clean published head remains recoverable with a stale active cache', t => {
  const s = fixture(t), result = s.invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), s.head);
  assert.ok(!readFileSync(s.calls, 'utf8').split('\n').some(call => /^commit /u.test(call)));
});


test('unpublished stale base refuses after native fetch without changing candidate or remote lane', t => {
  const s = fixture(t, { published: false });
  const base = s.run(['rev-parse', 'refs/remotes/origin/main'], s.lane.path);
  const tree = s.run(['rev-parse', `${base}^{tree}`], s.lane.path);
  const advanced = s.run(['commit-tree', tree, '-p', base, '-m', 'upstream advance'], s.lane.path);
  s.run(['push', '--quiet', s.bare, `${advanced}:refs/heads/main`], s.lane.path);
  const index = s.run(['write-tree'], s.lane.path), bytes = readFileSync(s.file, 'utf8');
  const result = s.invoke();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /blocked-publication-stale-base/);
  assert.equal(s.run(['rev-parse', 'refs/remotes/origin/main'], s.lane.path), advanced);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), s.head);
  assert.equal(s.run(['write-tree'], s.lane.path), index);
  assert.equal(readFileSync(s.file, 'utf8'), bytes);
  assert.equal(spawnSync('git', ['--git-dir', s.bare, 'show-ref', '--verify', '--quiet', `refs/heads/${s.ref}`]).status, 1);
  const calls = readFileSync(s.calls, 'utf8').split('\n');
  assert.ok(!calls.some(call => /^(?:push|rebase|merge|reset) /u.test(call)), calls.join('\n'));
});

test('an exact published candidate remains recoverable after protected base advances', t => {
  const s = fixture(t);
  const base = s.run(['rev-parse', 'refs/remotes/origin/main'], s.lane.path);
  const tree = s.run(['rev-parse', `${base}^{tree}`], s.lane.path);
  const advanced = s.run(['commit-tree', tree, '-p', base, '-m', 'upstream advance'], s.lane.path);
  s.run(['push', '--quiet', s.bare, `${advanced}:refs/heads/main`], s.lane.path);
  const result = s.invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse', `refs/heads/${s.ref}`]), s.head);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), s.head);
});


test('declared missing prerequisite blocks publication before flight, commit or remote observation', t => {
  const s = fixture(t, { published: false }), repository = 'github.com/example/native';
  const worktreeId = basename(s.lane.path);
  startWorkflow(s.root, repository, { revision: s.head, planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId,
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [
      { before: { memberId: worktreeId, phase: 'preparation' }, after: { memberId: worktreeId, phase: 'ci' } },
    ] } } });
  writeFileSync(s.file, 'unpublished draft\n');
  const forbidden = () => assert.fail('publication effects must not run while dependency is missing');
  assert.throws(() => cmdLand(s.lane.path, ['--message=publish'], { repository }, {}, {
    out: forbidden, err: forbidden, projectCache: forbidden, effectReceipt: forbidden, remoteName: forbidden,
  }), /blocked-workflow-dependencies/);
  assert.equal(s.run(['rev-parse', 'HEAD'], s.lane.path), s.head);
  assert.equal(spawnSync('git', ['--git-dir', s.bare, 'show-ref', '--verify', '--quiet', `refs/heads/${s.ref}`]).status, 1);
});


test('native auto-commit rebinds an eligible declared workflow before exact publication', t => {
  const repository = 'github.com/example/native';
  const s = fixture(t, { published: false, repository }), worktreeId = basename(s.lane.path);
  const started = startWorkflow(s.root, repository, { revision: s.head, planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId,
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } });
  const previousBytes = readFileSync(started.manifest, 'utf8');
  writeFileSync(s.file, 'authored draft for native auto-commit\n');
  const result = s.invoke();
  assert.equal(result.status, 0, result.stderr);
  const head = s.run(['rev-parse', 'HEAD'], s.lane.path);
  assert.notEqual(head, s.head);
  assert.equal(s.run(['rev-parse', 'HEAD^'], s.lane.path), s.head);
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse', `refs/heads/${s.ref}`]), head);
  const selected = readSelectedWorkflow(s.root, repository);
  assert.equal(selected.members[0].child.source.revision, head);
  assert.equal(selected.manifest.previous.digest, started.digest);
  assert.equal(readFileSync(started.manifest, 'utf8'), previousBytes);
  assert.deepEqual(selected.members[0].child.phases, []);
});
