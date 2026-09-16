import { AgentToolkitBlock, normalizeTraceQuery } from './agent-toolkit-contract.js';
import { digestToolkitEvidence, projectToolkitRun, runRecordId } from './agent-toolkit-ledger.js';
const SCHEMA = "agent-toolkit-profile/v1";

function timing(record, span) {
  const start = Date.parse(span.startedAt), duration = span.durationMs;
  const children = record.spans.filter(s => s.parentSpanId === span.spanId);
  const comparable = !record.traceTruncated && Number.isFinite(duration) && children.every(s => s.clockOrigin === span.clockOrigin
    && Number.isFinite(s.durationMs) && Date.parse(s.startedAt) >= start && Date.parse(s.startedAt) + s.durationMs <= start + duration);
  let covered = 0, end = start;
  for (const child of children.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))) {
    const left = Date.parse(child.startedAt), right = left + child.durationMs;
    covered += Math.max(0, right - Math.max(end, left)); end = Math.max(end, right);
  }
  return { startOffsetMs: span.clockOrigin === record.clockOrigin && start >= record.admittedAt ? start - record.admittedAt : null,
    inclusiveMs: duration ?? null, exclusiveObservedMs: comparable ? duration - covered : null };
}

function page(values, request, principalId, at, revision) {
  const { cursor, ...filters } = request;
  const scope = digestToolkitEvidence([principalId, filters]);
  let offset = 0, expiresAt = at + 60_000;
  if (cursor) {
    let parsed; try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { /* Invalid cursor fails closed. */ }
    if (!parsed || parsed.scope !== scope || parsed.revision !== revision || !Number.isSafeInteger(parsed.offset)
      || parsed.offset < 0 || parsed.offset >= values.length || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.expiresAt <= at || parsed.expiresAt > at + 60_000)
      throw new AgentToolkitBlock('trace_cursor_expired', 'Refresh the authorized snapshot.');
    offset = parsed.offset; expiresAt = parsed.expiresAt;
  }
  const next = offset + request.limit;
  return { items: values.slice(offset, next), total: values.length, offset,
    nextCursor: next < values.length ? Buffer.from(JSON.stringify({ scope, revision, offset: next, expiresAt })).toString('base64url') : null };
}

/** Bounded principal index, never a store-wide scan or a payload search. */
export function createToolkitQueries({ store, admission, now, limits, authorize, resources }) {
  async function records(context) {
    const index = await admission.runs(context.principalId);
    const result = await Promise.all(index.ids.map(id => store.get(runRecordId(context.principalId, id))));
    return { records: result.filter(r => r && r.ownerPrincipalId === context.principalId), incomplete: index.incomplete || result.some(r => !r) };
  }
  return {
    async query(value, context) {
      const request = normalizeTraceQuery(value), at = now();
      await authorize('observe', request, context);
      if ((request.to ?? at) - (request.from ?? at - limits.runTtlMs) > limits.runTtlMs
        || (request.from ?? 0) > (request.to ?? at) || (request.to ?? at) > at)
        throw new AgentToolkitBlock('trace_window_invalid', 'Select a window within retention.');
      const found = await records(context);
      const selected = found.records.filter(r => r.admittedAt >= (request.from ?? at - limits.runTtlMs)
        && r.admittedAt <= (request.to ?? at) && (!request.projectId || r.context?.projectId === request.projectId)
        && (!request.agentId || r.target.id === request.agentId) && (!request.status || r.status === request.status))
        .sort((a, b) => a.runId.localeCompare(b.runId));
      const values = selected.map(r => ({ runId: r.runId, status: r.status, target: r.target, operation: r.operation,
        context: r.context ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt, expiresAt: r.expiresAt,
        profile: profileToolkitRun(r), evaluation: { status: r.evaluation.status }, traceTruncated: r.traceTruncated }));
      return { schema: 'agent-toolkit-query/v1', status: 'completed', ...page(values, request, context.principalId, at, digestToolkitEvidence(values)),
        access: { scope: digestToolkitEvidence(context.principalId), expiresAt: context.principalExpiresAt ?? at + 60_000 },
        observedAt: at, window: { from: request.from ?? at - limits.runTtlMs, to: request.to ?? at },
        metrics: { runLatencyMs: distribution(selected.flatMap(r => Number.isFinite(r.completion?.durationMs) ? [r.completion.durationMs] : [])),
          failed: selected.filter(r => r.status === 'failed').length, runs: selected.length,
          knownTokenRuns: selected.filter(r => r.completion?.cost.status === 'reported').length,
          knownTokens: selected.reduce((n, r) => n + (r.completion?.cost.prompt_tokens ?? 0) + (r.completion?.cost.completion_tokens ?? 0), 0) },
        coverage: { population: 'retained-authorized-runs', partial: found.incomplete || selected.some(r => r.traceTruncated) } };
    },
    async trace(value, context) {
      const request = normalizeTraceQuery(value, true), at = now();
      await authorize('observe', request, context);
      const record = await store.get(runRecordId(context.principalId, request.runId));
      if (!record || record.ownerPrincipalId !== context.principalId) throw new AgentToolkitBlock('run_not_found', 'Trace unavailable.');
      const { spans, ...projection } = projectToolkitRun(record);
      const sliced = page(spans, request, context.principalId, at, digestToolkitEvidence(projection.updatedAt + JSON.stringify(spans)));
      return { ...projection, spans: sliced.items.map(span => ({ ...span, timing: timing(record, span) })), page: { total: sliced.total, offset: sliced.offset, nextCursor: sliced.nextCursor },
        coverage: { retainedSpans: spans.length, droppedEvents: record.droppedSpans ?? 0, expectedSpans: null, partial: record.traceTruncated },
        observedAt: at, profileSummary: profileToolkitRun(record),
        resources: record.context && resources ? await resources.inspect(record.context, context.principalId) : null };
    },
  };
}

function distribution(values) {
  const sorted = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const quantile = fraction => sorted.length ? sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] : null;
  return Object.freeze({ count: sorted.length, p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: sorted.at(-1) ?? null });
}

export function profileToolkitRun(record) {
  const finishedSpans = record.spans.filter((span) => Number.isFinite(span.durationMs));
  const bottlenecks = [...finishedSpans]
    .sort((left, right) => right.durationMs - left.durationMs || left.spanId.localeCompare(right.spanId))
    .slice(0, 5)
    .map((span) => Object.freeze({
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      kind: span.kind,
      operation: span.operation,
      component: span.component,
      status: span.status,
      durationMs: span.durationMs,
    }));
  const cost = record.completion?.cost;
  return Object.freeze({
    schema: SCHEMA,
    runId: record.runId,
    status: record.status,
    telemetryTrust: record.telemetryTrust,
    runDurationMs: record.completion?.durationMs ?? null,
    spanLatencyMs: distribution(finishedSpans.map((span) => span.durationMs)),
    spanStatusCounts: Object.freeze(record.spans.reduce((counts, span) => {
      counts[span.status] = (counts[span.status] || 0) + 1;
      return counts;
    }, {})),
    bottlenecks: Object.freeze(bottlenecks),
    tokenUsage: Object.freeze({
      status: cost?.status === "reported" ? "reported" : "unreported",
      promptTokens: cost?.prompt_tokens ?? null,
      completionTokens: cost?.completion_tokens ?? null,
      cacheHits: cost?.cache_hits ?? null,
    }),
    estimatedCostUsd: cost?.estimated_cost_usd ?? null,
    traceTruncated: record.traceTruncated,
  });
}
