import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { git } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { get, put } from '../src/lane-records.mjs';
import { parseWritePaths, provision, registeredLaneBranches, worktreeFor } from '../src/worktree.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const LANE_RECORDS_URL = new URL('../src/lane-records.mjs', import.meta.url).href;
const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-lean-sprint-'));
  const root = join(parent, 'repo');
  mkdirSync(root);
  const run = (args, options = {}) => git(args, { cwd: root, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  run(['add', 'base.txt', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'base']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, run };
}

function createLane(t, root, ref, scope) {
  const baseSha = git(['rev-parse', 'HEAD'], { cwd: root });
  const created = provision({ ref, scope, device: 'test-device', baseSha, cwd: root });
  t.after(() => {
    if (existsSync(created.path)) {
      git(['worktree', 'remove', '--force', created.path], { cwd: root });
    }
  });
  return created;
}

function publishedSuccessorFixture(t) {
  const subject = fixture(t), { parent, root, run } = subject;
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const predecessorRef = 'agent/test-device/published';
  const lane = createLane(t, root, predecessorRef, 'published');
  writeFileSync(join(lane.path, 'change.txt'), 'candidate\n');
  run(['add', 'change.txt'], { cwd: lane.path });
  run(['commit', '--quiet', '--message', 'candidate'], { cwd: lane.path });
  const publishedHead = run(['rev-parse', 'HEAD'], { cwd: lane.path });
  run(['push', '--quiet', 'origin', `${predecessorRef}:${predecessorRef}`], { cwd: lane.path });
  put({ ref: predecessorRef, device: 'test-device', scope: 'published', state: 'published',
    base: 'refs/remotes/origin/main', baseSha: run(['rev-parse', 'main']), worktree: lane.path,
    pr: 17, createdAt: new Date(0).toISOString(), head: publishedHead,
    writePaths: ['change.txt'] }, lane.path);
  writeFileSync(join(lane.path, 'change.txt'), 'candidate\nrepair\n');
  run(['add', 'change.txt'], { cwd: lane.path });
  run(['commit', '--quiet', '--message', 'repair'], { cwd: lane.path });
  const repairHead = run(['rev-parse', 'HEAD'], { cwd: lane.path });
  const invoke = (scope = 'repair', expected = null, env = {}) => spawnSync(process.execPath,
    [CLI, 'successor', scope, ...(expected ? [`--expected-head=${expected}`] : [])],
    { cwd: lane.path, encoding: 'utf8', env: { ...process.env, ...env } });
  return { ...subject, bare, lane, predecessorRef, publishedHead, repairHead, invoke };
}

test('successor preserves published identity and remains readable by the baseline v1 cache', async (t) => {
  const s = publishedSuccessorFixture(t);
  const result = s.invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }),
    'agent/test-device/repair');
  assert.equal(s.run(['rev-parse', s.predecessorRef]), s.repairHead);
  assert.equal(s.run(['rev-parse', 'agent/test-device/repair']), s.repairHead);
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse', `refs/heads/${s.predecessorRef}`]),
    s.publishedHead);
  const predecessor = get(s.predecessorRef, s.lane.path);
  assert.equal(predecessor.pr, 17);
  const successor = get('agent/test-device/repair', s.lane.path);
  assert.deepEqual(successor.writePaths, ['change.txt']);
  assert.equal(successor.baseSha, predecessor.baseSha);
  assert.deepEqual({ ...successor.handoff }, { schema: 'agentic-os-lane-successor/v1',
    predecessorRef: s.predecessorRef, predecessorHead: s.publishedHead });
  assert.equal(Object.keys(successor).some((key) =>
    ['predecessorRef', 'predecessorHead'].includes(key)), false);
  const baseline = join(s.parent, 'baseline-reader');
  git(['clone', '--quiet', SOURCE_ROOT, baseline], { cwd: s.parent });
  const baselineRecords = await import(pathToFileURL(join(baseline, 'src/lane-records.mjs')).href);
  assert.deepEqual(baselineRecords.get('agent/test-device/repair', s.lane.path), successor);
  const landed = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: s.lane.path, encoding: 'utf8',
  });
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse',
    'refs/heads/agent/test-device/repair']), s.repairHead);
});

