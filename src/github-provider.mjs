/** Exact GitHub review projection and merge-queue handoff. */

import { execFileSync } from 'node:child_process';
import { loadRepositoryProfile, resolveRepositoryRoot } from './git-repository.mjs';
import { remoteTransport } from './git.mjs';
import { canonicalJson, governanceDigest, validateRepositoryProfile } from './governance.mjs';

export const GITHUB_ADAPTER = Object.freeze({ id: 'github', version: '1' });
export const GITHUB_CAPABILITIES = Object.freeze([
  'read-only-review-observation',
  'host-qualified-repository-pin',
]);
export const GITHUB_REVIEW_OBSERVATION_SCHEMA = 'agentic-os/github-review-observation/v1';

const FIELDS = [
  'number', 'state', 'url', 'mergeStateStatus', 'headRefOid', 'headRefName',
  'baseRefName', 'headRepository', 'isCrossRepository', 'body', 'autoMergeRequest',
].join(',');

function repositoryName(value) {
  return typeof value === 'string' ? value : value?.nameWithOwner ?? null;
}

function repositoryIdentity(value) {
  const match = value?.match(/^((?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?)\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u);
  const port = match?.[1].match(/\]:(\d+)$/u)?.[1]
    ?? match?.[1].match(/^[^:]+:(\d+)$/u)?.[1];
  return match && (!port || Number(port) <= 65535)
    ? { host: match[1].toLowerCase(), name: match[2] } : null;
}

