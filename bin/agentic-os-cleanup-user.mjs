/** Explicit local-consent cleanup; profile recovery requires its own operator opt-in. */
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { observeGit, repoRoot, remoteTransport, acquireOperationLock, finishOperationLock, observeGitLines, worktrees, commonDir } from '../src/git.mjs';
import { loadRepositoryTrust } from '../src/git-repository.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { observeWorktreeCleanupTarget, classifyExistingWorktreeQuarantine, quarantineWorktreeTarget, observeRetainedQuarantineEvidence } from '../src/cleanup-quarantine.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { privateDirectoryIdentity, assertPrivateDirectoryIdentity, writePrivateFileExclusive,
  readPrivateFile } from '../src/file-integrity.mjs';
import { observeMergedReview, reviewOptions, refuse } from './agentic-os-cleanup-review.mjs';
import { option } from './agentic-os-argv.mjs';
import { RECOVERY_MODE, RECOVERY_LIMITS, recoveryPolicy, recoveryIntegration } from './agentic-os-cleanup-recovery.mjs';
import { classifyLaneChangeClass, SUPPORTED_CHANGE_CLASSES, successorIntegrationProof, integrationProof } from '../src/patch-identity.mjs';
import { get } from '../src/lane-records.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { validateGitHubTransitionPolicy, selectPreservationAdoption } from '../src/github-transition-policy.mjs';
import { SUCCESSOR_PRESERVATION_SCHEMA, SUCCESSOR_PRESERVATION_PLAN_SCHEMA,
  CURRENT_QUARANTINE_SCHEMA, CURRENT_QUARANTINE_PLAN_SCHEMA,
  validateRetentionDispositionPlan, validateRetentionDispositionReceipt } from '../src/cleanup-records.mjs';
const SCHEMA = 'agentic-os/user-cleanup-plan/v1', MODE = 'explicit-local-user-consent';
const NO_CI_MODE = 'explicit-local-user-consent-no-ci';
const KEY = 'agentic-os.userCleanup';
const LIMITS = Object.freeze({ projectionByteCeiling: 16 * 1024 * 1024, projectionEntryCeiling: 10000,
  registrationByteCeiling: 16 * 1024 * 1024, registrationEntryCeiling: 10000,
  sharedStateByteCeiling: 256 * 1024 * 1024, sharedStateEntryCeiling: 100000 });
const read = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 65536, ...options });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
export const readUserCleanupJson = (path, label, parent = null) => JSON.parse(new TextDecoder('utf-8', { fatal: true })
  .decode(parent ? readPrivateFile(path, 64000, label, parent) : readBoundedStableFile(path, 64000, label)));
