/** Explicit operator recovery policy; never provider authority or a merge-method choice. */
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { loadRepositoryTrust, observeRepositoryProfileAtRef } from '../src/git-repository.mjs';
import { exactCurrentIntegrationProof, exactTreeProjectionProof, reviewedEquivalentTransitionProof, successorIntegrationProof } from '../src/patch-identity.mjs';
import { lstatSync, realpathSync } from 'node:fs';
import { acquireOperationLock, commonDir, currentBranch, finishOperationLock, headSha, isAncestor, observeGit, remoteTransport, repoRoot, worktrees } from '../src/git.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { classifyExistingWorktreeQuarantine, observeWorktreeCleanupTarget, quarantineWorktreeTarget } from '../src/cleanup-quarantine.mjs';
import { get } from '../src/lane-records.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
export const refuse = reason => { throw Object.assign(new Error(`blocked-user-cleanup-${reason}`), { reason }); };
export const RECOVERY_MODE = 'explicit-local-user-consent-recovery';
export const SCHEMA = 'agentic-os/user-cleanup-plan/v1', MODE = 'explicit-local-user-consent',
  NO_CI_MODE = 'explicit-local-user-consent-no-ci';
export const SNAPSHOT_CLEANUP_SCHEMA = 'agentic-os/detached-main-snapshot-cleanup-plan/v1';
export const RECOVERY_LIMITS = Object.freeze({
  projectionByteCeiling: 4 * 1024 ** 3, projectionEntryCeiling: 250000,
  registrationByteCeiling: 16 * 1024 ** 2, registrationEntryCeiling: 20000,
  sharedStateByteCeiling: 20 * 1024 ** 3, sharedStateEntryCeiling: 500000,
});
export function recoveryPolicy(root, repository, { requireChecks = true } = {}) {
  const trust = loadRepositoryTrust(root);
  const { profile } = observeRepositoryProfileAtRef({ repository: root, ref: 'refs/heads/main' });
  if (!profile || profile.repository !== `github.com/${repository}`
    || trust.repository !== profile.repository
    || canonicalJson(trust.canonical) !== canonicalJson(profile.canonical)
    || profile.canonical.localRef !== 'refs/heads/main'
    || profile.canonical.remoteRef !== 'refs/remotes/origin/main'
    || profile.adapters.repository?.id !== 'git' || profile.adapters.repository.version !== '1'
    || profile.adapters.provider?.id !== 'github' || profile.adapters.provider.version !== '1'
    || requireChecks && !profile.requiredChecks.length) refuse('recovery-profile-binding');
  return { repositoryProfileDigest: profile.profileDigest, requiredChecks: profile.requiredChecks,
    protectedCleanupPolicy: profile.cleanup, limits: RECOVERY_LIMITS };
}

const planFields = (value, names) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== names.split(',').sort().join(',')) refuse('shape');
};
const samePlanValue = (left, right) => canonicalJson(left) === canonicalJson(right);
const CURRENT_INTEGRATION_KINDS = new Set(['ancestor', 'ancestor-content-inclusion', 'exact-tree-projection']);

function currentIntegrationRecord(observed, expectedRecord, targetPath) {
  const record = observed && { state: observed.state, head: observed.head, baseSha: observed.baseSha, pr: observed.pr };
  if (!record || !expectedRecord || !samePlanValue(record, expectedRecord)
    || !['published', 'queued', 'integrated'].includes(observed.state)
    || observed.worktree !== targetPath || observed.base !== 'refs/remotes/origin/main'
    || !/^[a-f0-9]{40}$/u.test(observed.head ?? '')
    || !/^[a-f0-9]{40}$/u.test(observed.baseSha ?? '')
    || !Number.isSafeInteger(observed.pr) || observed.pr < 1) refuse('recovery-lane-binding');
  return record;
}

function currentIntegrationHead({ root, targetPath, ref, canonical, observed }) {
  const head = headSha('HEAD', targetPath);
  if (currentBranch(targetPath) !== ref || head !== headSha(`refs/heads/${ref}`, root)
    || !isAncestor(observed.head, head, root) || !isAncestor(observed.baseSha, canonical, root))
    refuse('recovery-lane-binding');
  return head;
}

