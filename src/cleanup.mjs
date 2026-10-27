/** Join authenticated lifecycle evidence to exact, quarantine-only Git worktree effects. */
import { canonicalJson, governanceDigest } from './governance.mjs';
import { createHash } from 'node:crypto';
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { commonDir, currentBranch, observeGit, remoteTransport, repoRoot, worktrees } from './git.mjs';
import { isLaneRef, parseLaneRef } from './lane-id.mjs';
import { get } from './lane-records.mjs';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { inferMergedReviewWorkflow, observeMergedReview, githubRead } from '../bin/agentic-os-cleanup-review.mjs';
import { applyUserCleanup, planUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { RECOVERY_MODE, recoveryPolicy } from '../bin/agentic-os-cleanup-recovery.mjs';
import { createWorkflowEffectGuard } from '../bin/agentic-os-workflow.mjs';
import { option } from '../bin/agentic-os-argv.mjs';
import {
  effectPlanByteDigest, replayAuthenticatedTransitionOperationReceipt,
  validateAuthenticatedTransitionOperationReceipt,
  validateEffectPlanBytes,
} from './completion.mjs';
import { acquireOperationLock, finishOperationLock } from './git.mjs';
import {
  CLEANUP_EFFECTS, INTEGRATION_RECORD_EFFECTS, INTEGRATION_RECORD_RETAINED_EFFECTS,
  RETAINED_EFFECTS, createWorktreeCleanupEligibility,
  validateWorktreeCleanupContinuation,
  createWorktreeCleanupReceipt, deriveCleanupOwnerStateDigest,
  validateCleanupEvidenceReceipt, validateWorktreeCleanupEligibility,
  validateWorktreeCleanupPlan, worktreeCleanupPlanByteDigest,
} from './cleanup-records.mjs';
import {
  classifyExistingWorktreeQuarantine, observeWorktreeCleanupTarget, quarantineWorktreeTarget,
} from './cleanup-quarantine.mjs';

export * from './cleanup-records.mjs';
export { observeQuarantineManifest } from './cleanup-quarantine.mjs';

function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function typeFail(message) { throw new TypeError(message); }
const assertLaneBytesResolved = (ref, root) => { if (isLaneRef(ref) && get(ref, root)?.recovery?.dirtyState === 'unobservable-at-missing-path') fail('blocked-cleanup-lane-state-unknown', 'reconstructed lane bytes remain unresolved; preserve and disposition them before cleanup'); };
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function cleanupContinuation(value, plan, retirement, retirementPlan, ownerStateDigest) {
  if (value === undefined) return null;
  const authority = validateWorktreeCleanupContinuation(value);
  if (authority.repository !== plan.repository
    || authority.targetPath !== plan.targetPath
    || authority.integratedImmutableRevision !== plan.integratedImmutableRevision
    || authority.candidateDigest !== plan.candidateDigest
    || authority.snapshotDigest !== plan.snapshotDigest
    || authority.ownerStateDigest !== ownerStateDigest
    || authority.retirementReceiptDigest !== retirement.receiptDigest
    || authority.priorCleanupPlanByteDigest !== retirementPlan.parametersDigest
    || authority.cleanupPlanDigest !== plan.planDigest
    || authority.cleanupPlanByteDigest !== worktreeCleanupPlanByteDigest(plan)) {
    fail('blocked-cleanup-authority-unjoined',
      'cleanup continuation does not authorize this exact cleanup plan');
  }
  return authority;
}

function evidenceJoin(input) {
  const plan = validateWorktreeCleanupPlan(input.plan);
  const integration = validateAuthenticatedTransitionOperationReceipt(input.integrationReceipt);
  const retirement = validateAuthenticatedTransitionOperationReceipt(input.retirementReceipt);
  const preservation = validateCleanupEvidenceReceipt(input.preservationReceipt);
  const noValue = validateCleanupEvidenceReceipt(input.noRemainingValueReceipt);
  const integrationPlan = validateEffectPlanBytes(input.integrationPlanBytes);
  const retirementPlan = validateEffectPlanBytes(input.retirementPlanBytes);
  const integrationPlanByteDigest = effectPlanByteDigest(input.integrationPlanBytes);
  if (integration.requestedTransition !== 'integrate'
    || integration.transitionReceipt.resultState !== 'integrated'
    || integration.receiptDigest !== plan.integrationReceiptDigest
    || integration.planByteDigest !== integrationPlanByteDigest
    || integration.planDigest !== integrationPlan.planDigest
    || integrationPlanByteDigest !== plan.integrationPlanByteDigest
    || integrationPlan.authority.requestedTransition !== 'integrate'
    || integrationPlan.authority.authoritySubject
      !== integration.transitionReceipt.authoritySubject
    || integrationPlan.authority.claimId !== integration.transitionReceipt.sourceClaimId
    || integrationPlan.authority.leaseEpoch !== integration.transitionReceipt.sourceLeaseEpoch
    || integrationPlan.authority.fenceRevision
      !== integration.transitionReceipt.sourceFenceRevision
    || integrationPlan.authority.predecessorDigest !== plan.integrationPredecessorDigest
    || integrationPlan.target.repository !== plan.repository
    || integrationPlan.target.resource !== plan.integratedResource
    || integration.transitionReceipt.reviewLocator !== plan.integratedResource
    || integrationPlan.target.immutableRevision !== plan.integratedImmutableRevision
    || integration.transitionReceipt.immutableRevision !== plan.integratedImmutableRevision
    || integrationPlan.candidateDigest !== plan.candidateDigest
    || integrationPlan.snapshotDigest !== plan.snapshotDigest
    || integrationPlan.effectClass !== 'protected-integration-record'
    || integrationPlan.parametersDigest !== plan.integrationProofDigest
    || !same(integrationPlan.allowedEffects, INTEGRATION_RECORD_EFFECTS)
    || !same(integrationPlan.forbiddenEffects, INTEGRATION_RECORD_RETAINED_EFFECTS))
    fail('blocked-not-integrated', 'exact authenticated integration is not proven');
  const ownerStateDigest = deriveCleanupOwnerStateDigest({
    claimId: integration.transitionReceipt.resultClaimId,
    leaseEpoch: integration.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.transitionReceipt.resultFenceRevision,
    state: integration.transitionReceipt.resultState,
  });
  if (ownerStateDigest !== plan.ownerStateDigest)
    fail('blocked-owner-state-drift', 'cleanup owner state is not bound to integration');
  if (retirement.requestedTransition !== 'retire'
    || retirement.transitionReceipt.resultState !== 'retired'
    || retirement.transitionReceipt.sourceClaimId !== integration.transitionReceipt.resultClaimId
    || retirement.transitionReceipt.sourceLeaseEpoch !== integration.transitionReceipt.resultLeaseEpoch
    || retirement.transitionReceipt.sourceFenceRevision !== integration.transitionReceipt.resultFenceRevision)
    fail('blocked-not-retired', 'exact authenticated retirement does not follow integration');
  const retirementPlanByteDigest = effectPlanByteDigest(input.retirementPlanBytes);
  const continuation = cleanupContinuation(input.cleanupContinuation, plan, retirement,
    retirementPlan, ownerStateDigest);
  const joinedCleanupPlan = continuation === null
    ? retirementPlan.parametersDigest === worktreeCleanupPlanByteDigest(plan)
    : true;
  if (retirement.planByteDigest !== retirementPlanByteDigest
    || retirement.planDigest !== retirementPlan.planDigest
    || !joinedCleanupPlan
    || retirementPlan.target.repository !== plan.repository
    || retirementPlan.target.resource !== plan.targetPath
    || retirementPlan.target.immutableRevision !== plan.integratedImmutableRevision
    || retirementPlan.candidateDigest !== plan.candidateDigest
    || retirementPlan.snapshotDigest !== plan.snapshotDigest
    || retirementPlan.authority.predecessorDigest !== integration.receiptDigest
    || retirementPlan.authority.requestedTransition !== retirement.requestedTransition
    || retirementPlan.authority.authoritySubject !== retirement.transitionReceipt.authoritySubject
    || retirementPlan.authority.claimId !== retirement.transitionReceipt.sourceClaimId
    || retirementPlan.authority.leaseEpoch !== retirement.transitionReceipt.sourceLeaseEpoch
    || retirementPlan.authority.fenceRevision !== retirement.transitionReceipt.sourceFenceRevision
    || retirementPlan.authority.reviewLocator !== retirement.transitionReceipt.reviewLocator
    || retirementPlan.target.immutableRevision !== retirement.transitionReceipt.immutableRevision
    || retirementPlan.effectClass !== 'claim-retirement-with-cleanup'
    || !same(retirementPlan.allowedEffects, [...CLEANUP_EFFECTS, 'retire-claim'].sort())
    || !same(retirementPlan.forbiddenEffects, RETAINED_EFFECTS))
    fail('blocked-cleanup-authority-unjoined',
      'retirement does not authorize this exact cleanup plan');
  for (const [receipt, kind, expected] of [
    [preservation, 'preservation', plan.preservationReceiptDigest],
    [noValue, 'no-remaining-value', plan.noRemainingValueReceiptDigest],
  ]) {
    if (receipt.kind !== kind || receipt.receiptDigest !== expected
      || receipt.repository !== plan.repository || receipt.targetPath !== plan.targetPath
      || receipt.candidateDigest !== plan.candidateDigest
      || receipt.snapshotDigest !== plan.snapshotDigest
      || receipt.integrationReceiptDigest !== integration.receiptDigest
      || receipt.recoveryInventoryDigest !== plan.recoveryInventoryDigest
      || receipt.recoveryInventoryContentEntries !== plan.recoveryInventoryContentEntries
      || receipt.ownerStateDigest !== ownerStateDigest)
      fail('blocked-cleanup-evidence', `exact ${kind} evidence is not proven`);
  }
  if (preservation.archiveDigest !== noValue.archiveDigest
    || preservation.preservationComplete !== true
    || noValue.reachableFromRetainedRefs !== true
    || noValue.unpreservedValueCount !== 0)
    fail('blocked-remaining-value-unproven',
      'every dirty byte must be preserved and no remaining value must be proven');
  const expiresAt = continuation === null
    ? new Date(Math.min(Date.parse(plan.expiresAt),
      Date.parse(integration.authorityOperation.expiresAt),
      Date.parse(retirement.authorityOperation.expiresAt))).toISOString()
    : new Date(Math.min(Date.parse(plan.expiresAt),
      Date.parse(continuation.expiresAt))).toISOString();
  return { plan, integration, integrationPlan, integrationPlanByteDigest, retirement,
    preservation, noValue, ownerStateDigest, retirementPlanByteDigest, continuation, expiresAt };
}

async function liveEvidenceJoin(input, options) {
  const joined = evidenceJoin(input);
  if (typeof options?.verifyIntegrationAuthority !== 'function'
    || typeof options?.verifyRetirementAuthority !== 'function')
    fail('blocked-provider-authentication',
      'cleanup requires trusted live integration and retirement provider verifiers');
  const [integration, retirement] = await Promise.all([
    replayAuthenticatedTransitionOperationReceipt({ request: input.integrationRequest,
      planBytes: input.integrationPlanBytes }, options.verifyIntegrationAuthority),
    replayAuthenticatedTransitionOperationReceipt({ request: input.retirementRequest,
      planBytes: input.retirementPlanBytes }, options.verifyRetirementAuthority),
  ]);
  if (!same(integration, joined.integration) || !same(retirement, joined.retirement))
    fail('blocked-provider-authentication',
      'cleanup transition receipts do not match live immutable provider winners');
  return joined;
}

function trustedClock(options, label) {
  const source = options ?? {};
  if (typeof source.now !== 'function') typeFail(`${label} requires a trusted clock`);
  const value = source.now();
  if (!Number.isSafeInteger(value) || value < 0) typeFail(`${label} trusted clock is invalid`);
  return value;
}

function cleanupResult(applied, eligibility) {
  return { ...applied.result,
    projectionManifestDigest: eligibility.projectionManifestDigest,
    projectionBytes: eligibility.projectionBytes,
    projectionEntries: eligibility.projectionEntries,
    registrationManifestDigest: eligibility.registrationManifestDigest,
    registrationBytes: eligibility.registrationBytes,
    registrationEntries: eligibility.registrationEntries,
    recoveryInventoryDigest: eligibility.recoveryInventoryDigest,
    recoveryInventoryContentEntries: eligibility.recoveryInventoryContentEntries,
    profileDigest: eligibility.profileDigest, canonicalRevision: eligibility.canonicalRevision,
    peerRegistrationDigest: eligibility.peerRegistrationDigest,
    sharedRefDigest: eligibility.sharedRefDigest,
    objectInventoryDigest: eligibility.objectInventoryDigest,
    sharedStateBytes: eligibility.sharedStateBytes,
    sharedStateEntries: eligibility.sharedStateEntries,
    registeredBefore: true, registeredAfter: false, targetPathExistsBefore: true,
    targetPathExistsAfter: false, adminBytesRetained: true,
    branchMutationAttempted: false, objectMutationAttempted: false,
    directoryByteRemovalAttempted: false, operatingSystemExclusivityProven: false,
    result: 'quarantined' };
}

export async function assessWorktreeCleanupEligibility(input, options) {
  assertLaneBytesResolved(input?.plan?.expectedBranch ?? input?.plan?.branch, options.cwd); const joined = await liveEvidenceJoin(input, options);
  assertLaneBytesResolved(joined.plan.expectedBranch ?? joined.plan.branch, options.cwd); const evaluated = trustedClock(options, 'cleanup eligibility');
  if (evaluated >= Date.parse(joined.expiresAt))
    fail('blocked-cleanup-expired', 'cleanup plan is not current');
  const observation = observeWorktreeCleanupTarget(joined.plan, { cwd: options.cwd, reuseRecoveryInventory: true, now: () => evaluated });
  return createWorktreeCleanupEligibility({ cleanupPlanDigest: joined.plan.planDigest,
    cleanupPlanByteDigest: worktreeCleanupPlanByteDigest(joined.plan),
    integrationReceiptDigest: joined.integration.receiptDigest,
    integrationPlanByteDigest: joined.integrationPlanByteDigest,
    retirementReceiptDigest: joined.retirement.receiptDigest,
    preservationReceiptDigest: joined.preservation.receiptDigest,
    noRemainingValueReceiptDigest: joined.noValue.receiptDigest,
    retirementPlanByteDigest: joined.retirementPlanByteDigest,
    recoveryInventoryDigest: observation.recoveryInventoryDigest,
    recoveryInventoryContentEntries: observation.recoveryInventoryContentEntries,
    ownerStateDigest: joined.ownerStateDigest, profileDigest: observation.profileDigest,
    canonicalRevision: observation.canonicalRevision,
    targetObservationDigest: observation.observationDigest,
    projectionManifestDigest: observation.projectionManifest.digest,
    projectionBytes: observation.projectionManifest.bytes,
    projectionEntries: observation.projectionManifest.entries,
    registrationManifestDigest: observation.registrationManifest.digest,
    registrationBytes: observation.registrationManifest.bytes,
    registrationEntries: observation.registrationManifest.entries,
    peerRegistrationDigest: observation.peerRegistrationDigest,
    sharedRefDigest: observation.sharedRefDigest,
    objectInventoryDigest: observation.objectInventoryDigest,
    sharedStateBytes: observation.sharedStateBytes,
    sharedStateEntries: observation.sharedStateEntries,
    eligibleEffects: [...CLEANUP_EFFECTS], evaluatedAt: new Date(evaluated).toISOString(),
    expiresAt: joined.expiresAt });
}

export async function executeWorktreeCleanup(input, options) {
  const keys = ['plan', 'integrationReceipt', 'integrationPlanBytes', 'retirementReceipt',
    'retirementPlanBytes', 'integrationRequest', 'retirementRequest', 'preservationReceipt',
    'noRemainingValueReceipt', 'cleanupContinuation', 'eligibility', 'authorizationDigest'];
  const requiredKeys = ['plan', 'integrationReceipt', 'integrationPlanBytes', 'retirementReceipt',
    'retirementPlanBytes', 'integrationRequest', 'retirementRequest', 'preservationReceipt',
    'noRemainingValueReceipt', 'eligibility', 'authorizationDigest'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !keys.includes(key))
    || requiredKeys.some((key) => !Object.hasOwn(input, key)))
    typeFail('worktree cleanup execution input fields are invalid');
  const eligibility = validateWorktreeCleanupEligibility(input.eligibility);
  if (input.authorizationDigest !== eligibility.eligibilityDigest)
    fail('blocked-cleanup-authorization', 'exact cleanup authorization is required');
  assertLaneBytesResolved(input.plan.expectedBranch ?? input.plan.branch, options.cwd); const joined = await liveEvidenceJoin(input, options);
  if (eligibility.cleanupPlanDigest !== joined.plan.planDigest
    || eligibility.cleanupPlanByteDigest !== worktreeCleanupPlanByteDigest(joined.plan)
    || eligibility.integrationReceiptDigest !== joined.integration.receiptDigest
    || eligibility.integrationPlanByteDigest !== joined.integrationPlanByteDigest
    || eligibility.retirementReceiptDigest !== joined.retirement.receiptDigest
    || eligibility.preservationReceiptDigest !== joined.preservation.receiptDigest
    || eligibility.noRemainingValueReceiptDigest !== joined.noValue.receiptDigest
    || eligibility.retirementPlanByteDigest !== joined.retirementPlanByteDigest
    || eligibility.recoveryInventoryDigest !== joined.plan.recoveryInventoryDigest
    || eligibility.recoveryInventoryContentEntries !== joined.plan.recoveryInventoryContentEntries
    || eligibility.ownerStateDigest !== joined.ownerStateDigest
    || eligibility.profileDigest !== joined.plan.profileDigest
    || eligibility.canonicalRevision !== joined.plan.expectedCanonicalRevision
    || eligibility.expiresAt !== joined.expiresAt)
    fail('blocked-cleanup-eligibility-mismatch', 'cleanup eligibility does not join exact evidence');
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', options.cwd);
  if (lock === null) fail('blocked-cleanup-lock', 'another clone cleanup operation is active');
  let result = null, error = null, artifacts = null;
  try {
    assertLaneBytesResolved(joined.plan.expectedBranch ?? joined.plan.branch, options.cwd); let applied = classifyExistingWorktreeQuarantine(joined.plan, eligibility,
      { cwd: options.cwd });
    if (applied === null) {
      const before = observeWorktreeCleanupTarget(joined.plan, { cwd: options.cwd, forceFreshRecoveryInventory: true });
      if (before.observationDigest !== eligibility.targetObservationDigest)
        fail('blocked-cleanup-observation-drift', 'cleanup target changed after eligibility');
      applied = quarantineWorktreeTarget(joined.plan, before, { cwd: options.cwd, eligibility,
        authorizeEffects() {
          const executed = trustedClock(options, 'cleanup execution');
          if (executed < Date.parse(eligibility.evaluatedAt)
            || executed >= Date.parse(eligibility.expiresAt))
            fail('blocked-cleanup-expired', 'cleanup eligibility is not current');
          return new Date(executed).toISOString();
        } });
    }
    artifacts = applied.artifacts;
    result = createWorktreeCleanupReceipt({ ...cleanupResult(applied, eligibility),
      cleanupPlanDigest: joined.plan.planDigest,
      eligibilityDigest: eligibility.eligibilityDigest,
      integrationPlanByteDigest: joined.integrationPlanByteDigest });
  } catch (caught) { error = caught; artifacts = caught.operationArtifacts ?? artifacts; }
  return finishOperationLock(lock, { label: 'worktree-cleanup', result, error, artifacts });
}

