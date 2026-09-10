import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { CACHE_LIMITS, get, save, SCHEMA } from '../src/lane-records.mjs';
import { PROVIDER_CAPABILITIES } from '../src/queue.mjs';
import { pullRequestText } from '../bin/agentic-os-auxiliary.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

function reviewProjectionFixture(t, {
  exactBody = false, saturatedCache = false, removeRemoteAfterHandoff = false, existingReview = false,
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
  const base = run(['rev-parse', 'HEAD']);
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
    body: exactBody ? `---\nscope: metadata\n---\nAuthored review text.\nSource-Head: ${head}`
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
    `    list) printf '%s\\n' '${JSON.stringify(existingReview ? [review] : [])}' ;;`,
    '    create)',
    '      if [ -n "$AGENTIC_OS_TEST_EFFECTS_LOG" ]; then echo review >> "$AGENTIC_OS_TEST_EFFECTS_LOG"; fi',
    '      if [ -n "$AGENTIC_OS_TEST_BODY_CAPTURE" ]; then',
    '        while [ "$#" -gt 0 ]; do',
    '          if [ "$1" = --body ]; then printf %s "$2" > "$AGENTIC_OS_TEST_BODY_CAPTURE"; break; fi',
    '          shift',
    '        done',
    '      fi',
    "      echo 'https://github.com/owner/repo/pull/41' ;;",
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
    '  push)',
    '    if [ -n "$AGENTIC_OS_TEST_EFFECTS_LOG" ]; then echo push >> "$AGENTIC_OS_TEST_EFFECTS_LOG"; fi',
    '    if [ -n "$AGENTIC_OS_TEST_MUTATE_BODY" ]; then printf "changed during push" > "$AGENTIC_OS_TEST_MUTATE_BODY"; fi',
    '    exec "$AGENTIC_OS_TEST_REAL_GIT" push "$2" -- "$AGENTIC_OS_TEST_BARE" "$5" ;;',
    '  ls-remote) exec "$AGENTIC_OS_TEST_REAL_GIT" ls-remote --refs -- "$AGENTIC_OS_TEST_BARE" "$5" ;;',
    '  *) exec "$AGENTIC_OS_TEST_REAL_GIT" "$@" ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(gitWrapper, 0o755);
  return { bare, base, head, lane, ref, support, parent,
    bodyFile: join(parent, 'review body.md'), bodyCapture: join(parent, 'captured body.md'),
    effectsLog: join(parent, 'publication.log') };
}

function land(subject, argv = [], env = {}) {
  return spawnSync(process.execPath, [CLI, 'land', ...argv], {
    cwd: subject.lane, encoding: 'utf8', timeout: 60_000,
    env: {
      ...process.env, PATH: `${subject.support}:${process.env.PATH}`,
      AGENTIC_OS_TEST_REAL_GIT: execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      AGENTIC_OS_TEST_BARE: subject.bare,
      AGENTIC_OS_TEST_BODY_CAPTURE: subject.bodyCapture,
      AGENTIC_OS_TEST_EFFECTS_LOG: subject.effectsLog,
      ...env,
    },
  });
}

function identity(subject) {
  return `Lane: ${subject.ref}\nBase-Revision: ${subject.base}\nSource-Head: ${subject.head}`;
}

test('repeated CLI landing preserves the reviewed body without repeating review mutations', t => {
  const subject = reviewProjectionFixture(t, { exactBody: true, existingReview: true });
  const first = land(subject);
  assert.equal(first.status, 0, first.stderr);
  const effects = readFileSync(subject.effectsLog, 'utf8');
  assert.equal(effects, 'push\n', 'existing review must not be edited or recreated');
  const second = land(subject);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(subject.effectsLog, 'utf8'), effects);
  assert.equal(get(subject.ref, subject.lane).handoff.pr.body,
    `---\nscope: metadata\n---\nAuthored review text.\nSource-Head: ${subject.head}`);
});

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
  const result = land(subject);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /projected exact review/u);
  const projected = get(subject.ref, subject.lane);
  assert.equal(projected.handoff.reason, 'tested-ordering-unavailable');
  assert.equal(projected.handoff.reviewRequiresAttention, false);
  assert.equal(projected.handoff.sourceHeadBound, true);
  assert.equal(projected.handoff.testedProtectedOrdering, false);
  assert.equal(readFileSync(subject.bodyCapture, 'utf8'), identity(subject));
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

