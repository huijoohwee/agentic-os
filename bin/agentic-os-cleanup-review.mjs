/** Bounded read-only GitHub merge/check evidence, never protected-integration authority. */
import { spawnSync } from 'node:child_process';
import { RECOVERY_MODE, recoveryChecks, reviewedCheckRun, refuse } from './agentic-os-cleanup-recovery.mjs';
export { refuse } from './agentic-os-cleanup-recovery.mjs';
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
  const noCI = value.mode === 'explicit-local-user-consent-no-ci';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository ?? '')
    || !Number.isSafeInteger(value.pr) || value.pr < 1
    || (noCI ? value.workflow !== null : !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/u.test(value.workflow ?? ''))
    || !Array.isArray(value.requiredChecks)
    || (noCI ? value.requiredChecks.length !== 0 : !value.requiredChecks.length || value.requiredChecks.length > 8)
    || value.requiredChecks.some(c => typeof c !== 'string' || !c.trim() || Buffer.byteLength(c) > 128
      || /[\x00-\x1f\x7f]/u.test(c))
    || JSON.stringify([...new Set(value.requiredChecks)].sort()) !== JSON.stringify(value.requiredChecks)) refuse('review-options');
}
function mergedReview(value, { cwd, api = githubRead }) {
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
  return { read, pull, response, prefix };
}
export function inferMergedReviewWorkflow({ repository, pr, requiredChecks }, options = {}) {
  reviewOptions({ repository, pr, requiredChecks, workflow: '.github/workflows/placeholder.yml', mode: RECOVERY_MODE });
  const { read, pull, response } = mergedReview({ repository, pr }, options);
  return recoveryChecks({ repository, requiredChecks }, pull, response.check_runs, read, { inferWorkflow: true })[0].workflow;
}
export function observeMergedReview(value, options = {}) {
  reviewOptions(value);
  const { read, pull, response, prefix } = mergedReview(value, options);
  if (value.mode === 'explicit-local-user-consent-no-ci') {
    const status = read(`${prefix}/commits/${pull.head.sha}/status`);
    if (response.total_count !== 0 || !Array.isArray(status?.statuses)
      || status.statuses.length !== 0 || status.state !== 'pending'
      || status.sha !== pull.head.sha) refuse('no-ci-evidence-drift');
  }
  const noCI = value.mode === 'explicit-local-user-consent-no-ci';
  const checks = noCI ? [] : value.mode === RECOVERY_MODE ? recoveryChecks(value, pull, response.check_runs, read) : value.requiredChecks.map(name => {
    const candidates = response.check_runs.filter(c => c.name === name);
    if (candidates.length !== 1) refuse('check-ambiguous-or-missing');
    const c = candidates[0];
    if (c.status !== 'completed' || c.conclusion !== 'success' || c.head_sha !== pull.head.sha
      || c.app?.slug !== 'github-actions' || !Number.isSafeInteger(c.id) || c.id < 1) refuse('check-not-successful');
    const run = reviewedCheckRun(value, pull, c, read);
    if (run.path !== value.workflow || run.status !== 'completed' || run.conclusion !== 'success') refuse('check-run-binding');
    return { name, checkId: c.id, runId: run.id, attempt: run.run_attempt, workflow: run.path,
      conclusion: 'success', url: c.details_url };
  });
  return { repository: value.repository, pr: value.pr, url: pull.html_url, branch: pull.head.ref,
    head: pull.head.sha, merge: pull.merge_commit_sha, mergedAt: pull.merged_at, checks,
    ...(noCI ? { noCI: true, checkRunsObserved: 0, legacyStatusesObserved: 0 } : {}),
    protectionProven: false, authority: 'observation-only' };
}
