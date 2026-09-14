/** Lazy provider method proof. The caller authenticates the predecessor and provider event. */
import { canonicalJson, governanceDigest, validateRepositoryProfile } from '../src/governance.mjs';
import { providerPolicy, readIntegrationMethodChoice } from '../src/lane-state.mjs';

const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const MAX_COMMITS = 32;
function fail(message) { throw new TypeError(`integration method: ${message}`); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
async function committedProfile(api, target, choice, canonicalRef) {
  const response = await api.call('GET', `${target.path}/contents/.agentic-os.json?ref=${choice.baseRevision}`);
  const file = api.exact(response, [200], 'committed integration profile');
  if (file?.type !== 'file' || file.path !== '.agentic-os.json' || file.encoding !== 'base64'
    || typeof file.content !== 'string' || file.content.length > 65_536)
    fail('committed profile is unavailable or exceeds budget');
  let profile;
  try { profile = validateRepositoryProfile(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))); }
  catch { fail('committed profile is invalid'); }
  const policy = providerPolicy(profile);
  if (profile.repository !== target.repository || profile.profileDigest !== choice.profileDigest
    || profile.canonical.localRef !== canonicalRef || profile.adapters.provider?.id !== 'github'
    || !policy.squashPreferredRequired)
    fail('choice does not match the protected base profile; strict profiles retain their policy');
  if (policy.mergeQueueRequired && choice.method !== 'squash') fail('selected queue requires squash');
  const classic = await api.call('GET', `${target.path}/branches/${encodeURIComponent(canonicalRef.slice(11))}/protection`);
  if (classic.status !== 404 && api.exact(classic, [200], 'integration classic protection')
    ?.required_linear_history?.enabled !== false) fail('classic linear-history policy is incompatible or unobserved');
}
async function commit(api, target, revision) {
  if (!OID.test(revision ?? '')) fail('invalid commit revision');
  const response = await api.call('GET', `${target.path}/git/commits/${revision}`);
  const value = api.exact(response, [200], 'integration method commit');
  if (value?.sha !== revision || !Array.isArray(value.parents) || value.parents.length !== 1
    || !OID.test(value.parents[0]?.sha ?? '') || !OID.test(value.tree?.sha ?? '')
    || typeof value.message !== 'string' || Buffer.byteLength(value.message) > 65_536
    || typeof value.author?.name !== 'string' || typeof value.author?.email !== 'string'
    || !Number.isFinite(Date.parse(value.author?.date)))
    fail('commit chain is incomplete or non-linear');
  return { revision, parent: value.parents[0].sha, tree: value.tree.sha,
    author: value.author, message: value.message };
}
async function rebaseChain(api, target, choice, mergedCommit) {
  if (mergedCommit.parents.length !== 1) fail('rebase result is not linear');
  let source = choice.headRevision, result = mergedCommit.revision;
  const pairs = [], sources = new Set(), results = new Set(), started = Date.now();
  while (source !== choice.baseRevision || result !== choice.baseRevision) {
    if (pairs.length >= MAX_COMMITS || Date.now() - started > 30_000)
      fail('rebase chain exceeds 32 commits or the 30-second observation budget');
    if (source === choice.baseRevision || result === choice.baseRevision || source === result
      || sources.has(source) || results.has(result)) fail('rebase chain is stale, cyclic or has unequal length');
    sources.add(source); results.add(result);
    const [before, after] = await Promise.all([commit(api, target, source), commit(api, target, result)]);
    if (Date.now() - started > 30_000) fail('rebase chain exceeds the 30-second observation budget');
    if (before.tree !== after.tree || !same(before.author, after.author) || before.message !== after.message)
      fail('rebase changed commit content, order, author or message');
    if (pairs.length === 0 && (after.tree !== mergedCommit.tree
      || after.parent !== mergedCommit.parents[0])) fail('merge commit observation changed');
    pairs.push({ sourceRevision: source, integratedRevision: result, treeRevision: before.tree });
    source = before.parent; result = after.parent;
  }
  if (pairs.length === 0) fail('rebase requires at least one rewritten commit');
  return { basis: 'preauthorized-choice-and-exact-linear-commit-sequence',
    baseRevision: choice.baseRevision, commitCount: pairs.length,
    commitPairs: pairs.reverse() };
}
export async function observeIntegrationMethod({ api, target, input, candidate, mergedCommit,
  allowedMethods, activeRuleTypes = [], canonicalRef, retrospective = false }) {
  const choice = readIntegrationMethodChoice(
    input.predecessorIssuance?.storedBundle?.authorityBundle?.request?.dependentWork ?? []);
  const twoParents = mergedCommit.parents.length === 2 && mergedCommit.parents[1] === candidate.headRevision;
  if (choice === null) {
    if (twoParents && allowedMethods.includes('merge')) return { method: 'merge' };
    if (mergedCommit.parents.length === 1 && allowedMethods.includes('squash')
      && !allowedMethods.includes('rebase')) return { method: 'squash' };
    fail('protection leaves an ambiguous method; a pre-integration revision-bound choice is required');
  }
  if (retrospective || choice.repository !== target.repository
    || choice.headRevision !== candidate.headRevision || choice.baseRevision !== candidate.canonicalRevision
    || !allowedMethods.includes(choice.method)) fail('choice is retrospective, stale, foreign or forbidden');
  if (activeRuleTypes.includes('required_linear_history')) fail('linear-history protection conflicts with merge backup');
  await committedProfile(api, target, choice, canonicalRef);
  if (choice.method === 'merge' && (!twoParents || mergedCommit.parents[0] !== choice.baseRevision))
    fail('merge backup does not match the chosen head and base');
  if (choice.method === 'squash') {
    if (mergedCommit.parents.length !== 1 || mergedCommit.parents[0] !== choice.baseRevision)
      fail('squash does not match the chosen protected base');
    const source = await api.commit(target, choice.headRevision);
    if (source.tree !== mergedCommit.tree) fail('squash content differs from the chosen source');
  }
  const sequence = choice.method === 'rebase' ? await rebaseChain(api, target, choice, mergedCommit) : null;
  const evidence = { choice, choiceDigest: governanceDigest(choice), ...(sequence ? { sequence } : {}) };
  return { method: choice.method, integrationMethodEvidence: evidence };
}
