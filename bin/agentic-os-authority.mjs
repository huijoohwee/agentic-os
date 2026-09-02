#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { readBoundedFile, snapshotCatalogInput } from '../src/catalog-input.mjs';
import { canonicalJson } from '../src/governance.mjs';
import { deriveGitHubAuthorityInputDigest, parseGitHubRepositoryIdentity, validateGitHubAuthorityPolicy } from '../src/github-authority.mjs';
import { validateGitHubStoredAuthorityBundle } from '../src/github-authority-issuer.mjs';
import { deriveGitHubAuthorityExpiry, issueGitHubAuthority, projectGitHubTargetRepository,
  parseAuthorityArguments, projectGitHubTargetReview, validateGitHubAuthorityDispatch,
  verifyGitHubAuthorityIssuanceLive } from '../src/github-authority-operation.mjs';
export { parseAuthorityArguments } from '../src/github-authority-operation.mjs';
import { deriveGitHubAuthorityRunName } from '../src/github-authority-client.mjs';
export const MAX_AUTHORITY_INPUT_BYTES = 64 * 1024, MAX_AUTHORITY_EVENT_BYTES = 256 * 1024,
  MAX_AUTHORITY_RESPONSE_BYTES = 256 * 1024, MAX_AUTHORITY_OUTPUT_BYTES = 64 * 1024;
export const GITHUB_API_ORIGIN = 'https://api.github.com';
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const DIGEST = /^[0-9a-f]{64}$/u, SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
  ID = /^[1-9][0-9]{0,18}$/u, OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})?$/u,
  REPOSITORY = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const REF_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DISPATCH_KEYS = Object.freeze(['request', 'candidate']), STATIC_POLICY_KEYS = Object.freeze([
  'targetRepositoryPrefix', 'canonicalRef', 'workflowPath', 'confirmationClass',
  'requiredStatusChecks', 'allowedMergeMethods', 'evidenceRefPrefix', 'evidencePathPrefix', 'validitySeconds']);
function fail(message) { throw new TypeError(message); }
function text(value, label, limit = 4096) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > limit
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`);
  return value; }
function exact(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const found = Object.keys(value);
  if (found.some((key) => !keys.includes(key)) || (required && keys.some((key) => !Object.hasOwn(value, key))))
    fail(`${label} fields are invalid`); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value; }
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be a full lowercase Git object identifier`);
  return value; }
function identifier(value, label) {
  const result = String(value);
  if (!ID.test(result)) fail(`${label} must be a canonical positive identifier`);
  return result; }
function shortRef(value, label) {
  const result = text(value, label), prefix = 'refs/heads/';
  const parts = result.startsWith(prefix) ? result.slice(prefix.length).split('/') : [];
  if (!parts.length || parts.some((part) => !REF_PART.test(part) || part.endsWith('.') || part.endsWith('.lock')))
    fail(`${label} must be a portable refs/heads ref`);
  return parts.join('/'); }
function ref(value, label) { return `refs/heads/${shortRef(value, label)}`; }
function relativePath(value, label) {
  const result = text(value, label), parts = result.split('/');
  if (result.startsWith('/') || result.includes('\\') || parts.some((part) => !part || part === '.' || part === '..'))
    fail(`${label} must be a portable relative Git path`);
  return result; }
function instant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result)
    fail(`${label} must be an exact UTC instant`);
  return result; }
function apiInstant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed)) fail(`${label} must be an API UTC instant`);
  return new Date(parsed).toISOString(); }
function clockValue(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(value)) fail('authority clock must be a finite timestamp');
  return value; }
function actionValue(env, name, { secret = false, path = false } = {}) {
  const value = env?.[name];
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 8192
    || /[\u0000-\u001f\u007f]/u.test(value) || !secret && !path && /\s/u.test(value)) fail(`${name} is required`);
  return value;
}
function actionPath(env, name) { return actionValue(env, name, { path: true }); }
function githubRepository(value, label = 'GitHub repository') {
  const source = text(value, label), match = source.match(/^github\.com\/([^/]+)\/([^/]+)$/u);
  if (!match || !OWNER.test(match[1]) || !REPOSITORY.test(match[2]))
    fail(`${label} must be canonical github.com/<owner>/<repository>`);
  const repository = parseGitHubRepositoryIdentity(source, label).repository;
  return Object.freeze({ repository, owner: match[1], name: match[2],
    path: `/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` });
}
function githubRepositoryFromActions(env) { return githubRepository(`github.com/${actionValue(env, 'GITHUB_REPOSITORY')}`, 'GITHUB_REPOSITORY'); }
function workflowReference(value, repository) {
  const source = actionValue({ GITHUB_WORKFLOW_REF: value }, 'GITHUB_WORKFLOW_REF');
  const prefix = `${repository.owner}/${repository.name}/`, marker = source.lastIndexOf('@');
  if (!source.startsWith(prefix) || marker <= prefix.length || source.indexOf('@') !== marker)
    fail('GITHUB_WORKFLOW_REF must bind GITHUB_REPOSITORY');
  return Object.freeze({ workflowPath: relativePath(source.slice(prefix.length, marker), 'GITHUB_WORKFLOW_REF path'),
    workflowRef: ref(source.slice(marker + 1), 'GITHUB_WORKFLOW_REF ref') });
}
function targetBranch(value, label) {
  const branch = text(value, label); if (branch.startsWith('refs/')) fail(`${label} must be a short Git branch`);
  return shortRef(`refs/heads/${branch}`, label); }
