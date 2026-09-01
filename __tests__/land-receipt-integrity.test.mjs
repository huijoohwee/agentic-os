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
import { CACHE_LIMITS, get, save, SCHEMA } from '../src/lane-records.mjs';
import { PROVIDER_CAPABILITIES } from '../src/queue.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function reviewProjectionFixture(t, {
  exactBody = false, saturatedCache = false, removeRemoteAfterHandoff = false,
} = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-land-receipt-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  const support = join(parent, 'bin');
  const ref = 'agent/device/identity-failure';
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
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', 'origin', 'main']);
  run(['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git']);
  run(['worktree', 'add', '--quiet', '-b', ref, lane, 'main']);
  writeFileSync(join(lane, 'candidate.txt'), 'candidate\n');
  run(['add', 'candidate.txt'], lane);
  run(['commit', '--quiet', '--message', 'candidate'], lane);
  const head = run(['rev-parse', 'HEAD'], lane);
  if (saturatedCache) {
    const lanes = Object.fromEntries(Array.from({ length: CACHE_LIMITS.lanes }, (_, index) => {
      const filler = `agent/cache-device/filler-${index}`;
      return [filler, { ref: filler, state: 'active' }];
    }));
    save({ schema: SCHEMA, lanes }, lane);
  }
  const review = {
    number: 41, state: 'OPEN', url: 'https://github.com/owner/repo/pull/41',
    headRefOid: head, headRefName: ref, baseRefName: 'main',
    body: exactBody ? `Source-Head: ${head}`
      : 'provider dropped the required source-head trailer',
    headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  };
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
    "    create) echo 'https://github.com/owner/repo/pull/41' ;;",
    `    view) printf '%s\\n' '${JSON.stringify(review)}' ;;`,
    '    *) exit 91 ;;',
    '  esac',
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
    `  printf '%s\\n' '${JSON.stringify({ data: { resource: review } })}'`,
    ...(removeRemoteAfterHandoff
      ? ['  "$AGENTIC_OS_TEST_REAL_GIT" -C "$PWD" remote remove origin'] : []),
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
    'case "$1" in',
    '  push) exec "$AGENTIC_OS_TEST_REAL_GIT" push "$2" -- "$AGENTIC_OS_TEST_BARE" "$5" ;;',
    '  ls-remote) exec "$AGENTIC_OS_TEST_REAL_GIT" ls-remote --refs -- "$AGENTIC_OS_TEST_BARE" "$5" ;;',
    '  *) exec "$AGENTIC_OS_TEST_REAL_GIT" "$@" ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(gitWrapper, 0o755);
  return { bare, head, lane, ref, support };
}

test('land retains a review whose written identity cannot be verified', (t) => {
  const subject = reviewProjectionFixture(t);
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /provider handoff refused: written-but-identity-failed/u);
  assert.doesNotMatch(result.stdout, /authority-controlling candidate/u);
  const projected = get(subject.ref, subject.lane);
  assert.equal(projected.state, 'published');
  assert.equal(projected.handoff.reason, 'written-but-identity-failed');
  assert.equal(projected.handoff.reviewRequiresAttention, true);
  assert.equal(git(['--git-dir', subject.bare, 'rev-parse', `refs/heads/${subject.ref}`], {
    cwd: subject.lane,
  }), subject.head);
});

test('land tolerates only an exact non-attention review without tested ordering', (t) => {
  const subject = reviewProjectionFixture(t, { exactBody: true });
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /projected exact review/u);
  const projected = get(subject.ref, subject.lane);
  assert.equal(projected.handoff.reason, 'tested-ordering-unavailable');
  assert.equal(projected.handoff.reviewRequiresAttention, false);
  assert.equal(projected.handoff.sourceHeadBound, true);
  assert.equal(projected.handoff.testedProtectedOrdering, false);
});

test('provider mutation emits its exact bounded handoff when cache projection fails', (t) => {
  const subject = reviewProjectionFixture(t, { exactBody: true, saturatedCache: true });
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const retained = result.stderr.split('\n')
    .filter((entry) => entry.startsWith('{"schema":"agentic-os/lane-projection-retained/v1"'))
    .map((entry) => JSON.parse(entry)).find((entry) => entry.handoffProjection !== null);
  assert.ok(retained, result.stderr);
  assert.equal(retained.laneProjection.ref, subject.ref);
  assert.equal(retained.laneProjection.head, subject.head);
  assert.equal(retained.laneProjection.state, 'published');
  assert.equal(retained.laneProjection.pr, 41);
  assert.match(retained.handoffDigest, /^[0-9a-f]{64}$/u);
  assert.equal(retained.handoffProjection.receiptSchema,
    'agentic-os-provider-handoff/v1');
  assert.equal(retained.handoffProjection.reason, 'tested-ordering-unavailable');
  assert.equal(retained.handoffProjection.reviewMutationAttempted, true);
  assert.equal(retained.handoffProjection.reviewRequiresAttention, false);
  assert.equal(retained.handoffProjection.pr.number, 41);
  assert.equal(retained.handoffProjection.pr.headRefOid, subject.head);
  assert.equal(retained.cacheError.reason, 'blocked-lane-cache-invalid');
});

test('provider handoff remains projected when final observation cannot start', (t) => {
  const subject = reviewProjectionFixture(t, {
    exactBody: true, removeRemoteAfterHandoff: true,
  });
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: subject.lane,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /blocked-provider-final-observation: provider effects retained/u);
  const projected = get(subject.ref, subject.lane);
  assert.equal(projected.state, 'published');
  assert.equal(projected.head, subject.head);
  assert.equal(projected.pr, 41);
  assert.equal(projected.handoff.schema, 'agentic-os-provider-handoff/v1');
  assert.equal(projected.handoff.reviewMutationAttempted, true);
  assert.equal(projected.handoff.reviewRequiresAttention, true);
});
