/** Bounded local cost observations influence ordering, never coverage or authority. */
import { hash, readRegular } from './agentic-os-test-inputs.mjs';
import { lockReceipts, writeReceipt } from './agentic-os-test-receipt.mjs';
export const ECONOMY_FILE = 'validation-economy.json';
const SCHEMA = 'agentic-os/validation-economy/v1', TTL = 14 * 86_400_000;
// Observation bounds are independent of execution deadlines: process teardown can overrun a deadline.
const OBSERVATION_MS = 86_400_000;
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const fail = () => { throw Error('blocked-validation-resource-observation'); };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const RESOURCE_KEYS = ['cpuMs', 'peakMemoryBytes', 'tokens', 'costUsd', 'queueWaitMs'];
export function resourceObservation(value) {
  const measured = value.resources?.status === 'measured', usage = value.cost?.status === 'reported';
  const resources = { cpuMs: null, peakMemoryBytes: null, tokens: null, costUsd: null, costBasis: 'unreported',
    queueWaitMs: number(value.queueWaitMs), measurement: measured ? 'wait4' : 'unavailable', memoryScope: 'maximum-single-process-rss' };
  if (measured) {
    if (value.resources.method !== 'wait4' || value.resources.scope !== 'waited-process-tree'
      || value.resources.memoryScope !== resources.memoryScope) fail();
    for (const key of ['cpuMs', 'peakMemoryBytes']) {
      const n = number(value.resources[key]); if (n === null || n > Number.MAX_SAFE_INTEGER) fail();
      resources[key] = n;
    }
    if (!Number.isSafeInteger(resources.peakMemoryBytes)) fail();
  }
  if (usage) {
    const input = value.cost.prompt_tokens, output = value.cost.completion_tokens;
    if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(input + output)) fail();
    resources.tokens = input + output;
    resources.costUsd = number(value.cost.estimated_cost_usd);
    if (value.cost.estimated_cost_usd !== null && value.cost.estimated_cost_usd !== undefined && resources.costUsd === null) fail();
    if (resources.costUsd !== null) resources.costBasis = 'estimated';
  }
  return resources;
}


export function economyContext(policyDigest, ownerDigest, identity) {
  const { root, environmentDigest, node, executable, platform, arch } = identity;
  return hash(JSON.stringify({ policyDigest, ownerDigest, root, environmentDigest, node, executable, platform, arch }));
}
export function readEconomy(directory, context, now = Date.now(), checkIds = null) {
  const empty = status => ({ schema: SCHEMA, authority: false, context, status, checks: {} });
  try {
    const value = JSON.parse(readRegular(directory, ECONOMY_FILE, 64_000).text);
    if (value.schema !== SCHEMA || value.authority !== false || value.context !== context) return empty('context-changed');
    if (!value.checks || Array.isArray(value.checks) || typeof value.checks !== 'object'
      || Object.keys(value.checks).length > 128) return empty('invalid');
    for (const [id, v] of Object.entries(value.checks)) {
      if (!/^[a-z][a-z0-9.-]{0,95}$/u.test(id) || checkIds && !checkIds.includes(id) || !v || typeof v !== 'object'
        || !Number.isInteger(v.samples) || !finite(v.samples, 1, 32)
        || !finite(v.meanMs, 0, OBSERVATION_MS) || !finite(v.failureRate, 0, 1)
        || !finite(v.observedAt, now - TTL, now)
        || v.resourceMeans && (typeof v.resourceMeans !== 'object' || Array.isArray(v.resourceMeans)
          || Object.entries(v.resourceMeans).some(([key, n]) => !RESOURCE_KEYS.includes(key) || number(n) === null))
        || v.observationId !== undefined && !/^[a-f0-9]{64}$/u.test(v.observationId)
        || v.sourceRevision !== undefined && !/^[a-f0-9]{40}$/u.test(v.sourceRevision)
        || v.sampleFinishedAt !== undefined && !finite(v.sampleFinishedAt, 0, now)) return empty('invalid-or-expired');
    }
    return { schema: SCHEMA, authority: false, context, status: 'observed',
      checks: Object.fromEntries(Object.entries(value.checks).map(([id, { samples, meanMs, failureRate, observedAt, resourceMeans, observationId, sourceRevision, sampleFinishedAt }]) =>
        [id, { samples, meanMs, failureRate, observedAt, ...(resourceMeans ? { resourceMeans } : {}),
          ...(observationId ? { observationId } : {}), ...(sourceRevision ? { sourceRevision } : {}),
          ...(sampleFinishedAt === undefined ? {} : { sampleFinishedAt }) }])) };
  } catch (error) { return empty(error.code === 'ENOENT' ? 'missing' : 'unavailable'); }
}
export function observeCost(state, check, result, now = Date.now()) {
  if (!finite(result.elapsedMs, 0, OBSERVATION_MS) || !finite(now, 0, Number.MAX_SAFE_INTEGER))
    throw new Error('blocked-validation-cost-observation');
  const old = Object.hasOwn(state.checks, check.name) ? state.checks[check.name] : null;
  if (result.reused === true || result.observationId && old?.observationId === result.observationId) return null;
  if (result.observationId !== undefined && !/^[a-f0-9]{64}$/u.test(result.observationId)
    || result.sourceRevision !== undefined && !/^[a-f0-9]{40}$/u.test(result.sourceRevision)) throw Error('blocked-validation-cost-identity');
  if (result.finishedAt !== undefined && !finite(result.finishedAt, 0, now)) throw Error('blocked-validation-cost-time');
  if (result.observationId && result.finishedAt !== undefined && old?.sampleFinishedAt >= result.finishedAt) return null;
  const failed = result.exitCode !== 0 || Boolean(result.reason);
  const alpha = old ? 0.25 : 1;
  const observed = resourceObservation(result), resourceMeans = {}, regressions = [];
  for (const key of RESOURCE_KEYS) {
    if (observed[key] === null) continue;
    const prior = old?.resourceMeans?.[key];
    resourceMeans[key] = prior === undefined ? observed[key] : prior * 0.75 + observed[key] * 0.25;
    if (old?.samples >= 3 && prior !== undefined && observed[key] > Math.max(prior * 2, prior + (key === 'peakMemoryBytes' ? 1048576 : key === 'costUsd' ? 0 : 1)))
      regressions.push({ metric: key, previousMean: prior, observed: observed[key] });
  }
  const next = { samples: Math.min(32, (old?.samples ?? 0) + 1),
    meanMs: (old?.meanMs ?? 0) * (1 - alpha) + result.elapsedMs * alpha,
    failureRate: (old?.failureRate ?? 0) * (1 - alpha) + Number(failed) * alpha, observedAt: now,
    ...(Object.keys(resourceMeans).length ? { resourceMeans } : {}),
    ...(result.observationId ? { observationId: result.observationId } : {}),
    ...(result.finishedAt === undefined ? {} : { sampleFinishedAt: result.finishedAt }),
    ...(result.sourceRevision ? { sourceRevision: result.sourceRevision } : {}) };
  state.checks[check.name] = next;
  return old?.samples >= 3 && (regressions.length || result.elapsedMs > Math.max(old.meanMs * 2, old.meanMs + 1000))
    ? { check: check.name, previousMeanMs: old.meanMs, observedMs: result.elapsedMs, ...(regressions.length ? { resources: regressions } : {}) } : null;
}

