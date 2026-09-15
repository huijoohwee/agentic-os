import { createHash } from "node:crypto";

import {
  AGENT_SWARM_DEFAULTS,
  AGENT_SWARM_RUN_SCHEMA,
  AgentSwarmBlock,
  AgentSwarmFailure,
  assertExactKeys,
  assertIdentifier,
  assertPositiveInteger,
  normalizeAccessContext,
  normalizeAgentResolution,
  normalizeAuthorization,
  normalizePlanOutcome,
  normalizeReceiptVerification,
  normalizeRunOperation,
  normalizeStartRequest,
  normalizeSynthesisOutcome,
  normalizeWorkerOutcome,
  normalizeWorkRequest,
} from "./agent-swarm-contract.js";
import {
  blockSwarmLedger,
  blockedSwarmResult,
  cancelSwarmLedger,
  claimSwarmSynthesis,
  claimSwarmTask,
  completeSwarmSynthesis,
  completeSwarmTask,
  createSwarmLedger,
  failSwarmSynthesis,
  failSwarmTask,
  projectSwarmLedger,
  recoverSwarmLedger,
  requireLedger,
  requireLedgerOwner,
} from "./agent-swarm-ledger.js";
import { createAgentSwarmMemoryStore } from "./agent-swarm-store.js";
import { createSwarmCoordinator, digest, requestDigest } from "./agent-swarm-coordinator.js";
import { createSwarmReconciler } from "./agent-swarm-reconcile.js";
import { classifyTaskFailure } from "./agent-swarm-recovery.js";
import { withDeadline } from "./running-agent-contract.js";

function assertAdapter(value, field) {
  if (value !== undefined && typeof value !== "function") throw new TypeError(`${field} must be a function when provided.`);
}

function assertStore(value) {
  if (!value || typeof value !== "object") throw new TypeError("stateStore must be an object.");
  for (const method of ["put", "get", "claim", "replace", "release", "commit", "delete", "stats"]) {
    if (typeof value[method] !== "function") throw new TypeError(`stateStore.${method} must be a function.`);
  }
  return value;
}

function errorReason(error, fallback) {
  if (error instanceof AgentSwarmBlock || error instanceof AgentSwarmFailure) return error.reasonCode;
  if (error?.reasonCode === "timeout") return `${fallback}_timeout`;
  if (error?.reasonCode === "aborted") return `${fallback}_aborted`;
  return fallback;
}

function freezeCall(value) {
  return Object.freeze(value);
}

function taskConversationId(runId, taskId) {
  return `swarm-${createHash("sha256").update(`${runId}\u0000${taskId}`).digest("hex").slice(0, 32)}`;
}