function exactCurrentIntegrationBinding(root, ref, head, canonical) {
  const proof = exactCurrentIntegrationProof('refs/heads/main', ref, { cwd: root });
  if (!proof || proof.head !== head || proof.baseHead !== canonical
    || !CURRENT_INTEGRATION_KINDS.has(proof.kind)) refuse('integration-not-current');
  return proof;
}

export function deriveCurrentIntegrationBinding({ root, targetPath, ref, canonical, record: expectedRecord }) {
  const observed = get(ref, root), record = currentIntegrationRecord(observed, expectedRecord, targetPath);
  const head = currentIntegrationHead({ root, targetPath, ref, canonical, observed });
  const proof = exactCurrentIntegrationBinding(root, ref, head, canonical);
  return { record: expectedRecord, proof };
}

function validCurrentIntegrationBinding(plan) {
  const binding = plan.currentIntegration, record = binding?.record, proof = binding?.proof;
  if (!binding || Object.keys(binding).sort().join(',') !== 'proof,record'
    || !record || Object.keys(record).sort().join(',') !== 'baseSha,head,pr,state'
    || !['published', 'queued', 'integrated'].includes(record.state)
    || !/^[a-f0-9]{40}$/u.test(record.head ?? '')
    || !/^[a-f0-9]{40}$/u.test(record.baseSha ?? '')
    || !Number.isSafeInteger(record.pr) || record.pr < 1 || record.pr !== plan.pr
    || !proof || !CURRENT_INTEGRATION_KINDS.has(proof.kind)) return false;

  const proofFields = proof.kind === 'ancestor'
    ? 'baseHead,detail,head,kind,pending'
    : 'baseHead,detail,head,kind,pathCount,pending';
  return Object.keys(proof).sort().join(',') === proofFields
    && proof.head === plan.head && proof.baseHead === plan.canonical
    && typeof proof.detail === 'string' && proof.detail.length > 0
    && (proof.kind === 'ancestor' || Number.isSafeInteger(proof.pathCount) && proof.pathCount > 0)
    && Array.isArray(proof.pending) && proof.pending.length === 0
    && plan.review && Object.keys(plan.review).sort().join(',') === 'branch,head,kind,merge'
    && plan.review?.kind === 'local-current-integration'
    && plan.review.branch === plan.branch && plan.review.head === plan.head
    && plan.review.merge === plan.canonical && plan.merge === plan.canonical
    && isLaneRef(plan.branch) && !plan.detachedHead && !plan.successor
    && !plan.mergedProjection && !plan.historicalCheckGap;
}

function parseUserCleanupPlan(input) {
  const bytes = canonicalJson(input);
  if (Buffer.byteLength(bytes) > 64000) refuse('plan-size');
  return JSON.parse(bytes);
}

function validateUserCleanupPlanFields(plan) {
  const optionalFields = ['detachedHead', 'reviewedEquivalentCommit', 'successor',
    'mergedProjection', 'historicalCheckGap', 'changeClass'];
  const fields = ['schema', 'mode', 'root', 'repository', 'remoteUrl', 'pr', 'requiredChecks',
    'workflow', 'targetPath', 'branch', 'head', 'canonical', 'merge', 'review', 'inventoryDigest',
    'inventoryContentEntries', 'policyDigest', 'observation', 'issuedAt', 'expiresAt', 'planDigest'];
  if (plan.mode === RECOVERY_MODE) fields.push('integration', 'recoveryPolicy');
  for (const field of optionalFields) if (Object.hasOwn(plan, field)) fields.push(field);
  if (Object.hasOwn(plan, 'currentIntegration')) fields.push('currentIntegration');
  planFields(plan, fields.join(','));
}

