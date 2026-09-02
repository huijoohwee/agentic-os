/** Bounded evidence, request-construction, and protected-maintenance CLI commands. */

import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { classifyWriteSet, collectWriteSet } from '../src/autonomy-class.mjs';
import {
  applyCanonicalSync, CANONICAL_SYNC_LIMITS, planCanonicalSync,
} from '../src/canonical-sync.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { gitLines, headSha, observeGit, worktreeCleanupRisks, worktrees } from '../src/git.mjs';
import {
  observeRepositoryProfileAtRef,
  observeRepository,
  loadRepositoryTrust,
  REPOSITORY_PROFILE_FILENAME,
} from '../src/git-repository.mjs';
import { governance, OPERATIONS } from '../src/governance.mjs';
import { isLaneRef, parseLaneRef } from '../src/lane-id.mjs';
import { sourceHeadTrailer } from '../src/patch-identity.mjs';
import * as queue from '../src/queue.mjs';
import { laneBranchSummary, staleWorktrees } from '../src/worktree.mjs';

const MAX_REQUEST_INPUT_BYTES = 500_000;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);
const flag = (argv, name) => argv.includes(`--${name}`);
const option = (argv, name, fallback = null) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const positional = (argv) => argv.filter((arg) => !arg.startsWith('--'));

export function providerKind(profile) {
  const selected = profile?.adapters.provider;
  if (selected === null || selected === undefined) return 'none';
  return selected.id === 'github' && selected.version === '1' ? 'github' : 'unsupported';
}

export function repositoryKind(profile) {
  const selected = profile?.adapters.repository;
  return !selected || selected.id === 'git' && selected.version === '1' ? 'git' : 'unsupported';
}

export function trustedRepositoryProfile(root, { allowUnanchored = false } = {}) {
  const trust = loadRepositoryTrust(root, {
    required: false, allowLegacyUnanchored: allowUnanchored,
  });
  if (trust) {
    const observation = observeRepositoryProfileAtRef({
      repository: root, ref: trust.canonical.localRef,
    });
    const profile = observation.profile;
    if (!profile || profile.repository !== trust.repository
      || JSON.stringify(profile.canonical) !== JSON.stringify(trust.canonical)) {
      const error = new Error('anchored canonical profile identity does not match committed bytes');
      error.reason = 'blocked-repository-trust-conflict';
      throw error;
    }
    return { ...observation, trust };
  }
  if (!allowUnanchored) return loadRepositoryTrust(root);
  const primary = worktrees(root)[0];
  if (!primary?.branch || primary.detached || isLaneRef(primary.branch))
    throw new TypeError('primary canonical worktree identity is unavailable');
  const observation = observeRepositoryProfileAtRef({
    repository: primary.path, ref: `refs/heads/${primary.branch}`,
  });
  const { profile } = observation;
  if (profile && profile.canonical.localRef !== `refs/heads/${primary.branch}`)
    throw new TypeError('committed profile does not bind the primary canonical branch');
  return { ...observation, trust: null };
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
  const observed = profile ? observeRepository({ repository: root, profile, mode: 'structural' }) : null;
  const projection = observed?.projections.find((entry) => entry.path === canonical);
  const localSha = headSha(`refs/heads/${policy.protectedBranch}`, canonical);
  const remoteTrackingSha = headSha(policy.protectedRef, canonical);
  const counts = localSha && remoteTrackingSha
    ? observeGit(['rev-list', '--left-right', '--count', `${localSha}...${remoteTrackingSha}`], {
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
    ...(projection.hiddenPaths ?? []),
    ...(projection.trackedByteDriftPaths ?? []),
  ])] : exact.tracked;
  const branches = laneBranchSummary(root);
  const canonicalDirty = projection ? projection.dirtyTracked
      || projection.hiddenPaths.length > 0
    : exact.dirtyTracked || exact.hidden.length > 0 || exact.tracked.length > 0;
  return {
    canonicalDirty,
    canonicalCleanlinessDeferred: projection?.operationallyClean === null,
    hiddenPaths: projection?.hiddenPaths ?? exact.hidden,
    trackedRiskPaths: tracked,
    ownedPaths: projection?.ownedPaths ?? exact.owned,
    ownedPathCount: projection?.ownedPathCount ?? exact.owned.length,
    protectedBranch: policy.protectedBranch, protectedRef: policy.protectedRef,
    localSha, remoteTrackingSha, relation, ahead, behind,
    staleWorktrees: staleWorktrees(root).map((entry) => entry.path),
    worktreeCount: entries.length, laneBranches: branches.count,
    laneBranchesTruncated: branches.truncated,
  };
}

