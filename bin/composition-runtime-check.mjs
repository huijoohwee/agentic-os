import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { compositionOriginUrl, observeCompositionGit,
  readCompositionHeadFile } from './composition-git.mjs';
import { decodeNulFields, gitBlobOid } from '../src/git-tracked.mjs';
import { COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA, compositionDeploymentTopologyRuntimeFindings, executeCompositionDeploymentTopology, inspectCompositionDeploymentTopology } from './composition-deployment-topology.mjs';
import { COMPOSITION_ADMISSION_PROBE_SCHEMA, isValidCompositionAdmissionInterfaceReport, runCompositionAdmissionProbe } from './composition-admission-probe.mjs';
import { COMPOSITION_SOURCE_LOCK_SCHEMA, executeCompositionSourceLock, inspectCompositionSourceLock } from './composition-source-lock.mjs';
export const COMPOSITION_ACCEPTANCE_SCHEMA = 'agentic-os/composition-source-acceptance/v2';
export { COMPOSITION_SOURCE_LOCK_SCHEMA, inspectCompositionSourceLock } from './composition-source-lock.mjs';
const PACKAGE_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url))), MAX_CONTRACT_BYTES = 500_000;
const SNAPSHOT_LIMITS = Object.freeze({ tracked: 10_000, trackedBytes: 134_217_728, fileBytes: 1_048_576, untracked: 512, inventoryBytes: 4_194_304, pathBytes: 262_144, contentBytes: 500_000 });
const CONTRACT = Object.freeze({
  'agentic-os': Object.freeze([
    requirement('guides/COMPOSITION-ARCHITECTURE.md', ['DIR-RUNTIME-READY-01',
      '`agentic-canvas-os`', '`agentic-graph`', '`agentic-commerce-os`', 'VCC-RUNTIME-AUTHORITY-02']),
    requirement('src/github-authority.mjs', ['github-actions-fenced-authority', 'agentic-os/github-authority-input/v1', "source.event !== 'workflow_dispatch'"]),
    requirement('src/github-authority-operation.mjs', ['authority_input_digest does not match the event payload and committed policy']),
    requirement('bin/composition-runtime-check.mjs', ['agentic_os_runtime_root_mismatch',
      'component_changed_during_inspection', 'candidateCodeExecuted: false']),
    requirement('bin/composition-admission-probe.mjs', [
      'agentic-os/composition-static-admission-interface/v1', 'without evaluating either owner']),
    requirement('bin/composition-git.mjs', [
      'TRUSTED_COMPOSITION_GIT', 'GIT_CONFIG_NOSYSTEM', '/usr/bin/git']),
    requirement('catalog/composition-source-lock.json', [
      'agentic-os/composition-source-lock/v1', 'commerce.agentic-os-admission-provider/v3']),
    requirement('bin/composition-deployment-topology.mjs', [
      'agentic-os/composition-deployment-topology/v1', 'commerce_production_service_target_mismatch']),
  ]),
  'agentic-canvas-os': Object.freeze([
    requirement('package.json', ['"agentic-os": "https://codeload.github.com/huijoohwee/agentic-os/tar.gz/',
      '"lane": "agentic-os start"', '"land": "agentic-os land"', '"reap": "agentic-os reap"'],
    { agenticOsPinPrefix: 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/',
      agenticOsResolvedPrefix: 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/' }),
    requirement('agent-api/src/commerce-admission-contract.js', [
      'commerce.agentic-os-admission-provider/v3', '/agentic-os/internal/v2/adapter-registrations',
      'agentic-os-adapter-registration/v2', 'commerce-agentic-os-admission-auth/v1',
      'x-agentic-os-admission-auth-signature', 'x-agentic-os-serving-deployment-identity', 'agentic-os-authoring-operation/v1', 'authority://agentic-graph/commerce-admission/', 'authoring_mutation_intent', 'x-authoring-reserved-at-ms']),
    requirement('agent-api/src/commerce-admission-authority.js', [
      'agentic-graph-commerce-admission-authority/v1', 'createCommerceAdmissionAuthority',
      'authority_unconfigured', 'authority_expired']),
    requirement('agent-api/src/commerce-admission-provider.js', [
      'createCommerceAdmissionProvider', 'agentic-os-adapter-registration-finding/v1',
      'agentic-os-admission.internal', 'runtime_unconfigured']),
    requirement('agent-api/src/commerce-deployment-identity.js', ['acos-cloudflare-deployment-identity/v1', 'resolveCommerceDeploymentIdentity']),
    requirement('test/contracts/agentic-os-admission-v2.fixture.sha256', [
      'a2283f809470bf3044ed1e810bea67bb793bc975df0ab6f53f0e10e85fabbdd0', 'agentic-os-admission-v2.fixture.json']),
    requirement('wrangler.jsonc', [
      'AGENT_STATE', 'AGENTIC_OS_ADMISSION_AUTH_SECRET', 'AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET',
      'CF_VERSION_METADATA', 'ACOS_SOURCE_REVISION', 'ACOS_CANDIDATE_DIGEST']),
    requirement('.github/workflows/production-release.yml', ['workflow_dispatch:', 'environment:', 'production', 'authorized_release_candidate_json', 'graph_authority_evidence_digest', 'npm run web:build', 'acos-production-release-controller.mjs']),
    requirement('scripts/acos-production-release-contract.mjs', ['acos-production-release-candidate/v1', 'acos-production-preserve-required-receipt/v1', 'validateProductionReleaseCandidate', 'reuse-exact-candidate-version', 'https://airvio.co']),
    requirement('scripts/acos-production-release-controller.mjs', ['executeAcosProductionRelease', 'createPreserveReceipt', 'probeProductionReadiness', 'findVersionsByTag', 'readVersionById']),
    requirement('scripts/acos-production-release-live.mjs', ['createCandidateFromProtectedMain', 'validateGraphAuthorityEvidence', 'webArtifactDigest', 'CommerceAdmissionProbe']),
    requirement('agent-api/src/commerce-release-proof.js', ['createCommerceReleaseProofHandler', 'readCommerceReleaseProofEnvelope', 'agentic-os-admission.internal']),
    requirement('.github/workflows/adlc-authority.yml', ['workflow_dispatch:', 'authority_input_digest:']),
  ]),
  'agentic-graph': Object.freeze([
    requirement('.agentic-os.json', ['agentic-os/repository-profile/v1',
      'github.com/huijoohwee/agentic-graph', 'Integration Gate', 'quarantine-worktree-cleanup-opt-in']),
    requirement('package.json', ['"land": "agentic-os land"', '"status": "agentic-os status"',
      '"reap": "agentic-os reap"', '"agentic-os": "github:huijoohwee/agentic-os#'],
    { agenticOsPinPrefix: 'github:huijoohwee/agentic-os#',
      agenticOsResolvedPrefix: 'git+ssh://git@github.com/huijoohwee/agentic-os.git#' }),
    requirement('docs/collaboration-runtime-contract.md', [
      'informational current-device projection', 'delete_branch_on_merge:false']),
    requirement('cloudflare/workers/commerce-provider-contract.ts', [
      'commerce.discovery-provider/v1', 'commerce.checkout-provider/v1', 'commerce.marketplace-provider/v1',
      'commerce.upstream-runtime-evidence/v1', 'x-commerce-provider-binding-digest',
      'AUTHORING_MUTATION_HEADER_NAMES', 'x-authoring-reserved-at-ms',
      'agentic-graph-authoring-mutation-permit/v2', 'authoring_fence_atomic']),
    requirement('cloudflare/workers/commerce-provider-auth.ts', [
      'commerce-provider-auth/v1', 'x-commerce-provider-auth-schema', 'x-commerce-provider-auth-signature',
      'verifyCommerceProviderControlRequest', 'verifyCommerceProviderRequestAuthentication']),
    requirement('cloudflare/workers/commerce-marketplace-provider-response-contract.ts', [
      'commerce.marketplace-provider-response/v1', 'pending_review', 'approved',
      'authoring_mutation_reconciliation_required']),
    requirement('cloudflare/workers/agentic-graph-mcp/commerce-discovery-provider.ts',
      ['commerce.discovery-receipt/v1', 'discovery_projection_unsupported']),
    requirement('cloudflare/workers/agentic-graph-mcp/wrangler.toml', ['name = "agentic-mcp"']),
    requirement('cloudflare/workers/agentic-graph-travel-commerce/src/commerce-checkout-provider.ts',
      ['/internal/v1/checkouts/prepare', '/internal/v1/checkouts/confirm', 'operational_evidence_binding_invalid']),
    requirement('cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts', [
      'vendor-transition-fenced', 'settlement-read', 'authoring_mutation_payload_mismatch',
      'verifyCommerceProviderRequestAuthentication', 'MARKETPLACE_PROVIDER_AUTH_SECRET']),
    requirement('cloudflare/workers/agentic-graph-marketplace/wrangler.jsonc', ['MARKETPLACE_PROVIDER_AUTH_SECRET']),
    requirement('cloudflare/workers/agentic-graph-travel-commerce/wrangler.jsonc',
      ['CHECKOUT_PROVIDER_AUTH_SECRET', 'MARKETPLACE_PROVIDER_AUTH_SECRET']),
    requirement('cloudflare/workers/agentic-graph-travel-commerce/src/provider-runtime-proof.ts',
      ['authenticateCommerceProviderControlRequest', 'CHECKOUT_PROVIDER_AUTH_SECRET', 'MARKETPLACE_PROVIDER_AUTH_SECRET']),
    requirement('scripts/travel-mesh-release.mjs', ["environment.GITHUB_WORKFLOW !== 'Production Release'",
      'agentic-human-authorization-receipt/v2', 'consumed exact-candidate human authorization receipt']),
  ]),
  'agentic-commerce-os': Object.freeze([
    requirement('package.json', ['"agentic-os": "https://codeload.github.com/huijoohwee/agentic-os/tar.gz/',
      '"lane": "agentic-os start"', '"land": "agentic-os land"', '"reap": "agentic-os reap"',
      '"node": ">=22.22.0"'],
    { agenticOsPinPrefix: 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/',
      agenticOsResolvedPrefix: 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/' }),
    requirement('src/core/acos-admission.ts', ['ACOS_ADMISSION_PROVIDER_CONTRACT', 'ACOS_ADMISSION_PATH',
      'ACOS_ADMISSION_RECEIPT_SCHEMA', 'x-agentic-os-serving-deployment-identity',
      'acos_admission_serving_identity_invalid', 'authoring_mutation_intent']),
    requirement('src/core/acos-deployment-identity.ts', ['acos-cloudflare-deployment-identity/v1', 'readAcosDeploymentIdentity']),
    requirement('src/core/authoring-mutation-headers.ts', ['x-authoring-reserved-at-ms']),
    requirement('src/core/provider-contract.ts',
      ['commerce.discovery-provider/v1', 'commerce.checkout-provider/v1', 'commerce.marketplace-provider/v1']),
    requirement('src/core/upstream-evidence.ts', ['commerce.upstream-runtime-evidence/v1',
      'invocation_catalog_parity', 'guardrail_before_confirmation', 'authoring_fence_atomic']),
    requirement('src/core/provider-operation-gate.ts', ['x-commerce-provider-binding-digest',
      'MAXIMUM_OPERATION_BODY_BYTES = 65_536', 'bindAuthenticatedProviderRequest',
      'verifyCommerceProviderRequestAuthentication']),
    requirement('src/shared/commerce-provider-auth.ts', [
      'commerce-provider-auth/v1', 'x-commerce-provider-auth-schema', 'x-commerce-provider-auth-signature']),
    requirement('src/core/marketplace-transition-request.ts', [
      'prepareAuthenticatedMarketplaceVendorTransitionRequest', 'authoringMutationHeaders',
      'bindAuthenticatedProviderRequest']),
    requirement('src/core/marketplace-provider-response-contract.ts', [
      'commerce.marketplace-provider-response/v1', 'pending_review', 'approved',
      'authoring_mutation_reconciliation_required']),
    requirement('.github/workflows/production-release.yml', [
      'workflow_dispatch:', 'environment: production', 'human-authorization.json',
      'human-authorization.ts', 'prior-release-authority.json', 'recovery-release-authority.json',
      'run-production-release.ts', 'if: ${{ success() }}', 'if: ${{ failure() }}']),
    requirement('scripts/production-release/production-controller.ts', [
      'executeProductionRelease', 'recovery', 'preserve', 'recovery_authenticated_preserve_receipt_required']),
    requirement('config/production-core-services.json', [
      'agentic-commerce-production-core-services/v1', 'ACOS_ADMISSION', 'MARKETPLACE_PROVIDER']),
    requirement('scripts/production-release/core-services-manifest.ts', [
      'PRODUCTION_CORE_SERVICES_MANIFEST_SCHEMA', 'PRODUCTION_CORE_SERVICES_SNAPSHOT']),
    requirement('scripts/production-release/contracts.ts', [
      'PRODUCTION_CORE_SERVICES_SNAPSHOT', 'assertProductionCoreServicesManifestCurrent']),
    requirement('wrangler.core.jsonc', ['"production"', '"services"', 'AGENTIC_OS_ADMISSION_AUTH_SECRET']),
    requirement('wrangler.edge.jsonc', ['airvio.co/agentic-commerce-os*']),
    requirement('wrangler.sandbox.jsonc', ['agentic-commerce-sandbox-production']),
  ]),
});
const COMPONENTS = Object.freeze(Object.keys(CONTRACT));
const REPOSITORY_IDENTITIES = Object.freeze({
  'agentic-os': 'huijoohwee/agentic-os',
  'agentic-canvas-os': 'huijoohwee/agentic-canvas-os',
  'agentic-graph': 'huijoohwee/agentic-graph',
  'agentic-commerce-os': 'huijoohwee/agentic-commerce-os',
});
const COPIED_WORKFLOW_PATHS = Object.freeze([
  'docs/START-WORKFLOW.md',
  'docs/RELEASE-WORKFLOW.md',
]);
export function observeCompositionRuntime({
  roots,
  inspectGit = inspectGitWorktree,
  inspectAdmissionInterface = inspectAdmissionJoin,
  inspectDeploymentTopology = inspectCompositionDeploymentTopology,
  inspectSourceLock = inspectCompositionSourceLock,
}) {
  const nativeExecution = inspectGit === inspectGitWorktree
    && inspectAdmissionInterface === inspectAdmissionJoin
    && inspectDeploymentTopology === inspectCompositionDeploymentTopology
    && inspectSourceLock === inspectCompositionSourceLock;
  const findings = [], components = {}, resolvedRoots = {};
  const observedRoots = new Set();
  for (const component of COMPONENTS) {
    const supplied = roots?.[component];
    if (typeof supplied !== 'string' || supplied.trim() === '') {
      findings.push(finding(component, null, 'component_root_missing'));
      continue;
    }
    let root;
    try {
      root = realpathSync(supplied);
    } catch {
      findings.push(finding(component, null, 'component_root_unreadable'));
      continue;
    }
    if (observedRoots.has(root)) {
      findings.push(finding(component, null, 'component_root_duplicate'));
      continue;
    }
    observedRoots.add(root);
    resolvedRoots[component] = root;
    const git = inspectGit(root, component, REPOSITORY_IDENTITIES[component]);
    const checks = inspectComponentChecks(root, component, git.revision);
    for (const check of checks) findings.push(...check.findings);
    components[component] = Object.freeze({
      root,
      revision: git.revision,
      clean: git.clean,
      repositoryIdentity: git.repositoryIdentity ?? null,
      tree: git.tree ?? null,
      worktreeStateDigest: git.worktreeStateDigest ?? null,
      gitStatusCode: git.code ?? null,
      checks: Object.freeze(checks.map(({ findings: omitted, ...check }) => Object.freeze(check))),
    });
    if (!git.ok) findings.push(finding(component, null, git.code));
  }
  for (const component of COMPONENTS.filter(value => value !== 'agentic-os')) {
    const packageCheck = components[component]?.checks.find(check => check.file === 'package.json');
    if (packageCheck?.agenticOsPin && !compositionHarnessPinIsAncestor(
      resolvedRoots['agentic-os'], packageCheck.agenticOsPin,
      components['agentic-os']?.revision,
    )) findings.push(finding(
      component, 'package.json', 'agentic_os_package_pin_unresolved', packageCheck.agenticOsPin,
    ));
  }
  if (nativeExecution && resolvedRoots['agentic-os'] !== PACKAGE_ROOT) {
    findings.push(finding('agentic-os', null, 'agentic_os_runtime_root_mismatch'));
  }
  const sourceMarkersObserved = findings.every(item => item.code === 'worktree_dirty');
  let admissionInterface = Object.freeze({ schema: COMPOSITION_ADMISSION_PROBE_SCHEMA,
    ok: false, code: 'source_markers_not_ready', staticInterfaceObserved: false });
  let deploymentTopology = Object.freeze({ schema: COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA,
    ok: false, code: 'source_markers_not_ready', findings: Object.freeze([]) });
  let sourceLock = Object.freeze({ schema: COMPOSITION_SOURCE_LOCK_SCHEMA,
    ok: false, code: 'source_markers_not_ready' });
  if (sourceMarkersObserved) {
    deploymentTopology = executeCompositionDeploymentTopology(
      resolvedRoots, components, inspectDeploymentTopology,
    );
    findings.push(...compositionDeploymentTopologyRuntimeFindings(deploymentTopology));
    admissionInterface = executeStaticInspection(
      inspectAdmissionInterface, resolvedRoots, components,
      isValidCompositionAdmissionInterfaceReport,
      'cross_repository_admission_interface_invalid',
    );
    if (!admissionInterface.ok) findings.push(admissionFinding(admissionInterface));
    sourceLock = executeCompositionSourceLock(inspectSourceLock, resolvedRoots, components);
    if (!sourceLock.ok) findings.push(finding(
      'agentic-os', 'catalog/composition-source-lock.json',
      sourceLock.code ?? 'composition_source_lock_invalid',
    ));
    for (const [component, before] of Object.entries(components)) {
      const git = inspectGit(resolvedRoots[component], component, REPOSITORY_IDENTITIES[component]);
      const checks = inspectComponentChecks(resolvedRoots[component], component, git.revision)
        .map(({ findings: omitted, ...check }) => check);
      if (git.revision !== before.revision || git.clean !== before.clean
        || git.repositoryIdentity !== before.repositoryIdentity
        || (git.tree ?? null) !== before.tree
        || (git.worktreeStateDigest ?? null) !== before.worktreeStateDigest
        || (git.code ?? null) !== before.gitStatusCode
        || JSON.stringify(checks) !== JSON.stringify(before.checks)) {
        findings.push(finding(component, null, 'component_changed_during_inspection'));
      }
    }
  }
  const sourceInterfacesAligned = deploymentTopology.ok && sourceLock.ok
    && deploymentTopology.topologyManifestDigest === sourceLock.topologyManifestDigest
    && deploymentTopology.topologyManifestBlob === sourceLock.topologyManifestBlob;
  const sourceInterfaces = Object.freeze({
    ok: admissionInterface.ok && sourceInterfacesAligned,
    evidenceClass: nativeExecution ? 'static-source-interface' : 'injected-test-observation',
    candidateCodeExecuted: false,
    admissionInterface,
    deploymentTopology,
    sourceLock,
  });
  const sourceInterfaceContractsReady = nativeExecution && sourceInterfaces.ok
    && findings.every(item => item.code === 'worktree_dirty');
  const sourceCandidateClean = Object.keys(components).length === COMPONENTS.length
    && Object.values(components).every(component => component.clean
      && /^[0-9a-f]{40}$/u.test(component.revision)
      && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(component.tree));
  const sourceCandidateReviewReady = sourceInterfaceContractsReady && sourceCandidateClean;
  return Object.freeze({
    schema: COMPOSITION_ACCEPTANCE_SCHEMA,
    observationMode: nativeExecution ? 'native' : 'injected-test',
    ok: sourceCandidateReviewReady,
    sourceContractMarkersObserved: sourceMarkersObserved,
    sourceInterfaceContractsReady,
    sourceCandidateClean,
    sourceCandidateReviewReady,
    sourceInterfaces,
    ownerSuiteEvidenceObserved: false,
    protectedOwnerEvidenceObserved: false,
    protectedReleaseControllerMarkersObserved: nativeExecution && sourceMarkersObserved,
    authenticatedReleaseAuthorityObserved: false,
    productionRuntimeReady: false,
    deliveryBlockers: Object.freeze([
      ...(sourceInterfaceContractsReady ? [] : ['source_interface_contracts_not_ready']),
      ...(sourceCandidateClean ? [] : ['source_candidate_not_clean']),
      ...(nativeExecution ? [] : ['native_composition_observation_not_used']),
      'owner_suite_receipts_not_machine_bound', 'protected_owner_evidence_not_observed',
      'authenticated_release_evidence_not_observed',
      'operator_owned_x402_payee_not_observed', 'deployed_runtime_evidence_not_observed',
    ]),
    components: Object.freeze(components),
    findings: Object.freeze(findings),
  });
}
function requirement(file, literals, options = {}) {
  return Object.freeze({ file, literals: Object.freeze(literals), ...options });
}
function inspectComponentChecks(root, component, revision) {
  const checks = CONTRACT[component]
    .map(requirementValue => inspectRequirement(root, component, revision, requirementValue));
  if (component !== 'agentic-os') {
    const pinRequirement = CONTRACT[component].find(value => value.agenticOsPinPrefix);
    const packageCheck = checks.find(check => check.file === 'package.json');
    checks.push(inspectAgenticOsLock(root, component, revision, packageCheck?.agenticOsPin,
      pinRequirement.agenticOsPinPrefix, pinRequirement.agenticOsResolvedPrefix));
    checks.push(...COPIED_WORKFLOW_PATHS.map(file => inspectForbiddenPath(
      root, component, revision, file,
    )));
  }
  return checks;
}
function inspectRequirement(root, component, revision,
  { file, literals, agenticOsPinPrefix = null }) {
  let bytes, source;
  try {
    ({ bytes } = readCompositionHeadFile(
      root, revision, file, MAX_CONTRACT_BYTES, 'composition contract',
    ));
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    const code = error?.code === 'composition_head_file_untracked' ? 'contract_file_untracked'
      : error?.code === 'composition_head_file_bytes_unbound' ? 'contract_file_bytes_unbound'
        : 'contract_file_unreadable_or_oversized';
    return { file, status: 'fail', findings: [finding(component, file, code)] };
  }
  const findings = [];
  findings.push(...literals.filter(literal => !source.includes(literal))
    .map(literal => finding(component, file, 'contract_literal_missing', literal)));
  const agenticOsPin = agenticOsPinPrefix
    ? exactAgenticOsPackagePin(source, agenticOsPinPrefix) : null;
  if (agenticOsPinPrefix && agenticOsPin === null) {
    findings.push(finding(component, file, 'agentic_os_package_pin_invalid'));
  }
  return {
    file,
    status: findings.length === 0 ? 'pass' : 'fail',
    digest: createHash('sha256').update(bytes).digest('hex'),
    ...(agenticOsPin === null ? {} : { agenticOsPin }),
    findings,
  };
}
export function exactAgenticOsPackagePin(source, prefix) {
  let manifest;
  try { manifest = JSON.parse(source); } catch { return null; }
  return exactAgenticOsPinValue(manifest, prefix);
}
function exactAgenticOsPinValue(manifest, prefix) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  const pins = ['dependencies', 'devDependencies', 'optionalDependencies']
    .filter(section => manifest[section] && typeof manifest[section] === 'object'
      && Object.hasOwn(manifest[section], 'agentic-os'))
    .map(section => manifest[section]['agentic-os']);
  if (pins.length !== 1 || typeof pins[0] !== 'string' || !pins[0].startsWith(prefix)) return null;
  const revision = pins[0].slice(prefix.length);
  return /^[0-9a-f]{40}$/u.test(revision) ? revision : null;
}
function inspectAgenticOsLock(root, component, revision, expectedPin, prefix, resolvedPrefix) {
  const file = 'package-lock.json'; let bytes, source;
  try { ({ bytes } = readCompositionHeadFile(
    root, revision, file, 1_048_576, 'composition package lock',
  )); source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { const code = error?.code === 'composition_head_file_untracked'
    ? 'agentic_os_lockfile_untracked' : error?.code === 'composition_head_file_bytes_unbound'
      ? 'agentic_os_lockfile_bytes_unbound' : 'agentic_os_lockfile_unreadable_or_oversized';
    return { file, status: 'fail', findings: [finding(component, file, code)] }; }
  const locked = parseAgenticOsLockfilePin(source, prefix, resolvedPrefix, expectedPin);
  return { file, status: locked ? 'pass' : 'fail',
    digest: createHash('sha256').update(bytes).digest('hex'),
    ...(locked ? locked : {}), findings: locked ? []
      : [finding(component, file, 'agentic_os_lockfile_pin_invalid')] };
}
export function parseAgenticOsLockfilePin(source, prefix, resolvedPrefix, expectedPin) {
  let lock;
  try { lock = JSON.parse(source); } catch { return null; }
  const root = lock?.packages?.[''], installed = lock?.packages?.['node_modules/agentic-os'];
  const pin = exactAgenticOsPinValue(root, prefix), integrity = installed?.integrity;
  if (lock?.lockfileVersion !== 3 || lock?.requires !== true || pin === null || pin !== expectedPin
    || installed?.resolved !== `${resolvedPrefix}${pin}` || typeof integrity !== 'string'
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) return null;
  const encoded = integrity.slice(7), digest = Buffer.from(encoded, 'base64');
  return digest.length === 64 && digest.toString('base64') === encoded
    ? { agenticOsPin: pin, agenticOsIntegrity: integrity } : null;
}
export function compositionHarnessPinIsAncestor(root, pin, revision) {
  if (typeof root !== 'string' || root === '' || !/^[0-9a-f]{40}$/u.test(pin ?? '')
    || !/^[0-9a-f]{40}$/u.test(revision ?? '')) {
    return false;
  }
  if (git(root, ['rev-parse', '--verify', `${pin}^{commit}`]) !== pin
    || git(root, ['rev-parse', '--verify', `${revision}^{commit}`]) !== revision) return false;
  const pending = [revision], seen = new Set();
  while (pending.length > 0 && seen.size < 4_096) {
    const current = pending.pop();
    if (current === pin) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const bytes = observeCompositionGit(['cat-file', 'commit', current], {
      cwd: root, binary: true, allowFail: true, maxBuffer: 1_048_576,
    });
    if (!Buffer.isBuffer(bytes)) return false;
    const boundary = bytes.indexOf(Buffer.from('\n\n'));
    if (boundary < 0) return false;
    const lines = bytes.subarray(0, boundary).toString('utf8').split('\n'), parents = [];
    if (!/^tree [0-9a-f]{40}$/u.test(lines[0])) return false;
    let cursor = 1;
    while (lines[cursor]?.startsWith('parent ')) {
      const parent = lines[cursor].slice(7);
      if (!/^[0-9a-f]{40}$/u.test(parent)) return false;
      parents.push(parent); cursor += 1;
    }
    if (!lines[cursor]?.startsWith('author ') || !lines[cursor + 1]?.startsWith('committer ')
      || lines.slice(cursor + 2).some(line => /^(?:tree|parent|author|committer) /u.test(line))) {
      return false;
    }
    if (parents.length > 32) return false;
    pending.push(...parents);
  }
  return false;
}
function inspectForbiddenPath(root, component, revision, file) {
  const fields = decodeNulFields(observeCompositionGit([
    '--literal-pathspecs', 'ls-tree', '-z', revision, '--', file,
  ], { cwd: root, binary: true, allowFail: true }));
  const forbidden = fields === null || fields.length !== 0;
  return {
    file,
    status: forbidden ? 'fail' : 'pass',
    findings: forbidden ? [finding(component, file, 'copied_workflow_asset_forbidden')] : [],
  };
}
function inspectAdmissionJoin(roots, components) {
  return runCompositionAdmissionProbe({
    acosRoot: roots['agentic-canvas-os'],
    commerceRoot: roots['agentic-commerce-os'],
    fixturePath: path.join(roots['agentic-canvas-os'],
      'test/contracts/agentic-os-admission-v2.fixture.json'),
    acosRevision: components['agentic-canvas-os'].revision,
    commerceRevision: components['agentic-commerce-os'].revision,
  });
}
function executeStaticInspection(inspector, roots, components, validate, invalidCode) {
  let report;
  try { report = inspector(roots, components); }
  catch { return Object.freeze({ ok: false, code: invalidCode }); }
  return validate(report) ? Object.freeze(report) : Object.freeze({ ok: false, code: invalidCode });
}
function admissionFinding(report) {
  const component = report.owner ?? 'agentic-os';
  return finding(component, report.file ?? 'bin/composition-admission-probe.mjs',
    report.code ?? 'cross_repository_admission_interface_invalid');
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function inspectGitWorktree(root, component, expectedRepositoryIdentity) {
  const topLevel = realpathOrNull(git(root, ['rev-parse', '--show-toplevel']));
  if (topLevel !== realpathOrNull(root)) return failedGitState('git_toplevel_unexpected');
  const revision = git(root, ['rev-parse', '--verify', 'HEAD']);
  if (!/^[0-9a-f]{40}$/u.test(revision)) return failedGitState('git_revision_unavailable');
  const tree = git(root, ['rev-parse', '--verify', `${revision}^{tree}`]);
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(tree)) {
    return failedGitState('git_tree_unavailable', revision);
  }
  const repositoryIdentity = localOriginIdentity(root);
  if (repositoryIdentity !== expectedRepositoryIdentity)
    return failedGitState('git_origin_unexpected', revision, repositoryIdentity, tree);
  const state = inspectGitState(root, revision);
  if (state === null)
    return failedGitState('git_worktree_snapshot_unavailable', revision, repositoryIdentity, tree);
  if (git(root, ['rev-parse', '--verify', 'HEAD']) !== revision) {
    return failedGitState('git_revision_changed_during_inspection', revision,
      repositoryIdentity, tree);
  }
  const clean = state.status === '';
  return { ok: clean, clean, revision, repositoryIdentity, tree,
    worktreeStateDigest: state.digest, code: clean ? null : 'worktree_dirty' };
}
function failedGitState(code, revision = null, repositoryIdentity = null, tree = null) {
  return { ok: false, clean: false, revision, repositoryIdentity, tree,
    worktreeStateDigest: null, code };
}
function localOriginIdentity(root) {
  return normalizeRepositoryIdentity(compositionOriginUrl(root));
}
function inspectGitState(root, revision) {
  const commands = [
    ['ls-files', '--stage', '-z'], ['ls-files', '-v', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
    ['diff', '--cached', '--raw', '-z', '--no-renames', '--abbrev=64',
      '--ita-visible-in-index', revision, '--'],
  ];
  const inventory = commands.map(args => observeCompositionGit(args, {
    cwd: root, allowFail: true, binary: true, maxBuffer: 4_194_304,
  }));
  if (inventory.some(value => !Buffer.isBuffer(value))
    || inventory.reduce((sum, value) => sum + value.length, 0) > SNAPSHOT_LIMITS.inventoryBytes)
    return null;
  const [index, visibility, untracked, cached] = inventory.map(decodeNulFields);
  const cachedHeader = /^:(?:[0-7]{6} ){2}(?:[0-9a-f]{40}|[0-9a-f]{64}) (?:[0-9a-f]{40}|[0-9a-f]{64}) [A-Z]$/u;
  if ([index, visibility, untracked, cached].some(value => value === null)
    || index.length > SNAPSHOT_LIMITS.tracked || untracked.length > SNAPSHOT_LIMITS.untracked
    || cached.length % 2 !== 0 || visibility.some(hiddenIndexEntry)
    || cached.some((value, position) => position % 2 === 0 && !cachedHeader.test(value))
    || untracked.reduce((sum, value) => sum + Buffer.byteLength(value), 0) > SNAPSHOT_LIMITS.pathBytes)
    return null;
  const hashes = createHash('sha256'), observed = []; let trackedBytes = 0, untrackedBytes = 0, trackedDirty = false;
  try { const canonicalRoot = realpathSync(root); for (let position = 1; position < cached.length; position += 2) if (!inside(canonicalRoot, path.resolve(canonicalRoot, cached[position]))) return null;
    for (const record of index) { const tab = record.indexOf('\t'), match = record.slice(0, tab).match(/^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-3])$/u), relative = record.slice(tab + 1);
      const target = path.resolve(canonicalRoot, relative); if (tab < 0 || !match || match[3] !== '0' || !['100644', '100755'].includes(match[1]) || !inside(canonicalRoot, target)) return null;
      const file = stableSnapshotFile(target, Math.min(SNAPSHOT_LIMITS.fileBytes, SNAPSHOT_LIMITS.trackedBytes - trackedBytes)); if (file === null) return null; observed.push({ target, stat: file.stat }); if (file.bytes) trackedBytes += file.bytes.length;
      if (file.bytes === null || file.mode !== match[1] || gitBlobOid(file.bytes, match[2]) !== match[2]) {
        trackedDirty = true; hashes.update('tracked\0').update(relative).update('\0').update(file.mode).update('\0'); file.bytes === null ? hashes.update('missing\0') : hashes.update(String(file.bytes.length)).update('\0').update(file.bytes);
      }
    }
    for (const relative of untracked) { const target = path.resolve(canonicalRoot, relative); if (!inside(canonicalRoot, target)) return null;
      const file = stableSnapshotFile(target, SNAPSHOT_LIMITS.contentBytes - untrackedBytes); if (!file || file.bytes === null) return null; observed.push({ target, stat: file.stat });
      untrackedBytes += file.bytes.length; hashes.update('untracked\0').update(relative).update('\0').update(String(file.bytes.length)).update('\0').update(file.bytes);
    }
  } catch { return null; }
  const after = commands.map(args => observeCompositionGit(args, { cwd: root, allowFail: true, binary: true, maxBuffer: 4_194_304 })); if (after.some((value, position) => !Buffer.isBuffer(value) || !value.equals(inventory[position]))) return null;
  try { if (observed.some(value => !sameSnapshotNode(value.stat, lstatSync(value.target, { bigint: true, throwIfNoEntry: false })))) return null; } catch { return null; }
  const status = cached.length > 0 || trackedDirty || untracked.length > 0 ? 'dirty' : '';
  return { status, digest: createHash('sha256').update('index\0').update(inventory[0]).update('visibility\0').update(inventory[1])
    .update('untracked\0').update(inventory[2]).update('cached\0').update(inventory[3]).update(hashes.digest()).digest('hex') }; }
function stableSnapshotFile(target, maxBytes) {
  const before = lstatSync(target, { bigint: true, throwIfNoEntry: false });
  if (!before) return lstatSync(target, { bigint: true, throwIfNoEntry: false })
    ? null : { bytes: null, mode: '000000', stat: null };
  if (!before.isFile()) return null;
  const bytes = readBoundedFile(target, maxBytes, 'composition worktree snapshot', {
    expectedIdentity: before, expectedPath: target,
  });
  const after = lstatSync(target, { bigint: true, throwIfNoEntry: false });
  return sameSnapshotNode(before, after)
    ? { bytes, mode: before.mode & 0o111n ? '100755' : '100644', stat: before } : null;
}
function sameSnapshotNode(left, right) {
  return left === null || right === null ? left === right
    : left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
      && left.nlink === right.nlink && left.size === right.size
      && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function hiddenIndexEntry(record) { return record[0] >= 'a' && record[0] <= 'z' || record[0]?.toUpperCase() === 'S'; }
export function normalizeRepositoryIdentity(value) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') return null;
  const scp = value.match(/^(?:[^@/\s:]+@)?github\.com:([^\s]+)$/iu);
  if (scp) return repositoryPathIdentity(scp[1]);
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)
    || parsed.hostname.toLowerCase() !== 'github.com'
    || parsed.port !== '' || parsed.search !== '' || parsed.hash !== '') return null;
  return repositoryPathIdentity(parsed.pathname.replace(/^\//u, ''));
}
function repositoryPathIdentity(value) {
  const withoutSuffix = value.replace(/\.git$/iu, '');
  const parts = withoutSuffix.split('/');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/u.test(part))) return null;
  return `${parts[0]}/${parts[1]}`.toLowerCase();
}
function git(root, args, trim = true) {
  return observeCompositionGit(args, { cwd: root, allowFail: true, raw: !trim,
    maxBuffer: 4_194_304 });
}
function finding(component, file, code, detail = null) { return Object.freeze({ component, file, code, detail }); }
function parseCli(argv) {
  const roots = {};
  for (const argument of argv) {
    const match = argument.match(/^--(agentic-os|agentic-canvas-os|agentic-graph|agentic-commerce-os)-root=(.+)$/u);
    if (!match || roots[match[1]]) throw new Error(`invalid or duplicate composition argument: ${argument}`);
    roots[match[1]] = match[2];
  }
  return { roots };
}
const invoked = process.argv[1] && realpathOrNull(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const { roots } = parseCli(process.argv.slice(2));
    const report = observeCompositionRuntime({ roots });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
function realpathOrNull(value) { try { return realpathSync(value); } catch { return null; } }