function pullNumber(locator, target) {
  if (locator === null) return null;
  let value;
  try { value = new URL(text(locator, 'target review locator')); } catch { fail('target review locator must be an exact GitHub pull request URL'); }
  const prefix = `/${target.owner}/${target.name}/pull/`;
  if (value.protocol !== 'https:' || value.hostname !== 'github.com' || value.port || value.username
    || value.password || value.search || value.hash || !value.pathname.startsWith(prefix)
    || value.href !== locator) fail('target review locator must be an exact GitHub pull request URL');
  return identifier(value.pathname.slice(prefix.length), 'target review number');
}
function actionContext(env, { requireToken = true } = {}) {
  if (actionValue(env, 'GITHUB_EVENT_NAME') !== 'workflow_dispatch') fail('GITHUB_EVENT_NAME must be workflow_dispatch');
  if (actionValue(env, 'GITHUB_RUN_ATTEMPT') !== '1') fail('GITHUB_RUN_ATTEMPT must be exactly 1');
  const repository = githubRepositoryFromActions(env), context = {
    repository, token: requireToken ? actionValue(env, 'GITHUB_TOKEN', { secret: true }) : null,
    eventPath: actionPath(env, 'GITHUB_EVENT_PATH'), runId: identifier(actionValue(env, 'GITHUB_RUN_ID'), 'GITHUB_RUN_ID'),
    ref: ref(actionValue(env, 'GITHUB_REF'), 'GITHUB_REF'),
    revision: sha(actionValue(env, 'GITHUB_SHA'), 'GITHUB_SHA'),
    workflowRevision: sha(actionValue(env, 'GITHUB_WORKFLOW_SHA'), 'GITHUB_WORKFLOW_SHA'),
  };
  Object.assign(context, workflowReference(actionValue(env, 'GITHUB_WORKFLOW_REF'), repository));
  if (context.ref !== context.workflowRef || context.revision !== context.workflowRevision)
    fail('GitHub workflow ref and revision must equal the checked-out ref and revision');
  context.locator = `${GITHUB_API_ORIGIN}${repository.path}/actions/runs/${context.runId}`;
  return Object.freeze(context);
}
function staticPolicy(value) {
  exact(value, STATIC_POLICY_KEYS, 'committed authority policy');
  if (!Number.isSafeInteger(value.validitySeconds) || value.validitySeconds < 60 || value.validitySeconds > 86_400)
    fail('committed authority policy validitySeconds must be an integer from 60 through 86400');
  const prefix = text(value.targetRepositoryPrefix, 'policy.targetRepositoryPrefix');
  if (!/^github\.com\/[a-z0-9](?:[a-z0-9-]{0,38})?\/$/u.test(prefix))
    fail('policy.targetRepositoryPrefix must be canonical github.com/<owner>/');
  const evidenceRefPrefix = text(value.evidenceRefPrefix, 'policy.evidenceRefPrefix');
  const evidencePathPrefix = text(value.evidencePathPrefix, 'policy.evidencePathPrefix');
  if (!evidenceRefPrefix.endsWith('/') || !evidencePathPrefix.endsWith('/')) fail('authority evidence prefixes must end in /');
  const strings = (entries, label, allowed = null) => {
    if (!Array.isArray(entries) || entries.length === 0) fail(`${label} must be a non-empty array`);
    const result = entries.map((entry) => text(entry, label)).sort();
    if (new Set(result).size !== result.length || allowed && result.some((entry) => !allowed.includes(entry))
      || !allowed && result.some((entry) => entry.trim() !== entry)
      || canonicalJson(entries) !== canonicalJson(result)) fail(`${label} must be canonical and duplicate-free`);
    return result;
  };
  return Object.freeze({ targetRepositoryPrefix: prefix, canonicalRef: ref(value.canonicalRef, 'policy.canonicalRef'),
    workflowPath: relativePath(value.workflowPath, 'policy.workflowPath'),
    confirmationClass: text(value.confirmationClass, 'policy.confirmationClass'),
    requiredStatusChecks: strings(value.requiredStatusChecks, 'policy.requiredStatusChecks'),
    allowedMergeMethods: strings(value.allowedMergeMethods, 'policy.allowedMergeMethods', ['merge', 'rebase', 'squash']),
    evidenceRefPrefix: `${ref(evidenceRefPrefix.slice(0, -1), 'policy.evidenceRefPrefix')}/`,
    evidencePathPrefix: `${relativePath(evidencePathPrefix.slice(0, -1), 'policy.evidencePathPrefix')}/`,
    validitySeconds: value.validitySeconds });
}
function runtimePolicy(staticValue, context) {
  const policy = staticPolicy(staticValue);
  if (policy.canonicalRef !== context.ref || policy.workflowPath !== context.workflowPath)
    fail('committed authority policy is not bound to GITHUB_REF and GITHUB_WORKFLOW_REF');
  return validateGitHubAuthorityPolicy({ evidenceRepository: context.repository.repository,
    targetRepositoryPrefix: policy.targetRepositoryPrefix, canonicalRef: policy.canonicalRef,
    canonicalRevision: context.revision, workflowPath: policy.workflowPath,
    workflowRef: context.workflowRef, workflowRevision: context.workflowRevision,
    confirmationClass: policy.confirmationClass, requiredStatusChecks: policy.requiredStatusChecks,
    allowedMergeMethods: policy.allowedMergeMethods, evidenceRefPrefix: policy.evidenceRefPrefix,
    evidencePathPrefix: policy.evidencePathPrefix, validitySeconds: policy.validitySeconds });
}
function readJsonFile(path, label, { relative = false, maxBytes = MAX_AUTHORITY_INPUT_BYTES,
  catalog = true, exactBytes = false } = {}) {
  const source = text(path, `${label} path`);
  if (relative && (source.startsWith('/') || source.includes('\\') || source.split('/').some((part) => !part || part === '.' || part === '..')))
    fail(`${label} path must be repository-relative`);
  let bytes; try { bytes = readBoundedFile(resolve(source), maxBytes, label); }
  catch (error) { fail(error instanceof Error ? error.message : `${label} could not be read`); }
  let value; try { value = JSON.parse(UTF8.decode(bytes)); }
  catch { fail(`${label} must be valid UTF-8 JSON`); }
  if (!catalog) return value;
  const snapshot = snapshotCatalogInput(value); if (!snapshot.ok) fail(`${label} exceeds structural bounds`);
  const encoded = canonicalJson(snapshot.value);
  if (exactBytes && !bytes.equals(Buffer.from(encoded, 'utf8'))) fail(`${label} must use exact canonical JSON bytes`);
  return JSON.parse(encoded);
}
export function loadAuthorityDispatch(eventPath, expectedEventPath) {
  if (expectedEventPath !== undefined && eventPath !== expectedEventPath)
    fail('--event must equal GITHUB_EVENT_PATH');
  const event = object(readJsonFile(eventPath, 'GitHub event',
    { maxBytes: MAX_AUTHORITY_EVENT_BYTES, catalog: false }), 'GitHub event');
  const inputs = object(event.inputs, 'GitHub event inputs');
  exact(inputs, ['authority_payload', 'authority_input_digest'], 'GitHub event inputs');
  const encoded = text(inputs.authority_payload, 'authority_payload', MAX_AUTHORITY_INPUT_BYTES);
  const authorityInputDigest = text(inputs.authority_input_digest, 'authority_input_digest');
  if (!DIGEST.test(authorityInputDigest)) fail('authority_input_digest must be a lowercase sha256 digest');
  let value; try { value = JSON.parse(encoded); }
  catch { fail('authority_payload must be JSON'); }
  const snapshot = snapshotCatalogInput(value);
  if (!snapshot.ok) fail('authority_payload exceeds structural bounds');
  exact(snapshot.value, DISPATCH_KEYS, 'authority_payload');
  const canonical = canonicalJson(snapshot.value);
  if (encoded !== canonical) fail('authority_payload must use exact canonical JSON bytes');
  return Object.freeze({ dispatch: JSON.parse(canonical), authorityInputDigest });
}
export function loadCommittedAuthorityPolicy(path) { return staticPolicy(readJsonFile(path, 'committed authority policy', { relative: true, exactBytes: true })); }
export const loadAuthorityIssueInput = loadAuthorityDispatch;
function encodedPath(path) { return relativePath(path, 'GitHub content path').split('/').map(encodeURIComponent).join('/'); }
function jsonObject(value, label) { return object(value, label); }
function actor(value, label) {
  const source = jsonObject(value, label), id = identifier(source.id, `${label}.id`), login = text(source.login, `${label}.login`).toLowerCase();
  if (!OWNER.test(login)) fail(`${label}.login is invalid`);
  return { id, login }; }
