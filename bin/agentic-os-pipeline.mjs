/** Read-only GitHub Actions observations; never integration or runtime authority. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { option } from './agentic-os-argv.mjs';

const execute = promisify(execFile);
const states = new Set(['queued', 'requested', 'waiting', 'pending', 'in_progress', 'completed']);
const conclusions = new Set(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure']);
function requireFact(ok, reason) { if (!ok) throw new Error(`pipeline_${reason}`); }
function integer(value, min, max) {
  requireFact(Number.isSafeInteger(value) && value >= min && value <= max, 'invalid_bound');
  return value;
}
export function validateTarget(target) {
  requireFact(typeof target.repo === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(target.repo)
    && !['.', '..'].includes(target.repo.split('/')[1]), 'invalid_repository');
  requireFact(/^[0-9a-f]{40}$/.test(target.head), 'invalid_head');
  integer(target.run, 1, Number.MAX_SAFE_INTEGER); integer(target.attempt, 1, 1000);
  return target;
}
function validateState(value) {
  requireFact(states.has(value.status), 'invalid_status');
  requireFact(value.status === 'completed' ? conclusions.has(value.conclusion) : value.conclusion === null, 'invalid_conclusion');
}
function validateRun(value, target) {
  requireFact(value?.id === target.run && value.run_attempt === target.attempt
    && value.head_sha === target.head && value.repository?.full_name?.toLowerCase() === target.repo.toLowerCase()
    && value.html_url?.toLowerCase() === `https://github.com/${target.repo}/actions/runs/${target.run}`.toLowerCase(), 'run_binding_changed');
  validateState(value);
}
function timestamp(value) {
  if (value === null || value === undefined) return null;
  requireFact(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'invalid_step_timestamp');
  return value;
}
function stepInventory(job) {
  if (job.steps === undefined) return null; // Missing timing is unavailable, never zero duration.
  requireFact(Array.isArray(job.steps) && job.steps.length <= 100, 'step_inventory_incomplete');
  const numbers = new Set();
  return job.steps.map(step => {
    requireFact(step && Number.isSafeInteger(step.number) && step.number > 0 && !numbers.has(step.number)
      && typeof step.name === 'string' && step.name.length > 0 && step.name.length <= 512, 'step_binding_invalid');
    validateState(step); numbers.add(step.number);
    const startedAt = timestamp(step.started_at), completedAt = timestamp(step.completed_at);
    requireFact(completedAt === null || step.status === 'completed'
      && (startedAt === null || Date.parse(completedAt) >= Date.parse(startedAt)), 'invalid_step_timing');
    return { number: step.number, name: step.name, status: step.status, conclusion: step.conclusion,
      startedAt, completedAt, durationMs: startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null };
  }).sort((a, b) => a.number - b.number);
}
function activeSteps(jobs, wallNow) {
  const observed = wallNow();
  requireFact(Number.isSafeInteger(observed) && observed >= 0, 'invalid_observation_clock');
  return jobs.flatMap(job => (job.steps ?? []).filter(step => step.status === 'in_progress').map(step => ({
    jobId: job.id, jobName: job.name, number: step.number, name: step.name, startedAt: step.startedAt,
    elapsedMs: step.startedAt ? Math.max(0, observed - Date.parse(step.startedAt)) : null,
  })));
}

// A fresh run observation on both sides prevents a rerun from relabeling old jobs.
// One page is an explicit bound, never a truncated claim of all jobs succeeding.
export async function githubSnapshot(target, { request, remainingMs }) {
  validateTarget(target);
  const base = `repos/${target.repo}/actions/runs/${target.run}`;
  const before = await request(base, remainingMs()); validateRun(before, target);
  const page = await request(`${base}/attempts/${target.attempt}/jobs?per_page=100`, remainingMs());
  requireFact(Number.isSafeInteger(page?.total_count) && page.total_count >= 0 && page.total_count <= 100
    && Array.isArray(page.jobs) && page.jobs.length === page.total_count, 'job_inventory_incomplete');
  const ids = new Set();
  const jobs = page.jobs.map(job => {
    requireFact(Number.isSafeInteger(job.id) && job.id > 0 && !ids.has(job.id)
      && job.run_id === target.run && job.run_attempt === target.attempt && job.head_sha === target.head
      && typeof job.name === 'string' && job.name.length > 0 && job.name.length <= 512, 'job_binding_invalid');
    validateState(job); ids.add(job.id);
    return { id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, steps: stepInventory(job) };
  }).sort((a, b) => a.id - b.id);
  const after = await request(base, remainingMs()); validateRun(after, target);
  // Completion may land between requests. Observe again before reporting it.
  const coherent = after.status !== 'completed' || (before.status === 'completed'
    && jobs.every(job => job.status === 'completed' && (after.conclusion !== 'success'
      || (job.steps ?? []).every(step => step.status === 'completed'))));
  return { status: after.status, conclusion: after.conclusion, jobs, coherent };
}

export async function watchPipeline(target, {
  timeoutMs = 60_000, initialMs = 5_000, maxMs = 60_000,
  now = () => performance.now(), wallNow = Date.now, sleep = delay, snapshot, emit = () => {},
} = {}) {
  validateTarget(target);
  integer(timeoutMs, 1, 10_800_000); integer(initialMs, 1, 60_000); integer(maxMs, initialMs, 60_000);
  const started = now(); const deadline = started + timeoutMs;
  const remainingMs = () => Math.max(0, Math.ceil(deadline - now()));
  let polls = 0; let interval = initialMs; let previous = null; let latestJobs = [];
  const jobs = new Map();
  const send = (event, detail = {}) => emit({ schema: 'agentic-os/pipeline-observation/v1',
    event, ...target, elapsedMs: Math.round(now() - started), polls, authority: false, ...detail });
  while (remainingMs() > 0) {
    const current = await snapshot(target, { remainingMs }); polls++;
    if (remainingMs() === 0) break; // A late response cannot extend the observation window.
    latestJobs = current.jobs;
    let changed = false;
    for (const job of current.jobs) {
      const key = JSON.stringify(job);
      if (jobs.get(job.id) !== key) {
        jobs.set(job.id, key); changed = true;
        send(job.status === 'completed' ? 'job_completed' : 'job_changed', { job,
          activeSteps: activeSteps([job], wallNow) });
      }
    }
    const run = JSON.stringify([current.status, current.conclusion, current.coherent]);
    if (run !== previous) { changed = true; previous = run;
      send('run_changed', { status: current.status, conclusion: current.conclusion }); }
    if (current.status === 'completed' && current.coherent) {
      send('completed', { conclusion: current.conclusion,
        nextAction: current.conclusion === 'success' ? 'verify_next_owner_boundary' : 'inspect_failure_before_retry' });
      return current.conclusion === 'success' ? 0 : 1;
    }
    interval = changed ? initialMs : Math.min(maxMs, interval * 2);
    await sleep(Math.min(interval, remainingMs()));
  }
  send('verified_wait', { reason: 'observation_window_elapsed', recheckAfterMs: maxMs,
    activeSteps: activeSteps(latestJobs, wallNow), nextAction: 'observe_same_run_and_attempt',
    completionEstimate: null, estimateReason: 'comparable_duration_evidence_not_supplied' });
  return 2;
}

export async function runPipeline(argv) {
  const target = validateTarget({ repo: option(argv, 'repo'), run: Number(option(argv, 'run')),
    head: option(argv, 'head'), attempt: Number(option(argv, 'attempt')) });
  const timeoutMs = Number(option(argv, 'timeout-ms', '60000'));
  const request = async (endpoint, remaining) => {
    requireFact(remaining > 0, 'observation_deadline');
    let result;
    try {
      result = await execute('gh', ['api', '--hostname', 'github.com', '--method', 'GET', endpoint], {
        timeout: Math.min(15_000, remaining), maxBuffer: 499_000,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' },
      });
    } catch { throw new Error('pipeline_provider_unavailable'); }
    try { return JSON.parse(result.stdout); } catch { throw new Error('pipeline_provider_invalid_json'); }
  };
  return watchPipeline(target, { timeoutMs,
    snapshot: (binding, bounds) => githubSnapshot(binding, { ...bounds, request }),
    emit: event => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
}
