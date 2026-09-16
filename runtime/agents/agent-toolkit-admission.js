import { createHash, randomUUID } from "node:crypto";

import { assertIdentifier, AgentToolkitBlock, normalizeRunContext, normalizeResources, normalizeAllocation, RESOURCE_UNITS, AGENT_TOOLKIT_DEFAULTS } from "./agent-toolkit-contract.js";
import { digestToolkitEvidence } from "./agent-toolkit-ledger.js";

const SCHEMA = "agent-toolkit-admission/v1";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function principalDigest(principalId) {
  return createHash("sha256").update(principalId).digest("hex");
}

function recordId(principalId) {
  return `admission:${principalDigest(principalId)}`;
}

function shardRecordId(principalId, limits) {
  const shard = Number.parseInt(principalDigest(principalId).slice(0, 8), 16) % limits.principalShardCount;
  return `admission-shard:${shard}`;
}

function identityDigest(kind, value) {
  return digestToolkitEvidence([kind, assertIdentifier(value, kind)]);
}

function live(entries, at) {
  return entries.filter((entry) => entry.expiresAt > at);
}

function createRecord(principalId, at, limits) {
  return {
    schema: SCHEMA,
    recordId: recordId(principalId),
    principalDigest: principalDigest(principalId),
    requests: [],
    runs: [],
    cohorts: [],
    updatedAt: new Date(at).toISOString(),
    expiresAt: at + limits.requestWindowMs,
  };
}

function createShardRecord(id, at, limits) {
  return {
    schema: "agent-toolkit-admission-shard/v1",
    recordId: id,
    principals: [],
    updatedAt: new Date(at).toISOString(),
    expiresAt: at + limits.cohortTtlMs,
  };
}

function refresh(record, at, limits) {
  const threshold = at - limits.requestWindowMs;
  record.requests = record.requests.filter((timestamp) => timestamp > threshold);
  record.runs = live(record.runs, at);
  record.cohorts = live(record.cohorts, at);
  return record;
}

function verdict(record, request, at, limits) {
  if (record.requests.length >= limits.maxRequestsPerWindow) {
    const retryAfterMs = Math.max(1, record.requests[0] + limits.requestWindowMs - at);
    return { allowed: false, reasonCode: "rate_limited", retryAfterMs };
  }
  if (request.action === 'reserve') {
    record.allocations ??= [];
    const project = identityDigest('projectId', request.projectId);
    if (!record.allocations.includes(project)) {
      if (record.allocations.length >= 8) return { allowed: false, reasonCode: 'allocation_quota_exceeded' };
      record.allocations.push(project);
    }
  }
  if (request.action === "start" || request.action === "instrument") {
    const runDigest = identityDigest("runId", request.runId);
    const cohortDigest = identityDigest("cohortId", request.cohortId);
    const runKnown = record.runs.some((entry) => entry.digest === runDigest);
    const cohortKnown = record.cohorts.some((entry) => entry.digest === cohortDigest);
    if (!runKnown && record.runs.length >= limits.maxPrincipalRuns) {
      return { allowed: false, reasonCode: "run_quota_exceeded" };
    }
    if (!cohortKnown && record.cohorts.length >= limits.maxPrincipalCohorts) {
      return { allowed: false, reasonCode: "cohort_quota_exceeded" };
    }
    if (!runKnown) record.runs.push({ digest: runDigest, runId: request.runId, expiresAt: at + limits.runTtlMs });
    if (!cohortKnown) record.cohorts.push({ digest: cohortDigest, expiresAt: at + limits.cohortTtlMs });
  }
  record.requests.push(at);
  return { allowed: true };
}

function finalize(record, at, limits) {
  record.updatedAt = new Date(at).toISOString();
  record.expiresAt = Math.max(
    record.allocations?.length ? Number.MAX_SAFE_INTEGER : 0,
    at + limits.requestWindowMs,
    ...record.runs.map((entry) => entry.expiresAt),
    ...record.cohorts.map((entry) => entry.expiresAt),
  );
  return record;
}

