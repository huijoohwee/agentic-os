/** Explicit, bounded Git CAS transport for cooperative metadata; no checkout or provider session writes. */
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { observeGit, git, remoteTransport, acquireOperationLock, finishOperationLock, atomicAdvanceRef } from '../src/git.mjs';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { workspaceConfiguration, selectedSources } from './agentic-os-workspace.mjs';
import { memoryTaskContext } from './agentic-os-memory-task.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { option } from './agentic-os-argv.mjs';
import { COLLAB_SCHEMA, COLLAB_LIMITS, emptyBoard, validateBoard, transitionBoard, fail, keys } from './agentic-os-collaboration.mjs';
export const BOARD_REF = 'refs/heads/agentic-os/collaboration-v1';
const CACHE_REF = 'refs/agentic-os/collaboration/accepted-v1';
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const read = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 65536, ...options });
export function collaborationContext(root, policy, profile) {
  if (read(root, ['config', '--local', '--get-all', 'agentic-os.collaborationEnabled'], { allowFail: true }) !== 'true')
    fail('enrollment-required');
  const selected = read(root, ['config', '--local', '--get-all', 'agentic-os.workspaceRoot'], { allowFail: true });
  if (!selected || /[\r\n\x00]/u.test(selected)) fail('workspace-required');
  const configRevision = read(root, ['rev-parse', '--verify', `${policy.protectedRef}^{commit}`]);
  const config = workspaceConfiguration(root, configRevision);
  if (config.schema !== 'agentic-os/workspace/v2') fail('workspace-v2-required');
  const { container } = selectedSources(root, policy, selected, config, ['memory']);
  return { root, policy, repository: profile.repository, source: container, remote: config.remote, configRevision };
}
function identity(context) {
  if (remoteTransport('origin', context.source).fetchUrl !== context.remote) fail('remote-drift');
}
function remote(context) {
  identity(context);
  const output = read(context.source, ['ls-remote', '--refs', context.remote, BOARD_REF], { maxBuffer: 4096 });
  if (!output) return null;
  const match = output.match(/^([a-f0-9]{40}(?:[a-f0-9]{24})?)\t(.+)$/u);
  if (!match || match[2] !== BOARD_REF) fail('remote-ref'); return match[1];
}
// Separate mutation transport retains unknown outcomes. Never repeat a timed-out push blindly.
function transport(context, args) {
  identity(context);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key)
    || ['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT'].includes(key)));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_NO_REPLACE_OBJECTS: '1' });
  const result = spawnSync('git', ['-c', 'gc.auto=0', '-c', 'fetch.writeCommitGraph=false',
    '-c', 'credential.interactive=false', ...args],
    { cwd: context.source, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 65536,
      detached: process.platform !== 'win32', timeout: 15000, killSignal: 'SIGKILL' });
  try {
    if (result.pid && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(result.pid), '/T', '/F'],
      { timeout: 1000, stdio: 'ignore' });
    else if (result.pid) process.kill(-result.pid, 'SIGKILL');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  identity(context); return !result.error && result.status === 0;
}
function load(context, revision) {
  if (revision === null) return emptyBoard();
  const tree = read(context.source, ['ls-tree', '-z', revision]);
  const match = tree.match(/^100644 blob ([a-f0-9]{40,64})\tboard.json\0$/u);
  if (!match) fail('board-tree');
  const size = Number(read(context.source, ['cat-file', '-s', match[1]]));
  if (!Number.isSafeInteger(size) || size > COLLAB_LIMITS.bytes) fail('board-size');
  const bytes = read(context.source, ['cat-file', 'blob', match[1]], { binary: true });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = validateBoard(JSON.parse(text));
  if (canonicalJson(value) !== text) fail('board-canonical'); return value;
}
function snapshot(context, offline = false) {
  identity(context);
  const cached = read(context.source, ['rev-parse', '--verify', CACHE_REF], { allowFail: true });
  if (offline) { if (!cached) fail('offline-no-cache'); return { revision: cached, board: load(context, cached) }; }
  const revision = remote(context);
  if (cached && !revision) fail('remote-board-removed');
  if (revision && revision !== cached) {
    if (!transport(context, ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules',
      '--no-auto-maintenance', '--no-write-fetch-head', '--', context.remote, revision])) fail('fetch-failed');
    if (cached && read(context.source, ['merge-base', '--is-ancestor', cached, revision], { allowFail: true }) === null)
      fail('history-rewrite');
  }
  const board = load(context, revision);
  if (cached && revision !== cached) {
    const previous = load(context, cached);
    if (board.sequence < previous.sequence || board.updatedAt < previous.updatedAt) fail('history-state-regression');
  }
  if (revision && revision !== cached) atomicAdvanceRef(CACHE_REF, revision, cached ?? '0'.repeat(revision.length), [], context.source);
  return { revision, board };
}
function locked(context, operation) {
  const lock = acquireOperationLock('agentic-os-collaboration', context.source); if (!lock) fail('busy');
  let result, error; try { result = operation(); } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'collaboration', result, error,
    artifacts: error?.operationArtifacts ?? { source: context.source } });
}
function retained(error, candidate, revision, observed = null) {
  const writeResultUnknown = observed !== candidate;
  return Object.assign(error, { candidate, expectedRevision: revision, observedRevision: observed, writeResultUnknown,
    retainedOperation: true, operationResult: null,
    operationError: { reason: error.reason ?? null, message: error.message },
    operationArtifacts: { effectsRetained: true, operation: 'collaboration-publish', remoteRef: BOARD_REF,
      candidateOid: candidate, priorOid: revision, remoteRefCurrentOid: observed,
      candidateObjectWritten: true, refPublished: !writeResultUnknown, writeResultUnknown } });
}
function receipt(context, revision, board, extra) {
  return { schema: COLLAB_SCHEMA, repository: context.repository, configRevision: context.configRevision,
    boardRef: BOARD_REF, revision, boardDigest: governanceDigest(board), grantsAuthority: false,
    execution: 'caller-owned', ...extra };
}
export function observeBoard(context, { offline = false, taskId = null } = {}) {
  return locked(context, () => {
    const { revision, board } = snapshot(context, offline);
    const tasks = board.tasks.filter(t => t.repository === context.repository);
    const task = tasks.find(t => t.id === taskId);
    if (taskId !== null && !task) fail('task-scope');
    return receipt(context, revision, board, { status: offline ? 'offline-context-only' : 'observed',
      ...(task ? { task } : { tasks: tasks.map(({ id, state, epoch, actor, expiresAt }) =>
        ({ id, state, epoch, actor, expiresAt })), active: board.tasks.filter(t => t.state === 'active').length,
      maxActive: COLLAB_LIMITS.active }) });
  });
}
export function updateBoard(context, operation, request) {
  return locked(context, () => {
    const { revision, board } = snapshot(context);
    if (request?.expectedRevision !== (revision ?? 'absent')) fail('stale-revision-refresh');
    if (operation === 'submit') {
      if (request.sourceRevision !== read(context.root, ['rev-parse', '--verify', `${context.policy.protectedRef}^{commit}`]))
        fail('source-pin');
      memoryTaskContext(context.root, context.policy, request.contextRevision);
    }
    if (operation === 'claim') {
      const task = board.tasks.find(t => t.id === request.id && t.repository === context.repository);
      if (!task) fail('task-scope');
      read(context.root, ['cat-file', '-e', `${task.sourceRevision}^{commit}`]);
      memoryTaskContext(context.root, context.policy, task.contextRevision);
    }
    const next = transitionBoard(board, operation, request, context), bytes = canonicalJson(next);
    const blob = git(['hash-object', '-w', '--stdin'], { cwd: context.source, input: bytes, maxBuffer: 4096 });
    const tree = git(['mktree'], { cwd: context.source, input: `100644 blob ${blob}\tboard.json\n`, maxBuffer: 4096 });
    const candidate = git(['-c', 'commit.gpgSign=false', 'commit-tree', tree,
      ...(revision ? ['-p', revision] : []), '-m', `collaboration ${operation}`],
      { cwd: context.source, maxBuffer: 4096 });
    if (!SHA.test(candidate)) fail('candidate');
    try { transport(context, ['push', '--porcelain', `--force-with-lease=${BOARD_REF}:${revision ?? ''}`, '--',
      context.remote, `${candidate}:${BOARD_REF}`]); } catch { /* Reconcile the exact candidate below. */ }
    let observed;
    try { observed = remote(context); } catch {
      throw retained(new Error('blocked-collaboration-publication-unknown-reconcile'), candidate, revision);
    }
    if (observed !== candidate) throw retained(new Error('blocked-collaboration-publication-not-current-reconcile'),
      candidate, revision, observed);
    try { atomicAdvanceRef(CACHE_REF, candidate, revision ?? '0'.repeat(candidate.length), [], context.source); }
    catch (error) { throw retained(error, candidate, revision, observed); }
    return receipt(context, candidate, next, { status: 'published', operation,
      task: next.tasks.find(t => t.id === request.id) });
  });
}
export function runCollaboration(root, policy, profile, argv, out = console.log) {
  const context = collaborationContext(root, policy, profile), operation = argv[0], path = option(argv, 'input');
  const input = path === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedFile(path, 16384, 'collaboration input')));
  if (operation === 'get') { keys(input, 'id'); if (typeof input.id !== 'string') fail('task-id'); }
  const receipt = operation === 'status' ? observeBoard(context, { offline: argv.includes('--offline') })
    : operation === 'get' ? observeBoard(context, { taskId: input.id }) : updateBoard(context, operation, input);
  out(`collaboration ${JSON.stringify(receipt)}`); return 0;
}
