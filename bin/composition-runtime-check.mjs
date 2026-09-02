import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPOSITION_ACCEPTANCE_SCHEMA = 'agentic-os/composition-runtime-acceptance/v1';

const CONTRACT = Object.freeze({
  'agentic-os': Object.freeze([
    requirement('guides/COMPOSITION-ARCHITECTURE.md', [
      'DIR-RUNTIME-READY-01',
      '`agentic-canvas-os`',
      '`agentic-graph`',
      '`agentic-commerce-os`',
      'VCC-RUNTIME-AUTHORITY-02',
    ]),
    requirement('src/github-authority.mjs', [
      'github-actions-fenced-authority',
      'agentic-os/github-authority-input/v1',
      "source.event !== 'workflow_dispatch'",
    ]),
    requirement('src/github-authority-operation.mjs', [
      'authority_input_digest does not match the event payload and committed policy',
    ]),
  ]),
  'agentic-canvas-os': Object.freeze([
    requirement('agent-api/src/commerce-admission-contract.js', [
      'commerce.acos-admission-provider/v3',
      '/internal/v2/adapter-registrations',
      'acos-adapter-registration/v2',
      'commerce-acos-admission-auth/v1',
      'x-acos-admission-auth-signature',
      'agentic-graph-authoring-operation/v1',
      'operator://agentic-graph/commerce-adapter-admission/2026-09-03',
      'authoring_mutation_intent',
      'x-authoring-reserved-at-ms',
    ]),
    requirement('agent-api/src/commerce-deployment-identity.js', [
      'acos-cloudflare-deployment-identity/v1',
      'sourceRevision',
      'candidateDigest',
      'versionId',
      'versionTag',
      'versionTimestamp',
    ]),
    requirement('test/contracts/acos-admission-v2.fixture.sha256', [
      '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44',
      'acos-admission-v2.fixture.json',
    ]),
    requirement('wrangler.jsonc', [
      'ACOS_ADMISSION_AUTH_SECRET',
      'ACOS_UNMANAGED_BINDINGS_DIGEST',
    ]),
    requirement('.github/workflows/adlc-authority.yml', [
      'workflow_dispatch:',
      'authority_input_digest:',
    ]),
    requirement('.github/workflows/production-release.yml', [
      'workflow_dispatch:',
      'environment:',
      'name: production',
      'acos-production-release.mjs prepare',
      'acos-production-release.mjs release',
    ]),
    requirement('scripts/acos-production-release-controller.mjs', [
      'baseline_unmanaged_binding_drift',
      'createPreserveReceipt',
      'rollbackIfBaseline',
    ]),
  ]),
  'agentic-graph': Object.freeze([
    requirement('.agentic-os.json', [
      'agentic-os/repository-profile/v1',
      'github.com/huijoohwee/knowgrph',
      'Integration Gate',
      'quarantine-worktree-cleanup-opt-in',
    ]),
    requirement('package.json', [
      '"land": "agentic-os land"',
      '"status": "agentic-os status"',
      '"queue:show": "agentic-os queue show"',
      '89256623e4a09a4b8e337c9d3572593c0d188700',
    ]),
    requirement('docs/collaboration-runtime-contract.md', [
      'informational current-device projection',
      'delete_branch_on_merge:false',
    ]),
    requirement('cloudflare/workers/commerce-provider-contract.ts', [
      'commerce.discovery-provider/v1',
      'commerce.checkout-provider/v1',
      'commerce.marketplace-provider/v1',
      'commerce.upstream-runtime-evidence/v1',
      'x-commerce-provider-binding-digest',
      'AUTHORING_MUTATION_HEADER_NAMES',
      'x-authoring-reserved-at-ms',
      'agentic-graph-authoring-mutation-permit/v2',
      'authoring_fence_atomic',
    ]),
    requirement('cloudflare/workers/commerce-provider-auth.ts', [
      'commerce-provider-auth/v1',
      'x-commerce-provider-auth-schema',
      'x-commerce-provider-auth-signature',
      'verifyCommerceProviderControlRequest',
      'verifyCommerceProviderRequestAuthentication',
    ]),
    requirement('cloudflare/workers/commerce-marketplace-provider-response-contract.ts', [
      'commerce.marketplace-provider-response/v1',
      'pending_review',
      'approved',
      'authoring_mutation_reconciliation_required',
    ]),
    requirement('cloudflare/workers/agenticgraph-mcp/commerce-discovery-provider.ts', [
      'commerce.discovery-receipt/v1',
      'discovery_projection_unsupported',
    ]),
    requirement('cloudflare/workers/agenticgraph-travel-commerce/src/commerce-checkout-provider.ts', [
      '/internal/v1/checkouts/prepare',
      '/internal/v1/checkouts/confirm',
      'operational_evidence_binding_invalid',
    ]),
    requirement('cloudflare/workers/agenticgraph-marketplace/src/commerce-provider.ts', [
      'vendor-transition-fenced',
      'settlement-read',
      'authoring_mutation_payload_mismatch',
      'verifyCommerceProviderRequestAuthentication',
      'MARKETPLACE_PROVIDER_AUTH_SECRET',
    ]),
    requirement('cloudflare/workers/agenticgraph-marketplace/wrangler.jsonc', [
      'MARKETPLACE_PROVIDER_AUTH_SECRET',
    ]),
    requirement('cloudflare/workers/agenticgraph-travel-commerce/wrangler.jsonc', [
      'CHECKOUT_PROVIDER_AUTH_SECRET',
      'MARKETPLACE_PROVIDER_AUTH_SECRET',
    ]),
    requirement('cloudflare/workers/agenticgraph-travel-commerce/src/provider-runtime-proof.ts', [
      'authenticateCommerceProviderControlRequest',
      'CHECKOUT_PROVIDER_AUTH_SECRET',
      'MARKETPLACE_PROVIDER_AUTH_SECRET',
    ]),
    requirement('scripts/travel-mesh-release.mjs', [
      "environment.GITHUB_WORKFLOW !== 'Production Release'",
      'agentic-human-authorization-receipt/v2',
      'consumed exact-candidate human authorization receipt',
    ]),
  ]),
  'agentic-commerce-os': Object.freeze([
    requirement('src/core/acos-admission.ts', [
      'commerce.acos-admission-provider/v3',
      '/internal/v2/adapter-registrations',
      'acos-adapter-registration/v2',
      'acos-cloudflare-deployment-identity/v1',
      'operator://agentic-graph/commerce-adapter-admission/2026-09-03',
      'authoring_mutation_intent',
    ]),
    requirement('src/core/authoring-mutation-headers.ts', [
      'x-authoring-reserved-at-ms',
    ]),
    requirement('src/core/provider-contract.ts', [
      'commerce.discovery-provider/v1',
      'commerce.checkout-provider/v1',
      'commerce.marketplace-provider/v1',
    ]),
    requirement('src/core/upstream-evidence.ts', [
      'commerce.upstream-runtime-evidence/v1',
      'invocation_catalog_parity',
      'guardrail_before_confirmation',
      'authoring_fence_atomic',
    ]),
    requirement('src/core/provider-operation-gate.ts', [
      'x-commerce-provider-binding-digest',
      'MAXIMUM_OPERATION_BODY_BYTES = 65_536',
      'bindAuthenticatedProviderRequest',
      'verifyCommerceProviderRequestAuthentication',
    ]),
    requirement('src/shared/commerce-provider-auth.ts', [
      'commerce-provider-auth/v1',
      'x-commerce-provider-auth-schema',
      'x-commerce-provider-auth-signature',
    ]),
    requirement('src/core/marketplace-transition-request.ts', [
      'prepareAuthenticatedMarketplaceVendorTransitionRequest',
      'authoringMutationHeaders',
      'bindAuthenticatedProviderRequest',
    ]),
    requirement('src/core/marketplace-provider-response-contract.ts', [
      'commerce.marketplace-provider-response/v1',
      'pending_review',
      'approved',
      'authoring_mutation_reconciliation_required',
    ]),
    requirement('test/contracts/acos-admission-v2.fixture.json', [
      'commerce.acos-admission-v2-request-fixture/v1',
      '7aa02c58765d6e16787fbe0b1320ed37d7f0ef610f9ba55a1ab2f56e69d583ee',
      'agent-acceptance-fixture',
      'commerce-acos-admission-auth/v1',
    ]),
    requirement('test/contracts/acos-admission-v2.fixture.sha256', [
      '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44',
      'acos-admission-v2.fixture.json',
    ]),
    requirement('.github/workflows/production-release.yml', [
      'workflow_dispatch:',
      'environment: production',
      'human-authorization.json',
      'human-authorization.ts',
      'prior-release-authority.json',
      'recovery-release-authority.json',
      'run-production-release.ts',
      'if: ${{ success() }}',
      'if: ${{ failure() }}',
    ]),
    requirement('scripts/production-release/production-controller.ts', [
      'executeProductionRelease',
      'recovery',
      'preserve',
      'recovery_authenticated_preserve_receipt_required',
    ]),
    requirement('wrangler.edge.jsonc', [
      'airvio.co/agentic-commerce-os*',
    ]),
  ]),
});

