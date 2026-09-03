import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMPOSITION_ADMISSION_PROBE_SCHEMA = 'agentic-os/composition-cross-repository-probe/v1';
const FIXTURE_SCHEMA = 'commerce.acos-admission-v2-request-fixture/v1';
const FIXTURE_DIGEST = '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44';
const MAX_FIXTURE_BYTES = 65_536;

export async function runCompositionAdmissionProbe({ acosRoot, commerceRoot, graphRoot, fixturePath }) {
  const root = realpathSync(acosRoot);
  const consumerRoot = realpathSync(commerceRoot);
  const marketplaceRoot = realpathSync(graphRoot);
  const fixtureTarget = realpathSync(fixturePath);
  exact(inside(consumerRoot, fixtureTarget), 'fixture_path_escaped');
  const bytes = readFileSync(fixtureTarget);
  exact(bytes.byteLength > 0 && bytes.byteLength <= MAX_FIXTURE_BYTES, 'fixture_size_invalid');
  const fixtureDigest = createHash('sha256').update(bytes).digest('hex');
  exact(fixtureDigest === FIXTURE_DIGEST, 'fixture_digest_invalid');
  const fixture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  validateFixture(fixture);

  const adapter = await load(root, 'agent-api/src/adapter-registration.js');
  const contract = await load(root, 'agent-api/src/commerce-admission-contract.js');
  const providerModule = await load(root, 'agent-api/src/commerce-admission-provider.js');
  const definitions = await load(root, 'agent-api/src/agent-definitions.js');
  const durable = await load(root, 'agent-api/src/durable-object-state-store.js');
  const worker = await load(root, 'worker/agent-state.js');
  const consumer = await load(consumerRoot, 'src/core/acos-admission.ts');
  const authenticationSecret = 'acos-admission-dev-secret-rotate-before-production';
  const projectedDefinition = consumer.projectCommerceAgentDefinitionForAcos(
    fixture.commerceAgentDefinition,
  );
  exact(projectedDefinition && canonical(projectedDefinition)
    === canonical(fixture.request.body.agent_definition), 'consumer_production_projection_mismatch');
  exact(canonical(fixture.request.body.authoring_mutation_intent.admissionInputs.agentDefinition)
    === canonical(projectedDefinition), 'consumer_intent_projection_mismatch');
  const namespace = createNamespace(worker.AgentState);
  const nowMs = Number(fixture.request.headers['x-authoring-reserved-at-ms']) + 1;
  const deploymentIdentity = fixture.expectedReceiptIdentity.deployment_identity;
  const deploymentPin = Object.freeze({
    sourceRevision: deploymentIdentity.sourceRevision,
    candidateDigest: deploymentIdentity.candidateDigest,
  });
  const createRuntime = () => {
    const registry = definitions.createAgentDefinitionRegistry();
    const resolver = providerModule.createCommerceOperatorInstructionResolver(
      contract.COMMERCE_ADMISSION_OPERATOR_INSTRUCTION_REF,
    );
    const registrationInterface = adapter.createAdapterRegistrationInterface({
      agentDefinitionRegistry: registry,
      toolAllowlist: providerModule.createCommerceToolAllowlistProjection(),
      invocationRegister: providerModule.createCommerceInvocationRegister(),
      resolveOperatorInstruction: resolver.resolveOperatorInstruction,
      now: () => nowMs,
    });
    return providerModule.createCommerceAdmissionProvider({
      store: durable.createDurableObjectCommerceAdmissionStore({ namespace }),
      registrationInterface,
      deploymentIdentity,
      authSecret: authenticationSecret,
      now: () => nowMs,
    });
  };

  const inputs = admissionInputs(fixture.request.body);
  const intent = fixture.request.body.authoring_mutation_intent;
  const permit = permitFromHeaders(fixture.request.headers);
  const provider = createRuntime();
  const firstCapture = {};
  const first = await consumer.requestAcosAdmission(
    capturingBinding(provider, fixture, firstCapture), inputs, intent, permit, deploymentPin,
    authenticationSecret,
  );
  exact(first.ok === true, 'consumer_rejected_provider_response');
  exactReceipt(first.receipt, fixture.expectedReceiptIdentity);
  await assertConsumerRejectsExtraKeys(
    consumer, inputs, intent, permit, deploymentPin, authenticationSecret, fixture, firstCapture.text,
  );
  const writesAfterFirst = namespace.writes();
  exact(writesAfterFirst > 0, 'provider_effect_missing');

  namespace.restart();
  const restarted = createRuntime();
  const ready = await consumer.probeAcosAdmission(Object.freeze({
    fetch: request => restarted.handle(request),
  }), deploymentPin, authenticationSecret);
  exact(ready.ok === true, 'provider_restart_not_ready');
  exact(canonical(ready.deploymentIdentity) === canonical(deploymentIdentity),
    'provider_ready_deployment_identity_mismatch');
  const writesBeforeReplay = namespace.writes();
  const replayCapture = {};
  const replay = await consumer.requestAcosAdmission(
    capturingBinding(restarted, fixture, replayCapture), inputs, intent, permit, deploymentPin,
    authenticationSecret,
  );
  exact(replay.ok === true, 'consumer_rejected_provider_replay');
  exact(canonical(replay.receipt) === canonical(first.receipt), 'provider_replay_receipt_mismatch');
  exact(replayCapture.text === firstCapture.text, 'provider_replay_bytes_mismatch');
  exact(namespace.writes() === writesBeforeReplay, 'provider_replay_wrote_state');
  const marketplace = await probeMarketplaceJoin(consumerRoot, marketplaceRoot);

  return Object.freeze({
    schema: COMPOSITION_ADMISSION_PROBE_SCHEMA,
    ok: true,
    fixtureSchema: FIXTURE_SCHEMA,
    fixtureDigest,
    providerContract: contract.COMMERCE_ADMISSION_PROVIDER_CONTRACT,
    consumerContract: consumer.ACOS_ADMISSION_PROVIDER_CONTRACT,
    consumerValidated: true,
    productionProjectionValidated: true,
    admissionAuthenticationValidated: true,
    extraKeyDriftRejected: true,
    deploymentIdentityValidated: true,
    receiptSchema: fixture.expectedReceiptIdentity.schema,
    requestDigest: fixture.request.headers['x-authoring-request-digest'],
    firstWriteCount: writesAfterFirst,
    replayWriteCount: 0,
    restartReady: true,
    ...marketplace,
  });
}

