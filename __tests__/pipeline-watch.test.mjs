import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { githubSnapshot, watchPipeline, validateTarget } from '../bin/agentic-os-pipeline.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const target = { repo: 'owner/repo', run: 123, head: 'a'.repeat(40), attempt: 2 };
const job = { id: 10, run_id: 123, run_attempt: 2, head_sha: target.head,
  name: 'linux build', status: 'completed', conclusion: 'success' };
const run = { id: 123, run_attempt: 2, head_sha: target.head,
  repository: { full_name: target.repo }, html_url: 'https://github.com/owner/repo/actions/runs/123',
  status: 'in_progress', conclusion: null };
const page = { total_count: 1, jobs: [job] };
async function observe(responses) {
  const endpoints = [];
  const result = await githubSnapshot(target, { remainingMs: () => 5000,
    request: async endpoint => { endpoints.push(endpoint); return responses.shift(); } });
  return { result, endpoints };
}
function clock() {
  let time = 0; const waits = []; const events = [];
  return { now: () => time, sleep: async ms => { waits.push(ms); time += ms; },
    emit: event => events.push(event), waits, events, advance: ms => { time += ms; } };
}

test('fresh attempt-specific job inventory is bracketed by exact run observations', async () => {
  const { result, endpoints } = await observe([run, page, run]);
  assert.deepEqual(endpoints, ['repos/owner/repo/actions/runs/123',
    'repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100', 'repos/owner/repo/actions/runs/123']);
  assert.equal(result.jobs[0].conclusion, 'success');
  assert.equal(result.status, 'in_progress');
});

test('step timing preserves identity, elapsed duration and unavailable timestamps', async () => {
  const timed = { ...job, steps: [
    { number: 2, name: 'skipped step', status: 'completed', conclusion: 'skipped', started_at: null, completed_at: null },
    { number: 1, name: 'integration', status: 'completed', conclusion: 'success',
      started_at: '2026-09-10T11:00:00Z', completed_at: '2026-09-10T11:02:30Z' },
  ] };
  const { result } = await observe([run, { total_count: 1, jobs: [timed] }, run]);
  assert.deepEqual(result.jobs[0].steps.map(step => [step.number, step.durationMs]), [[1, 150000], [2, null]]);
  for (const steps of [[timed.steps[0], timed.steps[0]], Array(101).fill(timed.steps[0]),
    [{ ...timed.steps[1], completed_at: '2026-09-10T10:59:59Z' }],
    [{ ...timed.steps[1], started_at: 'not a timestamp' }], [null],
    [{ ...timed.steps[1], started_at: '2026-02-30T11:00:00Z' }]]) {
    await assert.rejects(observe([run, { total_count: 1, jobs: [{ ...job, steps }] }, run]), /pipeline_/);
  }
});

test('step progress changes reset backoff while elapsed time alone does not restart polling or jobs', async () => {
  const timer = clock(); let calls = 0;
  const step = { number: 1, name: 'integration', status: 'in_progress', conclusion: null,
    startedAt: '2026-09-10T11:00:00Z', completedAt: null, durationMs: null };
  const code = await watchPipeline(target, { ...timer, timeoutMs: 60000,
    wallNow: () => Date.parse(step.startedAt) + timer.now(),
    snapshot: async () => {
      calls++;
      return { status: 'in_progress', conclusion: null, coherent: true,
        jobs: [{ id: 10, name: 'linux', status: 'in_progress', conclusion: null,
          steps: [{ ...step, ...(calls >= 3 ? { number: 2, name: 'XR browser' } : {}) }] }] };
    } });
  assert.equal(code, 2);
  assert.deepEqual(timer.waits, [5000, 10000, 5000, 10000, 20000, 10000]);
  assert.equal(timer.events.filter(event => event.event === 'job_changed').length, 2);
  const wait = timer.events.at(-1);
  assert.equal(wait.activeSteps[0].name, 'XR browser');
  assert.equal(wait.activeSteps[0].elapsedMs, 60000);
  assert.equal(wait.completionEstimate, null);
  assert.equal(wait.nextAction, 'observe_same_run_and_attempt');
});

test('rerun, head, repository and URL drift fail closed before success', async () => {
  for (const delta of [{ run_attempt: 3 }, { head_sha: 'b'.repeat(40) },
    { repository: { full_name: 'elsewhere/repo' } }, { html_url: 'https://example.com' }, { id: 124 }]) {
    await assert.rejects(observe([run, page, { ...run, ...delta }]), /run_binding_changed/);
  }
});

test('partial, duplicate, foreign and malformed job inventories are rejected', async () => {
  for (const bad of [{ total_count: 101, jobs: [job] }, { total_count: 2, jobs: [job] },
    { total_count: 2, jobs: [job, job] }, ...[{ run_attempt: 3 }, { run_id: 124 },
      { head_sha: 'b'.repeat(40) }, { status: 'invented' }, { conclusion: null }]
      .map(delta => ({ total_count: 1, jobs: [{ ...job, ...delta }] }))]) {
    await assert.rejects(observe([run, bad, run]), /pipeline_/);
  }
});

