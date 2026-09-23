/** Explicit local-consent cleanup; profile recovery requires its own operator opt-in. */
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { observeGit, repoRoot, remoteTransport, acquireOperationLock, finishOperationLock, observeGitLines, worktrees } from '../src/git.mjs';
import { loadRepositoryTrust } from '../src/git-repository.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { observeWorktreeCleanupTarget, classifyExistingWorktreeQuarantine, quarantineWorktreeTarget } from '../src/cleanup-quarantine.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { observeMergedReview, reviewOptions, refuse } from './agentic-os-cleanup-review.mjs';
import { option } from './agentic-os-argv.mjs';
import { RECOVERY_MODE, RECOVERY_LIMITS, recoveryPolicy, recoveryIntegration } from './agentic-os-cleanup-recovery.mjs';
const SCHEMA = 'agentic-os/user-cleanup-plan/v1', MODE = 'explicit-local-user-consent';
const NO_CI_MODE = 'explicit-local-user-consent-no-ci';
const KEY = 'agentic-os.userCleanup';
const LIMITS = Object.freeze({ projectionByteCeiling: 16 * 1024 * 1024, projectionEntryCeiling: 10000,
  registrationByteCeiling: 16 * 1024 * 1024, registrationEntryCeiling: 10000,
  sharedStateByteCeiling: 256 * 1024 * 1024, sharedStateEntryCeiling: 100000 });
const read = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 65536, ...options });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/**
 * Change-class fast path: when --change-class=docs-only is declared AND the
 * lane diff confirms only docs/markdown paths are touched, the local-consent
 * cleanup path is the accepted terminal state (providerAuthority:false is
 * sufficient; no protected-authority chain required for this change class).
 *
 * This is a CLI/observation-layer simplification. The cleanup mechanics
 * (quarantine, not delete) stay identical. It only relaxes the authority
 * chain requirement for the specific change class.
 */
