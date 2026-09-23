import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { startWorkflow } from '../bin/agentic-os-workflow.mjs';
import { fileURLToPath } from 'node:url';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { put } from '../src/lane-records.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  resolveReleaseCommonCleanupRequest,
  runProgressiveCompletion,
  runReleaseCommonCleanup,
  runReleaseCommonCompleteWait,
  watchReleaseCommonReview,
} from '../bin/agentic-os-release-common-complete.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function clock() {
  let time = 0;
  const waits = [];
  return {
    now: () => time,
    sleep: async (ms) => { waits.push(ms); time += ms; },
    waits,
  };
}

function profile(cleanup = {
  localBranch: 'retain',
  remoteBranch: 'retain',
  remoteTrackingRef: 'retain',
  unreachableObjects: 'retain',
  worktreeProjection: 'quarantine',
  worktreeRegistration: 'quarantine',
}) {
  return createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    requiredChecks: ['budgets', 'test'],
    cleanup,
  });
}

function completeFixture(t, reviewState = 'MERGED', cleanup = profile().cleanup) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-release-common-complete-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  const support = join(parent, 'bin');
  const ref = 'agent/test-device/complete';
  const run = (args, cwd = root) => git(args, { cwd });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  mkdirSync(support);
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  writeFileSync(join(root, 'native-prd-tad-adr-mvp-gtm.md'), '# Native plan\n');
  const repositoryProfile = profile(cleanup);
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(repositoryProfile, null, 2)}\n`);
  run(['add', 'base.txt', '.agentic-os.json', 'native-prd-tad-adr-mvp-gtm.md']);
  run(['commit', '--quiet', '--message', 'base']);
  ensureRepositoryTrust(root, repositoryProfile, { allowCreate: true });
  const base = run(['rev-parse', 'HEAD']);
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  run(['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git']);
  run(['worktree', 'add', '--quiet', '-b', ref, lane, 'main']);
  writeFileSync(join(lane, 'candidate.txt'), 'candidate\n');
  run(['add', 'candidate.txt'], lane);
  run(['commit', '--quiet', '--message', 'candidate'], lane);
  const head = run(['rev-parse', 'HEAD'], lane);
  run(['push', '--quiet', bare, `${ref}:${ref}`], lane);
  if (reviewState === 'MERGED') {
    run(['merge', '--quiet', '--ff-only', ref]);
    run(['push', '--quiet', bare, 'main']);
  }
  put({
    ref,
    device: 'test-device',
    scope: 'complete',
    state: 'published',
    base: 'refs/remotes/origin/main',
    baseSha: base,
    worktree: lane,
    pr: 41,
    createdAt: new Date(0).toISOString(),
    head,
  }, root);
  const review = {
    number: 41,
    state: reviewState,
    url: 'https://github.com/owner/repo/pull/41',
    mergeStateStatus: reviewState === 'MERGED' ? 'CLEAN' : 'BLOCKED',
    headRefOid: head,
    headRefName: ref,
    baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' },
    isCrossRepository: false,
    body: `Source-Head: ${head}`,
  };
  const pull = {
    number: 41,
    merged: reviewState === 'MERGED',
    state: reviewState === 'MERGED' ? 'closed' : 'open',
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    head: { ref, sha: head, repo: { full_name: 'owner/repo' } },
    merge_commit_sha: reviewState === 'MERGED' ? run(['rev-parse', 'HEAD']) : null,
    merged_at: reviewState === 'MERGED' ? '2026-09-20T00:00:20Z' : null,
    html_url: review.url,
  };
  const checkRuns = {
    total_count: 2,
    check_runs: [
      {
        name: 'budgets',
        status: 'completed',
        conclusion: 'success',
        head_sha: head,
        app: { slug: 'github-actions', id: 15368 },
        id: 601,
        details_url: 'https://github.com/owner/repo/actions/runs/501/job/601',
        completed_at: '2026-09-20T00:00:10Z',
      },
      {
        name: 'test',
        status: 'completed',
        conclusion: 'success',
        head_sha: head,
        app: { slug: 'github-actions', id: 15368 },
        id: 602,
        details_url: 'https://github.com/owner/repo/actions/runs/501/job/602',
        completed_at: '2026-09-20T00:00:11Z',
      },
    ],
  };
  const workflowRun = {
    id: 501,
    head_sha: head,
    head_branch: ref,
    repository: { full_name: 'owner/repo' },
    head_repository: { full_name: 'owner/repo' },
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
  };
  const gh = join(support, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    `  printf '%s\\n' '${JSON.stringify([review])}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ]; then',
    '  for last; do :; done',
    `  if [ "$last" = 'repos/owner/repo/pulls/41' ]; then printf '%s\\n' '${JSON.stringify(pull)}'; exit 0; fi`,
    `  if [ "$last" = 'repos/owner/repo/commits/${head}/check-runs?filter=latest&per_page=100' ]; then printf '%s\\n' '${JSON.stringify(checkRuns)}'; exit 0; fi`,
    `  if [ "$last" = 'repos/owner/repo/actions/runs/501' ]; then printf '%s\\n' '${JSON.stringify(workflowRun)}'; exit 0; fi`,
    'fi',
    'exit 1',
    '',
  ].join('\n'));
  chmodSync(gh, 0o755);
  const gitWrapper = join(support, 'git');
  writeFileSync(gitWrapper, [
    '#!/bin/sh',
    'if [ "$1" = "-c" ] && [ "$3" = "fetch" ]; then',
    '  exec "$AGENTIC_OS_TEST_REAL_GIT" -c "$2" fetch --no-tags --atomic --no-write-fetch-head --no-auto-maintenance -- "$AGENTIC_OS_TEST_BARE" "+refs/heads/*:refs/remotes/origin/*"',
    'fi',
    'exec "$AGENTIC_OS_TEST_REAL_GIT" "$@"',
    '',
  ].join('\n'));
  chmodSync(gitWrapper, 0o755);
  return { root, ref, bare, support, lane };
}