function validateUserCleanupReview(plan, reviewOptions) {
  const localIntegration = Object.hasOwn(plan, 'currentIntegration');
  if (localIntegration) {
    if (!validCurrentIntegrationBinding(plan) || plan.mode !== RECOVERY_MODE || plan.workflow !== null
      || !Number.isSafeInteger(plan.pr) || plan.pr < 1 || !Array.isArray(plan.requiredChecks)
      || !plan.requiredChecks.length || plan.requiredChecks.length > 8
      || plan.requiredChecks.some(check => typeof check !== 'string' || !check.trim()
        || Buffer.byteLength(check) > 128 || /[\x00-\x1f\x7f]/u.test(check))
      || JSON.stringify([...new Set(plan.requiredChecks)].sort()) !== JSON.stringify(plan.requiredChecks))
      refuse('plan-binding');
  } else reviewOptions(plan);
}

function validateUserCleanupPlanBinding(plan) {
  const localIntegration = Object.hasOwn(plan, 'currentIntegration');
  const { planDigest, ...content } = plan;
  const validOptionalFields = (!Object.hasOwn(plan, 'detachedHead')
    || plan.mode === RECOVERY_MODE && /^[a-f0-9]{40}$/u.test(plan.detachedHead ?? ''))
    && (!Object.hasOwn(plan, 'reviewedEquivalentCommit')
      || plan.mode === RECOVERY_MODE && plan.detachedHead
        && /^[a-f0-9]{40}$/u.test(plan.reviewedEquivalentCommit ?? ''))
    && (!Object.hasOwn(plan, 'successor') || plan.mode === RECOVERY_MODE && !plan.detachedHead
      && plan.successor && Object.keys(plan.successor).sort().join(',') === 'predecessorHead,predecessorRef,replacedPaths'
      && typeof plan.successor.predecessorRef === 'string'
      && /^[a-f0-9]{40}$/u.test(plan.successor.predecessorHead ?? '')
      && Array.isArray(plan.successor.replacedPaths))
    && (!Object.hasOwn(plan, 'mergedProjection') || plan.mode === RECOVERY_MODE && !plan.detachedHead
      && !plan.successor && plan.mergedProjection
      && Object.keys(plan.mergedProjection).sort().join(',') === 'branch,head'
      && isLaneRef(plan.mergedProjection.branch) && plan.mergedProjection.branch !== plan.branch
      && plan.mergedProjection.head === plan.merge)
    && (!Object.hasOwn(plan, 'historicalCheckGap') || plan.historicalCheckGap
      && (plan.mergedProjection || plan.detachedHead === plan.head)
      && plan.review?.historicalCheckGap?.checkRunsObserved === 0
      && samePlanValue(plan.review.historicalCheckGap.requiredChecks, plan.requiredChecks));
  if (plan.schema !== SCHEMA || ![MODE, NO_CI_MODE, RECOVERY_MODE].includes(plan.mode)
    || governanceDigest(content) !== planDigest || typeof plan.root !== 'string'
    || typeof plan.targetPath !== 'string' || plan.targetPath === plan.root
    || !['head', 'canonical', 'merge'].every(key => /^[a-f0-9]{40}$/u.test(plan[key]))
    || !['policyDigest', 'inventoryDigest', 'planDigest'].every(key => /^[a-f0-9]{64}$/u.test(plan[key]))
    || !Number.isSafeInteger(plan.issuedAt) || !Number.isSafeInteger(plan.expiresAt)
    || plan.issuedAt < 0 || plan.expiresAt <= plan.issuedAt || plan.expiresAt - plan.issuedAt > 900000
    || !validOptionalFields || !localIntegration
      && (plan.head !== plan.review?.head || plan.merge !== plan.review?.merge || plan.branch !== plan.review?.branch))
    refuse('plan-binding');
}

export function validateUserCleanupPlan(input, reviewOptions) {
  const plan = parseUserCleanupPlan(input);
  validateUserCleanupPlanFields(plan);
  validateUserCleanupReview(plan, reviewOptions);
  validateUserCleanupPlanBinding(plan);
  return plan;
}

