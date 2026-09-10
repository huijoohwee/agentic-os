import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireOperationLock, finishOperationLock, git } from '../src/git.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { hydrateWorkspace } from '../bin/agentic-os-workspace.mjs';
const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
function fixture(t, enrolled = true) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-workspace-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const run = (cwd, args) => git(args, { cwd });
  const init = path => {
    mkdirSync(path); run(path, ['init', '--quiet', '--initial-branch=main']);
    run(path, ['config', 'user.name', 'Workspace Test']);
    run(path, ['config', 'user.email', 'test@example.invalid']);
    return path;
  };
  const commit = root => { run(root, ['add', '.']); run(root, ['commit', '--quiet', '-m', 'fixture']); };
  const publish = (root, name) => {
    const remote = join(parent, `${name}.git`); run(parent, ['init', '--quiet', '--bare', remote]);
    run(root, ['remote', 'add', 'origin', remote]); run(root, ['push', '--quiet', '-u', 'origin', 'main']);
    return remote;
  };
  const container = join(parent, '.workspace'); mkdirSync(container);
  const config = { schema: 'agentic-os/workspace/v1', sources: {} }, sources = {};
  for (const role of ['memory', 'todo', 'artifacts']) {
    const root = init(join(parent, `.${role}`)); sources[role] = root;
    writeFileSync(join(root, 'README.md'), `${role}\n`);
    if (role === 'todo') { mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/TODO.md'), '# Planning\n'); }
    commit(root);
    config.sources[role] = { path: `.${role}`, remote: publish(root, role), branch: 'main' };
    if (role === 'memory') config.sources[role].directory = 'records';
    if (role === 'todo') config.sources[role].entry = 'docs/TODO.md';
    symlinkSync(root, join(container, `.${role}`), 'dir');
  }
  const root = init(join(parent, 'repo'));
  const profile = createRepositoryProfile({ repository: 'local:workspace-test',
    canonical: { localRef: 'refs/heads/main', remoteRef: policy.protectedRef },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    cleanup: { worktreeProjection: 'retain', worktreeRegistration: 'retain', remoteTrackingRef: 'retain',
      localBranch: 'retain', remoteBranch: 'retain', unreachableObjects: 'retain' } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, '.agentic-os-workspace.json'), JSON.stringify(config));
  commit(root); publish(root, 'repo'); ensureRepositoryTrust(root, profile, { allowCreate: true });
  if (enrolled) run(root, ['config', '--local', 'agentic-os.workspaceRoot', '../.workspace']);
  return { root, parent, container, sources, config, run, commit,
    hydrate: options => hydrateWorkspace(root, policy, options),
    invoke: (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' }) };
}
test('unenrolled clones perform no workspace discovery or memory hydration', t => {
  const s = fixture(t, false); rmSync(s.container, { recursive: true });
  assert.equal(s.hydrate().status, 'disabled');
  assert.equal(existsSync(join(s.sources.memory, '.git/agentic-os-memory')), false);
});
test('startup and linked-worktree resume observe three independent sources through local aliases', t => {
  const s = fixture(t); writeFileSync(join(s.sources.artifacts, 'README.md'), 'active writer bytes\n');
  const result = s.invoke('start', 'workspace', '--device=device-a', '--write=change.txt');
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.match(/^workspace (.+)$/mu)[1]);
  assert.equal(receipt.grantsAuthority, false);
  assert.deepEqual(Object.keys(receipt.sources), ['memory', 'todo', 'artifacts']);
  assert.equal(receipt.sources.memory.entries, 0); assert.equal(receipt.sources.todo.status, 'current');
  assert.equal(receipt.sources.artifacts.status, 'current');
  assert.equal(receipt.sources.artifacts.contentLoaded, false);
  assert.equal(receipt.sources.todo.entry.path, 'docs/TODO.md');
  assert.equal(readFileSync(join(s.sources.artifacts, 'README.md'), 'utf8'), 'active writer bytes\n');
  const lane = result.stdout.match(/^worktree (.+)$/mu)[1];
  const resumed = spawnSync(process.execPath, [CLI, 'workspace', '--offline'], { cwd: lane, encoding: 'utf8' });
  assert.equal(resumed.status, 0, resumed.stderr);
  const offline = JSON.parse(resumed.stdout.slice('workspace '.length));
  assert.equal(offline.sources.memory.status, 'offline-cache');
  assert.equal(offline.sources.todo.status, 'offline-local');
});
test('a source-specific request does not load unrelated sources or create a memory index', t => {
  const s = fixture(t); rmSync(join(s.container, '.artifacts'));
  const result = s.hydrate({ source: 'todo', offline: true });
  assert.deepEqual(Object.keys(result.sources), ['todo']);
  assert.equal(existsSync(join(s.sources.memory, '.git/agentic-os-memory')), false);
  assert.throws(() => s.hydrate());
});
test('remote advances are reported without fetching payloads or modifying local refs and files', t => {
  const s = fixture(t), source = s.sources.artifacts;
  const before = s.run(source, ['rev-parse', 'refs/remotes/origin/main']);
  const next = s.run(source, ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'published elsewhere']);
  s.run(source, ['push', '--quiet', s.config.sources.artifacts.remote, `${next}:refs/heads/main`]);
  const result = s.hydrate({ source: 'artifacts' }).sources.artifacts;
  assert.equal(result.status, 'update-available'); assert.equal(result.sourceRevision, before);
  assert.equal(result.remoteRevision, next);
  assert.equal(s.run(source, ['rev-parse', 'refs/remotes/origin/main']), before);
  assert.equal(s.run(source, ['rev-parse', 'HEAD']), before);
});
test('identity or duplicate enrollment failures happen before startup creates a lane', t => {
  const s = fixture(t);
  s.run(s.root, ['config', '--local', 'agentic-os.memoryRoot', '../.memory']);
  assert.throws(() => s.hydrate(), /duplicate-enrollment/u);
  s.run(s.root, ['config', '--local', '--unset-all', 'agentic-os.memoryRoot']);
  s.run(s.sources.artifacts, ['remote', 'set-url', 'origin', '/wrong-source']);
  const result = s.invoke('start', 'blocked', '--device=device-a', '--write=change.txt');
  assert.equal(result.status, 1); assert.match(result.stderr, /remote-identity/u);
  assert.equal(s.run(s.root, ['branch', '--list', 'agent/device-a/blocked']), '');
  assert.equal(existsSync(join(s.sources.memory, '.git/agentic-os-memory')), false);
});
test('shared memory contention releases the consumer workspace lock for a safe retry', t => {
  const s = fixture(t), lock = acquireOperationLock('agentic-os-memory', s.sources.memory);
  try { assert.throws(() => s.hydrate(), /memory-busy/u); }
  finally { finishOperationLock(lock, { label: 'test', result: null }); }
  assert.equal(s.hydrate().sources.memory.status, 'ready');
});
test('only protected workspace configuration is used and unknown sources fail before I/O', t => {
  const s = fixture(t);
  writeFileSync(join(s.root, '.agentic-os-workspace.json'), '{broken');
  assert.equal(s.hydrate({ source: 'todo', offline: true }).sources.todo.status, 'offline-local');
  const result = s.invoke('workspace', '--source=unknown');
  assert.equal(result.status, 1); assert.match(result.stderr, /invalid-arguments/u);
});
