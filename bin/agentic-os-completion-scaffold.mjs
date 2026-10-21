#!/usr/bin/env node
/** Read-only cleanup bundle scaffold for one finished lane. */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { observeGit, repoRoot } from '../src/git.mjs';
import { CLEANUP_EFFECTS, RETAINED_EFFECTS } from '../src/cleanup-records.mjs';
import { GITHUB_TRANSITION_POLICY_PATH } from '../src/github-transition-policy.mjs';
import { trustedRepositoryProfile } from './agentic-os-auxiliary.mjs';
import { inspectCompletionStatus } from './agentic-os-completion-status.mjs';
import { providerPolicy } from '../src/queue.mjs';
import { RECOVERY_LIMITS } from './agentic-os-cleanup-recovery.mjs';
import { gh } from '../src/github-provider.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';

const SCAFFOLD_SCHEMA = 'agentic-os/completion-bundle-scaffold/v1';
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function placeholder(name) { return `REPLACE_WITH_${name}`; }
const isPlaceholder = value => typeof value === 'string' && value.startsWith('REPLACE_WITH_');
function placeholderPaths(value, path = '') {
  if (isPlaceholder(value)) return [path];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => placeholderPaths(child, path ? `${path}.${key}` : key));
}
function clone(value) { return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)); }
function committed(root, revision, path) {
  return observeGit(['show', `${revision}:${path}`], { cwd: root, allowFail: true, maxBuffer: 131072 });
}
function committedJson(root, revision, path) {
  const bytes = committed(root, revision, path);
  if (bytes === null) return null;
  try { return JSON.parse(bytes); } catch {
    fail('blocked-completion-input', `committed JSON is invalid at ${path}`);
  }
}
function reviewIdentity(status) {
  if (status.repository.startsWith('github.com/')) return status.repository.slice('github.com/'.length);
  return null;
}
function observeIntegratedReview(root, status) {
  const repo = reviewIdentity(status);
  if (!repo || !status.lane.head) return null;
  const rows = gh([
    'pr', 'list', '--state', 'merged', '--head', status.ref, '--limit', '20',
    '--json', 'number,url,state,headRefName,headRefOid,mergeCommit,baseRefName', '--repo', repo,
  ], { cwd: root, json: true });
  if (!Array.isArray(rows)) return null;
  const exact = rows.filter((entry) => entry?.state === 'MERGED'
    && entry?.headRefName === status.ref
    && entry?.headRefOid === status.lane.head
    && entry?.baseRefName === 'main'
    && typeof entry?.url === 'string'
    && typeof entry?.mergeCommit?.oid === 'string');
  if (exact.length !== 1) return null;
  return {
    url: exact[0].url,
    mergeCommit: exact[0].mergeCommit.oid,
    number: exact[0].number,
  };
}

export function validateCompletionScaffoldArguments(argv) {
  if (!Array.isArray(argv) || argv.length < 1) fail('blocked-completion-arguments',
    'usage: completion-scaffold --ref=<lane> [--derive]');
  const refArg = argv.find((arg) => arg?.startsWith?.('--ref='));
  if (!refArg) fail('blocked-completion-arguments', 'missing --ref=<lane>');
  const match = refArg.match(/^--ref=(.+)$/u);
  if (!match) fail('blocked-completion-arguments', `invalid argument ${refArg}`);
  const derive = argv.includes('--derive');
  const unknown = argv.filter((arg) => arg !== '--derive' && arg !== refArg);
  if (unknown.length > 0) fail('blocked-completion-arguments', `unknown argument ${unknown[0] ?? ''}`);
  return Object.freeze({ ref: match[1], derive });
}

