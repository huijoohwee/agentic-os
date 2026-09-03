/** Concrete GitHub REST observation and create-only publication for transition authority. */
import { canonicalJson, governanceDigest } from './governance.mjs';
import { parseGitHubRepositoryIdentity } from './github-authority.mjs';
import { createGitHubAuthorityReadProvider } from './github-authority-client.mjs';
import { createGitHubProtectionProjection } from './github-authority-issuer.mjs';
import { observeGitHubIntegrationProof } from './github-transition-proof.mjs';
import {
  deriveGitHubTransitionRunName, validateGitHubStoredTransition,
  validateGitHubTransitionInput, validateGitHubTransitionWorkflowRun,
} from './github-transition-client.mjs';
import { GITHUB_TRANSITION_POLICY_PATH, encodeGitHubTransitionPolicy,
  validateGitHubTransitionPolicy } from './github-transition-policy.mjs';

const API = 'https://api.github.com', MAX_RESPONSE_BYTES = 4 * 1024 * 1024,
  SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u, ID = /^[1-9][0-9]{0,18}$/u;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})?$/u,
  REF_RULES = Object.freeze(['deletion', 'non_fast_forward', 'update']);
export const GITHUB_BYPASS_REDACTED = 'unobserved:provider-redacted:read-only';
function fail(message) { throw new TypeError(message); } function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value; }
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text`);
  return value;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be a full Git revision`);
  return value; }
function id(value, label) { const result = String(value);
  if (!ID.test(result)) fail(`${label} must be an identifier`); return result; }
