/** Bounded, portable design adoption checks. No filesystem, network, model or UI effects. */
export const DESIGN_INPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['schema', 'expectedPolicyDigest', 'policy', 'record', 'sources'],
  properties: {
    schema: { const: 'native-design-check/v1' },
    expectedPolicyDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    policy: { type: 'object' }, record: { type: 'object' },
    sources: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object' } },
  },
});
export const DESIGN_LIMITS = Object.freeze({ bytes: 262144, sources: 32, concerns: 32, text: 65536 });
const plain = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const string = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value, expected) => plain(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const encoder = new TextEncoder();

export async function designDigest(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

// Explicit canonical bytes keep policy identity identical in Node and browsers.
export function designPolicyBytes(policy) {
  return JSON.stringify({ schema: policy.schema, id: policy.id, revision: policy.revision,
    requiredConcerns: policy.requiredConcerns });
}

export async function checkDesignContract(input) {
  const findings = [];
  const add = (type, reference, message) => findings.push({ type, reference, message });
  const result = () => ({ schema: 'native-design-result/v1', ok: findings.length === 0,
    scope: 'supplied-source-contract', authority: false, runtimeVerified: false,
    policyDigest: digest(input?.expectedPolicyDigest) ? input.expectedPolicyDigest : null,
    continuityId: string(input?.record?.continuityId) ? input.record.continuityId : null,
    sourceRevision: revision(input?.record?.sourceRevision) ? input.record.sourceRevision : null,
    findings });
  // JSON transport boundary: reject non-JSON objects, accessors, cycles and oversized input.
  const seen = new Set(); let nodes = 0, characters = 0;
  const safe = (value, depth = 0) => {
    if (++nodes > 4096 || depth > 12) return false;
    if (typeof value === 'string') { characters += value.length; return characters <= DESIGN_LIMITS.bytes; }
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value)) || seen.has(value)
      || Array.isArray(value) && (value.length > 1024 || Object.keys(value).length !== value.length)) return false;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length > 1024) return false;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || !safe(descriptor.value, depth + 1)) return false;
    }
    seen.delete(value);
    return true;
  };
  let safeInput = false;
  try { safeInput = safe(input); } catch { /* Hostile proxies are outside the JSON boundary. */ }
  if (!safeInput) return { schema: 'native-design-result/v1', ok: false, scope: 'supplied-source-contract',
    authority: false, runtimeVerified: false, policyDigest: null, continuityId: null, sourceRevision: null,
    findings: [{ type: 'malformed-document', reference: 'input', message: 'Bounded plain JSON required.' }] };
  if (encoder.encode(JSON.stringify(input)).length > DESIGN_LIMITS.bytes
    || !keys(input, ['schema', 'expectedPolicyDigest', 'policy', 'record', 'sources'])
    || input.schema !== 'native-design-check/v1') {
    add('malformed-document', 'input', 'Unknown shape or input budget exceeded.'); return result();
  }
  const policy = input.policy;
  if (!keys(policy, ['schema', 'id', 'revision', 'requiredConcerns']) || policy.schema !== 'native-design-policy/v1'
    || !string(policy.id) || !string(policy.revision) || !Array.isArray(policy.requiredConcerns)
    || policy.requiredConcerns.length < 1 || policy.requiredConcerns.length > DESIGN_LIMITS.concerns
    || !policy.requiredConcerns.every(string) || new Set(policy.requiredConcerns).size !== policy.requiredConcerns.length) {
    add('malformed-document', 'policy', 'Policy identity and unique bounded concerns required.'); return result();
  }
  if (!digest(input.expectedPolicyDigest) || await designDigest(designPolicyBytes(policy)) !== input.expectedPolicyDigest)
    add('stale-evidence', 'policy', 'Policy bytes differ from the caller-pinned digest.');
  const record = input.record;
  if (!keys(record, ['continuityId', 'revision', 'sourceRevision', 'roles', 'concerns'])
    || !string(record.continuityId) || !string(record.revision) || !revision(record.sourceRevision)
    || !keys(record.roles, ['prd', 'tad', 'adr', 'mvp', 'gtm']) || !Array.isArray(record.concerns)
    || record.concerns.length > DESIGN_LIMITS.concerns) {
    add('malformed-document', 'record', 'One joined five-role record and exact source revision required.'); return result();
  }
  for (const [role, value] of Object.entries(record.roles)) if (value !== record.revision)
    add('status-conflict', role, 'Role revision differs from the joined record.');
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > DESIGN_LIMITS.sources) {
    add('malformed-document', 'sources', 'Bounded source bundle required.'); return result();
  }
  const sources = new Map();
  for (const source of input.sources) {
    if (!keys(source, ['id', 'revision', 'sha256', 'text']) || !string(source.id) || !revision(source.revision)
      || !digest(source.sha256) || typeof source.text !== 'string' || encoder.encode(source.text).length > DESIGN_LIMITS.text) {
      add('malformed-document', 'source', 'Source identity, digest and bounded UTF-8 text required.'); continue;
    }
    if (sources.has(source.id)) add('duplicate-owner', source.id, 'Duplicate source identity.');
    sources.set(source.id, source);
    if (await designDigest(source.text) !== source.sha256) add('stale-evidence', source.id, 'Source digest mismatch.');
  }
  const concerns = new Map();
  for (const concern of record.concerns) {
    if (!keys(concern, ['id', 'owner', 'source', 'symbol', 'check']) || !string(concern.id) || !string(concern.owner)
      || !string(concern.source) || !string(concern.symbol) || !string(concern.check)) {
      add('malformed-document', 'concern', 'Concern, owner, source, symbol and named check required.'); continue;
    }
    if (concerns.has(concern.id)) add('duplicate-owner', concern.id, 'One owner per concern required.');
    concerns.set(concern.id, concern);
    const source = sources.get(concern.source);
    if (!source || !source.text.includes(concern.symbol)) add('unresolvable-reference', concern.id, 'Owner symbol absent from supplied source.');
    if (source && source.revision !== record.sourceRevision) add('stale-evidence', concern.id, 'Owner source differs from record source revision.');
    if (!policy.requiredConcerns.includes(concern.id)) add('unguided-artifact', concern.id, 'Concern absent from selected policy.');
  }
  for (const concern of policy.requiredConcerns) if (!concerns.has(concern))
    add('unimplemented-guideline', concern, 'Required design concern has no source-bound owner and check.');
  return result();
}
