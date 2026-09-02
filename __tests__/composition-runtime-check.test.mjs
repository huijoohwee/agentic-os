import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  COMPOSITION_ACCEPTANCE_SCHEMA,
  normalizeRepositoryIdentity,
  observeCompositionRuntime,
} from '../bin/composition-runtime-check.mjs';

const files = Object.freeze({
  'agentic-os': {
    'guides/COMPOSITION-ARCHITECTURE.md': 'DIR-RUNTIME-READY-01 `agentic-canvas-os` `agentic-graph` `agentic-commerce-os` VCC-RUNTIME-AUTHORITY-02',
    'src/github-authority.mjs': "github-actions-fenced-authority agentic-os/github-authority-input/v1 source.event !== 'workflow_dispatch'",
    'src/github-authority-operation.mjs': 'authority_input_digest does not match the event payload and committed policy',
  },
  'agentic-canvas-os': {
    'agent-api/src/commerce-admission-contract.js': 'commerce.acos-admission-provider/v3 /internal/v2/adapter-registrations acos-adapter-registration/v2 commerce-acos-admission-auth/v1 x-acos-admission-auth-signature agentic-graph-authoring-operation/v1 operator://agentic-graph/commerce-adapter-admission/2026-09-03 authoring_mutation_intent x-authoring-reserved-at-ms',
    'agent-api/src/commerce-deployment-identity.js': 'acos-cloudflare-deployment-identity/v1 sourceRevision candidateDigest versionId versionTag versionTimestamp',
    'test/contracts/acos-admission-v2.fixture.sha256': '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44  acos-admission-v2.fixture.json',
    'wrangler.jsonc': 'ACOS_ADMISSION_AUTH_SECRET ACOS_UNMANAGED_BINDINGS_DIGEST',
    '.github/workflows/adlc-authority.yml': 'workflow_dispatch:\nauthority_input_digest:',
    '.github/workflows/production-release.yml': 'workflow_dispatch:\nenvironment:\nname: production\nacos-production-release.mjs prepare\nacos-production-release.mjs release',
    'scripts/acos-production-release-controller.mjs': 'baseline_unmanaged_binding_drift createPreserveReceipt rollbackIfBaseline',
  },
  'agentic-graph': {
    '.agentic-os.json': 'agentic-os/repository-profile/v1 github.com/huijoohwee/knowgrph Integration Gate quarantine-worktree-cleanup-opt-in',
    'package.json': '"land": "agentic-os land" "status": "agentic-os status" "queue:show": "agentic-os queue show" 89256623e4a09a4b8e337c9d3572593c0d188700',
    'docs/collaboration-runtime-contract.md': 'informational current-device projection delete_branch_on_merge:false',
    'cloudflare/workers/commerce-provider-contract.ts': 'commerce.discovery-provider/v1 commerce.checkout-provider/v1 commerce.marketplace-provider/v1 commerce.upstream-runtime-evidence/v1 x-commerce-provider-binding-digest AUTHORING_MUTATION_HEADER_NAMES x-authoring-reserved-at-ms agentic-graph-authoring-mutation-permit/v2 authoring_fence_atomic',
    'cloudflare/workers/commerce-provider-auth.ts': 'commerce-provider-auth/v1 x-commerce-provider-auth-schema x-commerce-provider-auth-signature verifyCommerceProviderControlRequest verifyCommerceProviderRequestAuthentication',
    'cloudflare/workers/commerce-marketplace-provider-response-contract.ts': 'commerce.marketplace-provider-response/v1 pending_review approved authoring_mutation_reconciliation_required',
    'cloudflare/workers/agenticgraph-mcp/commerce-discovery-provider.ts': 'commerce.discovery-receipt/v1 discovery_projection_unsupported',
    'cloudflare/workers/agenticgraph-travel-commerce/src/commerce-checkout-provider.ts': '/internal/v1/checkouts/prepare /internal/v1/checkouts/confirm operational_evidence_binding_invalid',
    'cloudflare/workers/agenticgraph-marketplace/src/commerce-provider.ts': 'vendor-transition-fenced settlement-read authoring_mutation_payload_mismatch verifyCommerceProviderRequestAuthentication MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agenticgraph-marketplace/wrangler.jsonc': 'MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agenticgraph-travel-commerce/wrangler.jsonc': 'CHECKOUT_PROVIDER_AUTH_SECRET MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agenticgraph-travel-commerce/src/provider-runtime-proof.ts': 'authenticateCommerceProviderControlRequest CHECKOUT_PROVIDER_AUTH_SECRET MARKETPLACE_PROVIDER_AUTH_SECRET',
    'scripts/travel-mesh-release.mjs': "environment.GITHUB_WORKFLOW !== 'Production Release' agentic-human-authorization-receipt/v2 consumed exact-candidate human authorization receipt",
  },
  'agentic-commerce-os': {
    'src/core/acos-admission.ts': 'commerce.acos-admission-provider/v3 /internal/v2/adapter-registrations acos-adapter-registration/v2 acos-cloudflare-deployment-identity/v1 operator://agentic-graph/commerce-adapter-admission/2026-09-03 authoring_mutation_intent',
    'src/core/authoring-mutation-headers.ts': 'x-authoring-reserved-at-ms',
    'src/core/provider-contract.ts': 'commerce.discovery-provider/v1 commerce.checkout-provider/v1 commerce.marketplace-provider/v1',
    'src/core/upstream-evidence.ts': 'commerce.upstream-runtime-evidence/v1 invocation_catalog_parity guardrail_before_confirmation authoring_fence_atomic',
    'src/core/provider-operation-gate.ts': 'x-commerce-provider-binding-digest MAXIMUM_OPERATION_BODY_BYTES = 65_536 bindAuthenticatedProviderRequest verifyCommerceProviderRequestAuthentication',
    'src/shared/commerce-provider-auth.ts': 'commerce-provider-auth/v1 x-commerce-provider-auth-schema x-commerce-provider-auth-signature',
    'src/core/marketplace-transition-request.ts': 'prepareAuthenticatedMarketplaceVendorTransitionRequest authoringMutationHeaders bindAuthenticatedProviderRequest',
    'src/core/marketplace-provider-response-contract.ts': 'commerce.marketplace-provider-response/v1 pending_review approved authoring_mutation_reconciliation_required',
    'test/contracts/acos-admission-v2.fixture.json': 'commerce.acos-admission-v2-request-fixture/v1 7aa02c58765d6e16787fbe0b1320ed37d7f0ef610f9ba55a1ab2f56e69d583ee agent-acceptance-fixture commerce-acos-admission-auth/v1',
    'test/contracts/acos-admission-v2.fixture.sha256': '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44  acos-admission-v2.fixture.json',
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
  }
  return { base, roots };
}

const repositoryIdentity = Object.freeze({
  'agentic-os': 'huijoohwee/agentic-os',
  'agentic-canvas-os': 'huijoohwee/agentic-canvas-os',
  'agentic-graph': 'huijoohwee/knowgrph',
  'agentic-commerce-os': 'huijoohwee/agentic-commerce-os',
});
const cleanGit = (root, component) => ({
  ok: true,
  clean: true,
  revision: 'a'.repeat(40),
  repositoryIdentity: repositoryIdentity[component],
  code: null,
});
const acceptedContractsProbe = () => Object.freeze({
  schema: 'agentic-os/composition-cross-repository-probe/v1',
  ok: true,
  fixtureSchema: 'commerce.acos-admission-v2-request-fixture/v1',
  fixtureDigest: '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44',
  providerContract: 'commerce.acos-admission-provider/v3',
  consumerContract: 'commerce.acos-admission-provider/v3',
  consumerValidated: true,
  productionProjectionValidated: true,
  admissionAuthenticationValidated: true,
  extraKeyDriftRejected: true,
  deploymentIdentityValidated: true,
  receiptSchema: 'acos-adapter-registration/v2',
  requestDigest: '7aa02c58765d6e16787fbe0b1320ed37d7f0ef610f9ba55a1ab2f56e69d583ee',
  replayWriteCount: 0,
  restartReady: true,
  marketplaceContract: 'commerce.marketplace-provider/v1',
  marketplaceProducerConsumerValidated: true,
  marketplaceControlAuthenticationValidated: true,
  marketplaceOperationAuthenticationValidated: true,
  marketplaceAuthoringHeaderCount: 12,
  marketplaceResponseContractValidated: true,
  marketplaceTamperRejected: true,
  marketplaceRequestDigest: 'b'.repeat(64),
  marketplaceBindingDigest: 'c'.repeat(64),
});

test('observes exact four-component source and protected-boundary contracts without inventing authority', () => {
  const value = fixture();
  try {
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeContracts: acceptedContractsProbe,
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
    assert.equal(report.components['agentic-graph'].repositoryIdentity, 'huijoohwee/knowgrph');
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
      probeContracts: acceptedContractsProbe,
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
      probeContracts: acceptedContractsProbe,
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

test('rejects a foreign repository identity and duplicate component roots', () => {
  const value = fixture();
  try {
    let report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: (root, component) => component === 'agentic-graph'
        ? { ok: false, clean: false, revision: 'a'.repeat(40), repositoryIdentity: 'foreign/repository', code: 'git_origin_unexpected' }
        : cleanGit(root, component),
      probeContracts: acceptedContractsProbe,
    });
    assert.equal(report.sourceContractsReady, false);
    assert(report.findings.some(item => item.component === 'agentic-graph' && item.code === 'git_origin_unexpected'));

    report = observeCompositionRuntime({
      roots: { ...value.roots, 'agentic-commerce-os': value.roots['agentic-os'] },
      inspectGit: cleanGit,
      probeContracts: acceptedContractsProbe,
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

test('fails closed when either executable cross-repository provider join fails', () => {
  const value = fixture();
  try {
    const report = observeCompositionRuntime({
      roots: value.roots,
      inspectGit: cleanGit,
      probeContracts: () => ({ ok: false, code: 'cross_repository_contract_probe_failed' }),
    });
    assert.equal(report.ok, false);
    assert.equal(report.sourceContractsReady, false);
    assert.equal(report.sourceCandidateClean, false);
    assert.equal(report.crossRepositoryContracts.ok, false);
    assert(report.findings.some(item => item.code === 'cross_repository_contract_probe_failed'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});