/** Exact local byte/index risks that must block publication before any fetch. */
export function publicationByteRisks(root) {
  const observed = worktreeCleanupRisks(root, { includeIgnored: false });
  const paths = [...new Set([...observed.hidden, ...observed.owned, ...observed.tracked])];
  return { blocked: observed.dirtyTracked || paths.length > 0, paths };
}

/** Bind one clean lane HEAD before and after a local publication inspection. */
export function assertPublicationPreflight(root, expectedHead = null) {
  const before = headSha('HEAD', root);
  const risks = publicationByteRisks(root);
  const after = headSha('HEAD', root);
  if (!before || after !== before || expectedHead !== null && after !== expectedHead)
    throw Object.assign(new Error('lane HEAD moved during publication preflight'), {
      reason: 'blocked-lane-head-moved-before-publish',
    });
  if (risks.blocked) throw Object.assign(new Error(
    `preserve ${risks.paths.length} exact path(s) and tracked state`,
  ), { reason: 'blocked-publish-byte-risk', paths: risks.paths });
  return before;
}

export function classifyPromotion(root, baseRevision, head = 'HEAD') {
  return classifyWriteSet(collectWriteSet({
    repository: root, base: baseRevision, head,
  }));
}

/** Provider review text correlates one exact source head; it is not integration proof. */
export function pullRequestText(root, ref, laneHeadSha, baseSha) {
  const subjects = gitLines(['log', '--format=%s', `${baseSha}..${laneHeadSha}`, '--reverse'], {
    cwd: root,
  });
  const scope = parseLaneRef(ref)?.scope ?? ref;
  const title = subjects.length === 1 ? subjects[0] : `${scope}: ${subjects.length} commits`;
  const body = [
    ...(subjects.length > 1 ? subjects.map((subject) => `- ${subject}`) : []),
    ...(subjects.length > 1 ? [''] : []),
    `Lane: ${ref}`,
    `Base-Revision: ${baseSha}`,
    sourceHeadTrailer(laneHeadSha),
  ].join('\n');
  return { title, body };
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
    const bytes = readBoundedFile(resolve(planPath), CANONICAL_SYNC_LIMITS.serializedPlanBytes,
      'canonical sync plan');
    let text;
    try { text = UTF8.decode(bytes); } catch {
      throw new TypeError('canonical sync plan must be UTF-8');
    }
    const plan = JSON.parse(text);
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
  const providerRequested = flag(argv, 'provider');
  const selectedProvider = profile.adapters.provider;
  if (providerRequested && selectedProvider === null) {
    err('blocked-provider-adapter-unselected: --provider requires an explicit adapter');
    return 1;
  }
  if (providerRequested && (selectedProvider.id !== 'github' || selectedProvider.version !== '1')) {
    err('blocked-provider-adapter-unsupported: no observation adapter matches the profile');
    return 1;
  }
  const repository = observeRepository({
    repository: root, profile, mode: flag(argv, 'deep') ? 'deep' : 'shallow',
  });
  const provider = providerRequested ? queue.observe({ cwd: root, profile }) : null;
  out(JSON.stringify({
    schema: 'agentic-os/operational-observation/v1',
    profileDigest: profile.profileDigest,
    repository,
    provider,
  }, null, 2));
  return provider && queue.providerBlockingReasons(provider, queue.providerPolicy(profile)).length > 0
    ? 1 : 0;
}

export function runRequest(argv) {
  const [operation] = positional(argv);
  const inputPath = option(argv, 'input');
  if (!OPERATIONS.includes(operation) || !inputPath) {
    err('usage: agentic-os request <claim|continue|integrate|retire> --input=<json>');
    return 1;
  }
  const input = readBoundedFile(
    resolve(inputPath), MAX_REQUEST_INPUT_BYTES, 'request input',
  );
  let text;
  try { text = UTF8.decode(input); } catch {
    throw new TypeError('request input must be UTF-8');
  }
  const request = governance[operation](JSON.parse(text));
  out(JSON.stringify(request, null, 2));
  return 0;
}
