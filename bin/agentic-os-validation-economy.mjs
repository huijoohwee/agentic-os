/** Bounded local cost observations influence ordering, never coverage or authority. */
import { hash, readRegular } from './agentic-os-test-inputs.mjs';
export const ECONOMY_FILE = 'validation-economy.json';
const SCHEMA = 'agentic-os/validation-economy/v1', TTL = 14 * 86_400_000;
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
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
        || !finite(v.meanMs, 0, 900_000) || !finite(v.failureRate, 0, 1)
        || !finite(v.observedAt, now - TTL, now)) return empty('invalid-or-expired');
    }
    return { schema: SCHEMA, authority: false, context, status: 'observed',
      checks: Object.fromEntries(Object.entries(value.checks).map(([id, { samples, meanMs, failureRate, observedAt }]) =>
        [id, { samples, meanMs, failureRate, observedAt }])) };
  } catch (error) { return empty(error.code === 'ENOENT' ? 'missing' : 'unavailable'); }
}
export function observeCost(state, check, result, now = Date.now()) {
  if (!finite(result.elapsedMs, 0, 900_000) || !finite(now, 0, Number.MAX_SAFE_INTEGER))
    throw new Error('blocked-validation-cost-observation');
  const old = Object.hasOwn(state.checks, check.name) ? state.checks[check.name] : null;
  const failed = result.exitCode !== 0 || Boolean(result.reason);
  const alpha = old ? 0.25 : 1;
  const next = { samples: Math.min(32, (old?.samples ?? 0) + 1),
    meanMs: (old?.meanMs ?? 0) * (1 - alpha) + result.elapsedMs * alpha,
    failureRate: (old?.failureRate ?? 0) * (1 - alpha) + Number(failed) * alpha, observedAt: now };
  state.checks[check.name] = next;
  return old?.samples >= 3 && result.elapsedMs > Math.max(old.meanMs * 2, old.meanMs + 1000)
    ? { check: check.name, previousMeanMs: old.meanMs, observedMs: result.elapsedMs } : null;
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
    checkout: { surface: checkout ?? 'working-tree',
      diffMinimumDepth: checkout === 'pull-request-merge' ? 2 : null,
      automaticFetch: false,
      constraint: 'Depth 2 needs the exact synthetic merge and both event parents; retain full history when owner gates need older revisions. Head, push and merge-group checkouts need a verified merge base.' } };
}
