/** Provider I/O orchestration for one create-only GitHub authority issuance. */
import { canonicalJson } from './governance.mjs';
import {
  createFencedClaimBundle,
  createGitHubAuthorityChallenge,
  deriveGitHubAuthorityInputDigest,
  parseGitHubRepositoryIdentity,
  validateGitHubAuthorityPolicy,
} from './github-authority.mjs';
import {
  createGitHubAuthorityIssuance,
  createGitHubProtectionSnapshot,
  createGitHubPublicationReceipt,
  createGitHubStoredAuthorityBundle,
  createGitHubTargetRepositoryProjection,
  validateGitHubAuthorityIssuance,
  validateGitHubEvidencePublication,
  validateGitHubStoredAuthorityBundle,
} from './github-authority-issuer.mjs';

const IDENTIFIER = /^[1-9][0-9]{0,18}$/u;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})?$/u;

function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label} fields are invalid`);
  }
}
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a bounded non-empty string`);
  }
  return value;
}
function identifier(value, label) {
  const result = typeof value === 'number' ? String(value) : text(value, label);
  if (!IDENTIFIER.test(result)) fail(`${label} must be a canonical positive identifier`);
  return result;
}
export function parseAuthorityArguments(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string'))
    fail('authority arguments are invalid');
  if (argv.length === 1 && argv[0] === '--help') return Object.freeze({ command: 'help' });
  if (!['issue-github', 'validate-event'].includes(argv[0]))
    fail('usage: agentic-os-authority validate-event --event=<event.json> --policy=<policy.json> | issue-github --event=<event.json> --policy=<policy.json> --repository=github.com/<owner>/<repo> --run-id=<id>');
  const command = argv[0], allowed = command === 'issue-github'
    ? ['event', 'policy', 'repository', 'run-id'] : ['event', 'policy'], values = {};
  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index], match = current.match(/^--([a-z-]+)=(.+)$/u);
    if (match) {
      if (!allowed.includes(match[1])) fail(`authority ${command} option --${match[1]} is invalid`);
      if (Object.hasOwn(values, match[1])) fail(`authority --${match[1]} option is duplicated`);
      values[match[1]] = match[2];
    } else if (current.startsWith('--') && allowed.includes(current.slice(2))) {
      const name = current.slice(2), next = argv[++index];
      if (Object.hasOwn(values, name) || typeof next !== 'string' || next.startsWith('--'))
        fail(`authority --${name} option is invalid`);
      values[name] = next;
    } else fail(`authority ${command} options are invalid`);
  }
  const result = { command, eventPath: text(values.event, 'authority event path'),
    policyPath: text(values.policy, 'authority policy path') };
  if (command === 'issue-github') Object.assign(result, {
    repository: parseGitHubRepositoryIdentity(values.repository, 'authority repository').repository,
    runId: identifier(values['run-id'], 'authority run id'),
  });
  return Object.freeze(result);
}
function projectionObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}
function projectRepository(value, label) {
  const source = projectionObject(value, label);
  return { full_name: source.full_name };
}
export function projectGitHubTargetRepository(value) {
  const source = projectionObject(value, 'GitHub target repository response');
  const owner = projectionObject(source.owner, 'GitHub target repository owner');
  return { id: source.id, full_name: source.full_name,
    owner: { id: owner.id, login: owner.login, type: owner.type } };
}
export function projectGitHubTargetReview(value) {
  const source = projectionObject(value, 'GitHub target review response');
  const head = projectionObject(source.head, 'GitHub target review head');
  const base = projectionObject(source.base, 'GitHub target review base');
  return { number: source.number, html_url: source.html_url, state: source.state,
    merged_at: source.merged_at, draft: source.draft,
    head: { repo: projectRepository(head.repo, 'GitHub target review head repository'),
      ref: head.ref, sha: head.sha },
    base: { repo: projectRepository(base.repo, 'GitHub target review base repository'),
      ref: base.ref, sha: base.sha } };
}
function providerApi(provider, writable = false) {
  if (!provider || typeof provider !== 'object') fail('GitHub authority provider is required');
  for (const name of ['readRun', 'readActor', 'readRules', 'readCanonicalRef', 'readTargetRepository',
    'readPublication', 'readBundle', ...(writable ? ['publishBundle'] : [])]) {
    if (typeof provider[name] !== 'function') fail(`GitHub authority provider.${name} is required`);
  }
  return provider;
}
function authenticatedActor(value, request, run) {
  const source = snap(value);
  exact(source, ['id', 'login', 'subject'], 'GitHub authenticated actor');
  const id = identifier(source.id, 'authenticated actor id');
  const login = text(source.login, 'authenticated actor login').toLowerCase();
  if (!LOGIN.test(login) || source.subject !== `github-user:${id}`
    || source.subject !== request.authoritySubject
    || id !== run.actor.id || login !== run.actor.login
    || id !== run.triggeringActor.id || login !== run.triggeringActor.login) {
    fail('authenticated actor must match workflow actor, trigger actor, and request subject');
  }
}
async function observeProtection(provider, bundle) {
  const canonical = await provider.readRules({
    repository: bundle.policy.evidenceRepository,
    ref: bundle.policy.canonicalRef,
  });
  const evidence = await provider.readRules({
    repository: bundle.policy.evidenceRepository,
    ref: bundle.evidenceRef,
  });
  const canonicalHead = await provider.readCanonicalRef({
    repository: bundle.policy.evidenceRepository,
    ref: bundle.policy.canonicalRef,
  });
  return createGitHubProtectionSnapshot(canonical, evidence, canonicalHead, bundle);
}
function targetQuery(bundle) {
  return {
    repository: bundle.candidate.targetRepository,
    canonicalBranch: bundle.candidate.canonicalBranch,
    canonicalRevision: bundle.candidate.canonicalRevision,
    candidateBranch: bundle.candidate.branch,
    candidateHeadRevision: bundle.candidate.headRevision,
    reviewLocator: bundle.candidate.reviewLocator,
  };
}
function inputTime(value, key, label) {
  const source = snap(value), instant = text(source[key], `${label}.${key}`);
  const parsed = Date.parse(instant);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== instant)
    fail(`${label}.${key} must be an exact UTC instant`);
  return parsed;
}
export function deriveGitHubAuthorityExpiry(dispatchValue, startedAtValue,
  validitySeconds, clockValue = Date.now) {
  const dispatch = snap(dispatchValue), startedAt = text(startedAtValue, 'workflow startedAt');
  const started = Date.parse(startedAt), now = typeof clockValue === 'function'
    ? clockValue() : clockValue;
  const expires = Math.min(inputTime(dispatch.request, 'expiresAt', 'request'),
    inputTime(dispatch.candidate, 'expiresAt', 'candidate'), started + validitySeconds * 1000);
  if (!Number.isFinite(started) || new Date(started).toISOString() !== startedAt
    || !Number.isSafeInteger(validitySeconds) || validitySeconds < 60
    || !Number.isFinite(now) || started < inputTime(dispatch.request, 'observedAt', 'request')
    || started < inputTime(dispatch.candidate, 'observedAt', 'candidate')
    || expires <= started || now < started || now >= expires)
    fail('workflow start or clock is outside the authority input validity window');
  return new Date(expires).toISOString();
}
export function validateGitHubAuthorityDispatch(input) {
  const source = snap(input);
  exact(source, ['dispatch', 'policy', 'authorityInputDigest'],
    'GitHub authority dispatch validation input');
  const policy = validateGitHubAuthorityPolicy(source.policy), candidate = source.dispatch.candidate;
  const derived = deriveGitHubAuthorityInputDigest({ request: source.dispatch.request,
    candidate, policy });
  if (source.authorityInputDigest !== derived)
    fail('authority_input_digest does not match the event payload and committed policy');
  return Object.freeze({ schema: 'agentic-os/github-authority-dispatch-validation/v1',
    authorityInputDigest: derived,
    authoritySubject: source.dispatch.request.authoritySubject,
    targetRepository: candidate.targetRepository,
    candidateDigest: candidate.candidateDigest });
}
function verificationClock(options) {
  const source = options ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some((key) => key !== 'now')) {
    fail('GitHub authority verification options are invalid');
  }
  const clock = Object.hasOwn(source, 'now') ? source.now : Date.now;
  if (typeof clock !== 'function') fail('GitHub authority verification requires a trusted clock');
  return clock;
}
function requireCurrentWindow(bundle, clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('GitHub authority verification clock returned an invalid time');
  }
  if (value < Date.parse(bundle.challenge.issuedAt)
    || value >= Date.parse(bundle.challenge.expiresAt)) {
    fail('GitHub authority issuance is outside its current validity window');
  }
}
async function observeState(provider, stored) {
  const bundle = stored.authorityBundle;
  const query = {
    repository: bundle.policy.evidenceRepository,
    ref: bundle.evidenceRef,
    path: bundle.evidencePath,
  };
  const before = await provider.readPublication(query);
  const value = await provider.readBundle(query);
  const after = await provider.readPublication(query);
  if (before === null || after === null || value === null) {
    if (before === null && after === null && value === null) return null;
    fail('GitHub evidence ref, publication, and stored bundle disagree');
  }
  const first = validateGitHubEvidencePublication(before, stored);
  const second = validateGitHubEvidencePublication(after, stored);
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail('GitHub evidence publication changed while it was read');
  }
  const observed = validateGitHubStoredAuthorityBundle(value);
  if (observed.storedDigest !== stored.storedDigest
    || canonicalJson(observed) !== canonicalJson(stored)) {
    fail('evidence replay key resolves to a conflicting stored bundle');
  }
  return { publication: second, stored: observed };
}

