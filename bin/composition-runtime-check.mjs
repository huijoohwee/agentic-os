import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { decodeNulFields, gitBlobOid, observeGit } from '../src/git-tracked.mjs';
import { isValidCompositionMarketplaceProbeReport, marketplaceProbeFindingTarget } from './composition-marketplace-probe.mjs';
export const COMPOSITION_ACCEPTANCE_SCHEMA = 'agentic-os/composition-runtime-acceptance/v1';
const PACKAGE_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url))), MAX_CONTRACT_BYTES = 500_000;
const SNAPSHOT_LIMITS = Object.freeze({ tracked: 10_000, trackedBytes: 134_217_728, fileBytes: 1_048_576, untracked: 512, inventoryBytes: 4_194_304, pathBytes: 262_144, contentBytes: 500_000 });
const CONTRACT = Object.freeze({
  'agentic-os': Object.freeze([
    requirement('guides/COMPOSITION-ARCHITECTURE.md', ['DIR-RUNTIME-READY-01',
      '`agentic-canvas-os`', '`agentic-graph`', '`agentic-commerce-os`', 'VCC-RUNTIME-AUTHORITY-02']),
    requirement('src/github-authority.mjs', ['github-actions-fenced-authority',
      'agentic-os/github-authority-input/v1', "source.event !== 'workflow_dispatch'"]),
    requirement('src/github-authority-operation.mjs', [
      'authority_input_digest does not match the event payload and committed policy']),
    requirement('bin/composition-runtime-check.mjs',
      ['agentic_os_runtime_root_mismatch', 'component_changed_during_probe']),
    requirement('bin/composition-admission-probe.mjs', [
      'agentic-os/composition-cross-repository-probe/v1', 'commerce_admission_consumer_migration_required']),
    requirement('bin/composition-marketplace-probe.mjs', [
      'agentic-os/composition-marketplace-cross-repository-probe/v1', 'withContainedModules',
    ]),
    requirement('bin/composition-module-loader.mjs', ['withContainedModules', 'marketplace_module_untracked']),
  ]),
  'agentic-canvas-os': Object.freeze([
    requirement('package.json', ['"agentic-os": "https://codeload.github.com/huijoohwee/agentic-os/tar.gz/',
      '"lane": "agentic-os start"', '"land": "agentic-os land"', '"reap": "agentic-os reap"'],
    { agenticOsPinPrefix: 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/' }),
    requirement('agent-api/src/commerce-admission-contract.js', [
      'commerce.agentic-os-admission-provider/v3', '/agentic-os/internal/v2/adapter-registrations',
      'agentic-os-adapter-registration/v2', 'commerce-agentic-os-admission-auth/v1',
      'x-agentic-os-admission-auth-signature', 'agentic-os-authoring-operation/v1',
      'authority://agentic-graph/commerce-admission/', 'authoring_mutation_intent', 'x-authoring-reserved-at-ms']),
    requirement('agent-api/src/commerce-admission-authority.js', [
      'agentic-graph-commerce-admission-authority/v1', 'createCommerceAdmissionAuthority',
      'authority_unconfigured', 'authority_expired']),
    requirement('agent-api/src/commerce-admission-provider.js', [
      'createCommerceAdmissionProvider', 'agentic-os-adapter-registration-finding/v1',
      'agentic-os-admission.internal', 'runtime_unconfigured']),
    requirement('test/contracts/agentic-os-admission-v2.fixture.sha256', [
      '3fede7b38f3d8a5004870f31d798cb4218f7d7f59607144ba2fd0b431ac93a61',
      'agentic-os-admission-v2.fixture.json']),
    requirement('wrangler.jsonc', [
      'AGENT_STATE', 'AGENTIC_OS_ADMISSION_AUTH_SECRET', 'AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET']),
    requirement('.github/workflows/adlc-authority.yml', ['workflow_dispatch:', 'authority_input_digest:']),
  ]),
  'agentic-graph': Object.freeze([
    requirement('.agentic-os.json', ['agentic-os/repository-profile/v1',
      'github.com/huijoohwee/agentic-graph', 'Integration Gate', 'quarantine-worktree-cleanup-opt-in']),
    requirement('package.json', ['"land": "agentic-os land"', '"status": "agentic-os status"',
      '"reap": "agentic-os reap"', '"agentic-os": "github:huijoohwee/agentic-os#'],
    { agenticOsPinPrefix: 'github:huijoohwee/agentic-os#' }),
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
    { agenticOsPinPrefix: 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/' }),
    requirement('src/core/acos-admission.ts', ['ACOS_ADMISSION_PROVIDER_CONTRACT',
      'ACOS_ADMISSION_PATH', 'ACOS_ADMISSION_RECEIPT_SCHEMA', 'authoring_mutation_intent']),
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
      'executeProductionRelease', 'recovery', 'preserve', 'recovery_authenticated_preserve_receipt_required']),
    requirement('wrangler.edge.jsonc', ['airvio.co/agentic-commerce-os*']),
  ]),
});
const COMPONENTS = Object.freeze(Object.keys(CONTRACT));
const PROBE_PROCESS_FAILURES = new WeakSet();
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
  probeAdmission = inspectAdmissionJoin,
  probeMarketplace = inspectMarketplaceJoin,
  nodeVersion = process.versions.node,
  typescriptFeature = nodeVersion === process.versions.node ? process.features?.typescript : null,
}) {
  const nativeExecution = inspectGit === inspectGitWorktree
    && probeAdmission === inspectAdmissionJoin && probeMarketplace === inspectMarketplaceJoin;
  const findings = [];
  const components = {};
  const resolvedRoots = {};
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
    const checks = inspectComponentChecks(root, component);
    for (const check of checks) findings.push(...check.findings);
    components[component] = Object.freeze({
      root,
      revision: git.revision,
      clean: git.clean,
      repositoryIdentity: git.repositoryIdentity ?? null,
      worktreeStateDigest: git.worktreeStateDigest ?? null,
      gitStatusCode: git.code ?? null,
      checks: Object.freeze(checks.map(({ findings: omitted, ...check }) => Object.freeze(check))),
    });
    if (!git.ok) findings.push(finding(component, null, git.code));
  }
  if (nativeExecution && resolvedRoots['agentic-os'] !== PACKAGE_ROOT) {
    findings.push(finding('agentic-os', null, 'agentic_os_runtime_root_mismatch'));
  }
  const sourceMarkersReady = findings.every(item => item.code === 'worktree_dirty');
  let admission = Object.freeze({ ok: false, code: 'source_markers_not_ready' });
  let marketplace = Object.freeze({ ok: false, code: 'source_markers_not_ready' });
  if (sourceMarkersReady) {
    admission = executeProbe(
      probeAdmission,
      resolvedRoots,
      isValidAdmissionProbeReport,
      'cross_repository_admission_probe_invalid',
      'cross_repository_admission_probe_failed',
    );
    marketplace = nodeAtLeast(nodeVersion, 22, 22) && ['strip', 'transform'].includes(typescriptFeature)
      ? executeProbe(
        probeMarketplace,
        resolvedRoots,
        isValidCompositionMarketplaceProbeReport,
        'cross_repository_marketplace_probe_invalid',
        'cross_repository_marketplace_probe_failed',
      )
      : Object.freeze({
        schema: 'agentic-os/composition-marketplace-cross-repository-probe/v1',
        ok: false,
        code: 'composition_marketplace_probe_node_runtime_unsupported',
        requiredNode: '>=22.22.0',
        requiredFeature: 'process.features.typescript=strip|transform',
        observedNode: nodeVersion,
      });
    if (!admission.ok) {
      const admissionDrift = admission.code === 'commerce_admission_consumer_migration_required';
      const fixtureInvalid = admission.code?.startsWith('composition_admission_fixture_');
      const providerInvalid = admission.code === 'composition_admission_provider_contract_unexpected';
      const identityUnreadable = admission.code === 'composition_admission_contract_identity_unreadable';
      const probeMissing = admission.code === 'composition_admission_probe_reimplementation_required';
      findings.push(finding(
        fixtureInvalid || providerInvalid || (identityUnreadable && !admission.providerContract)
          ? 'agentic-canvas-os'
          : probeMissing ? 'agentic-os' : 'agentic-commerce-os',
        admissionDrift
          ? 'src/core/acos-admission.ts'
          : fixtureInvalid ? 'test/contracts/agentic-os-admission-v2.fixture.json'
            : providerInvalid ? 'agent-api/src/commerce-admission-contract.js'
              : identityUnreadable ? (admission.providerContract
                ? 'src/core/acos-admission.ts' : 'agent-api/src/commerce-admission-contract.js')
                : 'bin/composition-admission-probe.mjs',
        admission.code || 'cross_repository_admission_probe_failed',
        admissionDrift
          ? `${admission.consumerContract} != ${admission.providerContract}`
          : null,
      ));
    }
    if (!marketplace.ok) {
      const [component, file] = marketplaceProbeFindingTarget(marketplace.code);
      findings.push(finding(
        component,
        file,
        marketplace.code || 'cross_repository_marketplace_probe_failed',
      ));
    }
    for (const [component, before] of Object.entries(components)) {
      const git = inspectGit(resolvedRoots[component], component, REPOSITORY_IDENTITIES[component]);
      const checks = inspectComponentChecks(resolvedRoots[component], component)
        .map(({ findings: omitted, ...check }) => check);
      if (git.revision !== before.revision || git.clean !== before.clean
        || git.repositoryIdentity !== before.repositoryIdentity
        || (git.worktreeStateDigest ?? null) !== before.worktreeStateDigest
        || (git.code ?? null) !== before.gitStatusCode
        || JSON.stringify(checks) !== JSON.stringify(before.checks)) {
        findings.push(finding(component, null, 'component_changed_during_probe'));
      }
    }
  }
  const crossRepositoryContracts = Object.freeze({
    ok: admission.ok && marketplace.ok,
    admission,
    marketplace,
  });
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
function requirement(file, literals, options = {}) {
  return Object.freeze({ file, literals: Object.freeze(literals), ...options });
}
function inspectComponentChecks(root, component) {
  const tracked = trackedFiles(root);
  const checks = CONTRACT[component]
    .map(requirementValue => inspectRequirement(root, component, requirementValue, tracked));
  if (tracked === null) checks.push({
    file: null, status: 'fail', digest: null,
    findings: [finding(component, null, 'contract_inventory_unavailable')],
  });
  if (component !== 'agentic-os') {
    checks.push(...COPIED_WORKFLOW_PATHS.map(file => inspectForbiddenPath(root, component, file)));
  }
  return checks;
}
function inspectRequirement(root, component, { file, literals, agenticOsPinPrefix = null }, tracked) {
  const unresolved = path.resolve(root, file);
  if (!inside(root, unresolved)) return { file, status: 'fail', findings: [finding(component, file, 'contract_path_escaped')] };
  let target;
  try { target = realpathSync(unresolved); } catch {
    return { file, status: 'fail', findings: [finding(component, file, 'contract_file_missing')] };
  }
  if (!inside(root, target)) return { file, status: 'fail', findings: [finding(component, file, 'contract_path_escaped')] };
  let bytes, source;
  try {
    bytes = readBoundedFile(target, MAX_CONTRACT_BYTES, 'composition contract', { expectedPath: target });
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { file, status: 'fail', findings: [finding(component, file, 'contract_file_unreadable_or_oversized')] };
  }
  const findings = tracked && (!tracked.has(file) || !tracked.has(path.relative(root, target)))
    ? [finding(component, file, 'contract_file_untracked')] : [];
  findings.push(...literals.filter(literal => !source.includes(literal))
    .map(literal => finding(component, file, 'contract_literal_missing', literal)));
  if (agenticOsPinPrefix && !hasExactAgenticOsPin(source, agenticOsPinPrefix)) {
    findings.push(finding(component, file, 'agentic_os_package_pin_invalid'));
  }
  return {
    file,
    status: findings.length === 0 ? 'pass' : 'fail',
    digest: createHash('sha256').update(bytes).digest('hex'),
    findings,
  };
}
function hasExactAgenticOsPin(source, prefix) {
  let manifest;
  try { manifest = JSON.parse(source); } catch { return false; }
  const pin = manifest.dependencies?.['agentic-os']
    ?? manifest.devDependencies?.['agentic-os']
    ?? manifest.optionalDependencies?.['agentic-os'];
  return typeof pin === 'string'
    && pin.startsWith(prefix)
    && /^[0-9a-f]{40}$/u.test(pin.slice(prefix.length));
}
function inspectForbiddenPath(root, component, file) {
  const target = path.resolve(root, file);
  let present = true;
  try { present = lstatSync(target, { throwIfNoEntry: false }) !== undefined; } catch {}
  const forbidden = !inside(root, target) || present;
  return {
    file,
    status: forbidden ? 'fail' : 'pass',
    findings: forbidden ? [finding(component, file, 'copied_workflow_asset_forbidden')] : [],
  };
}
function trackedFiles(root) {
  const output = git(root, ['ls-files', '-z'], false);
  return output === null ? null : new Set(output.split('\0').filter(Boolean));
}
function nodeAtLeast(value, requiredMajor, requiredMinor) {
  const match = String(value).match(/^(\d+)\.(\d+)\./u);
  return Boolean(match) && (Number(match[1]) > requiredMajor
    || (Number(match[1]) === requiredMajor && Number(match[2]) >= requiredMinor));
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
  const repositoryIdentity = normalizeRepositoryIdentity(git(root, ['remote', 'get-url', 'origin']));
  if (repositoryIdentity !== expectedRepositoryIdentity)
    return failedGitState('git_origin_unexpected', revision, repositoryIdentity);
  const state = inspectGitState(root);
  if (state === null)
    return failedGitState('git_worktree_snapshot_unavailable', revision, repositoryIdentity);
  const clean = state.status === '';
  return { ok: clean, clean, revision, repositoryIdentity,
    worktreeStateDigest: state.digest, code: clean ? null : 'worktree_dirty' };
}
function failedGitState(code, revision = null, repositoryIdentity = null) {
  return { ok: false, clean: false, revision, repositoryIdentity,
    worktreeStateDigest: null, code };
}
function inspectGitState(root) {
  const commands = [
    ['ls-files', '--stage', '-z'], ['ls-files', '-v', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
    ['diff', '--cached', '--raw', '-z', '--no-renames', '--abbrev=64', '--ita-visible-in-index', 'HEAD', '--'],
  ];
  const inventory = commands.map(args => observeGit(args, {
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
  const after = commands.map(args => observeGit(args, { cwd: root, allowFail: true, binary: true, maxBuffer: 4_194_304 })); if (after.some((value, position) => !Buffer.isBuffer(value) || !value.equals(inventory[position]))) return null;
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
function executeProbe(probe, roots, validate, invalidCode, failedCode) {
  let report;
  try { report = probe(roots); } catch { return Object.freeze({ ok: false, code: failedCode }); }
  if (PROBE_PROCESS_FAILURES.has(report)) return report;
  return validate(report) ? Object.freeze(report) : Object.freeze({ ok: false, code: invalidCode });
}
function inspectAdmissionJoin(roots) {
  return runProbeProcess(
    './composition-admission-probe.mjs',
    [
      roots['agentic-canvas-os'],
      roots['agentic-commerce-os'],
      roots['agentic-graph'],
      path.join(roots['agentic-canvas-os'], 'test/contracts/agentic-os-admission-v2.fixture.json'),
    ],
    'cross_repository_admission_probe_invalid',
    'cross_repository_admission_probe_failed',
  );
}
function inspectMarketplaceJoin(roots) {
  return runProbeProcess(
    './composition-marketplace-probe.mjs',
    [roots['agentic-commerce-os'], roots['agentic-graph']],
    'cross_repository_marketplace_probe_invalid',
    'cross_repository_marketplace_probe_failed',
  );
}
function runProbeProcess(relative, args, invalidCode, failedCode) {
  const probe = fileURLToPath(new URL(relative, import.meta.url));
  const result = spawnSync(process.execPath, [probe, ...args], {
    encoding: 'utf8',
    env: childEnvironment(),
    timeout: 10_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1_048_576,
  });
  if (result.error) return processFailure(failedCode);
  if (result.status !== 0 && result.stdout.trim() === '') {
    return processFailure(failedCode);
  }
  let report;
  try { report = JSON.parse(result.stdout); } catch { return Object.freeze({ ok: false, code: invalidCode }); }
  if ((report?.ok === true && result.status !== 0)
      || (report?.ok === false && result.status !== 1)) {
    return processFailure(failedCode);
  }
  return report;
}
function processFailure(code) {
  const report = Object.freeze({ ok: false, code });
  PROBE_PROCESS_FAILURES.add(report);
  return report;
}
function isValidAdmissionProbeReport(report) {
  if (report?.schema !== 'agentic-os/composition-cross-repository-probe/v1') return false;
  if (report.ok === false) {
    if (report.code === 'composition_admission_contract_identity_unreadable') {
      return report.requiredContract === 'commerce.agentic-os-admission-provider/v3'
        && (report.providerContract === null || typeof report.providerContract === 'string')
        && (report.consumerContract === null || typeof report.consumerContract === 'string')
        && (report.providerContract === null || report.consumerContract === null)
        && report.runtimeAcceptanceObserved === false;
    }
    return [
      'commerce_admission_consumer_migration_required',
      'composition_admission_probe_reimplementation_required',
      'composition_admission_provider_contract_unexpected',
      'composition_admission_fixture_not_owner_published',
      'composition_admission_fixture_size_invalid',
      'composition_admission_fixture_digest_invalid',
      'composition_admission_fixture_json_invalid',
      'composition_admission_fixture_schema_invalid',
      'composition_admission_fixture_shape_invalid',
    ].includes(report.code)
      && report.requiredContract === 'commerce.agentic-os-admission-provider/v3'
      && typeof report.providerContract === 'string'
      && typeof report.consumerContract === 'string'
      && report.runtimeAcceptanceObserved === false;
  }
  return report.ok === true
    && report.runtimeAcceptanceObserved === true
    && report.fixtureSchema === 'commerce.agentic-os-admission-v2-request-fixture/v1'
    && report.fixtureDigest === '3fede7b38f3d8a5004870f31d798cb4218f7d7f59607144ba2fd0b431ac93a61'
    && report.providerContract === 'commerce.agentic-os-admission-provider/v3'
    && report.consumerContract === 'commerce.agentic-os-admission-provider/v3'
    && report.consumerValidated === true
    && report.productionProjectionValidated === true
    && report.admissionAuthenticationValidated === true
    && report.extraKeyDriftRejected === true
    && report.findingSchemaValidated === true
    && report.graphAuthorityValidated === true
    && report.receiptSchema === 'agentic-os-adapter-registration/v2'
    && report.requestDigest === 'fec4d3f616fbda388e6392be63e9b5fb5bbe8f899901aacb3407ad7fb60de7f2'
    && Number.isSafeInteger(report.firstWriteCount) && report.firstWriteCount > 0
    && report.replayWriteCount === 0
    && report.restartReady === true;
}
function git(root, args, trim = true) {
  return observeGit(args, { cwd: root, allowFail: true, raw: !trim, maxBuffer: 4_194_304 });
}
function childEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^(?:GIT_|NODE_)/iu.test(key)) delete environment[key];
  return environment;
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
function realpathOrNull(value) { try { return realpathSync(value); } catch { return null; } }