async function probeMarketplaceJoin(commerceRoot, graphRoot) {
  const producer = await load(commerceRoot, 'src/core/marketplace-transition-request.ts');
  const commerceHeaders = await load(commerceRoot, 'src/core/authoring-mutation-headers.ts');
  const commerceResponse = await load(commerceRoot, 'src/core/marketplace-provider-response-contract.ts');
  const graph = await load(graphRoot, 'cloudflare/workers/commerce-provider-contract.ts');
  const graphAuth = await load(graphRoot, 'cloudflare/workers/commerce-provider-auth.ts');
  const graphResponse = await load(
    graphRoot, 'cloudflare/workers/commerce-marketplace-provider-response-contract.ts',
  );
  const providerEnv = Object.freeze({
    COMMERCE_PROVIDER_SOURCE_REVISION: '1234567890abcdef1234567890abcdef12345678',
    COMMERCE_PROVIDER_STORAGE_REVISION: 'marketplace-d1-0017',
    COMMERCE_PROVIDER_VERSION_ID: 'cross-repo-v1',
  });
  const pin = await graph.runtimeEvidencePin(providerEnv, graph.MARKETPLACE_EVIDENCE_CHECKS);
  exact(pin, 'marketplace_evidence_pin_invalid');
  const secret = 'cross-repo-marketplace-provider-secret';
  const actorId = 'operator-cross-repo';
  const vendorId = 'agent-flight';
  const state = 'suspended';
  const semanticScope = `vendor:${vendorId}`;
  const requestDigest = await graph.sha256Hex(graph.canonicalJson({
    schema: 'agentic-graph-authoring-operation/v1',
    semanticScope,
    writeTarget: semanticScope,
    payload: { vendorId, actorId, state },
  }));
  const reservedAtMs = Date.now();
  const permit = Object.freeze({
    schema: 'agentic-graph-authoring-mutation-permit/v2',
    mutationId: `mutation:17:1:${requestDigest.slice(0, 32)}`,
    operationId: `operation:${requestDigest}`,
    requestDigest,
    mutationSequence: 1,
    semanticScope,
    claimId: 'claim-cross-repo-v17',
    leaseEpoch: 17,
    leaseExpiresAtMs: reservedAtMs + 60_000,
    fenceRevision: 'fence-cross-repo-v17',
    requiredWriteTarget: semanticScope,
    reservedAtMs,
  });
  let controlAuthenticationValidated = false;
  const env = Object.freeze({
    MARKETPLACE_PROVIDER: Object.freeze({
      async fetch(request) {
        controlAuthenticationValidated = await graphAuth.verifyCommerceProviderControlRequest(
          request, graph.MARKETPLACE_PROVIDER_CONTRACT, secret,
        );
        exact(controlAuthenticationValidated, 'marketplace_control_authentication_invalid');
        return graph.runtimeEvidenceResponse(
          providerEnv, graph.MARKETPLACE_PROVIDER_CONTRACT, graph.MARKETPLACE_EVIDENCE_CHECKS,
        );
      },
    }),
    MARKETPLACE_PROVIDER_EVIDENCE_PIN_JSON: JSON.stringify(pin),
    MARKETPLACE_PROVIDER_AUTH_SECRET: secret,
  });
  const produced = await producer.prepareAuthenticatedMarketplaceVendorTransitionRequest(
    env, { vendorId, actorId, state, permit },
  );
  exact(produced?.ok === true, 'marketplace_producer_rejected_vector');
  const tamperSource = produced.request.clone();
  const consumed = await graph.readBoundProviderRequest(
    produced.request, providerEnv, graph.MARKETPLACE_EVIDENCE_CHECKS,
  );
  exact(consumed, 'marketplace_consumer_rejected_vector');
  const operationAuthenticationValidated = await graphAuth.verifyCommerceProviderRequestAuthentication(
    consumed.request,
    {
      contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
      requestDigest: consumed.binding.requestDigest,
      bindingDigest: consumed.binding.bindingDigest,
    },
    secret,
  );
  exact(operationAuthenticationValidated, 'marketplace_operation_authentication_invalid');
  const graphHeaderNames = [...graph.AUTHORING_MUTATION_HEADER_NAMES];
  const commerceHeaderNames = [...commerceHeaders.AUTHORING_MUTATION_HEADER_NAMES];
  exact(graphHeaderNames.length === 12
    && canonical(graphHeaderNames) === canonical(commerceHeaderNames),
  'marketplace_authoring_header_grammar_mismatch');
  const expectedHeaders = commerceHeaders.authoringMutationHeaders(permit);
  exact(Object.entries(expectedHeaders).every(([name, value]) => consumed.request.headers.get(name) === value),
    'marketplace_authoring_header_value_mismatch');
  exactResponseContract(commerceResponse, graphResponse);
  const tamperedHeaders = new Headers(tamperSource.headers);
  tamperedHeaders.set('x-authoring-lease-epoch', '18');
  const tampered = await graph.readBoundProviderRequest(
    new Request(tamperSource, { headers: tamperedHeaders }),
    providerEnv,
    graph.MARKETPLACE_EVIDENCE_CHECKS,
  );
  exact(tampered === null, 'marketplace_post_signature_tamper_accepted');
  return Object.freeze({
    marketplaceContract: graph.MARKETPLACE_PROVIDER_CONTRACT,
    marketplaceProducerConsumerValidated: true,
    marketplaceControlAuthenticationValidated: controlAuthenticationValidated,
    marketplaceOperationAuthenticationValidated: operationAuthenticationValidated,
    marketplaceAuthoringHeaderCount: graphHeaderNames.length,
    marketplaceResponseContractValidated: true,
    marketplaceTamperRejected: true,
    marketplaceRequestDigest: consumed.binding.requestDigest,
    marketplaceBindingDigest: consumed.binding.bindingDigest,
  });
}

