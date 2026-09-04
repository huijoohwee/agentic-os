import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COMPOSITION_MARKETPLACE_PROBE_SCHEMA = 'agentic-os/composition-marketplace-cross-repository-probe/v1';
export const COMPOSITION_AUTHORING_HEADERS = Object.freeze('x-authoring-mutation-contract x-authoring-mutation-id x-authoring-operation-id x-authoring-request-digest x-authoring-mutation-sequence x-authoring-semantic-scope x-authoring-claim-id x-authoring-lease-epoch x-authoring-lease-expires-at-ms x-authoring-fence-revision x-authoring-write-target x-authoring-reserved-at-ms'.split(' '));

export async function runCompositionMarketplaceProbe({ commerceRoot, graphRoot,
  nodeVersion = process.versions.node,
  typescriptFeature = nodeVersion === process.versions.node ? process.features?.typescript : null }) {
  if (!nodeAtLeast(nodeVersion, 22, 22) || !['strip', 'transform'].includes(typescriptFeature)) return Object.freeze({
    schema: COMPOSITION_MARKETPLACE_PROBE_SCHEMA, ok: false,
    code: 'composition_marketplace_probe_node_runtime_unsupported', requiredNode: '>=22.22.0',
    requiredFeature: 'process.features.typescript=strip|transform',
    observedNode: nodeVersion,
  });
  try {
    const consumerRoot = realpathSync(commerceRoot), providerRoot = realpathSync(graphRoot);
    const result = await probeMarketplaceJoin(consumerRoot, providerRoot);
    return Object.freeze({ schema: COMPOSITION_MARKETPLACE_PROBE_SCHEMA, ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = message.match(/^composition_marketplace_probe:(marketplace_[a-z0-9_]+)$/u)?.[1]
      ?? 'marketplace_probe_execution_failed';
    return Object.freeze({ schema: COMPOSITION_MARKETPLACE_PROBE_SCHEMA, ok: false, code });
  }
}

async function probeMarketplaceJoin(commerceRoot, graphRoot) {
  const { withContainedModules } = await import('./composition-module-loader.mjs');
  return withContainedModules([
    [commerceRoot, 'src/core/marketplace-transition-request.ts'], [commerceRoot, 'src/core/authoring-mutation-headers.ts'],
    [commerceRoot, 'src/core/provider-operation-gate.ts'], [commerceRoot, 'src/shared/commerce-provider-auth.ts'],
    [commerceRoot, 'src/core/marketplace-provider-response.ts'], [commerceRoot, 'src/core/marketplace-provider-response-contract.ts'],
    [commerceRoot, 'src/core/upstream-evidence.ts'], [commerceRoot, 'src/domain/authoring-claim-policy.ts'],
    [graphRoot, 'cloudflare/workers/commerce-provider-contract.ts'], [graphRoot, 'cloudflare/workers/commerce-provider-auth.ts'],
    [graphRoot, 'cloudflare/workers/commerce-marketplace-provider-response-contract.ts'],
    [graphRoot, 'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts'],
  ].map(([root, relative]) => ({ root, relative })), 'composition_marketplace_probe',
  probeLoadedMarketplaceJoin);
}

async function probeLoadedMarketplaceJoin(modules) {
  const [producer, commerceHeaders, commerceGate, commerceAuth, commerceMarketplaceResponse,
    commerceResponse, commerceEvidence, commerceClaim, graph, graphAuth, graphResponse,
    graphRuntime] = modules;
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
  const claimBinding = commerceClaim.vendorTransitionClaim(vendorId);
  const payload = Object.freeze({ vendorId, actorId, state });
  const requestDigest = await commerceClaim.authoringMutationRequestDigest(claimBinding, payload);
  const graphRequestDigest = await graph.sha256Hex(graph.canonicalJson({
    schema: 'agentic-graph-authoring-operation/v1', semanticScope: claimBinding.semanticScope,
    writeTarget: claimBinding.writeTarget, payload,
  }));
  exact(requestDigest === graphRequestDigest, 'marketplace_authoring_digest_mismatch');
  const reservedAtMs = Date.now();
  const claim = Object.freeze({
    claimId: 'claim-cross-repo-v17',
    actorId: 'claim-actor-cross-repo', deviceId: 'device-cross-repo', sessionId: 'session-cross-repo',
    worktree: '/composition-probe', branch: 'composition-probe',
    semanticScope: claimBinding.semanticScope, declaredWriteSet: [claimBinding.writeTarget],
    leaseEpoch: 17,
    leaseExpiresAtMs: reservedAtMs + 60_000,
    fenceRevision: 'fence-cross-repo-v17',
  });
  const claimRequest = Object.freeze({
    semanticScope: claimBinding.semanticScope, claimId: claim.claimId,
    leaseEpoch: claim.leaseEpoch, fenceRevision: claim.fenceRevision,
    requiredWriteTarget: claimBinding.writeTarget,
  });
  const operationId = commerceClaim.authoringMutationOperationId(requestDigest);
  exact(operationId, 'marketplace_authoring_operation_id_invalid');
  const permit = commerceClaim.claimMutationPermit(
    claim, claimRequest, operationId, requestDigest, 1, reservedAtMs,
  );
  exact(permit, 'marketplace_authoring_permit_construction_invalid');
  let controlAuthenticationValidated = false;
  let controlRequest = null;
  const env = Object.freeze({
    MARKETPLACE_PROVIDER: Object.freeze({
      async fetch(request) {
        const url = new URL(request.url);
        exact(request.method === 'GET'
          && url.href === 'https://marketplace-provider.internal/v1/runtime-evidence'
          && request.body === null && request.headers.get('accept') === 'application/json'
          && request.headers.get('x-commerce-contract') === graph.MARKETPLACE_PROVIDER_CONTRACT,
        'marketplace_control_request_invalid');
        controlRequest = request.clone();
        controlAuthenticationValidated = await graphAuth.verifyCommerceProviderControlRequest(
          request, graph.MARKETPLACE_PROVIDER_CONTRACT, secret,
        );
        exact(controlAuthenticationValidated, 'marketplace_control_authentication_invalid');
        const response = await graphRuntime.handleMarketplaceProviderRequest(request, providerEnv);
        exact(response, 'marketplace_public_evidence_route_unhandled');
        return response;
      },
    }),
    MARKETPLACE_PROVIDER_EVIDENCE_PIN_JSON: JSON.stringify(pin),
    MARKETPLACE_PROVIDER_AUTH_SECRET: secret,
  });
  const produced = await producer.prepareAuthenticatedMarketplaceVendorTransitionRequest(
    env, { vendorId, actorId, state, permit });
  exact(produced?.ok === true, 'marketplace_producer_rejected_vector');
  const tamperSource = produced.request.clone();
  const invalidSignatureSource = produced.request.clone();
  const consumed = await graph.readBoundProviderRequest(
    produced.request, providerEnv, graph.MARKETPLACE_EVIDENCE_CHECKS);
  exact(consumed, 'marketplace_consumer_rejected_vector');
  const operationAuthenticationValidated = await graphAuth.verifyCommerceProviderRequestAuthentication(
    consumed.request,
    { contract: graph.MARKETPLACE_PROVIDER_CONTRACT, requestDigest: consumed.binding.requestDigest,
      bindingDigest: consumed.binding.bindingDigest }, secret,
  );
  exact(operationAuthenticationValidated, 'marketplace_operation_authentication_invalid');
  exact(controlRequest, 'marketplace_control_request_not_observed');
  const invalidControlHeaders = new Headers(controlRequest.headers);
  invalidControlHeaders.set('x-commerce-provider-auth-signature', '0'.repeat(64));
  exact(!await graphAuth.verifyCommerceProviderControlRequest(
    new Request(controlRequest, { headers: invalidControlHeaders }),
    graph.MARKETPLACE_PROVIDER_CONTRACT, secret),
  'marketplace_control_authentication_rejection_invalid');
  const invalidSignatureHeaders = new Headers(invalidSignatureSource.headers);
  invalidSignatureHeaders.set('x-commerce-provider-auth-signature', '0'.repeat(64));
  const invalidSignatureBound = await graph.readBoundProviderRequest(
    new Request(invalidSignatureSource, { headers: invalidSignatureHeaders }),
    providerEnv, graph.MARKETPLACE_EVIDENCE_CHECKS);
  exact(invalidSignatureBound, 'marketplace_invalid_signature_binding_unreadable');
  exact(!await graphAuth.verifyCommerceProviderRequestAuthentication(
    invalidSignatureBound.request,
    { contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
      requestDigest: invalidSignatureBound.binding.requestDigest,
      bindingDigest: invalidSignatureBound.binding.bindingDigest }, secret),
  'marketplace_operation_authentication_rejection_invalid');
  const parsedPermit = graph.parseAuthoringMutationPermit(consumed.request);
  exact(parsedPermit, 'marketplace_authoring_permit_invalid');
  exact(graph.authoringMutationPermitIsLive(parsedPermit, reservedAtMs + 1),
    'marketplace_authoring_permit_expired');
  exact(canonical(parsedPermit) === canonical(permit),
    'marketplace_authoring_permit_projection_mismatch');
  const transition = await readMarketplaceTransitionRequest(consumed.request.clone(),
    graph.MARKETPLACE_PROVIDER_CONTRACT, graphResponse.MARKETPLACE_VENDOR_STATES);
  exact(transition, 'marketplace_transition_request_invalid');
  exact(await graph.verifyAuthoringMutationPayload(parsedPermit, transition.semanticScope,
    transition.semanticScope, transition.payload), 'marketplace_authoring_payload_invalid');
  const malformedHeaders = new Headers(consumed.request.headers);
  malformedHeaders.delete('x-authoring-claim-id');
  const malformedPermit = graph.parseAuthoringMutationPermit(
    new Request(consumed.request.clone(), { headers: malformedHeaders }));
  exact(malformedPermit === null, 'marketplace_malformed_permit_accepted');
  const graphHeaderNames = [...graph.AUTHORING_MUTATION_HEADER_NAMES].sort();
  validateMarketplaceAuthoringHeaders(commerceHeaders.AUTHORING_MUTATION_HEADER_NAMES,
    commerceHeaders.authoringMutationHeaders(permit), graphHeaderNames, consumed.request);
  validateMarketplaceResponseContracts(commerceResponse, graphResponse);
  const preparedSql = [];
  let databaseBatchCount = 0, vendorRows = [];
  let settlementRow = {
    split_id: 'split-17', bundle_id: 'bundle-17', vendor_id: 'agent-flight', leg_ids: '[]',
    settlement_currency: 'SGD', gross_amount_minor: 125, commission_amount_minor: 25,
    net_payout_amount_minor: 100, commission_rule_id: 'rule-17', commission_rule_revision: 'revision-17',
    payout_id: 'payout-17', payout_state: 'settled', attempt_count: 1, terminal_reason: null,
    settlement_reference: 'settlement-17', updated_at: '2026-09-04T00:00:00.000Z' };
  const readOnlyDatabase = Object.freeze({
    prepare(sql) {
      exact(typeof sql === 'string' && /^\s*(?:SELECT|WITH)\b/iu.test(sql)
        && !/;|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM)\b/iu.test(sql),
        'marketplace_runtime_database_statement_not_read_only');
      preparedSql.push(sql);
      return {
        bind() { return this; },
        async all() { return { results: vendorRows }; },
        async first() { return sql.includes('marketplace_vendor_split_projection') ? settlementRow : null; },
      };
    },
    async batch() { databaseBatchCount += 1; return []; },
  });
  const graphRuntimeEnv = { ...providerEnv,
    MARKETPLACE_PROVIDER_AUTH_SECRET: secret, MARKETPLACE_DB: readOnlyDatabase };
  const signedEvidenceResponse = await graphRuntime.handleMarketplaceProviderRequest(
    controlRequest.clone(), graphRuntimeEnv);
  exact(signedEvidenceResponse?.status === 200, 'marketplace_public_evidence_route_rejected');
  const signedEvidencePayload = await signedEvidenceResponse.clone().json();
  const unsignedEvidenceHeaders = new Headers(controlRequest.headers);
  unsignedEvidenceHeaders.delete('x-commerce-provider-auth-schema');
  unsignedEvidenceHeaders.delete('x-commerce-provider-auth-signature');
  const unsignedEvidenceResponse = await graphRuntime.handleMarketplaceProviderRequest(
    new Request(controlRequest, { headers: unsignedEvidenceHeaders }), graphRuntimeEnv);
  const unsignedEvidencePayload = await unsignedEvidenceResponse?.clone().json();
  const signedEvidence = await commerceEvidence.verifyUpstreamRuntimeEvidence(
    signedEvidencePayload, graph.MARKETPLACE_PROVIDER_CONTRACT, pin, graph.MARKETPLACE_EVIDENCE_CHECKS,
  );
  const unsignedEvidence = await commerceEvidence.verifyUpstreamRuntimeEvidence(
    unsignedEvidencePayload, graph.MARKETPLACE_PROVIDER_CONTRACT, pin, graph.MARKETPLACE_EVIDENCE_CHECKS,
  );
  exact(unsignedEvidenceResponse?.status === 200
    && signedEvidence.ok === true && unsignedEvidence.ok === true,
  'marketplace_public_evidence_route_not_public');
  const capabilityRequest = new Request('https://marketplace-provider.internal/v1/capabilities', { method: 'GET' });
  const signedCapabilityRequest = await commerceAuth.authenticateCommerceProviderControlRequest(
    capabilityRequest, graph.MARKETPLACE_PROVIDER_CONTRACT, secret);
  exact(signedCapabilityRequest, 'marketplace_control_route_signing_failed');
  const signedControlResponse = await graphRuntime.handleMarketplaceProviderRequest(
    signedCapabilityRequest, graphRuntimeEnv);
  const capabilityPayload = await signedControlResponse?.clone().json();
  const requiredOperations = ['vendor-list', 'vendor-transition-fenced', 'settlement-read'];
  exact(signedControlResponse?.status === 200
    && capabilityPayload?.contract === graph.MARKETPLACE_PROVIDER_CONTRACT
    && Array.isArray(capabilityPayload.operations)
    && requiredOperations.every(operation => capabilityPayload.operations.includes(operation)),
  'marketplace_control_route_signed_request_rejected');
  const unsignedControlResponse = await graphRuntime.handleMarketplaceProviderRequest(
    capabilityRequest, graphRuntimeEnv);
  exact(unsignedControlResponse?.status === 401
    && canonical(await unsignedControlResponse.clone().json()) === canonical({
      ok: false,
      contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
      code: 'provider_authentication_invalid',
    }), 'marketplace_control_route_authentication_required');
  const tamperedControlHeaders = new Headers(signedCapabilityRequest.headers);
  tamperedControlHeaders.set('x-commerce-provider-auth-signature', '0'.repeat(64));
  const tamperedControlResponse = await graphRuntime.handleMarketplaceProviderRequest(
    new Request(signedCapabilityRequest, { headers: tamperedControlHeaders }), graphRuntimeEnv);
  exact(tamperedControlResponse?.status === 401
    && canonical(await tamperedControlResponse.clone().json()) === canonical({
      ok: false,
      contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
      code: 'provider_authentication_invalid',
    }), 'marketplace_control_route_tampered_signature_accepted');
  const bindRead = async url => {
    const request = new Request(url, { headers: {
      accept: 'application/json', 'x-commerce-contract': graph.MARKETPLACE_PROVIDER_CONTRACT,
    } });
    const bound = await commerceGate.prepareMarketplaceProviderOperation(env, request);
    exact(bound?.ok === true, 'marketplace_read_request_rebind_failed');
    return bound;
  };
  const validVendorRow = { vendor_id: 'agent-flight', lifecycle_state: 'active',
    provenance_state: 'active', actor_id: 'operator-alternate', mutation_id: 'mutation-17' };
  const identifierRows = [validVendorRow, ...[
    ['vendor_id', 'agent/flight'], ['vendor_id', `v${'x'.repeat(128)}`],
    ['actor_id', 'operator/alternate'], ['mutation_id', 'mutation/17'],
    ['mutation_id', `m${'x'.repeat(128)}`],
  ].map(([key, value]) => ({ ...validVendorRow, [key]: value }))];
  let listJoinValidated = true, listHeadersValidated = true, identifierGrammarAligned = true;
  for (const [index, row] of identifierRows.entries()) {
    vendorRows = [row];
    const operation = await bindRead('https://marketplace.internal/v1/vendors');
    const response = await graphRuntime.handleMarketplaceProviderRequest(operation.request, graphRuntimeEnv);
    const body = await response?.clone().json();
    const accepted = response?.status === 200
      && commerceMarketplaceResponse.validVendorList(response.status, body);
    const rejected = validProviderRejection(response, body, graph.MARKETPLACE_PROVIDER_CONTRACT);
    listHeadersValidated &&= Boolean(response
      && commerceGate.responseMatchesOperationalEvidence(response, operation.binding));
    if (index === 0) listJoinValidated &&= accepted;
    else identifierGrammarAligned &&= accepted || rejected;
  }
  const validSettlementRow = settlementRow;
  const settlementRows = [validSettlementRow,
    { ...validSettlementRow, settlement_currency: 'sgd' },
    { ...validSettlementRow, net_payout_amount_minor: Number.MAX_SAFE_INTEGER + 1 }];
  let settlementJoinValidated = true;
  for (const [index, row] of settlementRows.entries()) {
    settlementRow = row;
    const operation = await bindRead('https://marketplace.internal/v1/settlements/split-17');
    const response = await graphRuntime.handleMarketplaceProviderRequest(operation.request, graphRuntimeEnv);
    const body = await response?.clone().json();
    const accepted = response?.status === 200
      && commerceMarketplaceResponse.validSettlement(200, body, 'split-17');
    settlementJoinValidated &&= (index === 0 ? accepted
      : accepted || validProviderRejection(response, body, graph.MARKETPLACE_PROVIDER_CONTRACT))
      && Boolean(response && commerceGate.responseMatchesOperationalEvidence(response, operation.binding));
  }
  const validRoute = new URL(consumed.request.url);
  const routeVectors = [
    { url: `https://evil.example${validRoute.pathname}` },
    { url: `http://${validRoute.host}${validRoute.pathname}` },
    { url: `https://${validRoute.hostname}:444${validRoute.pathname}` },
    { url: `https://probe:secret@${validRoute.host}${validRoute.pathname}`, constructorMayReject: true },
    { url: `${validRoute.href}?unexpected=1` },
    { url: `${validRoute.href}#unexpected` },
    { header: ['x-commerce-contract', null] },
    { header: ['x-commerce-contract', 'commerce.marketplace-provider/v2'] },
    { header: ['content-type', 'text/plain'] },
    { body: JSON.stringify({ state, extra: true }) },
  ];
  let exactRouteContractValidated = true;
  for (const vector of routeVectors) {
    const headers = new Headers(consumed.request.headers);
    if (vector.header?.[1] === null) headers.delete(vector.header[0]);
    else if (vector.header) headers.set(...vector.header);
    let routeBase;
    try { routeBase = new Request(vector.url ?? validRoute, {
      method: 'POST', headers, body: vector.body ?? JSON.stringify({ state }),
    }); } catch { exactRouteContractValidated &&= vector.constructorMayReject === true; continue; }
    const routeOperation = await commerceGate.bindAuthenticatedProviderRequest(
      produced.binding, routeBase, graph.MARKETPLACE_PROVIDER_CONTRACT, secret,
    );
    exact(routeOperation?.ok === true, 'marketplace_route_request_rebind_failed');
    const routeReadCount = preparedSql.length;
    const response = await graphRuntime.handleMarketplaceProviderRequest(
      routeOperation.request, graphRuntimeEnv, parsedPermit.leaseExpiresAtMs,
    );
    exactRouteContractValidated &&= (response === null || !(response.status >= 200 && response.status < 400))
      && preparedSql.length === routeReadCount && databaseBatchCount === 0;
  }
  const authenticationReadCount = preparedSql.length;
  const invalidRuntimeAuthentication = await graphRuntime.handleMarketplaceProviderRequest(
    invalidSignatureBound.request.clone(),
    graphRuntimeEnv,
    reservedAtMs + 1,
  );
  exact(invalidRuntimeAuthentication?.status === 401
    && canonical(await invalidRuntimeAuthentication.clone().json()) === canonical({
      ok: false,
      contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
      code: 'provider_authentication_invalid',
    }) && preparedSql.length === authenticationReadCount && databaseBatchCount === 0,
  'marketplace_runtime_authentication_rejection_invalid');
  const mismatchBase = new Request(consumed.request.clone(), {
    body: JSON.stringify({ state: 'approved' }),
  });
  const mismatchRequest = await commerceGate.bindAuthenticatedProviderRequest(
    produced.binding,
    mismatchBase,
    graph.MARKETPLACE_PROVIDER_CONTRACT,
    secret,
  );
  exact(mismatchRequest?.ok === true, 'marketplace_payload_mismatch_rebind_failed');
  const mismatchReadCount = preparedSql.length;
  const mismatchResponse = await graphRuntime.handleMarketplaceProviderRequest(
    mismatchRequest.request,
    graphRuntimeEnv,
    reservedAtMs + 1,
  );
  exact(mismatchResponse?.status === 409
    && canonical(await mismatchResponse.clone().json()) === canonical({
      ok: false,
      contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
      code: 'authoring_mutation_payload_mismatch',
    }) && preparedSql.length === mismatchReadCount && databaseBatchCount === 0,
  'marketplace_runtime_payload_mismatch_rejection_invalid');
  const expiryReadCount = preparedSql.length;
  const runtimeResponse = await graphRuntime.handleMarketplaceProviderRequest(
    consumed.request.clone(),
    { ...graphRuntimeEnv, MARKETPLACE_DB: readOnlyDatabase },
    parsedPermit.leaseExpiresAtMs,
  );
  exact(runtimeResponse?.status === 409, 'marketplace_runtime_route_not_exercised');
  const runtimePayload = await runtimeResponse.clone().json();
  exact(canonical(runtimePayload) === canonical({
    ok: false,
    contract: graph.MARKETPLACE_PROVIDER_CONTRACT,
    code: 'authoring_mutation_lease_expired',
  }), 'marketplace_runtime_rejection_unexpected');
  exact(commerceMarketplaceResponse.classifyVendorTransition(
    runtimeResponse.status,
    runtimePayload,
    transition.payload.vendorId,
    transition.payload.actorId,
    transition.payload.state,
    parsedPermit.mutationId,
  ) === 'terminal', 'marketplace_runtime_response_classifier_mismatch');
  exact(
    commerceGate.responseMatchesOperationalEvidence(runtimeResponse, produced.binding)
      && commerceHeaders.responseMatchesAuthoringMutation(runtimeResponse, permit),
    'marketplace_runtime_response_headers_invalid',
  );
  exact(
    marketplaceRuntimeReadOnlyTraceValid(preparedSql.length - expiryReadCount, databaseBatchCount),
    'marketplace_runtime_rejection_wrote_state',
  );
  const tamperedHeaders = new Headers(tamperSource.headers);
  tamperedHeaders.set('x-authoring-lease-epoch', '18');
  const tampered = await graph.readBoundProviderRequest(
    new Request(tamperSource, { headers: tamperedHeaders }),
    providerEnv,
    graph.MARKETPLACE_EVIDENCE_CHECKS,
  );
  exact(tampered === null, 'marketplace_post_signature_tamper_accepted');
  exact(listJoinValidated, 'marketplace_vendor_list_consumer_contract_mismatch');
  exact(listHeadersValidated, 'marketplace_vendor_list_response_headers_invalid');
  exact(identifierGrammarAligned, 'marketplace_vendor_identifier_grammar_mismatch');
  exact(settlementJoinValidated, 'marketplace_settlement_consumer_contract_mismatch');
  exact(exactRouteContractValidated, 'marketplace_runtime_route_contract_not_enforced');
  return Object.freeze({
    marketplaceContract: graph.MARKETPLACE_PROVIDER_CONTRACT,
    marketplaceProducerConsumerValidated: true,
    marketplaceControlAuthenticationValidated: controlAuthenticationValidated,
    marketplaceControlAuthenticationRejected: true, marketplaceControlRouteValidated: true,
    marketplacePublicEvidenceRouteValidated: true,
    marketplaceOperationAuthenticationValidated: operationAuthenticationValidated,
    marketplaceOperationAuthenticationRejected: true, marketplacePermitValidated: true,
    marketplacePayloadValidated: true, marketplaceMalformedPermitRejected: true,
    marketplaceAuthoringHeaderCount: graphHeaderNames.length,
    marketplaceResponseContractValidated: true, marketplaceRuntimeRouteValidated: true,
    marketplaceRuntimeAuthenticationRejected: true, marketplaceRuntimePayloadMismatchRejected: true,
    marketplaceRuntimeNoWriteRejectionValidated: true, marketplaceRuntimeResponseHeadersValidated: true,
    marketplaceVendorListValidated: true, marketplaceSettlementValidated: true,
    marketplaceExactRouteContractValidated: true,
    marketplaceTamperRejected: true,
    marketplaceRequestDigest: consumed.binding.requestDigest, marketplaceBindingDigest: consumed.binding.bindingDigest,
  });
}

export function marketplaceRuntimeReadOnlyTraceValid(reads, batches) { return Number.isSafeInteger(reads) && reads >= 0 && reads <= 4 && batches === 0; }

export async function readMarketplaceTransitionRequest(request, contract, states) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/v1\/vendors\/([^/]+)\/transition$/u);
    if (request.method !== 'POST' || url.protocol !== 'https:'
      || url.hostname !== 'marketplace.internal' || url.port !== ''
      || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
      || !match || request.headers.get('x-commerce-contract') !== contract
      || request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return null;
    const vendorId = decodeURIComponent(match[1]);
    const actorId = request.headers.get('x-operator-id') ?? '';
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > 65_536) return null;
    const body = JSON.parse(bodyText);
    const identifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
    if (!identifier.test(vendorId) || !identifier.test(actorId)
      || !body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'state'
      || typeof body.state !== 'string' || !Array.isArray(states) || !states.includes(body.state)) return null;
    const semanticScope = `vendor:${vendorId}`;
    return Object.freeze({
      semanticScope,
      payload: Object.freeze({ vendorId, actorId, state: body.state }),
    });
  } catch { return null; }
}

