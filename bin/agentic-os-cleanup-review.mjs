/** Bounded read-only GitHub merge/check evidence, never protected-integration authority. */
import { spawnSync } from 'node:child_process';
export const refuse = reason => { throw Object.assign(new Error(`blocked-user-cleanup-${reason}`), { reason }); };
export function githubRead(path, { cwd, timeoutMs = 15000 } = {}) {
  const result = spawnSync('gh', ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28', path], { cwd, encoding: 'utf8', maxBuffer: 499000,
    timeout: timeoutMs, killSignal: 'SIGKILL', detached: process.platform !== 'win32',
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    if (result.pid && process.platform !== 'win32') process.kill(-result.pid, 'SIGKILL');
    else if (result.pid) spawnSync('taskkill', ['/PID', String(result.pid), '/T', '/F'], { timeout: 1000, stdio: 'ignore' });
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (result.error || result.status !== 0) refuse('provider-read');
  try { return JSON.parse(result.stdout); } catch { return refuse('provider-json'); }
}
export function reviewOptions(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository ?? '')
    || !Number.isSafeInteger(value.pr) || value.pr < 1
    || !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/u.test(value.workflow ?? '')
    || !Array.isArray(value.requiredChecks) || !value.requiredChecks.length || value.requiredChecks.length > 8
    || value.requiredChecks.some(c => typeof c !== 'string' || !c.trim() || Buffer.byteLength(c) > 128
      || /[\x00-\x1f\x7f]/u.test(c))
    || JSON.stringify([...new Set(value.requiredChecks)].sort()) !== JSON.stringify(value.requiredChecks)) refuse('review-options');
}
export function observeMergedReview(value, { cwd, api = githubRead } = {}) {
  reviewOptions(value);
  const started = Date.now(), prefix = `repos/${value.repository}`;
  const read = path => {
    const remaining = 120000 - (Date.now() - started); if (remaining <= 0) refuse('provider-deadline');
    return api(path, { cwd, timeoutMs: Math.min(15000, remaining) });
  };
  const pull = read(`${prefix}/pulls/${value.pr}`);
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
  if (pull?.number !== value.pr || pull.merged !== true || pull.state !== 'closed'
    || pull.base?.ref !== 'main' || pull.base?.repo?.full_name !== value.repository
    || pull.head?.repo?.full_name !== value.repository || !sha(pull.head?.sha) || !sha(pull.merge_commit_sha)
    || typeof pull.head?.ref !== 'string' || !pull.head.ref || !Number.isFinite(Date.parse(pull.merged_at))
    || pull.html_url !== `https://github.com/${value.repository}/pull/${value.pr}`) refuse('merged-review');
  const response = read(`${prefix}/commits/${pull.head.sha}/check-runs?filter=latest&per_page=100`);
  if (!Array.isArray(response?.check_runs) || response.total_count !== response.check_runs.length
    || response.total_count > 100) refuse('check-page-incomplete');
  const checks = value.requiredChecks.map(name => {
    const candidates = response.check_runs.filter(c => c.name === name);
    if (candidates.length !== 1) refuse('check-ambiguous-or-missing');
    const c = candidates[0];
    if (c.status !== 'completed' || c.conclusion !== 'success' || c.head_sha !== pull.head.sha
      || c.app?.slug !== 'github-actions' || !Number.isSafeInteger(c.id) || c.id < 1) refuse('check-not-successful');
    const prefix = `https://github.com/${value.repository}/actions/runs/`;
    const suffix = c.details_url?.startsWith(prefix) ? c.details_url.slice(prefix.length) : '';
    const match = suffix.match(/^(\d+)\/job\/(\d+)$/u);
    if (!match || Number(match[2]) !== c.id || !Number.isSafeInteger(Number(match[1]))) refuse('check-locator');
    const run = read(`repos/${value.repository}/actions/runs/${match[1]}`);
    if (run?.id !== Number(match[1]) || run.head_sha !== pull.head.sha || run.head_branch !== pull.head.ref
      || run.repository?.full_name !== value.repository || run.head_repository?.full_name !== value.repository
      || run.event !== 'pull_request' || run.path !== value.workflow || run.status !== 'completed'
      || run.conclusion !== 'success' || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) refuse('check-run-binding');
    return { name, checkId: c.id, runId: run.id, attempt: run.run_attempt, workflow: run.path,
      conclusion: 'success', url: c.details_url };
  });
  return { repository: value.repository, pr: value.pr, url: pull.html_url, branch: pull.head.ref,
    head: pull.head.sha, merge: pull.merge_commit_sha, mergedAt: pull.merged_at, checks,
    protectionProven: false, authority: 'observation-only' };
}