export function releaseCommonLocalCleanupPolicy(root, profile) {
  if (repoRoot(root) !== root || currentBranch(root) !== 'main')
    fail('blocked-release-common-local-cleanup-canonical', 'local cleanup runs from canonical main');
  const remoteUrl = remoteTransport('origin', root).fetchUrl;
  const remote = remoteUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u)?.[1] ?? null;
  const selected = profile.repository.match(/^github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u)?.[1] ?? null;
  if (!remote || remote !== selected) fail('blocked-release-common-local-cleanup-remote', 'canonical origin does not match the selected GitHub repository');
  const canonical = observeGit(['rev-parse', '--verify', 'refs/heads/main^{commit}'], { cwd: root, maxBuffer: 65536 });
  if (observeGit(['rev-parse', '--verify', 'HEAD'], { cwd: root, maxBuffer: 65536 }) !== canonical
    || observeGit(['rev-parse', '--verify', 'refs/remotes/origin/main'], { cwd: root, maxBuffer: 65536 }) !== canonical
    || observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: root, maxBuffer: 65536 }) !== '')
    fail('blocked-release-common-local-cleanup-canonical', 'canonical main must be current and clean before local cleanup');
  return { root, repository: remote, remoteUrl, canonical, localRef: 'refs/heads/main',
    mode: RECOVERY_MODE, enrollment: 'release-common-complete', ...recoveryPolicy(root, remote),
    selectedEffects: ['quarantine-projection', 'quarantine-registration'] };
}