export function validateMarketplaceAuthoringHeaders(
  commerceHeaderNames,
  commerceHeaders,
  graphHeaderNames,
  request,
) {
  const expected = [...COMPOSITION_AUTHORING_HEADERS].sort();
  const graphNames = [...graphHeaderNames].sort();
  const commerceNames = [...commerceHeaderNames].sort();
  const producedNames = Object.keys(commerceHeaders).sort();
  const requestNames = [...request.headers.keys()]
    .filter(name => name.startsWith('x-authoring-')).sort();
  exact(canonical(commerceNames) === canonical(expected),
    'marketplace_authoring_header_commerce_contract_invalid');
  exact(canonical(graphNames) === canonical(expected),
    'marketplace_authoring_header_graph_contract_invalid');
  exact(canonical(producedNames) === canonical(expected),
    'marketplace_authoring_header_generation_invalid');
  exact(canonical(requestNames) === canonical(expected),
    'marketplace_authoring_header_request_projection_invalid');
  exact(
    producedNames.every(name => request.headers.get(name) === commerceHeaders[name]),
    'marketplace_authoring_header_value_mismatch',
  );
  return true;
}

export function validateMarketplaceResponseContracts(commerce, graph) {
  const expected = Object.freeze({
    MARKETPLACE_PROVIDER_RESPONSE_SCHEMA: 'commerce.marketplace-provider-response/v1',
    MARKETPLACE_VENDOR_STATES: ['pending_review', 'approved', 'active', 'suspended'],
    MARKETPLACE_TERMINAL_409_CODES: [
      'authoring_mutation_lease_expired', 'authoring_mutation_fence_stale',
      'authoring_mutation_fence_conflict', 'authoring_mutation_id_conflict', 'transition_rejected',
    ],
    MARKETPLACE_RECOVERY_409_CODES: [
      'operational_evidence_binding_invalid', 'authoring_mutation_permit_invalid',
      'authoring_mutation_payload_mismatch', 'authoring_mutation_reconciliation_required',
    ],
    MARKETPLACE_PROVIDER_RESPONSE_KEYS: {
      vendorList: ['contract', 'ok', 'vendors'],
      vendor: ['actorId', 'mutationId', 'state', 'vendorId'],
      transition: ['actorId', 'contract', 'mutationId', 'ok', 'state', 'vendorId'],
      settlement: ['amountMinor', 'contract', 'currency', 'ok', 'splitId', 'state'],
      error: ['code', 'contract', 'ok'],
    },
  });
  for (const [name, value] of Object.entries(expected)) {
    const suffix = name.replace(/^MARKETPLACE_/u, '').toLowerCase();
    exact(canonical(commerce?.[name]) === canonical(value),
      `marketplace_response_commerce_${suffix}_invalid`);
    exact(canonical(graph?.[name]) === canonical(value),
      `marketplace_response_graph_${suffix}_invalid`);
  }
  return true;
}