const COMPONENTS = Object.freeze(Object.keys(CONTRACT));
const REPOSITORY_IDENTITIES = Object.freeze({
  'agentic-os': 'huijoohwee/agentic-os',
  'agentic-canvas-os': 'huijoohwee/agentic-canvas-os',
  'agentic-graph': 'huijoohwee/knowgrph',
  'agentic-commerce-os': 'huijoohwee/agentic-commerce-os',
});

export function observeCompositionRuntime({
  roots,
  inspectGit = inspectGitWorktree,
  probeContracts = inspectCrossRepositoryJoin,
}) {
  const findings = [];
  const components = {};
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
    const git = inspectGit(root, component, REPOSITORY_IDENTITIES[component]);
    const checks = CONTRACT[component].map(({ file, literals }) => inspectRequirement(root, component, file, literals));
    for (const check of checks) findings.push(...check.findings);
    components[component] = Object.freeze({
      root,
      revision: git.revision,
      clean: git.clean,
      repositoryIdentity: git.repositoryIdentity ?? null,
      checks: Object.freeze(checks.map(({ findings: omitted, ...check }) => Object.freeze(check))),
    });
    if (!git.ok) findings.push(finding(component, null, git.code));
  }
  const sourceMarkersReady = findings.every(item => item.code === 'worktree_dirty');
  let crossRepositoryContracts = Object.freeze({ ok: false, code: 'source_markers_not_ready' });
  if (sourceMarkersReady) {
    try {
      crossRepositoryContracts = Object.freeze(probeContracts(roots));
    } catch {
      crossRepositoryContracts = Object.freeze({ ok: false, code: 'cross_repository_contract_probe_failed' });
    }
    if (!crossRepositoryContracts.ok) {
      findings.push(finding('agentic-commerce-os', 'src/core/marketplace-transition-request.ts',
        crossRepositoryContracts.code || 'cross_repository_contract_probe_failed'));
    }
  }
  const sourceContractsReady = findings.every(item => item.code === 'worktree_dirty');
  const sourceCandidateClean = sourceContractsReady
    && Object.keys(components).length === COMPONENTS.length
    && Object.values(components).every(component => component.clean && /^[0-9a-f]{40}$/u.test(component.revision));
  return Object.freeze({
    schema: COMPOSITION_ACCEPTANCE_SCHEMA,
    ok: sourceContractsReady,
    sourceContractsReady,
    sourceCandidateClean,
    crossRepositoryContracts,
    authenticatedReleaseAuthorityContractReady: sourceContractsReady,
    authenticatedReleaseAuthorityObserved: false,
    productionRuntimeReady: false,
    deliveryBlockers: Object.freeze([
      'authenticated_release_evidence_not_observed',
      'operator_owned_x402_payee_not_observed',
      'deployed_runtime_evidence_not_observed',
    ]),
    components: Object.freeze(components),
    findings: Object.freeze(findings),
  });
}