test('completion racing the job read requires another fresh observation', async () => {
  const complete = { ...run, status: 'completed', conclusion: 'success' };
  assert.equal((await observe([run, page, complete])).result.coherent, false);
  assert.equal((await observe([complete, page, complete])).result.coherent, true);
  const pending = { total_count: 1, jobs: [{ ...job, steps: [
    { number: 1, name: 'pending', status: 'pending', conclusion: null },
  ] }] };
  assert.equal((await observe([complete, pending, complete])).result.coherent, false);
  const failed = { ...complete, conclusion: 'failure' };
  assert.equal((await observe([failed, pending, failed])).result.coherent, true);
});

test('one simulated hour reduces unchanged polls while bounding detection delay to 60 seconds', async () => {
  const timer = clock();
  const status = { status: 'in_progress', conclusion: null, coherent: true, jobs: [] };
  const code = await watchPipeline(target, { ...timer, timeoutMs: 3_600_000, snapshot: async () => status });
  assert.equal(code, 2);
  const receipt = timer.events.at(-1);
  assert.equal(receipt.event, 'verified_wait');
  assert.equal(receipt.polls, 63);
  assert.ok(receipt.polls < (3_600_000 / 5000) / 10);
  assert.equal(timer.waits.reduce((sum, n) => sum + n, 0), 3_600_000);
  assert.ok(timer.waits.every(n => n > 0 && n <= 60_000));
  assert.equal(timer.events.filter(e => e.event === 'run_changed').length, 1);
  assert.ok(timer.events.every(e => e.authority === false));
});

test('Linux completion is emitted while macOS continues and resets the backoff', async () => {
  const timer = clock(); let count = 0;
  const linux = { id: 1, name: 'linux', status: 'in_progress', conclusion: null };
  const mac = { ...linux, id: 2, name: 'mac' };
  const snapshot = async () => {
    count++;
    return { status: count < 5 ? 'in_progress' : 'completed', conclusion: count < 5 ? null : 'success', coherent: true,
      jobs: [{ ...linux, ...(count >= 3 ? { status: 'completed', conclusion: 'success' } : {}) },
        { ...mac, ...(count >= 5 ? { status: 'completed', conclusion: 'success' } : {}) }] };
  };
  assert.equal(await watchPipeline(target, { ...timer, snapshot }), 0);
  const linuxEvent = timer.events.find(e => e.event === 'job_completed' && e.job.name === 'linux');
  assert.ok(linuxEvent.elapsedMs < timer.events.at(-1).elapsedMs);
  assert.equal(timer.events.filter(e => e.event === 'job_completed').length, 2);
  assert.deepEqual(timer.waits, [5000, 10000, 5000, 10000]);
});

test('failure is terminal, provider errors are not success, and late reads do not extend a deadline', async () => {
  const timer = clock();
  assert.equal(await watchPipeline(target, { ...timer, snapshot: async () => ({
    status: 'completed', conclusion: 'failure', coherent: true, jobs: [] }) }), 1);
  await assert.rejects(watchPipeline(target, { snapshot: async () => { throw new Error('offline'); } }), /offline/);
  const late = clock();
  assert.equal(await watchPipeline(target, { ...late, timeoutMs: 1,
    snapshot: async () => { late.advance(2); return { status: 'completed', conclusion: 'success', coherent: true,
      jobs: [{ id: 10, name: 'late', steps: [{ number: 1, name: 'late step', status: 'in_progress', startedAt: null }] }] }; } }), 2);
  assert.deepEqual(late.events.map(e => e.event), ['verified_wait']);
  assert.deepEqual(late.events[0].activeSteps, []);
});

test('invalid inputs are rejected before provider access', async () => {
  for (const delta of [{ repo: '../bad' }, { head: 'short' }, { run: 0 }, { attempt: NaN }]) {
    assert.throws(() => validateTarget({ ...target, ...delta }), /pipeline_/);
  }
  for (const timeoutMs of [0, -1, NaN, 10_800_001]) {
    await assert.rejects(watchPipeline(target, { timeoutMs, snapshot: () => assert.fail('provider called') }), /invalid_bound/);
  }
  assert.match(validateCommandArguments('pipeline', ['--repo=owner/repo']), /missing/);
  assert.match(validateCommandArguments('pipeline', ['--execute']), /unknown/);
  const child = spawnSync(process.execPath, [new URL('../bin/agentic-os.mjs', import.meta.url).pathname,
    'pipeline', '--repo=owner/repo', '--run=1', '--head=bad', '--attempt=1'], { cwd: '/tmp', encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /pipeline_invalid_head/);
  assert.doesNotMatch(child.stderr, /not inside a git repository/);
});