export function createAgentSwarmRuntime({
  resolveAgent,
  planTasks,
  executeTask,
  synthesize,
  verifyReceipt,
  reconcileTask,
  authorize,
  taskEffect = "unknown",
  planningEffect = "unknown",
  stateStore = createAgentSwarmMemoryStore(),
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ...limitOverrides
} = {}) {
  for (const [field, value] of Object.entries({ resolveAgent, planTasks, executeTask, synthesize, verifyReceipt, reconcileTask, authorize })) {
    assertAdapter(value, field);
  }
  if (!["unknown", "read-only"].includes(taskEffect)) throw new TypeError("taskEffect must be unknown or read-only.");
  if (!["unknown", "read-only"].includes(planningEffect)) throw new TypeError("planningEffect must be unknown or read-only.");
  const store = assertStore(stateStore);
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  if (typeof wait !== "function") throw new TypeError("wait must be a function.");
  const limits = { ...AGENT_SWARM_DEFAULTS, ...limitOverrides };
  for (const [field, value] of Object.entries(limits)) assertPositiveInteger(value, field);
  if (limits.taskLeaseMs <= limits.taskTimeoutMs + limits.storeClaimTtlMs) {
    throw new TypeError("taskLeaseMs must exceed taskTimeoutMs plus storeClaimTtlMs.");
  }
  if (limits.runTtlMs <= limits.taskLeaseMs) {
    throw new TypeError("runTtlMs must exceed taskLeaseMs.");
  }
  if (limits.retryBaseMs > limits.retryMaxMs || limits.runTtlMs > 7 * 24 * 60 * 60_000
    || limits.retentionMs > 30 * 24 * 60 * 60_000) throw new TypeError("Retry, execution or retention bound is invalid.");
  const configured = Boolean(resolveAgent && planTasks && executeTask && synthesize && verifyReceipt && authorize);
  const activeExecutions = new Map();
  let starts = 0;
  let workerDispatches = 0;
  let synthesisDispatches = 0;
  let completedRuns = 0;
  let blockedRuns = 0;
  let canceledRuns = 0;

  function instant() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  function stateStats() {
    return store.stats();
  }

  async function bounded(operation, signal) {
    const controller = new AbortController();
    return withDeadline(() => operation(controller.signal), signal, limits.taskTimeoutMs, controller);
  }

  const policyDigest = digest({ limits, taskEffect, planningEffect });
  const { withLedger, reserveStart, commitStart, discardStart, replayStart, cancelPlanning, project } =
    createSwarmCoordinator({ store, limits, instant, wait, policyDigest, planningEffect });

  function currentSession(context, at = instant()) {
    if (context.principalExpiresAt !== undefined && context.principalExpiresAt <= at)
      throw new AgentSwarmBlock("principal_expired", "Authenticate again before resuming the run.");
  }

  async function authorizeOperation(action, request, context, snapshot) {
    currentSession(context);
    const record = requireLedgerOwner(requireLedger(snapshot ?? await store.get(request.runId), request.runId,
      { readOnly: action === 'migrate' }), context.principalId);
    const grant = normalizeAuthorization(await bounded(signal => authorize(freezeCall({
      action: `agent.swarm.${action}`, runId: request.runId, principalId: context.principalId,
      conversationId: record.conversationId, agent: record.agent, requestDigest: record.requestDigest,
      policyDigest, sourceDigest: action === 'migrate' ? digest(record) : null,
      taskId: request.taskId ?? null, signal,
    })), request.signal));
    if (!action.endsWith('.commit')) normalizeAgentResolution(await bounded(signal =>
      resolveAgent(freezeCall({ agent: record.agent, signal })), request.signal), record.agent);
    currentSession(context);
    return grant;
  }
  const retry = createSwarmReconciler({ withLedger, authorizeOperation, reconcileTask, verifyReceipt,
    bounded, limits, instant, stateStats });

  // Explicit administration seam; not exposed as a general model/browser tool.
  async function migrate(value, contextValue = {}) {
    assertExactKeys(value, ['runId', 'operationId', 'expectedDigest'], 'migration');
    const request = normalizeRunOperation({ runId: value.runId, operationId: value.operationId });
    if (!/^[a-f0-9]{64}$/.test(value.expectedDigest)) throw new TypeError('Expected legacy digest is required.');
    if (taskEffect !== 'unknown') throw new AgentSwarmBlock('migration_effect_policy', 'Legacy effects cannot acquire a new read-only assertion.');
    const context = normalizeAccessContext(contextValue);
    await authorizeOperation('migrate', request, context);
    return withLedger(request.runId, request.operationId, context.principalId, (ledger, at) => {
      const original = normalizeStartRequest({ runId: ledger.runId, conversationId: ledger.conversationId,
        agent: ledger.agent, goal: ledger.goal, input: ledger.input, maxParallel: ledger.maxParallel }, limits);
      if (ledger.deadlineAt <= at) throw new AgentSwarmBlock('migration_deadline', 'Legacy execution deadline elapsed.');
      ledger.schema = AGENT_SWARM_RUN_SCHEMA;
      ledger.requestDigest = requestDigest(original); ledger.policyDigest = policyDigest;
      ledger.expiresAt = ledger.deadlineAt + limits.retentionMs;
      ledger.migration = { sourceSchema: 'agent-swarm-run/v1', sourceDigest: value.expectedDigest, at };
      for (const task of ledger.tasks) {
        task.effectPolicy = 'unknown'; task.nextEligibleAt = at;
        task.effectState = task.status === 'completed' ? (task.effect === 'read-only' ? 'absent' : 'confirmed')
          : ['pending', 'skipped'].includes(task.status) ? 'absent' : 'unknown';
        if (task.status === 'running') task.leaseExpiresAt = at;
        if (ledger.status === 'running' && task.status === 'failed') task.status = 'reconciling';
      }
      if (ledger.synthesis.status === 'running') ledger.synthesis.leaseExpiresAt = at;
      recoverSwarmLedger(ledger, limits, at);
      return projectSwarmLedger(ledger, stateStats());
    }, value.expectedDigest);
  }

  async function start(value = {}, contextValue = {}) {
    const request = normalizeStartRequest(value, limits);
    const context = normalizeAccessContext(contextValue);
    const admittedAt = instant();
    starts += 1;
    if (!configured) {
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, "runtime_unconfigured", "Agent resolver, planner, worker, synthesizer, receipt verifier, and authorizer are required.");
    }
    if (context.principalExpiresAt !== undefined
      && context.principalExpiresAt <= admittedAt + limits.taskTimeoutMs) {
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, "session_too_short", "The authenticated principal cannot cover initial admission; authenticate again.");
    }
    let authorization;
    try {
      authorization = normalizeAuthorization(await bounded((signal) => authorize(freezeCall({
        action: "agent.swarm.start",
        runId: request.runId,
        principalId: context.principalId,
        conversationId: request.conversationId,
        agent: request.agent,
        goal: request.goal,
        input: request.input,
        bounds: freezeCall({ maxTasks: limits.maxTasks, maxParallel: request.maxParallel, maxAttempts: limits.maxAttempts }),
        signal,
      })), request.signal));
    } catch (error) {
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, errorReason(error, "authorization_failed"), "Agent Swarm authorization failed.");
    }
    try {
      normalizeAgentResolution(await bounded((signal) => resolveAgent(freezeCall({ agent: request.agent, signal })), request.signal), request.agent);
    } catch (error) {
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, errorReason(error, "agent_resolution_failed"), "Base-agent verification failed.");
    }
    let reservation;
    try {
      currentSession(context, instant() + limits.taskTimeoutMs);
      reservation = await reserveStart(request, context.principalId);
      if (!reservation) {
        return await replayStart(request, context.principalId);
      }
    } catch (error) {
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, errorReason(error, "state_store_failed"), "Agent Swarm run reservation failed.");
    }
    const { reservationId } = reservation;
    let plan;
    try {
      plan = normalizePlanOutcome(await bounded((signal) => planTasks(freezeCall({
        runId: request.runId,
        conversationId: request.conversationId,
        agent: request.agent,
        goal: request.goal,
        input: request.input,
        bounds: freezeCall({
          maxTasks: limits.maxTasks,
          maxParallel: request.maxParallel,
          maxWaves: limits.maxWaves,
          maxAttempts: limits.maxAttempts,
        }),
        signal,
      })), request.signal), limits);
    } catch (error) {
      await discardStart(request.runId, reservationId).catch(() => false);
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, errorReason(error, "planning_failed"), "Dynamic task planning failed.", [], 1);
    }
    let ledger;
    try {
      ledger = createSwarmLedger({
        request,
        plan,
        authorization,
        policyDigest,
        requestDigest: requestDigest(request),
        taskEffect,
        principalId: context.principalId,
        limits,
        admittedAt: Date.parse(reservation.createdAt),
        at: instant(),
      });
    } catch (error) {
      await discardStart(request.runId, reservationId).catch(() => false);
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, errorReason(error, "ledger_invalid"), "Dynamic task ledger creation failed.", [plan.costLog], 1);
    }
    try {
      currentSession(context);
      normalizeAuthorization(await bounded(signal => authorize(freezeCall({ action: 'agent.swarm.start.commit',
        runId: request.runId, principalId: context.principalId, agent: request.agent,
        requestDigest: requestDigest(request), policyDigest, signal })), request.signal));
      currentSession(context);
      if (!await commitStart(request.runId, reservationId, ledger)) throw new AgentSwarmBlock("ledger_conflict", "Agent Swarm run reservation changed before commit.");
    } catch (error) {
      blockedRuns += 1;
      return blockedSwarmResult(request.runId, errorReason(error, "state_store_failed"), "Dynamic task ledger commit failed.", [plan.costLog], 1);
    }
    return projectSwarmLedger(ledger, stateStats());
  }

  async function status(runIdValue, contextValue = {}) {
    const runId = assertIdentifier(runIdValue, "runId");
    const context = normalizeAccessContext(contextValue);
    const ledger = await store.get(runId);
    if (!ledger) return blockedSwarmResult(runId, "run_missing", "Agent Swarm run is unavailable.");
    try {
      currentSession(context);
      return project(ledger, context.principalId);
    } catch (error) {
      return blockedSwarmResult(runId, errorReason(error, "ledger_invalid"), "Agent Swarm ledger is invalid.");
    }
  }

  async function work(value = {}, contextValue = {}) {
    const request = normalizeWorkRequest(value);
    const context = normalizeAccessContext(contextValue);
    workerDispatches += 1;
    if (!configured) return blockedSwarmResult(request.runId, "runtime_unconfigured", "Agent Swarm runtime is unconfigured.");
    let claim;
    try {
      await authorizeOperation("work", request, context);
      claim = await withLedger(request.runId, `${request.operationId}:claim`, context.principalId, (ledger, at) => {
        currentSession(context, at + limits.taskTimeoutMs + limits.storeClaimTtlMs);
        const taskClaim = claimSwarmTask(ledger, { workerId: request.workerId, limits, at, principalExpiresAt: context.principalExpiresAt });
        return {
          taskClaim,
          snapshot: taskClaim ? null : projectSwarmLedger(ledger, stateStats()),
        };
      });
    } catch (error) {
      return blockedSwarmResult(request.runId, errorReason(error, "task_claim_failed"), "A dynamic task could not be claimed.");
    }
    if (!claim.taskClaim) {
      const { snapshot } = claim;
      if (["completed", "blocked", "canceled"].includes(snapshot.status)) return snapshot;
      return Object.freeze({
        status: "idle",
        stage: "agent-swarm-worker",
        runId: request.runId,
        workerId: request.workerId,
        runStatus: snapshot.status,
        nextEligibleAt: snapshot.nextEligibleAt,
      });
    }
    const { task, execution } = claim.taskClaim;
    const controller = new AbortController();
    let executionStarted = false;
    activeExecutions.set(task.executionId, { runId: request.runId, controller, kind: "task" });
    try {
      const launchAt = instant();
      if (launchAt + limits.taskTimeoutMs + limits.storeClaimTtlMs >= task.leaseExpiresAt
        || launchAt + limits.taskTimeoutMs + limits.storeClaimTtlMs >= execution.deadlineAt) {
        throw new AgentSwarmBlock("task_launch_deadline", "The task cannot finish inside its lease and run deadline.");
      }
      const outcome = await withDeadline(async () => {
        executionStarted = true;
        const raw = await executeTask(freezeCall({
          runId: task.executionId,
          conversationId: taskConversationId(request.runId, task.taskId),
          agent: execution.agent,
          input: freezeCall({
            kind: "dynamic-swarm-task",
            goal: execution.goal,
            task: freezeCall({ taskId: task.taskId, objective: task.objective, context: task.context, wave: task.wave }),
            dependencies: task.dependencyResults,
            mutationPolicy: "read-only-or-idempotent-with-verified-stable-key-receipt",
          }),
          execution: freezeCall({
            id: task.executionId,
            idempotencyKey: task.idempotencyKey,
            attempt: task.attempt,
            workerId: request.workerId,
          }),
          signal: controller.signal,
        }));
        const normalized = normalizeWorkerOutcome(raw, limits, task.idempotencyKey);
        if (normalized.receipt) {
          normalizeReceiptVerification(await verifyReceipt(freezeCall({
            runId: request.runId,
            taskId: task.taskId,
            executionId: task.executionId,
            receipt: normalized.receipt,
            signal: controller.signal,
          })), normalized.receipt);
        }
        return normalized;
      }, request.signal, limits.taskTimeoutMs, controller);
      await authorizeOperation("work.commit", request, context, execution);
      const resultDigest = await withLedger(request.runId, `${request.operationId}:complete`, context.principalId, (ledger, at) => (
        completeSwarmTask(ledger, task.executionId, outcome, limits, at)
      ));
      if (!resultDigest) {
        return Object.freeze({ status: "stale", stage: "agent-swarm-worker", runId: request.runId, taskId: task.taskId });
      }
      return Object.freeze({
        status: "completed",
        stage: "agent-swarm-worker",
        runId: request.runId,
        taskId: task.taskId,
        workerId: request.workerId,
        executionId: task.executionId,
        resultDigest,
      });
    } catch (error) {
      const reasonCode = errorReason(error, "worker_failed");
      let failure;
      try {
        failure = await withLedger(request.runId, `${request.operationId}:fail`, context.principalId, (ledger, at) => (
          failSwarmTask(ledger, task.executionId, reasonCode, limits, at, classifyTaskFailure(error, executionStarted, taskEffect))
        ));
      } catch {
        failure = { accepted: false, retryable: false };
      }
      return Object.freeze({
        status: failure.accepted ? (failure.reconciling ? "reconciling" : failure.retryable ? "retryable" : "failed") : "stale",
        ...(failure.nextEligibleAt ? { nextEligibleAt: failure.nextEligibleAt } : {}),
        stage: "agent-swarm-worker",
        runId: request.runId,
        taskId: task.taskId,
        reasonCode,
      });
    } finally {
      activeExecutions.delete(task.executionId);
    }
  }

  async function settle(value = {}, contextValue = {}) {
    const request = normalizeRunOperation(value, { signal: true });
    const context = normalizeAccessContext(contextValue);
    synthesisDispatches += 1;
    if (!configured) return blockedSwarmResult(request.runId, "runtime_unconfigured", "Agent Swarm runtime is unconfigured.");
    let claim;
    try {
      await authorizeOperation("settle", request, context);
      claim = await withLedger(request.runId, `${request.operationId}:claim`, context.principalId, (ledger, at) => {
        currentSession(context, at + limits.taskTimeoutMs + limits.storeClaimTtlMs);
        const synthesisClaim = claimSwarmSynthesis(ledger, limits, at, context.principalExpiresAt);
        return {
          synthesisClaim,
          snapshot: synthesisClaim.terminal ? projectSwarmLedger(ledger, stateStats()) : null,
        };
      });
    } catch (error) {
      return blockedSwarmResult(request.runId, errorReason(error, "synthesis_claim_failed"), "Synthesis could not be claimed.");
    }
    if (claim.synthesisClaim.terminal) return claim.snapshot;
    if (claim.synthesisClaim.pending) {
      return Object.freeze({ status: "pending", stage: "agent-swarm-synthesis", runId: request.runId });
    }
    claim = claim.synthesisClaim;
    const controller = new AbortController();
    activeExecutions.set(claim.executionId, { runId: request.runId, controller, kind: "synthesis" });
    try {
      const launchAt = instant();
      if (launchAt + limits.taskTimeoutMs + limits.storeClaimTtlMs >= claim.leaseExpiresAt
        || launchAt + limits.taskTimeoutMs + limits.storeClaimTtlMs >= claim.deadlineAt) {
        throw new AgentSwarmBlock("synthesis_launch_deadline", "Synthesis cannot finish inside its lease and run deadline.");
      }
      const raw = await withDeadline(() => synthesize(freezeCall({
        ...claim.payload,
        signal: controller.signal,
      })), request.signal, limits.taskTimeoutMs, controller);
      const outcome = normalizeSynthesisOutcome(raw, limits);
      await authorizeOperation("settle.commit", request, context, claim.authorizationContext);
      const completed = await withLedger(request.runId, `${request.operationId}:complete`, context.principalId, (ledger, at) => (
        completeSwarmSynthesis(ledger, claim.executionId, outcome, limits, at)
          ? projectSwarmLedger(ledger, stateStats())
          : null
      ));
      if (!completed) return blockedSwarmResult(request.runId, "synthesis_stale", "Synthesis ownership changed before completion.");
      completedRuns += 1;
      return completed;
    } catch (error) {
      const reasonCode = errorReason(error, "synthesis_failed");
      const failed = await withLedger(request.runId, `${request.operationId}:fail`, context.principalId, (ledger, at) => {
        failSwarmSynthesis(ledger, claim.executionId, reasonCode, limits, at, classifyTaskFailure(error, true, "read-only").kind);
        return projectSwarmLedger(ledger, stateStats());
      }).catch(() => null);
      return failed || blockedSwarmResult(request.runId, "synthesis_settlement_failed", "Synthesis failure could not be settled durably.");
    } finally {
      activeExecutions.delete(claim.executionId);
    }
  }

  async function cancel(value = {}, contextValue = {}) {
    const request = normalizeRunOperation(value, { reason: true });
    const context = normalizeAccessContext(contextValue);
    try {
      currentSession(context);
      const planning = await cancelPlanning(request, context.principalId, async record => {
        normalizeAuthorization(await bounded(signal => authorize(freezeCall({ action: 'agent.swarm.cancel',
          runId: request.runId, principalId: context.principalId, agent: record.request?.agent,
          requestDigest: record.requestDigest, policyDigest, signal })), request.signal));
        currentSession(context);
      });
      if (planning) return planning;
      await authorizeOperation("cancel", request, context);
      const canceled = await withLedger(request.runId, `${request.operationId}:cancel`, context.principalId, (ledger, at) => (
        projectSwarmLedger(cancelSwarmLedger(ledger, request.reason, limits, at), stateStats())
      ));
      for (const execution of activeExecutions.values()) {
        if (execution.runId === request.runId) execution.controller.abort();
      }
      canceledRuns += 1;
      return canceled;
    } catch (error) {
      return blockedSwarmResult(request.runId, errorReason(error, "cancel_failed"), "Agent Swarm cancellation failed.");
    }
  }

  async function run(value = {}, contextValue = {}) {
    const request = normalizeStartRequest(value, limits);
    const context = normalizeAccessContext(contextValue);
    const started = await start(request, context);
    if (started.status === "blocked") return started;
    const rounds = limits.maxTasks * limits.maxAttempts + limits.maxWaves;
    for (let round = 1; round <= rounds; round += 1) {
      const snapshot = await status(request.runId, context);
      if (["completed", "blocked", "canceled", "planning"].includes(snapshot.status)) return snapshot;
      if (snapshot.nextEligibleAt === null || snapshot.nextEligibleAt > instant()) return snapshot;
      const terminalTasks = snapshot.tasks.every((task) => ["completed", "failed", "skipped", "canceled"].includes(task.status));
      if (terminalTasks) {
        const result = await settle({
          runId: request.runId,
          operationId: `local-settle-${round}`,
          signal: request.signal,
        }, context);
        if (result.status !== "running" && result.status !== "pending" && result.status !== "synthesizing") return result;
        continue;
      }
      await Promise.all(Array.from({ length: request.maxParallel }, (_, index) => work({
        runId: request.runId,
        workerId: `local-worker-${index + 1}`,
        operationId: `local-work-${round}-${index + 1}`,
        signal: request.signal,
      }, context)));
    }
    blockedRuns += 1;
    await withLedger(request.runId, "local-orchestration-bound", context.principalId, (ledger, at) => (
      blockSwarmLedger(ledger, "orchestration_bound", limits, at)
    )).catch(() => false);
    return status(request.runId, context);
  }

  return Object.freeze({
    start,
    work,
    settle,
    status,
    cancel,
    retry,
    migrate,
    run,
    stats: () => Object.freeze({
      configured,
      agentResolverConfigured: Boolean(resolveAgent),
      plannerConfigured: Boolean(planTasks),
      workerConfigured: Boolean(executeTask),
      synthesizerConfigured: Boolean(synthesize),
      receiptVerifierConfigured: Boolean(verifyReceipt),
      authorizerConfigured: Boolean(authorize),
      stateStoreConfigured: Boolean(store),
      stateStore: stateStats(),
      starts,
      workerDispatches,
      synthesisDispatches,
      completedRuns,
      blockedRuns,
      canceledRuns,
      activeExecutions: activeExecutions.size,
      dynamicTaskModel: "goal-to-bounded-dag",
      workerIdentityModel: "ephemeral-per-claim",
      finalAnswerOwner: "base-agent",
      recursiveFanOut: false,
      ...limits,
    }),
  });
}

export { AgentSwarmFailure } from "./agent-swarm-contract.js";
export { createAgentSwarmMemoryStore } from "./agent-swarm-store.js";
