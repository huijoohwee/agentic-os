import { createHash } from 'node:crypto';
import { compositionRevision, readCompositionHeadFile } from './composition-git.mjs';

export const COMPOSITION_SOURCE_LOCK_SCHEMA = 'agentic-os/composition-source-lock/v1';
const OWNER_IDENTITIES = Object.freeze({
  'agentic-canvas-os': 'huijoohwee/agentic-canvas-os',
  'agentic-commerce-os': 'huijoohwee/agentic-commerce-os',
  'agentic-graph': 'huijoohwee/agentic-graph',
});
const ARTIFACTS = Object.freeze({
  admissionConsumerContract: Object.freeze({ owner: 'agentic-commerce-os',
    path: 'src/core/acos-admission.ts' }),
  admissionConsumerFixture: Object.freeze({ owner: 'agentic-commerce-os',
    path: 'test/contracts/acos-admission-v2.fixture.json' }),
  admissionProviderContract: Object.freeze({ owner: 'agentic-canvas-os',
    path: 'agent-api/src/commerce-admission-contract.js' }),
  admissionProviderFixture: Object.freeze({ owner: 'agentic-canvas-os',
    path: 'test/contracts/agentic-os-admission-v2.fixture.json' }),
  marketplaceConsumerAuthoringHeaders: Object.freeze({ owner: 'agentic-commerce-os',
    path: 'src/core/authoring-mutation-headers.ts' }),
  marketplaceConsumerContract: Object.freeze({ owner: 'agentic-commerce-os',
    path: 'src/core/provider-contract.ts' }),
  marketplaceConsumerResponse: Object.freeze({ owner: 'agentic-commerce-os',
    path: 'src/core/marketplace-provider-response-contract.ts' }),
  marketplaceProviderContract: Object.freeze({ owner: 'agentic-graph',
    path: 'cloudflare/workers/commerce-provider-contract.ts' }),
  marketplaceProviderResponse: Object.freeze({ owner: 'agentic-graph',
    path: 'cloudflare/workers/commerce-marketplace-provider-response-contract.ts' }),
  topologyManifest: Object.freeze({ owner: 'agentic-commerce-os',
    path: 'config/production-core-services.json' }),
});
const OWNER_KEYS = Object.freeze(Object.keys(OWNER_IDENTITIES));
const ARTIFACT_KEYS = Object.freeze(Object.keys(ARTIFACTS));
const CRITICAL_ARTIFACT_BLOBS = Object.freeze({
  admissionConsumerContract: 'a72a94de974bf838bb80e30de6054ac083ace928',
  admissionProviderContract: '4eea00aa24d94a9f7b8f12c11570b2fbd9f99d5e',
  marketplaceConsumerAuthoringHeaders: 'd20e82752cd51964c4e84581133c8d1290341057',
  marketplaceConsumerContract: 'ec5ab0be2614ccc2d31c3f6c3df0980d7e3136e5',
  marketplaceConsumerResponse: '7f7f47f98f78da691c0ae3c18fda9c6e7c178d98',
  marketplaceProviderContract: 'f6bc758335d411a8279553ce2ff77513ab9f2838',
  marketplaceProviderResponse: '7f7f47f98f78da691c0ae3c18fda9c6e7c178d98',
});
const INSPECTION_FAILURE_CODES = Object.freeze([
  'composition_source_lock_unreadable', 'composition_source_lock_noncanonical',
  'composition_source_lock_shape_invalid', 'composition_source_lock_identity_mismatch',
  'composition_source_lock_artifact_mismatch',
  'composition_source_lock_topology_digest_mismatch', 'composition_source_lock_component_changed',
]);
const AUTHORING_HEADER_FIELDS = Object.freeze([
  ['schema', 'x-authoring-mutation-contract'], ['mutationId', 'x-authoring-mutation-id'],
  ['operationId', 'x-authoring-operation-id'], ['requestDigest', 'x-authoring-request-digest'],
  ['mutationSequence', 'x-authoring-mutation-sequence'],
  ['semanticScope', 'x-authoring-semantic-scope'], ['claimId', 'x-authoring-claim-id'],
  ['leaseEpoch', 'x-authoring-lease-epoch'],
  ['leaseExpiresAtMs', 'x-authoring-lease-expires-at-ms'],
  ['fenceRevision', 'x-authoring-fence-revision'],
  ['requiredWriteTarget', 'x-authoring-write-target'],
  ['reservedAtMs', 'x-authoring-reserved-at-ms'],
].map(entry => Object.freeze(entry)));
const AUTHORING_HEADERS = Object.freeze(AUTHORING_HEADER_FIELDS.map(([, value]) => value));