/** Classify the enrolled local-consent documentation path without changing physical mechanics. */
function resolveChangeClass(declared, observed) {
  if (declared === undefined) return { declared: null, observed, fastPath: false };
  if (!SUPPORTED_CHANGE_CLASSES.includes(declared)) refuse('unsupported-change-class');
  const fastPath = declared === 'docs-only';
  if (fastPath && observed !== declared)
    refuse('change-class-mismatch', `declared --change-class=docs-only but observed ${observed}`);
  return { declared, observed, fastPath };
}
const fields = (value, names) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== names.split(',').sort().join(',')) refuse('shape');
};
function policy(root, mode = MODE, { changeClass = undefined } = {}) {
  if (realpathSync(repoRoot(root)) !== root || read(root, ['symbolic-ref', '--quiet', 'HEAD']) !== 'refs/heads/main')
    refuse('canonical-controller');
  const enrollment = mode === RECOVERY_MODE ? 'quarantine-recovery' : mode === NO_CI_MODE ? 'quarantine-no-ci' : 'quarantine';
  if (![MODE, NO_CI_MODE, RECOVERY_MODE].includes(mode)
    || read(root, ['config', '--local', '--get-all', KEY], { allowFail: true }) !== enrollment)
    refuse('local-enrollment-required');
  // For docs-only change class, the profile-governed repository check is
  // relaxed: local consent is the accepted terminal state and the protected
  // authority chain is not required for this change class.
  if (mode !== RECOVERY_MODE && changeClass !== 'docs-only'
    && (lstatSync(join(root, '.agentic-os.json'), { throwIfNoEntry: false })
    || read(root, ['ls-tree', 'refs/heads/main', '--', '.agentic-os.json'])
    || loadRepositoryTrust(root, { required: false }))) refuse('profile-governed-repository');
  const remoteUrl = remoteTransport('origin', root).fetchUrl;
  const match = remoteUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (!match || match[1].split('/').some(s => s === '.' || s === '..')) refuse('remote-identity');
  const canonical = read(root, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  if (read(root, ['rev-parse', '--verify', 'HEAD']) !== canonical
    || read(root, ['rev-parse', '--verify', 'refs/remotes/origin/main']) !== canonical
    || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('canonical-not-clean');
  return { root, repository: match[1], remoteUrl, canonical, localRef: 'refs/heads/main',
    mode, enrollment: mode === MODE ? KEY : `${KEY}=${enrollment}`,
    ...(mode === RECOVERY_MODE ? recoveryPolicy(root, match[1]) : {}),
    selectedEffects: ['quarantine-projection', 'quarantine-registration'] };
}
function resolvePolicy(root, mode, resolver = null, options = {}) {
  return typeof resolver === 'function' ? resolver(root, mode, options) : policy(root, mode, options);
}
function observePolicy(mechanics, root, resolver = null) {
  const current = resolvePolicy(root, mechanics.mode, resolver);
  if (governanceDigest(current) !== mechanics.profileDigest || current.canonical !== mechanics.expectedCanonicalRevision
    || `github.com/${current.repository}` !== mechanics.repository) refuse('local-policy-drift');
  return { root, canonicalRevision: current.canonical,
    profile: { profileDigest: governanceDigest(current), canonical: { localRef: current.localRef } } };
}
function mechanics(plan) {
  return { ...(plan.mode === RECOVERY_MODE ? RECOVERY_LIMITS : LIMITS), mode: plan.mode, repository: `github.com/${plan.repository}`, targetPath: plan.targetPath,
    expectedBranch: plan.detachedHead ? null : plan.successor?.predecessorRef ?? plan.mergedProjection?.branch ?? plan.branch,
    expectedHeadRevision: plan.detachedHead ?? plan.successor?.predecessorHead ?? plan.mergedProjection?.head ?? plan.head,
    detachedRecovery: Boolean(plan.detachedHead),
    expectedCanonicalRef: 'refs/heads/main',
    expectedCanonicalRevision: plan.canonical, profileDigest: plan.policyDigest,
    recoveryInventoryDigest: plan.inventoryDigest, recoveryInventoryContentEntries: plan.inventoryContentEntries,
    planDigest: plan.planDigest };
}
function eligibility(plan) {
  const o = plan.observation;
  return { schema: 'agentic-os/user-cleanup-eligibility/v1', planDigest: plan.planDigest,
    profileDigest: plan.policyDigest, canonicalRevision: plan.canonical,
    projectionManifestDigest: o.projectionManifest.digest, projectionBytes: o.projectionManifest.bytes,
    projectionEntries: o.projectionManifest.entries, registrationManifestDigest: o.registrationManifest.digest,
    registrationBytes: o.registrationManifest.bytes, registrationEntries: o.registrationManifest.entries,
    peerRegistrationDigest: o.peerRegistrationDigest, sharedRefDigest: o.sharedRefDigest,
    objectInventoryDigest: o.objectInventoryDigest, sharedStateBytes: o.sharedStateBytes,
    sharedStateEntries: o.sharedStateEntries, evaluatedAt: new Date(plan.issuedAt).toISOString(),
    expiresAt: new Date(plan.expiresAt).toISOString() };
}
function mergedState(plan, options, observed = observeMergedReview(plan, { cwd: plan.root, ...options })) {
  if (!same(observed, plan.review)) refuse('review-drift');
  if (plan.mode === RECOVERY_MODE) {
    if (!same(recoveryIntegration(plan, read), plan.integration)) refuse('integration-drift');
  } else if (plan.changeClass?.fastPath !== true
    && read(plan.root, ['rev-parse', '--verify', `${plan.head}^{tree}`])
    !== read(plan.root, ['rev-parse', '--verify', `${plan.merge}^{tree}`])) refuse('merge-tree-drift');
  if (read(plan.root, ['merge-base', '--is-ancestor', plan.merge, plan.canonical], { allowFail: true }) === null)
    refuse('merge-not-canonical');
  const advertisement = options.observeRemote ? options.observeRemote(plan)
    : read(plan.root, ['ls-remote', '--refs', '--', plan.remoteUrl, 'refs/heads/main']);
  if (advertisement !== `${plan.canonical}\trefs/heads/main`) refuse('remote-main-drift');
}
function validatePlan(input) {
  const bytes = canonicalJson(input); if (Buffer.byteLength(bytes) > 64000) refuse('plan-size');
  const plan = JSON.parse(bytes);
  fields(plan, 'schema,mode,root,repository,remoteUrl,pr,requiredChecks,workflow,targetPath,branch,head,canonical,merge,review,inventoryDigest,inventoryContentEntries,policyDigest,observation,issuedAt,expiresAt,planDigest'
    + (plan.mode === RECOVERY_MODE ? ',integration,recoveryPolicy' : '')
    + (Object.hasOwn(plan, 'detachedHead') ? ',detachedHead' : '')
    + (Object.hasOwn(plan, 'reviewedEquivalentCommit') ? ',reviewedEquivalentCommit' : '')
    + (Object.hasOwn(plan, 'successor') ? ',successor' : '')
    + (Object.hasOwn(plan, 'mergedProjection') ? ',mergedProjection' : '')
    + (Object.hasOwn(plan, 'historicalCheckGap') ? ',historicalCheckGap' : '')
    + (Object.hasOwn(plan, 'changeClass') ? ',changeClass' : ''));
  reviewOptions(plan);
  const { planDigest, ...content } = plan;
  if (plan.schema !== SCHEMA || ![MODE, NO_CI_MODE, RECOVERY_MODE].includes(plan.mode) || governanceDigest(content) !== planDigest
    || typeof plan.root !== 'string' || typeof plan.targetPath !== 'string' || plan.targetPath === plan.root
    || !['head', 'canonical', 'merge'].every(k => /^[a-f0-9]{40}$/u.test(plan[k]))
    || !['policyDigest', 'inventoryDigest', 'planDigest'].every(k => /^[a-f0-9]{64}$/u.test(plan[k]))
    || !Number.isSafeInteger(plan.issuedAt) || !Number.isSafeInteger(plan.expiresAt)
    || plan.issuedAt < 0 || plan.expiresAt <= plan.issuedAt || plan.expiresAt - plan.issuedAt > 900000
    || (Object.hasOwn(plan, 'detachedHead') && (plan.mode !== RECOVERY_MODE
      || typeof plan.detachedHead !== 'string' || !/^[a-f0-9]{40}$/u.test(plan.detachedHead)))
    || (Object.hasOwn(plan, 'reviewedEquivalentCommit') && (plan.mode !== RECOVERY_MODE || !plan.detachedHead
      || !/^[a-f0-9]{40}$/u.test(plan.reviewedEquivalentCommit)))
    || (Object.hasOwn(plan, 'successor') && (plan.mode !== RECOVERY_MODE || plan.detachedHead
      || !plan.successor || Object.keys(plan.successor).sort().join(',') !== 'predecessorHead,predecessorRef,replacedPaths'
      || typeof plan.successor.predecessorRef !== 'string'
      || !/^[a-f0-9]{40}$/u.test(plan.successor.predecessorHead)
      || !Array.isArray(plan.successor.replacedPaths)))
    || (Object.hasOwn(plan, 'mergedProjection') && (plan.mode !== RECOVERY_MODE || plan.detachedHead || plan.successor || !plan.mergedProjection || Object.keys(plan.mergedProjection).sort().join(',') !== 'branch,head' || !isLaneRef(plan.mergedProjection.branch) || plan.mergedProjection.branch === plan.branch || plan.mergedProjection.head !== plan.merge))
    || (Object.hasOwn(plan, 'historicalCheckGap') && (!plan.historicalCheckGap || !plan.mergedProjection || !plan.review?.historicalCheckGap || plan.review.historicalCheckGap.checkRunsObserved !== 0 || !same(plan.review.historicalCheckGap.requiredChecks, plan.requiredChecks)))
    || plan.head !== plan.review?.head || plan.merge !== plan.review?.merge || plan.branch !== plan.review?.branch)
    refuse('plan-binding');
  return plan;
}
function locked(root, operation) {
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', root); if (!lock) refuse('busy');
  let result, error;
  try { result = operation(); } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'user-cleanup', result, error, artifacts: error?.operationArtifacts ?? null });
}
export function planUserCleanup({ cwd = process.cwd(), target, pr, requiredChecks, workflow,
  noCI = false, recovery = false, detached = false, mergedProjection = false, historicalCheckGap = false, changeClass = undefined, successor = undefined,
  reviewedEquivalentCommit = undefined }, options = {}) {
  const policyResolver = options.resolvePolicy ?? null;
  if (noCI && recovery) refuse('incompatible-modes');
  if (typeof detached !== 'boolean' || detached && !recovery) refuse('detached-recovery-required');
  if (typeof mergedProjection !== 'boolean' || mergedProjection && (!recovery || detached || successor)) refuse('merged-projection-options');
  if (typeof historicalCheckGap !== 'boolean' || historicalCheckGap && (!recovery || !mergedProjection)) refuse('historical-check-gap-options');
  if (reviewedEquivalentCommit !== undefined && (!recovery || !detached || successor || !/^[a-f0-9]{40}$/u.test(reviewedEquivalentCommit))) refuse('equivalent-options');
  if (recovery && changeClass !== undefined) refuse('incompatible-modes');
  if (successor && (!recovery || detached || typeof successor.predecessorRef !== 'string'
    || !/^[a-f0-9]{40}$/u.test(successor.predecessorHead ?? '')))
    refuse('successor-options');
  if (changeClass !== undefined && !SUPPORTED_CHANGE_CLASSES.includes(changeClass)) refuse('unsupported-change-class');
  const root = realpathSync(repoRoot(cwd));
  const mode = recovery ? RECOVERY_MODE : noCI ? NO_CI_MODE : MODE;
  reviewOptions({ repository: 'placeholder/repository', pr, requiredChecks, workflow, mode });
  return locked(root, () => {
    const current = resolvePolicy(root, mode, policyResolver, { changeClass }), targetPath = realpathSync(target);
    if (recovery && current.requiredChecks.some(name => !requiredChecks.includes(name))) refuse('profile-checks-missing');
    if (targetPath !== target || targetPath === root || lstatSync(target).isSymbolicLink()) refuse('target-path');
    const review = observeMergedReview({ ...current, pr, requiredChecks, workflow, historicalCheckGap }, { cwd: root, ...options });
    if (read(target, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
    const inventory = collectRecoveryInventory({ cwd: target, canonicalRef: 'refs/heads/main',
      allowDetached: detached, maxContentEntries: options.maxContentEntries ?? (recovery ? RECOVERY_LIMITS : LIMITS).projectionEntryCeiling });
    if (successor && (inventory.branch !== successor.predecessorRef
      || inventory.headRevision !== successor.predecessorHead)) refuse('successor-target-drift');
    if (detached && inventory.branch !== null) refuse('target-not-detached');
    if (mergedProjection && (!isLaneRef(inventory.branch) || inventory.branch === review.branch || inventory.headRevision !== review.merge)) refuse('merged-projection-target');
    if (inventory.inventoryEntries.hidden || inventory.inventoryEntries.visibleUntracked) refuse('hidden-or-untracked-work');
    const observedChangeClass = classifyLaneChangeClass(targetPath);
    const changeClassInfo = resolveChangeClass(changeClass, observedChangeClass);
    const issuedAt = options.now?.() ?? Date.now();
    const plan = { schema: SCHEMA, mode, root, repository: current.repository, remoteUrl: current.remoteUrl,
      pr, requiredChecks, workflow, targetPath, branch: review.branch, head: review.head, canonical: current.canonical,
      merge: review.merge, review, inventoryDigest: governanceDigest(inventory),
      inventoryContentEntries: inventory.inventoryEntries.content, policyDigest: governanceDigest(current),
      observation: null, issuedAt, expiresAt: issuedAt + 900000,
      ...(detached ? { detachedHead: inventory.headRevision } : {}),
      ...(reviewedEquivalentCommit ? { reviewedEquivalentCommit } : {}),
      ...(successor ? { successor: { predecessorRef: successor.predecessorRef,
        predecessorHead: successor.predecessorHead, replacedPaths: successor.replacedPaths } } : {}),
      ...(mergedProjection ? { mergedProjection: { branch: inventory.branch, head: inventory.headRevision } } : {}),
      ...(historicalCheckGap ? { historicalCheckGap: true } : {}),
      ...(changeClassInfo.declared ? { changeClass: changeClassInfo } : {}) };
    if (recovery) Object.assign(plan, { integration: recoveryIntegration(plan, read), recoveryPolicy: current });
    mergedState(plan, options, review);
    plan.observation = observeWorktreeCleanupTarget(mechanics(plan), { cwd: root,
      observePolicy: (configured, configuredRoot) => observePolicy(configured, configuredRoot, policyResolver) });
    plan.planDigest = governanceDigest(plan);
    return validatePlan(plan);
  });
}
export function applyUserCleanup(input, { cwd = process.cwd(), authorization, stopped, now = Date.now, ...options } = {}) {
  const plan = validatePlan(input), root = realpathSync(repoRoot(cwd));
  const policyResolver = options.resolvePolicy ?? null;
  if (root !== plan.root || authorization !== `agentic-os:user-cleanup:${plan.planDigest}` || stopped !== true)
    refuse('explicit-authorization-required');
  return locked(root, () => {
    const m = mechanics(plan), eligible = eligibility(plan);
    observePolicy(m, root, policyResolver); mergedState(plan, options);
    if (plan.mode === RECOVERY_MODE && (!same(resolvePolicy(root, plan.mode, policyResolver), plan.recoveryPolicy)
      || plan.recoveryPolicy.requiredChecks.some(name => !plan.requiredChecks.includes(name)))) refuse('recovery-policy-drift');
    const configuredObservePolicy = (configured, configuredRoot) =>
      observePolicy(configured, configuredRoot, policyResolver);
    let applied = classifyExistingWorktreeQuarantine(m, eligible, {
      cwd: root, observePolicy: configuredObservePolicy,
    });
    if (!applied) {
      if (now() < plan.issuedAt || now() >= plan.expiresAt) refuse('expired');
      if (read(plan.targetPath, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
      const before = observeWorktreeCleanupTarget(m, {
        cwd: root, observePolicy: configuredObservePolicy,
      });
      if (!same(before, plan.observation)) refuse('observation-drift');
      try {
        applied = quarantineWorktreeTarget(m, before, {
          cwd: root, eligibility: eligible, observePolicy: configuredObservePolicy,
          authorizeEffects() {
            const time = now(); if (time < plan.issuedAt || time >= plan.expiresAt) refuse('expired');
            observePolicy(m, root, policyResolver); return new Date(time).toISOString();
          } });
      } catch (error) {
        Object.assign(error, { retainedOperation: true, operationResult: null,
          operationError: { reason: error.reason ?? null, message: error.message },
          operationArtifacts: { ...error.operationArtifacts, effectsRetained: true, planDigest: plan.planDigest,
            targetPath: plan.targetPath, mode: plan.mode } }); throw error;
      }
    }
    return { schema: 'agentic-os/user-cleanup-receipt/v1', mode: plan.mode, planDigest: plan.planDigest,
      authority: 'explicit-local-user-consent', providerAuthority: false, protectionProven: false, claimRetired: false,
      selectedChecksVerified: plan.mode !== NO_CI_MODE && !plan.historicalCheckGap, noCI: plan.mode === NO_CI_MODE,
      ...(plan.changeClass?.fastPath ? { changeClass: plan.changeClass, authorityTerminalState: 'local-consent' } : {}),
      ...(plan.mode === RECOVERY_MODE ? { recoveryPolicy: plan.recoveryPolicy, integration: plan.integration,
        historicalIntegrationMethodProven: false, ...(plan.reviewedEquivalentCommit ? { sourceIntegrated: false, historicalDraft: 'superseded' } : {}) } : {}),
      localPolicyDigest: plan.policyDigest, stoppedAcknowledged: true, canonicalRevision: plan.canonical,
      review: plan.review, ...(plan.detachedHead ? { detachedHead: plan.detachedHead } : {}),
      ...(plan.mergedProjection ? { mergedProjection: plan.mergedProjection } : {}),
      ...(plan.historicalCheckGap ? { historicalCheckGap: { ...plan.review.historicalCheckGap, requiredChecks: [...plan.review.historicalCheckGap.requiredChecks] } } : {}),
      ...(plan.successor ? { successor: plan.successor } : {}),
      ...applied.result, ...applied.artifacts, result: 'quarantined',
      bytesDeleted: false, branchesMutated: false, objectsMutated: false, operatingSystemExclusivityProven: false };
  });
}
/** Unified CLI dispatch; physical consent and quarantine semantics remain unchanged. */
const UNIFIED_MODE_FLAGS = Object.freeze({ 'local-consent': [], recovery: ['--recovery'], 'no-ci': [] });
export function runUnifiedCleanup(root, argv, out = console.log) {
  if (!['plan', 'apply', 'sweep'].includes(argv[0])) refuse('cleanup-arguments', 'usage: cleanup <plan|apply|sweep> [options]');
  return runUserCleanup(root, argv, out, { unified: true });
}
export function runUserCleanup(root, argv, out = console.log, { unified = false } = {}) {
  if (['preservation-plan', 'preservation-apply'].includes(argv[0])) {
    const planning = argv[0] === 'preservation-plan';
    const input = readUserCleanupJson(option(argv, planning ? 'adoption' : 'plan'), planning ? 'preservation-adoption' : 'preservation-plan');
    if (planning && input.adoption) fields(input, 'adoption,originalReceipt');
    const result = planning ? planSuccessorPreservation({ cwd: root, adoption: input.adoption ?? input,
      originalReceipt: input.originalReceipt, policyRoot: option(argv, 'policy-root'), workflow: option(argv, 'workflow') })
      : applySuccessorPreservation(input, { cwd: root, authorization: option(argv, 'authorize'), stopped: argv.includes('--stopped') });
    out(canonicalJson(result)); return 0;
  }
  if (argv[0] === 'sweep') return runUserCleanupSweep(root, argv, out);
  if (argv[0] === 'plan') {
    const modeFlag = unified ? option(argv, 'mode') || 'local-consent' : null;
    if (unified && !Object.hasOwn(UNIFIED_MODE_FLAGS, modeFlag)) refuse('cleanup-arguments', `unknown mode ${modeFlag}`);
    const noCI = modeFlag === 'no-ci', pr = Number(option(argv, 'pr'));
    const changeClass = option(argv, 'change-class') || undefined;
    const plan = planUserCleanup({ cwd: root, target: option(argv, 'target'), pr,
      requiredChecks: noCI ? [] : unified && !option(argv, 'checks') ? [] : option(argv, 'checks').split(','),
      workflow: noCI ? null : option(argv, 'workflow'), noCI,
      recovery: modeFlag === 'recovery' || (!unified && argv.includes('--recovery')), detached: argv.includes('--detached'),
      mergedProjection: argv.includes('--merged-projection'),
      historicalCheckGap: argv.includes('--historical-check-gap'),
      reviewedEquivalentCommit: option(argv, 'reviewed-equivalent-commit') || undefined,
      changeClass });
    out(canonicalJson(plan)); return 0;
  }
  const plan = readUserCleanupJson(option(argv, 'plan'), 'user-cleanup-plan');
  out(canonicalJson(applyUserCleanup(plan, { cwd: root, authorization: option(argv, 'authorize'), stopped: argv.includes('--stopped') })));
  return 0;
}
/** Bounded observation-only stale-ref candidates; no refs or bytes are removed. */
const SWEEP_SCHEMA = 'agentic-os/user-cleanup-sweep/v1';
const SWEEP_LIMIT = 256;
const sweepRefFormat = '%(refname:short)%09%(objectname)%09%(objecttype)%09%(committerdate:unix)';
/** Project one bounded ref snapshot; the caller revalidates each selected target before effects. */
export function projectUserCleanupSweep({ refs, mergedBranches, activeBranches, staleDays, now = Date.now() }) {
  if (!Array.isArray(refs) || !Array.isArray(mergedBranches) || !Array.isArray(activeBranches))
    refuse('sweep-inventory-shape');
  if (refs.length > SWEEP_LIMIT || mergedBranches.length > SWEEP_LIMIT) refuse('lane-inventory-over-budget');
  if (!Number.isSafeInteger(staleDays) || staleDays < 0) refuse('stale-days-invalid');
  if (!Number.isSafeInteger(now)) refuse('sweep-clock-invalid');
  const merged = new Set(mergedBranches), active = new Set(activeBranches), seen = new Set();
  if (merged.size !== mergedBranches.length || mergedBranches.some(branch => !isLaneRef(branch)))
    refuse('sweep-merged-inventory');
  const staleThreshold = staleDays > 0 ? now - staleDays * 86400000 : 0;
  const candidates = [];
  for (const row of refs) {
    if (typeof row !== 'string') refuse('sweep-ref-shape');
    const fields = row.split('\t');
    if (fields.length !== 4) refuse('sweep-ref-shape');
    const [branch, head, type, rawTime] = fields;
    if (!isLaneRef(branch) || seen.has(branch) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head)
      || type !== 'commit' || !/^-?\d+$/u.test(rawTime)) refuse('sweep-ref-shape');
    seen.add(branch);
    const commitMs = Number(rawTime) * 1000;
    if (!Number.isSafeInteger(commitMs) || !Number.isFinite(new Date(commitMs).getTime())) refuse('sweep-commit-time');
    const isMerged = merged.has(branch), mounted = active.has(branch);
    const stale = staleDays > 0 ? commitMs < staleThreshold : true;
    if (!stale) continue;
    candidates.push({ branch, head, merged: isMerged, stale, mounted,
      commitTime: new Date(commitMs).toISOString() });
  }
  if (mergedBranches.some(branch => !seen.has(branch))) refuse('sweep-ref-drift');
  return candidates;
}
/** Read fixed-size batches so Git process count does not grow with the lane count. */
export function observeUserCleanupSweep(root, { staleDays, requireMerged = false,
  requireNoActiveWorktree = false, now = Date.now, observeLines = observeGitLines,
  listWorktrees = worktrees, observePolicy = cwd => policy(cwd, MODE) } = {}) {
  if (!Number.isSafeInteger(staleDays) || staleDays < 0) refuse('stale-days-invalid');
  const current = observePolicy(root), canonical = current.canonical;
  const refs = observeLines(['for-each-ref', `--format=${sweepRefFormat}`, '--count=257', 'refs/heads/agent'], { cwd: root });
  if (refs.length > SWEEP_LIMIT) refuse('lane-inventory-over-budget');
  const mergedBranches = observeLines(['for-each-ref', `--merged=${canonical}`,
    '--format=%(refname:short)', '--count=257', 'refs/heads/agent'], { cwd: root });
  if (mergedBranches.length > SWEEP_LIMIT) refuse('lane-inventory-over-budget');
  const activeBranches = listWorktrees(root).map(row => row.branch).filter(Boolean);
  const candidates = projectUserCleanupSweep({ refs, mergedBranches, activeBranches, staleDays, now: now() })
    .filter(candidate => !requireMerged || candidate.merged)
    .filter(candidate => !requireNoActiveWorktree || !candidate.mounted);
  return { current, candidates };
}
function runUserCleanupSweep(root, argv, out = console.log) {
  const staleDays = Number(option(argv, 'stale-older-than') ?? '0');
  const requireMerged = argv.includes('--merged');
  const requireNoActiveWorktree = argv.includes('--no-active-worktree');
  const { current, candidates } = observeUserCleanupSweep(root, { staleDays, requireMerged, requireNoActiveWorktree });
  const canonical = current.canonical;
  const sweep = {
    schema: SWEEP_SCHEMA, observationOnly: true, authorizesEffects: false,
    repository: current.repository, canonicalRevision: canonical,
    staleOlderThanDays: staleDays, requireMerged, requireNoActiveWorktree,
    candidateCount: candidates.length, candidates,
    authority: 'explicit-local-user-consent', providerAuthority: false,
    nextAction: candidates.length > 0
      ? 'For each candidate, run cleanup-user plan --target=<worktree-path> --change-class=<class> then apply with --authorize=<plan-digest> --stopped'
      : 'no stale lane refs match the sweep criteria',
  };
  out(canonicalJson(sweep));
  return 0;
}
function preservationPolicy(root) {
  root = realpathSync(repoRoot(root));
  const trust = loadRepositoryTrust(root), revision = read(root, ['rev-parse', 'refs/heads/main']);
  if (trust.canonical.localRef !== 'refs/heads/main' || trust.canonical.remoteRef !== 'refs/remotes/origin/main'
    || read(root, ['symbolic-ref', '--quiet', 'HEAD']) !== trust.canonical.localRef
    || read(root, ['rev-parse', 'HEAD']) !== revision
    || read(root, ['rev-parse', 'refs/remotes/origin/main']) !== revision
    || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('preservation-policy-canonical');
  const bytes = read(root, ['show', `${revision}:.agentic-os/github-transition-policy.json`]);
  const policy = validateGitHubTransitionPolicy(JSON.parse(bytes));
  if (policy.authorityRepository !== trust.repository || policy.authorityRef !== 'refs/heads/main')
    refuse('preservation-policy-trust');
  return { root, revision, repository: trust.repository, policy };
}
function preservationObservation(root, adoption, policyRoot, workflow, options = {}) {
  const current = policy(root, RECOVERY_MODE), authority = preservationPolicy(policyRoot);
  selectPreservationAdoption(authority.policy, adoption);
  if (adoption.repository !== `github.com/${current.repository}`) refuse('preservation-repository');
  const retained = adoption.schema === 'agentic-os/current-quarantine-adoption/v1';
  const refs = retained ? [adoption.targetRef, adoption.targetRef] : [adoption.predecessorRef, adoption.successorRef];
  if (refs.some(ref => !isLaneRef(ref)) || !retained && refs[0] === refs[1]) refuse('preservation-refs');
  const peers = worktrees(root), cacheDigest = governanceDigest(refs.map(ref => get(ref, root)));
  if (peers.some(peer => refs.includes(peer.branch))) refuse('preservation-mounted');
  const heads = refs.map(ref => read(root, ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`]));
  if (heads[0] !== (retained ? adoption.targetHead : adoption.predecessorHead)
    || heads[1] !== (retained ? adoption.targetHead : adoption.successorHead))
    refuse('preservation-head-drift');
  const direct = retained ? integrationProof(adoption.merge, heads[0], { cwd: root }) : null;
  const integration = retained ? direct && { kind: 'current-quarantined', predecessorHead: heads[0], reviewedHead: heads[1],
    merge: adoption.merge, pathCount: direct.pathCount, replacements: [] }
    : successorIntegrationProof(adoption.merge, heads[0], heads[1], adoption.replacedPaths, { cwd: root });
  if (!integration || read(root, ['merge-base', '--is-ancestor', adoption.merge, current.canonical], { allowFail: true }) === null)
    refuse('preservation-integration');
  const review = options.localReview ?? observeMergedReview({ repository: current.repository,
    pr: Number(adoption.reviewLocator.split('/').at(-1)), requiredChecks: current.requiredChecks,
    workflow, mode: RECOVERY_MODE }, { cwd: root, ...options });
  if (review.url !== adoption.reviewLocator || review.head !== heads[1]
    || review.branch !== refs[1] || review.merge !== adoption.merge) refuse('preservation-review');
  const observed = observeRetainedQuarantineEvidence(root, refs[1], heads[1], adoption.quarantineCoordinate,
    retained ? { originalReceipt: options.originalReceipt, canonicalRef: current.localRef } : {});
  const retention = observed && retained ? { ...observed, originalReceipt: options.originalReceipt } : observed;
  if (!retention) refuse('preservation-retention');
  if (retained && retention.originalReceiptDigest !== adoption.originalReceiptDigest) refuse('preservation-original-receipt');
  if (!same(current, policy(root, RECOVERY_MODE)) || !same(authority, preservationPolicy(policyRoot))
    || !same(peers, worktrees(root)) || cacheDigest !== governanceDigest(refs.map(ref => get(ref, root)))
    || refs.some((ref, index) => read(root, ['rev-parse', `refs/heads/${ref}`]) !== heads[index]))
    refuse('preservation-observation-race');
  const state = { root, policyRoot: authority.root, policyRevision: authority.revision,
    policyRepository: authority.repository, workflow, predecessorHead: heads[0], successorHead: heads[1],
    peerRegistrationDigest: governanceDigest(peers), cacheDigest };
  return { repository: adoption.repository, canonicalRevision: current.canonical,
    profileDigest: current.repositoryProfileDigest, policyDigest: governanceDigest(authority.policy),
    review, integration, retention, state };
}
export function planSuccessorPreservation({ cwd = process.cwd(), adoption, originalReceipt, policyRoot, workflow }, options = {}) {
  const root = realpathSync(repoRoot(cwd)), issued = (options.now ?? Date.now)();
  const retained = adoption.schema === 'agentic-os/current-quarantine-adoption/v1';
  const facts = preservationObservation(root, adoption, policyRoot, workflow, { ...options, originalReceipt });
  const payload = { schema: retained ? CURRENT_QUARANTINE_PLAN_SCHEMA : SUCCESSOR_PRESERVATION_PLAN_SCHEMA,
    disposition: retained ? 'current-quarantine-retained' : 'successor-preserved',
    adoption, adoptionDigest: governanceDigest(adoption), ...facts,
    issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 900000).toISOString(),
    physicalCleanupPerformed: false, providerAuthority: false, claimRetired: false,
    [retained ? 'historicalQuarantineAuthorityProven' : 'historicalSuccessionAuthorityProven']: false };
  return validateRetentionDispositionPlan({ ...payload, planDigest: governanceDigest(payload) });
}
function preservationCarrier(root, planDigest) {
  return join(realpathSync(commonDir(root)), 'agentic-os-cleanup-quarantine', planDigest, 'preservation.json');
}
function readPreservationCarrier(path) {
  const base = privateDirectoryIdentity(dirname(dirname(path)), 'preservation base');
  const parent = privateDirectoryIdentity(dirname(path), 'preservation directory');
  if (!base || !parent) refuse('preservation-carrier');
  const stored = readUserCleanupJson(path, 'preservation-carrier', parent);
  assertPrivateDirectoryIdentity(base, 'preservation base');
  return stored;
}
export function verifySuccessorPreservation(root, input, options = {}) {
  const receipt = validateRetentionDispositionReceipt(input);
  const { planDigest, planIssuedAt, ...planState } = receipt.state;
  const { receiptDigest, ...content } = receipt;
  validateRetentionDispositionPlan({ ...content, schema: receipt.disposition === 'current-quarantine-retained'
    ? CURRENT_QUARANTINE_PLAN_SCHEMA : SUCCESSOR_PRESERVATION_PLAN_SCHEMA,
    state: planState, issuedAt: planIssuedAt, planDigest });
  if (!/^[a-f0-9]{64}$/u.test(planDigest ?? '')) refuse('preservation-carrier');
  const stored = readPreservationCarrier(preservationCarrier(root, planDigest));
  if (!same(receipt, stored)) refuse('preservation-carrier');
  const facts = preservationObservation(root, receipt.adoption, receipt.state.policyRoot, receipt.state.workflow,
    { ...options, originalReceipt: receipt.retention.originalReceipt, ...(options.localOnly ? { localReview: receipt.review } : {}) });
  for (const name of Object.keys(facts)) {
    const expected = name === 'state' ? { ...facts.state, planDigest, planIssuedAt } : facts[name];
    if (!same(receipt[name], expected)) refuse('preservation-drift');
  }
  if (!same(receipt, readPreservationCarrier(preservationCarrier(root, planDigest)))) refuse('preservation-carrier');
  return receipt;
}
export function applySuccessorPreservation(input, { cwd = process.cwd(), authorization, stopped, ...options } = {}) {
  const plan = validateRetentionDispositionPlan(input), root = realpathSync(repoRoot(cwd));
  options.originalReceipt = plan.retention.originalReceipt;
  if (root !== plan.state.root || stopped !== true
    || authorization !== `agentic-os:successor-preservation:${plan.planDigest}`) refuse('preservation-authorization');
  delete options.localOnly; delete options.localReview;
  return locked(root, () => {
    const path = preservationCarrier(root, plan.planDigest);
    const base = privateDirectoryIdentity(dirname(dirname(path)), 'preservation base');
    if (!base) refuse('preservation-carrier');
    if (lstatSync(path, { throwIfNoEntry: false })) {
      const stored = readPreservationCarrier(path);
      if (stored.state?.planDigest !== plan.planDigest || stored.state?.planIssuedAt !== plan.issuedAt)
        refuse('preservation-replay-plan');
      const verified = verifySuccessorPreservation(root, stored, options);
      assertPrivateDirectoryIdentity(base, 'preservation base');
      return verified;
    }
    const now = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < Date.parse(plan.issuedAt) || now >= Date.parse(plan.expiresAt))
      refuse('preservation-expired');
    const facts = preservationObservation(root, plan.adoption, plan.state.policyRoot, plan.state.workflow, options);
    if (Object.keys(facts).some(name => !same(facts[name], plan[name]))) refuse('preservation-drift');
    const issued = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(issued) || issued < now || issued >= Date.parse(plan.expiresAt))
      refuse('preservation-expired');
    const { planDigest, ...content } = plan;
    const payload = { ...content, schema: plan.disposition === 'current-quarantine-retained' ? CURRENT_QUARANTINE_SCHEMA : SUCCESSOR_PRESERVATION_SCHEMA,
      state: { ...plan.state, planDigest, planIssuedAt: plan.issuedAt }, issuedAt: new Date(issued).toISOString() };
    const receipt = validateRetentionDispositionReceipt({ ...payload, receiptDigest: governanceDigest(payload) });
    assertPrivateDirectoryIdentity(base, 'preservation base');
    mkdirSync(dirname(path), { mode: 0o700 });
    assertPrivateDirectoryIdentity(base, 'preservation base');
    const parent = privateDirectoryIdentity(dirname(path), 'preservation directory');
    if (!parent) refuse('preservation-carrier');
    writePrivateFileExclusive(path, Buffer.from(canonicalJson(receipt)), { maxBytes: 64000, label: 'preservation carrier' });
    const stored = validateRetentionDispositionReceipt(readUserCleanupJson(path, 'preservation-carrier', parent));
    assertPrivateDirectoryIdentity(base, 'preservation base');
    if (!same(receipt, stored)) refuse('preservation-carrier');
    return stored;
  });
}