test('successor refuses exact predecessor remote drift without changing local refs', (t) => {
  const s = publishedSuccessorFixture(t);
  const tree = s.run(['rev-parse', `${s.publishedHead}^{tree}`]);
  const drift = s.run(['commit-tree', tree, '-p', s.publishedHead, '-m', 'remote drift']);
  s.run(['push', '--quiet', '--force', s.bare,
    `${drift}:refs/heads/${s.predecessorRef}`]);
  const result = s.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-published-head-drift/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
  assert.equal(s.run(['rev-parse', s.predecessorRef]), s.repairHead);
  assert.equal(s.run(['rev-parse', '--verify', '--quiet', 'agent/test-device/repair'],
    { allowFail: true }), null);
});

test('explicit expected head recovers from stale cache state without granting authority to it', (t) => {
  const s = publishedSuccessorFixture(t);
  put({ ref: s.predecessorRef, state: 'active', head: 'a'.repeat(40) }, s.lane.path);
  const result = s.invoke('repair', s.publishedHead);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }),
    'agent/test-device/repair');
  assert.equal(get('agent/test-device/repair', s.lane.path).handoff.predecessorHead, s.publishedHead);
});

test('successor refuses a non-published cache hint without an explicit expected head', (t) => {
  const s = publishedSuccessorFixture(t);
  put({ ref: s.predecessorRef, state: 'active' }, s.lane.path);
  const result = s.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-successor-predecessor/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
  assert.equal(s.run(['rev-parse', s.predecessorRef]), s.repairHead);
});

test('cache activation failure preserves a resumable successor and exact predecessor', (t) => {
  const s = publishedSuccessorFixture(t);
  const support = join(s.parent, 'git-wrapper'), marker = join(s.parent, 'cache-failed');
  mkdirSync(support);
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = update-ref ] && [ "$2" = --no-deref ] &&',
    '   [ "$3" = refs/agentic-os/cache/lanes-v1 ]; then',
    '  count=0; [ -e "$AGENTIC_OS_TEST_CACHE_FAIL_MARKER" ] &&',
    '    count=$(cat "$AGENTIC_OS_TEST_CACHE_FAIL_MARKER")',
    '  count=$((count + 1)); echo "$count" > "$AGENTIC_OS_TEST_CACHE_FAIL_MARKER"',
    '  [ "$count" = 2 ] && exit 88',
    'fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, {
    PATH: `${support}:${process.env.PATH}`,
    AGENTIC_OS_TEST_CACHE_FAIL_MARKER: marker,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"effectsRetained":true/u);
  assert.match(result.stderr, /"cacheState":"planned"/u);
  assert.match(result.stderr,
    new RegExp(`"recoveryCommand":"npm run successor -- repair --expected-head=${s.publishedHead}"`, 'u'));
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }),
    'agent/test-device/repair');
  assert.equal(s.run(['rev-parse', s.predecessorRef]), s.repairHead);
  assert.equal(s.run(['rev-parse', 'agent/test-device/repair']), s.repairHead);
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'planned');
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse', `refs/heads/${s.predecessorRef}`]),
    s.publishedHead);
  const blockedLand = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: s.lane.path, encoding: 'utf8',
  });
  assert.equal(blockedLand.status, 1);
  assert.match(blockedLand.stderr, /blocked-successor-recovery-required/u);
  assert.match(blockedLand.stderr, new RegExp(`--expected-head=${s.publishedHead}`, 'u'));
  const resumed = s.invoke();
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'active');
  const landed = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: s.lane.path, encoding: 'utf8',
  });
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(s.run(['--git-dir', s.bare, 'rev-parse',
    'refs/heads/agent/test-device/repair']), s.repairHead);
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'published');
  assert.equal(s.run(['rev-parse', s.predecessorRef]), s.repairHead);
});

test('predecessor-side retry resumes a planned cache published behind an error', (t) => {
  const s = publishedSuccessorFixture(t), support = join(s.parent, 'cache-response-loss');
  mkdirSync(support);
  const marker = join(support, 'failed'), wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = update-ref ] && [ "$2" = --no-deref ] &&',
    '   [ "$3" = refs/agentic-os/cache/lanes-v1 ] && [ ! -e "$AGENTIC_OS_TEST_MARKER" ]; then',
    '  touch "$AGENTIC_OS_TEST_MARKER"',
    '  /usr/bin/git "$@"',
    '  exit 88',
    'fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, { PATH: `${support}:${process.env.PATH}`,
    AGENTIC_OS_TEST_MARKER: marker });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"effectsRetained":true/u);
  assert.match(result.stderr, /"cacheState":"planned"/u);
  assert.match(result.stderr,
    new RegExp(`npm run successor -- repair --expected-head=${s.publishedHead}`, 'u'));
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
  assert.equal(s.run(['rev-parse', '--verify', '--quiet', 'agent/test-device/repair'],
    { allowFail: true }), null);
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'planned');
  const resumed = s.invoke('repair', s.publishedHead);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }),
    'agent/test-device/repair');
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'active');
});

