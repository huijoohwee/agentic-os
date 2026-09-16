import { createHash } from "node:crypto";

import {
  AGENT_TOOLKIT_COHORT_SCHEMA,
  AGENT_TOOLKIT_RUN_SCHEMA,
  AgentToolkitBlock,
  assertRecordSize,
} from "./agent-toolkit-contract.js";
import { aggregateCosts } from "./running-agent-contract.js";
import { normalizeJson } from "../json-contract.mjs";

const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));

function iso(at) {
  return new Date(at).toISOString();
}

export function digestToolkitEvidence(value) {
  return createHash("sha256").update(JSON.stringify(normalizeJson(value, "digest evidence"))).digest("hex");
}

function same(left, right) {
  return digestToolkitEvidence(left) === digestToolkitEvidence(right);
}

function touch(record, limits, at) {
  record.updatedAt = iso(at);
  return assertRecordSize(record, limits);
}

function principalScope(principalId) {
  return createHash("sha256").update(principalId).digest("hex");
}

export function runRecordId(principalId, runId) {
  return `run:${principalScope(principalId)}:${runId}`;
}

export function cohortRecordId(principalId, cohortId) {
  return `cohort:${principalScope(principalId)}:${cohortId}`;
}

export function assertToolkitOwner(record, principalId) {
  if (record.ownerPrincipalId !== principalId) {
    throw new AgentToolkitBlock("run_forbidden", "Evidence belongs to another principal.");
  }
}

export function createToolkitRun({ request, authorization, principalId, telemetryTrust, limits, at }) {
  const record = {
    schema: AGENT_TOOLKIT_RUN_SCHEMA,
    recordId: runRecordId(principalId, request.runId),
    ...pick(request, ['runId', 'cohortId', 'target', 'candidate', 'adapter', 'operation', 'profile', 'context']),
    ...(request.context ? { traceRevision: 2 } : {}),
    clockOrigin: limits.clockOrigin ?? 'legacy',
    authorization,
    ownerPrincipalId: principalId,
    telemetryTrust,
    status: "running",
    createdAt: iso(at),
    admittedAt: at,
    updatedAt: iso(at),
    deadlineAt: at + limits.runTtlMs,
    expiresAt: at + limits.runTtlMs,
    spans: [],
    traceTruncated: false,
    completion: null,
    evaluation: { status: "pending", attempts: 0 },
  };
  return assertRecordSize(record, limits);
}

export function startToolkitSpan(record, request, limits, at) {
  if (record.status !== "running") throw new AgentToolkitBlock("run_terminal", "Run is terminal.");
  if (at >= record.deadlineAt) throw new AgentToolkitBlock("run_expired", "Run deadline elapsed.");
  const existing = record.spans.find((span) => span.spanId === request.spanId);
  if (existing) {
    const identity = { runId: record.runId, ...pick(existing, ['spanId', 'parentSpanId', 'kind', 'operation', 'component', 'taskId', 'attempt', 'links']) };
    if (!same(identity, request)) throw new AgentToolkitBlock("span_reused", "Span identity was reused with different metadata.");
    return touch(record, limits, at);
  }
  if (record.spans.length >= limits.maxSpans) {
    record.traceTruncated = true; record.droppedSpans = (record.droppedSpans ?? 0) + 1;
    return touch(record, limits, at);
  }
  if (request.parentSpanId !== undefined) {
    const parent = record.spans.find((span) => span.spanId === request.parentSpanId);
    if (!parent || parent.status !== "running") {
      throw new AgentToolkitBlock("span_parent_invalid", "Parent span must exist and remain open.");
    }
  }
  if (request.links?.some(link => !record.spans.some(span => span.spanId === link.spanId)))
    throw new AgentToolkitBlock('span_link_invalid', 'Causal link must name an earlier span.');
  record.spans.push({
    ...pick(request, ['spanId', 'parentSpanId', 'kind', 'operation', 'component', 'taskId', 'attempt', 'links']),
    clockOrigin: limits.clockOrigin ?? 'legacy',
    status: "running",
    startedAt: iso(at),
    startedAtMs: at,
  });
  return touch(record, limits, at);
}

