/** Exact opt-in branch retirement. One ref effect per short-lived plan and receipt. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, governanceDigest, validateRepositoryProfile } from './governance.mjs';
import { commonDir, configuredRemote, git, headSha, observeGit, remoteRefSha,
  remoteTransport, worktreeInventory, acquireOperationLock, finishOperationLock } from './git.mjs';
import { bindProfileToRemote, gh } from './github-provider.mjs';
import { repositoryIdentity } from './github-rest.mjs';
import { assertPrivateDirectoryIdentity, privateDirectoryIdentity, readPrivateFile,
  writePrivateFileExclusive } from './file-integrity.mjs';

export const BRANCH_RETIREMENT_PLAN_SCHEMA = 'agentic-os/branch-retirement-plan/v1';
export const BRANCH_RETIREMENT_RECEIPT_SCHEMA = 'agentic-os/branch-retirement-receipt/v1';
export const BRANCH_RETIREMENT_TTL_MS = 15 * 60 * 1000;
const EFFECTS = Object.freeze(['remote-branch', 'local-branch', 'remote-tracking-ref']);
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u, DIGEST = /^[0-9a-f]{64}$/u;
const MAX_BYTES = 64_000, validMergedAt = value => Number.isSafeInteger(Date.parse(value)) && ((iso) => value === iso || value === iso.replace('.000Z', 'Z'))(new Date(Date.parse(value)).toISOString());
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    fail('blocked-branch-retirement-record', `${label} fields are invalid`);
}
function refName(branch, cwd) {
  if (typeof branch !== 'string' || branch.length > 255 || branch.includes('\0')
    || observeGit(['check-ref-format', `refs/heads/${branch}`], { cwd, allowFail: true }) === null)
    fail('blocked-branch-retirement-ref', 'branch must be one exact valid Git branch name');
  return branch;
}
function timeValue(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('branch retirement clock is invalid');
  return value;
}
function policyFor(profile, effect) {
  const field = effect === 'remote-branch' ? 'remoteBranch'
    : effect === 'local-branch' ? 'localBranch' : 'remoteTrackingRef';
  if (!EFFECTS.includes(effect)) fail('blocked-branch-retirement-effect', 'unsupported branch retirement effect');
  if (!profile.branchRetirement || profile.branchRetirement[field] !== (effect === 'remote-tracking-ref'
    ? 'prune-absent' : 'retire-merged'))
    fail('blocked-branch-retirement-policy', `repository profile does not opt in to ${effect}`);
  if (!profile.capabilities.includes('governed-branch-retirement'))
    fail('blocked-branch-retirement-capability', 'repository profile lacks governed-branch-retirement');
}
function identity(profile, cwd) {
  if (profile.adapters.repository.id !== 'git' || profile.adapters.repository.version !== '1'
    || profile.adapters.provider?.id !== 'github' || profile.adapters.provider.version !== '1')
    fail('blocked-branch-retirement-adapter', 'branch retirement requires Git v1 and GitHub v1 adapters');
  const match = profile.canonical.remoteRef.match(/^refs\/remotes\/([^/]+)\/(.+)$/u);
  if (!match) fail('blocked-branch-retirement-profile', 'canonical remote ref is invalid');
  const remote = configuredRemote(match[1], cwd), transport = remoteTransport(remote, cwd);
  const canonicalBranch = profile.canonical.localRef.slice('refs/heads/'.length);
  const remoteCanonical = remoteRefSha(remote, canonicalBranch, cwd, transport.fetchUrl);
  const localCanonical = headSha(profile.canonical.localRef, cwd);
  if (!SHA.test(localCanonical ?? '') || localCanonical !== remoteCanonical)
    fail('blocked-branch-retirement-canonical-drift', 'local canonical head must equal the live protected remote head');
  return { remote, transport, canonicalBranch,
    canonical: { localRef: profile.canonical.localRef, localOid: localCanonical,
      remoteRef: profile.canonical.remoteRef, remoteOid: remoteCanonical,
      transportDigest: transport.urlDigest } };
}
function storedState(cwd) {
  const basePath = join(commonDir(cwd), 'agentic-os');
  let base;
  try { base = privateDirectoryIdentity(basePath, 'Agentic OS private state'); }
  catch { fail('blocked-branch-retirement-storage', 'Agentic OS private state must exist with mode 0700'); }
  const ensure = (path) => {
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return privateDirectoryIdentity(path, 'branch retirement directory');
  };
  const root = ensure(join(basePath, 'branch-retirement'));
  const plans = ensure(join(root.path, 'plans'));
  const receipts = ensure(join(root.path, 'receipts'));
  assertPrivateDirectoryIdentity(base, 'Agentic OS private state');
  assertPrivateDirectoryIdentity(root, 'branch retirement directory');
  return { base, root, plans, receipts };
}
function readStored(path, digest, parent, label) {
  if (!DIGEST.test(digest ?? '')) fail('blocked-branch-retirement-plan', `${label} digest is invalid`);
  const bytes = readPrivateFile(path, MAX_BYTES, label, parent);
  const value = JSON.parse(bytes.toString('utf8'));
  if (!Buffer.from(canonicalJson(value)).equals(bytes)) fail('blocked-branch-retirement-record', `${label} is not canonical JSON`);
  return value;
}
function pullShape(row, repository) {
  if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.number) || row.number < 1
    || !['OPEN', 'CLOSED', 'MERGED'].includes(row.state) || !SHA.test(row.headSha ?? '')
    || typeof row.headBranch !== 'string' || typeof row.baseBranch !== 'string'
    || row.headRepository !== repository || row.baseRepository !== repository
    || row.state === 'MERGED' && (typeof row.mergedAt !== 'string' || !validMergedAt(row.mergedAt))
    || row.state !== 'MERGED' && row.mergedAt !== null)
    fail('blocked-branch-retirement-provider', 'GitHub returned incomplete or cross-repository pull-request evidence');
  return { number: row.number, state: row.state, headSha: row.headSha,
    headBranch: row.headBranch, baseBranch: row.baseBranch,
    headRepository: row.headRepository, baseRepository: row.baseRepository, mergedAt: row.mergedAt };
}
function mergedPull(provider, profile, branch, expectedOid, canonicalBranch, selectedPr) {
  if (!provider || provider.id !== 'github' || typeof provider.observePullRequests !== 'function')
    fail('blocked-branch-retirement-provider', 'a current GitHub pull-request adapter is required');
  const result = provider.observePullRequests({ repository: profile.repository, branch });
  if (!result || result.complete !== true || !Array.isArray(result.pullRequests)
    || result.pullRequests.length >= 100 || !Number.isSafeInteger(result.observedAt))
    fail('blocked-branch-retirement-provider', 'GitHub pull-request observation is unavailable or incomplete');
  const rows = result.pullRequests.map((row) => pullShape(row, profile.repository))
    .sort((left, right) => left.number - right.number);
  if (new Set(rows.map((row) => row.number)).size !== rows.length)
    fail('blocked-branch-retirement-provider', 'GitHub pull-request observation contains duplicate identities');
  if (rows.some((row) => row.headBranch === branch && row.state === 'OPEN'))
    fail('blocked-branch-retirement-open-pr', 'an open pull request still uses this exact source branch');
  const candidates = rows.filter((row) => row.state === 'MERGED' && row.headBranch === branch
    && row.headSha === expectedOid && row.baseBranch === canonicalBranch);
  const selected = selectedPr === null ? candidates : candidates.filter((row) => row.number === selectedPr);
  if (selected.length !== 1)
    fail('blocked-branch-retirement-merged-pr', 'one exact same-repository merged pull request must match the branch head and canonical base');
  return { pullRequest: selected[0], observationDigest: governanceDigest(rows), observedAt: result.observedAt };
}
function branchProtection(provider, branch) {
  if (typeof provider?.observeBranchProtection !== 'function')
    fail('blocked-branch-retirement-provider', 'GitHub branch protection observation is unavailable');
  const protectedRef = provider.observeBranchProtection({ branch });
  if (typeof protectedRef !== 'boolean')
    fail('blocked-branch-retirement-protection-unknown', 'branch protection state is unknown');
  if (protectedRef) fail('blocked-branch-retirement-protected', 'protected remote branches are retained');
  return false;
}
function targetObservation({ effect, branch, selectedPr }, { cwd, profile, provider }) {
  const repo = identity(profile, cwd), protectedTarget = branch === repo.canonicalBranch;
  if (protectedTarget) fail('blocked-branch-retirement-protected', 'canonical branch refs are retained');
  const branchRef = `refs/heads/${branch}`;
  const trackingRef = `refs/remotes/${repo.remote}/${branch}`;
  const targetRef = effect === 'remote-tracking-ref' ? trackingRef : branchRef;
  const symbolicTarget = observeGit(['symbolic-ref', '--quiet', targetRef], { cwd, allowFail: true });
  if (symbolicTarget !== null) fail('blocked-branch-retirement-symbolic-ref', 'symbolic branch refs are retained');
  const activeWorktree = worktreeInventory(cwd).some((row) => row.branch === branch);
  if (activeWorktree) fail('blocked-branch-retirement-active-worktree', 'branch is checked out in an active worktree');
  let expectedOid, liveRemoteOid = null, pullRequest = null, providerObservationDigest = null,
    providerObservedAt = null, protection = null;
  if (effect === 'remote-branch') {
    liveRemoteOid = remoteRefSha(repo.remote, branch, cwd, repo.transport.fetchUrl);
    if (!SHA.test(liveRemoteOid ?? '')) fail('blocked-branch-retirement-remote-missing', 'live remote branch is absent');
    expectedOid = liveRemoteOid;
    const proof = mergedPull(provider, profile, branch, expectedOid, repo.canonicalBranch, selectedPr);
    pullRequest = proof.pullRequest; providerObservationDigest = proof.observationDigest; providerObservedAt = proof.observedAt;
    protection = branchProtection(provider, branch);
  } else if (effect === 'local-branch') {
    expectedOid = headSha(targetRef, cwd);
    if (!SHA.test(expectedOid ?? '')) fail('blocked-branch-retirement-local-missing', 'local branch is absent');
    const proof = mergedPull(provider, profile, branch, expectedOid, repo.canonicalBranch, selectedPr);
    pullRequest = proof.pullRequest; providerObservationDigest = proof.observationDigest; providerObservedAt = proof.observedAt;
  } else {
    expectedOid = headSha(targetRef, cwd);
    if (!SHA.test(expectedOid ?? '')) fail('blocked-branch-retirement-tracking-missing', 'exact remote-tracking ref is absent');
    liveRemoteOid = remoteRefSha(repo.remote, branch, cwd, repo.transport.fetchUrl);
    if (liveRemoteOid !== null) fail('blocked-branch-retirement-remote-present', 'remote branch still exists; tracking ref must be retained');
  }
  if (effect !== 'remote-tracking-ref' && expectedOid !== pullRequest.headSha)
    fail('blocked-branch-retirement-head-drift', 'branch tip does not match the merged pull-request head');
  return { ...repo, branch, effect, targetRef, expectedOid, liveRemoteOid,
    pullRequest, providerObservationDigest, providerObservedAt, protection, activeWorktree };
}
function targetBinding(observation) {
  return { effect: observation.effect, branch: observation.branch, targetRef: observation.targetRef,
    expectedOid: observation.expectedOid, liveRemoteOid: observation.liveRemoteOid,
    canonical: observation.canonical, transportDigest: observation.transport.urlDigest,
    pullRequest: observation.pullRequest, providerObservationDigest: observation.providerObservationDigest,
    protection: observation.protection, activeWorktree: observation.activeWorktree };
}
function digestRecord(record, field) {
  const { [field]: omitted, ...payload } = record;
  return governanceDigest(payload);
}
function persist(path, value, parent, label) {
  const bytes = Buffer.from(canonicalJson(value));
  try { writePrivateFileExclusive(path, bytes, { maxBytes: MAX_BYTES, label }); }
  catch (error) {
    const current = readPrivateFile(path, MAX_BYTES, label, parent);
    if (!current.equals(bytes)) throw error;
  }
  assertPrivateDirectoryIdentity(parent, `${label} directory`);
}
export function planBranchRetirement(input, options) {
  const cwd = options?.cwd, profile = validateRepositoryProfile(options?.profile);
  if (typeof cwd !== 'string' || !options?.now || typeof options.now !== 'function')
    throw new TypeError('branch retirement planning requires a repository and clock');
  const effect = input?.effect, branch = refName(input?.branch, cwd), selectedPr = input?.pr ?? null;
  policyFor(profile, effect);
  if (selectedPr !== null && (!Number.isSafeInteger(selectedPr) || selectedPr < 1))
    fail('blocked-branch-retirement-pr', 'pull-request number must be a positive integer');
  const observation = targetObservation({ effect, branch, selectedPr }, { cwd, profile, provider: options.provider });
  const issuedAt = timeValue(options.now), body = {
    schema: BRANCH_RETIREMENT_PLAN_SCHEMA, repository: profile.repository,
    profileDigest: profile.profileDigest, providerAdapter: profile.adapters.provider, providerObservedAt: observation.providerObservedAt, ...targetBinding(observation), issuedAt,
    expiresAt: issuedAt + BRANCH_RETIREMENT_TTL_MS,
  };
  const plan = Object.freeze({ ...body, planDigest: governanceDigest(body) });
  const state = storedState(cwd), path = join(state.plans.path, `${plan.planDigest}.json`);
  persist(path, plan, state.plans, 'branch retirement plan');
  return Object.freeze({ ...plan, planPath: path });
}
function storedPlan(planDigest, state) {
  const path = join(state.plans.path, `${planDigest}.json`);
  const plan = readStored(path, planDigest, state.plans, 'branch retirement plan');
  exact(plan, ['schema', 'repository', 'profileDigest', 'providerAdapter', 'providerObservedAt', 'effect', 'branch', 'targetRef', 'expectedOid',
    'liveRemoteOid', 'canonical', 'transportDigest', 'pullRequest', 'providerObservationDigest',
    'protection', 'activeWorktree', 'issuedAt', 'expiresAt', 'planDigest'], 'branch retirement plan');
  if (plan.schema !== BRANCH_RETIREMENT_PLAN_SCHEMA || plan.planDigest !== planDigest
    || digestRecord(plan, 'planDigest') !== planDigest || !EFFECTS.includes(plan.effect)
    || !SHA.test(plan.expectedOid ?? '') || !Number.isSafeInteger(plan.issuedAt)
    || plan.providerAdapter?.id !== 'github' || plan.providerAdapter.version !== '1' || (plan.effect === 'remote-tracking-ref' ? plan.providerObservedAt !== null : !Number.isSafeInteger(plan.providerObservedAt) || plan.providerObservedAt > plan.issuedAt)
    || !Number.isSafeInteger(plan.expiresAt) || plan.expiresAt - plan.issuedAt !== BRANCH_RETIREMENT_TTL_MS)
    fail('blocked-branch-retirement-plan', 'stored branch retirement plan is invalid');
  return plan;
}
function receiptIfPresent(planDigest, state) {
  const path = join(state.receipts.path, `${planDigest}.json`);
  try {
    const receipt = readStored(path, planDigest, state.receipts, 'branch retirement receipt');
    if (receipt.schema !== BRANCH_RETIREMENT_RECEIPT_SCHEMA || receipt.planDigest !== planDigest
      || digestRecord(receipt, 'receiptDigest') !== receipt.receiptDigest)
      fail('blocked-branch-retirement-receipt', 'stored branch retirement receipt is invalid');
    return receipt;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function applyRef(plan, cwd, observation, options) {
  if (plan.effect === 'remote-branch') {
    const fresh = targetObservation({ effect: plan.effect, branch: plan.branch,
      selectedPr: plan.pullRequest.number }, options);
    if (fresh.providerObservedAt < plan.issuedAt || fresh.providerObservedAt > timeValue(options.now) || fresh.providerObservedAt >= plan.expiresAt || canonicalJson(targetBinding(fresh)) !== canonicalJson(targetBinding(observation)))
      fail('blocked-branch-retirement-drift', 'remote branch evidence changed immediately before deletion');
    const { remote, transport } = observation;
    const current = remoteRefSha(remote, plan.branch, cwd, transport.fetchUrl);
    if (current !== plan.expectedOid) fail('blocked-branch-retirement-remote-race', 'remote branch changed before compare-and-delete');
    let pushCompleted = false, remoteAfter = null, reobservationExact = false;
    try {
      git(['push', `--force-with-lease=${plan.targetRef}:${plan.expectedOid}`,
        '--delete', '--', transport.fetchUrl, plan.branch], { cwd });
      pushCompleted = true;
    } catch { /* exact reobservation below resolves the write outcome when possible */ }
    try {
      remoteAfter = remoteRefSha(remote, plan.branch, cwd, transport.fetchUrl);
      reobservationExact = true;
    } catch { /* preserve an unknown result receipt; do not retry this plan */ }
    return { writeCompleted: pushCompleted, writeResultUnknown: !reobservationExact,
      targetRefAfterOid: remoteAfter, targetRefAbsentAfter: reobservationExact && remoteAfter === null, providerObservedAt: fresh.providerObservedAt };
  }
  if (plan.effect === 'local-branch'
    && worktreeInventory(cwd).some((row) => row.branch === plan.branch))
    fail('blocked-branch-retirement-active-worktree', 'branch became active in a worktree before compare-and-delete');
  if (plan.effect === 'remote-tracking-ref'
    && remoteRefSha(observation.remote, plan.branch, cwd, observation.transport.fetchUrl) !== null)
    fail('blocked-branch-retirement-remote-present', 'remote branch was recreated before tracking-ref pruning');
  const current = headSha(plan.targetRef, cwd);
  if (current !== plan.expectedOid) fail('blocked-branch-retirement-local-race', 'local ref changed before compare-and-delete');
  let writeCompleted = false;
  try { git(['update-ref', '-d', plan.targetRef, plan.expectedOid], { cwd }); writeCompleted = true; }
  catch { /* exact reobservation below records a race without deleting a replacement ref */ }
  let targetRefAfterOid = null, reobservationExact = false;
  try { targetRefAfterOid = headSha(plan.targetRef, cwd); reobservationExact = true; }
  catch { /* retain an unknown result receipt */ }
  return { writeCompleted, writeResultUnknown: !reobservationExact, targetRefAfterOid,
    targetRefAbsentAfter: reobservationExact && targetRefAfterOid === null, providerObservedAt: observation.providerObservedAt };
}
function applyBranchRetirementUnlocked(input, options) {
  const cwd = options?.cwd, profile = validateRepositoryProfile(options?.profile);
  if (typeof cwd !== 'string' || !options?.now || typeof options.now !== 'function')
    throw new TypeError('branch retirement apply requires a repository and clock');
  const planDigest = input?.planDigest, authorization = input?.authorization;
  if (!DIGEST.test(planDigest ?? '') || authorization !== `agentic-os:branch-retirement:${planDigest}`)
    fail('blocked-branch-retirement-authorization', 'apply requires the exact branch retirement plan authorization');
  const state = storedState(cwd), prior = receiptIfPresent(planDigest, state);
  if (prior) return prior;
  const plan = storedPlan(planDigest, state);
  if (profile.repository !== plan.repository || profile.profileDigest !== plan.profileDigest || canonicalJson(profile.adapters.provider) !== canonicalJson(plan.providerAdapter))
    fail('blocked-branch-retirement-profile-drift', 'repository profile changed after planning');
  policyFor(profile, plan.effect);
  const observed = targetObservation({ effect: plan.effect, branch: plan.branch,
    selectedPr: plan.pullRequest?.number ?? null }, { cwd, profile, provider: options.provider }), now = timeValue(options.now), observedTimeValid = observed.providerObservedAt === null || (observed.providerObservedAt >= plan.issuedAt && observed.providerObservedAt <= now);
  if (now < plan.issuedAt || now >= plan.expiresAt || !observedTimeValid)
    fail('blocked-branch-retirement-expired', 'branch retirement plan is outside its 15-minute validity window');
  if (canonicalJson(targetBinding(observed)) !== canonicalJson(Object.fromEntries(
    Object.entries(plan).filter(([key]) => ['effect', 'branch', 'targetRef', 'expectedOid',
      'liveRemoteOid', 'canonical', 'transportDigest', 'pullRequest', 'providerObservationDigest',
      'protection', 'activeWorktree'].includes(key)))))
    fail('blocked-branch-retirement-drift', 'branch, provider, profile, or worktree evidence changed after planning');
  const result = applyRef(plan, cwd, observed, options), completedAt = timeValue(options.now);
  const body = { schema: BRANCH_RETIREMENT_RECEIPT_SCHEMA, repository: profile.repository,
    profileDigest: profile.profileDigest, planDigest, effect: plan.effect, branch: plan.branch,
    targetRef: plan.targetRef, originalOid: plan.expectedOid, canonical: plan.canonical, providerAdapter: plan.providerAdapter, providerObservedAt: plan.providerObservedAt,
    pullRequest: plan.pullRequest, providerObservationDigest: plan.providerObservationDigest,
    applyObservedAt: result.providerObservedAt ?? observed.providerObservedAt ?? now, completedAt, deleteAttempted: true,
    writeCompleted: result.writeCompleted, writeResultUnknown: result.writeResultUnknown,
    targetRefAfterOid: result.targetRefAfterOid,
    targetRefAbsentAfter: result.targetRefAbsentAfter,
    objectsPruned: false, reflogsPruned: false,
    result: result.writeResultUnknown ? 'unknown'
      : result.targetRefAbsentAfter ? result.writeCompleted ? 'retired' : 'absent-observed'
        : 'retained' };
  const receipt = Object.freeze({ ...body, receiptDigest: governanceDigest(body) });
  persist(join(state.receipts.path, `${planDigest}.json`), receipt, state.receipts, 'branch retirement receipt');
  return receipt;
}
export function applyBranchRetirement(input, options) {
  const cwd = options?.cwd, lock = acquireOperationLock('agentic-os-branch-retirement', cwd);
  if (!lock) fail('blocked-branch-retirement-busy', 'another branch retirement operation is in progress');
  let result, error;
  try { result = applyBranchRetirementUnlocked(input, options); }
  catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'branch retirement', result, error,
    artifacts: error?.operationArtifacts ?? null });
}
export function createGitHubBranchRetirementProvider(profile, cwd) {
  const identity = bindProfileToRemote(profile, cwd), target = repositoryIdentity(profile.repository);
  if (!target || identity.name !== target.name || identity.host !== target.host)
    fail('blocked-branch-retirement-provider-identity', 'GitHub provider does not match the configured repository');
  const api = (path) => {
    const result = gh(['api', path, '--hostname', target.host], { cwd });
    if (result === null) fail('blocked-branch-retirement-provider', 'GitHub API read failed');
    return result;
  };
  return Object.freeze({ id: 'github',
    observePullRequests({ branch }) {
      const owner = target.name.split('/')[0], head = encodeURIComponent(`${owner}:${branch}`);
      const rows = api(`repos/${target.name}/pulls?state=all&head=${head}&per_page=100`);
      if (!Array.isArray(rows)) fail('blocked-branch-retirement-provider', 'GitHub pull-request response is invalid');
      const pullRequests = rows.map((row) => ({ number: row?.number,
        state: row?.merged_at ? 'MERGED' : row?.state === 'open' ? 'OPEN' : row?.state === 'closed' ? 'CLOSED' : null,
        headSha: row?.head?.sha, headBranch: row?.head?.ref, baseBranch: row?.base?.ref,
        headRepository: row?.head?.repo?.full_name ?? null,
        baseRepository: row?.base?.repo?.full_name ?? null, mergedAt: row?.merged_at ?? null }));
      return { complete: rows.length < 100, pullRequests, observedAt: Date.now() };
    },
    observeBranchProtection({ branch }) {
      const pathBranch = branch.split('/').map(encodeURIComponent).join('/');
      const row = api(`repos/${target.name}/branches/${pathBranch}`);
      return typeof row?.protected === 'boolean' ? row.protected : null;
    },
  });
}
export function runBranchRetirement(root, profile, argv, out = line => process.stdout.write(`${line}\n`)) {
  const [action, ...args] = argv, values = new Map();
  if ((action === 'help' || action === '--help' || action === '-h') && args.length === 0) {
    out('branch-retirement plan --effect=<remote-branch|local-branch|remote-tracking-ref> --branch=<exact-name> [--pr=<number>]');
    out('branch-retirement apply --plan=<sha256> --authorize=agentic-os:branch-retirement:<sha256>');
    return 0;
  }
  for (const item of args) {
    const match = item.match(/^--([a-z-]+)=(.*)$/u);
    if (!match || values.has(match[1])) fail('blocked-branch-retirement-arguments', 'branch retirement options must be unique --key=value arguments');
    values.set(match[1], match[2]);
  }
  const now = Date.now, provider = createGitHubBranchRetirementProvider(profile, root);
  if (action === 'plan') {
    if ([...values.keys()].some((key) => !['effect', 'branch', 'pr'].includes(key))
      || !values.has('effect') || !values.has('branch'))
      fail('blocked-branch-retirement-arguments', 'usage: branch-retirement plan --effect=<remote-branch|local-branch|remote-tracking-ref> --branch=<exact-name> [--pr=<number>]');
    const plan = planBranchRetirement({ effect: values.get('effect'), branch: values.get('branch'),
      pr: values.has('pr') ? Number(values.get('pr')) : null }, { cwd: root, profile, provider, now });
    out(canonicalJson(plan)); return 0;
  }
  if (action === 'apply') {
    if ([...values.keys()].some((key) => !['plan', 'authorize'].includes(key))
      || values.size !== 2 || !DIGEST.test(values.get('plan') ?? '')
      || values.get('authorize') !== `agentic-os:branch-retirement:${values.get('plan')}`)
      fail('blocked-branch-retirement-arguments', 'usage: branch-retirement apply --plan=<sha256> --authorize=agentic-os:branch-retirement:<sha256>');
    const receipt = applyBranchRetirement({ planDigest: values.get('plan'),
      authorization: values.get('authorize') }, { cwd: root, profile, provider, now });
    out(canonicalJson(receipt)); return receipt.targetRefAbsentAfter ? 0 : 1;
  }
  fail('blocked-branch-retirement-arguments', 'branch-retirement requires plan or apply');
}