const failureTargets = (component, file, codes) => codes.split(' ')
  .map(code => [code, Object.freeze([component, file])]);
const MARKETPLACE_FAILURE_TARGETS = new Map([
  ...failureTargets('agentic-os', 'package.json', 'composition_marketplace_probe_node_runtime_unsupported'),
  ...failureTargets('agentic-os', 'bin/composition-marketplace-probe.mjs', 'marketplace_probe_execution_failed'),
  ...failureTargets('agentic-os', 'bin/composition-module-loader.mjs', 'marketplace_module_git_root_unexpected marketplace_module_url_invalid marketplace_module_path_escaped marketplace_module_path_unreadable marketplace_module_path_aliased marketplace_module_owner_boundary_crossed marketplace_module_not_regular marketplace_module_untracked marketplace_module_bytes_unbound marketplace_module_specifier_unsupported marketplace_module_read_invalid marketplace_module_format_unsupported marketplace_module_changed_during_probe'),
  ...failureTargets('agentic-commerce-os', 'src/core/provider-operation-gate.ts', 'marketplace_control_request_invalid marketplace_control_request_not_observed marketplace_payload_mismatch_rebind_failed marketplace_read_request_rebind_failed marketplace_route_request_rebind_failed'),
  ...failureTargets('agentic-commerce-os', 'src/shared/commerce-provider-auth.ts', 'marketplace_control_route_signing_failed'),
  ...failureTargets('agentic-commerce-os', 'src/core/marketplace-transition-request.ts', 'marketplace_producer_rejected_vector marketplace_transition_request_invalid marketplace_authoring_header_request_projection_invalid marketplace_authoring_header_value_mismatch'),
  ...failureTargets('agentic-commerce-os', 'src/core/authoring-mutation-headers.ts', 'marketplace_authoring_header_commerce_contract_invalid marketplace_authoring_header_generation_invalid'),
  ...failureTargets('agentic-commerce-os', 'src/domain/authoring-claim-policy.ts', 'marketplace_authoring_digest_mismatch marketplace_authoring_operation_id_invalid marketplace_authoring_permit_construction_invalid'),
  ...failureTargets('agentic-commerce-os', 'src/core/marketplace-provider-response-contract.ts', 'marketplace_response_commerce_provider_response_schema_invalid marketplace_response_commerce_vendor_states_invalid marketplace_response_commerce_terminal_409_codes_invalid marketplace_response_commerce_recovery_409_codes_invalid marketplace_response_commerce_provider_response_keys_invalid'),
  ...failureTargets('agentic-commerce-os', 'src/core/marketplace-provider-response.ts', 'marketplace_runtime_response_classifier_mismatch'),
  ...failureTargets('agentic-graph', 'cloudflare/workers/commerce-provider-contract.ts', 'marketplace_evidence_pin_invalid marketplace_consumer_rejected_vector marketplace_invalid_signature_binding_unreadable marketplace_authoring_permit_invalid marketplace_authoring_permit_expired marketplace_authoring_permit_projection_mismatch marketplace_authoring_payload_invalid marketplace_malformed_permit_accepted marketplace_post_signature_tamper_accepted marketplace_authoring_header_graph_contract_invalid'),
  ...failureTargets('agentic-graph', 'cloudflare/workers/commerce-provider-auth.ts', 'marketplace_control_authentication_invalid marketplace_control_authentication_rejection_invalid marketplace_operation_authentication_invalid marketplace_operation_authentication_rejection_invalid'),
  ...failureTargets('agentic-graph', 'cloudflare/workers/commerce-marketplace-provider-response-contract.ts', 'marketplace_response_graph_provider_response_schema_invalid marketplace_response_graph_vendor_states_invalid marketplace_response_graph_terminal_409_codes_invalid marketplace_response_graph_recovery_409_codes_invalid marketplace_response_graph_provider_response_keys_invalid'),
  ...failureTargets('agentic-graph', 'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts', 'marketplace_public_evidence_route_unhandled marketplace_public_evidence_route_rejected marketplace_public_evidence_route_not_public marketplace_control_route_signed_request_rejected marketplace_control_route_authentication_required marketplace_control_route_tampered_signature_accepted marketplace_runtime_database_statement_not_read_only marketplace_runtime_authentication_rejection_invalid marketplace_runtime_payload_mismatch_rejection_invalid marketplace_runtime_route_not_exercised marketplace_runtime_rejection_unexpected marketplace_runtime_response_headers_invalid marketplace_runtime_rejection_wrote_state marketplace_vendor_list_consumer_contract_mismatch marketplace_vendor_list_response_headers_invalid marketplace_vendor_identifier_grammar_mismatch marketplace_settlement_consumer_contract_mismatch marketplace_runtime_route_contract_not_enforced'),
]);
export const COMPOSITION_MARKETPLACE_FAILURE_CODES = Object.freeze(
  [...MARKETPLACE_FAILURE_TARGETS.keys()].sort(),
);