test('land rejects invalid body files before any publication', async (t) => {
  const subject = reviewProjectionFixture(t, { exactBody: true });
  // Exercise every real file through the production validator. Keep CLI coverage
  // for unreadable input and the identity-dependent budget; repeating the whole
  // publication preflight for each text encoding adds no distinct boundary.
  const rejectsBody = (path, throughCli = false) => {
    if (throughCli) {
      const result = land(subject, [`--body-file=${path}`]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /blocked-review-body-invalid/u);
    } else {
      assert.throws(() => pullRequestText(subject.lane, subject.ref, subject.head,
        subject.base, path), { reason: 'blocked-review-body-invalid' });
    }
    assert.equal(existsSync(subject.effectsLog), false);
    assert.equal(existsSync(subject.bodyCapture), false);
  };
  const cases = [
    ['missing', null], ['empty', ' \r\n'], ['invalid UTF-8', Buffer.from([0xff])],
    ['NUL', 'summary\0metadata'], ['oversize', 'x'.repeat(65_537)],
    ['suffix exceeds budget', 'x'.repeat(65_536 - Buffer.byteLength(identity(subject)) - 1)],
    ['Lane trailer', '---\nLane: authored\n---'],
    ['Base-Revision trailer', 'summary\r\nBase-Revision: authored'],
    ['Source-Head trailer', 'summary\n\tSource-Head: authored'],
  ];
  for (const [name, bytes] of cases) await t.test(name, () => {
    const path = join(subject.parent, name);
    if (bytes !== null) writeFileSync(path, bytes);
    rejectsBody(path, name === 'missing' || name === 'suffix exceeds budget');
  });
  for (const kind of ['directory', 'symlink']) await t.test(kind, () => {
    const path = join(subject.parent, kind);
    if (kind === 'directory') mkdirSync(path);
    else symlinkSync(join(subject.lane, 'candidate.txt'), path);
    rejectsBody(path);
  });
  assert.equal(git(['--git-dir', subject.bare, 'for-each-ref', '--format=%(refname)',
    `refs/heads/${subject.ref}`], { cwd: subject.lane }), '');
});

test('land captures metadata bytes before push and appends exact native identity once', (t) => {
  const subject = reviewProjectionFixture(t, { exactBody: true });
  const authored = '---\r\naction: publish\r\nscope: café\r\n---\r\n\r\nA $() `literal` summary.\r\n';
  writeFileSync(subject.bodyFile, authored);
  const result = land(subject, [`--body-file=${subject.bodyFile}`], {
    AGENTIC_OS_TEST_MUTATE_BODY: subject.bodyFile,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(subject.bodyFile, 'utf8'), 'changed during push');
  const captured = readFileSync(subject.bodyCapture, 'utf8');
  assert.equal(captured, `${authored}\n\n${identity(subject)}`);
  for (const trailer of ['Lane:', 'Base-Revision:', 'Source-Head:'])
    assert.equal(captured.split('\n').filter((line) => line.startsWith(trailer)).length, 1);
  assert.equal(readFileSync(subject.effectsLog, 'utf8'), 'push\nreview\n');

  writeFileSync(subject.bodyFile, 'Source-Head: conflicting identity');
  const retry = land(subject, [`--body-file=${subject.bodyFile}`]);
  assert.equal(retry.status, 1, retry.stderr);
  assert.match(retry.stderr, /blocked-review-body-invalid/u);
  assert.equal(readFileSync(subject.effectsLog, 'utf8'), 'push\nreview\n');
  assert.equal(readFileSync(subject.bodyCapture, 'utf8'), captured);
});

test('land accepts exactly the total byte budget and preserves a UTF-8 BOM', (t) => {
  const subject = reviewProjectionFixture(t, { exactBody: true });
  const prefix = '\uFEFF---\nsummary: café\n---\n';
  const suffix = `\n\n${identity(subject)}`;
  const authored = prefix + 'x'.repeat(65_536 - Buffer.byteLength(prefix + suffix, 'utf8'));
  writeFileSync(subject.bodyFile, authored);
  const result = land(subject, [`--body-file=${subject.bodyFile}`]);
  assert.equal(result.status, 0, result.stderr);
  const captured = readFileSync(subject.bodyCapture);
  assert.equal(captured.byteLength, 65_536);
  assert.deepEqual(captured, Buffer.from(authored + suffix));
});
