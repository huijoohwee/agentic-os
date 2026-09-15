import { AgentSwarmBlock, AgentSwarmFailure } from './agent-swarm-contract.js';

export const retryAt = (attempts, limits, at) => at + Math.min(limits.retryMaxMs,
  limits.retryBaseMs * 2 ** Math.min(30, Math.max(0, attempts - 1)));

export function classifyTaskFailure(error, started, effectPolicy) {
  if (!started) return { kind: error instanceof AgentSwarmBlock ? 'permanent' : 'transient', effectState: 'absent' };
  if (error instanceof AgentSwarmFailure) return { kind: error.kind, effectState: error.effectState };
  return { kind: error instanceof AgentSwarmBlock ? 'permanent' : 'transient',
    effectState: effectPolicy === 'read-only' ? 'absent' : 'unknown' };
}

export function clearTaskExecution(task) {
  if (task.executionId) task.lastExecutionId = task.executionId;
  delete task.workerId; delete task.executionId; delete task.leaseExpiresAt; delete task.startedAt;
}

export function scheduleTaskFailure(task, failure, reasonCode, ledger, limits, at) {
  task.lastWorkerId = task.workerId;
  task.reasonCode = reasonCode;
  task.failureKind = failure.kind;
  task.effectState = failure.effectState;
  const uncertain = failure.effectState === 'unknown';
  const retryable = !uncertain && failure.kind === 'transient' && task.attempts < limits.maxAttempts;
  task.status = uncertain ? 'reconciling' : retryable ? 'pending' : 'failed';
  if (retryable) {
    task.nextEligibleAt = retryAt(task.attempts, limits, at);
    ledger.metrics.retries += 1;
  } else if (!uncertain) task.completedAt = new Date(at).toISOString();
  clearTaskExecution(task);
  return { accepted: true, retryable, reconciling: uncertain, nextEligibleAt: task.nextEligibleAt };
}

/** Waiting returns control to the host; no timer loop holds a worker while time passes. */
export function nextSwarmWake(ledger) {
  if (["completed", "blocked", "canceled"].includes(ledger.status)) return null;
  const pending = ledger.tasks.filter(task => task.status === 'pending' && task.dependencies.every(id =>
    ledger.tasks.find(candidate => candidate.taskId === id)?.status === 'completed'));
  const values = pending.map(task => task.nextEligibleAt ?? 0);
  values.push(...ledger.tasks.filter(task => task.status === "running").map(task => task.leaseExpiresAt));
  if (ledger.synthesis?.status === "running") values.push(ledger.synthesis.leaseExpiresAt);
  if (ledger.synthesis?.status === 'pending' && ledger.tasks.every(task => ['completed', 'failed', 'skipped', 'canceled'].includes(task.status)))
    values.push(ledger.synthesis.nextEligibleAt ?? 0);
  return values.length ? Math.min(...values) : null;
}
