import { createHash, randomUUID } from 'node:crypto';
import { canonicalizeJson } from '../json-contract.mjs';
import { AgentSwarmBlock } from './agent-swarm-contract.js';
import { requireLedger, requireLedgerOwner, projectSwarmLedger } from './agent-swarm-ledger.js';
import { withDeadline } from './running-agent-contract.js';

export const START_SCHEMA = 'agent-swarm-start/v2';
export const digest = value => createHash('sha256').update(JSON.stringify(canonicalizeJson(value))).digest('hex');
export function requestDigest({ signal, ...request }) { return digest(request); }

/** All writers use fresh claim identities; public operation IDs never become fences. */
export function createSwarmCoordinator({ store, limits, instant, wait, policyDigest, planningEffect = 'unknown' }) {
  async function withLedger(runId, operationId, principalId, transition, migrationDigest) {
    const nonce = randomUUID();
    for (let attempt = 1; attempt <= limits.storeClaimAttempts; attempt += 1) {
      const claimId = `${nonce}:${attempt}`;
      const ledger = await store.claim(runId, claimId, instant() + limits.storeClaimTtlMs);
      if (!ledger) {
        if (!await store.get(runId)) throw new AgentSwarmBlock('run_missing', 'Run is unavailable.');
        if (attempt < limits.storeClaimAttempts) await wait(limits.storeClaimRetryMs);
        continue;
      }
      try {
        requireLedgerOwner(requireLedger(ledger, runId, { readOnly: migrationDigest !== undefined }), principalId);
        if (migrationDigest !== undefined) {
          if (ledger.schema !== 'agent-swarm-run/v1' || digest(ledger) !== migrationDigest)
            throw new AgentSwarmBlock('migration_source_changed', 'Legacy source changed; inspect it again.');
        } else if (ledger.policyDigest !== policyDigest) throw new AgentSwarmBlock('execution_policy_mismatch', 'Restore the admitted execution policy before resuming.');
        const result = await transition(ledger, instant());
        if (!await store.replace(runId, claimId, ledger)) throw new AgentSwarmBlock('ledger_conflict', 'Coordinator lease expired before commit.');
        return result;
      } catch (error) { await store.release(runId, claimId).catch(() => false); throw error; }
    }
    throw new AgentSwarmBlock('run_busy', 'Run is owned by another bounded coordinator.');
  }

  async function reserveStart(request, principalId) {
    const at = instant(), reservationId = randomUUID();
    const { signal, ...persistedRequest } = request;
    const candidate = { schema: START_SCHEMA, runId: request.runId, reservationId,
      ownerPrincipalId: principalId, requestDigest: requestDigest(request), policyDigest,
      request: persistedRequest, planningAttempts: 1, planningLeaseExpiresAt: at + limits.taskLeaseMs,
      status: 'planning', createdAt: new Date(at).toISOString(), deadlineAt: at + limits.runTtlMs,
      expiresAt: at + limits.runTtlMs + limits.retentionMs };
    if (await store.put(candidate)) return candidate;
    const existing = await store.get(request.runId);
    if (!existing) throw new AgentSwarmBlock('run_missing', 'Run is unavailable.');
    requireLedgerOwner(existing, principalId);
    if (existing.requestDigest !== candidate.requestDigest || existing.policyDigest !== policyDigest)
      throw new AgentSwarmBlock('run_identity_conflict', 'Run identity is bound to a different request or policy.');
    if (existing.schema !== START_SCHEMA || existing.status !== 'planning'
      || existing.planningLeaseExpiresAt > at) return null;
    return withStartReservation(request.runId, existing.reservationId, async (claimId, record) => {
      const reasonCode = record.deadlineAt <= at ? 'run_deadline_exceeded'
        : planningEffect !== 'read-only' ? 'planning_outcome_unknown'
          : record.planningAttempts >= limits.maxAttempts ? 'planning_attempts_exhausted' : null;
      const next = reasonCode ? { ...record, status: 'blocked', reasonCode }
        : { ...record, reservationId, planningAttempts: record.planningAttempts + 1,
          planningLeaseExpiresAt: Math.min(at + limits.taskLeaseMs, record.deadlineAt) };
      if (!await store.replace(request.runId, claimId, next)) return null;
      return reasonCode ? null : next;
    });
  }

  async function withStartReservation(runId, reservationId, transition) {
    const nonce = randomUUID();
    for (let attempt = 1; attempt <= limits.storeClaimAttempts; attempt += 1) {
      const claimId = `${nonce}:${attempt}`;
      const reservation = await store.claim(runId, claimId, instant() + limits.storeClaimTtlMs);
      if (!reservation) {
        if (attempt < limits.storeClaimAttempts) await wait(limits.storeClaimRetryMs);
        continue;
      }
      try {
        if (reservation.schema !== START_SCHEMA || reservation.reservationId !== reservationId
          || reservation.status !== 'planning') return false;
        return await transition(claimId, reservation);
      } finally { await store.release(runId, claimId).catch(() => false); }
    }
    return false;
  }

  const commitStart = (runId, reservationId, ledger) => withStartReservation(runId, reservationId,
    (claimId, record) => record.planningLeaseExpiresAt > instant() && record.deadlineAt > instant()
      ? store.replace(runId, claimId, { ...ledger, deadlineAt: record.deadlineAt, expiresAt: record.expiresAt }) : false);
  const discardStart = (runId, reservationId, reasonCode = 'planning_failed') => withStartReservation(runId, reservationId,
    (claimId, record) => store.replace(runId, claimId, { ...record, status: 'blocked', reasonCode }));

  async function cancelPlanning(request, principalId, authorize) {
    const record = await store.get(request.runId);
    if (record?.schema !== START_SCHEMA) return null;
    requireLedgerOwner(record, principalId);
    if (record.policyDigest !== policyDigest) throw new AgentSwarmBlock('execution_policy_mismatch', 'Restore the admitted policy.');
    await authorize(record);
    if (record.status !== 'planning') return project(record, principalId);
    const changed = await withStartReservation(request.runId, record.reservationId, (claimId, current) =>
      store.replace(request.runId, claimId, { ...current, status: 'canceled', reasonCode: request.reason ?? 'canceled' }));
    if (!changed) throw new AgentSwarmBlock('ledger_conflict', 'Planning changed before cancellation.');
    return project(await store.get(request.runId), principalId);
  }

  function project(record, principalId) {
    requireLedgerOwner(record, principalId);
    if (record.schema === START_SCHEMA) return Object.freeze({ status: record.status, stage: 'agent-swarm',
      runId: record.runId, ...(record.reasonCode ? { reasonCode: record.reasonCode } : {}),
      requestDigest: record.requestDigest, deadlineAt: record.deadlineAt, expiresAt: record.expiresAt });
    return projectSwarmLedger(requireLedger(record, record.runId, { readOnly: true }), store.stats());
  }
  async function replayStart(request, principalId) {
    const record = await store.get(request.runId);
    if (!record) throw new AgentSwarmBlock('run_missing', 'Run is unavailable.');
    requireLedgerOwner(record, principalId);
    if (record.requestDigest !== requestDigest(request) || record.policyDigest !== policyDigest)
      throw new AgentSwarmBlock('run_identity_conflict', 'Run identity is bound to a different request or policy.');
    return project(record, principalId);
  }
  return { withLedger, reserveStart, commitStart, discardStart, replayStart, cancelPlanning, project };
}