/** Cleanup constraints apply to the destructive effect, never to merge observation or integration. */
export function cleanupWorkflowContext(root, ref, repository) {
  const registration = worktrees(root).find(row => row.branch === ref), record = get(ref, root), parsed = parseLaneRef(ref);
  const retainedPath = record?.ref === ref && typeof record.worktree === 'string' ? record.worktree : null,
    worktreeId = registration ? basename(registration.path) : retainedPath ? basename(retainedPath) : parsed ? `${parsed.device}--${parsed.scope}` : null;
  return { root, repository, phase: 'cleanup', ref, worktreeId, revision: registration ? observeGit(['rev-parse', 'HEAD'], { cwd: registration.path }) : record?.head,
    dirty: registration ? Boolean(observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: registration.path })) : false };
}

const containsPath = (parent, candidate) => {
  const observed = relative(parent, candidate);
  return observed === '' || (!observed.startsWith('..') && !isAbsolute(observed));
};

/** Remove only an exact empty worktree-parent directory; retain every file and nested checkout. */
export function removeInactiveProgressiveCompletionTarget({ root, directory, inventory = worktrees,
  stat = path => lstatSync(path, { throwIfNoEntry: false }), removeEmptyDirectory = rmdirSync } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory)
    fail('blocked-progressive-completion-cleanup-path', 'cleanup requires one normalized absolute directory path');
  const canonicalRoot = realpathSync(root);
  if (repoRoot(root) !== canonicalRoot)
    fail('blocked-progressive-completion-cleanup-root', 'cleanup requires the exact canonical repository root');
  const observedTarget = stat(directory);
  if (!observedTarget) return Object.freeze({ status: 'absent', path: directory, mode: 'empty-directory' });
  if (!observedTarget.isDirectory() || observedTarget.isSymbolicLink())
    fail('blocked-progressive-completion-cleanup-target', 'cleanup requires one direct, non-symbolic directory');
  const targetPath = realpathSync(directory), target = stat(targetPath);
  if (!target || !target.isDirectory() || target.isSymbolicLink()
    || observedTarget.dev !== target.dev || observedTarget.ino !== target.ino)
    fail('blocked-progressive-completion-cleanup-target', 'cleanup requires one direct, non-symbolic directory');
  directory = targetPath;
  if (containsPath(directory, canonicalRoot) || containsPath(canonicalRoot, directory))
    fail('blocked-progressive-completion-cleanup-scope', 'cleanup refuses the canonical repository and every ancestor or descendant');
  const descendants = inventory(root).filter(row => row.path !== canonicalRoot && containsPath(directory, row.path));
  if (descendants.length > 0)
    fail('blocked-progressive-completion-cleanup-registered', 'cleanup requires zero registered worktrees at or below the exact directory');
  const current = stat(directory);
  if (!current || !current.isDirectory() || current.isSymbolicLink()
    || target.dev !== current.dev || target.ino !== current.ino)
    fail('blocked-progressive-completion-cleanup-race', 'cleanup target changed during observation');
  try { removeEmptyDirectory(directory); }
  catch (error) {
    if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST')
      return Object.freeze({ status: 'deferred', path: directory, mode: 'empty-directory', reason: 'directory-not-empty' });
    throw error;
  }
  if (stat(directory)) fail('blocked-progressive-completion-cleanup-postcondition', 'cleanup target remained after removal');
  return Object.freeze({ status: 'removed', path: directory, mode: 'empty-directory' });
}