function exactResponseContract(commerce, graph) {
  for (const name of [
    'MARKETPLACE_PROVIDER_RESPONSE_SCHEMA',
    'MARKETPLACE_VENDOR_STATES',
    'MARKETPLACE_TERMINAL_409_CODES',
    'MARKETPLACE_RECOVERY_409_CODES',
    'MARKETPLACE_PROVIDER_RESPONSE_KEYS',
  ]) exact(canonical(commerce[name]) === canonical(graph[name]), `marketplace_response_${name}_mismatch`);
}

async function load(root, relative) {
  const target = path.resolve(root, relative);
  exact(inside(root, target), 'module_path_escaped');
  return import(pathToFileURL(target).href);
}

function createNamespace(AgentState) {
  const instances = new Map();
  const storages = new Map();
  function instance(id) {
    if (!storages.has(id)) storages.set(id, new MemoryStorage());
    if (!instances.has(id)) instances.set(id, new AgentState({ storage: storages.get(id) }));
    return instances.get(id);
  }
  return Object.freeze({
    idFromName: name => name,
    get: id => Object.freeze({
      fetch: (input, init) => instance(id).fetch(input instanceof Request ? input : new Request(input, init)),
    }),
    restart: () => instances.clear(),
    writes: () => [...storages.values()].reduce((total, storage) => total + storage.writes, 0),
  });
}