export function finishToolkitSpan(record, request, limits, at) {
  const span = record.spans.find((candidate) => candidate.spanId === request.spanId);
  if (!span) throw new AgentToolkitBlock("span_not_found", "Span was not found.");
  if (span.status !== "running") {
    if (span.finishDigest ? span.finishDigest === digestToolkitEvidence(request) : span.status === request.status && span.reasonCode === request.reasonCode) return touch(record, limits, at);
    throw new AgentToolkitBlock("span_terminal", "Span is already terminal.");
  }
  if (record.status !== "running") throw new AgentToolkitBlock("run_terminal", "Run is terminal.");
  if (record.spans.some((candidate) => candidate.parentSpanId === span.spanId && candidate.status === "running")) {
    throw new AgentToolkitBlock("span_children_running", "Finish child spans before their parent.");
  }
  if (request.costLog && record.spans.some(s => s.parentSpanId === span.spanId)) throw new AgentToolkitBlock('aggregate_usage_forbidden', 'Parent usage is derived.');
  if (request.effectId && record.spans.some(s => s !== span && s.effectId === request.effectId)) throw new AgentToolkitBlock('effect_usage_reused', 'Effect usage was already attributed.');
  span.status = request.status;
  span.finishDigest = digestToolkitEvidence(request);
  if (request.effectId) { span.effectId = request.effectId; span.cost = aggregateCosts([request.costLog], 1); }
  span.completedAt = iso(at);
  span.durationMs = span.clockOrigin === (limits.clockOrigin ?? 'legacy') && at >= span.startedAtMs ? at - span.startedAtMs : null;
  delete span.startedAtMs;
  if (request.reasonCode) span.reasonCode = request.reasonCode;
  return touch(record, limits, at);
}

export function completeToolkitRun(record, request, limits, at) {
  if (record.completion) {
    if (record.completion.operationId === request.operationId
      && record.completion.requestDigest === digestToolkitEvidence(request)) return touch(record, limits, at);
    if (record.completion.operationId === request.operationId) {
      throw new AgentToolkitBlock("completion_reused", "Completion operation identity was reused with different evidence.");
    }
    throw new AgentToolkitBlock("run_terminal", "Run is already terminal.");
  }
  for (const span of record.spans) {
    if (span.status !== "running") continue;
    span.status = "canceled";
    span.reasonCode = "run_terminal";
    span.completedAt = iso(at);
    span.durationMs = span.clockOrigin === (limits.clockOrigin ?? "legacy") && at >= span.startedAtMs ? at - span.startedAtMs : null;
    delete span.startedAtMs;
  }
  record.status = request.status;
  record.completion = {
    operationId: request.operationId,
    requestDigest: digestToolkitEvidence(request),
    status: request.status,
    ...(request.reasonCode ? { reasonCode: request.reasonCode } : {}),
    completedAt: iso(at),
    durationMs: record.clockOrigin === (limits.clockOrigin ?? 'legacy') && at >= record.admittedAt ? at - record.admittedAt : null,
    cost: aggregateCosts([request.costLog], 1),
  };
  return touch(record, limits, at);
}

function sameEvaluationRequest(evaluation, operationId, evidence) {
  return evaluation.operationId === operationId && same(evaluation.subjectEvidence, evidence);
}