function complete(subject, timeoutMs) {
  return spawnSync(process.execPath, [CLI, 'release-common', 'complete', `--ref=${subject.ref}`,
    `--timeout-ms=${timeoutMs}`], {
    cwd: subject.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
    },
  });
}

test('watch reports changed review progress and succeeds on merge', async () => {
  const timer = clock();
  const states = ['OPEN', 'OPEN', 'MERGED'];
  const events = [];
  const result = await watchReleaseCommonReview({ ref: 'agent/test/complete', head: 'a'.repeat(40), pr: 41 }, {
    timeoutMs: 20_000,
    now: timer.now,
    sleep: timer.sleep,
    emit: (event) => events.push(event),
    observeReview: async () => ({
      sourceHeadBound: true,
      reason: null,
      review: {
        number: 41,
        state: states.shift(),
        url: 'https://github.com/owner/repo/pull/41',
        mergeStateStatus: states.length === 2 ? 'BLOCKED' : 'CLEAN',
      },
    }),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(timer.waits, [5000, 5000]);
  assert.deepEqual(events.filter((event) => event.event === 'review_changed').map((event) => event.state),
    ['OPEN', 'OPEN', 'MERGED']);
});

test('unchanged review yields after two reads without authorizing closeout', async () => {
  const timer = clock(), events = [];
  const result = await watchReleaseCommonReview({ ref: 'agent/test/complete', head: 'a'.repeat(40) }, {
    ...timer, emit: event => events.push(event),
    observeReview: async () => ({ sourceHeadBound: true, review: { state: 'OPEN' } }),
  });
  assert.equal(result.code, 2);
  assert.equal(result.reason, 'unchanged-state');
  assert.equal(result.polls, 2);
  assert.deepEqual(timer.waits, [5000]);
  assert.equal(events.at(-1).event, 'verified_wait');
  assert.equal(events.at(-1).recheckAfterMs, 60000);
  assert.equal(events.at(-1).nextAction, 'continue_independent_work');
  assert.ok(events.every(event => event.authority === false && event.event !== 'merged'));
});

test('review count/deadline limits reject long waits and late merge evidence', async () => {
  const binding = { ref: 'agent/test/complete', head: 'a'.repeat(40) };
  await assert.rejects(watchReleaseCommonReview(binding, { timeoutMs: 60001,
    observeReview: () => assert.fail('provider called') }), /timeout-ms/);
  const timer = clock(); let calls = 0;
  const result = await watchReleaseCommonReview(binding, { ...timer, initialMs: 1,
    observeReview: async () => ({ sourceHeadBound: true,
      review: { state: 'OPEN', mergeStateStatus: `progress-${++calls}` } }),
  });
  assert.equal(result.code, 2);
  assert.equal(result.polls, 12);
  assert.equal(result.reason, 'observation-budget-elapsed');
  const late = clock();
  const expired = await watchReleaseCommonReview(binding, { ...late, timeoutMs: 1,
    observeReview: async (_, { remainingMs }) => {
      assert.equal(remainingMs(), 1); await late.sleep(2);
      return { sourceHeadBound: true, review: { state: 'MERGED' } };
    },
  });
  assert.equal(expired.code, 2);
  assert.equal(expired.reason, 'observation-window-elapsed');
});

for (const cachedReview of [41, null]) test(`complete closes an exact merged review with cached PR ${cachedReview}`, (t) => {
  const subject = completeFixture(t, 'MERGED');
  put({ ref: subject.ref, pr: cachedReview }, subject.root);
  const result = complete(subject, 1000);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"event":"merged"/u);
  assert.match(result.stdout, /"schema":"agentic-os\/sprint-finish\/v1"/u);
  assert.match(result.stdout, /"schema":"agentic-os\/completion-status\/v1"/u);
  assert.doesNotMatch(result.stderr, /blocked-release-common-complete-cleanup-required/u);
  assert.equal(existsSync(subject.lane), false);
  const statuses = result.stdout.split('\n')
    .filter((line) => line.includes('"schema":"agentic-os/completion-status/v1"'))
    .map((line) => JSON.parse(line));
  const settled = statuses.at(-1);
  assert.equal(settled.closeout.missionState, 'source_complete');
  assert.equal(settled.closeout.laneDisposition, 'quarantined');
  assert.equal(settled.cleanupVerified, true);
  assert.equal(settled.closeout.nextAction, null);
});

test('release-common complete returns success when the profile retains worktree cleanup', (t) => {
  const subject = completeFixture(t, 'MERGED', {
    localBranch: 'retain',
    remoteBranch: 'retain',
    remoteTrackingRef: 'retain',
    unreachableObjects: 'retain',
    worktreeProjection: 'retain',
    worktreeRegistration: 'retain',
  });
  const result = complete(subject, 1000);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"event":"merged"/u);
  assert.match(result.stdout, /"schema":"agentic-os\/completion-status\/v1"/u);
  const status = JSON.parse(result.stdout.split('\n')
    .filter((line) => line.includes('"schema":"agentic-os/completion-status/v1"')).at(-1));
  assert.equal(status.closeout.missionState, 'source_complete');
  assert.equal(status.closeout.laneDisposition, 'retained');
  assert.equal(status.lane.mounted, true);
});

