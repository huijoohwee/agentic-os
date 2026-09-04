import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compositionOriginUrl, compositionRevision, observeCompositionGit,
  readCompositionHeadFile } from './composition-git.mjs';

export const COMPOSITION_ADMISSION_PROBE_SCHEMA =
  'agentic-os/composition-static-admission-interface/v1';
export const REQUIRED_ADMISSION_CONTRACT = 'commerce.agentic-os-admission-provider/v3';
export const REQUIRED_FIXTURE_SCHEMA =
  'commerce.agentic-os-admission-v2-request-fixture/v1';
export const REQUIRED_FIXTURE_DIGEST =
  'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0';
const PROVIDER_FIXTURE = 'test/contracts/agentic-os-admission-v2.fixture.json';
const CONSUMER_FIXTURE = 'test/contracts/acos-admission-v2.fixture.json';
const MAX_FIXTURE_BYTES = 65_536;
const SUCCESS_KEYS = Object.freeze([
  'consumerContractBlob', 'consumerFixtureBlob', 'effectWriterIdentitySchema', 'fixtureDigest',
  'fixtureSchema', 'governingContract', 'ok', 'providerContractBlob', 'providerFixtureBlob',
  'schema', 'servingIdentityHeader', 'sourceArtifactsBound', 'staticInterfaceObserved',
]);
const FAILURE_CODES = Object.freeze([
  'composition_admission_arguments_invalid', 'composition_admission_artifact_bytes_unbound',
  'composition_admission_artifact_unreadable', 'composition_admission_artifact_untracked',
  'composition_admission_consumer_fixture_invalid',
  'composition_admission_fixture_digest_invalid', 'composition_admission_fixture_json_invalid',
  'composition_admission_fixture_not_owner_published', 'composition_admission_fixture_shape_invalid',
  'composition_admission_fixture_unreadable', 'composition_admission_owner_changed',
  'composition_admission_owner_root_invalid',
]);

/** Compare index-bound owner artifacts without evaluating either owner's code. */
export function runCompositionAdmissionProbe({
  acosRoot, commerceRoot, fixturePath, acosRevision = null, commerceRevision = null,
} = {}) {
  let provider, consumer;
  try { provider = exactRoot(acosRoot, 'huijoohwee/agentic-canvas-os', acosRevision); }
  catch { return failure('composition_admission_owner_root_invalid', 'agentic-canvas-os', null); }
  try { consumer = exactRoot(commerceRoot, 'huijoohwee/agentic-commerce-os', commerceRevision); }
  catch { return failure('composition_admission_owner_root_invalid', 'agentic-commerce-os', null); }
  const providerRoot = provider.root, consumerRoot = consumer.root;
  const providerRelative = fixturePath
    ? relativeOwnerPath(providerRoot, fixturePath) : PROVIDER_FIXTURE;
  if (providerRelative !== PROVIDER_FIXTURE) {
    return failure('composition_admission_fixture_not_owner_published', 'agentic-canvas-os',
      PROVIDER_FIXTURE);
  }
  let providerFixture, consumerFixture;
  try { providerFixture = trackedFile(providerRoot, provider.revision,
    PROVIDER_FIXTURE, MAX_FIXTURE_BYTES, 'fixture'); }
  catch (error) { return failure(error.code ?? 'composition_admission_fixture_unreadable',
    'agentic-canvas-os', PROVIDER_FIXTURE); }
  try { consumerFixture = trackedFile(consumerRoot, consumer.revision,
    CONSUMER_FIXTURE, MAX_FIXTURE_BYTES, 'fixture'); }
  catch (error) { return failure(error.code ?? 'composition_admission_fixture_unreadable',
    'agentic-commerce-os', CONSUMER_FIXTURE); }
  if (!providerFixture.bytes.equals(consumerFixture.bytes)) {
    return failure('composition_admission_consumer_fixture_invalid', 'agentic-commerce-os',
      CONSUMER_FIXTURE);
  }
  const fixtureDigest = sha256(providerFixture.bytes);
  if (fixtureDigest !== REQUIRED_FIXTURE_DIGEST) {
    return failure('composition_admission_fixture_digest_invalid', 'agentic-canvas-os', PROVIDER_FIXTURE);
  }
  let fixture;
  try {
    fixture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(providerFixture.bytes));
  } catch { return failure('composition_admission_fixture_json_invalid', 'agentic-canvas-os',
    PROVIDER_FIXTURE); }
  if (!validFixture(fixture)) return failure('composition_admission_fixture_shape_invalid',
    'agentic-canvas-os', PROVIDER_FIXTURE);
  let providerContract, consumerContract;
  try { providerContract = trackedFile(providerRoot, provider.revision,
    'agent-api/src/commerce-admission-contract.js', 500_000, 'artifact'); }
  catch (error) { return failure(error.code ?? 'composition_admission_artifact_untracked',
    'agentic-canvas-os', 'agent-api/src/commerce-admission-contract.js'); }
  try { consumerContract = trackedFile(consumerRoot, consumer.revision,
    'src/core/acos-admission.ts', 500_000, 'artifact'); }
  catch (error) { return failure(error.code ?? 'composition_admission_artifact_untracked',
    'agentic-commerce-os', 'src/core/acos-admission.ts'); }
  if (compositionRevision(providerRoot) !== provider.revision) {
    return failure('composition_admission_owner_changed', 'agentic-canvas-os', null);
  }
  if (compositionRevision(consumerRoot) !== consumer.revision) {
    return failure('composition_admission_owner_changed', 'agentic-commerce-os', null);
  }
  return Object.freeze({
    schema: COMPOSITION_ADMISSION_PROBE_SCHEMA,
    ok: true,
    staticInterfaceObserved: true,
    sourceArtifactsBound: true,
    fixtureSchema: fixture.$schema,
    fixtureDigest,
    providerFixtureBlob: providerFixture.oid,
    consumerFixtureBlob: consumerFixture.oid,
    governingContract: REQUIRED_ADMISSION_CONTRACT,
    providerContractBlob: providerContract.oid,
    consumerContractBlob: consumerContract.oid,
    effectWriterIdentitySchema: fixture.expectedReceiptIdentity.deployment_identity.schema,
    servingIdentityHeader: 'x-agentic-os-serving-deployment-identity',
  });
}

export function isValidCompositionAdmissionInterfaceReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.ok === false) return exactKeys(value,
    ['code', 'file', 'ok', 'owner', 'schema', 'staticInterfaceObserved'])
    && value.schema === COMPOSITION_ADMISSION_PROBE_SCHEMA
    && value.staticInterfaceObserved === false && FAILURE_CODES.includes(value.code)
    && validFailureTarget(value.owner, value.file);
  if (value.ok !== true || !exactKeys(value, SUCCESS_KEYS)) return false;
  return value.schema === COMPOSITION_ADMISSION_PROBE_SCHEMA
    && value.staticInterfaceObserved === true
    && value.sourceArtifactsBound === true
    && value.fixtureSchema === REQUIRED_FIXTURE_SCHEMA
    && value.fixtureDigest === REQUIRED_FIXTURE_DIGEST
    && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.providerFixtureBlob)
    && value.consumerFixtureBlob === value.providerFixtureBlob
    && value.governingContract === REQUIRED_ADMISSION_CONTRACT
    && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.providerContractBlob)
    && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.consumerContractBlob)
    && value.effectWriterIdentitySchema === 'acos-cloudflare-deployment-identity/v1'
    && value.servingIdentityHeader === 'x-agentic-os-serving-deployment-identity';
}

function validFixture(value) {
  if (!exactKeys(value, ['$schema', 'commerceAgentDefinition', 'expectedReceiptIdentity', 'request'])
    || value.$schema !== REQUIRED_FIXTURE_SCHEMA) return false;
  const request = value.request, receipt = value.expectedReceiptIdentity;
  return exactKeys(request, ['body', 'headers', 'method', 'url'])
    && request.url === 'https://agentic-os-admission.internal/agentic-os/internal/v2/adapter-registrations'
    && request.method === 'POST'
    && request.headers?.['x-agentic-os-admission-auth-schema']
      === 'commerce-agentic-os-admission-auth/v1'
    && /^[0-9a-f]{64}$/u.test(request.headers?.['x-agentic-os-admission-auth-signature'] ?? '')
    && exactKeys(request.body, ['agent_definition', 'authoring_mutation_intent',
      'invocation_register_entry', 'operator_instruction_ref', 'tool_allowlist_entry'])
    && receipt?.schema === 'agentic-os-adapter-registration/v2'
    && receipt?.agentic_graph_authority?.schema
      === 'agentic-graph-commerce-admission-authority-projection/v1'
    && receipt?.deployment_identity?.schema === 'acos-cloudflare-deployment-identity/v1';
}