/** Bridges existing execution and evidence owners; it owns no additional state. */
export function createSwarmInstrumentation({ store, toolkit, resources, profile, requireContext, now }) {
  const blocked = code => { throw new AgentSwarmBlock(code, code); };
  const access = principalId => ({ principalId, telemetryTrust: 'server-observed' });
  async function observe(runId, principalId, operationId, phase, operation, signal) {
    if (!toolkit && !requireContext) return operation({ signal });
    const record = await store.get(runId), context = record?.context ?? record?.request?.context;
    if (!context) { if (requireContext) blocked('context_required'); return operation({ signal }); }
    if (!toolkit || !resources || !profile) blocked('mission_unconfigured');
    const agent = record.agent ?? record.request.agent;
    const reservation = await resources.reserve({ context, principalId, runId, agentId: agent.agentId, operationId, phase });
    if (reservation.replay) blocked('allocation_usage_unknown');
    let dispatched = false, spanStarted = false;
    let startedAt = now();
    try {
      const adapter = { id: 'durable-run', revision: 'v2', digest: digest(['durable-run', record.policyDigest]) };
      let observed = await toolkit.status(runId, access(principalId));
      if (['admission_required', 'run_not_found'].includes(observed.reasonCode)) observed = await toolkit.start({ runId,
        cohortId: `project-${digest([context.projectId, agent, profile])}`, target: { kind: 'agent', id: agent.agentId, revision: agent.revision, digest: digest(agent) },
        candidate: { id: context.plan.path, revision: context.plan.revision, digest: context.plan.digest },
        adapter, profile, operation: 'durable-run', context }, access(principalId));
      if (observed.reasonCode === 'run_reused') observed = await toolkit.status(runId, access(principalId));
      if (observed.status !== 'running' || digest(observed.context) !== digest(context)) blocked('trace_context_mismatch');
      const root = await toolkit.startSpan({ runId, spanId: 'root', kind: 'workflow', operation: 'durable-run', component: adapter }, access(principalId));
      if (root.status === 'blocked') blocked(root.reasonCode);
      const task = record.tasks?.find(t => t.executionId === operationId);
      const dependencies = phase === 'synthesize' ? record.tasks.filter(t => t.status === 'completed')
        : task ? record.tasks.filter(t => task.dependencies.includes(t.taskId)) : [];
      const span = await toolkit.startSpan({ runId, spanId: operationId, parentSpanId: 'root', kind: phase === 'work' ? 'model' : 'tool',
        operation: phase, component: adapter, taskId: task?.taskId ?? context.taskId,
        attempt: task?.attempts ?? record.planningAttempts ?? record.synthesis?.attempts ?? 1,
        links: dependencies.flatMap(t => observed.spans.filter(s => s.taskId === t.taskId && s.attempt === t.attempts && s.status === 'completed')
          .map(s => ({ spanId: s.spanId, kind: 'dependency' }))) }, access(principalId));
      if (span.status === 'blocked' && span.reasonCode !== 'span_limit') blocked(span.reasonCode);
      spanStarted = span.status !== 'blocked';
      const controller = new AbortController();
      startedAt = now();
      const value = await withDeadline(() => { dispatched = true; return operation({ resourceBounds: reservation.bounds, runContext: context, signal: controller.signal }); },
        signal, reservation.bounds.elapsedMs, controller);
      const reported = value.costLog ?? (value.output?.usage ? { model: agent.agentId, prompt_tokens: value.output.usage.promptTokens,
        completion_tokens: value.output.usage.completionTokens, cache_hits: 0, estimated_cost_usd: 0 } : null);
      if (reported?.estimated_cost_usd > 0) blocked('paid_execution_forbidden');
      const settled = await resources.settle(reservation, principalId, reported ? { inputTokens: reported.prompt_tokens,
        outputTokens: reported.completion_tokens, attempts: 1, elapsedMs: now() - startedAt } : null);
      if (spanStarted) await toolkit.finishSpan({ runId, spanId: operationId, status: 'completed', effectId: operationId,
        ...(reported ? { costLog: reported } : {}) }, access(principalId));
      if (settled.state !== 'settled') blocked('allocation_usage_unknown');
      return value;
    } catch (error) {
      await resources.settle(reservation, principalId, dispatched ? null : { inputTokens: 0, outputTokens: 0, attempts: 0, elapsedMs: 0 }).catch(() => {});
      if (spanStarted) await toolkit.finishSpan({ runId, spanId: operationId, status: 'failed', reasonCode: 'adapter_failed', effectId: operationId }, access(principalId)).catch(() => {});
      throw error;
    }
  }
  async function sync(runId, principalId) {
    if (!toolkit) return;
    const record = await store.get(runId);
    if (!toolkit || !(record?.context ?? record?.request?.context) || !['completed', 'blocked', 'canceled'].includes(record.status)) return;
    const status = record.status === 'blocked' ? 'failed' : record.status;
    const observed = await toolkit.status(runId, access(principalId));
    if (observed.status !== 'running') return;
    const logs = record.costLogs ?? [], completeUsage = logs.length === record.attemptedCalls && logs.every(Boolean);
    const costLog = completeUsage ? { model: 'durable-run', cache_hits: 0, estimated_cost_usd: 0,
      prompt_tokens: logs.reduce((n, l) => n + l.prompt_tokens, 0), completion_tokens: logs.reduce((n, l) => n + l.completion_tokens, 0) } : undefined;
    await toolkit.finishSpan({ runId, spanId: 'root', status }, access(principalId));
    await toolkit.complete({ runId, operationId: 'durable-terminal', status, ...(costLog ? { costLog } : {}),
      ...(status === 'completed' ? {} : { reasonCode: status === 'canceled' ? 'operator_cancelled' : 'workflow_failed' }) }, access(principalId));
  }
  return { observe, sync };
}