class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
    this.writes = 0;
  }

  async transaction(operation) {
    const result = this.transactionTail.then(() => operation(this));
    this.transactionTail = result.catch(() => {});
    return result;
  }

  async get(key) { return this.records.get(key); }
  async put(key, value) { this.writes += 1; this.records.set(key, structuredClone(value)); }
  async delete(key) { this.writes += 1; return this.records.delete(key); }
  async getAlarm() { return null; }
  async setAlarm() { this.writes += 1; }
  async deleteAlarm() { this.writes += 1; }
}

function capturingBinding(provider, fixture, capture) {
  return Object.freeze({
    async fetch(request) {
      exact(request.url === fixture.request.url && request.method === fixture.request.method,
        'consumer_request_target_mismatch');
      for (const [name, value] of Object.entries(fixture.request.headers)) {
        exact(request.headers.get(name) === value, 'consumer_request_header_mismatch');
      }
      const body = JSON.parse(await request.clone().text());
      exact(canonical(body) === canonical(fixture.request.body), 'consumer_request_body_mismatch');
      const response = await provider.handle(request);
      capture.status = response.status;
      capture.text = await response.clone().text();
      return response;
    },
  });
}

function exactReceipt(record, expected) {
  exact(record && typeof record === 'object', 'provider_receipt_missing');
  for (const [key, value] of Object.entries(expected)) {
    exact(canonical(record[key]) === canonical(value), `provider_receipt_${key}_mismatch`);
  }
  exact(Number.isSafeInteger(record.registered_at_ms) && record.registered_at_ms >= 0,
    'provider_receipt_time_invalid');
}

function admissionInputs(body) {
  return Object.freeze({
    agentDefinition: body.agent_definition,
    toolAllowlistEntry: body.tool_allowlist_entry,
    invocationRegisterEntry: body.invocation_register_entry,
    operatorInstructionRef: body.operator_instruction_ref,
  });
}