export async function issueGitHubAuthority(input, providerValue) {
  const source = snap(input);
  exact(source, ['request', 'candidate', 'policy', 'workflowRunLocator', 'expiresAt'],
    'GitHub authority issue input');
  const provider = providerApi(providerValue, true);
  const policy = validateGitHubAuthorityPolicy(source.policy);
  const locator = text(source.workflowRunLocator, 'workflowRunLocator');
  const run = snap(await provider.readRun({ repository: policy.evidenceRepository, locator }));
  if (run.locator !== locator) fail('provider workflow run locator changed during read');
  const challenge = createGitHubAuthorityChallenge({
    request: source.request,
    candidate: source.candidate,
    workflowRun: run,
    policy,
    expiresAt: source.expiresAt,
  });
  const bundle = createFencedClaimBundle({
    request: source.request,
    candidate: source.candidate,
    challenge,
    workflowRun: run,
    policy,
  });
  authenticatedActor(await provider.readActor({
    repository: policy.evidenceRepository,
    workflowRun: run,
  }), bundle.request, bundle.workflowRun);
  const targetBefore = createGitHubTargetRepositoryProjection(
    await provider.readTargetRepository(targetQuery(bundle)), bundle);
  const preProtection = await observeProtection(provider, bundle);
  const stored = createGitHubStoredAuthorityBundle({
    authorityBundle: bundle,
    targetRepository: targetBefore,
    preProtection,
  });
  let state = await observeState(provider, stored), publicationError = null;
  if (state === null) {
    try {
      await provider.publishBundle({
        repository: policy.evidenceRepository,
        ref: bundle.evidenceRef,
        path: bundle.evidencePath,
        storedBundle: stored,
        createOnly: true,
        expectedRevision: null,
      });
    } catch (error) { publicationError = error; }
    state = await observeState(provider, stored);
    if (state === null) {
      if (publicationError !== null) throw publicationError;
      fail('published GitHub evidence is not readable after create-only CAS');
    }
  }
  const targetAfter = createGitHubTargetRepositoryProjection(
    await provider.readTargetRepository(targetQuery(bundle)), bundle);
  if (canonicalJson(targetBefore) !== canonicalJson(targetAfter)) {
    fail('target repository identity changed across evidence publication');
  }
  const postProtection = await observeProtection(provider, bundle);
  const publicationReceipt = createGitHubPublicationReceipt({
    storedBundle: state.stored,
    publication: state.publication,
    postProtection,
  });
  return createGitHubAuthorityIssuance({ storedBundle: state.stored, publicationReceipt });
}

