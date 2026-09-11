/** Explicit local-consent cleanup for profileless repositories; never a protected-path fallback. */
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { observeGit, repoRoot, remoteTransport, acquireOperationLock, finishOperationLock } from '../src/git.mjs';
import { loadRepositoryTrust } from '../src/git-repository.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { observeWorktreeCleanupTarget, classifyExistingWorktreeQuarantine, quarantineWorktreeTarget } from '../src/cleanup-quarantine.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { observeMergedReview, reviewOptions, refuse } from './agentic-os-cleanup-review.mjs';
import { option } from './agentic-os-argv.mjs';
const SCHEMA = 'agentic-os/user-cleanup-plan/v1', MODE = 'explicit-local-user-consent';
const KEY = 'agentic-os.userCleanup';
const LIMITS = Object.freeze({ projectionByteCeiling: 16 * 1024 * 1024, projectionEntryCeiling: 10000,
  registrationByteCeiling: 16 * 1024 * 1024, registrationEntryCeiling: 10000,
  sharedStateByteCeiling: 256 * 1024 * 1024, sharedStateEntryCeiling: 100000 });
const read = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 65536, ...options });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fields = (value, names) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== names.split(',').sort().join(',')) refuse('shape');
};
function policy(root) {
  if (realpathSync(repoRoot(root)) !== root || read(root, ['symbolic-ref', '--quiet', 'HEAD']) !== 'refs/heads/main')
    refuse('canonical-controller');
  if (read(root, ['config', '--local', '--get-all', KEY], { allowFail: true }) !== 'quarantine') refuse('local-enrollment-required');
  if (lstatSync(join(root, '.agentic-os.json'), { throwIfNoEntry: false })
    || read(root, ['ls-tree', 'refs/heads/main', '--', '.agentic-os.json'])
    || loadRepositoryTrust(root, { required: false })) refuse('profile-governed-repository');
  const remoteUrl = remoteTransport('origin', root).fetchUrl;
  const match = remoteUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (!match || match[1].split('/').some(s => s === '.' || s === '..')) refuse('remote-identity');
  const canonical = read(root, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  if (read(root, ['rev-parse', '--verify', 'HEAD']) !== canonical
    || read(root, ['rev-parse', '--verify', 'refs/remotes/origin/main']) !== canonical
    || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('canonical-not-clean');
  return { root, repository: match[1], remoteUrl, canonical, localRef: 'refs/heads/main',
    mode: MODE, enrollment: KEY, selectedEffects: ['quarantine-projection', 'quarantine-registration'] };
}
function observePolicy(mechanics, root) {
  const current = policy(root);
  if (governanceDigest(current) !== mechanics.profileDigest || current.canonical !== mechanics.expectedCanonicalRevision
    || `github.com/${current.repository}` !== mechanics.repository) refuse('local-policy-drift');
  return { root, canonicalRevision: current.canonical,
    profile: { profileDigest: governanceDigest(current), canonical: { localRef: current.localRef } } };
}
function mechanics(plan) {
  return { ...LIMITS, repository: `github.com/${plan.repository}`, targetPath: plan.targetPath,
    expectedBranch: plan.branch, expectedHeadRevision: plan.head, expectedCanonicalRef: 'refs/heads/main',
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
  if (read(plan.root, ['rev-parse', '--verify', `${plan.head}^{tree}`])
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
  fields(plan, 'schema,mode,root,repository,remoteUrl,pr,requiredChecks,workflow,targetPath,branch,head,canonical,merge,review,inventoryDigest,inventoryContentEntries,policyDigest,observation,issuedAt,expiresAt,planDigest');
  reviewOptions(plan);
  const { planDigest, ...content } = plan;
  if (plan.schema !== SCHEMA || plan.mode !== MODE || governanceDigest(content) !== planDigest
    || typeof plan.root !== 'string' || typeof plan.targetPath !== 'string' || plan.targetPath === plan.root
    || !['head', 'canonical', 'merge'].every(k => /^[a-f0-9]{40}$/u.test(plan[k]))
    || !['policyDigest', 'inventoryDigest', 'planDigest'].every(k => /^[a-f0-9]{64}$/u.test(plan[k]))
    || !Number.isSafeInteger(plan.issuedAt) || !Number.isSafeInteger(plan.expiresAt)
    || plan.issuedAt < 0 || plan.expiresAt <= plan.issuedAt || plan.expiresAt - plan.issuedAt > 900000
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
export function planUserCleanup({ cwd = process.cwd(), target, pr, requiredChecks, workflow }, options = {}) {
  const root = realpathSync(repoRoot(cwd));
  reviewOptions({ repository: 'placeholder/repository', pr, requiredChecks, workflow });
  return locked(root, () => {
    const current = policy(root), targetPath = realpathSync(target);
    if (targetPath !== target || targetPath === root || lstatSync(target).isSymbolicLink()) refuse('target-path');
    const review = observeMergedReview({ ...current, pr, requiredChecks, workflow }, { cwd: root, ...options });
    if (read(target, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
    const inventory = collectRecoveryInventory({ cwd: target, canonicalRef: 'refs/heads/main' });
    if (inventory.inventoryEntries.hidden || inventory.inventoryEntries.visibleUntracked) refuse('hidden-or-untracked-work');
    const issuedAt = options.now?.() ?? Date.now();
    const plan = { schema: SCHEMA, mode: MODE, root, repository: current.repository, remoteUrl: current.remoteUrl,
      pr, requiredChecks, workflow, targetPath, branch: review.branch, head: review.head, canonical: current.canonical,
      merge: review.merge, review, inventoryDigest: governanceDigest(inventory),
      inventoryContentEntries: inventory.inventoryEntries.content, policyDigest: governanceDigest(current),
      observation: null, issuedAt, expiresAt: issuedAt + 900000 };
    mergedState(plan, options, review);
    plan.observation = observeWorktreeCleanupTarget(mechanics(plan), { cwd: root, observePolicy });
    plan.planDigest = governanceDigest(plan);
    return validatePlan(plan);
  });
}
export function applyUserCleanup(input, { cwd = process.cwd(), authorization, stopped, now = Date.now, ...options } = {}) {
  const plan = validatePlan(input), root = realpathSync(repoRoot(cwd));
  if (root !== plan.root || authorization !== `agentic-os:user-cleanup:${plan.planDigest}` || stopped !== true)
    refuse('explicit-authorization-required');
  return locked(root, () => {
    const m = mechanics(plan), eligible = eligibility(plan);
    observePolicy(m, root); mergedState(plan, options);
    let applied = classifyExistingWorktreeQuarantine(m, eligible, { cwd: root, observePolicy });
    if (!applied) {
      if (now() < plan.issuedAt || now() >= plan.expiresAt) refuse('expired');
      if (read(plan.targetPath, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
      const before = observeWorktreeCleanupTarget(m, { cwd: root, observePolicy });
      if (!same(before, plan.observation)) refuse('observation-drift');
      try {
        applied = quarantineWorktreeTarget(m, before, { cwd: root, eligibility: eligible, observePolicy,
          authorizeEffects() {
            const time = now(); if (time < plan.issuedAt || time >= plan.expiresAt) refuse('expired');
            observePolicy(m, root); return new Date(time).toISOString();
          } });
      } catch (error) {
        Object.assign(error, { retainedOperation: true, operationResult: null,
          operationError: { reason: error.reason ?? null, message: error.message },
          operationArtifacts: { ...error.operationArtifacts, effectsRetained: true, planDigest: plan.planDigest,
            targetPath: plan.targetPath, mode: MODE } }); throw error;
      }
    }
    return { schema: 'agentic-os/user-cleanup-receipt/v1', mode: MODE, planDigest: plan.planDigest,
      authority: 'explicit-local-user-consent', providerAuthority: false, protectionProven: false, claimRetired: false,
      localPolicyDigest: plan.policyDigest, stoppedAcknowledged: true, canonicalRevision: plan.canonical,
      review: plan.review, ...applied.result, ...applied.artifacts, result: 'quarantined',
      bytesDeleted: false, branchesMutated: false, objectsMutated: false, operatingSystemExclusivityProven: false };
  });
}
export function runUserCleanup(root, argv, out = console.log) {
  if (argv[0] === 'plan') {
    const pr = Number(option(argv, 'pr'));
    const plan = planUserCleanup({ cwd: root, target: option(argv, 'target'), pr,
      requiredChecks: option(argv, 'checks').split(','), workflow: option(argv, 'workflow') });
    out(canonicalJson(plan)); return 0;
  }
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedStableFile(option(argv, 'plan'), 64000, 'user-cleanup-plan')));
  out(canonicalJson(applyUserCleanup(plan, { cwd: root, authorization: option(argv, 'authorize'), stopped: argv.includes('--stopped') })));
  return 0;
}