/** A bounded feedback view; only the existing dependency-aware scheduler changes execution order. */
export function economyFeedback(state) {
  return { status: 'advisory', authority: false, strategy: 'observe-rank-execute-reevaluate',
    ranking: Object.entries(state.checks).sort((a, b) => b[1].meanMs - a[1].meanMs || a[0].localeCompare(b[0])).slice(0, 5)
      .map(([id, value]) => ({ id, samples: value.samples, meanMs: value.meanMs, failureRate: value.failureRate,
        resourceMeans: value.resourceMeans ?? {}, sourceRevision: value.sourceRevision ?? null,
        observedAt: value.observedAt, confidence: value.samples >= 3 ? 'repeated-observation' : 'cold-baseline',
        nextAction: (value.resourceMeans?.queueWaitMs ?? 0) > value.meanMs / 2 ? 'inspect-ci-queue' : 'profile-expensive-stage' })),
    constraints: 'Preserve required checks, source identity, deadlines, free-only execution and unknown metrics. Reused or unchanged reports do not train the baseline.' };
}

export function recordEconomy(directory, context, check, result, now = Date.now(), checkIds = null) {
  const release = lockReceipts(directory);
  try {
    const state = readEconomy(directory, context, now, checkIds);
    const regression = observeCost(state, check, result, now);
    writeReceipt(directory, ECONOMY_FILE, JSON.stringify(state));
    return { feedback: economyFeedback(state), regression };
  } finally { release(); }
}
export function costOrderedChecks(checks, state) {
  const pending = [...checks], done = new Set(), ordered = [];
  const mandatory = new Set(checks.filter(c => c.reasons.includes('mandatory')).map(c => c.name));
  const requireMandatory = id => {
    for (const dependency of checks.find(c => c.name === id)?.requires ?? []) {
      if (!mandatory.has(dependency)) { mandatory.add(dependency); requireMandatory(dependency); }
    }
  };
  [...mandatory].forEach(requireMandatory);
  while (pending.length) {
    const ready = pending.filter(c => c.requires.every(id => done.has(id)));
    if (!ready.length) throw new Error('blocked-validation-cost-dependencies');
    const required = ready.filter(c => mandatory.has(c.name)), pool = required.length ? required : ready;
    // Cold or incomplete observations keep owner order. Mandatory checks never move behind optional work.
    if (!required.length && pool.every(c => state.checks[c.name]?.samples >= 3)) pool.sort((a, b) => {
      const score = c => (state.checks[c.name].failureRate + 0.05) / Math.max(1, state.checks[c.name].meanMs);
      return score(b) - score(a) || checks.indexOf(a) - checks.indexOf(b);
    });
    const next = pool[0]; ordered.push(next); done.add(next.name); pending.splice(pending.indexOf(next), 1);
  }
  return ordered;
}
export function resourcePlan(checks, state, previews, { checkout, observedBytes, runMs }) {
  const estimates = previews.map(c => c.reuse ? 0 : state.checks[c.id]?.meanMs ?? null);
  const known = estimates.filter(n => n !== null);
  return { schema: SCHEMA, authority: false, feedback: state.status,
    strategy: 'mandatory-and-prerequisites-first; observed-failure-rate-per-millisecond; stable-cold-order',
    order: checks.map(c => c.name), observedSourceBytes: observedBytes,
    estimatedMs: known.length === estimates.length ? Math.ceil(known.reduce((a, b) => a + b, 0)) : null,
    unknownCosts: estimates.length - known.length, runBudgetMs: runMs,
    unchangedFailures: previews.filter(check => check.unchangedFailure).map(check => check.id),
    checkout: { surface: checkout ?? 'working-tree',
      diffMinimumDepth: checkout === 'pull-request-merge' ? 2 : null,
      automaticFetch: false,
      constraint: 'Depth 2 needs the exact synthetic merge and both event parents; retain full history when owner gates need older revisions. Head, push and merge-group checkouts need a verified merge base.' } };
}