export function reserveToolkitEvaluation(record, { operationId, evidence, limits, at, spanId, subjectDigest }) {
  if (subjectDigest !== undefined && subjectDigest !== toolkitSubjectDigest(record, spanId)) throw new AgentToolkitBlock('evaluation_subject_changed', 'Evaluation subject changed.');
  if (spanId !== undefined) {
    const span = record.spans.find(s => s.spanId === spanId);
    const view = { ...record, runId: `${record.runId}:${spanId}`, completion: span.status === 'running' ? null : {}, evaluation: span.evaluation ?? { status: 'pending', attempts: 0 } };
    const result = reserveToolkitEvaluation(view, { operationId, evidence, limits, at });
    span.evaluation = view.evaluation;
    return { ...result, record: touch(record, limits, at) };
  }
  if (!record.completion) throw new AgentToolkitBlock("run_not_terminal", "Complete the observed run before evaluation.");
  if (record.evaluation.status === "reported" || record.evaluation.status === "unreported") {
    if (!sameEvaluationRequest(record.evaluation, operationId, evidence)) {
      throw new AgentToolkitBlock("evaluation_reused", "Evaluation operation identity or source evidence changed.");
    }
    return { record: touch(record, limits, at), replay: true, reservationId: null };
  }
  if (["running", "in_doubt"].includes(record.evaluation.status)
    && record.evaluation.leaseExpiresAt > at) {
    throw new AgentToolkitBlock("evaluation_busy", "Evaluation is already running.");
  }
  if (record.evaluation.subjectEvidence
    && !sameEvaluationRequest(record.evaluation, operationId, evidence)) {
    throw new AgentToolkitBlock("evaluation_reused", "Evaluation operation identity or source evidence changed.");
  }
  if (record.expiresAt <= at + limits.evaluationLeaseMs + limits.storeClaimTtlMs) {
    throw new AgentToolkitBlock("run_deadline_capacity", "Run retention cannot cover another evaluation lease.");
  }
  const idempotencyKey = record.evaluation.idempotencyKey
    || `evaluation-${digestToolkitEvidence([
      record.ownerPrincipalId, record.runId, record.profile, evidence,
    ]).slice(0, 48)}`;
  if (record.evaluation.attempts >= limits.maxEvaluationAttempts) {
    record.evaluation = {
      status: "unreported",
      attempts: record.evaluation.attempts,
      operationId,
      subjectEvidence: evidence,
      idempotencyKey,
      reasonCode: "evaluation_attempts_exhausted",
      completedAt: iso(at),
    };
    return { record: touch(record, limits, at), replay: true, reservationId: null };
  }
  const attempt = record.evaluation.attempts + 1;
  const reservationId = `reservation-${digestToolkitEvidence([idempotencyKey, attempt]).slice(0, 48)}`;
  record.evaluation = {
    status: "running",
    attempts: attempt,
    operationId,
    reservationId,
    idempotencyKey,
    subjectEvidence: evidence,
    leaseExpiresAt: at + limits.evaluationLeaseMs,
  };
  return { record: touch(record, limits, at), replay: false, reservationId, idempotencyKey };
}

export function commitToolkitEvaluation(record, reservationId, outcome, limits, at) {
  const span = record.spans.find(s => s.evaluation?.reservationId === reservationId);
  if (span) { const view = { ...record, spans: [], evaluation: span.evaluation };
    commitToolkitEvaluation(view, reservationId, outcome, limits, at); span.evaluation = view.evaluation; return touch(record, limits, at); }
  if (record.evaluation.status !== "running" || record.evaluation.reservationId !== reservationId) {
    throw new AgentToolkitBlock("evaluation_stale", "Evaluation reservation is stale.");
  }
  if (record.evaluation.leaseExpiresAt <= at) {
    throw new AgentToolkitBlock("evaluation_stale", "Evaluation reservation expired.");
  }
  record.evaluation = {
    status: outcome.status,
    attempts: record.evaluation.attempts,
    operationId: record.evaluation.operationId,
    idempotencyKey: record.evaluation.idempotencyKey,
    subjectEvidence: record.evaluation.subjectEvidence,
    metric: outcome.metric,
    ...(outcome.status === "reported" ? { score: outcome.score } : {}),
    evidence: outcome.evidence,
    cost: aggregateCosts([outcome.costLog], 1),
    completedAt: iso(at),
  };
  return touch(record, limits, at);
}

