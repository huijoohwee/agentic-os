import { createHash, randomUUID } from 'node:crypto';
import { canonicalizeJson } from '../json-contract.mjs';
import { AgentSwarmBlock } from './agent-swarm-contract.js';
import { requireLedger, requireLedgerOwner, projectSwarmLedger } from './agent-swarm-ledger.js';

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