const DOCS_ONLY_PATTERNS = [/^docs\//u, /^guides\//u, /\.md$/u, /^AGENTS\.md$/u, /^README\.md$/u, /^DOCUMENTS\.md$/u, /^FLEET\.md$/u, /^PRD-.*\.md$/u];
const SUPPORTED_CHANGE_CLASSES = Object.freeze(['docs-only']);
function classifyLaneChangeClass(root, targetPath) {
  const head = read(targetPath, ['rev-parse', '--verify', 'HEAD'], { allowFail: true });
  if (!head) return 'unknown';
  const base = read(targetPath, ['merge-base', 'origin/main', 'HEAD'], { allowFail: true });
  if (!base) return 'unknown';
  const diff = read(targetPath, ['diff', '--name-only', `${base}...${head}`], { allowFail: true });
  if (!diff) return 'unknown';
  const paths = diff.split('\n').filter(Boolean);
  if (paths.length === 0) return 'empty';
  const allDocs = paths.every((p) => DOCS_ONLY_PATTERNS.some((re) => re.test(p)));
  return allDocs ? 'docs-only' : 'mixed';
}
function resolveChangeClass(declared, observed) {
  if (declared === undefined) return { declared: null, observed, fastPath: false };
  if (!SUPPORTED_CHANGE_CLASSES.includes(declared)) refuse('unsupported-change-class');
  if (declared === 'docs-only') {
    if (observed !== 'docs-only')
      refuse('change-class-mismatch', `declared --change-class=docs-only but observed ${observed}`);
    return { declared, observed, fastPath: true };
  }
  return { declared, observed, fastPath: false };
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
    expectedBranch: plan.detachedHead ? null : plan.successor?.predecessorRef ?? plan.branch,
    expectedHeadRevision: plan.detachedHead ?? plan.successor?.predecessorHead ?? plan.head,
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
    + (Object.hasOwn(plan, 'successor') ? ',successor' : '')
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
    || (Object.hasOwn(plan, 'successor') && (plan.mode !== RECOVERY_MODE || plan.detachedHead
      || !plan.successor || Object.keys(plan.successor).sort().join(',') !== 'predecessorHead,predecessorRef,replacedPaths'
      || typeof plan.successor.predecessorRef !== 'string'
      || !/^[a-f0-9]{40}$/u.test(plan.successor.predecessorHead)
      || !Array.isArray(plan.successor.replacedPaths)))
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
  noCI = false, recovery = false, detached = false, changeClass = undefined, successor = undefined }, options = {}) {
  const policyResolver = options.resolvePolicy ?? null;
  if (noCI && recovery) refuse('incompatible-modes');
  if (typeof detached !== 'boolean' || detached && !recovery) refuse('detached-recovery-required');
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
    const review = observeMergedReview({ ...current, pr, requiredChecks, workflow }, { cwd: root, ...options });
    if (read(target, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
    const inventory = collectRecoveryInventory({ cwd: target, canonicalRef: 'refs/heads/main', allowDetached: detached });
    if (successor && (inventory.branch !== successor.predecessorRef
      || inventory.headRevision !== successor.predecessorHead)) refuse('successor-target-drift');
    if (detached && inventory.branch !== null) refuse('target-not-detached');
    if (inventory.inventoryEntries.hidden || inventory.inventoryEntries.visibleUntracked) refuse('hidden-or-untracked-work');
    const observedChangeClass = classifyLaneChangeClass(root, targetPath);
    const changeClassInfo = resolveChangeClass(changeClass, observedChangeClass);
    const issuedAt = options.now?.() ?? Date.now();
    const plan = { schema: SCHEMA, mode, root, repository: current.repository, remoteUrl: current.remoteUrl,
      pr, requiredChecks, workflow, targetPath, branch: review.branch, head: review.head, canonical: current.canonical,
      merge: review.merge, review, inventoryDigest: governanceDigest(inventory),
      inventoryContentEntries: inventory.inventoryEntries.content, policyDigest: governanceDigest(current),
      observation: null, issuedAt, expiresAt: issuedAt + 900000,
      ...(detached ? { detachedHead: inventory.headRevision } : {}),
      ...(successor ? { successor: { predecessorRef: successor.predecessorRef,
        predecessorHead: successor.predecessorHead, replacedPaths: successor.replacedPaths } } : {}),
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
      selectedChecksVerified: plan.mode !== NO_CI_MODE, noCI: plan.mode === NO_CI_MODE,
      ...(plan.changeClass?.fastPath ? { changeClass: plan.changeClass, authorityTerminalState: 'local-consent' } : {}),
      ...(plan.mode === RECOVERY_MODE ? { recoveryPolicy: plan.recoveryPolicy,
        integration: plan.integration, historicalIntegrationMethodProven: false } : {}),
      localPolicyDigest: plan.policyDigest, stoppedAcknowledged: true, canonicalRevision: plan.canonical,
      review: plan.review, ...(plan.detachedHead ? { detachedHead: plan.detachedHead } : {}),
      ...(plan.successor ? { successor: plan.successor } : {}),
      ...applied.result, ...applied.artifacts, result: 'quarantined',
      bytesDeleted: false, branchesMutated: false, objectsMutated: false, operatingSystemExclusivityProven: false };
  });
}
/**
 * Unified cleanup CLI: dispatches to cleanup-user plan/apply/sweep with mode
 * flags, consolidating the three overlapping cleanup entry points into one
 * command. This is a thin UX wrapper over the existing binaries; it does not
 * change cleanup mechanics or authority semantics.
 *
 * Usage:
 *   agentic-os cleanup plan --target=<path> --pr=<n> --checks=<list> --workflow=<id>
 *     [--mode=protected|local-consent|recovery] [--change-class=docs-only] [--detached]
 *   agentic-os cleanup apply --plan=<json> --authorize=<digest> --stopped
 *   agentic-os cleanup sweep --stale-older-than=<days> [--merged] [--no-active-worktree]
 *
 * --mode defaults to 'local-consent' (the existing cleanup-user default).
 * --mode=protected is reserved for profile-governed repos (not implemented here;
 * those still use release-common complete → completion:scaffold → completion:plan/apply).
 */