export function prepareCurrentIntegrationReview({ root, targetPath, canonical, record, ref = null }) {
  const branch = currentBranch(targetPath);
  if (ref !== null && branch !== ref) refuse('recovery-lane-binding');
  const binding = deriveCurrentIntegrationBinding({
    root, targetPath, ref: branch, canonical, record,
  });
  return { binding, review: { kind: 'local-current-integration', branch,
    head: headSha('HEAD', targetPath), merge: canonical } };
}

const snapshotRead = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 65536, ...options }); const snapshotSame = (left, right) => canonicalJson(left) === canonicalJson(right);
const SNAPSHOT_TTL = 900_000;
function snapshotPolicy(root, expectedHead, options = {}) {
  if (realpathSync(repoRoot(root)) !== root || currentBranch(root) !== 'main') refuse('snapshot-controller');
  const canonical = snapshotRead(root, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  if (canonical !== expectedHead || snapshotRead(root, ['rev-parse', '--verify', 'HEAD']) !== canonical
    || snapshotRead(root, ['rev-parse', '--verify', 'refs/remotes/origin/main']) !== canonical
    || snapshotRead(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('snapshot-controller-drift');
  const transport = remoteTransport('origin', root), trust = loadRepositoryTrust(root), observed = observeRepositoryProfileAtRef({ repository: root, ref: 'refs/heads/main' }), profile = observed.profile;
  if (!profile || profile.repository !== trust.repository || canonicalJson(profile.canonical) !== canonicalJson(trust.canonical)
    || profile.canonical.localRef !== 'refs/heads/main' || profile.canonical.remoteRef !== 'refs/remotes/origin/main'
    || profile.adapters.repository?.id !== 'git' || profile.adapters.repository.version !== '1') refuse('snapshot-profile-binding');
  const repository = profile.repository;
  const remoteMain = options.observeRemote ? options.observeRemote({ root, canonical, remoteUrl: transport.fetchUrl })
    : snapshotRead(root, ['ls-remote', '--refs', '--', transport.fetchUrl, 'refs/heads/main']);
  if (remoteMain !== `${canonical}\trefs/heads/main`) refuse('snapshot-remote-main-drift');
  const cleanup = profile.cleanup;
  if (!cleanup || cleanup.localBranch !== 'retain' || cleanup.remoteBranch !== 'retain'
    || cleanup.remoteTrackingRef !== 'retain' || cleanup.unreachableObjects !== 'retain'
    || cleanup.worktreeProjection !== 'quarantine' || cleanup.worktreeRegistration !== 'quarantine') refuse('snapshot-cleanup-policy');
  return { schema: 'agentic-os/detached-main-snapshot-cleanup-policy/v1', root, repository,
    remoteUrlDigest: transport.urlDigest, remoteMain, canonical, repositoryProfileDigest: profile.profileDigest,
    cleanup, limits: RECOVERY_LIMITS };
}
function snapshotMechanics(plan) {
  return { ...RECOVERY_LIMITS, mode: RECOVERY_MODE, repository: plan.repository,
    targetPath: plan.targetPath, expectedBranch: null, expectedHeadRevision: plan.snapshotHead,
    detachedRecovery: true, expectedCanonicalRef: 'refs/heads/main', expectedCanonicalRevision: plan.canonical,
    profileDigest: governanceDigest(plan.policy), recoveryInventoryDigest: plan.inventoryDigest,
    recoveryInventoryContentEntries: plan.inventoryContentEntries, expiresAt: new Date(plan.expiresAt).toISOString(),
    planDigest: plan.planDigest };
}
function snapshotObserver(plan, options = {}) {
  return (mechanics, root) => {
    const current = snapshotPolicy(realpathSync(repoRoot(root)), plan.canonical, options);
    if (!snapshotSame(current, plan.policy) || current.root !== plan.root) refuse('snapshot-policy-drift');
    return { root, canonicalRevision: current.canonical,
      profile: { profileDigest: governanceDigest(current), canonical: { localRef: 'refs/heads/main' } } };
  };
}
function snapshotEligibility(plan) {
  const observation = plan.observation;
  return { schema: 'agentic-os/user-cleanup-eligibility/v1', planDigest: plan.planDigest,
    profileDigest: governanceDigest(plan.policy), canonicalRevision: plan.canonical,
    projectionManifestDigest: observation.projectionManifest.digest, projectionBytes: observation.projectionManifest.bytes,
    projectionEntries: observation.projectionManifest.entries, registrationManifestDigest: observation.registrationManifest.digest,
    registrationBytes: observation.registrationManifest.bytes, registrationEntries: observation.registrationManifest.entries,
    peerRegistrationDigest: observation.peerRegistrationDigest, sharedRefDigest: observation.sharedRefDigest,
    objectInventoryDigest: observation.objectInventoryDigest, sharedStateBytes: observation.sharedStateBytes,
    sharedStateEntries: observation.sharedStateEntries, evaluatedAt: new Date(plan.issuedAt).toISOString(),
    expiresAt: new Date(plan.expiresAt).toISOString() };
}
function withSnapshotLock(root, operation) {
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', root); if (!lock) refuse('busy');
  let result, error;
  try { result = operation(); } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'detached-main-snapshot-cleanup', result, error,
    artifacts: error?.operationArtifacts ?? null });
}
export function planDetachedMainSnapshotCleanup({ cwd = process.cwd(), target, expectedHead, now = Date.now } = {}, options = {}) {
  const root = realpathSync(repoRoot(cwd));
  if (typeof target !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(expectedHead ?? '')) refuse('snapshot-target-arguments');
  let targetPath; try { targetPath = realpathSync(target); } catch { refuse('snapshot-target-path'); }
  const pathStat = lstatSync(target, { throwIfNoEntry: false });
  if (!pathStat?.isDirectory() || pathStat.isSymbolicLink() || targetPath !== target || targetPath === root) refuse('snapshot-target-path');
  return withSnapshotLock(root, () => {
    const policy = snapshotPolicy(root, expectedHead, options), rows = worktrees(root).filter(row => row.path === targetPath);
    if (rows.length !== 1 || !rows[0].detached || rows[0].branch !== null
      || snapshotRead(targetPath, ['rev-parse', '--verify', 'HEAD']) !== expectedHead
      || realpathSync(commonDir(targetPath)) !== realpathSync(commonDir(root))) refuse('snapshot-target-registration');
    if (snapshotRead(targetPath, ['status', '--porcelain', '--untracked-files=all'])) refuse('snapshot-target-dirty');
    const inventory = collectRecoveryInventory({ cwd: targetPath, canonicalRef: 'refs/heads/main', allowDetached: true,
      maxContentEntries: RECOVERY_LIMITS.projectionEntryCeiling });
    if (inventory.headRevision !== expectedHead || inventory.canonicalRevision !== expectedHead || inventory.branch !== null
      || inventory.inventoryEntries.hidden || inventory.inventoryEntries.visibleUntracked) refuse('snapshot-inventory');
    const issuedAt = now(); if (!Number.isSafeInteger(issuedAt)) refuse('snapshot-clock');
    const plan = { schema: SNAPSHOT_CLEANUP_SCHEMA, mode: 'local-snapshot', authority: 'explicit-local-user-consent',
    root, repository: policy.repository, targetPath, canonical: policy.canonical,
      snapshotHead: expectedHead, policy, inventoryDigest: governanceDigest(inventory),
      inventoryContentEntries: inventory.inventoryEntries.content, observation: null,
      issuedAt, expiresAt: issuedAt + SNAPSHOT_TTL, planDigest: '0'.repeat(64) };
    const observePolicy = snapshotObserver(plan, options), mechanics = snapshotMechanics(plan);
    plan.observation = observeWorktreeCleanupTarget(mechanics, { cwd: root, observePolicy, now });
    delete plan.planDigest;
    return { ...plan, planDigest: governanceDigest(plan) };
  });
}
export function applyDetachedMainSnapshotCleanup(plan, { cwd = process.cwd(), authorization, stopped, now = Date.now } = {}, options = {}) {
  const expected = 'authority,canonical,expiresAt,inventoryContentEntries,inventoryDigest,issuedAt,mode,observation,policy,planDigest,repository,root,schema,snapshotHead,targetPath';
  if (!plan || Array.isArray(plan) || typeof plan !== 'object' || Object.keys(plan).sort().join(',') !== expected.split(',').sort().join(',')) refuse('snapshot-plan-shape');
  const { planDigest, ...body } = plan, root = realpathSync(repoRoot(cwd));
  if (body.schema !== SNAPSHOT_CLEANUP_SCHEMA || body.mode !== 'local-snapshot' || body.authority !== 'explicit-local-user-consent'
    || !/^[a-f0-9]{64}$/u.test(planDigest ?? '') || governanceDigest(body) !== planDigest || body.root !== root
    || authorization !== `agentic-os:local-snapshot-cleanup:${planDigest}` || stopped !== true
    || !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) || body.expiresAt - body.issuedAt !== SNAPSHOT_TTL
    || typeof body.repository !== 'string' || typeof body.targetPath !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(body.snapshotHead ?? '') || body.snapshotHead !== body.canonical) refuse('snapshot-authorization');
  return withSnapshotLock(root, () => {
    const policy = snapshotPolicy(root, body.canonical, options);
    if (!snapshotSame(policy, body.policy) || body.repository !== policy.repository) refuse('snapshot-policy-drift');
    const mechanics = snapshotMechanics(plan), eligible = snapshotEligibility(plan), observePolicy = snapshotObserver(plan, options);
    let applied = classifyExistingWorktreeQuarantine(mechanics, eligible, { cwd: root, observePolicy });
    if (!applied) {
      const time = now(); if (!Number.isSafeInteger(time) || time < body.issuedAt || time >= body.expiresAt) refuse('snapshot-expired');
      if (snapshotRead(body.targetPath, ['status', '--porcelain', '--untracked-files=all'])) refuse('snapshot-target-dirty');
      const before = observeWorktreeCleanupTarget(mechanics, { cwd: root, observePolicy, now });
      if (!snapshotSame(before, body.observation)) refuse('snapshot-observation-drift');
      try { applied = quarantineWorktreeTarget(mechanics, before, { cwd: root, eligibility: eligible, observePolicy,
        authorizeEffects() { const observedAt = now(); if (observedAt < body.issuedAt || observedAt >= body.expiresAt) refuse('snapshot-expired');
          snapshotPolicy(root, body.canonical, options); return new Date(observedAt).toISOString(); } }); }
      catch (error) { Object.assign(error, { operationArtifacts: { ...error.operationArtifacts, planDigest,
        targetPath: body.targetPath, mode: body.mode, effectsRetained: true } }); throw error; }
    }
    const receipt = { schema: 'agentic-os/detached-main-snapshot-cleanup-receipt/v1', planDigest,
      authority: 'explicit-local-user-consent', targetPath: body.targetPath, snapshotHead: body.snapshotHead,
      canonicalRevision: body.canonical, ...applied.result, ...applied.artifacts, result: 'quarantined',
      replayed: Boolean(applied.artifacts.replayed), stoppedAcknowledged: true, bytesDeleted: false,
      branchRefsMutated: false, objectDatabaseMutated: false, providerAuthority: false, deploymentAuthority: false };
    return { ...receipt, receiptDigest: governanceDigest(receipt) };
  });
}