const SOURCE_SUPERSESSION_SCHEMA = 'agentic-os/cross-repository-supersession-receipt/v1';
const sha256 = value => createHash('sha256').update(value).digest('hex');
function changedPaths(root, base, head) {
  const output = observeGit(['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`],
    { cwd: root, allowFail: true, raw: true, encoding: 'utf8', maxBuffer: 131072 });
  return output === null ? null : output.split('\0').filter(Boolean).sort();
}
function writeSupersessionReceipt(root, ref, payload) {
  const common = commonDir(root), directory = join(common, 'agentic-os-supersessions');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dirStat = lstatSync(directory, { bigint: true });
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o077n) !== 0n)
    fail('blocked-release-common-superseded-receipt-path', 'receipt directory must be private, direct, and within the common Git directory');
  const path = join(directory, `${sha256(ref)}.json`), temporary = `${path}.${process.pid}.${payload.issuedAt}.tmp`;
  const receipt = { ...payload, receiptDigest: governanceDigest(payload) }, bytes = Buffer.from(canonicalJson(receipt));
  let descriptor = null, linked = false;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, bytes); fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    linkSync(temporary, path); linked = true; unlinkSync(temporary);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
    if (error?.code === 'EEXIST') fail('blocked-release-common-superseded-receipt-exists', 'an immutable supersession receipt already exists for this lane');
    throw error;
  }
  if (!linked) fail('blocked-release-common-superseded-receipt-write', 'supersession receipt was not linked into place');
  return receipt;
}

