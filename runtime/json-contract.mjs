/** Portable JSON and cost-verification contracts; all provider access stays injected. */
export const JSON_LIMITS = Object.freeze({ depth: 32, nodes: 50_000, chars: 1_000_000 });

export function canonicalizeJson(value, path = "value") {
  const seen = new Set();
  let nodes = 0, chars = 0;
  const measure = text => {
    chars += text.length;
    if (chars > JSON_LIMITS.chars) throw new RangeError(`${path} exceeds the JSON character budget.`);
  };
  function visit(source, depth) {
    if (++nodes > JSON_LIMITS.nodes || depth > JSON_LIMITS.depth)
      throw new RangeError(`${path} exceeds the JSON structure budget.`);
    if (typeof source === "string") { measure(source); return source; }
    if (source === null || typeof source === "boolean") return source;
    if (typeof source === "number") {
      if (!Number.isFinite(source)) throw new TypeError(`${path} must contain only finite numbers.`);
      return source;
    }
    if (typeof source !== "object") throw new TypeError(`${path} must be JSON-compatible.`);
    if (seen.has(source)) throw new TypeError(`${path} must not contain cycles.`);
    const array = Array.isArray(source);
    const prototype = Object.getPrototypeOf(source);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new TypeError(`${path} must contain only plain objects.`);
    const keys = Reflect.ownKeys(source);
    const length = array ? Object.getOwnPropertyDescriptor(source, "length").value : keys.length;
    if (length > JSON_LIMITS.nodes - nodes || keys.length > JSON_LIMITS.nodes)
      throw new RangeError(`${path} exceeds the JSON structure budget.`);
    if (array && keys.length !== length + 1) throw new TypeError(`${path} must contain dense arrays.`);
    seen.add(source);
    const result = array ? [] : {};
    const selected = array ? Array.from({ length }, (_, index) => String(index)) : keys.sort();
    for (const key of selected) {
      if (typeof key !== "string") throw new TypeError(`${path} must contain only string keys.`);
      measure(key);
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new TypeError(`${path} must contain data properties, without accessors or sparse arrays.`);
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1),
        enumerable: true, configurable: true, writable: true });
    }
    seen.delete(source);
    return result;
  }
  return visit(value, 0);
}

export function freezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

export function normalizeJson(value, path = "value") {
  return freezeJson(canonicalizeJson(value, path));
}

export function serializedJsonLength(value) {
  return JSON.stringify(value).length;
}

export async function sha256JsonDigest(value) {
  const subtle = globalThis.crypto?.subtle; if (!subtle) throw new TypeError('WebCrypto SHA-256 is unavailable.');
  return Array.from(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalizeJson(value))))), b => b.toString(16).padStart(2, '0')).join('');
}
const COST_SCOPE = 'agentic-os/provider-cost-call-scope/v1', COST_REQUEST = 'agentic-os/provider-cost-verification-request/v1';
const COST_KEYS = 'addOnsActive,autoUpgradeEnabled,billingPlan,evidenceDigest,expiresAt,mode,overagesEnabled,paidPlanActive,provider,providerHardCapUsd,quotaExhaustion,schema,scopeDigest,status,verifiedAt';
export async function verifyProviderCostEvidenceBeforeCall({ provider, effect, resource, request, verifyProviderCostEvidence, now = () => Date.now() } = {}) {
  if ([provider, effect, resource].some(v => typeof v !== 'string' || !v.trim() || v.length > 4096) || !/^[a-z][a-z0-9-]{0,127}$/u.test(effect.trim()) || typeof verifyProviderCostEvidence !== 'function') throw new TypeError('A trusted provider cost evidence verifier is required.');
  const scope = { provider: provider.trim(), effect: effect.trim(), resource: resource.trim(), requestDigest: await sha256JsonDigest(request) };
  const scopeDigest = await sha256JsonDigest({ schema: COST_SCOPE, ...scope }), before = now();
  if (!Number.isSafeInteger(before) || before < 0) throw new TypeError('Provider cost verification clock is invalid.');
  const proof = normalizeJson(await verifyProviderCostEvidence(Object.freeze({ schema: COST_REQUEST, ...scope, scopeDigest, observedAt: new Date(before).toISOString() })), 'provider cost evidence'), after = now();
  const capMode = proof.mode === 'provider-hard-cap' && proof.providerHardCapUsd === 0 && ['free', 'none'].includes(proof.billingPlan) && proof.quotaExhaustion === 'not-applicable';
  const freeMode = proof.mode === 'free-fail-closed' && proof.providerHardCapUsd === null && proof.billingPlan === 'free' && proof.quotaExhaustion === 'deny';
  const localMode = proof.mode === 'non-billable' && proof.providerHardCapUsd === null && proof.billingPlan === 'none' && proof.quotaExhaustion === 'not-applicable';
  if (Object.keys(proof).sort().join(',') !== COST_KEYS || proof.schema !== 'agentic-os/verified-effect-cost-evidence/v1' || proof.status !== 'verified-zero-cost' || !/^[a-f0-9]{64}$/u.test(proof.evidenceDigest ?? '') || !(capMode || freeMode || localMode) || ['paidPlanActive', 'addOnsActive', 'overagesEnabled', 'autoUpgradeEnabled'].some(k => proof[k] !== false)) throw new TypeError('Provider cost evidence is not verified zero cost.');
  const verifiedAt = Date.parse(proof.verifiedAt), expiresAt = Date.parse(proof.expiresAt);
  if (!Number.isSafeInteger(after) || after < before || proof.provider !== scope.provider || proof.scopeDigest !== scopeDigest || !Number.isFinite(verifiedAt) || new Date(verifiedAt).toISOString() !== proof.verifiedAt || !Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !== proof.expiresAt || verifiedAt < before || verifiedAt > after || expiresAt <= after) throw new TypeError('Provider cost evidence does not cover this exact call.');
  return proof;
}
export async function readBoundedJsonResponse(response, maxBytes = 256 * 1024) {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new TypeError('Run endpoint returned a non-JSON response.');
  const reader = response.body?.getReader(); if (!reader) throw new TypeError('Run response body is missing.');
  const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; if ((size += value.byteLength) > maxBytes) throw new RangeError('Run response exceeds its byte bound.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Run response must be an object.');
  return result;
}
