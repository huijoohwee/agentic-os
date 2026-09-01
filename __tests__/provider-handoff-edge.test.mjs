import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { enqueue, PROVIDER_CAPABILITIES } from '../src/queue.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function strictOnlyFixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-provider-admission-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'origin.git');
  const lane = join(parent, 'lane');
  const support = join(parent, 'bin');
  const marker = join(parent, 'provider-called');
  const run = (args, cwd = root) => git(args, { cwd });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  mkdirSync(support);
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    capabilities: [PROVIDER_CAPABILITIES.STRICT],
    requiredChecks: ['Integration Gate'],
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'profile']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', 'origin', 'main']);
  const ref = 'agent/device/strict-provider';
  run(['worktree', 'add', '--quiet', '-b', ref, lane, 'main']);
  writeFileSync(join(lane, 'candidate.txt'), 'candidate\n');
  run(['add', 'candidate.txt'], lane);
  run(['commit', '--quiet', '--message', 'candidate'], lane);
  const gh = join(support, 'gh');
  writeFileSync(gh, '#!/bin/sh\n: > "$AGENTIC_OS_TEST_PROVIDER_MARKER"\nexit 97\n');
  chmodSync(gh, 0o755);
  return { bare, lane, marker, ref, support };
}

function finalSourceRaceFixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-provider-source-race-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  const support = join(parent, 'bin');
  const marker = join(parent, 'provider-final-observed');
  const ref = 'agent/device/source-race';
  const run = (args, cwd = root) => git(args, { cwd });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  mkdirSync(support);
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: {
      repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' },
    },
    capabilities: [PROVIDER_CAPABILITIES.PULL_REQUEST],
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'profile']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const base = run(['rev-parse', 'HEAD']);
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', 'origin', 'main']);
  run(['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git']);
  run(['worktree', 'add', '--quiet', '-b', ref, lane, 'main']);
  writeFileSync(join(lane, 'candidate.txt'), 'candidate\n');
  run(['add', 'candidate.txt'], lane);
  run(['commit', '--quiet', '--message', 'candidate'], lane);
  const head = run(['rev-parse', 'HEAD'], lane);
  const review = JSON.stringify({
    number: 31, state: 'OPEN', url: 'https://github.com/owner/repo/pull/31',
    headRefOid: head, headRefName: ref, baseRefName: 'main',
    body: `Source-Head: ${head}`,
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  });
  const gh = join(support, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version fixture"; exit 0; fi',
    'if [ "$1" = "repo" ]; then',
    "  echo '{\"nameWithOwner\":\"owner/repo\",\"defaultBranchRef\":{\"name\":\"main\"},\"url\":\"https://github.com/owner/repo\"}'",
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ]; then',
    '  case "$2" in',
    "    list) echo '[]' ;;",
    '    create) : ;;',
    `    view) printf '%s\\n' '${review}' ;;`,
    '    *) exit 91 ;;',
    '  esac',
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
    '  : > "$AGENTIC_OS_TEST_FINAL_PROVIDER_MARKER"',
    `  printf '%s\\n' '${JSON.stringify({ data: { resource: JSON.parse(review) } })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ]; then',
    '  case "$2" in',
    "    repos/owner/repo) echo '{\"allow_squash_merge\":true,\"allow_merge_commit\":true,\"allow_rebase_merge\":true,\"delete_branch_on_merge\":false}' ;;",
    "    repos/owner/repo/rulesets) echo '[]' ;;",
    "    repos/owner/repo/branches/main/protection) echo '{\"required_pull_request_reviews\":{\"required_approving_review_count\":1}}' ;;",
    '    *) exit 92 ;;',
    '  esac',
    '  exit 0',
    'fi',
    'exit 93',
    '',
  ].join('\n'));
  chmodSync(gh, 0o755);
  const gitWrapper = join(support, 'git');
  writeFileSync(gitWrapper, [
    '#!/bin/sh',
    'if [ "$1" = -c ] && [ "$3" = fetch ]; then',
    '  exec "$AGENTIC_OS_TEST_REAL_GIT" -c "$2" fetch "$4" "$5" "$6" "$7" -- "$AGENTIC_OS_TEST_BARE" "${10}"',
    'fi',
    'if [ "$1" = "push" ]; then',
    '  exec "$AGENTIC_OS_TEST_REAL_GIT" push "$2" -- "$AGENTIC_OS_TEST_BARE" "$5"',
    'fi',
    'if [ "$1" = "ls-remote" ]; then',
    '  output=$("$AGENTIC_OS_TEST_REAL_GIT" ls-remote --refs -- "$AGENTIC_OS_TEST_BARE" "$5")',
    '  status=$?',
    '  if [ -f "$AGENTIC_OS_TEST_FINAL_PROVIDER_MARKER" ]; then',
    '    "$AGENTIC_OS_TEST_REAL_GIT" --git-dir="$AGENTIC_OS_TEST_BARE" update-ref "refs/heads/$AGENTIC_OS_TEST_REF" "$AGENTIC_OS_TEST_BASE"',
    '    rm "$AGENTIC_OS_TEST_FINAL_PROVIDER_MARKER"',
    '  fi',
    '  [ -z "$output" ] || printf "%s\\n" "$output"',
    '  exit "$status"',
    'fi',
    'exec "$AGENTIC_OS_TEST_REAL_GIT" "$@"',
    '',
  ].join('\n'));
  chmodSync(gitWrapper, 0o755);
  return { bare, base, head, lane, marker, ref, support };
}

test('failed review discovery is observation failure, never a claimed write failure', () => {
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40),
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    provider: (args) => args[1] === 'list' ? null : assert.fail('observation must stop'),
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-observation-failed');
  assert.equal(receipt.reviewMutationAttempted, false);
  assert.equal(receipt.reviewRequiresAttention, false);
});

test('an unknown body edit stops later writes and recovers the exact review read-only', () => {
  const head = '1'.repeat(40);
  const calls = [];
  let attempted = false;
  let sourceChecks = 0;
  const existing = {
    number: 41, state: 'OPEN', url: 'https://github.com/owner/repo/pull/41',
    headRefOid: head, headRefName: 'agent/device/unknown-write', baseRefName: 'main',
    body: 'old body', headRepository: { nameWithOwner: 'owner/repo' },
    isCrossRepository: false,
  };
  const recovered = { ...existing, body: `updated\n\nSource-Head: ${head}`,
    mergeQueueEntry: { id: 'q41' } };
  const receipt = enqueue('agent/device/unknown-write', {
    expectedHead: head, expectedRepository: 'github.com/owner/repo', baseBranch: 'main',
    body: recovered.body, title: 'must not be attempted',
    assertSourceHead: () => { sourceChecks += 1; return true; },
    provider: (args) => {
      calls.push(args);
      if (args[1] === 'list') return [existing];
      if (args[0] === 'api') return { data: { resource: attempted ? recovered : existing } };
      if (args[1] === 'edit' && args.includes('--body')) { attempted = true; return null; }
      if (args[1] === 'view') return recovered;
      return assert.fail(`no later mutation is allowed: ${args.join(' ')}`);
    },
  });
  assert.equal(sourceChecks, 2);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-write-result-unknown');
  assert.equal(receipt.reviewMutationAttempted, true);
  assert.equal(receipt.reviewWriteResultUnknown, true);
  assert.equal(receipt.reviewReobservedAfterMutation, true);
  assert.equal(receipt.reviewReobservationExact, true);
  assert.equal(receipt.reviewRequiresAttention, true);
  assert.equal(receipt.pr.url, recovered.url);
  assert.equal(receipt.sourceHeadBound, true);
  assert.equal(calls.filter((args) => args.includes('--title')).length, 0);
  assert.equal(calls.filter((args) => args[1] === 'view').length, 1);
});

test('a successful edit cannot reuse stale queued evidence when both fresh reads fail', () => {
  const head = '2'.repeat(40);
  const calls = [];
  const stale = {
    number: 42, state: 'OPEN', url: 'https://github.com/owner/repo/pull/42',
    headRefOid: head, headRefName: 'agent/device/stale-write', baseRefName: 'main',
    body: `Source-Head: ${head}`, mergeQueueEntry: { id: 'stale-q42' },
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/stale-write', {
    expectedHead: head, expectedRepository: 'github.com/owner/repo', baseBranch: 'main',
    body: `updated\n\nSource-Head: ${head}`,
    assertSourceHead: () => true,
    provider: (args) => {
      calls.push(args);
      if (args[1] === 'list') return [stale];
      if (args[1] === 'edit') return '';
      if (args[1] === 'view' || args[0] === 'api') return null;
      return assert.fail(`unexpected provider call: ${args.join(' ')}`);
    },
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'written-but-identity-failed');
  assert.equal(receipt.reviewMutationAttempted, true);
  assert.equal(receipt.reviewWriteResultUnknown, false);
  assert.equal(receipt.reviewReobservedAfterMutation, false);
  assert.equal(receipt.reviewReobservationExact, false);
  assert.equal(receipt.sourceHeadBound, false);
  assert.equal(receipt.testedProtectedOrdering, false);
  assert.equal(receipt.pr.url, stale.url, 'prior evidence is retained only as an artifact');
  assert.equal(calls.filter((args) => args[1] === 'view').length, 1);
  assert.equal(calls.filter((args) => args[0] === 'api').length, 2);
});

test('a selected strict-check capability is observed before remote publication', (t) => {
  const subject = strictOnlyFixture(t);
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_PROVIDER_MARKER: subject.marker,
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-provider-observation-incomplete:.*provider-unavailable/u);
  assert.equal(spawnSync('git', [
    '--git-dir', subject.bare, 'show-ref', '--verify', '--quiet',
    `refs/heads/${subject.ref}`,
  ]).status, 1, 'selected provider policy must be admitted before publication');
});

test('CLI revalidates the exact remote source after the final provider observation', (t) => {
  const subject = finalSourceRaceFixture(t);
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
      AGENTIC_OS_TEST_BASE: subject.base,
      AGENTIC_OS_TEST_REF: subject.ref,
      AGENTIC_OS_TEST_FINAL_PROVIDER_MARKER: subject.marker,
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /blocked-provider-source-ref-race: provider effects retained/u);
  assert.equal(git(['--git-dir', subject.bare, 'rev-parse', `refs/heads/${subject.ref}`], {
    cwd: subject.lane,
  }), subject.base);
});

test('a missing canonical base is refused before provider access', () => {
  let called = false;
  const receipt = enqueue('agent/device/scope', {
    expectedHead: 'a'.repeat(40), expectedRepository: 'github.com/owner/repo',
    provider: () => { called = true; },
  });
  assert.equal(receipt.reason, 'base-identity-missing');
  assert.equal(called, false);
});

test('without tested-ordering capability a review is projected but auto-merge is not armed', () => {
  const head = 'b'.repeat(40);
  const review = {
    number: 8, state: 'OPEN', url: 'https://github.com/owner/repo/pull/8', headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'main', body: `Source-Head: ${head}`, autoMergeRequest: { enabledAt: 'now' },
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    assertSourceHead: () => true,
    provider: (args) => args[0] === 'api' ? { data: { resource: review } }
      : args[1] === 'list' ? [review]
        : args[1] === 'merge' ? assert.fail('must not arm auto-merge') : review,
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'tested-ordering-unavailable');
  assert.equal(receipt.orderingArmed, false);
  assert.equal(receipt.testedProtectedOrdering, false);
});

test('an already-observed queue entry survives a duplicate handoff command failure', () => {
  const head = 'c'.repeat(40);
  const review = {
    number: 9, state: 'OPEN', url: 'https://github.com/owner/repo/pull/9', headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'main', body: `Source-Head: ${head}`, autoMergeRequest: null,
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    assertSourceHead: () => true,
    provider: (args) => args[0] === 'api'
      ? { data: { resource: { ...review, mergeQueueEntry: { id: 'q9' } } } }
      : args[1] === 'list' ? [review]
        : args[1] === 'merge' ? null : review,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.testedProtectedOrdering, true);
});

test('read-only handoff recognizes external tested ordering without arming it', () => {
  const head = '9'.repeat(40);
  const calls = [];
  const review = {
    number: 19, state: 'OPEN', url: 'https://github.com/owner/repo/pull/19',
    headRefOid: head, headRefName: 'agent/device/scope', baseRefName: 'main',
    body: `Source-Head: ${head}`,
    headRepository: { nameWithOwner: 'owner/repo' },
    baseRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    title: 'must not edit',
    assertSourceHead: () => true,
    provider: (args) => {
      calls.push(args);
      if (args[1] === 'list') return [review];
      if (args[0] === 'api') return { data: { resource: {
        ...review, mergeQueueEntry: { id: 'external-q19' },
      } } };
      return assert.fail(`read-only observation must not mutate: ${args.join(' ')}`);
    },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.testedProtectedOrdering, true);
  assert.equal(receipt.reviewMutationAttempted, false);
  assert.equal(calls.some((args) => ['edit', 'merge'].includes(args[1])), false);
});

test('a queue entry never overrides an atomic review identity mismatch', () => {
  const expected = 'd'.repeat(40);
  const changed = 'e'.repeat(40);
  const calls = [];
  const projected = { state: 'OPEN', url: 'https://github.com/owner/repo/pull/10',
    headRefOid: changed, headRefName: 'agent/device/scope', baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: expected,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    provider: (args) => {
      calls.push(args);
      return args[1] === 'list' ? [projected]
        : args[0] === 'api'
          ? { data: { resource: { ...projected, headRefOid: changed,
            headRefName: 'agent/device/scope', baseRefName: 'main',
            body: `Source-Head: ${expected}`, mergeQueueEntry: { id: 'q10' } } } }
          : projected;
    },
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-identity-mismatch');
  assert.equal(receipt.testedProtectedOrdering, false);
  assert.equal(calls.some((args) => args[1] === 'edit' || args[1] === 'merge'), false);
});

test('CLI review discovery uses supported fields and binds same-repository identity', () => {
  const head = 'f'.repeat(40);
  const calls = [];
  const review = {
    state: 'OPEN', url: 'https://github.com/owner/repo/pull/11', headRefOid: head,
    headRefName: 'agent/device/scope', baseRefName: 'main',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: true,
    body: `Source-Head: ${head}`,
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    provider: (args) => {
      calls.push(args);
      if (args[1] === 'list') return [review];
      return assert.fail(`identity mismatch must not mutate: ${args.join(' ')}`);
    },
  });
  const fields = calls[0][calls[0].indexOf('--json') + 1];
  assert.match(fields, /isCrossRepository/u);
  assert.doesNotMatch(fields, /baseRepository/u);
  assert.equal(receipt.reason, 'review-identity-mismatch');
});

test('an existing queue receipt is refused when its exact source ref moved', () => {
  const head = '7'.repeat(40);
  const review = {
    number: 27, state: 'OPEN', url: 'https://github.com/owner/repo/pull/27',
    headRefOid: head, headRefName: 'agent/device/scope', baseRefName: 'main',
    body: `Source-Head: ${head}`,
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
    mergeQueueEntry: { id: 'q27' },
  };
  let checks = 0;
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    assertSourceHead: () => { checks += 1; return false; },
    provider: (args) => args[0] === 'api' ? { data: { resource: review } }
      : args[1] === 'list' ? [review] : assert.fail(`must not mutate: ${args.join(' ')}`),
  });
  assert.equal(checks, 1);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'source-ref-moved');
  assert.equal(receipt.sourceHeadBound, false);
  assert.equal(receipt.testedProtectedOrdering, false);
  assert.equal(receipt.pr.url, review.url);
});

test('provider handoff revalidates the source after its final observation', () => {
  const head = '8'.repeat(40);
  const review = {
    number: 28, state: 'OPEN', url: 'https://github.com/owner/repo/pull/28',
    headRefOid: head, headRefName: 'agent/device/scope', baseRefName: 'main',
    body: `Source-Head: ${head}`,
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
    mergeQueueEntry: { id: 'q28' },
  };
  let checks = 0;
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    title: 'scope',
    assertSourceHead: () => { checks += 1; return checks === 1; },
    provider: (args) => args[1] === 'list' ? []
      : args[1] === 'create' ? ''
        : args[1] === 'view' ? review
          : args[0] === 'api' ? { data: { resource: review } }
            : assert.fail(`unexpected provider call: ${args.join(' ')}`),
  });
  assert.equal(checks, 2);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'source-ref-moved');
  assert.equal(receipt.sourceHeadBound, false);
  assert.equal(receipt.reviewMutationAttempted, true);
  assert.equal(receipt.reviewRequiresAttention, true);
  assert.equal(receipt.pr.url, review.url);
});

test('an exact queued review cannot waive a failed source-head trailer verification', () => {
  const head = '6'.repeat(40);
  const review = {
    number: 29, state: 'OPEN', url: 'https://github.com/owner/repo/pull/29',
    headRefOid: head, headRefName: 'agent/device/scope', baseRefName: 'main',
    body: 'missing the source-head trailer',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
    mergeQueueEntry: { id: 'q29' },
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'main',
    title: 'scope', body: `Source-Head: ${head}`,
    assertSourceHead: () => true,
    provider: (args) => args[1] === 'list' ? []
      : args[1] === 'create' ? ''
        : args[1] === 'view' ? review
          : args[0] === 'api' ? { data: { resource: review } }
            : assert.fail(`unexpected provider call: ${args.join(' ')}`),
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'written-but-identity-failed');
  assert.equal(receipt.sourceHeadBound, true);
  assert.equal(receipt.reviewRequiresAttention, true);
  assert.equal(receipt.testedProtectedOrdering, true,
    'external queue effect remains observable but cannot authorize acceptance');
});