const UNIFIED_MODE_FLAGS = Object.freeze({ 'local-consent': [], recovery: ['--recovery'], 'no-ci': [] });
export function runUnifiedCleanup(root, argv, out = console.log) {
  const sub = argv[0];
  if (sub !== 'plan' && sub !== 'apply' && sub !== 'sweep')
    refuse('cleanup-arguments', 'usage: cleanup <plan|apply|sweep> [options]');
  const rest = argv.slice(1);
  if (sub === 'plan') {
    const modeFlag = option(rest, 'mode') || 'local-consent';
    if (!Object.hasOwn(UNIFIED_MODE_FLAGS, modeFlag)) refuse('cleanup-arguments', `unknown mode ${modeFlag}`);
    const extraFlags = UNIFIED_MODE_FLAGS[modeFlag];
    const changeClass = option(rest, 'change-class') || undefined;
    const noCI = modeFlag === 'no-ci';
    const checksToken = option(rest, 'checks');
    const workflowToken = option(rest, 'workflow');
    const plan = planUserCleanup({ cwd: root, target: option(rest, 'target'),
      pr: Number(option(rest, 'pr')),
      requiredChecks: noCI ? [] : (checksToken ? checksToken.split(',') : []),
      workflow: noCI ? null : workflowToken,
      recovery: extraFlags.includes('--recovery'),
      detached: rest.includes('--detached'), noCI, changeClass });
    out(canonicalJson(plan)); return 0;
  }
  if (sub === 'sweep') return runUserCleanupSweep(root, rest, out);
  // apply
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedStableFile(option(rest, 'plan'), 64000, 'user-cleanup-plan')));
  out(canonicalJson(applyUserCleanup(plan, { cwd: root, authorization: option(rest, 'authorize'), stopped: rest.includes('--stopped') })));
  return 0;
}

export function runUserCleanup(root, argv, out = console.log) {
  if (argv[0] === 'sweep') return runUserCleanupSweep(root, argv, out);
  if (argv[0] === 'plan') {
    const pr = Number(option(argv, 'pr'));
    const changeClass = option(argv, 'change-class') || undefined;
    const plan = planUserCleanup({ cwd: root, target: option(argv, 'target'), pr,
      requiredChecks: option(argv, 'checks').split(','), workflow: option(argv, 'workflow'),
      recovery: argv.includes('--recovery'), detached: argv.includes('--detached'),
      changeClass });
    out(canonicalJson(plan)); return 0;
  }
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedStableFile(option(argv, 'plan'), 64000, 'user-cleanup-plan')));
  out(canonicalJson(applyUserCleanup(plan, { cwd: root, authorization: option(argv, 'authorize'), stopped: argv.includes('--stopped') })));
  return 0;
}

/**
 * Stale-ref sweep: produce a bounded retirement plan for lane refs that are
 * (a) merged into canonical, (b) past a staleness window, and (c) not mounted
 * in any active worktree. This is operator consent (providerAuthority:false);
 * it does not delete refs — it projects them to recoverable quarantine.
 *
 * Usage: cleanup-user sweep --stale-older-than=<days> [--merged] [--no-active-worktree]
 *
 * The sweep is observation-only: it lists candidates and produces per-lane
 * quarantine plans. Each plan still requires explicit --authorize digest and
 * --stopped to apply, same as individual cleanup-user plan/apply.
 */
const SWEEP_SCHEMA = 'agentic-os/user-cleanup-sweep/v1';
function runUserCleanupSweep(root, argv, out = console.log) {
  const staleDays = Number(option(argv, 'stale-older-than') ?? '0');
  const requireMerged = argv.includes('--merged');
  const requireNoActiveWorktree = argv.includes('--no-active-worktree');
  if (!Number.isSafeInteger(staleDays) || staleDays < 0) refuse('stale-days-invalid');
  const current = policy(root, MODE);
  const canonical = current.canonical;
  const branches = observeGitLines(['for-each-ref', '--format=%(refname:short)',
    'refs/heads/agent', '--count=257'], { cwd: root });
  if (branches.length > 256) refuse('lane-inventory-over-budget');
  const activeWorktrees = new Set(worktrees(root).map((w) => w.branch).filter(Boolean));
  const staleThreshold = staleDays > 0 ? Date.now() - staleDays * 86400000 : 0;
  const candidates = [];
  for (const branch of branches) {
    const head = read(root, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], { allowFail: true });
    if (!head) continue;
    const merged = requireMerged ? read(root, ['merge-base', '--is-ancestor', head, canonical], { allowFail: true }) !== null : true;
    if (requireMerged && !merged) continue;
    const commitTime = Number(read(root, ['show', '-s', '--format=%ct', head], { allowFail: true }) ?? '0') * 1000;
    const stale = staleDays > 0 ? commitTime < staleThreshold : true;
    if (!stale) continue;
    const mounted = activeWorktrees.has(branch);
    if (requireNoActiveWorktree && mounted) continue;
    candidates.push({ branch, head, merged, stale, mounted, commitTime: new Date(commitTime).toISOString() });
  }
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