test('release-common complete returns the verified wait code while the exact review stays open', (t) => {
  const subject = completeFixture(t, 'OPEN');
  const result = complete(subject, 1);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /verified-wait-release-common-complete/u);
  assert.doesNotMatch(result.stdout, /agentic-os\/sprint-finish\/v1/u);
});

test('cleanup request requires --stopped when a bundle is supplied', () => {
  assert.throws(() => resolveReleaseCommonCleanupRequest(['--ref=agent/test', '--bundle=/tmp/bundle.json']),
    /authenticated cleanup requires --stopped/u);
  assert.deepEqual(resolveReleaseCommonCleanupRequest(['--ref=agent/test']).bundlePath, null);
});

test('release-common cleanup plans and applies the exact bundle in one run', async (t) => {
  const fixture = completeFixture(t);
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-release-common-bundle-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const bundlePath = join(parent, 'bundle.json');
  writeFileSync(bundlePath, JSON.stringify({ cleanup: {}, integrationVerifier: {}, retirementVerifier: {} }));
  const output = [];
  const calls = [];
  const plan = { repository: 'github.com/owner/repo', authorizationDigest: 'a'.repeat(64), schema: 'agentic-os/completion-close-plan/v1' };
  const receipt = { schema: 'agentic-os/worktree-cleanup-receipt/v1', result: 'quarantined' };
  const code = await runReleaseCommonCleanup({
    root: fixture.root,
    ref: 'agent/test-device/complete',
    bundlePath,
    stopped: true,
    out: (line) => output.push(JSON.parse(line)),
    planCompletionClose: async (root, ref, bundle) => {
      calls.push({ step: 'plan', root, ref, bundle });
      return plan;
    },
    applyCompletionClose: async (root, ref, bundle, planned, authorization, options) => {
      calls.push({ step: 'apply', root, ref, bundle, planned, authorization, options });
      return receipt;
    },
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    step: 'plan',
    root: fixture.root,
    ref: 'agent/test-device/complete',
    bundle: { cleanup: {}, integrationVerifier: {}, retirementVerifier: {} },
  });
  assert.deepEqual(calls[1], {
    step: 'apply',
    root: fixture.root,
    ref: 'agent/test-device/complete',
    bundle: { cleanup: {}, integrationVerifier: {}, retirementVerifier: {} },
    planned: plan,
    authorization: plan.authorizationDigest,
    options: { stopped: true },
  });
  assert.deepEqual(output, [plan, receipt]);
});


