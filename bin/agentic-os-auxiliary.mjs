/** Bounded evidence, request-construction, and protected-maintenance CLI commands. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyWriteSet, collectWriteSet } from '../src/autonomy-class.mjs';
import { applyCanonicalSync, planCanonicalSync } from '../src/canonical-sync.mjs';
import { git, headSha, worktreeCleanupRisks, worktrees } from '../src/git.mjs';
import {
  observeRepositoryProfileAtRef,
  observeRepository,
  REPOSITORY_PROFILE_FILENAME,
} from '../src/git-repository.mjs';
import { governance } from '../src/governance.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import * as queue from '../src/queue.mjs';
import { laneBranches, staleWorktrees } from '../src/worktree.mjs';

const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);
const flag = (argv, name) => argv.includes(`--${name}`);
const option = (argv, name, fallback = null) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const positional = (argv) => argv.filter((arg) => !arg.startsWith('--'));

export function trustedRepositoryProfile(root) {
  const primary = worktrees(root)[0];
  if (!primary?.branch || primary.detached || isLaneRef(primary.branch))
    throw new TypeError('primary canonical worktree identity is unavailable');
  const observation = observeRepositoryProfileAtRef({
    repository: primary.path, ref: `refs/heads/${primary.branch}`,
  });
  const { profile } = observation;
  if (profile && profile.canonical.localRef !== `refs/heads/${primary.branch}`)
    throw new TypeError('committed profile does not bind the primary canonical branch');
  return observation;
}

export function assertProfileCurrent(root, policy, profile) {
  const observed = observeRepositoryProfileAtRef({ repository: root, ref: policy.protectedRef });
  if ((observed.profile?.profileDigest ?? null) !== (profile?.profileDigest ?? null)) {
    const error = new Error('canonical and fetched repository profiles differ');
    error.reason = 'blocked-repository-profile-stale';
    throw error;
  }
  return observed.revision;
}

export function assertProtectedRefCurrent(root, ref, revision) {
  if (revision === null || headSha(ref, root) !== revision) {
    const error = new Error('protected ref moved after the trusted profile snapshot');
    error.reason = 'blocked-protected-ref-race';
    throw error;
  }
  return revision;
}

export function observeLocalHealth(root, policy, profile) {
  const entries = worktrees(root);
  const canonical = entries.find((entry) => entry.branch === policy.protectedBranch)?.path ?? root;
  const observed = profile ? observeRepository({ repository: root, profile }) : null;
  const projection = observed?.projections.find((entry) => entry.path === canonical);
  const localSha = headSha(`refs/heads/${policy.protectedBranch}`, canonical);
  const remoteTrackingSha = headSha(policy.protectedRef, canonical);
  const counts = localSha && remoteTrackingSha
    ? git(['rev-list', '--left-right', '--count', `${localSha}...${remoteTrackingSha}`], {
      cwd: canonical, allowFail: true,
    }) : null;
  const [ahead, behind] = counts?.split(/\s+/u).map(Number) ?? [null, null];
  const relation = ahead === null || behind === null || !Number.isInteger(ahead)
      || !Number.isInteger(behind) ? 'unknown'
    : ahead === 0 && behind === 0 ? 'equal'
      : ahead > 0 && behind === 0 ? 'ahead'
        : ahead === 0 && behind > 0 ? 'behind' : 'diverged';
  const exact = projection ? null : worktreeCleanupRisks(canonical);
  const tracked = projection ? [...new Set([
    ...projection.headToIndex.map((entry) => entry.path),
    ...projection.indexToWorkingTree.map((entry) => entry.path),
    ...(projection.trackedByteDriftPaths ?? []),
  ])] : exact.tracked;
  return {
    mainDirty: projection ? !projection.operationallyClean
      : exact.dirtyTracked || exact.hidden.length > 0 || exact.tracked.length > 0,
    hiddenPaths: projection?.hiddenPaths ?? exact.hidden,
    trackedRiskPaths: tracked,
    ownedPaths: projection?.ownedPaths ?? exact.owned,
    ownedPathCount: projection?.ownedPathCount ?? exact.owned.length,
    protectedBranch: policy.protectedBranch, protectedRef: policy.protectedRef,
    localSha, remoteTrackingSha, relation, ahead, behind,
    staleWorktrees: staleWorktrees(root).map((entry) => entry.path),
    worktreeCount: entries.length, laneBranches: laneBranches(root).length,
  };
}

export function classifyPromotion(root, baseRevision, head = 'HEAD') {
  return classifyWriteSet(collectWriteSet({
    repository: root, base: baseRevision, head,
  }));
}

export function runCanonicalSync(root, argv, policy) {
  const [action = 'plan'] = positional(argv);
  if (action === 'plan') {
    out(JSON.stringify(planCanonicalSync({
      cwd: root, branch: policy.protectedBranch, targetRef: policy.protectedRef,
    }), null, 2));
    return 0;
  }
  if (action === 'apply') {
    const planPath = option(argv, 'plan');
    const authorization = option(argv, 'authorize');
    const exclusive = option(argv, 'exclusive');
    if (!planPath || !authorization || !exclusive) {
      err('usage: agentic-os canonical-sync apply --plan=<file> --authorize=<plan authorization> --exclusive=<plan exclusive authorization>');
      return 1;
    }
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    if (plan.branch !== policy.protectedBranch || plan.targetRef !== policy.protectedRef) {
      err('blocked-profile-canonical-mismatch: plan does not target the active profile');
      return 1;
    }
    out(JSON.stringify(applyCanonicalSync(plan, { cwd: root, authorization, exclusive }), null, 2));
    return 0;
  }
  err(`unknown canonical-sync action "${action}". use: plan | apply`);
  return 1;
}

export function runAutonomyClass(root, argv, policy) {
  const base = option(argv, 'base', policy.protectedRef);
  const head = option(argv, 'head', 'HEAD');
  const result = classifyWriteSet(collectWriteSet({ repository: root, base, head }));
  if (flag(argv, 'json')) out(JSON.stringify({
    schema: result.schema, base, head, class: result.class, escalates: result.escalates,
    pathCount: result.paths.length, escalatingPaths: result.escalatingPaths,
  }, null, 2));
  else {
    out(`autonomy class: ${result.class} (${result.paths.length} paths, ${base}...${head})`);
    if (result.escalates) {
      out('promotion requires explicit authority because these paths control authority:');
      for (const path of result.escalatingPaths) out(`  ${path}`);
    }
  }
  return result.escalates ? 2 : 0;
}

export function runObserve(root, argv, profile) {
  if (!profile) {
    err(`blocked-repository-profile-missing: add ${REPOSITORY_PROFILE_FILENAME}`);
    return 1;
  }
  const repository = observeRepository({
    repository: root, profile, mode: flag(argv, 'deep') ? 'deep' : 'shallow',
  });
  const provider = flag(argv, 'provider') && profile.adapters.provider !== null
    ? queue.observe({ cwd: root, profile }) : null;
  out(JSON.stringify({
    schema: 'agentic-os/operational-observation/v1',
    profileDigest: profile.profileDigest,
    repository,
    provider,
  }, null, 2));
  return provider && (!provider.available || provider.observationErrors?.length > 0) ? 1 : 0;
}

export function runRequest(argv) {
  const [operation] = positional(argv);
  const inputPath = option(argv, 'input');
  if (!Object.hasOwn(governance, operation ?? '') || !inputPath) {
    err('usage: agentic-os request <claim|continue|integrate|retire> --input=<json>');
    return 1;
  }
  const request = governance[operation](JSON.parse(readFileSync(resolve(inputPath), 'utf8')));
  out(JSON.stringify(request, null, 2));
  return 0;
}
