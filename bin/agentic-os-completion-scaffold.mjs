#!/usr/bin/env node
/** Read-only cleanup bundle scaffold for one finished lane. */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/governance.mjs';
import { observeGit, repoRoot } from '../src/git.mjs';
import { CLEANUP_EFFECTS, RETAINED_EFFECTS } from '../src/cleanup-records.mjs';
import { GITHUB_TRANSITION_POLICY_PATH } from '../src/github-transition-policy.mjs';
import { trustedRepositoryProfile } from './agentic-os-auxiliary.mjs';
import { inspectCompletionStatus } from './agentic-os-completion-status.mjs';
import { providerPolicy } from '../src/queue.mjs';
import { RECOVERY_LIMITS } from './agentic-os-cleanup-recovery.mjs';
import { gh } from '../src/github-provider.mjs';

const SCAFFOLD_SCHEMA = 'agentic-os/completion-bundle-scaffold/v1';
const REQUIRED_PLACEHOLDERS = Object.freeze([
  'cleanup.plan.candidateDigest',
  'cleanup.plan.snapshotDigest',
  'cleanup.plan.integrationProofDigest',
  'cleanup.plan.recoveryInventoryDigest',
  'cleanup.plan.recoveryInventoryContentEntries',
  'cleanup.plan.ownerStateDigest',
  'cleanup.plan.integrationReceiptDigest',
  'cleanup.plan.integrationPlanByteDigest',
  'cleanup.plan.integrationPredecessorDigest',
  'cleanup.plan.preservationReceiptDigest',
  'cleanup.plan.noRemainingValueReceiptDigest',
  'cleanup.plan.expiresAt',
  'cleanup.integrationReceipt',
  'cleanup.integrationPlanBytes',
  'cleanup.retirementReceipt',
  'cleanup.retirementPlanBytes',
  'cleanup.integrationRequest',
  'cleanup.retirementRequest',
  'cleanup.preservationReceipt',
  'cleanup.noRemainingValueReceipt',
  'integrationVerifier.operationInput',
  'integrationVerifier.workflowRun',
  'retirementVerifier.operationInput',
  'retirementVerifier.workflowRun',
]);
const POLICY_PLACEHOLDERS = Object.freeze([
  'integrationVerifier.policy',
  'retirementVerifier.policy',
]);

function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function placeholder(name) { return `REPLACE_WITH_${name}`; }
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
  if (!Array.isArray(argv) || argv.length !== 1) fail('blocked-completion-arguments',
    'usage: completion-scaffold --ref=<lane>');
  const match = argv[0]?.match(/^--ref=(.+)$/u);
  if (!match) fail('blocked-completion-arguments', `invalid argument ${argv[0] ?? ''}`);
  return Object.freeze({ ref: match[1] });
}

export function buildCompletionBundleScaffold(status, profile, committedState = {}) {
  const targetPath = status.lane.path ?? placeholder('REBOUND_WORKTREE_PATH');
  const authorityRepository = status.enrollment?.authorityRepository
    ?? placeholder('AUTHORITY_REPOSITORY');
  const transitionPolicy = committedState.transitionPolicy ?? placeholder('TRANSITION_POLICY_OBJECT');
  const hasCommittedTransitionPolicy = committedState.transitionPolicy !== null
    && committedState.transitionPolicy !== undefined;
  const integratedReview = committedState.integratedReview ?? null;
  const hasIntegratedReview = integratedReview !== null;
  const warnings = status.findings.map(({ code, action, owner }) => ({ code, owner, action }));
  const stillRequiresAuthenticatedWinners = [];
  for (const item of [
    'integration receipt object',
    'integration plan bytes',
    'integration request object',
    'retirement receipt object',
    'retirement plan bytes',
    'retirement request object',
    'preservation receipt object',
    'no-remaining-value receipt object',
    'integration workflow run',
    'integration operation input',
    'retirement workflow run',
    'retirement operation input',
  ]) stillRequiresAuthenticatedWinners.push(item);
  const nextActions = [];
  if (!status.lane.mounted) {
    nextActions.push('Rebind the retained lane worktree path before cleanup planning.');
  }
  nextActions.push('Replace the remaining REPLACE_WITH_* fields with exact authenticated integrate and retire winners plus cleanup evidence.');
  nextActions.push(`Run npm run completion:plan -- --ref=${status.ref} --bundle=<absolute-json>.`);
  nextActions.push(`After stopping writers, run npm run completion:apply -- --ref=${status.ref} --bundle=<absolute-json> --plan=<absolute-json> --authorize=<eligibility-digest> --stopped.`);
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
    requiredPlaceholders: [
      ...(hasIntegratedReview ? [] : ['cleanup.plan.integratedResource', 'cleanup.plan.integratedImmutableRevision']),
      ...(hasCommittedTransitionPolicy ? REQUIRED_PLACEHOLDERS : [...REQUIRED_PLACEHOLDERS, ...POLICY_PLACEHOLDERS]),
    ],
    stillRequiresAuthenticatedWinners,
    bundleTemplate: {
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
          projectionByteCeiling: RECOVERY_LIMITS.projectionByteCeiling,
          projectionEntryCeiling: RECOVERY_LIMITS.projectionEntryCeiling,
          registrationByteCeiling: RECOVERY_LIMITS.registrationByteCeiling,
          registrationEntryCeiling: RECOVERY_LIMITS.registrationEntryCeiling,
          sharedStateByteCeiling: RECOVERY_LIMITS.sharedStateByteCeiling,
          sharedStateEntryCeiling: RECOVERY_LIMITS.sharedStateEntryCeiling,
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
      },
      integrationVerifier: {
        repository: authorityRepository,
        targetRepository: status.repository,
        operationInput: placeholder('INTEGRATION_OPERATION_INPUT'),
        workflowRun: placeholder('INTEGRATION_WORKFLOW_RUN'),
          policy: clone(transitionPolicy),
      },
      retirementVerifier: {
        repository: authorityRepository,
        targetRepository: status.repository,
        operationInput: placeholder('RETIREMENT_OPERATION_INPUT'),
        workflowRun: placeholder('RETIREMENT_WORKFLOW_RUN'),
          policy: clone(transitionPolicy),
      },
    },
    nextActions,
  };
}
export function runCompletionScaffold(root, ref, out = console.log) {
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
  out(canonicalJson(buildCompletionBundleScaffold(status, profile, committedState)));
  return 0;
}

function main() {
  const { ref } = validateCompletionScaffoldArguments(process.argv.slice(2));
  runCompletionScaffold(process.cwd(), ref, (value) => process.stdout.write(`${value}\n`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    process.stderr.write(`completion-scaffold: ${error.reason ?? 'error'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