test('unreadable cache after attempted publication reports retained effects', (t) => {
  const s = publishedSuccessorFixture(t), support = join(s.parent, 'cache-unreadable');
  mkdirSync(support);
  const marker = join(support, 'failed'), wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = update-ref ] && [ "$2" = --no-deref ] &&',
    '   [ "$3" = refs/agentic-os/cache/lanes-v1 ] && [ ! -e "$AGENTIC_OS_TEST_MARKER" ]; then',
    '  touch "$AGENTIC_OS_TEST_MARKER"',
    '  /usr/bin/git "$@"',
    '  /usr/bin/git symbolic-ref refs/agentic-os/cache/lanes-v1 refs/heads/main',
    '  exit 88',
    'fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, { PATH: `${support}:${process.env.PATH}`,
    AGENTIC_OS_TEST_MARKER: marker });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"effectsRetained":true/u);
  assert.match(result.stderr, /"cacheState":"unreadable"/u);
  assert.match(result.stderr, /"cachePublication":\{"candidateOid":"[0-9a-f]{40}"/u);
  assert.match(result.stderr, /"currentOid":"unreadable"/u);
  assert.match(result.stderr, /"publicationAttempted":true,"refPublished":false/u);
  assert.match(result.stderr,
    new RegExp(`--expected-head=${s.publishedHead}`, 'u'));
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
  assert.equal(s.run(['rev-parse', '--verify', '--quiet', 'agent/test-device/repair'],
    { allowFail: true }), null);
});

test('successful cache CAS with failed post-read reports confirmed publication', (t) => {
  const s = publishedSuccessorFixture(t), support = join(s.parent, 'cache-post-read');
  mkdirSync(support);
  const marker = join(support, 'published'), wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = update-ref ] && [ "$2" = --no-deref ] &&',
    '   [ "$3" = refs/agentic-os/cache/lanes-v1 ] && [ ! -e "$AGENTIC_OS_TEST_MARKER" ]; then',
    '  touch "$AGENTIC_OS_TEST_MARKER"',
    '  /usr/bin/git "$@" || exit $?',
    '  /usr/bin/git symbolic-ref refs/agentic-os/cache/lanes-v1 refs/heads/main',
    '  exit 0',
    'fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, { PATH: `${support}:${process.env.PATH}`,
    AGENTIC_OS_TEST_MARKER: marker });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"effectsRetained":true/u);
  assert.match(result.stderr, /"cacheState":"unreadable"/u);
  assert.match(result.stderr, /"publicationAttempted":true,"refPublished":true/u);
  assert.match(result.stderr, new RegExp(`--expected-head=${s.publishedHead}`, 'u'));
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
});

test('successor refuses dirty worktree bytes', (t) => {
  const s = publishedSuccessorFixture(t);
  writeFileSync(join(s.lane.path, 'change.txt'), 'uncommitted\n');
  const result = s.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-dirty/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
});

test('successor refuses a clean local head that is not a published-head descendant', (t) => {
  const s = publishedSuccessorFixture(t);
  const tree = s.run(['rev-parse', `${s.repairHead}^{tree}`]);
  const unrelated = s.run(['commit-tree', tree, '-m', 'unrelated']);
  s.run(['reset', '--quiet', '--hard', unrelated], { cwd: s.lane.path });
  const result = s.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-successor-descendant/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
});

test('successor refuses committed paths outside the inherited reservation', (t) => {
  const s = publishedSuccessorFixture(t);
  writeFileSync(join(s.lane.path, 'outside.txt'), 'outside\n');
  s.run(['add', 'outside.txt'], { cwd: s.lane.path });
  s.run(['commit', '--quiet', '--message', 'outside'], { cwd: s.lane.path });
  const result = s.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-write-outside-reservation/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
});

test('successor refuses merge history before merge-only paths can evade inventory', (t) => {
  const s = publishedSuccessorFixture(t);
  s.run(['branch', 'side', s.publishedHead], { cwd: s.lane.path });
  s.run(['checkout', '--quiet', 'side'], { cwd: s.lane.path });
  writeFileSync(join(s.lane.path, 'merge-only.txt'), 'outside\n');
  s.run(['add', 'merge-only.txt'], { cwd: s.lane.path });
  s.run(['commit', '--quiet', '--message', 'side path'], { cwd: s.lane.path });
  s.run(['checkout', '--quiet', s.predecessorRef], { cwd: s.lane.path });
  s.run(['merge', '--quiet', '--no-ff', 'side', '--message', 'merge side'], { cwd: s.lane.path });
  const result = s.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-successor-merge/u);
  assert.equal(s.run(['rev-parse', '--verify', '--quiet', 'agent/test-device/repair'],
    { allowFail: true }), null);
});

