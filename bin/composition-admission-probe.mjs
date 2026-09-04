import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPOSITION_ADMISSION_PROBE_SCHEMA = 'agentic-os/composition-cross-repository-probe/v1';
export const REQUIRED_ADMISSION_CONTRACT = 'commerce.agentic-os-admission-provider/v3';
const FIXTURE_SCHEMA = 'commerce.agentic-os-admission-v2-request-fixture/v1';
const FIXTURE_DIGEST = '3fede7b38f3d8a5004870f31d798cb4218f7d7f59607144ba2fd0b431ac93a61';
const MAX_FIXTURE_BYTES = 65_536;

export async function runCompositionAdmissionProbe({
  acosRoot,
  commerceRoot,
  graphRoot,
  fixturePath,
}) {
  const providerRoot = realpathSync(acosRoot);
  const consumerRoot = realpathSync(commerceRoot);
  realpathSync(graphRoot);
  const fixture = realpathSync(fixturePath);
  const providerContract = readStringConstant(
    providerRoot,
    'agent-api/src/commerce-admission-contract.js',
    'COMMERCE_ADMISSION_PROVIDER_CONTRACT',
  );
  const consumerContract = readStringConstant(
    consumerRoot,
    'src/core/acos-admission.ts',
    'ACOS_ADMISSION_PROVIDER_CONTRACT',
  );
  if (!providerContract || !consumerContract) {
    return report('composition_admission_contract_identity_unreadable', providerContract, consumerContract);
  }
  if (!inside(providerRoot, fixture)) {
    return report('composition_admission_fixture_not_owner_published', providerContract, consumerContract);
  }
  const fixtureBytes = readBoundedRegularFile(fixture);
  if (!fixtureBytes) {
    return report('composition_admission_fixture_size_invalid', providerContract, consumerContract);
  }
  if (createHash('sha256').update(fixtureBytes).digest('hex') !== FIXTURE_DIGEST) {
    return report('composition_admission_fixture_digest_invalid', providerContract, consumerContract);
  }
  let fixtureValue;
  try { fixtureValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fixtureBytes)); } catch {
    return report('composition_admission_fixture_json_invalid', providerContract, consumerContract);
  }
  if (fixtureValue?.$schema !== FIXTURE_SCHEMA) {
    return report('composition_admission_fixture_schema_invalid', providerContract, consumerContract);
  }
  if (!validFixtureShape(fixtureValue)) {
    return report('composition_admission_fixture_shape_invalid', providerContract, consumerContract);
  }
  if (providerContract !== REQUIRED_ADMISSION_CONTRACT) {
    return report('composition_admission_provider_contract_unexpected', providerContract, consumerContract);
  }
  if (consumerContract !== REQUIRED_ADMISSION_CONTRACT) {
    return report('commerce_admission_consumer_migration_required', providerContract, consumerContract);
  }
  return report('composition_admission_probe_reimplementation_required', providerContract, consumerContract);
}

function readBoundedRegularFile(file) {
  let descriptor;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    descriptor = openSync(file, flags);
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > MAX_FIXTURE_BYTES) return null;
    const buffer = Buffer.allocUnsafe(MAX_FIXTURE_BYTES + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const count = readSync(descriptor, buffer, length, buffer.byteLength - length, length);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor);
    if (!after.isFile() || length !== before.size || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino) return null;
    return buffer.subarray(0, length);
  } catch { return null; } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validFixtureShape(value) {
  return Object.keys(value).sort().join(',')
      === '$schema,commerceAgentDefinition,expectedReceiptIdentity,request'
    && value.request?.url === 'https://agentic-os-admission.internal/agentic-os/internal/v2/adapter-registrations'
    && value.request?.method === 'POST'
    && value.request?.headers?.['x-agentic-os-admission-auth-schema']
      === 'commerce-agentic-os-admission-auth/v1'
    && /^[0-9a-f]{64}$/u.test(value.request?.headers?.['x-agentic-os-admission-auth-signature'] ?? '')
    && Object.keys(value.request?.body ?? {}).sort().join(',')
      === 'agent_definition,authoring_mutation_intent,invocation_register_entry,operator_instruction_ref,tool_allowlist_entry'
    && value.expectedReceiptIdentity?.schema === 'agentic-os-adapter-registration/v2';
}

function report(code, providerContract, consumerContract) {
  return Object.freeze({
    schema: COMPOSITION_ADMISSION_PROBE_SCHEMA,
    ok: false,
    code,
    requiredContract: REQUIRED_ADMISSION_CONTRACT,
    providerContract,
    consumerContract,
    runtimeAcceptanceObserved: false,
  });
}

function readStringConstant(root, file, name) {
  let target;
  try { target = realpathSync(path.resolve(root, file)); } catch { return null; }
  if (!inside(root, target)) return null;
  let source;
  try {
    const bytes = readBoundedRegularFile(target);
    if (!bytes) return null;
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(['"])([^'"\\n]+)\\1`, 'u'));
  return match?.[2] ?? null;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

const invoked = process.argv[1] && realpathOrNull(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [acosRoot, commerceRoot, graphRoot, fixturePath, ...extra] = process.argv.slice(2);
  if (extra.length || !acosRoot || !commerceRoot || !graphRoot || !fixturePath) {
    process.stderr.write('composition_admission_probe:arguments_invalid\n');
    process.exitCode = 1;
  } else {
    runCompositionAdmissionProbe({ acosRoot, commerceRoot, graphRoot, fixturePath }).then(
      value => {
        process.stdout.write(`${JSON.stringify(value)}\n`);
        process.exitCode = value.ok ? 0 : 1;
      },
      error => {
        process.stderr.write(`${error instanceof Error ? error.message : 'composition_admission_probe:unknown'}\n`);
        process.exitCode = 1;
      },
    );
  }
}

function realpathOrNull(value) {
  try { return realpathSync(value); } catch { return null; }
}