/** Shared fenced mutation protocol for evidence, admission and allocations. */
export async function mutateToolkitRecord({ store, id, now, limits = AGENT_TOOLKIT_DEFAULTS, create, transform }) {
  if (create && !await store.get(id)) await store.put(create());
  for (let attempt = 1; attempt <= limits.storeClaimAttempts; attempt++) {
    const at = Number(now()), claimId = randomUUID();
    const record = await store.claim(id, claimId, at + limits.storeClaimTtlMs);
    if (!record) {
      if (!await store.get(id)) return { missing: true };
      if (attempt < limits.storeClaimAttempts) await pause(limits.storeClaimRetryMs);
      continue;
    }
    try {
      const result = await transform(record, at), replacement = result?.record ?? record;
      if (!await store.replace(id, claimId, replacement)) throw new AgentToolkitBlock('state_conflict', 'State fence expired.');
      return { missing: false, record: replacement, value: result?.value };
    } catch (error) { await store.release(id, claimId); throw error; }
  }
  throw new AgentToolkitBlock('state_busy', 'State is owned by another coordinator.');
}

export function createAgentToolkitAdmissionController({ stateStore, now, limits } = {}) {
  if (!stateStore) throw new TypeError("Agent Toolkit admission requires an atomic state store.");
  if (typeof now !== "function") throw new TypeError("Agent Toolkit admission requires a clock.");

  async function mutateRecord(id, at, create, transform) {
    try {
      const result = await mutateToolkitRecord({ store: stateStore, id, now, limits, create,
        transform: record => { const { replacement, result } = transform(record); return { record: replacement, value: result }; } });
      return Object.freeze(result.value ?? { allowed: false, reasonCode: 'admission_busy' });
    } catch (error) {
      if (!['state_busy', 'state_conflict'].includes(error.reasonCode)) throw error;
      return Object.freeze({ allowed: false, reasonCode: 'admission_busy' });
    }
  }

  async function reservePrincipal(principalId, at, persistent) {
    const id = shardRecordId(principalId, limits);
    const digest = principalDigest(principalId);
    return mutateRecord(id, at, () => createShardRecord(id, at, limits), (record) => {
      record.principals = live(record.principals, at);
      const existing = record.principals.find((entry) => entry.digest === digest);
      if (!existing && record.principals.length >= limits.maxPrincipalsPerShard) {
        record.updatedAt = new Date(at).toISOString();
        record.expiresAt = Math.max(at + limits.requestWindowMs, ...record.principals.map((entry) => entry.expiresAt));
        return {
          replacement: record,
          result: { allowed: false, reasonCode: "principal_quota_exceeded" },
        };
      }
      const expiresAt = persistent ? Number.MAX_SAFE_INTEGER : at + limits.cohortTtlMs;
      if (existing) existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
      else record.principals.push({ digest, expiresAt });
      record.updatedAt = new Date(at).toISOString();
      record.expiresAt = Math.max(...record.principals.map((entry) => entry.expiresAt));
      return { replacement: record, result: { allowed: true } };
    });
  }

  async function admit(request) {
    const principalId = assertIdentifier(request?.principalId, "principalId");
    const id = recordId(principalId);
    const at = Number(now());
    if (!Number.isFinite(at)) throw new TypeError("now must return a finite timestamp.");
    const existing = await stateStore.get(id);
    if (!existing && !['start', 'instrument', 'reserve', 'query'].includes(request.action)) {
      return Object.freeze({ allowed: false, reasonCode: "admission_required" });
    }
    if (!existing || request.action === 'reserve') {
      const principal = await reservePrincipal(principalId, at, request.action === 'reserve');
      if (!principal.allowed) return principal;
    }
    return mutateRecord(id, at, () => createRecord(principalId, at, limits), (record) => {
      refresh(record, at, limits);
      const result = verdict(record, request, at, limits);
      return { replacement: finalize(record, at, limits), result };
    });
  }

  return Object.freeze({
    admit,
    async runs(principalId) {
      const record = await stateStore.get(recordId(assertIdentifier(principalId, 'principalId')));
      const entries = live(record?.runs ?? [], Number(now()));
      return { ids: entries.flatMap(e => e.runId ? [e.runId] : []), incomplete: entries.some(e => !e.runId) };
    },
    stats: () => Object.freeze({
      configured: true,
      persistence: stateStore.stats().persistence,
      requestWindowMs: limits.requestWindowMs,
      maxRequestsPerWindow: limits.maxRequestsPerWindow,
      maxPrincipalRuns: limits.maxPrincipalRuns,
      maxPrincipalCohorts: limits.maxPrincipalCohorts,
      principalShardCount: limits.principalShardCount,
      maxPrincipalsPerShard: limits.maxPrincipalsPerShard,
    }),
  });
}

