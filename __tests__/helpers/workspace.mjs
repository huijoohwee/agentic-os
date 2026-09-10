import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireOperationLock, finishOperationLock, git } from '../../src/git.mjs';
import { createRepositoryProfile } from '../../src/governance.mjs';
import { ensureRepositoryTrust } from '../../src/git-repository.mjs';
import { hydrateWorkspace } from '../../bin/agentic-os-workspace.mjs';
export const CLI = fileURLToPath(new URL('../../bin/agentic-os.mjs', import.meta.url));
export const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
export function fixture(t, enrolled = true) {
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
export function consolidate(s) {
  s.run(s.container, ['init', '--quiet', '--initial-branch=main']);
  s.run(s.container, ['config', 'user.name', 'Workspace Test']);
  s.run(s.container, ['config', 'user.email', 'test@example.invalid']);
  for (const role of Object.keys(s.sources)) {
    rmSync(join(s.container, `.${role}`));
    rmSync(join(s.sources[role], '.git'), { recursive: true });
    renameSync(s.sources[role], join(s.container, `.${role}`));
    s.sources[role] = join(s.container, `.${role}`);
  }
  s.commit(s.container);
  const remote = join(s.parent, 'workspace.git');
  s.run(s.parent, ['init', '--quiet', '--bare', remote]);
  s.run(s.container, ['remote', 'add', 'origin', remote]);
  s.run(s.container, ['push', '--quiet', '-u', 'origin', 'main']);
  s.config = { schema: 'agentic-os/workspace/v2', remote, branch: 'main', sources: {
    memory: { path: '.memory', directory: 'records' }, todo: { path: '.todo', entry: 'docs/TODO.md' },
    artifacts: { path: '.artifacts' } } };
  writeFileSync(join(s.root, '.agentic-os-workspace.json'), JSON.stringify(s.config));
  s.commit(s.root); s.run(s.root, ['push', '--quiet', 'origin', 'main']);
  return s;
}