export function buildCompletionBundleScaffold(status, profile, committedState = {}) {
  const targetPath = status.lane.path ?? placeholder('REBOUND_WORKTREE_PATH'),
    authorityRepository = status.enrollment?.authorityRepository ?? placeholder('AUTHORITY_REPOSITORY'),
    transitionPolicy = committedState.transitionPolicy ?? placeholder('TRANSITION_POLICY_OBJECT'),
    integratedReview = committedState.integratedReview ?? null,
    warnings = status.findings.map(({ code, action, owner }) => ({ code, owner, action }));
  const verifierTemplate = (operation) => ({
    repository: authorityRepository,
    targetRepository: status.repository,
    operationInput: placeholder(`${operation}_OPERATION_INPUT`),
    workflowRun: placeholder(`${operation}_WORKFLOW_RUN`),
    policy: clone(transitionPolicy),
  });
  const hydrationInputs = [...AUTHORITY_INPUT_FIELDS,
    ...(!status.enrollment?.authorityRepository ? ['integrationVerifier.repository', 'retirementVerifier.repository'] : []),
    ...(committedState.transitionPolicy == null ? ['integrationVerifier.policy', 'retirementVerifier.policy'] : [])];
  const bundleTemplate = {
    cleanup: {
      plan: {
        repository: status.repository,
        targetPath,
        expectedBranch: status.ref,
        expectedHeadRevision: status.lane.head,
        expectedCanonicalRef: profile.canonical.localRef,
        expectedCanonicalRevision: status.canonicalRevision,
        integratedResource: integratedReview?.url ?? placeholder('INTEGRATED_RESOURCE'),
        integratedImmutableRevision: integratedReview?.mergeCommit ?? placeholder('INTEGRATED_IMMUTABLE_REVISION'),
        candidateDigest: placeholder('CANDIDATE_DIGEST'),
        snapshotDigest: placeholder('SNAPSHOT_DIGEST'),
        integrationProofDigest: placeholder('INTEGRATION_PROOF_DIGEST'),
        profileDigest: profile.profileDigest,
        recoveryInventoryDigest: placeholder('RECOVERY_INVENTORY_DIGEST'),
        recoveryInventoryContentEntries: placeholder('RECOVERY_INVENTORY_CONTENT_ENTRIES'),
        ownerStateDigest: placeholder('OWNER_STATE_DIGEST'),
        integrationReceiptDigest: placeholder('INTEGRATION_RECEIPT_DIGEST'),
        integrationPlanByteDigest: placeholder('INTEGRATION_PLAN_BYTE_DIGEST'),
        integrationPredecessorDigest: placeholder('INTEGRATION_PREDECESSOR_DIGEST'),
        preservationReceiptDigest: placeholder('PRESERVATION_RECEIPT_DIGEST'),
        noRemainingValueReceiptDigest: placeholder('NO_REMAINING_VALUE_RECEIPT_DIGEST'),
        ...RECOVERY_LIMITS,
        authorizedEffects: [...CLEANUP_EFFECTS],
        retainedEffects: [...RETAINED_EFFECTS],
        expiresAt: placeholder('CLEANUP_EXPIRES_AT'),
      },
      integrationReceipt: placeholder('INTEGRATION_RECEIPT_OBJECT'),
      integrationPlanBytes: placeholder('INTEGRATION_PLAN_BYTES'),
      retirementReceipt: placeholder('RETIREMENT_RECEIPT_OBJECT'),
      retirementPlanBytes: placeholder('RETIREMENT_PLAN_BYTES'),
      integrationRequest: placeholder('INTEGRATION_REQUEST_OBJECT'),
      retirementRequest: placeholder('RETIREMENT_REQUEST_OBJECT'),
      preservationReceipt: placeholder('PRESERVATION_RECEIPT_OBJECT'),
      noRemainingValueReceipt: placeholder('NO_REMAINING_VALUE_RECEIPT_OBJECT'),
      cleanupContinuation: null,
    },
    integrationVerifier: verifierTemplate('INTEGRATION'),
    retirementVerifier: verifierTemplate('RETIREMENT'),
  };
  return {
    schema: SCAFFOLD_SCHEMA,
    observationOnly: true,
    authorizesEffects: false,
    ref: status.ref,
    repository: status.repository,
    profileDigest: profile.profileDigest,
    canonicalRevision: status.canonicalRevision,
    canonicalRef: profile.canonical.localRef,
    lane: status.lane,
    integration: status.integration,
    enrollment: status.enrollment,
    warnings,
    committedState,
    requiredPlaceholders: placeholderPaths(bundleTemplate), autoDerivedFields: ['cleanup.cleanupContinuation'], hydrationInputs,
    bundleTemplate,
  };
}
/**
 * Fill only local inventory observations and the bounded expiry; retain exact
 * authenticated transition inputs, receipts and digests for protected replay.
 * This observation grants no effects or cleanup authority. The operator must
 * still run completion:plan and completion:apply with the full protected chain.
 */
