/** Bounded REST fallback projections after an authenticated GraphQL quota refusal. */
const repositoryName = (value) => typeof value === 'string' ? value : value?.nameWithOwner ?? null;
const branchName = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(value)
  && !value.includes('..') && !value.includes('//') && !value.includes('@{') && !value.endsWith('/')
  && !value.endsWith('.') && !value.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'));
function hostOf(value) { try { return new URL(value).host.toLowerCase(); } catch { return null; } }
export function repositoryIdentity(value) {
  const match = value?.match(/^((?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?)\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u);
  const port = match?.[1].match(/\]:(\d+)$/u)?.[1] ?? match?.[1].match(/^[^:]+:(\d+)$/u)?.[1];
  return match && (!port || Number(port) <= 65535) ? { host: match[1].toLowerCase(), name: match[2] } : null;
}
export function remoteRepositoryIdentity(value) {
  if (typeof value !== 'string') return null;
  let host, path;
  try {
    const parsed = new URL(value); if (!parsed.host || parsed.search || parsed.hash) return null;
    host = parsed.host.toLowerCase(); path = parsed.pathname.replace(/^\/+/, '');
  } catch {
    const scp = value.match(/^(?:[^@/\s]+@)?([A-Za-z0-9.-]+):([^?#\s]+)$/u);
    if (!scp) return null;
    [, host, path] = scp; host = host.toLowerCase();
  }
  const name = path.endsWith('.git') ? path.slice(0, -4) : path, identity = repositoryIdentity(`${host}/${name}`);
  return identity ? { ...identity, repository: `${identity.host}/${identity.name}` } : null;
}
export function restRepositoryProjection(remoteUrl, call) {
  const remote = remoteRepositoryIdentity(remoteUrl); if (!remote) return null;
  const value = call(['api', `repos/${remote.name}`, '--hostname', remote.host]);
  return value?.full_name === remote.name && hostOf(value?.html_url ?? '') === remote.host
    && typeof value.default_branch === 'string'
    ? { nameWithOwner: value.full_name, defaultBranchRef: { name: value.default_branch }, url: value.html_url } : null;
}
function restRepository(value) {
  return typeof value?.full_name === 'string' && typeof value?.html_url === 'string'
    ? { nameWithOwner: value.full_name, url: value.html_url } : null;
}
function restReview(value) {
  const state = value?.state === 'open' ? 'OPEN' : value?.merged_at ? 'MERGED' : value?.state === 'closed' ? 'CLOSED' : null;
  const number = Number.isSafeInteger(value?.number) && value.number > 0 ? value.number : null;
  const headRepository = restRepository(value?.head?.repo), baseRepository = restRepository(value?.base?.repo);
  if (!state || number === null || typeof value?.html_url !== 'string' || typeof value?.head?.sha !== 'string'
    || !branchName(value?.head?.ref) || !branchName(value?.base?.ref) || !headRepository || !baseRepository) return null;
  return { number, state, url: value.html_url, mergeStateStatus: null, headRefOid: value.head.sha,
    headRefName: value.head.ref, baseRefName: value.base.ref, body: typeof value.body === 'string' ? value.body : '',
    headRepository, baseRepository, isCrossRepository: headRepository.nameWithOwner !== baseRepository.nameWithOwner,
    autoMergeRequest: null, mergeQueueEntry: null };
}
export function restReviewNumber(url, target) {
  try {
    const parsed = new URL(url), prefix = `/${target.name}/pull/`;
    if (parsed.host.toLowerCase() !== target.host || !parsed.pathname.startsWith(prefix)) return null;
    const number = Number(parsed.pathname.slice(prefix.length));
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  } catch { return null; }
}
export function restListReviews(call, target, ref, { state = 'all', limit = 2 } = {}) {
  const owner = target?.name?.split('/')[0];
  if (!owner || !branchName(ref) || !['all', 'open'].includes(state) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  const value = call(['api', `repos/${target.name}/pulls?state=${state}&head=${encodeURIComponent(`${owner}:${ref}`)}&per_page=${limit}`,
    '--hostname', target.host]);
  if (!Array.isArray(value)) return null;
  const reviews = value.map(restReview); return reviews.every(Boolean) ? reviews : null;
}
export function restReadReview(call, target, number) {
  return Number.isSafeInteger(number) && number > 0
    ? restReview(call(['api', `repos/${target.name}/pulls/${number}`, '--hostname', target.host])) : null;
}
export function restWriteReview(call, target, suffix, method, fields) {
  if (!target || !['POST', 'PATCH'].includes(method) || !Array.isArray(fields)
    || fields.some(([key, value]) => !/^[a-z]+$/u.test(key) || typeof value !== 'string')) return null;
  const args = ['api', `repos/${target.name}/pulls${suffix}`, '--method', method, '--hostname', target.host];
  for (const [key, value] of fields) args.push('-f', `${key}=${value}`);
  return call(args);
}
export function restOpenPullRequests(repository, host, call) {
  const value = call(['api', `repos/${repository}/pulls?state=open&per_page=100`, '--hostname', host]);
  if (!Array.isArray(value)) return null;
  const rows = value.map((pull) => ({ number: pull?.number, headRefName: pull?.head?.ref }));
  return rows.every((pull) => Number.isSafeInteger(pull.number) && pull.number > 0 && typeof pull.headRefName === 'string') ? rows : null;
}
