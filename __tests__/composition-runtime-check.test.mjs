import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compositionRevision, readCompositionHeadFile,
  TRUSTED_COMPOSITION_GIT } from '../bin/composition-git.mjs';
import {
  COMPOSITION_ACCEPTANCE_SCHEMA, compositionHarnessPinIsAncestor,
  exactAgenticOsPackagePin, inspectGitWorktree, normalizeRepositoryIdentity,
  observeCompositionRuntime, parseAgenticOsLockfilePin,
} from '../bin/composition-runtime-check.mjs';
import {
  COMPOSITION_SOURCE_LOCK_SCHEMA, executeCompositionSourceLock,
  inspectCompositionSourceLock, validCompositionSourceLock, validCompositionSourceLockReport,
} from '../bin/composition-source-lock.mjs';
import { runCompositionAdmissionProbe } from '../bin/composition-admission-probe.mjs';

const tarballPin = `https://codeload.github.com/huijoohwee/agentic-os/tar.gz/${'a'.repeat(40)}`;
const githubPin = `github:huijoohwee/agentic-os#${'b'.repeat(40)}`;
const harnessManifest = pin => JSON.stringify({
  engines: { node: '>=22.22.0' },
  scripts: { lane: 'agentic-os start', land: 'agentic-os land', reap: 'agentic-os reap' },
  devDependencies: { 'agentic-os': pin },
});
const files = Object.freeze({
  'agentic-os': {
    'guides/COMPOSITION-ARCHITECTURE.md': 'DIR-RUNTIME-READY-01 `agentic-canvas-os` `agentic-graph` `agentic-commerce-os` VCC-RUNTIME-AUTHORITY-02',
    'src/github-authority.mjs': "github-actions-fenced-authority agentic-os/github-authority-input/v1 source.event !== 'workflow_dispatch'",
    'src/github-authority-operation.mjs': 'authority_input_digest does not match the event payload and committed policy',
    'bin/composition-git.mjs': 'TRUSTED_COMPOSITION_GIT GIT_CONFIG_NOSYSTEM /usr/bin/git',
    'bin/composition-runtime-check.mjs': 'agentic_os_runtime_root_mismatch component_changed_during_inspection candidateCodeExecuted: false',
    'bin/composition-admission-probe.mjs': 'agentic-os/composition-static-admission-interface/v1 without evaluating either owner',
    'bin/composition-deployment-topology.mjs': 'agentic-os/composition-deployment-topology/v1 commerce_production_service_target_mismatch',
    'catalog/composition-source-lock.json': 'agentic-os/composition-source-lock/v1 commerce.agentic-os-admission-provider/v3',
  },
  'agentic-canvas-os': {
    'package.json': harnessManifest(tarballPin),
    'agent-api/src/commerce-admission-contract.js': 'commerce.agentic-os-admission-provider/v3 /agentic-os/internal/v2/adapter-registrations agentic-os-adapter-registration/v2 commerce-agentic-os-admission-auth/v1 x-agentic-os-admission-auth-signature x-agentic-os-serving-deployment-identity agentic-os-authoring-operation/v1 authority://agentic-graph/commerce-admission/ authoring_mutation_intent x-authoring-reserved-at-ms',
    'agent-api/src/commerce-admission-authority.js': 'agentic-graph-commerce-admission-authority/v1 createCommerceAdmissionAuthority authority_unconfigured authority_expired',
    'agent-api/src/commerce-admission-provider.js': 'createCommerceAdmissionProvider agentic-os-adapter-registration-finding/v1 agentic-os-admission.internal runtime_unconfigured',
    'agent-api/src/commerce-deployment-identity.js': 'acos-cloudflare-deployment-identity/v1 resolveCommerceDeploymentIdentity',
    'test/contracts/agentic-os-admission-v2.fixture.sha256': 'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0 agentic-os-admission-v2.fixture.json',
    'wrangler.jsonc': 'AGENT_STATE AGENTIC_OS_ADMISSION_AUTH_SECRET AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET CF_VERSION_METADATA ACOS_SOURCE_REVISION ACOS_CANDIDATE_DIGEST',
    '.github/workflows/production-release.yml': 'workflow_dispatch: environment: production authorized_release_candidate_json graph_authority_evidence_digest npm run web:build acos-production-release-controller.mjs',
    'scripts/acos-production-release-contract.mjs': 'acos-production-release-candidate/v1 acos-production-preserve-required-receipt/v1 validateProductionReleaseCandidate reuse-exact-candidate-version https://airvio.co',
    'scripts/acos-production-release-controller.mjs': 'executeAcosProductionRelease createPreserveReceipt probeProductionReadiness findVersionsByTag readVersionById',
    'scripts/acos-production-release-live.mjs': 'createCandidateFromProtectedMain validateGraphAuthorityEvidence webArtifactDigest CommerceAdmissionProbe',
    'agent-api/src/commerce-release-proof.js': 'createCommerceReleaseProofHandler readCommerceReleaseProofEnvelope agentic-os-admission.internal',
    '.github/workflows/adlc-authority.yml': 'workflow_dispatch: authority_input_digest:',
  },
  'agentic-graph': {
    '.agentic-os.json': 'agentic-os/repository-profile/v1 github.com/huijoohwee/agentic-graph Integration Gate quarantine-worktree-cleanup-opt-in',
    'package.json': harnessManifest(githubPin),
    'docs/collaboration-runtime-contract.md': 'informational current-device projection delete_branch_on_merge:false',
    'cloudflare/workers/commerce-provider-contract.ts': 'commerce.discovery-provider/v1 commerce.checkout-provider/v1 commerce.marketplace-provider/v1 commerce.upstream-runtime-evidence/v1 x-commerce-provider-binding-digest AUTHORING_MUTATION_HEADER_NAMES x-authoring-reserved-at-ms agentic-graph-authoring-mutation-permit/v2 authoring_fence_atomic',
    'cloudflare/workers/commerce-provider-auth.ts': 'commerce-provider-auth/v1 x-commerce-provider-auth-schema x-commerce-provider-auth-signature verifyCommerceProviderControlRequest verifyCommerceProviderRequestAuthentication',
    'cloudflare/workers/commerce-marketplace-provider-response-contract.ts': 'commerce.marketplace-provider-response/v1 pending_review approved authoring_mutation_reconciliation_required',
    'cloudflare/workers/agentic-graph-mcp/commerce-discovery-provider.ts': 'commerce.discovery-receipt/v1 discovery_projection_unsupported',
    'cloudflare/workers/agentic-graph-mcp/wrangler.toml': 'name = "agentic-mcp"',
    'cloudflare/workers/agentic-graph-travel-commerce/src/commerce-checkout-provider.ts': '/internal/v1/checkouts/prepare /internal/v1/checkouts/confirm operational_evidence_binding_invalid',
    'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts': 'vendor-transition-fenced settlement-read authoring_mutation_payload_mismatch verifyCommerceProviderRequestAuthentication MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agentic-graph-marketplace/wrangler.jsonc': 'MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agentic-graph-travel-commerce/wrangler.jsonc': 'CHECKOUT_PROVIDER_AUTH_SECRET MARKETPLACE_PROVIDER_AUTH_SECRET',
    'cloudflare/workers/agentic-graph-travel-commerce/src/provider-runtime-proof.ts': 'authenticateCommerceProviderControlRequest CHECKOUT_PROVIDER_AUTH_SECRET MARKETPLACE_PROVIDER_AUTH_SECRET',
    'scripts/travel-mesh-release.mjs': "environment.GITHUB_WORKFLOW !== 'Production Release' agentic-human-authorization-receipt/v2 consumed exact-candidate human authorization receipt",
  },
  'agentic-commerce-os': {
    'package.json': harnessManifest(tarballPin),
    'src/core/acos-admission.ts': 'ACOS_ADMISSION_PROVIDER_CONTRACT ACOS_ADMISSION_PATH ACOS_ADMISSION_RECEIPT_SCHEMA x-agentic-os-serving-deployment-identity acos_admission_serving_identity_invalid authoring_mutation_intent',
    'src/core/acos-deployment-identity.ts': 'acos-cloudflare-deployment-identity/v1 readAcosDeploymentIdentity',
    'src/core/authoring-mutation-headers.ts': 'x-authoring-reserved-at-ms',
    'src/core/provider-contract.ts': 'commerce.discovery-provider/v1 commerce.checkout-provider/v1 commerce.marketplace-provider/v1',
    'src/core/upstream-evidence.ts': 'commerce.upstream-runtime-evidence/v1 invocation_catalog_parity guardrail_before_confirmation authoring_fence_atomic',
    'src/core/provider-operation-gate.ts': 'x-commerce-provider-binding-digest MAXIMUM_OPERATION_BODY_BYTES = 65_536 bindAuthenticatedProviderRequest verifyCommerceProviderRequestAuthentication',
    'src/shared/commerce-provider-auth.ts': 'commerce-provider-auth/v1 x-commerce-provider-auth-schema x-commerce-provider-auth-signature',
    'src/core/marketplace-transition-request.ts': 'prepareAuthenticatedMarketplaceVendorTransitionRequest authoringMutationHeaders bindAuthenticatedProviderRequest',
    'src/core/marketplace-provider-response-contract.ts': 'commerce.marketplace-provider-response/v1 pending_review approved authoring_mutation_reconciliation_required',
    '.github/workflows/production-release.yml': 'workflow_dispatch: environment: production human-authorization.json human-authorization.ts prior-release-authority.json recovery-release-authority.json run-production-release.ts if: ${{ success() }} if: ${{ failure() }}',
    'scripts/production-release/production-controller.ts': 'executeProductionRelease recovery preserve recovery_authenticated_preserve_receipt_required',
    'config/production-core-services.json': 'agentic-commerce-production-core-services/v1 ACOS_ADMISSION MARKETPLACE_PROVIDER',
    'scripts/production-release/core-services-manifest.ts': 'PRODUCTION_CORE_SERVICES_MANIFEST_SCHEMA PRODUCTION_CORE_SERVICES_SNAPSHOT',
    'scripts/production-release/contracts.ts': 'PRODUCTION_CORE_SERVICES_SNAPSHOT assertProductionCoreServicesManifestCurrent',
    'wrangler.core.jsonc': '"production" "services" AGENTIC_OS_ADMISSION_AUTH_SECRET',
    'wrangler.edge.jsonc': 'airvio.co/agentic-commerce-os*',
    'wrangler.sandbox.jsonc': 'agentic-commerce-sandbox-production',
  },
});
const identities = Object.freeze(Object.fromEntries(Object.keys(files)
  .map(component => [component, `huijoohwee/${component}`])));

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'composition-runtime-')), roots = {};
  for (const [component, entries] of Object.entries(files)) {
    const root = path.join(base, component); roots[component] = root; mkdirSync(root);
    for (const [file, source] of Object.entries(entries)) {
      const target = path.join(root, file); mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    git(root, ['init', '-q']); git(root, ['add', '.']);
    git(root, ['-c', 'user.name=Composition Test',
      '-c', 'user.email=composition@example.invalid', 'commit', '-qm', 'fixture']);
  }
  return { base, roots };
}
function git(cwd, args, options = {}) {
  const result = spawnSync(TRUSTED_COMPOSITION_GIT, args, { cwd, encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function gitState(clean = true) {
  return (root, component) => { const revision = compositionRevision(root); return ({
    ok: clean, clean, revision,
    repositoryIdentity: identities[component], tree: git(root, ['rev-parse', `${revision}^{tree}`]),
    worktreeStateDigest: 'c'.repeat(64), code: clean ? null : 'worktree_dirty' });
  };
}
const injectedAdmission = () => Object.freeze({
  schema: 'agentic-os/composition-static-admission-interface/v1', ok: true,
  staticInterfaceObserved: true, sourceArtifactsBound: true,
  fixtureSchema: 'commerce.agentic-os-admission-v2-request-fixture/v1',
  fixtureDigest: 'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0',
  providerFixtureBlob: 'd'.repeat(40), consumerFixtureBlob: 'd'.repeat(40),
  governingContract: 'commerce.agentic-os-admission-provider/v3',
  providerContractBlob: 'e'.repeat(40), consumerContractBlob: 'f'.repeat(40),
  effectWriterIdentitySchema: 'acos-cloudflare-deployment-identity/v1',
  servingIdentityHeader: 'x-agentic-os-serving-deployment-identity',
});
const injectedTopology = () => Object.freeze({
  schema: 'agentic-os/composition-deployment-topology/v1', ok: true,
  candidateCodeExecuted: false, topologyManifestDigest: '1'.repeat(64),
  topologyManifestBlob: '2'.repeat(40),
  expectedServices: {}, configuredServices: {}, releaseServices: {}, findings: [],
});
const injectedLock = () => Object.freeze({
  schema: COMPOSITION_SOURCE_LOCK_SCHEMA, ok: true, candidateCodeExecuted: false,
  ownerTreesMatched: true, artifactBlobsMatched: true,
  admissionFixtureDigest: 'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0',
  marketplaceContract: 'commerce.marketplace-provider/v1',
  topologyManifestDigest: '1'.repeat(64), topologyManifestBlob: '2'.repeat(40),
  lockDigest: '3'.repeat(64),
});

test('injected inspectors are visibly non-authoritative and can never report readiness', () => {
  const value = fixture();
  try {
    const report = observeCompositionRuntime({ roots: value.roots, inspectGit: gitState(),
      inspectAdmissionInterface: injectedAdmission, inspectDeploymentTopology: injectedTopology,
      inspectSourceLock: injectedLock });
    assert.equal(report.schema, COMPOSITION_ACCEPTANCE_SCHEMA);
    assert.equal(report.observationMode, 'injected-test');
    assert.equal(report.ok, false);
    assert.equal(report.sourceInterfaceContractsReady, false);
    assert.equal(report.sourceCandidateReviewReady, false);
    assert.equal(report.productionRuntimeReady, false);
    assert.equal(report.sourceInterfaces.evidenceClass, 'injected-test-observation');
    assert(report.deliveryBlockers.includes('native_composition_observation_not_used'));
    assert.equal(report.ownerSuiteEvidenceObserved, false);
    assert.equal(report.protectedOwnerEvidenceObserved, false);
    assert(report.findings.some(item => item.code === 'agentic_os_package_pin_unresolved'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});

test('contract drift prevents static inspection and dirty injected state remains non-ready', () => {
  const value = fixture(); let called = 0;
  try {
    writeFileSync(path.join(value.roots['agentic-graph'],
      'cloudflare/workers/commerce-provider-contract.ts'), 'drift');
    let report = observeCompositionRuntime({ roots: value.roots, inspectGit: gitState(),
      inspectAdmissionInterface: () => { called += 1; return injectedAdmission(); } });
    assert.equal(called, 0);
    assert(report.findings.some(item => item.component === 'agentic-graph'
      && item.code === 'contract_file_bytes_unbound'));
    assert.equal(report.sourceContractMarkersObserved, false);
    writeFileSync(path.join(value.roots['agentic-graph'],
      'cloudflare/workers/commerce-provider-contract.ts'),
    files['agentic-graph']['cloudflare/workers/commerce-provider-contract.ts']);
    report = observeCompositionRuntime({ roots: value.roots, inspectGit: gitState(false),
      inspectAdmissionInterface: injectedAdmission,
      inspectDeploymentTopology: injectedTopology, inspectSourceLock: injectedLock });
    assert.equal(report.sourceCandidateClean, false);
    assert.equal(report.ok, false);
    assert(report.deliveryBlockers.includes('source_candidate_not_clean'));
  } finally { rmSync(value.base, { recursive: true, force: true }); }
});

test('source-lock result validators reject extra keys and injectable evidence', () => {
  const report = injectedLock();
  assert.equal(validCompositionSourceLockReport(report), true);
  assert.equal(validCompositionSourceLockReport({ ...report, extra: true }), false);
  assert.equal(executeCompositionSourceLock(injectedLock, {}, {}).ok, false);
  assert.equal(executeCompositionSourceLock(injectedLock, {}, {}).code,
    'composition_source_lock_report_invalid');
  assert.equal(executeCompositionSourceLock(inspectCompositionSourceLock, {}, {}).code,
    'composition_source_lock_unreadable');
});

test('source lock requires identical responses and audited full-file marketplace blobs', () => {
  const lock = JSON.parse(readFileSync(new URL('../catalog/composition-source-lock.json',
    import.meta.url), 'utf8'));
  assert.equal(validCompositionSourceLock(lock), true);
  lock.artifacts.marketplaceProviderResponse.blob = '9'.repeat(40);
  assert.equal(validCompositionSourceLock(lock), false);
  const refreshed = JSON.parse(readFileSync(new URL('../catalog/composition-source-lock.json',
    import.meta.url), 'utf8'));
  refreshed.artifacts.marketplaceConsumerAuthoringHeaders.blob = '8'.repeat(40);
  assert.equal(validCompositionSourceLock(refreshed), false);
});

test('agentic-os package pins are singular and resolve only to harness ancestors', () => {
  assert.equal(exactAgenticOsPackagePin(harnessManifest(tarballPin),
    'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/'), 'a'.repeat(40));
  const conflicting = JSON.stringify({ dependencies: { 'agentic-os': tarballPin },
    devDependencies: { 'agentic-os': tarballPin } });
  assert.equal(exactAgenticOsPackagePin(conflicting,
    'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/'), null);
  const resolvedPrefix = 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/';
  const lock = { lockfileVersion: 3, requires: true, packages: {
    '': { devDependencies: { 'agentic-os': tarballPin } },
    'node_modules/agentic-os': { resolved: `${resolvedPrefix}${'a'.repeat(40)}`,
      integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}` },
  } };
  assert.equal(parseAgenticOsLockfilePin(
    JSON.stringify(lock), resolvedPrefix, resolvedPrefix, 'a'.repeat(40),
  )?.agenticOsPin, 'a'.repeat(40));
  lock.packages['node_modules/agentic-os'].resolved = `${resolvedPrefix}${'b'.repeat(40)}`;
  assert.equal(parseAgenticOsLockfilePin(
    JSON.stringify(lock), resolvedPrefix, resolvedPrefix, 'a'.repeat(40),
  ), null);
  const root = mkdtempSync(path.join(tmpdir(), 'composition-harness-pin-'));
  try {
    git(root, ['init', '-q']); git(root, ['config', 'user.name', 'Composition Test']);
    git(root, ['config', 'user.email', 'composition@example.invalid']);
    writeFileSync(path.join(root, 'tracked.txt'), 'base\n'); git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '-qm', 'base']); const base = git(root, ['rev-parse', 'HEAD']);
    writeFileSync(path.join(root, 'tracked.txt'), 'head\n'); git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '-qm', 'head']); const head = git(root, ['rev-parse', 'HEAD']);
    const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
    const divergent = git(root, ['commit-tree', tree, '-m', 'divergent']);
    assert.equal(compositionHarnessPinIsAncestor(root, base, head), true);
    assert.equal(compositionHarnessPinIsAncestor(root, divergent, head), false);
    const identity = 'Composition Test <composition@example.invalid> 1 +0000';
    const malformedResult = spawnSync(TRUSTED_COMPOSITION_GIT,
      ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: root, encoding: 'utf8',
        input: `tree ${tree}\nauthor ${identity}\ncommitter ${identity}\nparent ${divergent}\n\nmalformed\n` });
    assert.equal(malformedResult.status, 0, malformedResult.stderr);
    assert.equal(compositionHarnessPinIsAncestor(root, divergent,
      malformedResult.stdout.trim()), false);
    const graft = path.resolve(root, git(root, ['rev-parse', '--git-path', 'info/grafts']));
    mkdirSync(path.dirname(graft), { recursive: true });
    writeFileSync(graft, `${head} ${divergent}\n`);
    assert.equal(compositionHarnessPinIsAncestor(root, divergent, head), false);
    assert.equal(compositionHarnessPinIsAncestor(root, 'f'.repeat(40), head), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repository identity parser accepts only exact GitHub repository URLs', () => {
  for (const value of ['https://github.com/huijoohwee/agentic-os.git',
    'ssh://git@github.com/huijoohwee/agentic-os.git',
    'git@github.com:huijoohwee/agentic-os.git']) {
    assert.equal(normalizeRepositoryIdentity(value), 'huijoohwee/agentic-os');
  }
  for (const value of ['https://evilgithub.com/huijoohwee/agentic-os.git',
    'file:///tmp/github.com/huijoohwee/agentic-os.git',
    'https://github.com/huijoohwee/agentic-os/extra.git']) {
    assert.equal(normalizeRepositoryIdentity(value), null);
  }
});

test('composition Git ignores a hostile PATH shim', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'composition-git-path-'));
  const repository = path.join(base, 'repository'), shim = path.join(base, 'shim');
  mkdirSync(repository); mkdirSync(shim);
  try {
    git(repository, ['init', '-q']);
    git(repository, ['config', 'user.name', 'Composition Test']);
    git(repository, ['config', 'user.email', 'composition@example.invalid']);
    git(repository, ['remote', 'add', 'origin', 'https://github.com/huijoohwee/agentic-os.git']);
    writeFileSync(path.join(repository, 'tracked.txt'), 'bound\n');
    git(repository, ['add', 'tracked.txt']); git(repository, ['commit', '-qm', 'fixture']);
    writeFileSync(path.join(shim, 'git'), '#!/bin/sh\necho forged\n');
    chmodSync(path.join(shim, 'git'), 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${shim}:${previous ?? ''}`;
    try {
      const report = inspectGitWorktree(repository, 'agentic-os', 'huijoohwee/agentic-os');
      assert.equal(report.ok, true);
      assert.match(report.revision, /^[0-9a-f]{40}$/u);
    } finally { if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous; }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('origin inspection rejects raw and effective fetch or push ambiguity', () => {
  for (const mode of ['insteadOf', 'reverseInsteadOf', 'includeFetch', 'includePush',
    'duplicate', 'empty', 'push', 'worktree']) {
    const root = mkdtempSync(path.join(tmpdir(), 'composition-origin-'));
    const includePath = `${root}.include`;
    try {
      git(root, ['init', '-q']); git(root, ['config', 'user.name', 'Composition Test']);
      git(root, ['config', 'user.email', 'composition@example.invalid']);
      writeFileSync(path.join(root, 'tracked.txt'), 'bound\n'); git(root, ['add', 'tracked.txt']);
      git(root, ['commit', '-qm', 'fixture']);
      if (mode === 'insteadOf') {
        git(root, ['remote', 'add', 'origin', 'evil://attacker.invalid/repository']);
        git(root, ['config', 'url.https://github.com/huijoohwee/agentic-os.insteadOf',
          'evil://attacker.invalid/repository']);
      } else {
        git(root, ['remote', 'add', 'origin', 'https://github.com/huijoohwee/agentic-os.git']);
        if (mode === 'reverseInsteadOf') git(root, [
          'config', 'url.https://attacker.invalid/mirror.insteadOf',
          'https://github.com/huijoohwee/agentic-os.git',
        ]);
        else if (mode === 'includeFetch' || mode === 'includePush') {
          writeFileSync(includePath, mode === 'includeFetch'
            ? '[remote "origin"]\n\turl = https://github.com/attacker/decoy.git\n'
            : '[remote "origin"]\n\tpushurl = https://github.com/attacker/push.git\n');
          git(root, ['config', 'include.path', includePath]);
        } else if (mode === 'duplicate' || mode === 'empty') git(root, [
          'config', '--add', 'remote.origin.url', mode === 'empty'
            ? '' : 'https://github.com/huijoohwee/agentic-os.git',
        ]);
        else if (mode === 'push') git(root, ['config', 'remote.origin.pushurl',
          'https://github.com/huijoohwee/agentic-os.git']);
        else {
          git(root, ['config', 'extensions.worktreeConfig', 'true']);
          git(root, ['config', '--worktree', 'remote.origin.url',
            'https://github.com/attacker/decoy.git']);
        }
      }
      const report = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
      assert.equal(report.ok, false);
      assert.equal(report.code, 'git_origin_unexpected');
    } finally { rmSync(root, { recursive: true, force: true });
      rmSync(includePath, { force: true }); }
  }
});

test('tracked source reads stay bound to the initially captured revision', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'composition-revision-'));
  try {
    git(root, ['init', '-q']); git(root, ['config', 'user.name', 'Composition Test']);
    git(root, ['config', 'user.email', 'composition@example.invalid']);
    writeFileSync(path.join(root, 'contract.mjs'), 'export const value = 1\n');
    git(root, ['add', 'contract.mjs']); git(root, ['commit', '-qm', 'first']);
    const captured = compositionRevision(root);
    writeFileSync(path.join(root, 'contract.mjs'), 'export const value = 2\n');
    git(root, ['add', 'contract.mjs']); git(root, ['commit', '-qm', 'second']);
    assert.notEqual(compositionRevision(root), captured);
    assert.throws(() => readCompositionHeadFile(
      root, captured, 'contract.mjs', 1_024, 'captured test',
    ), error => error?.code === 'composition_head_file_bytes_unbound');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('standalone admission observer rejects lookalike Git roots before reading artifacts', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'composition-admission-origin-'));
  const acos = path.join(base, 'acos'), commerce = path.join(base, 'commerce');
  mkdirSync(acos); mkdirSync(commerce);
  try {
    for (const root of [acos, commerce]) { git(root, ['init', '-q']);
      git(root, ['remote', 'add', 'origin', 'https://github.com/attacker/lookalike.git']); }
    const report = runCompositionAdmissionProbe({ acosRoot: acos, commerceRoot: commerce });
    assert.equal(report.ok, false);
    assert.equal(report.code, 'composition_admission_owner_root_invalid');
    assert.equal(report.owner, 'agentic-canvas-os');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('standalone admission observer rejects an effective-origin rewrite', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'composition-admission-rewrite-'));
  const acos = path.join(base, 'acos'), commerce = path.join(base, 'commerce');
  mkdirSync(acos); mkdirSync(commerce);
  try {
    for (const [root, repository] of [[acos, 'agentic-canvas-os'],
      [commerce, 'agentic-commerce-os']]) {
      git(root, ['init', '-q']);
      git(root, ['remote', 'add', 'origin', `https://github.com/huijoohwee/${repository}.git`]);
    }
    git(acos, ['config', 'url.https://attacker.invalid/mirror.insteadOf',
      'https://github.com/huijoohwee/agentic-canvas-os.git']);
    const report = runCompositionAdmissionProbe({ acosRoot: acos, commerceRoot: commerce });
    assert.equal(report.ok, false);
    assert.equal(report.code, 'composition_admission_owner_root_invalid');
    assert.equal(report.owner, 'agentic-canvas-os');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
