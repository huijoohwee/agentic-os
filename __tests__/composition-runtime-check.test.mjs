import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPOSITION_ACCEPTANCE_SCHEMA, normalizeRepositoryIdentity, observeCompositionRuntime } from '../bin/composition-runtime-check.mjs';
import { REQUIRED_ADMISSION_CONTRACT, runCompositionAdmissionProbe } from '../bin/composition-admission-probe.mjs';
import { COMPOSITION_AUTHORING_HEADERS, marketplaceProbeFindingTarget, readMarketplaceTransitionRequest, runCompositionMarketplaceProbe, validateMarketplaceAuthoringHeaders, validateMarketplaceResponseContracts } from '../bin/composition-marketplace-probe.mjs';
const harnessManifest = pin => JSON.stringify({
  engines: { node: '>=22.22.0' },
  scripts: {
    lane: 'agentic-os start',
    land: 'agentic-os land',
    status: 'agentic-os status',
    reap: 'agentic-os reap',
  },
  devDependencies: { 'agentic-os': pin },
}, null, 2);
const tarballPin = `https://codeload.github.com/huijoohwee/agentic-os/tar.gz/${'a'.repeat(40)}`;
const githubPin = `github:huijoohwee/agentic-os#${'b'.repeat(40)}`;
const files = Object.freeze({
  'agentic-os': {
    'guides/COMPOSITION-ARCHITECTURE.md': 'DIR-RUNTIME-READY-01 `agentic-canvas-os` `agentic-graph` `agentic-commerce-os` VCC-RUNTIME-AUTHORITY-02',
    'src/github-authority.mjs': "github-actions-fenced-authority agentic-os/github-authority-input/v1 source.event !== 'workflow_dispatch'",
    'src/github-authority-operation.mjs': 'authority_input_digest does not match the event payload and committed policy',
    'bin/composition-runtime-check.mjs': 'agentic_os_runtime_root_mismatch component_changed_during_probe',
    'bin/composition-admission-probe.mjs': 'agentic-os/composition-cross-repository-probe/v1 commerce_admission_consumer_migration_required',
    'bin/composition-marketplace-probe.mjs': 'agentic-os/composition-marketplace-cross-repository-probe/v1 withContainedModules',
    'bin/composition-module-loader.mjs': 'withContainedModules marketplace_module_untracked',
  },
  'agentic-canvas-os': {
    'package.json': harnessManifest(tarballPin),
    'agent-api/src/commerce-admission-contract.js': 'export const COMMERCE_ADMISSION_PROVIDER_CONTRACT = "commerce.agentic-os-admission-provider/v3"; /agentic-os/internal/v2/adapter-registrations agentic-os-adapter-registration/v2 commerce-agentic-os-admission-auth/v1 x-agentic-os-admission-auth-signature agentic-os-authoring-operation/v1 authority://agentic-graph/commerce-admission/ authoring_mutation_intent x-authoring-reserved-at-ms',
    'agent-api/src/commerce-admission-authority.js': 'agentic-graph-commerce-admission-authority/v1 createCommerceAdmissionAuthority authority_unconfigured authority_expired',
    'agent-api/src/commerce-admission-provider.js': 'createCommerceAdmissionProvider agentic-os-adapter-registration-finding/v1 agentic-os-admission.internal runtime_unconfigured',
    'test/contracts/agentic-os-admission-v2.fixture.json': '{}',
    'test/contracts/agentic-os-admission-v2.fixture.sha256': '3fede7b38f3d8a5004870f31d798cb4218f7d7f59607144ba2fd0b431ac93a61  agentic-os-admission-v2.fixture.json',
    'wrangler.jsonc': 'AGENT_STATE AGENTIC_OS_ADMISSION_AUTH_SECRET AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET',
    '.github/workflows/adlc-authority.yml': 'workflow_dispatch:\nauthority_input_digest:',
  },
  'agentic-graph': {
    '.agentic-os.json': 'agentic-os/repository-profile/v1 github.com/huijoohwee/agentic-graph Integration Gate quarantine-worktree-cleanup-opt-in',
    'package.json': harnessManifest(githubPin),
    'docs/collaboration-runtime-contract.md': 'informational current-device projection delete_branch_on_merge:false',
    'cloudflare/workers/commerce-provider-contract.ts': 'commerce.discovery-provider/v1 commerce.checkout-provider/v1 commerce.marketplace-provider/v1 commerce.upstream-runtime-evidence/v1 x-commerce-provider-binding-digest AUTHORING_MUTATION_HEADER_NAMES x-authoring-reserved-at-ms agentic-graph-authoring-mutation-permit/v2 authoring_fence_atomic',
    'cloudflare/workers/commerce-provider-auth.ts': 'commerce-provider-auth/v1 x-commerce-provider-auth-schema x-commerce-provider-auth-signature verifyCommerceProviderControlRequest verifyCommerceProviderRequestAuthentication',
    'cloudflare/workers/commerce-marketplace-provider-response-contract.ts': 'commerce.marketplace-provider-response/v1 pending_review approved authoring_mutation_reconciliation_required',
    'cloudflare/workers/agentic-graph-mcp/commerce-discovery-provider.ts': 'commerce.discovery-receipt/v1 discovery_projection_unsupported',
    'cloudflare/workers/agentic-graph-travel-commerce/src/commerce-checkout-provider.ts': '/internal/v1/checkouts/prepare /internal/v1/checkouts/confirm operational_evidence_binding_invalid',
    'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts': 'vendor-transition-fenced settlement-read authoring_mutation_payload_mismatch verifyCommerceProviderRequestAuthentication MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agentic-graph-marketplace/wrangler.jsonc': 'MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agentic-graph-travel-commerce/wrangler.jsonc': 'CHECKOUT_PROVIDER_AUTH_SECRET MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agentic-graph-travel-commerce/src/provider-runtime-proof.ts': 'authenticateCommerceProviderControlRequest CHECKOUT_PROVIDER_AUTH_SECRET MARKETPLACE_PROVIDER_AUTH_SECRET',
    'scripts/travel-mesh-release.mjs': "environment.GITHUB_WORKFLOW !== 'Production Release' agentic-human-authorization-receipt/v2 consumed exact-candidate human authorization receipt",
  },
  'agentic-commerce-os': {
    'package.json': harnessManifest(tarballPin),
    'src/core/acos-admission.ts': "export const ACOS_ADMISSION_PROVIDER_CONTRACT = 'commerce.agentic-os-admission-provider/v3' as const; ACOS_ADMISSION_PATH ACOS_ADMISSION_RECEIPT_SCHEMA authoring_mutation_intent",
    'src/core/authoring-mutation-headers.ts': 'x-authoring-reserved-at-ms',
    'src/core/provider-contract.ts': 'commerce.discovery-provider/v1 commerce.checkout-provider/v1 commerce.marketplace-provider/v1',
    'src/core/upstream-evidence.ts': 'commerce.upstream-runtime-evidence/v1 invocation_catalog_parity guardrail_before_confirmation authoring_fence_atomic',
    'src/core/provider-operation-gate.ts': 'x-commerce-provider-binding-digest MAXIMUM_OPERATION_BODY_BYTES = 65_536 bindAuthenticatedProviderRequest verifyCommerceProviderRequestAuthentication',
    'src/shared/commerce-provider-auth.ts': 'commerce-provider-auth/v1 x-commerce-provider-auth-schema x-commerce-provider-auth-signature',
    'src/core/marketplace-transition-request.ts': 'prepareAuthenticatedMarketplaceVendorTransitionRequest authoringMutationHeaders bindAuthenticatedProviderRequest',
    'src/core/marketplace-provider-response-contract.ts': 'commerce.marketplace-provider-response/v1 pending_review approved authoring_mutation_reconciliation_required',
    '.github/workflows/production-release.yml': 'workflow_dispatch:\nenvironment: production\nhuman-authorization.json\nhuman-authorization.ts\nprior-release-authority.json\nrecovery-release-authority.json\nrun-production-release.ts\nif: ${{ success() }}\nif: ${{ failure() }}',
    'scripts/production-release/production-controller.ts': 'executeProductionRelease recovery preserve recovery_authenticated_preserve_receipt_required',
    'wrangler.edge.jsonc': 'airvio.co/agentic-commerce-os*',
  },
});
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'agentic-os-composition-'));
  const roots = {};
  for (const [component, entries] of Object.entries(files)) {
    const root = path.join(base, component);
    roots[component] = root;
    for (const [file, source] of Object.entries(entries)) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
    assert.equal(spawnSync('git', ['-C', root, 'add', '.']).status, 0);
  }
  return { base, roots };
}
const repositoryIdentity = Object.freeze({
  'agentic-os': 'huijoohwee/agentic-os',
  'agentic-canvas-os': 'huijoohwee/agentic-canvas-os',
  'agentic-graph': 'huijoohwee/agentic-graph',
  'agentic-commerce-os': 'huijoohwee/agentic-commerce-os',
});
const cleanGit = (root, component) => ({
  ok: true,
  clean: true,
  revision: 'a'.repeat(40),
  repositoryIdentity: repositoryIdentity[component],
  code: null,
});
const acceptedAdmissionProbe = () => Object.freeze({
  schema: 'agentic-os/composition-cross-repository-probe/v1',
  ok: true, fixtureSchema: 'commerce.agentic-os-admission-v2-request-fixture/v1',
  fixtureDigest: '3fede7b38f3d8a5004870f31d798cb4218f7d7f59607144ba2fd0b431ac93a61',
  providerContract: 'commerce.agentic-os-admission-provider/v3', consumerContract: 'commerce.agentic-os-admission-provider/v3',
  consumerValidated: true, productionProjectionValidated: true,
  admissionAuthenticationValidated: true, extraKeyDriftRejected: true,
  findingSchemaValidated: true, graphAuthorityValidated: true,
  receiptSchema: 'agentic-os-adapter-registration/v2',
  requestDigest: 'fec4d3f616fbda388e6392be63e9b5fb5bbe8f899901aacb3407ad7fb60de7f2',
  firstWriteCount: 1, replayWriteCount: 0, restartReady: true, runtimeAcceptanceObserved: true,
});
const acceptedMarketplaceProbe = () => Object.freeze({
  schema: 'agentic-os/composition-marketplace-cross-repository-probe/v1',
  ok: true,
  marketplaceContract: 'commerce.marketplace-provider/v1',
  marketplaceProducerConsumerValidated: true, marketplaceControlAuthenticationValidated: true,
  marketplaceControlAuthenticationRejected: true, marketplaceControlRouteValidated: true,
  marketplacePublicEvidenceRouteValidated: true, marketplaceOperationAuthenticationValidated: true,
  marketplaceOperationAuthenticationRejected: true, marketplacePermitValidated: true,
  marketplacePayloadValidated: true, marketplaceMalformedPermitRejected: true,
  marketplaceAuthoringHeaderCount: 12,
  marketplaceResponseContractValidated: true, marketplaceRuntimeRouteValidated: true,
  marketplaceRuntimeAuthenticationRejected: true, marketplaceRuntimePayloadMismatchRejected: true,
  marketplaceRuntimeNoWriteRejectionValidated: true, marketplaceRuntimeResponseHeadersValidated: true,
  marketplaceVendorListValidated: true, marketplaceSettlementValidated: true,
  marketplaceExactRouteContractValidated: true, marketplaceTamperRejected: true,
  marketplaceRequestDigest: 'b'.repeat(64),
  marketplaceBindingDigest: 'c'.repeat(64),
});
const blockedAdmissionProbe = (
  code,
  consumerContract = REQUIRED_ADMISSION_CONTRACT,
) => Object.freeze({
  schema: 'agentic-os/composition-cross-repository-probe/v1',
  ok: false,
  code,
  requiredContract: REQUIRED_ADMISSION_CONTRACT,
  providerContract: REQUIRED_ADMISSION_CONTRACT,
  consumerContract,
  runtimeAcceptanceObserved: false,
});
test('observes exact four-component source and protected-boundary contracts without inventing authority', () => {
  const value = fixture();
  try {
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.schema, COMPOSITION_ACCEPTANCE_SCHEMA);
    assert.equal(report.ok, true);
    assert.equal(report.sourceCandidateClean, true);
    assert.equal(report.authenticatedReleaseAuthorityContractReady, true);
    assert.equal(report.authenticatedReleaseAuthorityObserved, false);
    assert.equal(report.productionRuntimeReady, false);
    assert.equal(report.crossRepositoryContracts.ok, true);
    assert.deepEqual(report.deliveryBlockers, [
      'authenticated_release_evidence_not_observed',
      'operator_owned_x402_payee_not_observed',
      'deployed_runtime_evidence_not_observed',
    ]);
    assert.deepEqual(Object.keys(report.components), [
      'agentic-os', 'agentic-canvas-os', 'agentic-graph', 'agentic-commerce-os',
    ]);
    assert.equal(report.components['agentic-graph'].repositoryIdentity, 'huijoohwee/agentic-graph');
    assert.deepEqual(report.findings, []);
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('fails closed on contract drift and distinguishes a dirty source candidate from release authority', () => {
  const value = fixture();
  try {
    writeFileSync(path.join(value.roots['agentic-graph'], 'cloudflare/workers/commerce-provider-contract.ts'), 'drift');
    let report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.ok, false);
    assert.equal(report.sourceCandidateClean, false);
    assert.equal(report.authenticatedReleaseAuthorityContractReady, false);
    assert(report.findings.some(item => item.component === 'agentic-graph' && item.code === 'contract_literal_missing'));
    writeFileSync(
      path.join(value.roots['agentic-graph'], 'cloudflare/workers/commerce-provider-contract.ts'),
      files['agentic-graph']['cloudflare/workers/commerce-provider-contract.ts'],
    );
    report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: (root, component) => ({
        ok: false,
        clean: false,
        revision: 'b'.repeat(40),
        repositoryIdentity: repositoryIdentity[component],
        code: 'worktree_dirty',
      }),
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.ok, true);
    assert.equal(report.sourceContractsReady, true);
    assert.equal(report.sourceCandidateClean, false);
    assert.equal(report.authenticatedReleaseAuthorityContractReady, true);
    assert.equal(report.authenticatedReleaseAuthorityObserved, false);
    assert.equal(report.productionRuntimeReady, false);
    assert.equal(report.findings.length, 4);
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('contract inspection bounds bytes and rejects nonregular nodes', () => {
  const value = fixture(), target = path.join(value.roots['agentic-graph'], 'cloudflare/workers/commerce-provider-contract.ts');
  const blocked = () => observeCompositionRuntime({
    roots: value.roots, inspectGit: cleanGit,
    probeAdmission: acceptedAdmissionProbe, probeMarketplace: acceptedMarketplaceProbe,
  }).findings.some(item => item.file === 'cloudflare/workers/commerce-provider-contract.ts'
    && item.code === 'contract_file_unreadable_or_oversized');
  try {
    writeFileSync(target, Buffer.alloc(500_001));
    assert.equal(blocked(), true);
    rmSync(target);
    assert.equal(spawnSync('mkfifo', [target]).status, 0);
    assert.equal(blocked(), true);
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('rejects a foreign repository identity and duplicate component roots', () => {
  const value = fixture();
  try {
    let report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: (root, component) => component === 'agentic-graph'
        ? { ok: false, clean: false, revision: 'a'.repeat(40), repositoryIdentity: 'foreign/repository', code: 'git_origin_unexpected' }
        : cleanGit(root, component),
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.sourceContractsReady, false);
    assert(report.findings.some(item => item.component === 'agentic-graph' && item.code === 'git_origin_unexpected'));
    report = observeCompositionRuntime({
      roots: { ...value.roots, 'agentic-commerce-os': value.roots['agentic-os'] },
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.sourceContractsReady, false);
    assert(report.findings.some(item => item.component === 'agentic-commerce-os' && item.code === 'component_root_duplicate'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('repository identity accepts exact GitHub URL and scp forms but rejects lookalike and local paths', () => {
  for (const value of [
    'https://github.com/huijoohwee/agentic-os.git',
    'ssh://git@github.com/huijoohwee/agentic-os.git',
    'git@github.com:huijoohwee/agentic-os.git',
  ]) assert.equal(normalizeRepositoryIdentity(value), 'huijoohwee/agentic-os');
  for (const value of [
    'https://evilgithub.com/huijoohwee/agentic-os.git',
    'git@evilgithub.com:huijoohwee/agentic-os.git',
    '/tmp/github.com/huijoohwee/agentic-os.git',
    'file:///tmp/github.com/huijoohwee/agentic-os.git',
    'https://github.com/huijoohwee/agentic-os/extra.git',
  ]) assert.equal(normalizeRepositoryIdentity(value), null);
});
test('marketplace response validation rejects a contract missing from both owners', () => {
  assert.throws(
    () => validateMarketplaceResponseContracts({}, {}),
    /marketplace_response_commerce_provider_response_schema_invalid/u,
  );
});
test('marketplace transition and exact header validators reject producer drift', async () => {
  const contract = 'commerce.marketplace-provider/v1';
  const states = ['pending_review', 'approved', 'active', 'suspended'];
  const valid = new Request('https://marketplace.internal/v1/vendors/agent-flight/transition', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-commerce-contract': contract,
      'x-operator-id': 'operator-cross-repo',
    },
    body: JSON.stringify({ state: 'suspended' }),
  });
  assert.deepEqual(await readMarketplaceTransitionRequest(valid, contract, states), {
    semanticScope: 'vendor:agent-flight',
    payload: { vendorId: 'agent-flight', actorId: 'operator-cross-repo', state: 'suspended' },
  });
  const drifted = new Request(valid, { body: JSON.stringify({ state: 'suspended', extra: true }) });
  assert.equal(await readMarketplaceTransitionRequest(drifted, contract, states), null);
  const names = [...COMPOSITION_AUTHORING_HEADERS];
  const values = Object.fromEntries(names.map(name => [name, `${name}-value`]));
  const request = new Request('https://example.test', { headers: values });
  assert.equal(validateMarketplaceAuthoringHeaders(names, values, names, request), true);
  const missing = { ...values };
  delete missing[names[0]];
  assert.throws(() => validateMarketplaceAuthoringHeaders(names, missing, names, request),
    /marketplace_authoring_header_generation_invalid/u);
  assert.throws(() => validateMarketplaceAuthoringHeaders(names,
    { ...values, 'x-authoring-extra': 'drift' }, names, request), /marketplace_authoring_header_generation_invalid/u);
  const missingRequestHeader = new Headers(request.headers); missingRequestHeader.delete(names[0]);
  assert.throws(() => validateMarketplaceAuthoringHeaders(names, values, names,
    new Request(request, { headers: missingRequestHeader })), /marketplace_authoring_header_request_projection_invalid/u);
});
test('marketplace probe exposes its Node prerequisite before loading sibling TypeScript', async () => {
  const report = await runCompositionMarketplaceProbe({
    commerceRoot: '/missing-commerce',
    graphRoot: '/missing-graph',
    nodeVersion: '20.11.0',
  });
  assert.deepEqual(report, {
    schema: 'agentic-os/composition-marketplace-cross-repository-probe/v1',
    ok: false,
    code: 'composition_marketplace_probe_node_runtime_unsupported',
    requiredNode: '>=22.22.0',
    requiredFeature: 'process.features.typescript=strip|transform',
    observedNode: '20.11.0',
  });
  const node235 = await runCompositionMarketplaceProbe({
    commerceRoot: '/missing-commerce', graphRoot: '/missing-graph',
    nodeVersion: '23.5.0', typescriptFeature: null,
  });
  assert.equal(node235.code, 'composition_marketplace_probe_node_runtime_unsupported');
  const missing = await runCompositionMarketplaceProbe({
    commerceRoot: '/missing-commerce', graphRoot: '/missing-graph',
    nodeVersion: '23.6.0', typescriptFeature: 'transform',
  }); assert.equal(missing.code, 'marketplace_probe_execution_failed');
});
test('fails closed when either executable cross-repository provider join fails', () => {
  const value = fixture();
  try {
    let report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: () => { throw new Error('admission failed'); },
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.ok, false);
    assert.equal(report.crossRepositoryContracts.admission.code, 'cross_repository_admission_probe_failed');
    report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: () => { throw new Error('marketplace failed'); },
    });
    assert.equal(report.ok, false);
    assert.equal(report.crossRepositoryContracts.marketplace.code, 'cross_repository_marketplace_probe_failed');
    let marketplaceCalled = false;
    report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: () => { marketplaceCalled = true; return acceptedMarketplaceProbe(); },
      nodeVersion: '20.11.0',
    });
    assert.equal(marketplaceCalled, false);
    assert.equal(
      report.crossRepositoryContracts.marketplace.code,
      'composition_marketplace_probe_node_runtime_unsupported',
    );
    assert(report.findings.some(item => item.component === 'agentic-os'
      && item.file === 'package.json'
      && item.code === 'composition_marketplace_probe_node_runtime_unsupported'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('preserves and attributes a typed marketplace owner blocker', () => {
  const value = fixture();
  try {
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: () => ({
        schema: 'agentic-os/composition-marketplace-cross-repository-probe/v1',
        ok: false,
        code: 'marketplace_control_route_authentication_required',
      }),
    });
    assert.equal(report.crossRepositoryContracts.marketplace.code, 'marketplace_control_route_authentication_required');
    assert(report.findings.some(item => item.component === 'agentic-graph'
      && item.file === 'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts'));
    assert.deepEqual(marketplaceProbeFindingTarget('marketplace_runtime_response_classifier_mismatch'),
      ['agentic-commerce-os', 'src/core/marketplace-provider-response.ts']);
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('default marketplace child failure ignores inherited Node loader options', (t) => {
  const value = fixture();
  try {
    const prior = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = '--import=/definitely/missing-composition-loader.mjs';
    t.after(() => prior === undefined
      ? delete process.env.NODE_OPTIONS : process.env.NODE_OPTIONS = prior);
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
    });
    assert.equal(report.crossRepositoryContracts.marketplace.code, 'marketplace_module_path_unreadable');
    assert(report.findings.some(item => item.component === 'agentic-os'
      && item.file === 'bin/composition-module-loader.mjs'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('rechecks component bytes after executable probes', () => {
  const value = fixture();
  try {
    const graphRuntime = path.join(value.roots['agentic-graph'], 'cloudflare/workers/runtime-helper.ts');
    writeFileSync(graphRuntime, 'initial dirty bytes');
    const inspectDirty = (root, component) => component === 'agentic-graph' ? {
      ...cleanGit(root, component), ok: false, clean: false, code: 'worktree_dirty',
      worktreeStateDigest: createHash('sha256').update(readFileSync(graphRuntime)).digest('hex'),
    } : cleanGit(root, component);
    const report = observeCompositionRuntime({
      roots: value.roots, inspectGit: inspectDirty, probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: () => {
        writeFileSync(graphRuntime, 'changed dirty bytes');
        return acceptedMarketplaceProbe();
      },
    });
    assert.equal(report.sourceCandidateClean, false);
    assert(report.findings.some(item => item.component === 'agentic-graph'
      && item.code === 'component_changed_during_probe'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('keeps the marketplace join observable while Commerce admission migration is blocked', () => {
  const value = fixture();
  try {
    let admissionCalled = false;
    let marketplaceCalled = false;
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: () => {
        admissionCalled = true;
        return blockedAdmissionProbe(
          'commerce_admission_consumer_migration_required',
          ['commerce', 'acos-admission-provider/v3'].join('.'),
        );
      },
      probeMarketplace: () => { marketplaceCalled = true; return acceptedMarketplaceProbe(); },
    });
    assert.equal(admissionCalled, true);
    assert.equal(marketplaceCalled, true);
    assert.equal(report.ok, false);
    assert.equal(
      report.crossRepositoryContracts.admission.code,
      'commerce_admission_consumer_migration_required',
    );
    assert.equal(report.crossRepositoryContracts.marketplace.ok, true);
    assert(report.findings.some(item => item.code === 'commerce_admission_consumer_migration_required'
      && item.file === 'src/core/acos-admission.ts'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('rejects incomplete success reports from injected probes', () => {
  const value = fixture();
  try {
    let report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: () => ({
        schema: 'agentic-os/composition-cross-repository-probe/v1',
        ok: true,
      }),
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.crossRepositoryContracts.admission.code, 'cross_repository_admission_probe_invalid');
    report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: () => ({
        schema: 'agentic-os/composition-marketplace-cross-repository-probe/v1',
        ok: true,
      }),
    });
    assert.equal(report.crossRepositoryContracts.marketplace.code, 'cross_repository_marketplace_probe_invalid');
    report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: () => blockedAdmissionProbe(
        'composition_admission_contract_identity_unreadable',
        null,
      ),
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(
      report.crossRepositoryContracts.admission.code,
      'composition_admission_contract_identity_unreadable',
    );
    assert(report.findings.some(item => item.component === 'agentic-commerce-os'
      && item.file === 'src/core/acos-admission.ts'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('retired admission probe validates the owner fixture and cannot claim runtime acceptance', async () => {
  const value = fixture();
  try {
    const input = {
      acosRoot: value.roots['agentic-canvas-os'],
      commerceRoot: value.roots['agentic-commerce-os'],
      graphRoot: value.roots['agentic-graph'],
      fixturePath: path.join(
        value.roots['agentic-canvas-os'],
        'test/contracts/agentic-os-admission-v2.fixture.json',
      ),
    };
    const report = await runCompositionAdmissionProbe(input);
    assert.equal(report.ok, false);
    assert.equal(report.code, 'composition_admission_fixture_digest_invalid');
    assert.equal(report.runtimeAcceptanceObserved, false);
    rmSync(input.fixturePath);
    mkdirSync(input.fixturePath);
    const nonRegular = await runCompositionAdmissionProbe(input);
    assert.equal(nonRegular.code, 'composition_admission_fixture_size_invalid');
    const probeSource = readFileSync(new URL('../bin/composition-admission-probe.mjs', import.meta.url), 'utf8');
    for (const retired of [
      ['commerce', 'acos-admission-provider/v3'].join('.'),
      ['commerce-acos', 'admission-auth/v1'].join('-'),
      ['acos-adapter', 'registration/v2'].join('-'),
      ['acos-cloudflare', 'deployment-identity/v1'].join('-'),
      'createCommerceOperatorInstructionResolver',
    ]) assert.equal(probeSource.includes(retired), false, retired);
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const commonDir = spawnSync(
  'git',
  ['-C', repositoryRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' },
);
const workspaceRoot = commonDir.status === 0
  ? path.dirname(path.dirname(commonDir.stdout.trim()))
  : null;
const liveMarketplaceRoots = workspaceRoot
  && existsSync(path.join(workspaceRoot, 'agentic-commerce-os'))
  && existsSync(path.join(workspaceRoot, 'agentic-graph'))
  ? {
      commerceRoot: path.join(workspaceRoot, 'agentic-commerce-os'),
      graphRoot: path.join(workspaceRoot, 'agentic-graph'),
    }
  : null;
const [liveNodeMajor, liveNodeMinor] = process.versions.node.split('.').map(Number);
const liveMarketplaceSupported = (liveNodeMajor > 22 || liveNodeMajor === 22 && liveNodeMinor >= 22) && ['strip', 'transform'].includes(process.features?.typescript);
test('executes the current marketplace producer against the actual Graph route', {
  skip: liveMarketplaceRoots === null || !liveMarketplaceSupported,
}, async () => {
  const report = await runCompositionMarketplaceProbe(liveMarketplaceRoots);
  assert.equal(report.schema, 'agentic-os/composition-marketplace-cross-repository-probe/v1');
  assert.equal(report.ok, false);
  assert.equal(report.code, 'marketplace_vendor_list_response_headers_invalid');
});
test('attributes the post-convergence admission probe blocker to agentic-os', () => {
  const value = fixture();
  try {
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: () => blockedAdmissionProbe('composition_admission_probe_reimplementation_required'),
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert.equal(report.ok, false);
    assert.equal(
      report.crossRepositoryContracts.admission.code,
      'composition_admission_probe_reimplementation_required',
    );
    assert(report.findings.some(item => item.component === 'agentic-os'
      && item.file === 'bin/composition-admission-probe.mjs'
      && item.code === 'composition_admission_probe_reimplementation_required'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
test('requires exact agentic-os pins and forbids consumer-owned workflow copies', () => {
  const value = fixture();
  try {
    const packagePath = path.join(value.roots['agentic-canvas-os'], 'package.json');
    writeFileSync(packagePath, harnessManifest(
      'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/main',
    ));
    let report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert(report.findings.some(item => item.component === 'agentic-canvas-os'
      && item.code === 'agentic_os_package_pin_invalid'));
    writeFileSync(packagePath, files['agentic-canvas-os']['package.json']);
    const copiedWorkflow = path.join(
      value.roots['agentic-commerce-os'],
      'docs/START-WORKFLOW.md',
    );
    mkdirSync(path.dirname(copiedWorkflow), { recursive: true });
    writeFileSync(copiedWorkflow, '# stale copy\n');
    report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeAdmission: acceptedAdmissionProbe,
      probeMarketplace: acceptedMarketplaceProbe,
    });
    assert(report.findings.some(item => item.component === 'agentic-commerce-os'
      && item.file === 'docs/START-WORKFLOW.md'
      && item.code === 'copied_workflow_asset_forbidden'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
