import { normalizeJson, serializedJsonLength } from "../json-contract.mjs";
import { normalizeCostLog, assertIdentifier as identifier, assertExactKeys, normalizeSignal } from "./running-agent-contract.js";

export const AGENT_TOOLKIT_RUN_SCHEMA = "agent-toolkit-run/v1";
export const AGENT_TOOLKIT_COHORT_SCHEMA = "agent-toolkit-cohort/v1";

export const AGENT_TOOLKIT_DEFAULTS = Object.freeze({
  maxSpans: 128,
  maxSamples: 64,
  maxProposals: 16,
  maxOptimizationCandidates: 16,
  maxRecordChars: 300_000,
  runTtlMs: 30 * 60_000,
  cohortTtlMs: 7 * 24 * 60 * 60_000,
  operationTimeoutMs: 60_000,
  evaluationLeaseMs: 90_000,
  storeClaimTtlMs: 10_000,
  storeClaimAttempts: 8,
  storeClaimRetryMs: 5,
  maxEvaluationAttempts: 2,
  requestWindowMs: 60_000,
  maxRequestsPerWindow: 240,
  maxPrincipalRuns: 32,
  maxPrincipalCohorts: 8,
  principalShardCount: 64,
  maxPrincipalsPerShard: 64,
  comparison: Object.freeze({
    minSamples: 2,
    qualityBoundary: 0,
    minimumQualityImprovement: 0,
    maxLatencyRegressionRatio: 1,
    maxCostRegressionRatio: 1,
  }),
});

const TARGET_KINDS = new Set(["agent", "team"]);
const SPAN_KINDS = new Set(["agent", "team", "workflow", "model", "tool", "evaluator", "other"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);
const DIRECTIONS = new Set(["maximize", "minimize"]);
const TELEMETRY_TRUST = new Set(["server-observed", "application-verified", "remote-unverified"]);
const REASON_CODES = new Set([
  "aborted", "adapter_failed", "component_failed", "cost_log_invalid", "model_failed",
  "operator_cancelled", "run_terminal", "timeout", "tool_failed", "workflow_failed",
]);
const MACHINE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/;
const MAX_METRIC_MAGNITUDE = 1_000_000_000_000;
const MAX_TOKEN_COUNT = 1_000_000_000_000;
const MAX_COST_USD = 1_000_000_000;

export class AgentToolkitBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "AgentToolkitBlock";
    this.reasonCode = reasonCode;
  }
}

export { assertExactKeys };
export function assertIdentifier(value, field, maxChars = 256) {
  const normalized = identifier(value, field, maxChars);
  if (!MACHINE_TOKEN.test(normalized)) throw new TypeError(`${field} must be an opaque machine token.`);
  return normalized;
}