export function failToolkitEvaluation(record, reservationId, reasonCode, limits, at) {
  const span = record.spans.find(s => s.evaluation?.reservationId === reservationId);
  if (span) { const view = { ...record, spans: [], evaluation: span.evaluation };
    failToolkitEvaluation(view, reservationId, reasonCode, limits, at); span.evaluation = view.evaluation; return touch(record, limits, at); }
  if (record.evaluation.status !== "running" || record.evaluation.reservationId !== reservationId) {
    return touch(record, limits, at);
  }
  const uncertain = reasonCode === "timeout" || reasonCode === "aborted";
  const exhausted = !uncertain && record.evaluation.attempts >= limits.maxEvaluationAttempts;
  record.evaluation = {
    status: uncertain ? "in_doubt" : exhausted ? "unreported" : "pending",
    attempts: record.evaluation.attempts,
    operationId: record.evaluation.operationId,
    idempotencyKey: record.evaluation.idempotencyKey,
    subjectEvidence: record.evaluation.subjectEvidence,
    reasonCode,
    ...(uncertain ? {
      reservationId: record.evaluation.reservationId,
      leaseExpiresAt: record.evaluation.leaseExpiresAt,
    } : {}),
    ...(exhausted ? { completedAt: iso(at) } : {}),
  };
  return touch(record, limits, at);
}

export function projectToolkitRun(record) {
  const redact = value => Object.fromEntries(Object.entries(value).filter(([k]) =>
    !['idempotencyKey', 'reservationId', 'leaseExpiresAt', 'requestDigest', 'startedAtMs', 'finishDigest'].includes(k)));
  const completion = record.completion ? redact(record.completion) : null;
  const evaluation = redact(record.evaluation);
  return Object.freeze({
    ...pick(record, ['schema', 'runId', 'cohortId', 'target', 'candidate', 'adapter', 'operation', 'profile', 'context', 'traceRevision',
      'clockOrigin', 'status', 'createdAt', 'updatedAt', 'deadlineAt', 'expiresAt']),
    spans: record.spans.map((span) => {
      const sanitized = redact(span);
      if (span.evaluation) sanitized.evaluation = redact(span.evaluation);
      sanitized.subjectDigest = toolkitSubjectDigest(record, span.spanId);
      return sanitized;
    }),
    subjectDigest: toolkitSubjectDigest(record),
    traceTruncated: record.traceTruncated,
    droppedSpans: record.droppedSpans ?? 0,
    completion,
    telemetryTrust: record.telemetryTrust,
    evaluation: ["running", "in_doubt"].includes(record.evaluation.status)
      ? {
        status: record.evaluation.status,
        attempts: record.evaluation.attempts,
        ...(record.evaluation.reasonCode ? { reasonCode: record.evaluation.reasonCode } : {}),
      }
      : evaluation,
    telemetryPolicy: "metadata-only-no-default-egress",
  });
}

export function toolkitSubjectDigest(record, spanId) {
  if (spanId === undefined && !record.completion) return null;
  const span = spanId === undefined ? record.completion : record.spans.find(s => s.spanId === spanId);
  if (!span) throw new AgentToolkitBlock('span_not_found', 'Span subject is unavailable.');
  const { evaluation, ...subject } = span;
  return digestToolkitEvidence([record.runId, record.candidate, record.profile, record.context ?? null, subject]);
}

export function createToolkitCohort({ request, principalId, limits, at }) {
  const record = {
    schema: AGENT_TOOLKIT_COHORT_SCHEMA,
    recordId: cohortRecordId(principalId, request.cohortId),
    cohortId: request.cohortId,
    ownerPrincipalId: principalId,
    target: request.target,
    adapter: request.adapter,
    operation: request.operation,
    profile: request.profile,
    createdAt: iso(at),
    updatedAt: iso(at),
    expiresAt: at + limits.cohortTtlMs,
    samples: [],
    proposals: [],
  };
  return assertRecordSize(record, limits);
}

export function assertToolkitCohort(record, request, principalId) {
  assertToolkitOwner(record, principalId);
  if (!same(record.target, request.target)
    || !same(record.adapter, request.adapter)
    || record.operation !== request.operation
    || !same(record.profile, request.profile)) {
    throw new AgentToolkitBlock("cohort_mismatch", "Cohort target, adapter, operation, or evaluation provenance changed.");
  }
}