export function inspectCompositionSourceLock(roots, components) {
  let lock;
  try { lock = readCompositionHeadFile(roots?.['agentic-os'], components?.['agentic-os']?.revision,
    'catalog/composition-source-lock.json', 65_536, 'composition source lock'); }
  catch { return failure('composition_source_lock_unreadable'); }
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(lock.bytes);
    value = JSON.parse(text);
    if (text !== `${JSON.stringify(sortJson(value), null, 2)}\n`) {
      return failure('composition_source_lock_noncanonical');
    }
  } catch { return failure('composition_source_lock_unreadable'); }
  if (!validCompositionSourceLock(value)) return failure('composition_source_lock_shape_invalid');
  for (const owner of OWNER_KEYS) {
    const expected = value.owners[owner], observed = components?.[owner];
    if (expected.repository !== OWNER_IDENTITIES[owner]
      || expected.revision !== observed?.revision || expected.tree !== observed?.tree
      || observed?.repositoryIdentity !== OWNER_IDENTITIES[owner]) {
      return failure('composition_source_lock_identity_mismatch');
    }
  }
  const observedArtifacts = {};
  try {
    for (const key of ARTIFACT_KEYS) {
      const artifact = ARTIFACTS[key];
      const observed = readCompositionHeadFile(roots?.[artifact.owner],
        components?.[artifact.owner]?.revision, artifact.path, 500_000,
        'composition source lock artifact');
      if (observed.oid !== value.artifacts[key].blob) throw new Error('blob mismatch');
      observedArtifacts[key] = observed;
    }
  } catch { return failure('composition_source_lock_artifact_mismatch'); }
  const topology = observedArtifacts.topologyManifest;
  if (topology.oid !== value.topology.manifestBlob
    || sha256(topology.bytes) !== value.topology.manifestSha256) {
    return failure('composition_source_lock_topology_digest_mismatch');
  }
  for (const owner of ['agentic-os', ...OWNER_KEYS]) {
    if (compositionRevision(roots?.[owner]) !== components?.[owner]?.revision) {
      return failure('composition_source_lock_component_changed');
    }
  }
  return Object.freeze({
    schema: COMPOSITION_SOURCE_LOCK_SCHEMA, ok: true, candidateCodeExecuted: false,
    ownerTreesMatched: true, artifactBlobsMatched: true,
    admissionFixtureDigest: value.admission.fixtureSha256,
    marketplaceContract: value.marketplace.contract,
    topologyManifestDigest: value.topology.manifestSha256,
    topologyManifestBlob: value.topology.manifestBlob,
    lockDigest: sha256(lock.bytes),
  });
}

export function executeCompositionSourceLock(inspector, roots, components) {
  if (inspector !== inspectCompositionSourceLock) {
    return failure('composition_source_lock_report_invalid');
  }
  try {
    const report = inspector(roots, components);
    return validCompositionSourceLockReport(report) || validCompositionSourceLockFailure(report)
      ? Object.freeze(report) : failure('composition_source_lock_report_invalid');
  } catch { return failure('composition_source_lock_inspection_failed'); }
}

