/** Explicit operator recovery policy; never provider authority or a merge-method choice. */
import { canonicalJson } from '../src/governance.mjs';
import { loadRepositoryTrust, observeRepositoryProfileAtRef } from '../src/git-repository.mjs';
import { exactTreeProjectionProof, reviewedEquivalentTransitionProof, successorIntegrationProof } from '../src/patch-identity.mjs';
export const refuse = reason => { throw Object.assign(new Error(`blocked-user-cleanup-${reason}`), { reason }); };

export const RECOVERY_MODE = 'explicit-local-user-consent-recovery';
export const RECOVERY_LIMITS = Object.freeze({
  projectionByteCeiling: 4 * 1024 ** 3, projectionEntryCeiling: 250000,
  registrationByteCeiling: 16 * 1024 ** 2, registrationEntryCeiling: 20000,
  sharedStateByteCeiling: 20 * 1024 ** 3, sharedStateEntryCeiling: 500000,
});

export function recoveryPolicy(root, repository) {
  const trust = loadRepositoryTrust(root);
  const { profile } = observeRepositoryProfileAtRef({ repository: root, ref: 'refs/heads/main' });
  if (!profile || profile.repository !== `github.com/${repository}`
    || trust.repository !== profile.repository
    || canonicalJson(trust.canonical) !== canonicalJson(profile.canonical)
    || profile.canonical.localRef !== 'refs/heads/main'
    || profile.canonical.remoteRef !== 'refs/remotes/origin/main'
    || profile.adapters.repository?.id !== 'git' || profile.adapters.repository.version !== '1'
    || profile.adapters.provider?.id !== 'github' || profile.adapters.provider.version !== '1'
    || !profile.requiredChecks.length) refuse('recovery-profile-binding');
  return { repositoryProfileDigest: profile.profileDigest, requiredChecks: profile.requiredChecks,
    protectedCleanupPolicy: profile.cleanup, limits: RECOVERY_LIMITS };
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

/** Select complete successful runs of the named workflow, before the observed merge. */
export function recoveryChecks(value, pull, runs, read) {
  const cache = new Map(), merged = Date.parse(pull.merged_at);
  return value.requiredChecks.map(name => {
    const candidates = runs.filter(c => c.name === name && c.head_sha === pull.head.sha
      && c.app?.slug === 'github-actions' && c.app?.id === 15368)
      .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at) || b.id - a.id);
    const matching = [];
    for (const c of candidates) {
      if (!Number.isSafeInteger(c.id) || c.id < 1) refuse('check-locator');
      const prefix = `https://github.com/${value.repository}/actions/runs/`;
      const match = (c.details_url?.startsWith(prefix) ? c.details_url.slice(prefix.length) : '')
        .match(/^(\d+)\/job\/(\d+)$/u);
      if (!match || Number(match[2]) !== c.id || !Number.isSafeInteger(Number(match[1]))) refuse('check-locator');
      const runId = Number(match[1]);
      if (!cache.has(runId)) cache.set(runId, read(`repos/${value.repository}/actions/runs/${runId}`));
      const run = cache.get(runId);
      if (run?.path !== value.workflow) continue;
      if (run.id !== runId || run.head_sha !== pull.head.sha || run.head_branch !== pull.head.ref
        || run.repository?.full_name !== value.repository || run.head_repository?.full_name !== value.repository
        || run.event !== 'pull_request' || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1)
        refuse('check-run-binding');
      const completed = Date.parse(c.completed_at);
      if (!Number.isFinite(completed) || completed > merged) continue;
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
}