test('successor refuses stale protected base metadata', async (t) => {
  await t.test('wrong protected ref', (child) => {
    const s = publishedSuccessorFixture(child);
    put({ ref: s.predecessorRef, base: 'refs/remotes/origin/other' }, s.lane.path);
    const result = s.invoke();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-successor-predecessor/u);
  });
  await t.test('base not ancestor of published head', (child) => {
    const s = publishedSuccessorFixture(child);
    const tree = s.run(['rev-parse', `${s.publishedHead}^{tree}`]);
    const unrelated = s.run(['commit-tree', tree, '-m', 'unrelated base']);
    put({ ref: s.predecessorRef, baseSha: unrelated }, s.lane.path);
    const result = s.invoke();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-successor-predecessor/u);
  });
});

test('cache destination interleaving is refused before successor refs are created', (t) => {
  const s = publishedSuccessorFixture(t), support = join(s.parent, 'cache-race');
  mkdirSync(support);
  const helper = join(support, 'inject.mjs'), marker = join(support, 'injected');
  writeFileSync(helper, `import { put } from ${JSON.stringify(LANE_RECORDS_URL)};\n`
    + `put({ ref: 'agent/test-device/repair', state: 'active' }, ${JSON.stringify(s.root)});\n`);
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = ls-remote ] && [ "$5" = refs/heads/agent/test-device/repair ] &&',
    '   [ ! -e "$AGENTIC_OS_TEST_RACE_MARKER" ]; then',
    '  touch "$AGENTIC_OS_TEST_RACE_MARKER"',
    '  "$AGENTIC_OS_TEST_NODE" "$AGENTIC_OS_TEST_RACE_HELPER"',
    'fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, { PATH: `${support}:${process.env.PATH}`,
    AGENTIC_OS_TEST_NODE: process.execPath, AGENTIC_OS_TEST_RACE_HELPER: helper,
    AGENTIC_OS_TEST_RACE_MARKER: marker });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-lane-cache-publication/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
  assert.equal(s.run(['rev-parse', '--verify', '--quiet', 'agent/test-device/repair'],
    { allowFail: true }), null);
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'active');
});

test('atomic HEAD oid guard aborts binding when predecessor ref races', (t) => {
  const s = publishedSuccessorFixture(t), support = join(s.parent, 'ref-race');
  mkdirSync(support);
  const tree = s.run(['rev-parse', `${s.repairHead}^{tree}`]);
  const racedHead = s.run(['commit-tree', tree, '-p', s.repairHead, '-m', 'raced ref']);
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = update-ref ] && [ "$2" = --stdin ]; then',
    '  /usr/bin/git update-ref refs/heads/agent/test-device/published "$AGENTIC_OS_TEST_RACED_HEAD"',
    'fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, { PATH: `${support}:${process.env.PATH}`,
    AGENTIC_OS_TEST_RACED_HEAD: racedHead });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-successor-binding/u);
  assert.equal(s.run(['rev-parse', s.predecessorRef]), racedHead);
  assert.equal(s.run(['rev-parse', '--verify', '--quiet', 'agent/test-device/repair'],
    { allowFail: true }), null);
  assert.equal(get('agent/test-device/repair', s.lane.path).state, 'planned');
});

test('successor fails before effects when Git lacks transactional symrefs', (t) => {
  const s = publishedSuccessorFixture(t), support = join(s.parent, 'old-git');
  mkdirSync(support);
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = version ]; then echo "git version 2.45.3"; exit 0; fi',
    'exec /usr/bin/git "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const result = s.invoke('repair', null, { PATH: `${support}:${process.env.PATH}` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-git-symref-unsupported/u);
  assert.equal(s.run(['branch', '--show-current'], { cwd: s.lane.path }), s.predecessorRef);
  assert.equal(get('agent/test-device/repair', s.lane.path), null);
});

