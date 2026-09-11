/** Workspace discovery composes source-owned memory, planning and artifact retrieval. */
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireOperationLock, commonDir, finishOperationLock, observeGit,
  remoteTransport, repoRoot, worktrees } from '../src/git.mjs';
import { hydrateMemory, hydrateSelectedMemory, validateSource } from './agentic-os-memory.mjs';
import { validatePublication } from './agentic-os-workspace-publication.mjs';
const FILE = '.agentic-os-workspace.json';
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const ROLES = ['memory', 'todo', 'artifacts'];
const fail = reason => { throw new Error(`blocked-workspace-${reason}`); };
const read = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 8192, ...options });
export function workspaceConfiguration(root, revision) {
  const mode = read(root, ['ls-tree', revision, '--', FILE]);
  if (!mode.startsWith('100644 blob ')) fail('config-file');
  const config = JSON.parse(read(root, ['show', `${revision}:${FILE}`], { maxBuffer: 4096 }));
  return validateWorkspaceConfiguration(config, root);
}
export function validateWorkspaceConfiguration(config, root) {
  const combined = config?.schema === 'agentic-os/workspace/v2';
  const keys = combined && config.publication !== undefined ? 'branch,publication,remote,schema,sources'
    : combined ? 'branch,remote,schema,sources' : 'schema,sources';
  if (!config || Object.keys(config).sort().join(',') !== keys
    || !combined && config.schema !== 'agentic-os/workspace/v1' || !config.sources
    || Object.keys(config.sources).sort().join(',') !== 'artifacts,memory,todo') fail('config-invalid');
  if (combined) validateSource(config, root);
  const paths = new Set();
  for (const role of ROLES) {
    const source = config.sources[role];
    const keys = combined ? (role === 'memory' ? 'directory,path' : role === 'todo' ? 'entry,path' : 'path')
      : role === 'memory' ? 'branch,directory,path,remote'
        : role === 'todo' ? 'branch,entry,path,remote' : 'branch,path,remote';
    if (!source || Object.keys(source).sort().join(',') !== keys
      || typeof source.path !== 'string' || !/^\.?[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(source.path)
      || paths.has(source.path)) fail('source-path');
    paths.add(source.path); if (!combined) validateSource(source, root);
    if (role === 'memory' && (typeof source.directory !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(source.directory))) fail('memory-directory');
    if (role === 'todo' && (typeof source.entry !== 'string' || source.entry.length > 128
      || !source.entry.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part)))) fail('todo-entry');
  }
  validatePublication(config); return config;
}
export function selectedSources(root, policy, selected, config, roles) {
  const canonical = worktrees(root).filter(item => item.branch === policy.protectedBranch);
  if (canonical.length !== 1) fail('canonical-root');
  const container = realpathSync(resolve(canonical[0].path, selected));
  const combined = config.schema === 'agentic-os/workspace/v2';
  if (!lstatSync(container).isDirectory()) fail('container');
  if (combined) {
    if (realpathSync(repoRoot(container)) !== container || commonDir(container) === commonDir(root)) fail('source-root');
    if (remoteTransport('origin', container).fetchUrl !== config.remote) fail('remote-identity');
  } else if (lstatSync(join(container, '.git'), { throwIfNoEntry: false })) fail('container');
  const sources = new Map(), seen = new Set();
  for (const role of roles) {
    const spec = config.sources[role], path = realpathSync(join(container, spec.path));
    if (combined) {
      if (path !== join(container, spec.path) || !lstatSync(path).isDirectory()
        || realpathSync(repoRoot(path)) !== container) fail('source-root');
      const selected = { ...spec, remote: config.remote, branch: config.branch };
      if (role === 'memory') selected.directory = `${spec.path}/${spec.directory}`;
      if (role === 'todo') selected.entry = `${spec.path}/${spec.entry}`;
      const tree = read(container, ['ls-tree', `refs/remotes/origin/${config.branch}`, '--', spec.path]);
      if (!tree.startsWith('040000 tree ') || !tree.endsWith(`\t${spec.path}`)) fail('source-tree');
      sources.set(role, { path: container, spec: selected }); continue;
    }
    if (realpathSync(repoRoot(path)) !== path) fail('source-root');
    const common = commonDir(path);
    if (common === commonDir(root) || seen.has(common)) fail('source-collision');
    seen.add(common);
    if (remoteTransport('origin', path).fetchUrl !== spec.remote) fail('remote-identity');
    sources.set(role, { path, spec });
  }
  return { container, sources };
}
function observeSource(path, spec, offline, role, shared = null) {
  const revision = shared?.sourceRevision ?? read(path, ['rev-parse', '--verify', `refs/remotes/origin/${spec.branch}^{commit}`]);
  if (!SHA.test(revision)) fail('local-source-revision');
  let remoteRevision = shared?.remoteRevision ?? null, status = shared?.status ?? 'offline-local';
  if (!offline && !shared) {
    const advertised = read(path, ['ls-remote', '--refs', spec.remote, `refs/heads/${spec.branch}`],
      { allowFail: true, maxBuffer: 4096, remoteReadTimeoutMs: 5000 });
    if (advertised !== null) {
      const match = advertised.match(/^([a-f0-9]+)\t(.+)$/u);
      if (!match || !SHA.test(match[1]) || match[2] !== `refs/heads/${spec.branch}`) fail('remote-branch');
      remoteRevision = match[1]; status = revision === remoteRevision ? 'current' : 'update-available';
    }
  }
  if (remoteTransport('origin', path).fetchUrl !== spec.remote) fail('remote-identity');
  const result = { root: path, sourceRevision: revision, remoteRevision, status, contentLoaded: false };
  if (role === 'todo') {
    const entry = read(path, ['ls-tree', revision, '--', spec.entry]);
    const match = entry.match(/^100644 blob ([a-f0-9]+)\t(.+)$/u);
    if (!match || !SHA.test(match[1]) || match[2] !== spec.entry) fail('todo-contract');
    result.entry = { path: spec.entry, blob: match[1] };
  }
  return result;
}
export function hydrateWorkspace(root, policy,
  { revision = null, offline = false, source = null, sync = false } = {}) {
  if (source !== null && !ROLES.includes(source)) fail('unknown-source');
  const selected = read(root, ['config', '--local', '--get-all', 'agentic-os.workspaceRoot'], { allowFail: true });
  if (selected === null) return source && source !== 'memory' ? { status: 'disabled', reason: 'local-enrollment-required' }
    : hydrateMemory(root, policy, { revision, offline });
  if (!selected || /[\r\n\x00]/u.test(selected)) fail('root-selection');
  if (read(root, ['config', '--local', '--get-all', 'agentic-os.memoryRoot'], { allowFail: true }) !== null)
    fail('duplicate-enrollment');
  const configRevision = revision ?? read(root, ['rev-parse', '--verify', `${policy.protectedRef}^{commit}`]);
  if (!SHA.test(configRevision)) fail('config-revision');
  const config = workspaceConfiguration(root, configRevision), roles = source ? [source] : ROLES;
  if (sync && config.schema !== 'agentic-os/workspace/v2') fail('sync-requires-v2');
  const { container, sources } = selectedSources(root, policy, selected, config, roles);
  const lock = acquireOperationLock('agentic-os-workspace', root);
  if (!lock) fail('busy');
  let result, error;
  try {
    const observations = {};
    let shared = null;
    if (config.schema === 'agentic-os/workspace/v2' && roles.includes('memory')) {
      const { path, spec: { remote, branch, directory } } = sources.get('memory');
      observations.memory = hydrateSelectedMemory(root, policy, path,
        { schema: 'agentic-os/memory-source/v1', remote, branch, directory },
        { configRevision, offline, advertise: true, inspect: (sourceRevision, { refreshError }) => {
          const context = {};
          for (const [role, { path, spec }] of sources) {
            const tree = read(path, ['ls-tree', sourceRevision, '--', spec.path]);
            if (!tree.startsWith('040000 tree ') || !tree.endsWith(`\t${spec.path}`)) fail('source-tree');
            if (role !== 'memory') context[role] = observeSource(path, spec, Boolean(refreshError), role,
              { sourceRevision, remoteRevision: refreshError ? null : sourceRevision,
                status: refreshError ? 'offline-local' : 'current' });
          }
          return context;
        } });
      Object.assign(observations, observations.memory.context);
      delete observations.memory.context;
      result = { schema: 'agentic-os/workspace-observation/v1', status: 'observed', root: container,
        sourceRevision: observations.memory.sourceRevision, configRevision,
        sources: observations, grantsAuthority: false };
    }
    for (const [role, { path, spec }] of result ? [] : sources) {
      if (role === 'memory') {
        const { remote, branch, directory } = spec;
        observations.memory = hydrateSelectedMemory(root, policy, path,
          { schema: 'agentic-os/memory-source/v1', remote, branch, directory }, { configRevision, offline });
      } else {
        observations[role] = observeSource(path, spec, offline, role, shared);
        if (config.schema === 'agentic-os/workspace/v2') shared = observations[role];
      }
    }
    result ??= { schema: 'agentic-os/workspace-observation/v1', status: 'observed', root: container,
      configRevision, sources: observations, grantsAuthority: false };
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'workspace', result, error });
}
export function runWorkspace(root, policy, options = {}, out = console.log) {
  const result = hydrateWorkspace(root, policy, options);
  out(`${result.schema ? 'workspace' : 'memory'} ${JSON.stringify(result)}`);
  return 0;
}
