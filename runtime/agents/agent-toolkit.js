import { randomUUID } from "node:crypto";
import {
  AgentToolkitBlock,
  assertIdentifier,
  normalizeAccessContext,
  normalizeAuthorization,
  normalizeCompareRequest,
  normalizeCompleteRequest,
  normalizeEvaluateRequest,
  normalizeEvaluationOutcome,
  normalizeInstrumentOutcome,
  normalizeProposalRequest,
  normalizeReasonCode,
  normalizeSpanFinishRequest,
  normalizeSpanStartRequest,
  normalizeStartRequest,
  normalizeTraceQuery,
} from "./agent-toolkit-contract.js";
import {
  appendToolkitProposal,
  appendToolkitSample,
  assertToolkitCohort,
  assertToolkitOwner,
  cohortRecordId,
  commitToolkitEvaluation,
  compareToolkitCohort,
  completeToolkitRun,
  createToolkitCohort,
  createToolkitRun,
  failToolkitEvaluation,
  finishToolkitSpan,
  projectToolkitRun,
  reserveToolkitEvaluation,
  runRecordId,
  startToolkitSpan, toolkitSubjectDigest,
} from "./agent-toolkit-ledger.js";
import { createAgentToolkitAdmissionController, mutateToolkitRecord } from "./agent-toolkit-admission.js";
import { normalizeAgentToolkitLimits } from "./agent-toolkit-limits.js";
import { createAgentToolkitObservability } from "./agent-toolkit-observability.js";
import {
  normalizeOptimizationRequest,
  optimizeToolkitCohort,
} from "./agent-toolkit-optimizer.js";
import { profileToolkitRun, createToolkitQueries } from "./agent-toolkit-profiler.js";
import { createAgentToolkitMemoryStore } from "./agent-toolkit-store.js";
import { normalizeJson } from "../json-contract.mjs";
import { RunningAgentBlock, withDeadline } from "./running-agent-contract.js";

function blocked(reasonCode, status = "blocked") {
  return Object.freeze({ status, reasonCode });
}

async function guarded(operation, fallback) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
    if (fallback) return blocked(fallback);
    throw error;
  }
}

function publicRequest(request) {
  const result = { ...request };
  delete result.signal;
  return result;
}

function safeReason(error, fallback, extras = []) {
  if (!(error instanceof RunningAgentBlock) && !(error instanceof AgentToolkitBlock)) return fallback;
  if (extras.includes(error.reasonCode)) return error.reasonCode;
  try {
    return normalizeReasonCode(error.reasonCode);
  } catch {
    return fallback;
  }
}

function trustedContext(access) {
  const context = normalizeAccessContext(access);
  return Object.freeze({ ...context, telemetryTrust: "server-observed" });
}