const DERIVE_TTL_MS = 900000;
const AUTHORITY_INPUT_FIELDS = Object.freeze([
  'cleanup.integrationReceipt', 'cleanup.retirementReceipt',
  'cleanup.preservationReceipt', 'cleanup.noRemainingValueReceipt',
  'integrationVerifier.operationInput', 'integrationVerifier.workflowRun',
  'retirementVerifier.operationInput', 'retirementVerifier.workflowRun',
]);
export function deriveLocallyAvailableFields(scaffold, status, canonicalRoot, { now = Date.now } = {}) {
  const issuedAt = now(); if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) fail('blocked-completion-clock', 'cleanup scaffold requires a valid clock');
  const derived = { 'cleanup.plan.expiresAt': new Date(issuedAt + DERIVE_TTL_MS).toISOString() };
  const lanePath = status.lane?.path;
  if (lanePath) {
    const plan = scaffold.bundleTemplate.cleanup.plan;
    if ([plan.targetPath !== lanePath, plan.repository !== status.repository, plan.expectedBranch !== status.ref,
      plan.expectedHeadRevision !== status.lane.head, plan.expectedCanonicalRef !== scaffold.canonicalRef,
      plan.expectedCanonicalRevision !== status.canonicalRevision, plan.profileDigest !== scaffold.profileDigest].some(Boolean))
      fail('blocked-completion-inventory-drift', 'recovery inventory scaffold identity no longer matches the lane observation');
    const inventory = collectRecoveryInventory({ cwd: lanePath, canonicalRef: scaffold.canonicalRef, maxContentEntries: plan.projectionEntryCeiling });
    if (inventory.branch !== status.ref || inventory.headRevision !== status.lane.head || inventory.canonicalRevision !== status.canonicalRevision)
      fail('blocked-completion-inventory-drift', 'recovery inventory no longer matches the lane observation');
    derived['cleanup.plan.recoveryInventoryDigest'] = governanceDigest(inventory);
    derived['cleanup.plan.recoveryInventoryContentEntries'] = inventory.inventoryEntries.content;
  }
  const fill = (node, path = '') => {
    if (!node || typeof node !== 'object') return isPlaceholder(node) && Object.hasOwn(derived, path) ? derived[path] : node;
    if (Array.isArray(node)) return node.map((item) => fill(item, path));
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, fill(value, path ? `${path}.${key}` : key)]));
  };
  const filled = { ...scaffold, bundleTemplate: fill(scaffold.bundleTemplate, '') };
  return {
    ...filled,
    derivedFields: Object.keys(derived),
    remainingPlaceholders: scaffold.requiredPlaceholders.filter((key) => scaffold.hydrationInputs?.includes(key) && !Object.hasOwn(derived, key)),
    derivedAt: new Date(issuedAt).toISOString(),
    deriveNote: 'Local inventory and expiry are pre-filled. Fill hydrationInputs, then pass this scaffold directly to completion:plan.',
  };
}
export function runCompletionScaffold(root, ref, out = console.log, { derive = false, now = Date.now } = {}) {
  const canonical = realpathSync(repoRoot(root));
  if (realpathSync(root) !== canonical) fail('blocked-canonical-required', 'run from the canonical checkout');
  const trusted = trustedRepositoryProfile(canonical), profile = trusted.profile;
  if (!profile) fail('blocked-repository-profile-missing', 'committed trusted profile required');
  const status = inspectCompletionStatus(canonical, ref, providerPolicy(profile), profile);
  if (!status.lane.head) fail('blocked-lane-ref-missing', 'Recover the exact local lane ref before scaffolding cleanup inputs.');
  if (!status.integration) fail('blocked-integration-not-classified',
    'Run reap for this ref and complete the protected PR before scaffolding cleanup inputs.');
  const committedState = {
    transitionPolicy: committedJson(canonical, status.canonicalRevision, GITHUB_TRANSITION_POLICY_PATH),
    integratedReview: observeIntegratedReview(canonical, status),
  };
  const scaffold = buildCompletionBundleScaffold(status, profile, committedState);
  out(canonicalJson(derive ? deriveLocallyAvailableFields(scaffold, status, canonical, { now }) : scaffold));
  return 0;
}

function main() {
  const { ref, derive } = validateCompletionScaffoldArguments(process.argv.slice(2));
  runCompletionScaffold(process.cwd(), ref, (value) => process.stdout.write(`${value}\n`), { derive });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(`completion-scaffold: ${error.reason ?? 'error'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