test('cleanup prerequisites preserve merge observation and block only the cleanup effect', async t => {
  const s = completeFixture(t, 'OPEN'), repository = 'github.com/owner/repo';
  const revision = git(['rev-parse', 'HEAD'], { cwd: s.lane }), worktreeId = basename(s.lane);
  startWorkflow(s.root, repository, { revision, planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId,
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [
      { before: { memberId: worktreeId, phase: 'integration' }, after: { memberId: worktreeId, phase: 'cleanup' } },
    ] } } });
  let reads = 0; const errors = [];
  const result = await runReleaseCommonCompleteWait({ root: s.root, argv: [`--ref=${s.ref}`], profile: profile(),
    out: () => {}, err: text => errors.push(text), observeReview: () => { reads += 1; return { sourceHeadBound: true, review: { state: 'MERGED' } }; } });
  assert.equal(result, 0);
  assert.equal(reads, 1);
  assert.deepEqual(errors, []);
  const bundlePath = join(s.support, 'guarded-bundle.json');
  writeFileSync(bundlePath, '{}');
  let applies = 0;
  await assert.rejects(runReleaseCommonCleanup({ root: s.root, ref: s.ref, bundlePath, stopped: true, out: () => {},
    planCompletionClose: async () => ({ repository, authorizationDigest: 'a'.repeat(64) }),
    applyCompletionClose: async () => { applies += 1; },
  }), /blocked-workflow-dependencies/);
  assert.equal(applies, 0);
  assert.equal(git(['rev-parse', 'HEAD'], { cwd: s.lane }), revision);
});

for (const replaceTarget of [false, true]) test(`cleanup keeps its target workflow across asynchronous planning: replaceTarget=${replaceTarget}`, async t => {
  const s = completeFixture(t), repository = 'github.com/owner/repo';
  const revision = git(['rev-parse', 'HEAD'], { cwd: s.lane });
  const common = { revision, planningPath: 'native-prd-tad-adr-mvp-gtm.md',
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } };
  startWorkflow(s.root, repository, { ...common, worktreeId: basename(s.lane) });
  const bundlePath = join(s.support, 'switch-bundle.json'); writeFileSync(bundlePath, '{}');
  let applies = 0;
  const complete = () => runReleaseCommonCleanup({ root: s.root, ref: s.ref, bundlePath, stopped: true, out: () => {},
    planCompletionClose: async () => {
      git(['config', '--local', '--unset', 'agentic-os.workflowManifest'], { cwd: s.root });
      const nextRevision = replaceTarget ? git(['commit-tree', `${revision}^{tree}`, '-p', revision,
        '-m', 'replacement workflow source'], { cwd: s.root }) : revision;
      startWorkflow(s.root, repository, { ...common, revision: nextRevision,
        worktreeId: replaceTarget ? basename(s.lane) : 'unrelated-member' });
      return { repository, authorizationDigest: 'a'.repeat(64) };
    },
    applyCompletionClose: async () => { applies += 1; },
  });
  if (replaceTarget) await assert.rejects(complete(), /blocked-workflow-effect-identity-drift/);
  else assert.equal(await complete(), 0);
  assert.equal(applies, replaceTarget ? 0 : 1);
});

test('progressive completion closes serially, retains pending and detached work, and resumes without repeated cleanup', async t => {
  const s = completeFixture(t), directory = realpathSync(join(s.root, '..')), head = git(['rev-parse', 'HEAD'], { cwd: s.lane });
  let rows = ['a', 'b', 'c'].map(name => ({ path: join(directory, name), branch: `agent/test-device/${name}`, head }));
  rows.push({ path: join(directory, 'recovery'), branch: null, head, detached: true });
  const calls = [], events = []; let active = false;
  const options = { root: s.root, directory, policy: { protectedBranch: 'main' }, profile: profile(),
    inventory: () => [...rows], record: ref => ({ state: 'published', head, worktree: rows.find(row => row.branch === ref).path }),
    status: () => ({ closeout: { missionState: 'source_complete' } }), out: line => events.push(JSON.parse(line)),
    complete: async ref => {
      assert.equal(active, false); active = true; calls.push(ref); await Promise.resolve(); active = false;
      if (ref.endsWith('/b')) return 2;
      rows = rows.filter(row => row.branch !== ref); return 0;
    } };
  assert.equal(await runProgressiveCompletion(options), 1);
  assert.deepEqual(events.filter(e => e.event === 'worktree').map(e => e.status), ['source_complete', 'waiting', 'source_complete', 'blocked']);
  assert.equal(events.at(-1).completed, 2);
  assert.equal(await runProgressiveCompletion(options), 1);
  assert.deepEqual(calls, ['agent/test-device/a', 'agent/test-device/b', 'agent/test-device/c', 'agent/test-device/b']);
  assert.equal(rows.length, 2);
});