/** Record an exact local-consent supersession without claiming cross-repository integration or retirement. */
async function runReleaseCommonSupersededComplete({ root, argv, profile, out, err, now, api }) {
  try {
    const ref = option(argv, 'ref'), pr = Number(option(argv, 'via-pr'));
    const repository = option(argv, 'via-repository') ?? '';
    const checksText = option(argv, 'via-checks') ?? '';
    const reason = option(argv, 'reason') ?? '';
    const replacedPaths = (option(argv, 'replaced') ?? '').split(',').filter(Boolean);
    const requiredChecks = checksText.split(',').filter(Boolean).sort();
    if (!argv.includes('--superseded') || !argv.includes('--stopped') || !isLaneRef(ref)
      || !Number.isSafeInteger(pr) || pr < 1
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
      || repository === profile.repository.replace(/^github\.com\//u, '')
      || requiredChecks.length < 1 || requiredChecks.length > 8
      || requiredChecks.some((name, index) => !name.trim() || Buffer.byteLength(name) > 128
        || /[\x00-\x1f\x7f]/u.test(name) || index > 0 && name === requiredChecks[index - 1])
      || replacedPaths.length < 1 || replacedPaths.length > 128
      || replacedPaths.some(path => path.startsWith('/') || path.includes('\\')
        || path.split('/').some(part => !part || part === '.' || part === '..'))
      || !/^[^\x00-\x1f\x7f]{12,512}$/u.test(reason.trim()) || Buffer.byteLength(reason.trim()) > 512)
      fail('blocked-release-common-superseded-options',
        'Use --ref=<lane> --via-pr=<merged-pr> --via-repository=<owner/repo> --via-checks=<exact-check[,check...]> --replaced=<exact,path> --reason=<local-consent-reason> --superseded --stopped');
    const current = releaseCommonLocalCleanupPolicy(root, profile);
    if (observeGit(['ls-remote', '--refs', '--', current.remoteUrl, 'refs/heads/main'], { cwd: root })
      !== `${current.canonical}\trefs/heads/main`)
      fail('blocked-release-common-superseded-canonical', 'live origin/main must equal clean local and tracking main');
    const record = get(ref, root), status = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile);
    assertLaneBytesResolved(ref, root);
    if (!record || record.state !== 'active' || record.pr !== null || record.head !== status.lane.head
      || status.lane.mounted !== true || status.lane.clean !== true || status.lane.path !== record.worktree
      || !/^[a-f0-9]{40}$/u.test(record.baseSha ?? ''))
      fail('blocked-release-common-superseded-lane', 'one exact mounted, clean active lane with no PR and an unchanged base is required');
    const sourcePaths = changedPaths(root, record.baseSha, record.head);
    if (!sourcePaths || sourcePaths.length < 1 || sourcePaths.length > 128
      || JSON.stringify(sourcePaths) !== JSON.stringify([...new Set(replacedPaths)].sort()))
      fail('blocked-release-common-superseded-paths', 'the explicit replacement paths must equal every path changed by this lane');

    const archiveRepository = current.repository;
    const archive = api(`repos/${archiveRepository}`, { cwd: root });
    if (archive?.full_name !== archiveRepository || archive.private !== true || archive.archived !== true)
      fail('blocked-release-common-superseded-archive', 'the source repository must remain the exact private, archived repository');
    const successorRepo = api(`repos/${repository}`, { cwd: root });
    if (successorRepo?.full_name !== repository || successorRepo.private !== false || successorRepo.archived === true)
      fail('blocked-release-common-superseded-successor', 'the successor must be the exact public, active repository');
    const workflow = inferMergedReviewWorkflow({ repository, pr, requiredChecks }, { cwd: root, api });
    const review = observeMergedReview({ repository, pr, requiredChecks, workflow, mode: RECOVERY_MODE }, { cwd: root, api });
    if (review.branch !== ref || review.checks.length !== requiredChecks.length
      || JSON.stringify(review.checks.map(check => check.name).sort()) !== JSON.stringify(requiredChecks))
      fail('blocked-release-common-superseded-review', 'the selected public PR, source ref, workflow, and successful checks must match exactly');
    const files1 = api(`repos/${repository}/pulls/${pr}/files?per_page=100&page=1`, { cwd: root });
    const files2 = api(`repos/${repository}/pulls/${pr}/files?per_page=100&page=2`, { cwd: root });
    if (!Array.isArray(files1) || !Array.isArray(files2) || files2.length !== 0 || files1.length < 1
      || files1.length > 100 || files1.some(file => file.status !== 'modified' || typeof file.filename !== 'string'))
      fail('blocked-release-common-superseded-files', 'the successor PR must have a bounded, complete list of modified files');
    const successorPaths = files1.map(file => file.filename).sort();
    if (new Set(successorPaths).size !== successorPaths.length
      || JSON.stringify(successorPaths) !== JSON.stringify(sourcePaths))
      fail('blocked-release-common-superseded-content-scope', 'the reviewed successor must change exactly the old lane path set');
    const main = api(`repos/${repository}/branches/main`, { cwd: root });
    const mainHead = main?.commit?.sha;
    if (!/^[a-f0-9]{40}$/u.test(mainHead ?? ''))
      fail('blocked-release-common-superseded-main', 'the successor main revision is unavailable');
    const comparison = api(`repos/${repository}/compare/${review.merge}...main`, { cwd: root });
    if (!['ahead', 'identical'].includes(comparison?.status)
      || comparison.base_commit?.sha !== review.merge
      || comparison.merge_base_commit?.sha !== review.merge
      || comparison.status === 'ahead' && comparison.head_commit?.sha !== mainHead)
      fail('blocked-release-common-superseded-main', 'the successor merge must remain an ancestor of its current main');

    const finalArchive = api(`repos/${archiveRepository}`, { cwd: root });
    const finalReview = observeMergedReview({ repository, pr, requiredChecks, workflow, mode: RECOVERY_MODE }, { cwd: root, api });
    const finalMain = api(`repos/${repository}/branches/main`, { cwd: root });
    const finalComparison = api(`repos/${repository}/compare/${review.merge}...main`, { cwd: root });
    if (finalArchive?.full_name !== archiveRepository || finalArchive.private !== true || finalArchive.archived !== true
      || !same(finalReview, review) || finalMain?.commit?.sha !== mainHead
      || !['ahead', 'identical'].includes(finalComparison?.status)
      || finalComparison.base_commit?.sha !== review.merge || finalComparison.merge_base_commit?.sha !== review.merge
      || finalComparison.status === 'ahead' && finalComparison.head_commit?.sha !== mainHead)
      fail('blocked-release-common-superseded-provider-drift', 'archive, merged PR/checks, or successor main changed during observation');
    const finalCurrent = releaseCommonLocalCleanupPolicy(root, profile);
    const finalStatus = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile);
    if (finalCurrent.canonical !== current.canonical || finalStatus.lane.path !== record.worktree
      || finalStatus.lane.head !== record.head || finalStatus.lane.mounted !== true || finalStatus.lane.clean !== true
      || !same(changedPaths(root, record.baseSha, record.head), sourcePaths)
      || observeGit(['ls-remote', '--refs', '--', finalCurrent.remoteUrl, 'refs/heads/main'], { cwd: root })
        !== `${finalCurrent.canonical}\trefs/heads/main`)
      fail('blocked-release-common-superseded-source-drift', 'canonical source or exact old lane changed during observation');

    const payload = { schema: SOURCE_SUPERSESSION_SCHEMA, repository: profile.repository,
      profileDigest: profile.profileDigest, ref, sourceBase: record.baseSha, head: record.head,
      worktree: record.worktree, changedPaths: sourcePaths, replacedPaths: sourcePaths,
      disposition: 'superseded', sourceIntegrated: false, sourceSuperseded: true,
      providerAuthority: false, claimRetired: false, archivePrivate: true, archiveArchived: true,
      reason: reason.trim(), issuedAt: new Date(now()).toISOString(),
      successor: { repository, pr, branch: review.branch, head: review.head, merge: review.merge,
        mergedAt: review.mergedAt, mainHead, workflow, changedPaths: successorPaths,
        checks: review.checks.map(({ name, checkId, runId, attempt, workflow: checkWorkflow, conclusion, url }) =>
          ({ name, checkId, runId, attempt, workflow: checkWorkflow, conclusion, url })) } };
    const existing = status.supersession;
    if (existing) {
      if (!same(existing.successor, payload.successor) || existing.reason !== payload.reason
        || existing.profileDigest !== payload.profileDigest)
        fail('blocked-release-common-superseded-existing', 'an existing supersession receipt binds a different disposition');
      out(JSON.stringify(status)); return 0;
    }
    const receipt = writeSupersessionReceipt(root, ref, payload);
    out(JSON.stringify(receipt));
    const settled = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile);
    out(JSON.stringify(settled));
    if (settled.closeout.missionState !== 'source_complete' || settled.closeout.adlcState !== 'complete'
      || settled.closeout.sourceIntegrated !== false || settled.sourceSuperseded !== true
      || settled.lane.mounted !== true || settled.lane.clean !== true)
      fail('blocked-release-common-superseded-postcondition', 'supersession did not reach a clean retained source-complete state');
    return 0;
  } catch (error) {
    err(`${error.reason ?? 'blocked-release-common-superseded-complete'}: ${error.message}`);
    return 1;
  }
}

