import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from './governance.mjs';
import { parseGitHubRepositoryIdentity } from './github-authority.mjs';
import { validateGitHubAuthorityIssuance, validateGitHubStoredAuthorityBundle }
  from './github-authority-issuer.mjs';
import { effectPlanByteDigest, validateEffectPlanBytes } from './completion.mjs';
import { projectGitHubTargetRepository, projectGitHubTargetReview, verifyGitHubAuthorityIssuanceLive } from './github-authority-operation.mjs';
export const GITHUB_AUTHORITY_READ_ADAPTER = Object.freeze({ id: 'github-rest-authority-read', version: '1' });
export const GITHUB_AUTHORITY_RUN_NAME_PREFIX = 'ADLC authority ';
export const GITHUB_AUTHORITY_LIVE_VERIFICATION_SCHEMA = 'agentic-os/github-authority-live-verification/v1';
const MAX_RESPONSE_BYTES = 256 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u, ID = /^[1-9][0-9]{0,18}$/u;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})?$/u;
const REF_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value; }
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`);
  return value;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be a full Git object ID`);
  return value; }
function identifier(value, label) {
  const result = String(value); if (!ID.test(result)) fail(`${label} must be a positive identifier`);
  return result;
}
function instant(value, label) {
  const parsed = Date.parse(text(value, label));
  if (!Number.isFinite(parsed)) fail(`${label} must be a UTC instant`);
  return new Date(parsed).toISOString(); }
function actor(value, label) {
  const source = object(value, label), login = text(source.login, `${label}.login`).toLowerCase();
  if (!LOGIN.test(login)) fail(`${label}.login is invalid`);
  return { id: identifier(source.id, `${label}.id`), login };
}
function repository(value) {
  const parsed = parseGitHubRepositoryIdentity(value);
  return { ...parsed, path: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}` };
}
function shortRef(value, label) {
  const prefix = 'refs/heads/', raw = text(value, label);
  const parts = raw.startsWith(prefix) ? raw.slice(prefix.length).split('/') : [];
  if (!parts.length || parts.some((part) => !REF_PART.test(part)
    || part.endsWith('.') || part.endsWith('.lock'))) fail(`${label} must be a portable branch ref`);
  return parts.join('/');
}
function branch(value, label) { return `refs/heads/${shortRef(value, label)}`; }
function relative(value, label) {
  const result = text(value, label), parts = result.split('/');
  if (result.startsWith('/') || result.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} is invalid`);
  return result; }
function encodedPath(value) { return relative(value, 'GitHub path').split('/').map(encodeURIComponent).join('/'); }
function base64(value) {
  if (typeof value !== 'string' || /[^A-Za-z0-9+/=\r\n]/u.test(value)) fail('GitHub content is not base64');
  const source = value.replaceAll('\r', '').replaceAll('\n', ''), bytes = Buffer.from(source, 'base64');
  if (bytes.length > MAX_RESPONSE_BYTES || bytes.toString('base64') !== source) fail('GitHub content exceeds bounds');
  return bytes; }
function jsonBytes(bytes, label, project = (value) => value) {
  try { return snap(project(JSON.parse(UTF8.decode(bytes)))); } catch { fail(`${label} must be bounded UTF-8 JSON`); } }