test('progressive completion does not count deploy-bound source closeout as end-to-end completion', async t => {
  const s = completeFixture(t), directory = realpathSync(join(s.root, '..'));
  const head = git(['rev-parse', 'HEAD'], { cwd: s.lane });
  const ref = 'agent/test-device/delivery';
  const events = [];
  const code = await runProgressiveCompletion({ root: s.root, directory,
    policy: { protectedBranch: 'main' }, profile: profile(),
    inventory: () => [{ path: join(directory, 'delivery'), branch: ref, head }],
    record: () => ({ state: 'published', head, worktree: join(directory, 'delivery') }),
    complete: async () => 0,
    status: () => ({ closeout: { missionState: 'source_complete', adlcState: 'delivery_pending' } }),
    out: line => events.push(JSON.parse(line)) });
  assert.equal(code, 2);
  assert.equal(events[0].status, 'delivery_pending');
  assert.equal(events.at(-1).completed, 0);
  assert.equal(events.at(-1).deliveryPending, 1);
});

test('progressive completion refuses changed identity and false completion; budget prevents later effects', async t => {
  const s = completeFixture(t), directory = realpathSync(join(s.root, '..')), head = git(['rev-parse', 'HEAD'], { cwd: s.lane });
  const rows = ['a', 'b'].map(name => ({ path: join(directory, name), branch: `agent/test-device/${name}`, head }));
  let reads = 0, calls = 0, time = 0; const events = [];
  const options = { root: s.root, directory, policy: { protectedBranch: 'main' }, profile: profile(),
    inventory: () => { reads += 1; return reads === 1 ? rows : rows.map(row => ({ ...row, head: '0'.repeat(40) })); },
    record: ref => ({ state: 'published', head, worktree: rows.find(row => row.branch === ref).path }),
    status: () => ({ closeout: { missionState: 'continuable' } }), out: line => events.push(JSON.parse(line)),
    complete: async () => { calls += 1; return 0; } };
  assert.equal(await runProgressiveCompletion(options), 1);
  assert.equal(calls, 0);
  assert.equal(events[0].reason, 'worktree-binding-drift');
  options.inventory = () => rows;
  assert.equal(await runProgressiveCompletion(options), 1);
  assert.equal(calls, 2);
  assert.equal(events.at(-1).completed, 0);
  let effects = 0;
  options.complete = async (_ref, _remaining, guard) => {
    rows.splice(0, rows.length, ...rows.map(row => ({ ...row, head: '0'.repeat(40) })));
    guard(); effects += 1; return 0;
  };
  assert.equal(await runProgressiveCompletion(options), 1);
  assert.equal(effects, 0);
  rows.splice(0, rows.length, ...rows.map(row => ({ ...row, head })));
  options.inventory = () => rows;
  options.now = () => time; options.timeoutMs = 10;
  options.complete = async () => { time = 11; return 2; };
  await runProgressiveCompletion(options);
  assert.equal(events.at(-2).reason, 'pass-budget');
  options.inventory = () => Array(33).fill(rows[0]);
  await assert.rejects(runProgressiveCompletion(options), /Select at most 32/);
});

test('progressive argument selection is exclusive and a pending review needs only one observation', async () => {
  assert.equal(validateCommandArguments('release-common', ['complete', '--worktrees=/tmp/lanes']), null);
  for (const extra of ['--ref=agent/test/x', '--bundle=/tmp/bundle', '--stopped'])
    assert.notEqual(validateCommandArguments('release-common', ['complete', '--worktrees=/tmp/lanes', extra]), null);
  const c = clock(); let reads = 0;
  const result = await watchReleaseCommonReview({ ref: 'agent/test/lane', head: 'a'.repeat(40) }, {
    once: true, now: c.now, sleep: c.sleep,
    observeReview: () => { reads += 1; return { sourceHeadBound: true, review: { state: 'OPEN' } }; },
  });
  assert.equal(result.code, 2); assert.equal(reads, 1); assert.deepEqual(c.waits, []);
});
