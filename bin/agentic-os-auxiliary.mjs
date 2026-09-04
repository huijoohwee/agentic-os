/** Bounded evidence, request-construction, and protected-maintenance CLI commands. */

import { isAbsolute, relative, resolve } from 'node:path';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { classifyWriteSet, collectWriteSet } from '../src/autonomy-class.mjs';
import {
  applyCanonicalSync, CANONICAL_SYNC_LIMITS, planCanonicalSync,
} from '../src/canonical-sync.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { classifyCanonicalReconciliation } from '../src/canonical-resources.mjs';
import {
  configuredRemote, fetch as gitFetch, gitLines, headSha, observeGit,
  worktreeCleanupRisks, worktrees,
} from '../src/git.mjs';
import {
  observeRepositoryProfileAtRef,
  observeRepository,
  loadRepositoryTrust,
  REPOSITORY_PROFILE_FILENAME,
} from '../src/git-repository.mjs';
import { canonicalJson, governance, OPERATIONS } from '../src/governance.mjs';
import { isLaneRef, parseLaneRef } from '../src/lane-id.mjs';
import { integrationProof, sourceHeadTrailer } from '../src/patch-identity.mjs';
import * as queue from '../src/queue.mjs';
import { laneBranchSummary, staleWorktrees } from '../src/worktree.mjs';
import { providerAdapterRequired } from '../src/lane-state.mjs';
import { hookDoctorEntries } from './agentic-os-hooks.mjs';
import * as report from './agentic-os-report.mjs';

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
export function assertPublicationPreflight(root, expectedHead = null, expectedRequirements = undefined) {
  const requirements = assertFlightRequirements(root, 'pre', expectedRequirements);
  const before = headSha('HEAD', root);
  const risks = publicationByteRisks(root);
  const after = headSha('HEAD', root);
  assertFlightRequirements(root, 'in', requirements);
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
      integrationReceiptDigest: option(argv, 'integration-receipt'),
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

export function runReconcile(root, argv, policy) {
  const [action = 'plan'] = positional(argv);
  if (action === 'apply') return runCanonicalSync(root, argv, policy);
  const remoteName = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
  if (!remoteName) throw new TypeError('repository profile remote-tracking ref has no remote name');
  gitFetch(configuredRemote(remoteName, root), root);
  const diagnosis = classifyCanonicalReconciliation({
    cwd: root, branch: policy.protectedBranch, targetRef: policy.protectedRef,
    scope: option(argv, 'scope'),
  });
  if (diagnosis.status === 'synced') {
    out(JSON.stringify(diagnosis, null, 2));
    return 0;
  }
  const integrationReceiptDigest = option(argv, 'integration-receipt');
  if (diagnosis.status === 'behind-fast-forwardable'
      || diagnosis.status === 'squash-integrated-divergence' && integrationReceiptDigest) {
    out(JSON.stringify(planCanonicalSync({
      cwd: root, branch: policy.protectedBranch, targetRef: policy.protectedRef,
      integrationReceiptDigest,
    }), null, 2));
    return 0;
  }
  out(JSON.stringify(diagnosis, null, 2));
  return 2;
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

// Flight reports are observations, never authority or authenticated runtime verdicts.
export const FLIGHT_SCHEMA = 'agentic-os/flight-observation/v1';
const FLIGHT_FILE = '.agentic-os-flight.json', FLIGHT_BYTES = 65_536;
const flightHash = (value) => createHash('sha256').update(value).digest('hex');
const flightFail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
function flightPathPresent(file) {
  try { lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
const flightText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 240
  && !/[\u0000-\u001f\u007f]/u.test(value);
function flightJson(file) {
  return JSON.parse(UTF8.decode(readBoundedFile(resolve(file), FLIGHT_BYTES, 'flight input')));
}
function flightRequirements(root, profile, file = null, ref = profile.canonical.localRef) {
  let bytes;
  if (file) bytes = readBoundedFile(resolve(file), FLIGHT_BYTES, 'flight requirements');
  else {
    const revision = headSha(ref, root);
    if (!revision) flightFail('blocked-flight-canonical-missing');
    const entry = observeGit(['ls-tree', '-z', revision, '--', FLIGHT_FILE], { cwd: root });
    if (!entry) return null;
    const match = entry.match(/^100644 blob ([0-9a-f]{40,64})\t\.agentic-os-flight\.json\0$/u);
    if (!match) flightFail('blocked-flight-manifest-kind');
    const size = Number(observeGit(['cat-file', '-s', match[1]], { cwd: root }));
    if (!Number.isSafeInteger(size) || size > FLIGHT_BYTES) flightFail('blocked-flight-manifest-budget');
    bytes = observeGit(['cat-file', 'blob', match[1]], { cwd: root, binary: true, maxBuffer: FLIGHT_BYTES });
  }
  const value = JSON.parse(UTF8.decode(bytes));
  if (!exactFields(value, 'schema,maxAgeSeconds,requirements')
    || value.schema !== 'agentic-os/flight-requirements/v1'
    || !Number.isSafeInteger(value.maxAgeSeconds) || value.maxAgeSeconds < 1 || value.maxAgeSeconds > 3600
    || !Array.isArray(value.requirements) || value.requirements.length > 32
    || canonicalJson(value) + '\n' !== UTF8.decode(bytes)) flightFail('blocked-flight-manifest-invalid');
  const ids = new Set();
  for (const item of value.requirements) {
    if (!exactFields(item, 'id,owner,kind,input,sha256,expiresAt,phases,remedy')
      || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(item.id) || ids.has(item.id)
      || !flightText(item.owner) || !flightText(item.remedy)
      || typeof item.input !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(item.input)
      || !['environment', 'evidence'].includes(item.kind)
      || !Array.isArray(item.phases) || item.phases.length < 1 || item.phases.length > 3
      || new Set(item.phases).size !== item.phases.length
      || item.phases.some((phase) => !['pre', 'in', 'post'].includes(phase)))
      flightFail('blocked-flight-requirement-invalid');
    if (item.kind === 'environment' ? item.sha256 !== null || item.expiresAt !== null
      : typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(item.sha256)
        || typeof item.expiresAt !== 'string' || !Number.isFinite(Date.parse(item.expiresAt))
        || new Date(item.expiresAt).toISOString() !== item.expiresAt)
      flightFail('blocked-flight-evidence-pin-invalid');
    ids.add(item.id);
  }
  return { ...value, digest: flightHash(bytes) };
}
function flightInputs(root, requirements, phase, now) {
  const roots = worktrees(root).map((entry) => resolve(entry.path));
  return requirements.requirements.filter((item) => item.phases.includes(phase)).map((item) => {
    const value = process.env[item.input];
    let code = typeof value === 'string' && value.trim().length > 0 ? null : 'input-missing';
    if (!code && item.kind === 'evidence') {
      try {
        const file = realpathSync(value);
        if (!isAbsolute(value) || roots.some((rootPath) => {
          const tail = relative(rootPath, file);
          return tail === '' || tail !== '..' && !tail.startsWith('../') && !isAbsolute(tail);
        })) code = 'evidence-location-invalid';
        else if (Date.parse(item.expiresAt) <= now) code = 'evidence-expired';
        else if (flightHash(readBoundedFile(value, 131_072, 'public flight evidence', { expectedPath: file }))
          !== item.sha256) code = 'evidence-digest-mismatch';
      } catch { code = 'evidence-unavailable'; }
    }
    return { id: item.id, owner: item.owner, input: item.input, satisfied: code === null, code,
      remedy: code === null ? null : item.remedy };
  });
}
/** Enrolled prerequisites are read from the trusted canonical commit, not candidate bytes. */
export function assertFlightRequirements(root, phase, expected = undefined) {
  const { profile } = trustedRepositoryProfile(root);
  let requirements;
  try {
    requirements = flightRequirements(root, profile);
    if (headSha(profile.canonical.remoteRef, root)) {
      const remote = flightRequirements(root, profile, null, profile.canonical.remoteRef);
      if ((remote?.digest ?? null) !== (requirements?.digest ?? null))
        flightFail('blocked-flight-requirements-stale');
    }
  }
  catch (error) { flightFail(error.reason ?? 'blocked-flight-manifest-invalid'); }
  if (expected !== undefined && (expected?.digest ?? null) !== (requirements?.digest ?? null))
    flightFail('blocked-flight-requirements-drift');
  if (requirements) {
    const missing = flightInputs(root, requirements, phase, Date.now()).filter((item) => !item.satisfied);
    if (missing.length) throw Object.assign(new Error(JSON.stringify(missing)), {
      reason: 'blocked-flight-prerequisites',
    });
  }
  return requirements;
}
export function observeFlight(root, argv, profile) {
  const [phase] = positional(argv), now = Date.now(), findings = [];
  const add = (code, owner, remedy) => findings.push({ code, owner, remedy });
  const file = option(argv, 'requirements'), requirements = flightRequirements(root, profile, file);
  if (!requirements) flightFail('blocked-flight-requirements-unconfigured');
  const ref = option(argv, 'ref') ?? observeGit(['branch', '--show-current'], { cwd: root });
  if (!isLaneRef(ref)) flightFail('blocked-flight-lane-required');
  const sourceRef = `refs/heads/${ref}`, head = headSha(sourceRef, root);
  if (!head) flightFail('blocked-flight-source-missing');
  const before = worktrees(root), entry = before.find((item) => item.branch === ref);
  const canonicalPath = before.find((item) => `refs/heads/${item.branch}` === profile.canonical.localRef)?.path;
  const source = { repository: profile.repository, ref, head,
    tree: observeGit(['rev-parse', `${head}^{tree}`], { cwd: root }),
    canonicalPath, profileDigest: profile.profileDigest, requirementsDigest: requirements.digest };
  const base = headSha(profile.canonical.remoteRef, root);
  const local = headSha(profile.canonical.localRef, root);
  const inputs = flightInputs(root, requirements, phase, now);
  inputs.filter((item) => !item.satisfied).forEach((item) => add(item.code, item.owner, item.remedy));
  let checkpoint = null;
  if (phase !== 'pre') {
    checkpoint = flightJson(option(argv, 'checkpoint'));
    const { digest, ...payload } = checkpoint;
    if (!exactFields(checkpoint, 'schema,phase,observedAt,observationOnly,authorizesEffects,ok,source,base,worktreePath,inputs,completion,findings,digest')
      || digest !== flightHash(canonicalJson(payload)) || checkpoint.schema !== FLIGHT_SCHEMA
      || !['pre', 'in'].includes(checkpoint.phase) || checkpoint.ok !== true
      || checkpoint.observationOnly !== true || checkpoint.authorizesEffects !== false)
      flightFail('blocked-flight-checkpoint-invalid');
    const age = now - Date.parse(checkpoint.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > requirements.maxAgeSeconds * 1000)
      add('checkpoint-expired', 'orchestrator', 'Capture a fresh pre-flight observation.');
    if (canonicalJson(source) !== canonicalJson(checkpoint.source)
      || phase === 'in' && base !== checkpoint.base
      || entry && entry.path !== checkpoint.worktreePath)
      add('checkpoint-drift', 'orchestrator', 'Revalidate the changed candidate, profile, or requirements.');
  }
  if (phase !== 'post' && !entry) add('worktree-missing', 'lane-owner', 'Restore the registered lane.');
  if (entry && (!existsSync(entry.path) || headSha('HEAD', entry.path) !== head
    || publicationByteRisks(entry.path).blocked))
    add('candidate-byte-risk', 'lane-owner', 'Preserve changes and check the committed candidate again.');
  if (!base || !canonicalPath) add('canonical-unavailable', 'repository-owner', 'Restore canonical identity.');
  if (phase !== 'post' && base !== local)
    add('canonical-drift', 'repository-owner', 'Reconcile the canonical checkout before recording a checkpoint.');
  const completion = phase !== 'post' ? null : {
    integration: base ? integrationProof(base, head, { cwd: root }) : null,
    worktreeAbsent: !entry && typeof checkpoint.worktreePath === 'string'
      && !flightPathPresent(checkpoint.worktreePath),
    canonicalSynchronized: Boolean(base && base === local),
    canonicalClean: Boolean(canonicalPath && headSha('HEAD', canonicalPath) === local
      && !publicationByteRisks(canonicalPath).blocked),
    authorityRetirementVerified: false, runtimeEvidenceVerified: false,
  };
  if (completion) {
    for (const [key, code, remedy] of [
      ['integration', 'integration-unproved', 'Complete protected integration and refresh the canonical remote ref.'],
      ['worktreeAbsent', 'cleanup-pending', 'Use the authorized finish/cleanup command for this lane.'],
      ['canonicalSynchronized', 'canonical-sync-pending', 'Fast-forward a clean canonical checkout.'],
      ['canonicalClean', 'canonical-byte-risk', 'Preserve authored canonical bytes before synchronization.'],
    ]) if (!completion[key]) add(code, 'repository-owner', remedy);
  }
  if (headSha(sourceRef, root) !== head || headSha(profile.canonical.remoteRef, root) !== base
    || headSha(profile.canonical.localRef, root) !== local
    || entry && (headSha('HEAD', entry.path) !== head || publicationByteRisks(entry.path).blocked)
    || completion?.canonicalClean && publicationByteRisks(canonicalPath).blocked
    || canonicalJson(worktrees(root)) !== canonicalJson(before)
    || flightRequirements(root, profile, file)?.digest !== requirements.digest
    || canonicalJson(flightInputs(root, requirements, phase, Date.now())) !== canonicalJson(inputs))
    add('observation-drift', 'orchestrator', 'Repeat observation after concurrent changes settle.');
  const payload = { schema: FLIGHT_SCHEMA, phase, observedAt: new Date(now).toISOString(),
    observationOnly: true, authorizesEffects: false, ok: findings.length === 0,
    source, base, worktreePath: entry?.path ?? checkpoint?.worktreePath ?? null, inputs, completion, findings };
  return { ...payload, digest: flightHash(canonicalJson(payload)) };
}
export function runFlight(root, argv, profile) {
  try {
    const observed = observeFlight(root, argv, profile);
    out(JSON.stringify(observed, null, 2));
    return observed.ok ? 0 : 1;
  } catch (error) {
    out(JSON.stringify({ schema: FLIGHT_SCHEMA, ok: false, observationOnly: true,
      authorizesEffects: false, code: error.reason ?? 'blocked-flight-input-invalid' }));
    return 1;
  }
}

export function cmdDoctor(root, profile, policy) {
  let prerequisiteFailures = 0;
  try { assertFlightRequirements(root, 'pre'); } catch (error) {
    prerequisiteFailures = 1;
    err(`${error.reason ?? 'blocked-flight-input-invalid'}: ${error.message}`);
  }
  const configEntries = hookDoctorEntries(root);
  const local = observeLocalHealth(root, policy, profile);
  out(report.formatConfig(configEntries));
  out('');
  out(report.formatLocal(local));
  out('');
  const kind = providerKind(profile);
  const observed = kind === 'github'
    ? queue.observe({ cwd: root, profile }) : null;
  const providerRequired = providerAdapterRequired(policy);
  const findings = kind === 'github' ? queue.audit(observed, profile) : [{
    id: 'provider-adapter', ok: kind === 'none' && !providerRequired,
    detail: kind === 'none' ? providerRequired
      ? 'selected capabilities require a provider adapter' : 'no provider selected'
      : 'selected provider adapter is unsupported',
    remedy: kind === 'none' && !providerRequired ? null : 'select a supported provider adapter',
  }];
  out(report.formatFindings('remote configuration', findings));
  const failures =
    prerequisiteFailures + configEntries.filter((entry) => !entry.ok).length +
    findings.filter((finding) => !finding.ok).length +
    (local.canonicalDirty ? 1 : 0) +
    (local.relation === 'equal' ? 0 : 1) +
    (local.staleWorktrees.length > 0 ? 1 : 0);
  out(''); out(report.formatDoctorConclusion(failures, local.canonicalCleanlinessDeferred));
  return failures === 0 ? 0 : 1;
}