export function validCompositionSourceLockReport(value) {
  return exactKeys(value, ['admissionFixtureDigest', 'artifactBlobsMatched',
    'candidateCodeExecuted', 'lockDigest', 'marketplaceContract', 'ok', 'ownerTreesMatched',
    'schema', 'topologyManifestBlob', 'topologyManifestDigest'])
    && value.schema === COMPOSITION_SOURCE_LOCK_SCHEMA && value.ok === true
    && value.candidateCodeExecuted === false && value.ownerTreesMatched === true
    && value.artifactBlobsMatched === true
    && value.admissionFixtureDigest
      === 'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0'
    && value.marketplaceContract === 'commerce.marketplace-provider/v1'
    && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.topologyManifestBlob ?? '')
    && /^[0-9a-f]{64}$/u.test(value.topologyManifestDigest ?? '')
    && /^[0-9a-f]{64}$/u.test(value.lockDigest ?? '');
}
function validCompositionSourceLockFailure(value) {
  return exactKeys(value, ['code', 'ok', 'schema'])
    && value.schema === COMPOSITION_SOURCE_LOCK_SCHEMA && value.ok === false
    && INSPECTION_FAILURE_CODES.includes(value.code);
}

export function validCompositionSourceLock(value) {
  if (!exactKeys(value, ['admission', 'artifacts', 'marketplace', 'owners', 'schema', 'topology'])
    || value.schema !== COMPOSITION_SOURCE_LOCK_SCHEMA
    || !exactKeys(value.admission, ['contract', 'fixtureSchema', 'fixtureSha256',
      'servingIdentityHeader', 'storedEffectWriterIdentitySchema'])
    || value.admission.contract !== 'commerce.agentic-os-admission-provider/v3'
    || value.admission.fixtureSchema !== 'commerce.agentic-os-admission-v2-request-fixture/v1'
    || value.admission.fixtureSha256
      !== 'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0'
    || value.admission.servingIdentityHeader !== 'x-agentic-os-serving-deployment-identity'
    || value.admission.storedEffectWriterIdentitySchema !== 'acos-cloudflare-deployment-identity/v1'
    || !exactKeys(value.marketplace, ['authoringHeaders', 'contract', 'responseSchema'])
    || value.marketplace.contract !== 'commerce.marketplace-provider/v1'
    || value.marketplace.responseSchema !== 'commerce.marketplace-provider-response/v1'
    || JSON.stringify(value.marketplace.authoringHeaders) !== JSON.stringify(AUTHORING_HEADERS)
    || value.artifacts?.marketplaceConsumerResponse?.blob
      !== value.artifacts?.marketplaceProviderResponse?.blob
    || !Object.entries(CRITICAL_ARTIFACT_BLOBS)
      .every(([key, blob]) => value.artifacts?.[key]?.blob === blob)
    || !exactKeys(value.owners, OWNER_KEYS) || !exactKeys(value.artifacts, ARTIFACT_KEYS)
    || !exactKeys(value.topology, ['manifestBlob', 'manifestPath', 'manifestSha256'])
    || value.topology.manifestPath !== ARTIFACTS.topologyManifest.path
    || value.topology.manifestBlob !== value.artifacts.topologyManifest?.blob
    || !oid(value.topology.manifestBlob) || !/^[0-9a-f]{64}$/u.test(value.topology.manifestSha256 ?? '')) {
    return false;
  }
  return OWNER_KEYS.every(owner => exactKeys(value.owners[owner], ['repository', 'revision', 'tree'])
      && value.owners[owner].repository === OWNER_IDENTITIES[owner]
      && /^[0-9a-f]{40}$/u.test(value.owners[owner].revision ?? '')
      && oid(value.owners[owner].tree))
    && ARTIFACT_KEYS.every(key => exactKeys(value.artifacts[key], ['blob', 'owner', 'path'])
      && value.artifacts[key].owner === ARTIFACTS[key].owner
      && value.artifacts[key].path === ARTIFACTS[key].path && oid(value.artifacts[key].blob));
}
function failure(code) { return Object.freeze({
  schema: COMPOSITION_SOURCE_LOCK_SCHEMA, ok: false, code,
}); }
function sortJson(value) { return Array.isArray(value) ? value.map(sortJson)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])])) : value; }
function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(), sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}
function oid(value) { return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value ?? ''); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
