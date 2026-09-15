import { randomUUID } from 'node:crypto';
import { nextSwarmWake } from './agent-swarm-recovery.js';
import { withDeadline } from './running-agent-contract.js';

const terminal = new Set(['completed', 'blocked', 'canceled']);
function wake(record, maxReconciliations) {
  if (terminal.has(record.status)) return null;
  if (record.schema === 'agent-swarm-start/v2') return record.planningLeaseExpiresAt ?? 0;
  if (record.schema !== 'agent-swarm-run/v2') return null;
  const candidates = [nextSwarmWake(record), ...record.tasks.filter(task => task.status === 'reconciling'
    && (task.reconciliations ?? 0) < maxReconciliations).map(task =>
    Math.max(task.reconcileAfter ?? 0, task.reconciliation?.expiresAt ?? 0))].filter(value => value !== null);
  return candidates.length ? Math.min(record.deadlineAt, ...candidates) : record.deadlineAt;
}

/** One bounded wake for a process, alarm or on-demand host. The existing runtime
 * owns all claims and transitions. No credentials, timers or second job ledger. */
export function createAgentSwarmWorker({ runtime, stateStore, resolveContext, concurrency = 1,
  scanLimit = 128, now = () => Date.now() } = {}) {
  if (typeof stateStore?.listPending !== 'function' || typeof resolveContext !== 'function'
    || typeof runtime?.work !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8
    || !Number.isSafeInteger(scanLimit) || scanLimit < concurrency || scanLimit > 128)
    throw new TypeError('Worker requires explicit bounded runtime, scan and current authorization.');
  let active = false, cursor = '';
  return Object.freeze({ async tick({ signal } = {}) {
    if (active) return { status: 'busy', nextEligibleAt: now() + 1_000, runs: [] };
    active = true;
    try {
      const at = now(), maxReads = runtime.stats().maxReconciliations;
      const records = await stateStore.listPending({ limit: scanLimit });
      const eligible = records.filter(record => { const due = wake(record, maxReads); return due !== null && due <= at; })
        .sort((a, b) => a.runId.localeCompare(b.runId));
      const ordered = [...eligible.filter(record => record.runId > cursor), ...eligible.filter(record => record.runId <= cursor)];
      const selected = ordered.slice(0, concurrency);
      if (selected.length) cursor = selected.at(-1).runId;
      const paused = new Set();
      const runs = await Promise.all(selected.map(async record => {
        try {
          if (signal?.aborted) return { runId: record.runId, status: 'paused', reasonCode: 'worker_stopped' };
          let context;
          try {
            const authorization = new AbortController();
            context = await withDeadline(() => resolveContext(record.ownerPrincipalId,
              { signal: authorization.signal }), signal, 5_000, authorization);
            if (context?.principalId !== record.ownerPrincipalId
              || (context.principalExpiresAt !== undefined && context.principalExpiresAt <= now()))
              throw Error('Current principal unavailable');
          } catch {
            paused.add(record.runId);
            return { runId: record.runId, status: 'paused', reasonCode: 'worker_authority_unavailable' };
          }
          const operationId = randomUUID(), request = { runId: record.runId, operationId, signal };
          let result;
          if (record.schema === 'agent-swarm-start/v2') result = await runtime.start({ ...record.request, signal }, context);
          else {
            const task = record.tasks.find(task => task.status === 'reconciling'
              && (task.reconciliations ?? 0) < maxReads && (task.reconcileAfter ?? 0) <= at
              && (task.reconciliation?.expiresAt ?? 0) <= at);
            result = task ? await runtime.retry({ ...request, taskId: task.taskId }, context)
              : record.tasks.every(task => ['completed', 'failed', 'skipped', 'canceled'].includes(task.status))
                ? await runtime.settle(request, context)
                : await runtime.work({ ...request, workerId: `worker-${operationId}` }, context);
          }
          return { runId: record.runId, status: result.status, ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}) };
        } catch (error) {
          return { runId: record.runId, status: 'paused', reasonCode: error.reasonCode ?? 'worker_authority_or_runtime_unavailable' };
        }
      }));
      const pending = await stateStore.listPending({ limit: scanLimit });
      const times = pending.filter(record => !paused.has(record.runId))
        .map(record => wake(record, maxReads)).filter(value => value !== null);
      // A stalled authority or capacity owner must not create a busy retry loop.
      return { status: 'idle', runs, awaitingAuthorization: paused.size,
        nextEligibleAt: times.length ? Math.max(now() + 1_000, Math.min(...times)) : null };
    } finally { active = false; }
  } });
}