export function isValidCompositionMarketplaceProbeReport(report) {
  if (report?.schema !== COMPOSITION_MARKETPLACE_PROBE_SCHEMA) return false;
  if (report.ok === false) {
    if (report.code === 'composition_marketplace_probe_node_runtime_unsupported') {
      return Object.keys(report).sort().join(',') === 'code,observedNode,ok,requiredFeature,requiredNode,schema'
        && report.requiredNode === '>=22.22.0'
        && report.requiredFeature === 'process.features.typescript=strip|transform'
        && typeof report.observedNode === 'string';
    }
    return Object.keys(report).sort().join(',') === 'code,ok,schema'
      && MARKETPLACE_FAILURE_TARGETS.has(report.code);
  }
  return report.ok === true
    && report.marketplaceContract === 'commerce.marketplace-provider/v1'
    && [
      'marketplaceProducerConsumerValidated', 'marketplaceControlAuthenticationValidated',
      'marketplaceControlAuthenticationRejected', 'marketplaceControlRouteValidated',
      'marketplacePublicEvidenceRouteValidated', 'marketplaceOperationAuthenticationValidated',
      'marketplaceOperationAuthenticationRejected', 'marketplacePermitValidated',
      'marketplacePayloadValidated', 'marketplaceMalformedPermitRejected',
      'marketplaceResponseContractValidated', 'marketplaceRuntimeRouteValidated',
      'marketplaceRuntimeAuthenticationRejected', 'marketplaceRuntimePayloadMismatchRejected',
      'marketplaceRuntimeNoWriteRejectionValidated', 'marketplaceRuntimeResponseHeadersValidated',
      'marketplaceVendorListValidated', 'marketplaceSettlementValidated',
      'marketplaceExactRouteContractValidated', 'marketplaceTamperRejected',
    ].every(name => report[name] === true)
    && report.marketplaceAuthoringHeaderCount === 12
    && /^[0-9a-f]{64}$/u.test(report.marketplaceRequestDigest ?? '')
    && /^[0-9a-f]{64}$/u.test(report.marketplaceBindingDigest ?? '');
}