function permitFromHeaders(headers) {
  return Object.freeze({
    schema: headers['x-authoring-mutation-contract'],
    mutationId: headers['x-authoring-mutation-id'],
    operationId: headers['x-authoring-operation-id'],
    requestDigest: headers['x-authoring-request-digest'],
    mutationSequence: Number(headers['x-authoring-mutation-sequence']),
    semanticScope: headers['x-authoring-semantic-scope'],
    claimId: headers['x-authoring-claim-id'],
    leaseEpoch: Number(headers['x-authoring-lease-epoch']),
    leaseExpiresAtMs: Number(headers['x-authoring-lease-expires-at-ms']),
    fenceRevision: headers['x-authoring-fence-revision'],
    requiredWriteTarget: headers['x-authoring-write-target'],
    reservedAtMs: Number(headers['x-authoring-reserved-at-ms']),
  });
}

async function assertConsumerRejectsExtraKeys(
  consumer, inputs, intent, permit, deploymentPin, authenticationSecret, fixture, responseText,
) {
  const original = JSON.parse(responseText);
  for (const drifted of [
    { ...original, unexpected: true },
    { ...original, record: { ...original.record, unexpected: true } },
    { ...original, record: {
      ...original.record,
      deployment_identity: { ...original.record.deployment_identity, unexpected: true },
    } },
  ]) {
    const binding = Object.freeze({
      async fetch() {
        return new Response(JSON.stringify(drifted), {
          status: 200,
          headers: fixture.request.headers,
        });
      },
    });
    const result = await consumer.requestAcosAdmission(
      binding, inputs, intent, permit, deploymentPin, authenticationSecret,
    );
    exact(result.ok === false && result.code === 'acos_admission_receipt_invalid',
      'consumer_extra_key_drift_accepted');
  }
}

function validateFixture(value) {
  exact(value && typeof value === 'object' && value.$schema === FIXTURE_SCHEMA,
    'fixture_schema_invalid');
  exact(canonical(Object.keys(value).sort()) === canonical([
    '$schema', 'commerceAgentDefinition', 'expectedReceiptIdentity', 'request',
  ]), 'fixture_shape_invalid');
  exact(value.commerceAgentDefinition && typeof value.commerceAgentDefinition === 'object'
    && value.commerceAgentDefinition.executableTarget
    && typeof value.commerceAgentDefinition.executableTarget === 'object',
  'fixture_commerce_agent_definition_invalid');
  exact(value.request && typeof value.request === 'object'
    && value.request.url === 'https://acos-admission.internal/internal/v2/adapter-registrations'
    && value.request.method === 'POST', 'fixture_request_invalid');
  exact(value.request.headers && typeof value.request.headers === 'object'
    && value.request.headers['content-type'] === 'application/json'
    && value.request.headers['x-acos-admission-auth-schema'] === 'commerce-acos-admission-auth/v1'
    && /^[0-9a-f]{64}$/u.test(value.request.headers['x-acos-admission-auth-signature'] ?? ''),
  'fixture_headers_invalid');
  exact(value.request.body && typeof value.request.body === 'object'
    && canonical(Object.keys(value.request.body).sort()) === canonical([
      'agent_definition', 'authoring_mutation_intent', 'invocation_register_entry',
      'operator_instruction_ref', 'tool_allowlist_entry',
    ]), 'fixture_body_shape_invalid');
  exact(value.expectedReceiptIdentity && typeof value.expectedReceiptIdentity === 'object',
    'fixture_receipt_identity_invalid');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function exact(condition, code) {
  if (!condition) throw new Error(`composition_admission_probe:${code}`);
}

const invoked = process.argv[1] && realpathOrNull(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [acosRoot, commerceRoot, graphRoot, fixturePath, ...extra] = process.argv.slice(2);
  if (extra.length || !acosRoot || !commerceRoot || !graphRoot || !fixturePath) {
    process.stderr.write('composition_admission_probe:arguments_invalid\n');
    process.exitCode = 1;
  } else {
    runCompositionAdmissionProbe({ acosRoot, commerceRoot, graphRoot, fixturePath }).then(
      report => process.stdout.write(`${JSON.stringify(report)}\n`),
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