function decodeBase64(value, label, limit = MAX_AUTHORITY_INPUT_BYTES) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_AUTHORITY_RESPONSE_BYTES
    || /[^A-Za-z0-9+/=\r\n]/u.test(value)) fail(`${label} is not base64`);
  const source = value.replaceAll('\r', '').replaceAll('\n', '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(source)) fail(`${label} is not canonical base64`);
  const bytes = Buffer.from(source, 'base64');
  if (bytes.byteLength > limit || bytes.toString('base64') !== source) fail(`${label} exceeds byte bound`);
  return bytes; }
function parseJsonBytes(bytes, label, project = (value) => value) { try {
    const snapshot = snapshotCatalogInput(project(JSON.parse(UTF8.decode(bytes))));
    if (!snapshot.ok) fail(`${label} exceeds structural bounds`);
    return snapshot.value;
  } catch (error) { if (error instanceof TypeError) throw error; fail(`${label} must be valid UTF-8 JSON`); }
}
async function boundedBody(response) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(length)
    || Number(length) > MAX_AUTHORITY_RESPONSE_BYTES)) fail('GitHub API response exceeds byte bound');
  if (response.body === null || response.body === undefined) return Buffer.alloc(0);
  if (typeof response.body.getReader !== 'function') fail('GitHub API response body is unavailable');
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try { for (;;) {
      const next = await reader.read(); if (next.done) break;
      const chunk = Buffer.from(next.value); total += chunk.byteLength;
      if (total > MAX_AUTHORITY_RESPONSE_BYTES) fail('GitHub API response exceeds byte bound');
      chunks.push(chunk); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total); }
function apiUrl(path) { return new URL(path, GITHUB_API_ORIGIN).href; }
function checkResponse(response) {
  if (!response || typeof response !== 'object' || !Number.isInteger(response.status)) fail('GitHub API returned an invalid response');
  if (response.redirected || response.status >= 300 && response.status < 400) fail('GitHub API redirects are refused'); }