function exactRoot(value, expectedIdentity, expectedRevision) {
  if (typeof value !== 'string' || value === '') throw new TypeError('root invalid');
  const root = realpathSync(value);
  if (!lstatSync(root).isDirectory()) throw new TypeError('root invalid');
  const top = observeCompositionGit(['rev-parse', '--show-toplevel'], {
    cwd: root, allowFail: true,
  });
  const origin = normalizeRepositoryIdentity(compositionOriginUrl(root));
  const revision = compositionRevision(root);
  if (!top || realpathSync(top) !== root || origin !== expectedIdentity) {
    throw new TypeError('root invalid');
  }
  if (revision === null || expectedRevision !== null && revision !== expectedRevision) {
    throw new TypeError('root invalid');
  }
  return Object.freeze({ root, revision });
}

function relativeOwnerPath(root, value) {
  try {
    const target = realpathSync(value), relative = path.relative(root, target);
    return inside(root, target) ? relative.split(path.sep).join('/') : null;
  } catch { return null; }
}

function trackedFile(root, revision, relative, maximum, kind) {
  try { return readCompositionHeadFile(
    root, revision, relative, maximum, 'composition admission artifact',
  ); }
  catch (error) {
    if (error?.code === 'composition_head_file_untracked') {
      throw coded('composition_admission_artifact_untracked');
    }
    if (error?.code === 'composition_head_file_bytes_unbound') {
      throw coded('composition_admission_artifact_bytes_unbound');
    }
    throw coded(kind === 'fixture' ? 'composition_admission_fixture_unreadable'
      : 'composition_admission_artifact_unreadable');
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(), sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}
function inside(root, target) { const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function coded(code) { return Object.assign(new Error(code), { code }); }
function normalizeRepositoryIdentity(value) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') return null;
  const scp = value.match(/^(?:[^@/\s:]+@)?github\.com:([^\s]+)$/iu);
  let repository = scp?.[1] ?? null;
  if (repository === null) {
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)
      || parsed.hostname.toLowerCase() !== 'github.com' || parsed.port !== ''
      || parsed.search !== '' || parsed.hash !== '') return null;
    repository = parsed.pathname.replace(/^\//u, '');
  }
  const parts = repository.replace(/\.git$/iu, '').split('/');
  return parts.length === 2 && parts.every(part => /^[A-Za-z0-9_.-]+$/u.test(part))
    ? `${parts[0]}/${parts[1]}`.toLowerCase() : null;
}
function validFailureTarget(owner, file) {
  const targets = {
    'agentic-os': [null, 'bin/composition-admission-probe.mjs'],
    'agentic-canvas-os': [null, PROVIDER_FIXTURE,
      'agent-api/src/commerce-admission-contract.js'],
    'agentic-commerce-os': [null, CONSUMER_FIXTURE, 'src/core/acos-admission.ts'],
  };
  return targets[owner]?.includes(file) === true;
}
function failure(code, owner = 'agentic-os', file = null) { return Object.freeze({
  schema: COMPOSITION_ADMISSION_PROBE_SCHEMA, ok: false, code, owner, file,
  staticInterfaceObserved: false,
}); }

function realpathOrNull(value) { try { return realpathSync(value); } catch { return null; } }
const invoked = process.argv[1] && realpathOrNull(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [acosRoot, commerceRoot, fixturePath, ...extra] = process.argv.slice(2);
  const value = extra.length || !acosRoot || !commerceRoot
    ? failure('composition_admission_arguments_invalid')
    : runCompositionAdmissionProbe({ acosRoot, commerceRoot, fixturePath });
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = value.ok ? 0 : 1;
}