function instant(value, label) {
  const parsed = Date.parse(text(value, label));
  if (!Number.isFinite(parsed)) fail(`${label} must be a UTC instant`);
  return new Date(parsed).toISOString();
}
function actor(value, label) {
  const source = object(value, label), login = text(source.login, `${label}.login`).toLowerCase();
  if (!LOGIN.test(login)) fail(`${label}.login is invalid`);
  return { id: id(source.id, `${label}.id`), login };
}
function repository(value) {
  const result = parseGitHubRepositoryIdentity(value, 'GitHub transition repository');
  return { ...result, path: `/repos/${encodeURIComponent(result.owner)}/${encodeURIComponent(result.name)}` };
}
function encodedPath(value) { return value.split('/').map(encodeURIComponent).join('/'); }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze); return Object.freeze(value);
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
async function bytes(response) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^(?:0|[1-9][0-9]*)$/u.test(length)
    || Number(length) > MAX_RESPONSE_BYTES)) fail('GitHub transition response exceeds bounds');
  if (!response.body || typeof response.body.getReader !== 'function')
    fail('GitHub transition response body is unavailable');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      const chunk = Buffer.from(next.value); total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) fail('GitHub transition response exceeds bounds');
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
function base64(value) {
  if (typeof value !== 'string' || /[^A-Za-z0-9+/=\r\n]/u.test(value))
    fail('transition publication content is not base64');
  const source = value.replaceAll('\r', '').replaceAll('\n', ''), result = Buffer.from(source, 'base64');
  if (result.length > MAX_RESPONSE_BYTES || result.toString('base64') !== source)
    fail('transition publication content is not canonical base64');
  return result;
}
async function committedPolicy(call, repo, expectedValue, revision) {
  const expected = validateGitHubTransitionPolicy(expectedValue);
  const content = object(exactStatus(await call('GET', `${repo.path}/contents/${
    encodedPath(GITHUB_TRANSITION_POLICY_PATH)}?ref=${sha(revision, 'policy revision')}`),
  [200], 'GitHub transition policy'), 'GitHub transition policy');
  if (content.type !== 'file' || content.encoding !== 'base64')
    fail('GitHub transition policy is not one committed file');
  const policyBytes = base64(content.content); let observed;
  try { observed = validateGitHubTransitionPolicy(JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(policyBytes))); }
  catch { fail('GitHub transition policy bytes are invalid'); }
  if (!policyBytes.equals(encodeGitHubTransitionPolicy(observed))
    || !same(observed, expected)) fail('committed GitHub transition policy changed');
  return observed;
}
function rest(token, fetchImpl, timeoutMs) {
  const secret = text(token, 'GitHub token');
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 60_000) fail('GitHub transition REST options are invalid');
  return async (method, path, { body = null, absent = false } = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try { response = await fetchImpl(new URL(path, API).href, { method, redirect: 'error',
        signal: controller.signal, headers: { accept: 'application/vnd.github+json',
          authorization: `Bearer ${secret}`, 'content-type': 'application/json',
          'x-github-api-version': '2026-03-10' },
        body: body === null ? undefined : canonicalJson(body) }); }
      catch { fail('GitHub transition REST request failed'); }
      if (!response || !Number.isInteger(response.status) || response.redirected
        || response.status >= 300 && response.status < 400)
        fail('GitHub transition REST response is invalid');
      const raw = await bytes(response);
      if (absent && response.status === 404) return { value: null, status: 404, headers: response.headers };
      let value = null;
      if (raw.length) { try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
        catch { fail('GitHub transition REST response is not UTF-8 JSON'); } }
      return { value, status: response.status, headers: response.headers };
    } finally { clearTimeout(timer); }
  };
}
function exactStatus(result, expected, label) {
  if (!expected.includes(result.status)) fail(`${label} failed with HTTP ${result.status}`);
  return result.value;
}
function rule(value) {
  const source = object(value, 'GitHub transition rule'), type = text(source.type,
    'GitHub transition rule type');
  return { type, parameters: type === 'update'
    ? source.parameters ?? { update_allows_fetch_and_merge: false }
    : source.parameters ?? null };
}
function bypass(value) {
  const source = object(value, 'GitHub transition bypass actor');
  return `${text(source.actor_type, 'bypass actor type')}:${id(source.actor_id,
    'bypass actor id')}:${text(source.bypass_mode, 'bypass mode')}`;
}
async function rulesProjection(call, repo, ref, allowRedactedBypass = false) {
  const short = ref.slice('refs/heads/'.length);
  const page = await call('GET', `${repo.path}/rules/branches/${encodeURIComponent(short)}?per_page=100`);
  const rows = exactStatus(page, [200], 'GitHub transition rules');
  if (!Array.isArray(rows) || rows.length === 0
    || page.headers?.get?.('link')?.includes('rel="next"'))
    fail('GitHub transition rules are incomplete');
  const ids = [...new Set(rows.map((entry) => id(entry?.ruleset_id, 'ruleset id')))];
  const rulesets = [], versions = [];
  for (const rulesetId of ids) {
    const detail = object(exactStatus(await call('GET',
      `${repo.path}/rulesets/${rulesetId}?includes_parents=true`),
      [200], 'GitHub transition ruleset'), 'GitHub transition ruleset');
    const rules = Array.isArray(detail.rules) ? detail.rules.map(rule) : [];
    const observed = rows.filter((entry) => String(entry?.ruleset_id) === rulesetId)
      .map(rule)
      .sort((left, right) => String(left.type).localeCompare(String(right.type)));
    const normalized = rules.sort((left, right) => String(left.type).localeCompare(String(right.type)));
    const bypassActors = Array.isArray(detail.bypass_actors)
      ? [...new Set(detail.bypass_actors.map(bypass))].sort()
      : allowRedactedBypass && !Object.hasOwn(detail, 'bypass_actors')
        ? [GITHUB_BYPASS_REDACTED] : null;
    if (String(detail.id) !== rulesetId || detail.enforcement !== 'active'
      || bypassActors === null
      || canonicalJson(observed) !== canonicalJson(normalized))
      fail('GitHub transition ruleset changed while observed');
    rulesets.push({ id: rulesetId, enforcement: 'active', rules: normalized,
      bypassActors });
    versions.push({ id: rulesetId,
      createdAt: instant(detail.created_at, 'ruleset created time'),
      updatedAt: instant(detail.updated_at, 'ruleset updated time') });
  }
  const projection = createGitHubProtectionProjection({ repository: repo.repository, ref,
    rulesets: rulesets.sort((left, right) => left.id.localeCompare(right.id)) });
  return { projection, versions: versions.sort((left, right) => left.id.localeCompare(right.id)) };
}
async function immutableProtection(call, repo, ref) {
  const observation = await rulesProjection(call, repo, ref);
  const projection = observation.projection, immutable = projection.rulesets[0];
  const update = immutable?.rules.find((entry) => entry.type === 'update');
  if (projection.rulesets.length !== 1 || immutable.bypassActors.length !== 0
    || canonicalJson(immutable.rules.map((entry) => entry.type)) !== canonicalJson(REF_RULES)
    || immutable.rules.some((entry) => entry.type !== 'update' && entry.parameters !== null)
    || canonicalJson(update?.parameters)
      !== canonicalJson({ update_allows_fetch_and_merge: false }))
    fail('transition evidence ref lacks one exact zero-bypass immutable ruleset');
  return observation;
}
async function gitRef(call, repo, ref, absent = false) {
  const short = ref.slice('refs/heads/'.length);
  const response = await call('GET', `${repo.path}/git/ref/heads/${encodeURIComponent(short)}`,
    { absent });
  if (response.value === null) return null;
  const value = object(exactStatus(response, [200], 'GitHub transition ref'), 'GitHub transition ref');
  if (value.ref !== ref || value.object?.type !== 'commit') fail('GitHub transition ref is not exact');
  return sha(value.object.sha, 'GitHub transition ref revision');
}
async function commit(call, repo, revision) {
  const value = object(exactStatus(await call('GET', `${repo.path}/git/commits/${sha(revision,
    'commit revision')}`), [200], 'GitHub transition commit'), 'GitHub transition commit');
  if (value.sha !== revision || !Array.isArray(value.parents)) fail('GitHub transition commit is not exact');
  return { revision, parents: value.parents.map((parent) => sha(parent?.sha, 'parent revision')),
    tree: sha(value.tree?.sha, 'tree revision'), committedAt: instant(value.committer?.date,
      'transition commit time') };
}
async function tree(call, repo, revision) {
  const value = object(exactStatus(await call('GET', `${repo.path}/git/trees/${sha(revision,
    'tree revision')}?recursive=1`), [200], 'GitHub transition tree'), 'GitHub transition tree');
  if (value.sha !== revision || value.truncated !== false || !Array.isArray(value.tree))
    fail('GitHub transition tree is incomplete');
  const result = new Map();
  for (const entry of value.tree) {
    const path = text(entry?.path, 'tree path');
    if (result.has(path)) fail('GitHub transition tree has duplicate paths');
    result.set(path, { mode: text(entry.mode, 'tree mode'), type: text(entry.type, 'tree type'),
      sha: sha(entry.sha, 'tree entry revision') });
  }
  return result;
}
async function publication(call, repo, coordinate, expected = null) {
  const ref = `refs/heads/adlc/authority/${coordinate}`;
  const path = `.agentic-os/authority/transitions/${coordinate}.json`;
  const revision = await gitRef(call, repo, ref, true);
  if (revision === null) return null;
  const published = await commit(call, repo, revision);
  const content = object(exactStatus(await call('GET', `${repo.path}/contents/${encodedPath(path)}?ref=${revision}`),
    [200], 'GitHub transition content'), 'GitHub transition content');
  if (content.type !== 'file' || content.encoding !== 'base64') fail('transition publication is not a file');
  let stored, storedBytes;
  try {
    storedBytes = base64(content.content);
    stored = validateGitHubStoredTransition(JSON.parse(new TextDecoder('utf-8', {
      fatal: true }).decode(storedBytes)));
  } catch { fail('transition publication bytes are invalid'); }
  if (!storedBytes.equals(Buffer.from(canonicalJson(stored), 'utf8')))
    fail('transition publication bytes are not exact canonical bytes');
  if (stored.coordinate !== coordinate || expected && canonicalJson(stored) !== canonicalJson(expected))
    fail('transition publication conflicts at the source authority coordinate');
  if (published.parents.length !== 1 || published.parents[0] !== stored.workflowRun.workflowRevision)
    fail('transition publication is not one canonical child');
  const base = await commit(call, repo, published.parents[0]);
  const [before, after] = await Promise.all([tree(call, repo, base.tree), tree(call, repo, published.tree)]);
  const target = after.get(path);
  if (!target || target.mode !== '100644' || target.type !== 'blob'
    || target.sha !== sha(content.sha, 'transition content revision'))
    fail('transition publication tree does not bind the exact stored blob');
  const allowed = new Set(path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')));
  for (const key of new Set([...before.keys(), ...after.keys()]))
    if (!allowed.has(key) && canonicalJson(before.get(key) ?? null)
      !== canonicalJson(after.get(key) ?? null)) fail('transition publication changed another path');
  const protection = await immutableProtection(call, repo, ref);
  if (protection.versions.some((entry) =>
    Date.parse(entry.createdAt) > Date.parse(published.committedAt)
      || Date.parse(entry.updatedAt) > Date.parse(published.committedAt)))
    fail('transition evidence protection postdates the immutable publication');
  const payload = { schema: 'agentic-os/github-transition-publication/v1',
    repository: repo.repository, ref, path, publicationRevision: revision,
    parentRevision: published.parents[0], committedAt: published.committedAt,
    storedDigest: stored.storedDigest,
    protectionDigest: protection.projection.projectionDigest,
    protectionVersions: protection.versions };
  return freeze({ stored, ...payload, publicationDigest: governanceDigest(payload) });
}
async function workflow(call, repo, expected, operationInputDigest, terminal, currentRef,
  evidenceRef) {
  const run = object(exactStatus(await call('GET', `${repo.path}/actions/runs/${expected.id}`),
    [200], 'GitHub transition run'), 'GitHub transition run');
  const workflowId = id(run.workflow_id, 'workflow id');
  const definition = object(exactStatus(await call('GET', `${repo.path}/actions/workflows/${workflowId}`),
    [200], 'GitHub transition workflow'), 'GitHub transition workflow');
  const refRevision = currentRef ? await gitRef(call, repo, expected.ref) : expected.revision;
  const observedActor = actor(run.actor, 'workflow actor');
  const triggeringActor = actor(run.triggering_actor, 'workflow triggering actor');
  const paths = [expected.workflowPath,
    `${expected.workflowPath}@${expected.ref.slice('refs/heads/'.length)}`,
    `${expected.workflowPath}@${expected.workflowRef}`];
  const status = text(run.status, 'workflow status'), conclusion = run.conclusion;
  const title = deriveGitHubTransitionRunName({ operationInputDigest,
    workflowRevision: expected.workflowRevision });
  if (String(run.id) !== expected.id || run.url !== expected.url
    || run.repository?.full_name !== `${repo.owner}/${repo.name}`
    || run.event !== 'workflow_dispatch' || run.run_attempt !== 1 || run.display_title !== title
    || run.head_branch !== expected.ref.slice('refs/heads/'.length)
    || run.head_sha !== expected.revision || !paths.includes(run.path)
    || id(definition.id, 'workflow resource id') !== workflowId
    || definition.state !== 'active' || definition.path !== expected.workflowPath
    || refRevision !== expected.revision || canonicalJson(observedActor) !== canonicalJson(triggeringActor)
    || observedActor.id !== expected.authoritySubject.slice('github-user:'.length)
    || terminal && (status !== 'completed' || conclusion !== 'success')
    || !terminal && !['queued', 'in_progress', 'completed'].includes(status)
    || !terminal && status === 'completed' && conclusion !== 'success')
    fail('GitHub transition workflow does not authenticate the exact operation');
  const startedAt = instant(run.run_started_at, 'transition run start');
  const completedAt = terminal ? instant(run.updated_at, 'transition run completion') : null;
  const protection = await immutableProtection(call, repo, evidenceRef);
  return freeze({ workflowId, startedAt, actor: observedActor, triggeringActor,
    status, conclusion, completedAt, refRevision,
    protectionDigest: protection.projection.projectionDigest,
    protectionVersions: protection.versions });
}
export function createGitHubTransitionRestProvider({ repository: identity,
  targetRepository: targetIdentity, token, fetchImpl = globalThis.fetch,
  timeoutMs = 15_000 } = {}) {
  const repo = repository(identity), target = repository(targetIdentity);
  const call = rest(token, fetchImpl, timeoutMs);
  return Object.freeze({
    readPolicy(policy, revision) { return committedPolicy(call, repo, policy, revision); },
    async observeWorkflow(runValue, operationInputDigest, { terminal, currentRef }, evidenceRef) {
      const run = validateGitHubTransitionWorkflowRun(runValue, repo.repository);
      return workflow(call, repo, run, operationInputDigest, terminal, currentRef, evidenceRef);
    },
    async prepareIntegrationProof(inputValue) {
      const input = validateGitHubTransitionInput(inputValue);
      if (input.request.repository !== target.repository
        || input.request.requestedTransition !== 'integrate')
        fail('integration proof preparation target or operation changed');
      const initial = input.predecessorIssuance === null ? null
        : createGitHubAuthorityReadProvider({ issuance: input.predecessorIssuance,
          token, fetchImpl, timeoutMs });
      return observeGitHubIntegrationProof({ api: {
        call, exact: exactStatus, gitRef: (repoValue, ref) => gitRef(call, repoValue, ref),
        rules: (repoValue, ref) => rulesProjection(call, repoValue, ref, true),
        commit: (repoValue, revision) => commit(call, repoValue, revision), sha,
      }, target, input, initialProvider: initial, requirePlanBinding: false });
    },
    async observeProof(inputValue, expectedProof = null) {
      const input = validateGitHubTransitionInput(inputValue);
      if (input.request.repository !== target.repository) fail('transition proof target changed');
      if (input.request.requestedTransition === 'integrate') {
        const initial = input.predecessorIssuance === null ? null
          : createGitHubAuthorityReadProvider({ issuance: input.predecessorIssuance,
            token, fetchImpl, timeoutMs });
        return { proof: await observeGitHubIntegrationProof({ api: {
          call, exact: exactStatus, gitRef: (repoValue, ref) => gitRef(call, repoValue, ref),
          rules: (repoValue, ref) => rulesProjection(call, repoValue, ref, true),
          commit: (repoValue, revision) => commit(call, repoValue, revision), sha,
        }, target, input, initialProvider: initial, expectedProof }), predecessor: null };
      }
      const prior = await publication(call, repo, input.request.fenceRevision);
      const request = prior?.stored.operationInput.request;
      if (!prior || request.requestedTransition !== 'integrate'
        || prior.stored.targetRepository !== target.repository || request.claimId !== input.request.claimId
        || request.leaseEpoch + 1 !== input.request.leaseEpoch
        || prior.stored.coordinate !== input.request.fenceRevision)
        fail('retire does not source one exact stored integrated successor');
      await workflow(call, repo, prior.stored.workflowRun,
        prior.stored.operationInputDigest, true, false, prior.stored.evidenceRef);
      const initial = prior.stored.operationInput.predecessorIssuance === null ? null
        : createGitHubAuthorityReadProvider({
          issuance: prior.stored.operationInput.predecessorIssuance,
          token, fetchImpl, timeoutMs });
      const observedProof = await observeGitHubIntegrationProof({ api: {
        call, exact: exactStatus, gitRef: (repoValue, ref) => gitRef(call, repoValue, ref),
        rules: (repoValue, ref) => rulesProjection(call, repoValue, ref, true),
        commit: (repoValue, revision) => commit(call, repoValue, revision), sha,
      }, target, input: prior.stored.operationInput, initialProvider: initial,
      expectedProof: prior.stored.providerProof });
      if (!same(observedProof, prior.stored.providerProof))
        fail('stored integrated successor no longer matches live provider proof');
      const payload = { coordinate: prior.stored.coordinate,
        storedDigest: prior.stored.storedDigest,
        publicationDigest: prior.publicationDigest,
        integrationProofDigest: observedProof.proofDigest };
      const proofPayload = { schema: 'agentic-os/github-retire-provider-proof/v1', ...payload };
      const proof = freeze({ ...proofPayload, proofDigest: governanceDigest(proofPayload) });
      if (expectedProof !== null && !same(proof, expectedProof))
        fail('stored retirement winner no longer matches live provider proof');
      return { proof, predecessor: prior };
    },
    readPublication(coordinate, expected = null) { return publication(call, repo, coordinate, expected); },
    async publishStored(value) {
      const stored = validateGitHubStoredTransition(value);
      if (stored.authorityRepository !== repo.repository
        || stored.targetRepository !== target.repository)
        fail('transition publication repository changed');
      const protectionBefore = await immutableProtection(call, repo, stored.evidenceRef);
      const existing = await publication(call, repo, stored.coordinate);
      if (existing !== null) return existing;
      const base = await commit(call, repo, stored.workflowRun.workflowRevision);
      const blob = object(exactStatus(await call('POST', `${repo.path}/git/blobs`, { body: {
        content: Buffer.from(canonicalJson(stored)).toString('base64'), encoding: 'base64',
      } }), [201], 'GitHub transition blob'), 'GitHub transition blob');
      const madeTree = object(exactStatus(await call('POST', `${repo.path}/git/trees`, { body: {
        base_tree: base.tree, tree: [{ path: stored.evidencePath, mode: '100644',
          type: 'blob', sha: sha(blob.sha, 'transition blob revision') }],
      } }), [201], 'GitHub transition tree creation'), 'GitHub transition tree');
      const madeCommit = object(exactStatus(await call('POST', `${repo.path}/git/commits`, { body: {
        message: `ADLC transition ${stored.coordinate}`, tree: sha(madeTree.sha, 'created tree'),
        parents: [stored.workflowRun.workflowRevision],
      } }), [201], 'GitHub transition commit creation'), 'GitHub transition commit');
      let attempted; try {
        attempted = await call('POST', `${repo.path}/git/refs`, { body: {
          ref: stored.evidenceRef, sha: sha(madeCommit.sha, 'created commit') } });
      } catch (error) {
        const recovered = await publication(call, repo, stored.coordinate);
        if (recovered !== null) return recovered;
        throw error;
      }
      const result = await publication(call, repo, stored.coordinate);
      if (attempted.status !== 201 && result === null)
        fail(`GitHub transition ref publication failed with HTTP ${attempted.status}`);
      if (result === null) fail('GitHub transition create-only publication is not readable');
      if (result.protectionDigest !== protectionBefore.projection.projectionDigest
        || !same(result.protectionVersions, protectionBefore.versions))
        fail('GitHub transition evidence protection changed across publication');
      return result;
    },
  });
}