/** One atomic project record owns all dimensions; telemetry is never the ledger. */
export function createAgentResourceAdmission({ stateStore: store, resolveContext, reconcile, now = () => Date.now() } = {}) {
  if (typeof resolveContext !== 'function' || !store || !['get', 'put', 'claim', 'replace', 'release'].every(k => typeof store[k] === 'function'))
    throw new TypeError('Resource admission requires a trusted resolver and atomic state store.');
  const fail = code => { throw new AgentToolkitBlock(code, code); };
  const identity = (principalId, projectId) => `allocation:${digestToolkitEvidence([principalId, projectId])}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const zero = () => Object.fromEntries(RESOURCE_UNITS.map(k => [k, 0]));
  const admission = createAgentToolkitAdmissionController({ stateStore: store, now, limits: AGENT_TOOLKIT_DEFAULTS });
  async function mutate(id, principalId, create, apply) {
    const result = await mutateToolkitRecord({ store, id, now, ...(create ? { create: () => create } : {}),
      transform: (record, at) => {
        if (record.schema !== 'agent-resource-allocation/v1' || record.ownerPrincipalId !== principalId) fail('allocation_forbidden');
        if (at < record.updatedAt) fail('allocation_clock_regressed');
        const value = apply(record, at); record.updatedAt = at; return { value };
      } });
    if (result.missing) fail('allocation_missing');
    return result.value;
  }
  async function resolve(context, principalId, phase) {
    context = normalizeRunContext(context); principalId = assertIdentifier(principalId, 'principalId');
    const answer = await resolveContext(clone(context), { principalId, phase });
    if (!answer || digestToolkitEvidence(normalizeRunContext(answer.context)) !== digestToolkitEvidence(context)) fail('context_stale');
    const allocation = normalizeAllocation(answer.allocation), at = now();
    if (at < allocation.startsAt || at >= allocation.endsAt) fail('allocation_window_closed');
    return { context, allocation };
  }
  async function reserve({ context, principalId, runId, agentId, operationId, phase }) {
    const resolved = await resolve(context, principalId, phase), policy = resolved.allocation;
    for (const [key, value] of Object.entries({ runId, agentId, operationId, phase })) assertIdentifier(value, key, 256);
    const admitted = await admission.admit({ action: 'reserve', principalId, projectId: resolved.context.projectId });
    if (!admitted.allowed) fail(admitted.reasonCode);
    const { bounds, ...allocation } = policy;
    const id = identity(principalId, resolved.context.projectId), policyDigest = digestToolkitEvidence(allocation);
    const entryId = digestToolkitEvidence([runId, agentId, operationId]);
    const requestDigest = digestToolkitEvidence([resolved.context, policyDigest, bounds, phase, runId, agentId, operationId]);
    const create = { schema: 'agent-resource-allocation/v1', recordId: id, ownerPrincipalId: principalId,
      projectId: resolved.context.projectId, policy: allocation, policyDigest, entries: [], updatedAt: now(), expiresAt: Number.MAX_SAFE_INTEGER };
    return mutate(id, principalId, create, (record, at) => {
      if (record.policyDigest !== policyDigest) {
        if (at < record.policy.endsAt || policy.startsAt < record.policy.endsAt || record.entries.some(e => e.state !== 'settled')) fail('allocation_policy_conflict');
        record.previousDigest = digestToolkitEvidence(record);
        record.policy = allocation; record.policyDigest = policyDigest; record.entries = [];
      }
      const prior = record.entries.find(e => e.id === entryId);
      if (prior) { if (prior.requestDigest !== requestDigest) fail('reservation_reused');
        return { ...clone(prior), recordId: id, replay: true }; }
      if (record.entries.some(e => e.state === 'unknown' || e.state === 'overrun')) fail('allocation_usage_unknown');
      if (record.entries.length >= 128) fail('allocation_journal_full');
      for (const dimension of ['project', 'agent', 'run']) {
        const entries = record.entries.filter(e => dimension === 'project' || e[`${dimension}Id`] === ({ agentId, runId })[`${dimension}Id`]);
        for (const unit of RESOURCE_UNITS) {
          const used = entries.reduce((sum, entry) => sum + (entry.usage ?? entry.bounds)[unit], 0);
          if (used + policy.bounds[unit] > policy[dimension][unit]) fail(`budget_${dimension}_exhausted`);
        }
      }
      const entry = { id: entryId, requestDigest, runId, agentId, operationId, phase, bounds: policy.bounds, state: 'reserved', createdAt: at };
      record.entries.push(entry);
      return { ...clone(entry), recordId: id, replay: false };
    });
  }
  async function settle(reservation, principalId, usage) {
    const normalized = usage === null ? null : normalizeResources(usage);
    return mutate(reservation.recordId, principalId, null, record => {
      const entry = record.entries.find(e => e.id === reservation.id);
      if (!entry || entry.requestDigest !== reservation.requestDigest) fail('reservation_missing');
      if (entry.state === 'settled' || entry.state === 'overrun') {
        if (digestToolkitEvidence(entry.usage) !== digestToolkitEvidence(normalized)) fail('settlement_reused');
        return clone(entry);
      }
      entry.state = normalized === null ? 'unknown' : RESOURCE_UNITS.some(k => normalized[k] > entry.bounds[k]) ? 'overrun' : 'settled';
      if (normalized !== null) entry.usage = normalized;
      return clone(entry);
    });
  }
  async function inspect(context, principalId) {
    context = normalizeRunContext(context);
    const record = await store.get(identity(principalId, context.projectId));
    if (!record || record.ownerPrincipalId !== principalId) fail('allocation_missing');
    const used = zero(), reserved = zero();
    for (const entry of record.entries) for (const unit of RESOURCE_UNITS) {
      if (entry.usage) used[unit] += entry.usage[unit]; else reserved[unit] += entry.bounds[unit];
    }
    return { projectId: record.projectId, policy: record.policy, used, reserved,
      remaining: Object.fromEntries(RESOURCE_UNITS.map(k => [k, Math.max(0, record.policy.project[k] - used[k] - reserved[k])])),
      status: record.entries.some(e => e.state === 'unknown' || e.state === 'overrun') ? 'held' : 'known',
      machineCost: 'unknown', observedAt: now(), entries: record.entries.length };
  }
  return Object.freeze({ resolve, reserve, settle, inspect,
    async reconcile(reservation, principalId) {
      if (typeof reconcile !== 'function') fail('reconciliation_unavailable');
      const proof = await reconcile(clone(reservation), { principalId });
      if (!proof || proof.reservationId !== reservation.id || proof.quiescent !== true) fail('reconciliation_unverified');
      return settle(reservation, principalId, proof.usage);
    } });
}