function sampleFromRun(run) {
  return {
    runId: run.runId,
    candidate: run.candidate,
    adapter: run.adapter,
    operation: run.operation,
    telemetryTrust: run.telemetryTrust,
    status: run.status,
    durationMs: run.completion.durationMs,
    cost: run.completion.cost,
    quality: run.evaluation.status === "reported" || run.evaluation.status === "unreported"
      ? run.evaluation
      : { status: "pending" },
    completedAt: run.completion.completedAt,
  };
}

export function appendToolkitSample(cohort, run, limits, at) {
  const sample = sampleFromRun(run);
  const index = cohort.samples.findIndex((candidate) => candidate.runId === run.runId);
  if (index >= 0) {
    const existing = cohort.samples[index];
    if (!same(existing.candidate, sample.candidate)
      || !same(existing.adapter, sample.adapter)
      || existing.operation !== sample.operation
      || existing.telemetryTrust !== sample.telemetryTrust
      || existing.status !== sample.status) {
      throw new AgentToolkitBlock("sample_mismatch", "Immutable cohort sample identity changed.");
    }
    if (existing.quality.status === "pending" && sample.quality.status !== "pending") {
      const reused = cohort.samples.some((candidate) => candidate.runId !== run.runId
        && candidate.quality?.subjectEvidence?.digest === sample.quality.subjectEvidence?.digest);
      cohort.samples[index] = reused
        ? { ...sample, quality: { ...sample.quality, status: "invalid", reasonCode: "evidence_reused" } }
        : sample;
    }
  } else {
    if (sample.quality.status !== "pending") {
      const reused = cohort.samples.some((candidate) => (
        candidate.quality?.subjectEvidence?.digest === sample.quality.subjectEvidence?.digest
      ));
      if (reused) sample.quality = { ...sample.quality, status: "invalid", reasonCode: "evidence_reused" };
    }
    cohort.samples.push(sample);
    while (cohort.samples.length > limits.maxSamples) cohort.samples.shift();
  }
  cohort.expiresAt = at + limits.cohortTtlMs;
  return touch(cohort, limits, at);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function candidateSamples(cohort, candidate) {
  const matching = cohort.samples.filter(s => same(s.candidate, candidate));
  const exclusions = { failed: 0, invalid: 0, untrusted: 0, duplicate: 0, quality: 0, cost: 0, clock: 0 };
  const seen = new Set(), samples = [];
  for (const sample of matching) {
    if (sample.status !== 'completed') { exclusions.failed++; continue; }
    if (sample.quality.status === 'invalid') { exclusions.invalid++; continue; }
    if (sample.telemetryTrust === 'remote-unverified') { exclusions.untrusted++; continue; }
    const digest = sample.quality.subjectEvidence?.digest;
    if (digest && seen.has(digest)) { exclusions.duplicate++; continue; }
    if (digest) seen.add(digest);
    if (sample.quality.status !== 'reported') exclusions.quality++;
    if (sample.cost.status !== 'reported') exclusions.cost++;
    if (!Number.isFinite(sample.durationMs)) exclusions.clock++;
    samples.push(sample);
  }
  return { samples, exclusions, population: matching.length };
}

function ratio(candidate, baseline) { return baseline === 0 ? candidate === 0 ? 1 : null : candidate / baseline; }

export function compareToolkitCohort(cohort, request) {
  const sides = ['baseline', 'candidate'];
  const evidence = Object.fromEntries(sides.map(k => [k, candidateSamples(cohort, request[k])]));
  const counts = fn => Object.fromEntries(sides.map(k => [k, fn(evidence[k])]));
  const common = {
    reviewRequired: true, applied: false, cohortId: cohort.cohortId,
    ...pick(request, ['baseline', 'candidate', 'policy']),
    ...pick(cohort.profile, ['metric', 'evaluator', 'dataset']),
    adapter: cohort.adapter, operation: cohort.operation,
    sampleCounts: counts(e => e.samples.length),
    untrustedSampleCounts: counts(e => e.exclusions.untrusted),
    duplicateEvidenceCounts: counts(e => e.exclusions.duplicate),
    coverage: counts(e => ({ population: e.population, excluded: e.exclusions })),
  };
  const hold = reasonCode => Object.freeze({ ...common, status: 'insufficient-evidence', reasonCode, recommendation: 'hold' });
  const enough = predicate => sides.every(k => evidence[k].samples.filter(predicate).length >= request.policy.minSamples);
  if (!enough(() => true)) return hold('trusted_sample_count');
  if (!enough(s => s.quality.status === 'reported')) return hold('quality_unreported');
  if (!enough(s => s.cost.status === 'reported')) return hold('cost_unreported');
  if (!enough(s => Number.isFinite(s.durationMs))) return hold('latency_unreported');
  const eligible = s => s.quality.status === 'reported' && s.cost.status === 'reported' && Number.isFinite(s.durationMs);
  if (!enough(eligible)) return hold('comparable_sample_count');
  const metrics = side => {
    const samples = evidence[side].samples.filter(eligible);
    return { count: samples.length, quality: mean(samples.map(s => s.quality.score)),
      latencyMs: mean(samples.map(s => s.durationMs)), costUsd: mean(samples.map(s => s.cost.estimated_cost_usd)) };
  };
  const baselineMetrics = metrics('baseline'), candidateMetrics = metrics('candidate');
  const maximize = cohort.profile.metric.direction === 'maximize';
  const improvement = (candidateMetrics.quality - baselineMetrics.quality) * (maximize ? 1 : -1);
  const latencyRatio = ratio(candidateMetrics.latencyMs, baselineMetrics.latencyMs);
  const costRatio = ratio(candidateMetrics.costUsd, baselineMetrics.costUsd);
  const checks = {
    qualityBoundary: maximize ? candidateMetrics.quality >= request.policy.qualityBoundary : candidateMetrics.quality <= request.policy.qualityBoundary,
    qualityImprovement: improvement >= request.policy.minimumQualityImprovement,
    latencyRegression: latencyRatio !== null && latencyRatio <= request.policy.maxLatencyRegressionRatio,
    costRegression: costRatio !== null && costRatio <= request.policy.maxCostRegressionRatio,
  };
  const result = { ...common, status: 'completed', recommendation: Object.values(checks).every(Boolean) ? 'propose' : 'hold',
    baselineMetrics, candidateMetrics, observed: { qualityImprovement: improvement, latencyRatio, costRatio }, checks };
  return Object.freeze({ ...result, comparisonDigest: digestToolkitEvidence(result) });
}

export function appendToolkitProposal(cohort, request, comparison, limits, at) {
  if (comparison.recommendation !== "propose") {
    throw new AgentToolkitBlock("proposal_not_supported", "Evidence does not support a learning proposal.");
  }
  const existing = cohort.proposals.find((proposal) => proposal.operationId === request.operationId);
  if (existing) {
    if (!same(existing.baseline, request.baseline)
      || !same(existing.candidate, request.candidate)
      || existing.comparisonDigest !== comparison.comparisonDigest) {
      throw new AgentToolkitBlock("proposal_reused", "Proposal operation identity was reused with different evidence.");
    }
    return { cohort: touch(cohort, limits, at), proposal: existing };
  }
  const proposal = {
    proposalId: `toolkit-proposal-${digestToolkitEvidence([
      cohort.cohortId, request.operationId, comparison.comparisonDigest,
    ]).slice(0, 48)}`,
    operationId: request.operationId,
    status: "review_pending",
    baseline: request.baseline,
    candidate: request.candidate,
    comparisonDigest: comparison.comparisonDigest,
    reviewRequired: true,
    applied: false,
    createdAt: iso(at),
  };
  cohort.proposals.push(proposal);
  while (cohort.proposals.length > limits.maxProposals) cohort.proposals.shift();
  cohort.expiresAt = at + limits.cohortTtlMs;
  return { cohort: touch(cohort, limits, at), proposal: Object.freeze(proposal) };
}