function githubRequester(token, fetchImpl) {
  if (typeof fetchImpl !== 'function') fail('GitHub authority provider requires fetch');
  return async (method, path, body, { absent = false, statuses = [200], includeHeaders = false,
    project } = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      let response; try { response = await fetchImpl(apiUrl(path), {
        method, redirect: 'error', signal: controller.signal,
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
          'x-github-api-version': '2026-03-10', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: canonicalJson(body) }),
      }); } catch { fail('GitHub API request failed'); }
      checkResponse(response);
      const bytes = await boundedBody(response);
      if (absent && response.status === 404) return null;
      if (!statuses.includes(response.status)) fail(`GitHub API request failed with HTTP ${response.status}`);
      const value = parseJsonBytes(bytes, 'GitHub API response', project);
      return includeHeaders ? { value, link: response.headers?.get?.('link') ?? null } : value;
    } finally { clearTimeout(timer); } };
}
function ruleDescriptor(value, label) {
  const source = jsonObject(value, label), type = text(source.type, `${label}.type`);
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(type)) fail(`${label} is invalid`);
  const parameters = Object.hasOwn(source, 'parameters') ? source.parameters
    : type === 'update' ? { update_allows_fetch_and_merge: false } : null;
  if (parameters !== null && (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)))
    fail(`${label}.parameters must be an object or null`);
  return { type, parameters }; }
function bypassActor(value) {
  const source = jsonObject(value, 'GitHub ruleset bypass actor');
  return `${text(source.actor_type, 'GitHub bypass actor type')}:${identifier(source.actor_id, 'GitHub bypass actor id')}:${text(source.bypass_mode, 'GitHub bypass actor mode')}`; }