export function marketplaceProbeFindingTarget(code) {
  if (['cross_repository_marketplace_probe_invalid', 'cross_repository_marketplace_probe_failed']
    .includes(code)) return ['agentic-os', 'bin/composition-runtime-check.mjs'];
  return MARKETPLACE_FAILURE_TARGETS.get(code)
    ?? ['agentic-os', 'bin/composition-marketplace-probe.mjs'];
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validProviderRejection(response, body, contract) {
  return Boolean(response && response.status >= 400 && response.status < 600 && body && typeof body === 'object' && !Array.isArray(body) && canonical(Object.keys(body).sort()) === canonical(['code', 'contract', 'ok']) && body.ok === false && body.contract === contract && /^[a-z][a-z0-9_]{0,127}$/u.test(body.code));
}

function nodeAtLeast(value, requiredMajor, requiredMinor) {
  const match = String(value).match(/^(\d+)\.(\d+)\./u);
  return Boolean(match) && (Number(match[1]) > requiredMajor
    || (Number(match[1]) === requiredMajor && Number(match[2]) >= requiredMinor));
}

function exact(condition, code) {
  if (!condition) throw new Error(`composition_marketplace_probe:${code}`);
}

const invoked = process.argv[1] && realpathOrNull(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [commerceRoot, graphRoot, ...extra] = process.argv.slice(2);
  if (extra.length || !commerceRoot || !graphRoot) {
    process.stderr.write('composition_marketplace_probe:arguments_invalid\n');
    process.exitCode = 1;
  } else {
    runCompositionMarketplaceProbe({ commerceRoot, graphRoot }).then(value => {
      process.stdout.write(`${JSON.stringify(value)}\n`);
      process.exitCode = value.ok ? 0 : 1;
    });
  }
}

function realpathOrNull(value) {
  try { return realpathSync(value); } catch { return null; }
}
