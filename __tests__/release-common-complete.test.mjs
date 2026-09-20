import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { put } from '../src/lane-records.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  resolveReleaseCommonCleanupRequest,
  runReleaseCommonCleanup,
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

function profile() {
  return createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
  });
}

function completeFixture(t, reviewState = 'MERGED') {
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
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile(), null, 2)}\n`);
  run(['add', 'base.txt', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'base']);
  ensureRepositoryTrust(root, profile(), { allowCreate: true });
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
  const gh = join(support, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    `  printf '%s\\n' '${JSON.stringify([review])}'`,
    '  exit 0',
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
  return { root, ref, bare, support };
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

test('watch resets backoff when the exact review changes and succeeds on merge', async () => {
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
        mergeStateStatus: 'CLEAN',
      },
    }),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(timer.waits, [5000, 10000]);
  assert.deepEqual(events.filter((event) => event.event === 'review_changed').map((event) => event.state),
    ['OPEN', 'MERGED']);
});

test('release-common complete waits for a merged exact review, then runs closeout', (t) => {
  const subject = completeFixture(t, 'MERGED');
  const result = complete(subject, 1000);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"event":"merged"/u);
  assert.match(result.stdout, /"schema":"agentic-os\/sprint-finish\/v1"/u);
  assert.match(result.stdout, /"schema":"agentic-os\/completion-status\/v1"/u);
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
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-release-common-bundle-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const bundlePath = join(parent, 'bundle.json');
  writeFileSync(bundlePath, JSON.stringify({ cleanup: {}, integrationVerifier: {}, retirementVerifier: {} }));
  const output = [];
  const calls = [];
  const plan = { authorizationDigest: 'a'.repeat(64), schema: 'agentic-os/completion-close-plan/v1' };
  const receipt = { schema: 'agentic-os/worktree-cleanup-receipt/v1', result: 'quarantined' };
  const code = await runReleaseCommonCleanup({
    root: '/tmp/repository',
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
    root: '/tmp/repository',
    ref: 'agent/test-device/complete',
    bundle: { cleanup: {}, integrationVerifier: {}, retirementVerifier: {} },
  });
  assert.deepEqual(calls[1], {
    step: 'apply',
    root: '/tmp/repository',
    ref: 'agent/test-device/complete',
    bundle: { cleanup: {}, integrationVerifier: {}, retirementVerifier: {} },
    planned: plan,
    authorization: plan.authorizationDigest,
    options: { stopped: true },
  });
  assert.deepEqual(output, [plan, receipt]);
});