function createGitHubProvider({ context, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (typeof now !== 'function') fail('GitHub authority provider requires a clock');
  let prepared = null;
  const request = githubRequester(context.token, fetchImpl);
  const requireEvidenceRepository = (value) => {
    const source = githubRepository(value);
    if (source.repository !== context.repository.repository) fail('GitHub provider cannot target another evidence repository');
    return source;
  };
  const content = async (repository, path, revision, { absent = false, json = false } = {}) => {
    const source = await request('GET', `${repository.path}/contents/${encodedPath(path)}?ref=${encodeURIComponent(revision)}`, undefined, { absent });
    if (source === null) return null;
    if (source.type !== 'file' || source.encoding !== 'base64') fail('GitHub content is not a base64 file');
    const bytes = decodeBase64(source.content, 'GitHub content body');
    const value = json ? parseJsonBytes(bytes, 'GitHub content') : UTF8.decode(bytes);
    if (json && !bytes.equals(Buffer.from(canonicalJson(value), 'utf8')))
      fail('GitHub JSON content must use exact canonical bytes');
    return { value, sha: sha(source.sha, 'GitHub content SHA') };
  };
  const gitRef = async (repository, branchRef, { absent = false } = {}) => {
    const checked = ref(branchRef, 'GitHub ref');
    const source = await request('GET', `${repository.path}/git/ref/heads/${encodeURIComponent(shortRef(checked, 'GitHub ref'))}`, undefined, { absent });
    if (source === null) return null;
    if (source.ref !== checked || source.object?.type !== 'commit') fail('GitHub ref is not the exact commit ref');
    return sha(source.object.sha, 'GitHub ref object SHA');
  };
  const gitCommit = async (repository, revision, { oneParent = false } = {}) => {
    const source = jsonObject(await request('GET', `${repository.path}/git/commits/${sha(revision, 'Git commit revision')}`), 'GitHub commit');
    if (sha(source.sha, 'GitHub commit SHA') !== revision || !Array.isArray(source.parents)
      || oneParent && source.parents.length !== 1) fail('GitHub commit parentage is invalid');
    const parentRevisions = source.parents.map((entry) => sha(entry?.sha, 'GitHub commit parent SHA'));
    return { revision, parentRevisions, parentRevision: parentRevisions.length === 1 ? parentRevisions[0] : null,
      tree: sha(source.tree?.sha, 'GitHub commit tree SHA'), committedAt: apiInstant(source.committer?.date, 'GitHub commit time') };
  };
  const gitTree = async (repository, revision) => {
    const source = jsonObject(await request('GET', `${repository.path}/git/trees/${sha(revision, 'Git tree revision')}?recursive=1`), 'GitHub tree');
    if (source.truncated !== false || sha(source.sha, 'GitHub tree SHA') !== revision
      || !Array.isArray(source.tree)) fail('GitHub tree must be exact, complete, and recursive');
    const entries = new Map();
    for (const entry of source.tree) {
      const item = jsonObject(entry, 'GitHub tree entry'), path = relativePath(item.path, 'GitHub tree path');
      const descriptor = { mode: text(item.mode, 'GitHub tree mode'), type: text(item.type, 'GitHub tree type'),
        sha: sha(item.sha, 'GitHub tree entry SHA') };
      if (!['blob', 'commit', 'tree'].includes(descriptor.type) || entries.has(path))
        fail('GitHub tree entries must be distinct Git objects');
      entries.set(path, descriptor);
    }
    return entries;
  };
  const readRunRecord = async () => {
    if (!prepared) fail('GitHub authority provider is not prepared');
    const source = jsonObject(await request('GET', `${context.repository.path}/actions/runs/${context.runId}`), 'GitHub workflow run');
    const workflowId = identifier(source.workflow_id, 'workflow run workflow_id');
    const workflow = jsonObject(await request('GET', `${context.repository.path}/actions/workflows/${workflowId}`), 'GitHub workflow');
    const bare = context.workflowPath, paths = [bare,
      `${bare}@${shortRef(context.workflowRef, 'workflow run ref')}`, `${bare}@${context.workflowRef}`];
    const startedAt = apiInstant(source.run_started_at, 'workflow run start time');
    const completedAt = apiInstant(source.updated_at, 'workflow run completion time');
    if (identifier(source.id, 'workflow run id') !== context.runId || source.url !== context.locator
      || source.event !== 'workflow_dispatch' || source.run_attempt !== 1
      || source.repository?.full_name !== `${context.repository.owner}/${context.repository.name}`
      || ref(`refs/heads/${targetBranch(source.head_branch, 'workflow run branch')}`, 'workflow run branch') !== context.ref
      || sha(source.head_sha, 'workflow run SHA') !== context.revision
      || !paths.includes(relativePath(source.path, 'workflow run path'))
      || context.workflowId !== undefined && workflowId !== context.workflowId
      || identifier(workflow.id, 'workflow resource id') !== workflowId
      || workflow.state !== 'active' || relativePath(workflow.path, 'workflow resource path') !== bare
      || source.display_title !== deriveGitHubAuthorityRunName({ authorityInputDigest:
        prepared.authorityInputDigest, workflowRevision: context.workflowRevision })
      || source.status !== 'completed' || source.conclusion !== 'success'
      || Date.parse(completedAt) < Date.parse(startedAt)) {
      fail('GitHub workflow run is not bound to one exact successful Actions invocation');
    }
    return { id: context.runId, locator: context.locator, event: source.event, runAttempt: 1,
      repository: context.repository.repository, ref: context.ref, revision: context.revision,
      workflowPath: context.workflowPath, workflowRef: context.workflowRef,
      workflowRevision: context.workflowRevision, startedAt, completedAt,
      authorityInputDigest: prepared.authorityInputDigest, actor: actor(source.actor, 'workflow actor'),
      triggeringActor: actor(source.triggering_actor, 'workflow triggering actor') };
  };
  const protection = async (branchRef) => {
    const checked = ref(branchRef, 'GitHub protection ref'), branch = shortRef(checked, 'GitHub protection ref');
    const page = await request('GET', `${context.repository.path}/rules/branches/${encodeURIComponent(branch)}?per_page=100`, undefined,
      { includeHeaders: true });
    if (page.link && /(?:^|,)\s*<[^>]+>;\s*rel="?next"?/iu.test(page.link))
      fail('GitHub branch rules pagination is not safely bounded');
    const entries = page.value;
    if (!Array.isArray(entries) || entries.length === 0) fail('GitHub branch rules endpoint must return active rules');
    const grouped = new Map();
    for (const entry of entries) {
      const source = jsonObject(entry, 'GitHub branch rule'), id = identifier(source.ruleset_id, 'GitHub branch rule ruleset_id');
      const descriptor = ruleDescriptor(source, 'GitHub branch rule');
      const prior = grouped.get(id) ?? [];
      prior.push(descriptor); grouped.set(id, prior);
    }
    const rulesets = [];
    for (const [id, rules] of grouped) {
      const detail = jsonObject(await request('GET', `${context.repository.path}/rulesets/${id}?includes_parents=true`), 'GitHub ruleset');
      if (identifier(detail.id, 'GitHub ruleset id') !== id || detail.enforcement !== 'active'
        || !Array.isArray(detail.rules) || !Array.isArray(detail.bypass_actors)) fail('GitHub ruleset detail is invalid');
      const detailed = detail.rules.map((value) => ruleDescriptor(value, 'GitHub ruleset rule'))
        .sort((left, right) => left.type.localeCompare(right.type));
      rules.sort((left, right) => left.type.localeCompare(right.type));
      if (new Set(rules.map((value) => value.type)).size !== rules.length
        || new Set(detailed.map((value) => value.type)).size !== detailed.length
        || canonicalJson(rules) !== canonicalJson(detailed))
        fail('GitHub branch rules do not match their active ruleset');
      rulesets.push({ id, enforcement: 'active', rules: detailed,
        bypassActors: [...new Set(detail.bypass_actors.map(bypassActor))].sort() });
    }
    return { repository: context.repository.repository, ref: checked,
      rulesets: rulesets.sort((left, right) => left.id.localeCompare(right.id)) };
  };
  const storedForEvidence = (value, evidence, checked, rawPath) => {
    const stored = validateGitHubStoredAuthorityBundle(value), bundle = stored.authorityBundle;
    if (bundle.policy.evidenceRepository !== evidence.repository || bundle.evidenceRef !== checked
      || bundle.evidencePath !== rawPath) fail('GitHub stored bundle is not bound to its evidence location');
    return stored;
  };
  const proveEvidenceCommit = async ({ evidence, checked, rawPath, canonicalRevision, revision, expectedBlob }) => {
    const commit = await gitCommit(evidence, revision, { oneParent: true });
    if (commit.parentRevision !== canonicalRevision) fail('GitHub evidence commit is not a one-parent canonical child');
    const base = await gitCommit(evidence, canonicalRevision);
    const baseEntries = await gitTree(evidence, base.tree), evidenceEntries = await gitTree(evidence, commit.tree);
    const target = evidenceEntries.get(rawPath);
    if (!target || target.type !== 'blob' || target.mode !== '100644'
      || expectedBlob !== undefined && target.sha !== expectedBlob) {
      fail('GitHub evidence tree does not contain the exact evidence blob');
    }
    const paths = new Set([...baseEntries.keys(), ...evidenceEntries.keys()]),
      allowed = new Set(rawPath.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')));
    for (const path of paths) {
      const prior = baseEntries.get(path), current = evidenceEntries.get(path);
      if (allowed.has(path) && path !== rawPath && (current?.type !== 'tree' || current.mode !== '040000'
        || prior && (prior.type !== 'tree' || prior.mode !== '040000')))
        fail('GitHub evidence path ancestors must remain trees');
      if (!allowed.has(path) && canonicalJson(prior ?? null) !== canonicalJson(current ?? null))
        fail('GitHub evidence tree contains changes outside the exact evidence path');
    }
    return commit;
  };
  const targetReview = async (target, locator) => {
    const number = pullNumber(locator, target);
    if (number === null) return null;
    const source = jsonObject(await request('GET', `${target.path}/pulls/${number}`, undefined, { project: projectGitHubTargetReview }), 'GitHub target review');
    const repository = (value, label) => githubRepository(`github.com/${text(value?.full_name, label)}`, label).repository;
    if (!Object.hasOwn(source, 'merged_at') || source.merged_at !== null && typeof source.merged_at !== 'string')
      fail('GitHub target review state is invalid');
    const state = source.merged_at === null ? source.state : 'merged';
    if (identifier(source.number, 'GitHub target review number') !== number || source.html_url !== locator
      || !['open', 'closed', 'merged'].includes(state) || typeof source.draft !== 'boolean')
      fail('GitHub target review identity is invalid');
    return { locator, state, draft: source.draft, headRepository: repository(source.head?.repo, 'GitHub target review head repository'),
      headBranch: text(source.head?.ref, 'GitHub target review head branch'), headRevision: sha(source.head?.sha, 'GitHub target review head revision'),
      baseRepository: repository(source.base?.repo, 'GitHub target review base repository'),
      baseBranch: text(source.base?.ref, 'GitHub target review base branch'), baseRevision: sha(source.base?.sha, 'GitHub target review base revision') };
  };
  return Object.freeze({
    async prepareInvocation({ dispatch, authorityInputDigest, policy, policyPath }) {
      const local = staticPolicy(policy);
      const remote = staticPolicy((await content(context.repository, policyPath, context.revision, { json: true })).value);
      if (canonicalJson(local) !== canonicalJson(remote)) fail('local authority policy does not match its committed revision');
      const effective = runtimePolicy(remote, context);
      const derivedDigest = deriveGitHubAuthorityInputDigest({ request: dispatch.request, candidate: dispatch.candidate, policy: effective });
      if (authorityInputDigest !== derivedDigest) fail('authority_input_digest does not match the event payload and committed policy');
      const workflow = await content(context.repository, context.workflowPath, context.workflowRevision);
      if (!workflow.value.trim()) fail('committed workflow text is empty');
      prepared = Object.freeze({ policy: effective, authorityInputDigest: derivedDigest });
      const run = await readRunRecord();
      return Object.freeze({ policy: effective, authorityInputDigest, locator: context.locator, startedAt: run.startedAt });
    },
    async readRun({ repository, locator }) {
      requireEvidenceRepository(repository);
      if (locator !== context.locator) fail('GitHub workflow run locator is not this Actions run');
      return readRunRecord();
    },
    async readActor({ repository, workflowRun }) {
      requireEvidenceRepository(repository);
      const observed = actor(workflowRun?.actor, 'workflow actor');
      const source = jsonObject(await request('GET', '/user'), 'GitHub actor');
      const reobserved = actor(source, 'GitHub actor');
      if (reobserved.id !== observed.id || reobserved.login !== observed.login) fail('GitHub actor re-observation changed');
      return { ...reobserved, subject: `github-user:${reobserved.id}` };
    },
    async readRules({ repository, ref: branchRef }) {
      requireEvidenceRepository(repository);
      return protection(branchRef);
    },
    async readCanonicalRef({ repository, ref: branchRef }) {
      const evidence = requireEvidenceRepository(repository), checked = ref(branchRef, 'GitHub canonical ref');
      return { repository: evidence.repository, ref: checked, revision: await gitRef(evidence, checked) };
    },
    async readTargetRepository({ repository, canonicalBranch, canonicalRevision, candidateBranch, candidateHeadRevision, reviewLocator }) {
      const target = githubRepository(repository, 'target repository');
      if (!prepared || !target.repository.startsWith(prepared.policy.targetRepositoryPrefix)) fail('target repository is outside committed policy');
      const baseBranch = targetBranch(canonicalBranch, 'target canonical branch'), headBranch = targetBranch(candidateBranch, 'target candidate branch');
      const baseRevision = sha(canonicalRevision, 'target canonical revision'), headRevision = sha(candidateHeadRevision, 'target candidate head revision');
      const [source, currentBase, currentHead, review] = await Promise.all([
        request('GET', target.path, undefined, { project: projectGitHubTargetRepository }), gitRef(target, `refs/heads/${baseBranch}`),
        gitRef(target, `refs/heads/${headBranch}`), targetReview(target, reviewLocator),
      ]);
      if (source.full_name !== `${target.owner}/${target.name}` || source.owner?.type !== 'User') fail('GitHub target repository identity is invalid');
      const owner = actor(source.owner, 'GitHub target repository owner');
      if (owner.login !== target.owner) fail('GitHub target repository owner changed');
      if (currentBase !== baseRevision || currentHead !== headRevision) fail('GitHub target branch revisions changed');
      return { repository: target.repository, repositoryId: identifier(source.id, 'GitHub target repository id'), owner,
        canonicalBranch: baseBranch, canonicalRevision: baseRevision, candidateBranch: headBranch,
        candidateHeadRevision: headRevision, review };
    },
    async readPublication({ repository, ref: branchRef, path }) {
      const evidence = requireEvidenceRepository(repository), checked = ref(branchRef, 'GitHub evidence ref');
      const rawPath = relativePath(path, 'GitHub evidence path'), revision = await gitRef(evidence, checked, { absent: true });
      if (revision === null) return null;
      const contentValue = await content(evidence, rawPath, revision, { json: true });
      const stored = storedForEvidence(contentValue.value, evidence, checked, rawPath);
      const commit = await proveEvidenceCommit({ evidence, checked, rawPath,
        canonicalRevision: stored.authorityBundle.policy.canonicalRevision, revision,
        expectedBlob: contentValue.sha });
      return { repository: evidence.repository, ref: checked, path: rawPath, revision,
        parentRevision: commit.parentRevision, committedAt: commit.committedAt,
        storedDigest: stored.storedDigest };
    },
    async readBundle({ repository, ref: branchRef, path }) {
      const evidence = requireEvidenceRepository(repository), checked = ref(branchRef, 'GitHub evidence ref');
      const rawPath = relativePath(path, 'GitHub evidence path');
      const stored = await content(evidence, rawPath, shortRef(checked, 'GitHub evidence ref'), { absent: true, json: true });
      return stored === null ? null : storedForEvidence(stored.value, evidence, checked, rawPath);
    },
    async publishBundle({ repository, ref: branchRef, path, storedBundle, createOnly, expectedRevision }) {
      const evidence = requireEvidenceRepository(repository), checked = ref(branchRef, 'GitHub evidence ref');
      const rawPath = relativePath(path, 'GitHub evidence path');
      if (createOnly !== true || expectedRevision !== null) fail('GitHub evidence publication must be create-only');
      const stored = validateGitHubStoredAuthorityBundle(storedBundle), bundle = stored.authorityBundle;
      if (bundle.policy.evidenceRepository !== evidence.repository || bundle.evidenceRef !== checked || bundle.evidencePath !== rawPath)
        fail('GitHub evidence publication is not bound to its stored bundle');
      const nowValue = clockValue(now), start = Date.parse(bundle.challenge.issuedAt), expires = Date.parse(bundle.challenge.expiresAt);
      if (nowValue < start || nowValue >= expires) fail('authority issuance window is not currently valid');
      if (await gitRef(evidence, bundle.policy.canonicalRef) !== bundle.policy.canonicalRevision)
        fail('GitHub canonical ref moved before evidence publication');
      const base = await gitCommit(evidence, bundle.policy.canonicalRevision);
      const bytes = Buffer.from(canonicalJson(stored), 'utf8').toString('base64');
      const blob = sha(jsonObject(await request('POST', `${evidence.path}/git/blobs`, { content: bytes, encoding: 'base64' }, { statuses: [201] }), 'GitHub blob').sha, 'GitHub blob SHA');
      const tree = sha(jsonObject(await request('POST', `${evidence.path}/git/trees`, { base_tree: base.tree,
        tree: [{ path: rawPath, mode: '100644', type: 'blob', sha: blob }] }, { statuses: [201] }), 'GitHub tree').sha, 'GitHub tree SHA');
      const commit = sha(jsonObject(await request('POST', `${evidence.path}/git/commits`, {
        message: `agentic-os authority evidence ${stored.storedDigest}`, tree, parents: [bundle.policy.canonicalRevision],
      }, { statuses: [201] }), 'GitHub evidence commit').sha, 'GitHub evidence commit SHA');
      if (await gitRef(evidence, bundle.policy.canonicalRef) !== bundle.policy.canonicalRevision)
        fail('GitHub canonical ref moved before evidence ref creation');
      await request('POST', `${evidence.path}/git/refs`, { ref: checked, sha: commit }, { statuses: [201] });
      if (await gitRef(evidence, checked) !== commit) fail('GitHub evidence ref does not resolve to the created commit');
      await proveEvidenceCommit({ evidence, checked, rawPath, canonicalRevision: bundle.policy.canonicalRevision,
        revision: commit, expectedBlob: blob });
      const observed = storedForEvidence((await content(evidence, rawPath, commit, { json: true })).value, evidence, checked, rawPath);
      if (canonicalJson(observed) !== canonicalJson(stored)
        || await gitRef(evidence, bundle.policy.canonicalRef) !== bundle.policy.canonicalRevision)
        fail('GitHub evidence publication is not exact at the canonical revision');
      return { created: true };
    },
  });
}
export function createGitHubActionsProvider({ env = process.env, fetchImpl = globalThis.fetch,
  now = () => Date.now() } = {}) {
  return createGitHubProvider({ context: actionContext(env), fetchImpl, now });
}
async function createGitHubOwnerProvider({ repository: identity, runId, eventPath, policy,
  authorityInputDigest, token, fetchImpl, now }) {
  const repository = githubRepository(identity, 'authority repository'), checkedToken = actionValue({ GITHUB_TOKEN: token }, 'GITHUB_TOKEN', { secret: true });
  const request = githubRequester(checkedToken, fetchImpl), locator = `${GITHUB_API_ORIGIN}${repository.path}/actions/runs/${runId}`;
  const run = jsonObject(await request('GET', `${repository.path}/actions/runs/${runId}`), 'GitHub workflow run');
  const workflowId = identifier(run.workflow_id, 'workflow run workflow_id');
  const workflow = jsonObject(await request('GET', `${repository.path}/actions/workflows/${workflowId}`), 'GitHub workflow');
  const selected = staticPolicy(policy), branch = shortRef(selected.canonicalRef, 'policy.canonicalRef');
  const paths = [selected.workflowPath, `${selected.workflowPath}@${branch}`,
    `${selected.workflowPath}@${selected.canonicalRef}`];
  if (identifier(run.id, 'workflow run id') !== runId || run.url !== locator
    || run.event !== 'workflow_dispatch' || run.run_attempt !== 1
    || run.repository?.full_name !== `${repository.owner}/${repository.name}`
    || targetBranch(run.head_branch, 'workflow run branch') !== branch
    || !paths.includes(relativePath(run.path, 'workflow run path'))
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.display_title !== deriveGitHubAuthorityRunName({ authorityInputDigest,
      workflowRevision: sha(run.head_sha, 'workflow run SHA') })
    || identifier(workflow.id, 'workflow resource id') !== workflowId
    || workflow.state !== 'active' || relativePath(workflow.path, 'workflow resource path') !== selected.workflowPath)
    fail('explicit GitHub run is not one exact successful active-workflow dispatch');
  const context = actionContext({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: `${repository.owner}/${repository.name}`, GITHUB_TOKEN: checkedToken,
    GITHUB_EVENT_PATH: eventPath, GITHUB_RUN_ID: runId, GITHUB_REF: selected.canonicalRef,
    GITHUB_SHA: run.head_sha, GITHUB_WORKFLOW_REF: `${repository.owner}/${repository.name}/${selected.workflowPath}@${selected.canonicalRef}`,
    GITHUB_WORKFLOW_SHA: run.head_sha });
  return createGitHubProvider({ context: Object.freeze({ ...context, workflowId }), fetchImpl, now });
}
export const createGitHubRestProvider = createGitHubActionsProvider;
function safeMessage(error, secret) {
  let message = error instanceof Error ? error.message : 'unexpected authority failure';
  if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]');
  return message.replace(/(authorization|bearer|token)(?:=|:|\s+)\S+/giu, '$1 [redacted]'); }
function write(stream, value) {
  if (!stream || typeof stream.write !== 'function') fail('authority output stream is invalid');
  stream.write(`${value}\n`); }
export async function runAuthority(argv, {
  env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), stdout = process.stdout, stderr = process.stderr,
} = {}) {
  const secret = typeof env?.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN : null; let operation = 'issuance';
  try {
    const command = parseAuthorityArguments(argv);
    if (command.command === 'help') { write(stdout, 'usage: agentic-os-authority validate-event --event=<event.json> --policy=<policy.json> | issue-github --event=<event.json> --policy=<policy.json> --repository=github.com/<owner>/<repo> --run-id=<id>'); return 0; }
    operation = command.command === 'validate-event' ? 'validation' : 'issuance';
    const policy = loadCommittedAuthorityPolicy(command.policyPath);
    const validationContext = command.command === 'validate-event'
      ? actionContext(env, { requireToken: false }) : null;
    const { dispatch, authorityInputDigest } = loadAuthorityDispatch(command.eventPath,
      validationContext?.eventPath);
    if (validationContext) { validateGitHubAuthorityDispatch({ dispatch,
      policy: runtimePolicy(policy, validationContext), authorityInputDigest }); return 0; }
    const provider = await createGitHubOwnerProvider({ repository: command.repository,
      runId: command.runId, eventPath: command.eventPath, policy, authorityInputDigest,
      token: actionValue(env, 'GITHUB_TOKEN', { secret: true }), fetchImpl, now });
    const prepared = await provider.prepareInvocation({ dispatch, authorityInputDigest, policy, policyPath: command.policyPath });
    const expiresAt = deriveGitHubAuthorityExpiry(dispatch, prepared.startedAt, prepared.policy.validitySeconds, now);
    const issuance = await issueGitHubAuthority({ request: dispatch.request, candidate: dispatch.candidate,
      policy: prepared.policy, workflowRunLocator: prepared.locator, expiresAt }, provider);
    const output = canonicalJson(await verifyGitHubAuthorityIssuanceLive(issuance, provider, { now }));
    if (Buffer.byteLength(output, 'utf8') > MAX_AUTHORITY_OUTPUT_BYTES) fail('authority output exceeds byte bound');
    write(stdout, output); return 0;
  } catch (error) { write(stderr, `authority ${operation} failed: ${safeMessage(error, secret)}`);
    return 1; }
}
export const runAuthorityCli = runAuthority; export async function main() { process.exitCode = await runAuthority(process.argv.slice(2)); }
function invokedDirectly() { try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href; } catch { return false; } }
if (invokedDirectly()) await main();
