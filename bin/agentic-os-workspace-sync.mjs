/** Session-scoped refresh. Source bytes, branches and execution authority remain source-owned. */
import { setTimeout as delay } from 'node:timers/promises';
import { acquireOperationLock, finishOperationLock, observeGit } from '../src/git.mjs';
import { hydrateWorkspace, runWorkspace, selectedSources, workspaceConfiguration } from './agentic-os-workspace.mjs';

import { flag, option } from './agentic-os-argv.mjs';

const fail = reason => { throw new Error(`blocked-workspace-${reason}`); };
export function watchSettings({ intervalMs = 30000, durationMs = 28800000 } = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000
    || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 43200000) fail('watch-budget');
  return { intervalMs, durationMs };
}
export function workspaceSource(root, policy) {
  const selected = observeGit(['config', '--local', '--get-all', 'agentic-os.workspaceRoot'],
    { cwd: root, allowFail: true, maxBuffer: 8192 });
  if (!selected || /[\r\n\x00]/u.test(selected)) fail('enrollment-required');
  const revision = observeGit(['rev-parse', '--verify', `${policy.protectedRef}^{commit}`], { cwd: root });
  const config = workspaceConfiguration(root, revision);
  if (config.schema !== 'agentic-os/workspace/v2') fail('sync-requires-v2');
  return selectedSources(root, policy, selected, config, ['memory', 'todo', 'artifacts']).container;
}
export function syncWorkspace(root, policy, { offline = false } = {}) {
  workspaceSource(root, policy);
  return hydrateWorkspace(root, policy, { offline, sync: true });
}

/** Inject time/sleep only for deterministic lifecycle tests; production uses monotonic elapsed time. */
export async function watchLoop({ observe, emit, signal, wake,
  intervalMs = 30000, durationMs = 28800000, now = () => performance.now(),
  sleep = (ms, signal) => delay(ms, undefined, { signal }) }) {
  watchSettings({ intervalMs, durationMs });
  const started = now();
  let signature = null, failures = 0, attempt = 0;
  while (!signal?.aborted && now() - started < durationMs) {
    const receipt = await observe();
    attempt++;
    const memory = receipt.sources?.memory;
    const next = JSON.stringify([receipt.sourceRevision, receipt.configRevision, memory?.status, memory?.refreshError]);
    if (next !== signature) { emit(receipt); signature = next; }
    failures = memory?.refreshError ? failures + 1 : 0;
    const timeout = Math.min(intervalMs * 2 ** Math.min(failures, 5), 300000, durationMs - (now() - started));
    if (timeout <= 0 || signal?.aborted) break;
    const waiting = new AbortController();
    const cancel = () => waiting.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    wake?.addEventListener('wake', cancel);
    try { await sleep(timeout, waiting.signal); }
    catch (error) { if (error.name !== 'AbortError') throw error; }
    finally { signal?.removeEventListener('abort', cancel); wake?.removeEventListener('wake', cancel); }
  }
  return { status: 'stopped', attempts: attempt, grantsAuthority: false };
}

export async function watchWorkspace(root, policy, options = {}, out = console.log) {
  const settings = watchSettings(options), source = workspaceSource(root, policy);
  const lock = acquireOperationLock('agentic-os-workspace-watch', source);
  if (!lock) fail('watch-busy');
  const stop = new AbortController(), wake = new EventTarget();
  const cancel = () => stop.abort(), resume = () => wake.dispatchEvent(new Event('wake'));
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  process.on('SIGHUP', resume); process.on('SIGCONT', resume);
  let result, error;
  try {
    result = await watchLoop({ ...settings, signal: stop.signal, wake,
      observe: () => syncWorkspace(root, policy),
      emit: receipt => out(`workspace ${JSON.stringify(receipt)}`) });
  } catch (caught) { error = caught; }
  finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    process.off('SIGHUP', resume); process.off('SIGCONT', resume);
  }
  return finishOperationLock(lock, { label: 'workspace-watch', result, error });
}

export async function runWorkspaceCommand(root, policy, command, argv, out = console.log) {
  if (command === 'memory' && ['search', 'read', 'capture'].includes(argv[0]))
    return (await import('./agentic-os-memory-task.mjs')).runMemoryTask(root, policy, argv, out);
  if (argv[0] === 'watch' || argv[0] === 'sync') {
    if (argv[0] === 'watch') await watchWorkspace(root, policy,
      { intervalMs: Number(option(argv, 'interval-ms', '30000')),
        durationMs: Number(option(argv, 'duration-ms', '28800000')) }, out);
    else out(`workspace ${JSON.stringify(syncWorkspace(root, policy, { offline: flag(argv, 'offline') }))}`);
    return 0;
  }
  return runWorkspace(root, policy,
    { offline: flag(argv, 'offline'), source: command === 'memory' ? 'memory' : option(argv, 'source') }, out);
}