export function createAgentToolkitRuntime({
  stateStore,
  authorize,
  evaluate: evaluateAdapter,
  telemetry,
  now = () => Date.now(),
  clockOrigin = randomUUID(),
  resources,
  ...overrides
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  const limits = { ...normalizeAgentToolkitLimits(overrides), clockOrigin: assertIdentifier(clockOrigin, "clockOrigin") };
  const store = stateStore || createAgentToolkitMemoryStore({ now });
  const admission = createAgentToolkitAdmissionController({ stateStore: store, now, limits });
  const observability = createAgentToolkitObservability({ exporter: telemetry, now });
  const configured = typeof authorize === "function";
  const evaluatorConfigured = typeof evaluateAdapter === "function";

  function instant() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  const claimRecord = (id, transform) => mutateToolkitRecord({ store, id, now: instant, limits, transform });

  function assertCurrent(context) {
    if (context.principalExpiresAt !== undefined && context.principalExpiresAt <= instant())
      throw new AgentToolkitBlock('principal_expired', 'Current principal required.');
  }

  async function authorizeAction(action, request, context) {
    assertCurrent(context);
    if (!configured) throw new AgentToolkitBlock("runtime_unconfigured", "Agent Toolkit authorizer is not configured.");
    const verdict = await authorize({
      action,
      principalId: context.principalId,
      request: publicRequest(request),
    });
    assertCurrent(context);
    return normalizeAuthorization(verdict);
  }

  const queries = createToolkitQueries({ store, admission, now: instant, limits, authorize: authorizeAction, resources });
  const query = (value, access) => guarded(() => queries.query(value, access));
  const trace = (value, access) => guarded(() => queries.trace(value, access));

  async function ensureCohort(request, context, at) {
    const recordId = cohortRecordId(context.principalId, request.cohortId);
    let cohort = await store.get(recordId);
    if (!cohort) {
      await store.put(createToolkitCohort({ request, principalId: context.principalId, limits, at }));
      cohort = await store.get(recordId);
    }
    if (!cohort) throw new AgentToolkitBlock("cohort_unavailable", "Agent Toolkit cohort could not be reserved.");
    assertToolkitCohort(cohort, request, context.principalId);
    return cohort;
  }

  async function mutateRun(runId, context, transform) {
    const result = await claimRecord(runRecordId(context.principalId, runId), async (record, at) => {
      assertToolkitOwner(record, context.principalId);
      const replacement = await transform(record, at);
      return { record: replacement, value: projectToolkitRun(replacement) };
    });
    if (result.missing) throw new AgentToolkitBlock("run_not_found", "Agent Toolkit run was not found.");
    return result.value;
  }

  async function syncSample(run, context) {
    if (!run.completion) return;
    const result = await claimRecord(cohortRecordId(context.principalId, run.cohortId), async (cohort, at) => {
      assertToolkitOwner(cohort, context.principalId);
      assertToolkitCohort(cohort, run, context.principalId);
      return { record: appendToolkitSample(cohort, run, limits, at) };
    });
    if (result.missing) throw new AgentToolkitBlock("cohort_not_found", "Agent Toolkit cohort was not found.");
    const synchronized = result.record.samples.find((sample) => sample.runId === run.runId);
    if (synchronized?.quality?.status === "invalid"
      && synchronized.quality.reasonCode === "evidence_reused") {
      throw new AgentToolkitBlock("evidence_reused", "Evaluation source evidence was already counted.");
    }
  }

  async function start(request, context) {
    const at = instant();
    if (context.principalExpiresAt !== undefined && context.principalExpiresAt < at + limits.runTtlMs) {
      return blocked("session_too_short");
    }
    let authorization;
    return guarded(async () => {
      authorization = await authorizeAction("observe", request, context);
      if (request.context) {
        if (!resources) throw new AgentToolkitBlock('allocation_unconfigured', 'Context requires trusted resource admission.');
        await resources.resolve(request.context, context.principalId, 'observe');
      }
      await ensureCohort(request, context, at);
      const stored = await store.put(createToolkitRun({
        request,
        authorization,
        principalId: context.principalId,
        telemetryTrust: context.telemetryTrust,
        limits,
        at,
      }));
      if (!stored) return blocked("run_reused");
      return projectToolkitRun(await store.get(runRecordId(context.principalId, request.runId)));
    }, "authorization_failed");
  }

  async function spanTransition(request, context, apply, starting = false) {
    return guarded(async () => {
      const result = await mutateRun(request.runId, context, (record, at) => apply(record, request, limits, at));
      return starting && !result.spans.some(s => s.spanId === request.spanId) ? { ...blocked('span_limit'), traceTruncated: true } : result;
    });
  }
  const startSpan = (request, context) => spanTransition(request, context, startToolkitSpan, true);
  const finishSpan = (request, context) => spanTransition(request, context, finishToolkitSpan);

  async function complete(request, context) {
    return guarded(async () => {
      await mutateRun(request.runId, context, (record, at) => (
        completeToolkitRun(record, request, limits, at)
      ));
      const run = await store.get(runRecordId(context.principalId, request.runId));
      assertToolkitOwner(run, context.principalId);
      await syncSample(run, context);
      return projectToolkitRun(run);
    });
  }

  async function evaluate(request, context) {
    if (!evaluatorConfigured) return blocked("evaluator_unconfigured");
    const initial = await store.get(runRecordId(context.principalId, request.runId));
    if (!initial) return blocked("run_not_found");
    return guarded(async () => {
      assertToolkitOwner(initial, context.principalId);
      await authorizeAction("evaluate", request, context);
      let reservationId;
      const reserved = await claimRecord(
        runRecordId(context.principalId, request.runId),
        (record, at) => {
        assertToolkitOwner(record, context.principalId);
        const reservation = reserveToolkitEvaluation(record, {
          operationId: request.operationId,
          evidence: request.evidence, spanId: request.spanId, subjectDigest: request.subjectDigest,
          limits,
          at,
        });
        reservationId = reservation.reservationId;
        return { record: reservation.record, value: reservation };
        },
      );
      if (reserved.missing) return blocked("run_not_found");
      if (reserved.value.replay) {
        if (!request.spanId) await syncSample(reserved.record, context);
        return projectToolkitRun(reserved.record);
      }

      let outcome, resourceReservation, resourceStartedAt;
      try {
        if (initial.context) {
          if (!resources) throw new AgentToolkitBlock("allocation_unconfigured", "Evaluation requires resource admission.");
          resourceReservation = await resources.reserve({ context: initial.context, principalId: context.principalId,
            runId: initial.runId, agentId: initial.target.id, operationId: reserved.value.idempotencyKey, phase: "evaluate" });
          if (resourceReservation.replay) throw new AgentToolkitBlock("allocation_usage_unknown", "Read prior evaluator usage before retry.");
          resourceStartedAt = instant();
        }
        const expectedMetric = normalizeJson(reserved.record.profile.metric, "expected evaluation metric");
        const evaluatorMetadata = normalizeJson({
          target: reserved.record.target,
          candidate: reserved.record.candidate,
          adapter: reserved.record.adapter,
          profile: reserved.record.profile,
          evidence: request.evidence,
          subject: { runId: initial.runId, principalId: context.principalId, ...(request.spanId ? { spanId: request.spanId } : {}), digest: toolkitSubjectDigest(reserved.record, request.spanId) },
          ...(resourceReservation ? { resourceBounds: resourceReservation.bounds } : {}),
          idempotencyKey: reserved.value.idempotencyKey,
        }, "evaluator input");
        const controller = new AbortController();
        const raw = await withDeadline(
          () => evaluateAdapter(Object.freeze({
            ...evaluatorMetadata,
            signal: controller.signal,
          })),
          request.signal,
          Math.min(limits.operationTimeoutMs, resourceReservation?.bounds.elapsedMs ?? limits.operationTimeoutMs),
          controller,
        );
        outcome = normalizeEvaluationOutcome(raw, expectedMetric);
        if (resourceReservation) {
          if (outcome.costLog?.estimated_cost_usd > 0) throw new AgentToolkitBlock('paid_execution_forbidden', 'Free execution required.');
          const settled = await resources.settle(resourceReservation, context.principalId, outcome.costLog ? {
            inputTokens: outcome.costLog.prompt_tokens, outputTokens: outcome.costLog.completion_tokens, attempts: 1, elapsedMs: instant() - resourceStartedAt } : null);
          if (settled.state !== 'settled') throw new AgentToolkitBlock('allocation_usage_unknown', 'Reconcile evaluator usage.');
        }
      } catch (error) {
        if (resourceReservation && !resourceReservation.replay) await resources.settle(resourceReservation, context.principalId, null).catch(() => {});
        const reasonCode = safeReason(error, "evaluation_failed", ["evaluation_metric_mismatch", "allocation_unconfigured", "allocation_usage_unknown", "budget_project_exhausted", "budget_agent_exhausted", "budget_run_exhausted"]);
        await mutateRun(request.runId, context, (record, at) => (
          failToolkitEvaluation(record, reservationId, reasonCode, limits, at)
        ));
        const failed = await store.get(runRecordId(context.principalId, request.runId));
        if (!request.spanId) await syncSample(failed, context);
        return blocked(reasonCode);
      }

      const committed = await mutateRun(
        request.runId,
        context,
        (record, at) => commitToolkitEvaluation(record, reservationId, outcome, limits, at),
      );
      const run = await store.get(runRecordId(context.principalId, request.runId));
      if (!request.spanId) await syncSample(run, context);
      return committed;
    }, "evaluation_failed");
  }

  async function readOwned(id, context, project, request) {
    const record = await store.get(id);
    if (!record) return blocked(id.startsWith('cohort:') ? 'cohort_not_found' : 'run_not_found');
    return guarded(async () => {
      assertToolkitOwner(record, context.principalId);
      await authorizeAction('observe', request, context);
      return project(record);
    });
  }
  const readRun = (runId, context, project) => readOwned(runRecordId(context.principalId, runId), context, project, { runId });
  const status = (runId, access = {}) => readRun(runId, access, projectToolkitRun);
  const compare = (request, context) => readOwned(cohortRecordId(context.principalId, request.cohortId), context, r => compareToolkitCohort(r, request), request);

  async function propose(request, context) {
    const initial = await store.get(cohortRecordId(context.principalId, request.cohortId));
    if (!initial) return blocked("cohort_not_found");
    return guarded(async () => {
      assertToolkitOwner(initial, context.principalId);
      await authorizeAction("propose", request, context);
      const result = await claimRecord(
        cohortRecordId(context.principalId, request.cohortId),
        (cohort, at) => {
          assertToolkitOwner(cohort, context.principalId);
          const comparison = compareToolkitCohort(cohort, request);
          const appended = appendToolkitProposal(cohort, request, comparison, limits, at);
          return { record: appended.cohort, value: appended.proposal };
        },
      );
      if (result.missing) return blocked("cohort_not_found");
      return result.value;
    }, "proposal_failed");
  }

  const profile = (runId, access = {}) => readRun(runId, access, profileToolkitRun);

  async function optimize(request, context) {
    const cohort = await store.get(cohortRecordId(context.principalId, request.cohortId));
    if (!cohort) return blocked("cohort_not_found");
    return guarded(async () => {
      assertToolkitOwner(cohort, context.principalId);
      await authorizeAction("optimize", request, context);
      return optimizeToolkitCohort(cohort, request);
    }, "optimization_failed");
  }

  async function instrument(value, operation, access = {}) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function.');
    const request = normalizeStartRequest(value), context = trustedContext(access);
    // Plan-bound effects use the budgeted execution bridge, never this legacy convenience adapter.
    if (request.context) return blocked('budgeted_executor_required');
    const transition = async reasonCode => {
      const observation = await status(request.runId, context);
      return Object.freeze({ status: ['completed', 'failed', 'canceled'].includes(observation.status) ? observation.status : 'blocked',
        reasonCode: observation.completion?.reasonCode ?? reasonCode, observation });
    };
    const started = await start(request, context);
    if (started.status !== 'running') return started;
    const span = { runId: request.runId, spanId: 'root' };
    const spanStarted = await startSpan(normalizeSpanStartRequest({ ...span, kind: request.target.kind, operation: request.operation,
      component: { id: request.target.id, revision: request.target.revision, digest: request.target.digest } }), context);
    if (spanStarted.status === 'blocked') return transition(spanStarted.reasonCode);
    const finish = async (state, outcome = {}) => {
      const spanFinished = await finishSpan(normalizeSpanFinishRequest({ ...span, status: state, ...(outcome.reasonCode ? { reasonCode: outcome.reasonCode } : {}) }), context);
      if (spanFinished.status === 'blocked') return transition(spanFinished.reasonCode);
      const result = await complete(normalizeCompleteRequest({ runId: request.runId, operationId: 'instrument-complete', status: state,
        ...(outcome.costLog ? { costLog: outcome.costLog } : {}), ...(outcome.reasonCode ? { reasonCode: outcome.reasonCode } : {}) }), context);
      if (result.status === 'blocked' || result.completion?.operationId !== 'instrument-complete' || result.completion?.status !== state)
        return transition(result.reasonCode || 'run_terminal');
      return { status: result.status, observation: result };
    };
    try {
      const controller = new AbortController();
      const outcome = normalizeInstrumentOutcome(await withDeadline(() => operation({ signal: controller.signal,
        target: request.target, candidate: request.candidate, adapter: request.adapter }), request.signal, limits.operationTimeoutMs, controller));
      const result = await finish('completed', outcome);
      if (result.status !== 'completed' || result.observation.completion?.operationId !== 'instrument-complete') return result;
      if (outcome.evidence && evaluatorConfigured) await evaluate(normalizeEvaluateRequest({ runId: request.runId, operationId: 'instrument-evaluate',
        evidence: outcome.evidence, signal: request.signal }), context);
      const observation = await status(request.runId, context);
      return Object.freeze({ status: observation.status, value: outcome.value, observation });
    } catch (error) {
      const reasonCode = safeReason(error, 'adapter_failed');
      return Object.freeze({ ...await finish('failed', { reasonCode }), reasonCode });
    }
  }

  async function executeObserved(action, identity, context, operation) {
    const startedAt = instant();
    if (context.principalExpiresAt !== undefined && context.principalExpiresAt <= startedAt) return blocked("principal_expired");
    let verdict;
    try {
      verdict = await admission.admit({ action, principalId: context.principalId, ...identity });
    } catch {
      verdict = Object.freeze({ allowed: false, reasonCode: "admission_failed" });
    }
    const result = verdict.allowed
      ? await operation()
      : Object.freeze({
        status: "blocked",
        reasonCode: verdict.reasonCode,
        ...(verdict.retryAfterMs ? { retryAfterMs: verdict.retryAfterMs } : {}),
      });
    await observability.emit({ action, context, identity, result, startedAt });
    return result;
  }

  const observed = (action, normalize, identity, operation) => async (value, access = {}) => {
    const request = normalize(value), context = normalizeAccessContext(access);
    return executeObserved(action, identity(request), context, () => operation(request, context));
  };
  const runIdentity = request => ({ runId: request.runId });
  const cohortIdentity = request => ({ cohortId: request.cohortId });
  const comparison = value => normalizeCompareRequest(value, limits.comparison);
  return Object.freeze({
    start: observed('start', normalizeStartRequest, r => ({ runId: r.runId, cohortId: r.cohortId }), start),
    startSpan: observed('start-span', normalizeSpanStartRequest, runIdentity, startSpan),
    finishSpan: observed('finish-span', normalizeSpanFinishRequest, runIdentity, finishSpan),
    complete: observed('complete', normalizeCompleteRequest, runIdentity, complete),
    evaluate: observed('evaluate', normalizeEvaluateRequest, runIdentity, evaluate),
    query: observed('query', normalizeTraceQuery, () => ({}), query),
    trace: observed('trace', v => normalizeTraceQuery(v, true), runIdentity, trace),
    status: observed('status', v => assertIdentifier(v, 'runId'), runId => ({ runId }), status),
    compare: observed('compare', comparison, cohortIdentity, compare),
    propose: observed('propose', v => normalizeProposalRequest(v, limits.comparison), cohortIdentity, propose),
    profile: observed('profile', v => assertIdentifier(v, 'runId'), runId => ({ runId }), profile),
    optimize: observed('optimize', v => normalizeOptimizationRequest(v, limits), cohortIdentity, optimize),
    instrument: async (value, operation, access = {}) => {
      const request = normalizeStartRequest(value);
      return executeObserved('instrument', { runId: request.runId, cohortId: request.cohortId }, normalizeAccessContext(access), () => instrument(value, operation, access));
    },
    stats: () => Object.freeze({
      configured,
      evaluatorConfigured,
      instrumentation: "server-timed-metadata-only",
      comparison: "same-cohort-deterministic-thresholds-with-percentile-profile",
      optimization: "deterministic-quality-latency-cost-recommendation",
      learning: "review-pending-proposal-only-never-auto-apply",
      defaultEgress: false,
      externalRuntimeDependency: false,
      runTtlMs: limits.runTtlMs,
      cohortTtlMs: limits.cohortTtlMs,
      admission: admission.stats(),
      observability: observability.stats(),
      stateStore: store.stats(),
    }),
  });
}

export { createAgentToolkitMemoryStore } from "./agent-toolkit-store.js";