/** Explicit superseded-lane closeout; the accepted PR owns review/check evidence, and a failed or closed predecessor PR is never represented as merged. */
export async function runReleaseCommonSuccessorComplete({
  root, argv, profile,
  out = line => process.stdout.write(`${line}\n`),
  err = line => process.stderr.write(`${line}\n`),
  now = Date.now, api = githubRead,
} = {}) {
  try {
    if (argv.includes('--superseded'))
      return await runReleaseCommonSupersededComplete({ root, argv, profile, out, err, now, api });
    const ref = option(argv, 'ref'), pr = Number(option(argv, 'via-pr'));
    const replacedPaths = (option(argv, 'replaced') ?? '').split(',').filter(Boolean);
    if (!isLaneRef(ref) || !Number.isSafeInteger(pr) || pr < 1 || !argv.includes('--stopped')
      || replacedPaths.length > 128)
      fail('blocked-release-common-successor-options',
        'Use --ref=<lane> --via-pr=<merged-pr> --replaced=<exact,path> --stopped');
    const current = releaseCommonLocalCleanupPolicy(root, profile);
    const record = get(ref, root);
    const status = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile); assertLaneBytesResolved(ref, root);
    if (!record || !(['published', 'queued', 'integrated'].includes(record.state)
      || record.state === 'active' && record.pr === null) || record.head !== status.lane.head || status.lane.clean === false)
      fail('blocked-release-common-successor-lane', 'one exact clean predecessor with no unresolved PR is required');
    // Cleanup remains bound to the predecessor lane; successor review is checked separately.
    const assertWorkflowCurrent = createWorkflowEffectGuard(
      () => cleanupWorkflowContext(root, ref, profile.repository));
    const workflow = inferMergedReviewWorkflow({ repository: current.repository, pr,
      requiredChecks: [...current.requiredChecks].sort() }, { cwd: root, api });
    if (!status.lane.mounted) {
      const review = observeMergedReview({ ...current, pr, workflow,
        requiredChecks: [...current.requiredChecks].sort() }, { cwd: root, api });
      const successor = { predecessorHead: record.head, replacedPaths,
        reviewedHead: review.head, merge: review.merge };
      const settled = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile, { successor });
      if (!settled.cleanupVerified || settled.closeout.missionState !== 'source_complete'
        || observeGit(['ls-remote', '--refs', '--', current.remoteUrl, 'refs/heads/main'], { cwd: root })
          !== `${current.canonical}\trefs/heads/main`)
        fail('blocked-release-common-successor-replay', 'retained closeout or live canonical state drifted');
      out(JSON.stringify(settled)); return 0;
    }
    const resolvePolicy = (policyRoot, mode) => {
      if (policyRoot !== root || mode !== RECOVERY_MODE)
        fail('blocked-release-common-successor-policy', 'successor recovery policy drifted');
      return current;
    };
    const request = { cwd: root, target: status.lane.path, pr,
      requiredChecks: [...current.requiredChecks].sort(), workflow, recovery: true,
      successor: { predecessorRef: ref, predecessorHead: record.head, replacedPaths } };
    const options = { now, api, resolvePolicy };
    const plan = planUserCleanup(request, options);
    out(JSON.stringify(plan));
    const successor = { ...plan.successor, reviewedHead: plan.head, merge: plan.merge };
    if (plan.integration.kind !== 'reviewed-successor')
      fail('blocked-release-common-successor-integration', 'reviewed successor must remain exact');
    assertWorkflowCurrent();
    const receipt = applyUserCleanup(plan, { cwd: root,
      authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true, ...options });
    out(JSON.stringify(receipt));
    const settled = inspectCompletionStatus(root, ref, { protectedBranch: 'main' }, profile, { successor });
    out(JSON.stringify(settled));
    if (settled.closeout.missionState !== 'source_complete' || settled.lane.mounted
      || settled.integration?.kind !== 'reviewed-successor')
      fail('blocked-release-common-successor-postcondition', 'successor closeout did not reach exact terminal state');
    return 0;
  } catch (error) {
    err(`${error.reason ?? 'blocked-release-common-successor-complete'}: ${error.message}`);
    return 1;
  }
}
export { planSuccessorPreservation, applySuccessorPreservation, verifySuccessorPreservation } from '../bin/agentic-os-cleanup-user.mjs';
