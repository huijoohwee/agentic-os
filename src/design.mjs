/** Bounded, portable design adoption checks. No filesystem, network, model or UI effects. */
export const DESIGN_INPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['schema', 'expectedPolicyDigest', 'policy', 'record', 'sources'],
  properties: {
    schema: { const: 'native-design-check/v1' },
    expectedPolicyDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    policy: { type: 'object' }, record: { type: 'object' },
    sources: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object' } },
    reuse: { type: 'object' },
  },
});
export const DESIGN_LIMITS = Object.freeze({ bytes: 262144, sources: 32, concerns: 32, text: 65536, modules: 64, generated: 32 });
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

/** Canonical generation identity after contract validation; source IDs are opaque, never opened. */
export function designGenerationBytes(input, output) {
  const generation = input.reuse.generated.find(item => item.output === output);
  const sources = new Map(input.sources.map(source => [source.id, source]));
  const modules = new Map(input.reuse.modules.map(module => [module.id, module]));
  const binding = id => {
    const source = sources.get(id);
    return { id, revision: source.revision, sha256: source.sha256 };
  };
  const closure = new Set();
  const visit = id => { if (closure.has(id)) return; closure.add(id); modules.get(id).uses.forEach(visit); };
  visit(generation.producer);
  return JSON.stringify({ schema: 'native-design-generation/v1', output, producer: generation.producer,
    modules: [...closure].sort().map(id => {
      const module = modules.get(id);
      return { id, symbol: module.symbol, source: binding(module.source), uses: [...module.uses].sort() };
    }), inputs: [...generation.inputs].sort().map(binding), recipe: binding(generation.recipe) });
}

function cyclic(graph) {
  const active = new Set(), visited = new Set();
  const visit = id => {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    active.add(id);
    if ((graph.get(id) || []).some(visit)) return true;
    active.delete(id); visited.add(id); return false;
  };
  return [...graph.keys()].some(visit);
}

async function checkReuse(input, sources, concerns, add) {
  const reuse = input.reuse;
  const list = (value, maximum) => Array.isArray(value) && value.length <= maximum
    && value.every(string) && new Set(value).size === value.length;
  if (!keys(reuse, ['schema', 'modules', 'generated']) || reuse.schema !== 'native-design-reuse/v1'
    || !Array.isArray(reuse.modules) || !reuse.modules.length || reuse.modules.length > DESIGN_LIMITS.modules
    || !Array.isArray(reuse.generated) || reuse.generated.length > DESIGN_LIMITS.generated) {
    add('malformed-document', 'reuse', 'Bounded modules and generated records required.'); return;
  }
  const modules = new Map(), owners = new Map(), implementations = new Set();
  let invalid = false;
  const fail = (type, reference, message) => { invalid = true; add(type, reference, message); };
  for (const module of reuse.modules) {
    if (!keys(module, ['id', 'source', 'symbol', 'owns', 'uses']) || !string(module.id) || !string(module.source)
      || !string(module.symbol) || !list(module.owns, DESIGN_LIMITS.concerns) || !list(module.uses, DESIGN_LIMITS.modules)) {
      fail('malformed-document', 'reuse.modules', 'Module identity, source, symbol and unique owns/uses lists required.'); continue;
    }
    const implementation = JSON.stringify([module.source, module.symbol]);
    if (modules.has(module.id) || implementations.has(implementation))
      fail('duplicate-owner', module.id, 'One declared module identity per source symbol required.');
    modules.set(module.id, module); implementations.add(implementation);
    const source = sources.get(module.source);
    if (!source || !source.text.includes(module.symbol))
      fail('unresolvable-reference', module.id, 'Module symbol absent from supplied source.');
    for (const id of module.owns) {
      if (owners.has(id)) fail('duplicate-owner', id, 'Declared variants cannot own the same concern.');
      owners.set(id, module);
      const concern = concerns.get(id);
      if (!concern) fail('unguided-artifact', id, 'Module claims a concern absent from the joined record.');
      else if (concern.owner !== module.id || concern.source !== module.source)
        fail('unresolvable-reference', id, 'Reuse owner must match the joined concern owner and source.');
    }
  }
  for (const id of concerns.keys()) if (!owners.has(id))
    fail('unimplemented-guideline', id, 'Declared reuse must bind every joined concern to its canonical module.');
  for (const module of modules.values()) for (const id of module.uses) if (!modules.has(id))
    fail('unresolvable-reference', module.id, 'Used module is absent from the declared graph.');
  if (cyclic(new Map([...modules].map(([id, module]) => [id, module.uses]))))
    fail('malformed-document', 'reuse.modules', 'Declared module dependencies must be acyclic.');
  const generated = new Map(), sourceGraph = new Map();
  for (const generation of reuse.generated) {
    if (!keys(generation, ['output', 'producer', 'inputs', 'recipe', 'inputDigest', 'outputDigest'])
      || !string(generation.output) || !string(generation.producer) || !string(generation.recipe)
      || !list(generation.inputs, DESIGN_LIMITS.sources) || !generation.inputs.length
      || !digest(generation.inputDigest) || !digest(generation.outputDigest)) {
      fail('malformed-document', 'reuse.generated', 'Generation requires output, producer, inputs, recipe and exact digests.'); continue;
    }
    if (generated.has(generation.output)) fail('duplicate-owner', generation.output, 'One producer receipt per declared output required.');
    generated.set(generation.output, generation);
    if (!modules.has(generation.producer) || [generation.output, generation.recipe, ...generation.inputs].some(id => !sources.has(id))) {
      fail('unresolvable-reference', generation.output, 'Generation source or producer absent from supplied evidence.'); continue;
    }
    const dependencies = new Set([generation.recipe, ...generation.inputs]), visited = new Set();
    const collect = id => {
      if (visited.has(id)) return; visited.add(id);
      const module = modules.get(id); if (!module) return;
      dependencies.add(module.source); module.uses.forEach(collect);
    };
    collect(generation.producer); sourceGraph.set(generation.output, [...dependencies]);
    if (sources.get(generation.output).sha256 !== generation.outputDigest)
      fail('stale-evidence', generation.output, 'Generated output differs from its recorded digest.');
  }
  if (cyclic(sourceGraph)) fail('malformed-document', 'reuse.generated', 'Declared generation dependencies must be acyclic.');
  if (invalid) return;
  for (const generation of generated.values()) {
    if (await designDigest(designGenerationBytes(input, generation.output)) !== generation.inputDigest)
      add('stale-evidence', generation.output, 'Producer, dependency, input or recipe bytes differ from the generation receipt.');
  }
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
    || !keys(input, ['schema', 'expectedPolicyDigest', 'policy', 'record', 'sources', ...(plain(input) && Object.hasOwn(input, 'reuse') ? ['reuse'] : [])])
    || input.schema !== 'native-design-check/v1') {
    add('malformed-document', 'input', 'Unknown shape or input budget exceeded.'); return result();
  }
  // Hashing is asynchronous: callers cannot change the checked snapshot while a digest is pending.
  input = JSON.parse(JSON.stringify(input));
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
  if (Object.hasOwn(input, 'reuse')) await checkReuse(input, sources, concerns, add);
  return result();
}