function assertDigest(value, field) {
  const digest = assertIdentifier(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${field} must be a SHA-256 digest.`);
  return digest;
}

export function normalizeAccessContext(value = {}) {
  assertExactKeys(value, ["principalId", "principalExpiresAt", "telemetryTrust"], "access context");
  if (value.principalExpiresAt !== undefined && !Number.isFinite(value.principalExpiresAt)) {
    throw new TypeError("access context.principalExpiresAt must be a finite timestamp when provided.");
  }
  const telemetryTrust = value.telemetryTrust ?? "application-verified";
  if (!TELEMETRY_TRUST.has(telemetryTrust)) throw new TypeError("access context.telemetryTrust is unsupported.");
  return Object.freeze({
    principalId: assertIdentifier(value.principalId ?? "application-local", "access context.principalId"),
    ...(value.principalExpiresAt === undefined ? {} : { principalExpiresAt: value.principalExpiresAt }),
    telemetryTrust,
  });
}

function normalizeRevisionRef(value, field, extras = []) {
  assertExactKeys(value, ["id", "revision", "digest", ...extras], field);
  return Object.freeze({
    id: assertIdentifier(value.id, `${field}.id`),
    revision: assertIdentifier(value.revision, `${field}.revision`),
    digest: assertDigest(value.digest, `${field}.digest`),
  });
}

export const normalizeCandidate = (value, field = 'candidate') => normalizeRevisionRef(value, field);

function normalizeTarget(value) {
  const reference = normalizeRevisionRef(value, 'request.target', ['kind']);
  if (!TARGET_KINDS.has(value.kind)) throw new TypeError('request.target.kind must be agent or team.');
  return Object.freeze({ ...reference, kind: value.kind });
}

function normalizeMetric(value, field = 'request.profile.metric') {
  const reference = normalizeRevisionRef(value, field, ['direction']);
  if (!DIRECTIONS.has(value.direction)) throw new TypeError(`${field}.direction is unsupported.`);
  return Object.freeze({ ...reference, direction: value.direction });
}

function normalizeProfile(value) {
  assertExactKeys(value, ["evaluator", "dataset", "metric"], "request.profile");
  return Object.freeze({
    evaluator: normalizeRevisionRef(value.evaluator, "request.profile.evaluator"),
    dataset: normalizeRevisionRef(value.dataset, "request.profile.dataset"),
    metric: normalizeMetric(value.metric),
  });
}

export function normalizeStartRequest(value) {
  assertExactKeys(value, [
    "runId", "cohortId", "target", "candidate", "adapter", "operation", "profile", "signal", "context",
  ], "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    cohortId: assertIdentifier(value.cohortId, "request.cohortId"),
    target: normalizeTarget(value.target),
    candidate: normalizeCandidate(value.candidate, "request.candidate"),
    adapter: normalizeRevisionRef(value.adapter, "request.adapter"),
    operation: assertIdentifier(value.operation, "request.operation"),
    profile: normalizeProfile(value.profile),
    ...(value.context === undefined ? {} : { context: normalizeRunContext(value.context) }),
    signal: normalizeSignal(value.signal, "request.signal"),
  });
}

/** References only. The host must resolve the enrolled source before dispatch. */
export function normalizeRunContext(value) {
  assertExactKeys(value, ['projectId', 'goalId', 'taskId', 'plan', 'receipt'], 'context');
  const plan = value.plan;
  assertExactKeys(plan, ['repository', 'path', 'revision', 'digest', 'continuityId', 'revisions'], 'context.plan');
  const roles = ['prd', 'tad', 'adr', 'mvp', 'gtm'];
  assertExactKeys(plan.revisions, roles, 'context.plan.revisions');
  const revisions = Object.fromEntries(roles.map(role => [role, assertIdentifier(plan.revisions[role], role, 64)]));
  if (new Set(Object.values(revisions)).size !== 1 || !/^[a-f0-9]{40}$/.test(plan.revision)
    || !/^[a-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(plan.repository)
    || typeof plan.path !== 'string' || plan.path.startsWith('/') || plan.path.split('/').some(p => !p || p === '.' || p === '..'))
    throw new AgentToolkitBlock('context_join_invalid', 'Exact source and five-role revision join required.');
  return Object.freeze({ ...Object.fromEntries(['projectId', 'goalId', 'taskId'].map(k => [k, assertIdentifier(value[k], k, 128)])),
    plan: { repository: assertIdentifier(plan.repository, 'repository', 256), path: assertIdentifier(plan.path, 'path', 256), revision: plan.revision,
      digest: assertDigest(plan.digest, 'plan.digest'), continuityId: assertIdentifier(plan.continuityId, 'continuityId'), revisions },
    ...(value.receipt === undefined ? {} : { receipt: normalizeEvidenceRef(value.receipt, 'receipt') }) });
}

export const RESOURCE_UNITS = Object.freeze(['inputTokens', 'outputTokens', 'attempts', 'elapsedMs']);
export function normalizeResources(value) {
  assertExactKeys(value, RESOURCE_UNITS, 'resources');
  return Object.freeze(Object.fromEntries(RESOURCE_UNITS.map(k => {
    if (!Number.isSafeInteger(value[k]) || value[k] < 0 || value[k] > 1_000_000_000_000)
      throw new TypeError(`Invalid resource unit: ${k}`);
    return [k, value[k]];
  })));
}

export function normalizeAllocation(value) {
  assertExactKeys(value, ['id', 'revision', 'windowId', 'startsAt', 'endsAt', 'project', 'agent', 'run', 'bounds', 'providerCostMicros'], 'allocation');
  if (value.providerCostMicros !== 0 || !Number.isSafeInteger(value.startsAt) || !Number.isSafeInteger(value.endsAt)
    || value.startsAt < 0 || value.endsAt <= value.startsAt || value.endsAt - value.startsAt > 7 * 86400_000
    || value.bounds?.attempts !== 1 || value.bounds?.elapsedMs < 1 || value.bounds?.elapsedMs > 60_000)
    throw new AgentToolkitBlock('allocation_invalid', 'A bounded free allocation is required.');
  return Object.freeze({ ...Object.fromEntries(['id', 'revision', 'windowId'].map(k => [k, assertIdentifier(value[k], k, 128)])),
    startsAt: value.startsAt, endsAt: value.endsAt, providerCostMicros: 0,
    ...Object.fromEntries(['project', 'agent', 'run', 'bounds'].map(k => [k, normalizeResources(value[k])])) });
}

export function normalizeTraceQuery(value = {}, detail = false) {
  assertExactKeys(value, detail ? ['runId', 'limit', 'cursor'] : ['limit', 'cursor', 'from', 'to', 'projectId', 'agentId', 'status'], 'trace query');
  const limit = value.limit ?? 16;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new TypeError('Trace page limit must be 1..32.');
  const result = { limit };
  for (const key of detail ? ['runId'] : ['projectId', 'agentId', 'status']) {
    if (value[key] !== undefined || detail) result[key] = assertIdentifier(value[key], key, 256);
  }
  for (const key of ['from', 'to']) if (value[key] !== undefined) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new TypeError('Invalid trace time window.');
    result[key] = value[key];
  }
  if (value.cursor !== undefined) {
    if (typeof value.cursor !== 'string' || value.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value.cursor)) throw new TypeError('Invalid trace cursor.');
    result.cursor = value.cursor;
  }
  return Object.freeze(result);
}

export function normalizeSpanStartRequest(value) {
  assertExactKeys(value, ["runId", "spanId", "parentSpanId", "kind", "operation", "component", "taskId", "attempt", "links"], "request");
  if (!SPAN_KINDS.has(value.kind)) throw new TypeError("request.kind is unsupported.");
  const correlation = value.taskId === undefined && value.attempt === undefined ? {} : { taskId: assertIdentifier(value.taskId, 'taskId'), attempt: value.attempt };
  if (Object.keys(correlation).length && (!Number.isSafeInteger(value.attempt) || value.attempt < 1 || value.attempt > 128)) throw new TypeError('Invalid attempt.');
  const links = value.links === undefined ? undefined : value.links;
  if (links !== undefined && (!Array.isArray(links) || links.length > 32)) throw new TypeError('Bounded span links required.');
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    spanId: assertIdentifier(value.spanId, "request.spanId"),
    ...(value.parentSpanId === undefined
      ? {}
      : { parentSpanId: assertIdentifier(value.parentSpanId, "request.parentSpanId") }),
    kind: value.kind,
    operation: assertIdentifier(value.operation, "request.operation"),
    component: normalizeRevisionRef(value.component, "request.component"),
    ...correlation,
    ...(links === undefined ? {} : { links: links.map(link => {
      assertExactKeys(link, ['spanId', 'kind'], 'link');
      if (!['dependency', 'handoff'].includes(link.kind)) throw new TypeError('Invalid causal link kind.');
      return { spanId: assertIdentifier(link.spanId, 'link.spanId'), kind: link.kind };
    }) }),
  });
}

export function normalizeSpanFinishRequest(value) {
  assertExactKeys(value, ["runId", "spanId", "status", "reasonCode", "effectId", "costLog"], "request");
  if (value.costLog !== undefined && value.effectId === undefined) throw new TypeError('Usage requires an effect identity.');
  if (!TERMINAL_STATUSES.has(value.status)) throw new TypeError("request.status is unsupported.");
  if (value.status === "completed" && value.reasonCode !== undefined) {
    throw new TypeError("Completed spans cannot include a reasonCode.");
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    spanId: assertIdentifier(value.spanId, "request.spanId"),
    status: value.status,
    ...(value.effectId === undefined ? {} : { effectId: assertIdentifier(value.effectId, 'effectId') }),
    ...(value.costLog === undefined ? {} : { costLog: normalizeToolkitCostLog(value.costLog) }),
    ...(value.reasonCode === undefined ? {} : { reasonCode: normalizeReasonCode(value.reasonCode, "request.reasonCode") }),
  });
}

export function normalizeCompleteRequest(value) {
  assertExactKeys(value, ["runId", "operationId", "status", "reasonCode", "costLog"], "request");
  if (!TERMINAL_STATUSES.has(value.status)) throw new TypeError("request.status is unsupported.");
  if (value.status === "completed" && value.reasonCode !== undefined) {
    throw new TypeError("Completed runs cannot include a reasonCode.");
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    operationId: assertIdentifier(value.operationId, "request.operationId"),
    status: value.status,
    ...(value.reasonCode === undefined ? {} : { reasonCode: normalizeReasonCode(value.reasonCode, "request.reasonCode") }),
    costLog: normalizeToolkitCostLog(value.costLog),
  });
}

export function normalizeEvidenceRef(value, field = "request.evidence") {
  assertExactKeys(value, ["id", "digest"], field);
  return Object.freeze({
    id: assertIdentifier(value.id, `${field}.id`),
    digest: assertDigest(value.digest, `${field}.digest`),
  });
}

export function normalizeEvaluateRequest(value) {
  assertExactKeys(value, ["runId", "operationId", "evidence", "signal", "spanId", "subjectDigest"], "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    operationId: assertIdentifier(value.operationId, "request.operationId"),
    evidence: normalizeEvidenceRef(value.evidence),
    ...(value.spanId === undefined ? {} : { spanId: assertIdentifier(value.spanId, 'spanId') }),
    ...(value.subjectDigest === undefined && value.spanId === undefined ? {} : { subjectDigest: assertDigest(value.subjectDigest, 'subjectDigest') }),
    signal: normalizeSignal(value.signal, "request.signal"),
  });
}

export function normalizeEvaluationOutcome(value, expectedMetric) {
  assertExactKeys(value, ["status", "score", "metric", "evidence", "costLog"], "evaluation outcome");
  if (!["reported", "unreported"].includes(value.status)) {
    throw new TypeError("evaluation outcome.status is unsupported.");
  }
  const metric = normalizeMetric(value.metric, "evaluation outcome.metric");
  if (metric.id !== expectedMetric.id
    || metric.revision !== expectedMetric.revision
    || metric.digest !== expectedMetric.digest
    || metric.direction !== expectedMetric.direction) {
    throw new AgentToolkitBlock("evaluation_metric_mismatch", "Evaluator metric provenance changed.");
  }
  if (value.status === "reported" && (
    !Number.isFinite(value.score) || Math.abs(value.score) > MAX_METRIC_MAGNITUDE
  )) {
    throw new TypeError("evaluation outcome.score must be finite and bounded when reported.");
  }
  if (value.status === "unreported" && value.score !== undefined) {
    throw new TypeError("Unreported evaluation outcomes cannot include a score.");
  }
  return Object.freeze({
    status: value.status,
    metric,
    ...(value.status === "reported" ? { score: value.score } : {}),
    evidence: normalizeEvidenceRef(value.evidence, "evaluation outcome.evidence"),
    costLog: normalizeToolkitCostLog(value.costLog),
  });
}

export function normalizeComparisonPolicy(value, defaults) {
  const source = value === undefined ? defaults : value;
  assertExactKeys(source, [
    "minSamples", "qualityBoundary", "minimumQualityImprovement",
    "maxLatencyRegressionRatio", "maxCostRegressionRatio",
  ], "request.policy");
  if (!Number.isInteger(source.minSamples) || source.minSamples < 1 || source.minSamples > 4_096) {
    throw new TypeError("request.policy.minSamples must be an integer from 1 through 4096.");
  }
  for (const field of [
    "qualityBoundary", "minimumQualityImprovement", "maxLatencyRegressionRatio", "maxCostRegressionRatio",
  ]) {
    if (!Number.isFinite(source[field])
      || Math.abs(source[field]) > MAX_METRIC_MAGNITUDE
      || (field !== "qualityBoundary" && source[field] < 0)) {
      throw new TypeError(`request.policy.${field} must be finite and non-negative.`);
    }
  }
  return Object.freeze({ ...source });
}

export function normalizeCompareRequest(value, defaults) {
  assertExactKeys(value, ["cohortId", "baseline", "candidate", "policy"], "request");
  const baseline = normalizeCandidate(value.baseline, "request.baseline");
  const candidate = normalizeCandidate(value.candidate, "request.candidate");
  if (JSON.stringify(baseline) === JSON.stringify(candidate)) {
    throw new TypeError("request.candidate must differ from request.baseline.");
  }
  return Object.freeze({
    cohortId: assertIdentifier(value.cohortId, "request.cohortId"),
    baseline,
    candidate,
    policy: normalizeComparisonPolicy(value.policy, defaults),
  });
}

export function normalizeProposalRequest(value, defaults) {
  assertExactKeys(value, ["cohortId", "baseline", "candidate", "policy", "operationId"], "request");
  const comparison = normalizeCompareRequest({
    cohortId: value.cohortId,
    baseline: value.baseline,
    candidate: value.candidate,
    policy: value.policy,
  }, defaults);
  return Object.freeze({
    ...comparison,
    operationId: assertIdentifier(value.operationId, "request.operationId"),
  });
}

export function normalizeAuthorization(value) {
  assertExactKeys(value, ["allowed", "authorizationId", "reasonCode"], "authorization");
  if (value.allowed !== true) {
    throw new AgentToolkitBlock(
      "toolkit_denied",
      "Application policy denied the Agent Toolkit operation.",
    );
  }
  return Object.freeze({ authorizationId: assertIdentifier(value.authorizationId, "authorization.authorizationId") });
}

export function normalizeInstrumentOutcome(value) {
  assertExactKeys(value, ["value", "costLog", "evidence"], "instrument outcome");
  return Object.freeze({
    value: value.value,
    costLog: normalizeToolkitCostLog(value.costLog),
    ...(value.evidence === undefined ? {} : { evidence: normalizeEvidenceRef(value.evidence, "instrument outcome.evidence") }),
  });
}

export function normalizeReasonCode(value, field = "reasonCode") {
  const reasonCode = assertIdentifier(value, field, 64);
  if (!REASON_CODES.has(reasonCode)) throw new TypeError(`${field} is unsupported.`);
  return reasonCode;
}

export function normalizeToolkitCostLog(value) {
  const costLog = normalizeCostLog(value);
  if (!costLog) return null;
  assertIdentifier(costLog.model, "costLog.model", 128);
  for (const field of ["prompt_tokens", "completion_tokens", "cache_hits"]) {
    if (!Number.isSafeInteger(costLog[field]) || costLog[field] > MAX_TOKEN_COUNT) {
      throw new AgentToolkitBlock("cost_log_invalid", `costLog.${field} exceeds the Agent Toolkit bound.`);
    }
  }
  if (costLog.estimated_cost_usd > MAX_COST_USD) {
    throw new AgentToolkitBlock("cost_log_invalid", "costLog.estimated_cost_usd exceeds the Agent Toolkit bound.");
  }
  return costLog;
}

export function assertRecordSize(value, limits) {
  const normalized = normalizeJson(value, "agent toolkit record");
  if (serializedJsonLength(normalized) > limits.maxRecordChars) {
    throw new RangeError(`Agent Toolkit record exceeds ${limits.maxRecordChars} characters.`);
  }
  return normalized;
}