async function body(response) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^(?:0|[1-9][0-9]*)$/u.test(length)
    || Number(length) > MAX_RESPONSE_BYTES)) fail('GitHub response exceeds bounds');
  if (!response.body || typeof response.body.getReader !== 'function') fail('GitHub response body is unavailable');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      const chunk = Buffer.from(next.value); total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) fail('GitHub response exceeds bounds');
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
function apiOrigin(value) {
  let parsed; try { parsed = new URL(value); } catch { fail('GitHub API origin is invalid'); }
  if (parsed.origin !== 'https://api.github.com' || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash) fail('GitHub API origin must be one exact HTTPS origin');
  return parsed.origin;
}
function rule(value) {
  const source = object(value, 'GitHub rule'), type = text(source.type, 'GitHub rule type');
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(type)) fail('GitHub rule type is invalid');
  const parameters = Object.hasOwn(source, 'parameters') ? source.parameters
    : type === 'update' ? { update_allows_fetch_and_merge: false } : null;
  if (parameters !== null && (!parameters || typeof parameters !== 'object'
    || Array.isArray(parameters))) fail('GitHub rule parameters are invalid');
  return { type, parameters };
}
function bypass(value) {
  const source = object(value, 'GitHub bypass actor');
  return `${text(source.actor_type, 'bypass actor type')}:${identifier(source.actor_id,
    'bypass actor id')}:${text(source.bypass_mode, 'bypass mode')}`;
}
export function deriveGitHubAuthorityRunName({ authorityInputDigest, workflowRevision }) {
  if (!/^[0-9a-f]{64}$/u.test(authorityInputDigest ?? '')) fail('authorityInputDigest is invalid');
  return `${GITHUB_AUTHORITY_RUN_NAME_PREFIX}${authorityInputDigest} @ ${sha(
    workflowRevision, 'workflowRevision')}`;
}
export function createGitHubAuthorityReadProvider({ issuance: issuanceValue, token,
  fetchImpl = globalThis.fetch, apiOrigin: originValue = 'https://api.github.com',
  timeoutMs = 15_000 }) {
  const issuance = validateGitHubAuthorityIssuance(issuanceValue);
  const stored = issuance.storedBundle, bundle = stored.authorityBundle;
  const expectedRun = bundle.workflowRun, expectedCandidate = bundle.candidate;
  const origin = apiOrigin(originValue), secret = text(token, 'GitHub token');
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 60_000) fail('GitHub read provider options are invalid');
  const request = async (path, { absent = false, withLink = false, project } = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response; try { response = await fetchImpl(new URL(path, origin).href, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${secret}`,
          'x-github-api-version': '2022-11-28' },
      }); } catch { fail('GitHub API read failed'); }
      if (!response || !Number.isInteger(response.status) || response.redirected
        || response.status >= 300 && response.status < 400) fail('GitHub API response is invalid');
      const bytes = await body(response);
      if (absent && response.status === 404) return null;
      if (response.status !== 200) fail(`GitHub API read failed with HTTP ${response.status}`);
      const value = jsonBytes(bytes, 'GitHub API response', project);
      return withLink ? { value, link: response.headers?.get?.('link') ?? null } : value;
    } finally { clearTimeout(timer); }
  };
  const content = async (repo, path, revision, { absent = false } = {}) => {
    const value = await request(`${repo.path}/contents/${encodedPath(path)}?ref=${encodeURIComponent(revision)}`,
      { absent });
    if (value === null) return null;
    if (value.type !== 'file' || value.encoding !== 'base64') fail('GitHub content is not a file');
    return { value: jsonBytes(base64(value.content), 'GitHub content'),
      sha: sha(value.sha, 'GitHub content SHA') };
  };
  const gitRef = async (repo, value, { absent = false } = {}) => {
    const checked = branch(value, 'GitHub ref');
    const result = await request(`${repo.path}/git/ref/heads/${encodeURIComponent(shortRef(checked,
      'GitHub ref'))}`, { absent });
    if (result === null) return null;
    if (result.ref !== checked || result.object?.type !== 'commit') fail('GitHub ref is not exact');
    return sha(result.object.sha, 'GitHub ref SHA');
  };
  const commit = async (repo, revision, oneParent = false) => {
    const value = object(await request(`${repo.path}/git/commits/${sha(revision,
      'GitHub commit revision')}`), 'GitHub commit');
    if (value.sha !== revision || !Array.isArray(value.parents)
      || oneParent && value.parents.length !== 1) fail('GitHub commit is not exact');
    const parents = value.parents.map((entry) => sha(entry?.sha, 'GitHub parent SHA'));
    return { revision, parents, tree: sha(value.tree?.sha, 'GitHub tree SHA'),
      committedAt: instant(value.committer?.date, 'GitHub commit time') };
  };
  const tree = async (repo, revision) => {
    const value = object(await request(`${repo.path}/git/trees/${sha(revision,
      'GitHub tree revision')}?recursive=1`), 'GitHub tree');
    if (value.sha !== revision || value.truncated !== false || !Array.isArray(value.tree))
      fail('GitHub tree is not exact and complete');
    const entries = new Map();
    for (const item of value.tree) {
      const path = relative(item?.path, 'GitHub tree path');
      const descriptor = { mode: text(item.mode, 'GitHub tree mode'),
        type: text(item.type, 'GitHub tree type'), sha: sha(item.sha, 'GitHub tree entry SHA') };
      if (!['blob', 'commit', 'tree'].includes(descriptor.type) || entries.has(path))
        fail('GitHub tree has invalid or duplicate entries');
      entries.set(path, descriptor);
    }
    return entries;
  };
  const requireEvidence = (value) => {
    const repo = repository(value);
    if (repo.repository !== bundle.policy.evidenceRepository) fail('evidence repository changed');
    return repo;
  };
  const readRules = async ({ repository: identity, ref }) => {
    const repo = requireEvidence(identity), checked = branch(ref, 'GitHub protection ref');
    const page = await request(`${repo.path}/rules/branches/${encodeURIComponent(shortRef(checked,
      'GitHub protection ref'))}?per_page=100`, { withLink: true });
    if (page.link && /(?:^|,)\s*<[^>]+>;\s*rel="?next"?/iu.test(page.link)
      || !Array.isArray(page.value) || page.value.length === 0) fail('GitHub rules are incomplete');
    const grouped = new Map();
    for (const item of page.value) {
      const id = identifier(item?.ruleset_id, 'GitHub ruleset id');
      grouped.set(id, [...(grouped.get(id) ?? []), rule(item)]);
    }
    const rulesets = [];
    for (const [id, observed] of grouped) {
      const detail = object(await request(`${repo.path}/rulesets/${id}?includes_parents=true`),
        'GitHub ruleset detail');
      const detailed = detail.rules?.map(rule).sort((a, b) => a.type.localeCompare(b.type));
      observed.sort((a, b) => a.type.localeCompare(b.type));
      if (String(detail.id) !== id || detail.enforcement !== 'active'
        || !Array.isArray(detailed) || !Array.isArray(detail.bypass_actors)
        || canonicalJson(observed) !== canonicalJson(detailed)) fail('GitHub ruleset detail changed');
      rulesets.push({ id, enforcement: 'active', rules: detailed,
        bypassActors: [...new Set(detail.bypass_actors.map(bypass))].sort() });
    }
    return { repository: repo.repository, ref: checked,
      rulesets: rulesets.sort((a, b) => a.id.localeCompare(b.id)) };
  };
  const storedAt = (value, repo, checked, path) => {
    const result = validateGitHubStoredAuthorityBundle(value), found = result.authorityBundle;
    if (found.policy.evidenceRepository !== repo.repository || found.evidenceRef !== checked
      || found.evidencePath !== path) fail('stored authority bundle location changed');
    return result;
  };
  const provePublication = async (repo, path, revision, expectedBlob) => {
    const published = await commit(repo, revision, true);
    if (published.parents[0] !== bundle.policy.canonicalRevision)
      fail('authority publication is not a canonical child');
    const base = await commit(repo, bundle.policy.canonicalRevision);
    const [before, after] = await Promise.all([tree(repo, base.tree), tree(repo, published.tree)]);
    const target = after.get(path);
    if (!target || target.type !== 'blob' || target.mode !== '100644'
      || target.sha !== expectedBlob) fail('authority publication blob changed');
    const allowed = new Set(path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      if (!allowed.has(key) && canonicalJson(before.get(key) ?? null)
        !== canonicalJson(after.get(key) ?? null)) fail('authority publication changed another path');
    }
    return published;
  };
  const review = async (repo, locator) => {
    if (locator === null) return null;
    let url; try { url = new URL(locator); } catch { fail('GitHub review locator is invalid'); }
    const prefix = `/${repo.owner}/${repo.name}/pull/`, number = url.pathname.slice(prefix.length);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix)
      || url.search || url.hash || !ID.test(number)) fail('GitHub review locator is invalid');
    const value = object(await request(`${repo.path}/pulls/${number}`, { project: projectGitHubTargetReview }), 'GitHub review');
    const identity = (entry) => repository(`github.com/${text(entry?.full_name, 'review repository')}`).repository;
    const state = value.merged_at === null ? value.state : 'merged';
    if (String(value.number) !== number || value.html_url !== locator
      || !['open', 'closed', 'merged'].includes(state) || typeof value.draft !== 'boolean')
      fail('GitHub review identity changed');
    return { locator, state, draft: value.draft, headRepository: identity(value.head?.repo),
      headBranch: text(value.head?.ref, 'review head branch'),
      headRevision: sha(value.head?.sha, 'review head revision'),
      baseRepository: identity(value.base?.repo), baseBranch: text(value.base?.ref,
        'review base branch'), baseRevision: sha(value.base?.sha, 'review base revision') };
  };
  return Object.freeze({
    async readRun({ repository: identity, locator }) {
      const repo = requireEvidence(identity);
      if (locator !== expectedRun.locator) fail('workflow run locator changed');
      const value = object(await request(`${repo.path}/actions/runs/${expectedRun.id}`),
        'GitHub workflow run');
      const workflowId = identifier(value.workflow_id, 'workflow id');
      const workflow = object(await request(`${repo.path}/actions/workflows/${workflowId}`),
        'GitHub workflow');
      const expectedTitle = deriveGitHubAuthorityRunName(expectedRun), bare = expectedRun.workflowPath;
      const paths = [bare, `${bare}@${shortRef(expectedRun.workflowRef, 'workflow path ref')}`, `${bare}@${expectedRun.workflowRef}`];
      if (String(value.id) !== expectedRun.id || value.url !== locator
        || value.display_title !== expectedTitle || value.event !== 'workflow_dispatch'
        || value.status !== 'completed' || value.conclusion !== 'success'
        || value.run_attempt !== 1 || value.repository?.full_name !== `${repo.owner}/${repo.name}`
        || value.head_branch !== shortRef(expectedRun.ref, 'workflow run ref')
        || value.head_sha !== expectedRun.revision || !paths.includes(value.path)
        || identifier(workflow.id, 'workflow resource id') !== workflowId
        || workflow.state !== 'active' || workflow.path !== bare)
        fail('GitHub workflow run no longer authenticates the retained dispatch');
      return { ...expectedRun, startedAt: instant(value.run_started_at, 'workflow run start'), completedAt: instant(value.updated_at, 'workflow run completion'),
        actor: actor(value.actor, 'workflow actor'),
        triggeringActor: actor(value.triggering_actor, 'workflow triggering actor') };
    },
    async readActor({ repository: identity, workflowRun }) {
      requireEvidence(identity); const expected = actor(workflowRun?.actor, 'workflow actor');
      const found = actor(await request(`/users/${encodeURIComponent(expected.login)}`), 'GitHub actor');
      if (canonicalJson(found) !== canonicalJson(expected)) fail('GitHub actor changed');
      return { ...found, subject: `github-user:${found.id}` };
    },
    readRules,
    async readCanonicalRef({ repository: identity, ref }) {
      const repo = requireEvidence(identity), checked = branch(ref, 'GitHub canonical ref');
      return { repository: repo.repository, ref: checked, revision: await gitRef(repo, checked) };
    },
    async readTargetRepository(query) {
      if (query.repository !== expectedCandidate.targetRepository
        || query.canonicalBranch !== expectedCandidate.canonicalBranch
        || query.canonicalRevision !== expectedCandidate.canonicalRevision
        || query.candidateBranch !== expectedCandidate.branch
        || query.candidateHeadRevision !== expectedCandidate.headRevision
        || query.reviewLocator !== expectedCandidate.reviewLocator) fail('target query changed');
      const repo = repository(query.repository), value = await request(repo.path, { project: projectGitHubTargetRepository });
      const [base, head, pull] = await Promise.all([
        gitRef(repo, `refs/heads/${query.canonicalBranch}`),
        gitRef(repo, `refs/heads/${query.candidateBranch}`), review(repo, query.reviewLocator),
      ]);
      if (value.full_name !== `${repo.owner}/${repo.name}` || value.owner?.type !== 'User'
        || base !== query.canonicalRevision || head !== query.candidateHeadRevision)
        fail('target repository identity changed');
      return { repository: repo.repository, repositoryId: identifier(value.id, 'target repository id'),
        owner: actor(value.owner, 'target owner'), canonicalBranch: query.canonicalBranch,
        canonicalRevision: base, candidateBranch: query.candidateBranch,
        candidateHeadRevision: head, review: pull };
    },
    async readPublication({ repository: identity, ref, path }) {
      const repo = requireEvidence(identity), checked = branch(ref, 'evidence ref');
      const cleanPath = relative(path, 'evidence path'), revision = await gitRef(repo, checked,
        { absent: true });
      if (revision === null) return null;
      const found = await content(repo, cleanPath, revision), result = storedAt(found.value,
        repo, checked, cleanPath);
      const published = await provePublication(repo, cleanPath, revision, found.sha);
      return { repository: repo.repository, ref: checked, path: cleanPath, revision,
        parentRevision: published.parents[0], committedAt: published.committedAt,
        storedDigest: result.storedDigest };
    },
    async readBundle({ repository: identity, ref, path }) {
      const repo = requireEvidence(identity), checked = branch(ref, 'evidence ref');
      const revision = await gitRef(repo, checked, { absent: true });
      if (revision === null) return null;
      const cleanPath = relative(path, 'evidence path'), found = await content(repo,
        cleanPath, revision, { absent: true });
      return found === null ? null : storedAt(found.value, repo, checked, cleanPath);
    },
  });
}
export const createGitHubAuthorityVerifierProvider = createGitHubAuthorityReadProvider;
const READ_METHODS = ['readRun', 'readActor', 'readRules', 'readCanonicalRef',
  'readTargetRepository', 'readPublication', 'readBundle'];
function observedProvider(provider, calls) {
  const result = {};
  for (const method of READ_METHODS) {
    if (typeof provider?.[method] !== 'function') fail(`GitHub authority provider.${method} is required`);
    result[method] = async (query) => {
      const value = await provider[method](query);
      calls.push({ method, query: snap(query), result: value === null ? null : snap(value) });
      return value;
    };
  }
  return Object.freeze(result);
}
function clock(options) {
  if (!options || Object.keys(options).length !== 1 || typeof options.now !== 'function') fail('live verification requires one trusted clock');
  let prior = null;
  return () => {
    const value = options.now();
    if (!Number.isSafeInteger(value) || value < 0 || prior !== null && value < prior)
      fail('live verification clock is invalid or moved backwards');
    prior = value; return value;
  };
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function spendKey(issuanceDigest, authorizationDigest, planByteDigest) {
  return governanceDigest({ schema: 'agentic-os/authority-spend-key/v1', issuanceDigest,
    authorizationDigest, planByteDigest });
}
export async function createGitHubAuthorityLiveVerificationReceipt(input, provider, options) {
  if (!input || Object.keys(input).sort().join(',') !== 'issuance,planBytes') fail('GitHub live verification input is invalid');
  const issuance = validateGitHubAuthorityIssuance(input.issuance), now = clock(options);
  const plan = validateEffectPlanBytes(input.planBytes), planByteDigest = effectPlanByteDigest(input.planBytes);
  const bundle = issuance.storedBundle.authorityBundle, request = bundle.request;
  const authorization = bundle.bootstrapAuthorization, candidate = bundle.candidate, bound = plan.authority;
  const requestBound = plan.target.repository === request.repository
    && plan.target.immutableRevision === request.immutableRevision
    && bound.requestedTransition === request.requestedTransition
    && bound.authoritySubject === request.authoritySubject && bound.ownerSubject === request.ownerSubject
    && bound.claimId === request.claimId && bound.leaseEpoch === request.leaseEpoch
    && bound.fenceRevision === request.fenceRevision && bound.writeSetDigest === request.writeSetDigest
    && bound.reviewLocator === request.reviewLocator;
  if (authorization.effectPlanDigest !== planByteDigest || !requestBound
    || plan.target.repository !== candidate.targetRepository || plan.target.resource !== candidate.branch
    || plan.candidateDigest !== candidate.candidateDigest || plan.snapshotDigest !== candidate.workingStateDigest
    || bound.predecessorDigest !== candidate.predecessorEvidenceDigest
    || plan.effectClass !== authorization.effectClass || !same(plan.allowedEffects, authorization.allowedEffects)
    || !same(plan.forbiddenEffects, authorization.forbiddenEffects)) fail('issuance does not bind the exact effect plan');
  const calls = [];
  await verifyGitHubAuthorityIssuanceLive(issuance, observedProvider(provider, calls), { now });
  const verifiedAt = new Date(now()).toISOString();
  const payload = { schema: GITHUB_AUTHORITY_LIVE_VERIFICATION_SCHEMA,
    adapter: { ...GITHUB_AUTHORITY_READ_ADAPTER }, issuanceDigest: issuance.issuanceDigest,
    requestDigest: request.requestDigest, authorizationDigest: authorization.authorizationDigest,
    planDigest: plan.planDigest, planByteDigest,
    spendKey: spendKey(issuance.issuanceDigest, authorization.authorizationDigest, planByteDigest),
    providerObservationDigest: governanceDigest({ schema: 'agentic-os/github-live-observation/v1', calls }),
    verifiedAt, expiresAt: authorization.expiresAt };
  return Object.freeze({ ...payload, receiptDigest: governanceDigest(payload) });
}
export function validateGitHubAuthorityLiveVerificationReceipt(value) {
  const source = snap(value), keys = ['schema', 'adapter', 'issuanceDigest', 'requestDigest',
    'authorizationDigest', 'planDigest', 'planByteDigest', 'spendKey', 'providerObservationDigest',
    'verifiedAt', 'expiresAt', 'receiptDigest'];
  if (Object.keys(source).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(source, key))
    || source.schema !== GITHUB_AUTHORITY_LIVE_VERIFICATION_SCHEMA
    || canonicalJson(source.adapter) !== canonicalJson(GITHUB_AUTHORITY_READ_ADAPTER)) fail('live verification receipt fields are invalid');
  for (const key of keys.filter((key) => key.endsWith('Digest') || key === 'spendKey'))
    if (!/^[0-9a-f]{64}$/u.test(source[key])) fail(`${key} must be a sha256 digest`);
  if (source.spendKey !== spendKey(source.issuanceDigest, source.authorizationDigest,
    source.planByteDigest) || Date.parse(instant(source.expiresAt, 'expiresAt'))
      <= Date.parse(instant(source.verifiedAt, 'verifiedAt'))) fail('live verification receipt semantics are invalid');
  const { receiptDigest, ...payload } = source;
  if (governanceDigest(payload) !== receiptDigest) fail('live verification receipt digest is invalid');
  return Object.freeze(source);
}
