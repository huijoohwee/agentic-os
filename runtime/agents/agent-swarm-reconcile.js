import { randomUUID } from 'node:crypto';
import { AgentSwarmBlock, assertExactKeys, assertIdentifier, normalizeAccessContext,
  normalizeWorkerOutcome, normalizeReceiptVerification } from './agent-swarm-contract.js';
import { completeSwarmTask, projectSwarmLedger, recoverSwarmLedger } from './agent-swarm-ledger.js';
import { retryAt } from './agent-swarm-recovery.js';

/** Reconciliation reads effect authority. A negative read alone never permits another effect. */
export function createSwarmReconciler({ withLedger, authorizeOperation, reconcileTask, verifyReceipt,
  bounded, limits, instant, stateStats }) {
  return async function retry(value, contextValue = {}) {
    assertExactKeys(value, ['runId', 'taskId', 'operationId', 'signal'], 'request');
    const request = { runId: assertIdentifier(value.runId, 'request.runId'),
      taskId: assertIdentifier(value.taskId, 'request.taskId'),
      operationId: assertIdentifier(value.operationId, 'request.operationId'), signal: value.signal };
    const context = normalizeAccessContext(contextValue);
    if (request.signal !== undefined && (typeof request.signal?.aborted !== 'boolean'
      || typeof request.signal?.addEventListener !== 'function' || typeof request.signal?.removeEventListener !== 'function'))
      throw new TypeError('request.signal must be an AbortSignal.');
    await authorizeOperation('retry', request, context);
    if (typeof reconcileTask !== 'function') throw new AgentSwarmBlock('reconciliation_unconfigured', 'An authoritative effect reader is required.');
    const id = randomUUID();
    const claim = await withLedger(request.runId, request.operationId, context.principalId, (ledger, at) => {
      recoverSwarmLedger(ledger, limits, at);
      const task = ledger.tasks.find(task => task.taskId === request.taskId);
      if (ledger.status !== 'running' || !task || task.status !== 'reconciling')
        throw new AgentSwarmBlock('retry_unavailable', 'Only an unresolved effect can be reconciled.');
      if (task.reconciliation?.expiresAt > at || (task.reconcileAfter ?? 0) > at)
        throw new AgentSwarmBlock('reconciliation_busy', 'Reconciliation is already active or delayed.');
      if ((task.reconciliations ?? 0) >= limits.maxReconciliations)
        throw new AgentSwarmBlock('reconciliation_exhausted', 'The bounded readback attempts are exhausted; preserve the unresolved effect.');
      task.reconciliations = (task.reconciliations ?? 0) + 1;
      task.reconciliation = { id, expiresAt: Math.min(at + limits.taskLeaseMs, context.principalExpiresAt ?? Infinity) };
      return { task: structuredClone(task), agent: ledger.agent, requestDigest: ledger.requestDigest };
    });
    let observed;
    try {
      if (instant() + limits.taskTimeoutMs + limits.storeClaimTtlMs >= claim.task.reconciliation.expiresAt)
        throw new AgentSwarmBlock('reconciliation_launch_deadline', 'Readback cannot finish within its lease.');
      observed = await bounded(async signal => {
        const result = await reconcileTask(Object.freeze({ runId: request.runId, taskId: request.taskId,
          principalId: context.principalId, idempotencyKey: claim.task.idempotencyKey,
          executionId: claim.task.lastExecutionId, agent: claim.agent, requestDigest: claim.requestDigest, signal }));
        assertExactKeys(result, ['status', 'verified', 'idempotencyKey', 'quiescent', 'reference', 'outcome'], 'reconciliation');
        if (!['completed', 'absent', 'pending', 'unknown'].includes(result.status)
          || result.verified !== true || result.idempotencyKey !== claim.task.idempotencyKey)
          throw new AgentSwarmBlock('reconciliation_unverified', 'Readback must bind the original effect key.');
        assertIdentifier(result.reference, 'reconciliation.reference', 512);
        if (result.status === 'absent' && result.quiescent !== true)
          throw new AgentSwarmBlock('reconciliation_not_quiescent', 'The prior executor may still emit an effect.');
        if (result.status === 'completed') {
          const outcome = normalizeWorkerOutcome(result.outcome, limits, claim.task.idempotencyKey);
          if (outcome.receipt) normalizeReceiptVerification(await verifyReceipt({ runId: request.runId,
            taskId: request.taskId, executionId: claim.task.lastExecutionId, receipt: outcome.receipt, signal }), outcome.receipt);
          return { ...result, outcome };
        }
        return result;
      }, request.signal);
      await authorizeOperation('retry.commit', request, context);
    } catch (error) {
      await withLedger(request.runId, request.operationId, context.principalId, (ledger, at) => {
        const task = ledger.tasks.find(task => task.taskId === request.taskId);
        if (task?.reconciliation?.id === id) {
          delete task.reconciliation; task.reconcileAfter = retryAt(task.reconciliations, limits, at);
        }
      }).catch(() => false);
      throw error;
    }
    return withLedger(request.runId, request.operationId, context.principalId, (ledger, at) => {
      const task = ledger.tasks.find(task => task.taskId === request.taskId);
      if (ledger.status !== 'running' || task?.status !== 'reconciling' || task.reconciliation?.id !== id
        || task.reconciliation.expiresAt <= at + limits.storeClaimTtlMs || at >= ledger.deadlineAt)
        throw new AgentSwarmBlock('reconciliation_stale', 'Readback ownership expired or was canceled.');
      task.reconciliationReference = observed.reference;
      if (observed.status === 'completed') {
        task.status = 'running'; task.executionId = id; task.workerId = 'effect-readback';
        task.leaseExpiresAt = task.reconciliation.expiresAt;
        completeSwarmTask(ledger, id, observed.outcome, limits, at);
      } else if (observed.status === 'absent') {
        task.effectState = 'absent';
        task.status = task.failureKind !== 'permanent' && task.attempts < limits.maxAttempts ? 'pending' : 'failed';
        task.nextEligibleAt = retryAt(task.attempts, limits, at);
        if (task.status === 'pending') ledger.metrics.retries += 1;
        else {
          task.reasonCode = task.failureKind === 'permanent' ? task.reasonCode : 'task_attempts_exhausted';
          task.completedAt = new Date(at).toISOString();
        }
      } else task.reconcileAfter = retryAt(task.reconciliations, limits, at);
      delete task.reconciliation;
      ledger.updatedAt = new Date(at).toISOString();
      return projectSwarmLedger(ledger, stateStats());
    });
  };
}