function requirement(file, literals) {
  return Object.freeze({ file, literals: Object.freeze(literals) });
}

function inspectRequirement(root, component, file, literals) {
  const target = path.resolve(root, file);
  if (!inside(root, target)) return { file, status: 'fail', findings: [finding(component, file, 'contract_path_escaped')] };
  let source;
  try {
    source = readFileSync(target, 'utf8');
  } catch {
    return { file, status: 'fail', findings: [finding(component, file, 'contract_file_missing')] };
  }
  const missing = literals.filter(literal => !source.includes(literal));
  return {
    file,
    status: missing.length === 0 ? 'pass' : 'fail',
    findings: missing.map(literal => finding(component, file, 'contract_literal_missing', literal)),
  };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function inspectGitWorktree(root, component, expectedRepositoryIdentity) {
  const revision = git(root, ['rev-parse', '--verify', 'HEAD']);
  if (!/^[0-9a-f]{40}$/u.test(revision)) return { ok: false, clean: false, revision: null, repositoryIdentity: null, code: 'git_revision_unavailable' };
  const repositoryIdentity = normalizeRepositoryIdentity(git(root, ['remote', 'get-url', 'origin']));
  if (repositoryIdentity !== expectedRepositoryIdentity) {
    return { ok: false, clean: false, revision, repositoryIdentity, code: 'git_origin_unexpected' };
  }
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'], false);
  if (status === null) return { ok: false, clean: false, revision, repositoryIdentity, code: 'git_status_unavailable' };
  const clean = status === '';
  return { ok: clean, clean, revision, repositoryIdentity, code: clean ? null : 'worktree_dirty' };
}

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

function inspectCrossRepositoryJoin(roots) {
  const probe = fileURLToPath(new URL('./composition-admission-probe.mjs', import.meta.url));
  const fixture = path.join(roots['agentic-commerce-os'], 'test/contracts/acos-admission-v2.fixture.json');
  const result = spawnSync(process.execPath, [
    probe,
    roots['agentic-canvas-os'],
    roots['agentic-commerce-os'],
    roots['agentic-graph'],
    fixture,
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1_048_576,
  });
  if (result.status !== 0 || result.error) {
    return Object.freeze({ ok: false, code: 'cross_repository_contract_probe_failed' });
  }
  try {
    const report = JSON.parse(result.stdout);
    if (report?.schema !== 'agentic-os/composition-cross-repository-probe/v1'
      || report.ok !== true
      || report.fixtureSchema !== 'commerce.acos-admission-v2-request-fixture/v1'
      || report.fixtureDigest !== '06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44'
      || report.providerContract !== 'commerce.acos-admission-provider/v3'
      || report.consumerContract !== 'commerce.acos-admission-provider/v3'
      || report.consumerValidated !== true
      || report.productionProjectionValidated !== true
      || report.admissionAuthenticationValidated !== true
      || report.extraKeyDriftRejected !== true
      || report.deploymentIdentityValidated !== true
      || report.receiptSchema !== 'acos-adapter-registration/v2'
      || report.requestDigest !== '7aa02c58765d6e16787fbe0b1320ed37d7f0ef610f9ba55a1ab2f56e69d583ee'
      || report.replayWriteCount !== 0
      || report.restartReady !== true
      || report.marketplaceContract !== 'commerce.marketplace-provider/v1'
      || report.marketplaceProducerConsumerValidated !== true
      || report.marketplaceControlAuthenticationValidated !== true
      || report.marketplaceOperationAuthenticationValidated !== true
      || report.marketplaceAuthoringHeaderCount !== 12
      || report.marketplaceResponseContractValidated !== true
      || report.marketplaceTamperRejected !== true
      || !/^[0-9a-f]{64}$/u.test(report.marketplaceRequestDigest ?? '')
      || !/^[0-9a-f]{64}$/u.test(report.marketplaceBindingDigest ?? '')) {
      return Object.freeze({ ok: false, code: 'cross_repository_contract_probe_invalid' });
    }
    return report;
  } catch {
    return Object.freeze({ ok: false, code: 'cross_repository_contract_probe_invalid' });
  }
}

function git(root, args, trim = true) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5_000 });
  if (result.status !== 0 || result.error) return null;
  return trim ? result.stdout.trim() : result.stdout.replace(/\s+$/u, '');
}

function finding(component, file, code, detail = null) {
  return Object.freeze({ component, file, code, detail });
}

function parseCli(argv) {
  const roots = {};
  let allowDirty = false;
  for (const argument of argv) {
    if (argument === '--allow-dirty') { allowDirty = true; continue; }
    const match = argument.match(/^--(agentic-os|agentic-canvas-os|agentic-graph|agentic-commerce-os)-root=(.+)$/u);
    if (!match || roots[match[1]]) throw new Error(`invalid or duplicate composition argument: ${argument}`);
    roots[match[1]] = match[2];
  }
  return { roots, allowDirty };
}

const invoked = process.argv[1] && realpathOrNull(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const { roots, allowDirty } = parseCli(process.argv.slice(2));
    const report = observeCompositionRuntime({ roots });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.sourceContractsReady || (!allowDirty && !report.sourceCandidateClean)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function realpathOrNull(value) {
  try { return realpathSync(value); } catch { return null; }
}