function remoteRepositoryIdentity(value) {
  if (typeof value !== 'string') return null;
  let host;
  let path;
  try {
    const parsed = new URL(value);
    if (!parsed.host || parsed.search || parsed.hash) return null;
    host = parsed.host.toLowerCase();
    path = parsed.pathname.replace(/^\/+/, '');
  } catch {
    const scp = value.match(/^(?:[^@/\s]+@)?([A-Za-z0-9.-]+):([^?#\s]+)$/u);
    if (!scp) return null;
    [, host, path] = scp;
    host = host.toLowerCase();
  }
  const name = path.endsWith('.git') ? path.slice(0, -4) : path;
  const identity = repositoryIdentity(`${host}/${name}`);
  return identity ? { ...identity, repository: `${identity.host}/${identity.name}` } : null;
}

function bindProfileToRemote(profile, root) {
  const configured = repositoryIdentity(profile.repository);
  const prefix = 'refs/remotes/';
  const suffix = profile.canonical.remoteRef.startsWith(prefix)
    ? profile.canonical.remoteRef.slice(prefix.length) : '';
  const separator = suffix.indexOf('/');
  const remote = separator > 0 ? suffix.slice(0, separator) : null;
  const transport = remoteTransport(remote, root);
  const observed = remoteRepositoryIdentity(transport.fetchUrl);
  if (!configured || !observed || configured.host !== observed.host
    || configured.name !== observed.name) {
    const error = new Error(
      'GitHub profile repository does not match one exact canonical remote fetch/push URL',
    );
    error.reason = 'blocked-provider-repository-identity';
    throw error;
  }
  return { ...observed, remote: transport.name };
}

function urlHost(value) {
  try { return new URL(value).host.toLowerCase(); } catch { return null; }
}

function branchName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(value)
    && !value.includes('..') && !value.includes('//') && !value.includes('@{')
    && !value.endsWith('/') && !value.endsWith('.')
    && !value.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock')) ? value : null;
}

export function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export let lastError = null;
export let lastHttpStatus = null;

export function providerHttpStatus(error) {
  const raw = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  const match = raw.match(/\bHTTP\s+(\d{3})\b|"status"\s*:\s*"?(\d{3})"?/iu);
  return match ? Number(match[1] ?? match[2]) : null;
}

export function isAbsentClassicProtection(status, message) {
  return status === 404 && /\bbranch not protected\b/iu.test(message ?? '');
}

export function providerMessage(error) {
  const raw = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  if (!raw) return String(error.message ?? 'unknown provider error');
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const detail = (parsed.errors ?? [])
      .map((entry) => (typeof entry === 'string' ? entry : entry.message ?? ''))
      .filter(Boolean)
      .join('; ');
    return [parsed.message, detail].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return raw.split('\n').filter(Boolean).slice(0, 2).join(' ');
  }
}

export function gh(args, { cwd = process.cwd(), json = true, input } = {}) {
  try {
    const out = execFileSync('gh', args, {
      cwd,
      input,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    lastError = null;
    lastHttpStatus = null;
    return json ? JSON.parse(out || 'null') : out.trim();
  } catch (error) {
    lastError = providerMessage(error);
    lastHttpStatus = providerHttpStatus(error);
    return null;
  }
}

function identityExact(review, {
  ref, expectedHead, expectedRepository, baseBranch,
}) {
  const expected = repositoryIdentity(expectedRepository);
  const headRepository = repositoryName(review?.headRepository);
  const baseRepository = repositoryName(review?.baseRepository);
  const headHost = urlHost(review?.headRepository?.url);
  const baseHost = urlHost(review?.baseRepository?.url);
  const repositoryExact = expected !== null
    && urlHost(review?.url) === expected.host
    && headRepository === expected.name
    && (!headHost || headHost === expected.host)
    && (baseRepository === expected.name && (!baseHost || baseHost === expected.host)
      || (baseRepository === null && review?.isCrossRepository === false));
  return ['OPEN', 'MERGED'].includes(review?.state)
    && review.headRefOid === expectedHead
    && review.headRefName === ref
    && review.baseRefName === baseBranch
    && repositoryExact;
}

function receipt({
  ref, identity, review, written = true, mutationAttempted = false,
  failureReason = null, sourceHeadCurrent = true, writeResultUnknown = false,
  reobservedAfterMutation = false, reobservationExact = false,
}) {
  const exact = identityExact(review, identity) && sourceHeadCurrent
    && (!mutationAttempted || reobservedAfterMutation);
  const queueEntry = exact ? review?.mergeQueueEntry ?? null : null;
  const accepted = Boolean(exact && (review.state === 'MERGED' || queueEntry));
  return {
    schema: 'agentic-os-provider-handoff/v1',
    provider: 'github-gh',
    ok: accepted && written && failureReason === null,
    reason: failureReason ?? (!written ? mutationAttempted
      ? 'review-write-result-unknown' : 'review-observation-failed'
      : !exact ? 'review-identity-mismatch'
        : !queueEntry && review.state !== 'MERGED' ? 'tested-ordering-unavailable'
          : !accepted ? 'provider-handoff-not-observed' : null),
    ref,
    headSha: review?.headRefOid ?? null,
    sourceHeadBound: Boolean(exact),
    reviewMutationAttempted: mutationAttempted,
    reviewWriteResultUnknown: writeResultUnknown,
    reviewReobservedAfterMutation: reobservedAfterMutation,
    reviewReobservationExact: Boolean(reobservedAfterMutation && reobservationExact
      && sourceHeadCurrent),
    reviewRequiresAttention: Boolean(mutationAttempted && (!written || !exact || failureReason)),
    orderingArmed: Boolean(exact && queueEntry),
    testedProtectedOrdering: Boolean(exact && queueEntry),
    queueEntry,
    pr: review,
  };
}

export function enqueue(ref, {
  cwd = process.cwd(), title, body, expectedHead, expectedRepository,
  baseBranch, provider = gh, assertSourceHead = null,
} = {}) {
  const call = (args, json = true) => provider(args, { cwd, json });
  const target = repositoryIdentity(expectedRepository);
  const sourceBranch = branchName(ref);
  const revision = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(expectedHead ?? '');
  if (!target || !branchName(baseBranch) || !sourceBranch || !revision) {
    return receipt({
      ref,
      identity: { ref, expectedHead, expectedRepository, baseBranch },
      review: null,
      written: false,
      failureReason: !target ? 'repository-identity-missing'
        : !sourceBranch ? 'source-identity-missing'
          : !revision ? 'source-revision-missing' : 'base-identity-missing',
    });
  }
  const pin = (args) => [...args, '--repo', expectedRepository];
  const view = pin(['pr', 'view', ref, '--json', FIELDS]);
  const identity = (review) => identityExact(review, {
    ref, expectedHead, expectedRepository, baseBranch,
  });
  const snapshot = (url) => url ? call([
    'api', 'graphql', '--hostname', target.host,
    '-f', 'query=query($url:URI!){resource(url:$url){... on PullRequest{' +
      'number state url mergeStateStatus headRefOid headRefName baseRefName body ' +
      'headRepository{nameWithOwner url} baseRepository{nameWithOwner url} isCrossRepository ' +
      'autoMergeRequest{enabledAt} ' +
      'mergeQueueEntry{id position state}}}}', '-F', `url=${url}`,
  ])?.data?.resource ?? null : null;
  const bodyExact = (review) => identity(review)
    && review.body?.split('\n').includes(`Source-Head: ${expectedHead}`);
  const sourceHeadCurrent = () => {
    if (typeof assertSourceHead !== 'function') return false;
    try { return assertSourceHead() === true; } catch { return false; }
  };
  const sourceHeadReason = () => typeof assertSourceHead === 'function'
    ? 'source-ref-moved' : 'source-head-assertion-missing';
  const reobserve = (fallback = null) => {
    const projected = call(view);
    const observed = snapshot(projected?.url ?? fallback?.url) ?? projected;
    return { review: observed ?? fallback, fresh: observed !== null };
  };
  const unknownWrite = (fallback = null) => {
    const { review, fresh } = reobserve(fallback);
    const sourceCurrent = sourceHeadCurrent();
    return receipt({ ref, identity: { ref, expectedHead, expectedRepository, baseBranch },
      review, written: false, mutationAttempted: true,
      failureReason: 'review-write-result-unknown', sourceHeadCurrent: sourceCurrent,
      writeResultUnknown: true, reobservedAfterMutation: fresh,
      reobservationExact: fresh && bodyExact(review) });
  };
  const listed = call(pin([
    'pr', 'list', '--state', 'all', '--head', ref, '--limit', '2', '--json', FIELDS,
  ]));
  if (!Array.isArray(listed)) {
    return receipt({
      ref,
      identity: { ref, expectedHead, expectedRepository, baseBranch },
      review: null,
      written: false,
    });
  }
  const matching = listed.filter((review) => identity(review));
  const existing = matching.length === 1 ? matching[0] : listed[0] ?? null;
  if (listed.length > 1 || (existing && !identity(existing))) {
    return receipt({
      ref, identity: { ref, expectedHead, expectedRepository, baseBranch }, review: existing,
    });
  }
  const observedExisting = snapshot(existing?.url);
  if (bodyExact(observedExisting) && observedExisting.mergeQueueEntry) {
    const sourceCurrent = sourceHeadCurrent();
    return receipt({
      ref, identity: { ref, expectedHead, expectedRepository, baseBranch },
      review: observedExisting, sourceHeadCurrent: sourceCurrent,
      failureReason: sourceCurrent ? null : sourceHeadReason(),
    });
  }

  let mutationAttempted = false;
  if (existing?.state === 'OPEN') {
    if (body) {
      if (!sourceHeadCurrent()) return receipt({ ref,
        identity: { ref, expectedHead, expectedRepository, baseBranch }, review: existing,
        written: false, failureReason: sourceHeadReason(), sourceHeadCurrent: false });
      mutationAttempted = true;
      if (call(pin(['pr', 'edit', ref, '--body', body]), false) === null)
        return unknownWrite(existing);
    }
    if (title) {
      if (!sourceHeadCurrent()) { const observed = mutationAttempted ? reobserve(existing) : null;
        if (mutationAttempted) sourceHeadCurrent();
        return receipt({ ref, identity: { ref, expectedHead, expectedRepository, baseBranch },
          review: observed?.review ?? existing, mutationAttempted,
          failureReason: sourceHeadReason(), sourceHeadCurrent: false,
          reobservedAfterMutation: observed?.fresh ?? false,
          reobservationExact: Boolean(observed?.fresh && bodyExact(observed.review)) }); }
      mutationAttempted = true;
      if (call(pin(['pr', 'edit', ref, '--title', title]), false) === null)
        return unknownWrite(existing);
    }
  } else if (!existing) {
    if (!sourceHeadCurrent()) return receipt({ ref,
      identity: { ref, expectedHead, expectedRepository, baseBranch }, review: null,
      written: false, failureReason: sourceHeadReason(), sourceHeadCurrent: false });
    mutationAttempted = true;
    if (call(pin([
      'pr', 'create', '--base', baseBranch, '--head', ref,
      '--title', title ?? ref, '--body', body ?? '',
    ]), false) === null) return unknownWrite();
  }
  const observed = reobserve(existing);
  const final = observed.review;
  const verified = (!mutationAttempted || observed.fresh) && bodyExact(final);
  const sourceCurrent = sourceHeadCurrent();
  return receipt({
    ref,
    identity: { ref, expectedHead, expectedRepository, baseBranch },
    review: final,
    written: true,
    mutationAttempted,
    sourceHeadCurrent: sourceCurrent,
    reobservedAfterMutation: mutationAttempted && observed.fresh,
    reobservationExact: mutationAttempted && observed.fresh && verified,
    failureReason: !sourceCurrent ? sourceHeadReason()
      : mutationAttempted && !verified ? 'written-but-identity-failed' : null,
  });
}

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

function githubProfile(value) {
  const profile = validateRepositoryProfile(value);
  if (profile.adapters.provider?.id !== GITHUB_ADAPTER.id
    || profile.adapters.provider.version !== GITHUB_ADAPTER.version) {
    throw new TypeError('repository profile does not select github adapter version 1');
  }
  const target = repositoryIdentity(profile.repository);
  const prefix = 'refs/heads/';
  const baseBranch = profile.canonical.localRef.startsWith(prefix)
    ? branchName(profile.canonical.localRef.slice(prefix.length)) : null;
  if (!target || !baseBranch) throw new TypeError('GitHub profile identity is invalid');
  return { profile, target, baseBranch };
}

export function observeGitHubReview({
  ref, expectedHead, profile: value, cwd = process.cwd(), provider = gh,
} = {}) {
  const { profile, target, baseBranch } = githubProfile(value);
  const repository = resolveRepositoryRoot(cwd);
  const observedRemote = bindProfileToRemote(profile, repository);
  if (!branchName(ref) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(expectedHead ?? '')) {
    throw new TypeError('GitHub review identity is invalid');
  }
  const pin = (args) => [...args, '--repo', profile.repository];
  const supplied = provider(pin([
    'pr', 'list', '--state', 'all', '--head', ref, '--limit', '2', '--json', FIELDS,
  ]), { cwd: repository, json: true });
  const listed = Array.isArray(supplied) ? JSON.parse(canonicalJson(supplied)) : null;
  const matching = listed ? listed.filter((review) => identityExact(review, {
    ref, expectedHead, expectedRepository: profile.repository, baseBranch,
  })) : [];
  const review = matching.length === 1 ? matching[0] : null;
  const payload = {
    schema: GITHUB_REVIEW_OBSERVATION_SCHEMA,
    configuredRepository: profile.repository,
    repositoryHost: target.host,
    observedRemoteName: observedRemote.remote,
    observedRemoteRepository: observedRemote.repository,
    adapter: { ...GITHUB_ADAPTER },
    baseBranch,
    ref,
    expectedHead,
    sourceHeadBound: review !== null,
    reason: listed === null ? 'provider-read-failed'
      : matching.length > 1 ? 'review-identity-ambiguous'
        : review ? null : listed.length === 0 ? 'review-not-found' : 'review-identity-mismatch',
    review,
    capabilities: [...GITHUB_CAPABILITIES],
    authority: { runtime: 'consumer', release: 'consumer' },
  };
  return frozen({ ...payload, observationDigest: governanceDigest(payload) });
}

export function createGitHubAdapter(options = {}) {
  const repository = resolveRepositoryRoot(options.repository ?? process.cwd());
  const profile = loadRepositoryProfile({ repository, profilePath: options.profilePath });
  githubProfile(profile);
  bindProfileToRemote(profile, repository);
  const provider = options.provider ?? gh;
  return Object.freeze({
    ...GITHUB_ADAPTER,
    capabilities: GITHUB_CAPABILITIES,
    profile,
    observe: ({ ref, expectedHead }) => observeGitHubReview({
      ref, expectedHead, profile, cwd: repository, provider,
    }),
  });
}