test('successor refuses local and remote destination collisions', async (t) => {
  await t.test('local', (child) => {
    const s = publishedSuccessorFixture(child);
    s.run(['branch', 'agent/test-device/repair', s.publishedHead]);
    const result = s.invoke();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-successor-destination/u);
  });
  await t.test('remote', (child) => {
    const s = publishedSuccessorFixture(child);
    s.run(['push', '--quiet', s.bare,
      `${s.publishedHead}:refs/heads/agent/test-device/repair`]);
    const result = s.invoke();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-successor-destination/u);
  });
  await t.test('cache', (child) => {
    const s = publishedSuccessorFixture(child);
    put({ ref: 'agent/test-device/repair', state: 'active' }, s.lane.path);
    const result = s.invoke();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked-successor-destination/u);
  });
});

test('write reservations reject traversal and Git pathspec magic', () => {
  assert.deepEqual(parseWritePaths('src/a.mjs,docs/guide.md'), ['docs/guide.md', 'src/a.mjs']);
  for (const path of ['../outside', '/absolute', 'src/*', ':(top)**', 'src\\file'])
    assert.throws(() => parseWritePaths(path), /write scope/u);
});

test('start admits a disjoint second lane without interrupting the active lane', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const active = createLane(t, root, 'agent/test-device/active', 'active');
  writeFileSync(join(active.path, 'active.txt'), 'active\n');

  const result = spawnSync(process.execPath, [CLI, 'start', 'next', '--device=test-device',
    '--write=next.txt'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(registeredLaneBranches(root), [
    'agent/test-device/active', 'agent/test-device/next',
  ]);
  const next = worktreeFor('agent/test-device/next', root);
  t.after(() => {
    if (next && existsSync(next.path)) git(['worktree', 'remove', '--force', next.path], { cwd: root });
  });
  assert.equal(run(['branch', '--show-current'], { cwd: active.path }), 'agent/test-device/active');
});

test('start refuses an overlapping active-lane write reservation', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const active = createLane(t, root, 'agent/test-device/active', 'active');
  writeFileSync(join(active.path, 'shared.txt'), 'active\n');

  const result = spawnSync(process.execPath, [CLI, 'start', 'next', '--device=test-device',
    '--write=shared.txt'], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-write-scope-overlap/u);
  assert.equal(run(['branch', '--list', 'agent/test-device/next']), '');
});

test('land autonomously stages, commits, and publishes only its reserved path', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);

  const started = spawnSync(process.execPath, [CLI, 'start', 'autonomous',
    '--device=test-device', '--write=change.txt'], { cwd: root, encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
  const lane = worktreeFor('agent/test-device/autonomous', root);
  assert.ok(lane);
  t.after(() => {
    if (existsSync(lane.path)) git(['worktree', 'remove', '--force', lane.path], { cwd: root });
  });
  writeFileSync(join(lane.path, 'change.txt'), 'delivered\n');

  const landed = spawnSync(process.execPath, [CLI, 'land', '--message=docs: autonomous'], {
    cwd: lane.path, encoding: 'utf8',
  });

  assert.equal(landed.status, 0, landed.stderr);
  assert.match(landed.stdout, /committed [0-9a-f]{9} \(1 path\(s\)\)/u);
  assert.match(landed.stdout, /pushed agent\/test-device\/autonomous/u);
  const local = run(['rev-parse', 'agent/test-device/autonomous']);
  const advertised = run(['ls-remote', '--refs', bare,
    'refs/heads/agent/test-device/autonomous']).split(/\s+/u)[0];
  assert.equal(advertised, local);
});

test('finish removes one clean integrated worktree and retains its branch history', (t) => {
  const { parent, root, run } = fixture(t);
  const bare = join(parent, 'remote.git');
  git(['init', '--quiet', '--bare', bare], { cwd: parent });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const ref = 'agent/test-device/completed';
  const created = createLane(t, root, ref, 'completed');
  writeFileSync(join(created.path, 'completed.txt'), 'completed\n');
  git(['add', 'completed.txt'], { cwd: created.path });
  git(['commit', '--quiet', '--message', 'complete lane'], { cwd: created.path });
  const laneHead = git(['rev-parse', 'HEAD'], { cwd: created.path });
  run(['merge', '--quiet', '--ff-only', ref]);
  run(['push', '--quiet', 'origin', 'main']);

  const result = spawnSync(process.execPath, [CLI, 'finish', `--ref=${ref}`], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agentic-os\/sprint-finish\/v1/u);
  assert.equal(existsSync(created.path), false);
  assert.deepEqual(registeredLaneBranches(root), []);
  assert.equal(run(['rev-parse', `refs/heads/${ref}`]), laneHead);
  assert.equal(run(['rev-parse', 'main']), laneHead);
  assert.equal(run(['rev-parse', 'origin/main']), laneHead);
});