function contentInclusion(plan, head, read) {
  const headTree = read(plan.root, ['rev-parse', '--verify', `${head}^{tree}`]);
  const mergeTree = read(plan.root, ['rev-parse', '--verify', `${plan.merge}^{tree}`]);
  if (headTree === mergeTree) return { kind: 'equal-tree', headTree, mergeTree };
  const projection = exactTreeProjectionProof(plan.merge, head, { cwd: plan.root });
  if (!projection) refuse('source-not-integrated');
  return { kind: projection.kind, pathCount: projection.pathCount, headTree, mergeTree };
}
export function recoveryIntegration(plan, read) {
  if (plan.reviewedEquivalentCommit) {
    if (!plan.detachedHead || plan.successor) refuse('equivalent-options');
    const proof = reviewedEquivalentTransitionProof(plan.merge, plan.detachedHead, plan.reviewedEquivalentCommit, plan.head, { cwd: plan.root });
    if (!proof) refuse('equivalent-transition');
    return { ...proof, reviewedSource: contentInclusion(plan, plan.head, read) };
  }
  if (plan.successor) {
    const proof = successorIntegrationProof(plan.merge, plan.successor.predecessorHead,
      plan.head, plan.successor.replacedPaths, { cwd: plan.root });
    if (!proof) refuse('successor-not-integrated');
    return proof;
  }
  const integration = contentInclusion(plan, plan.head, read);
  if (!plan.detachedHead) return integration;
  if (read(plan.root, ['merge-base', '--is-ancestor', plan.detachedHead, plan.head], { allowFail: true }) === null)
    refuse('detached-not-reviewed-ancestor');
  return { ...integration, detached: { head: plan.detachedHead, reviewedHead: plan.head,
    inclusion: contentInclusion(plan, plan.detachedHead, read) } };
}
/** Resolve one authenticated check locator and bind its provider run to the reviewed source. */
export function reviewedCheckRun(value, pull, c, read, skipOtherWorkflow = false) {
  const prefix = `https://github.com/${value.repository}/actions/runs/`;
  const match = (c.details_url?.startsWith(prefix) ? c.details_url.slice(prefix.length) : '').match(/^(\d+)\/job\/(\d+)$/u);
  if (!Number.isSafeInteger(c.id) || c.id < 1 || !match || Number(match[2]) !== c.id
    || !Number.isSafeInteger(Number(match[1]))) refuse('check-locator');
  const run = read(`repos/${value.repository}/actions/runs/${match[1]}`);
  if (skipOtherWorkflow && (run?.event !== 'pull_request'
    || value.workflow != null && run.path !== value.workflow)) return null;
  if (run?.id !== Number(match[1]) || run.head_sha !== pull.head.sha || run.head_branch !== pull.head.ref
    || run.repository?.full_name !== value.repository || run.head_repository?.full_name !== value.repository
    || run.event !== 'pull_request' || !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/u.test(run.path ?? '')
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) refuse('check-run-binding');
  return run;
}
/** Select complete successful runs of the named workflow, before the observed merge. */
export function recoveryChecks(value, pull, runs, read, { inferWorkflow = false } = {}) {
  const cache = new Map(), workflows = new Set(), merged = Date.parse(pull.merged_at);
  if (!Number.isFinite(merged)) refuse('merged-review');
  const checks = value.requiredChecks.map(name => {
    const candidates = runs.filter(c => c.name === name && c.head_sha === pull.head.sha
      && c.app?.slug === 'github-actions' && c.app?.id === 15368
      && Number.isFinite(Date.parse(c.completed_at)) && Date.parse(c.completed_at) <= merged)
      .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at) || b.id - a.id);
    if (inferWorkflow && !candidates.length) refuse('check-ambiguous-or-missing');
    const matching = [];
    for (const c of candidates) {
      const run = reviewedCheckRun(value, pull, c, path => {
        if (!cache.has(path)) cache.set(path, read(path));
        return cache.get(path);
      }, true);
      if (!run) continue;
      workflows.add(run.path);
      matching.push({ c, run });
    }
    const first = matching[0];
    if (!first || first.c.status !== 'completed' || first.c.conclusion !== 'success'
      || first.run.status !== 'completed' || first.run.conclusion !== 'success') refuse('check-not-successful');
    if (matching.slice(1).some(({ c }) => c.id === first.c.id)) refuse('check-ambiguous-or-missing');
    return { name, checkId: first.c.id, runId: first.run.id, attempt: first.run.run_attempt,
      workflow: first.run.path, conclusion: 'success', completedAt: first.c.completed_at,
      url: first.c.details_url };
  });
  if (inferWorkflow && workflows.size !== 1) refuse('workflow-ambiguous');
  return checks;
}