/** Authenticates a current structural issuance by exact read-only provider re-observation. */
export async function verifyGitHubAuthorityIssuanceLive(value, providerValue, options) {
  const issuance = validateGitHubAuthorityIssuance(value), provider = providerApi(providerValue);
  const stored = issuance.storedBundle, bundle = stored.authorityBundle;
  const clock = verificationClock(options);
  requireCurrentWindow(bundle, clock);
  const observedRun = snap(await provider.readRun({
    repository: bundle.policy.evidenceRepository,
    locator: bundle.workflowRun.locator,
  }));
  const challenge = createGitHubAuthorityChallenge({
    request: bundle.request,
    candidate: bundle.candidate,
    workflowRun: observedRun,
    policy: bundle.policy,
    expiresAt: bundle.challenge.expiresAt,
  });
  const observedBundle = createFencedClaimBundle({ request: bundle.request,
    candidate: bundle.candidate, challenge, workflowRun: observedRun, policy: bundle.policy });
  if (canonicalJson(observedBundle) !== canonicalJson(bundle)) {
    fail('provider workflow run no longer authenticates the authority bundle');
  }
  authenticatedActor(await provider.readActor({ repository: bundle.policy.evidenceRepository,
    workflowRun: observedBundle.workflowRun }), bundle.request, observedBundle.workflowRun);
  const target = createGitHubTargetRepositoryProjection(
    await provider.readTargetRepository(targetQuery(bundle)), bundle);
  if (canonicalJson(target) !== canonicalJson(stored.targetRepository)) {
    fail('provider target repository no longer authenticates the authority bundle');
  }
  const state = await observeState(provider, stored);
  if (state === null) fail('provider no longer exposes the immutable authority publication');
  const postProtection = await observeProtection(provider, bundle);
  const publicationReceipt = createGitHubPublicationReceipt({ storedBundle: state.stored,
    publication: state.publication, postProtection });
  const observed = createGitHubAuthorityIssuance({ storedBundle: state.stored, publicationReceipt });
  if (canonicalJson(observed) !== canonicalJson(issuance)) {
    fail('provider state no longer authenticates the authority issuance');
  }
  requireCurrentWindow(bundle, clock);
  return issuance;
}

export const issueGitHubAuthorityBundle = issueGitHubAuthority;
