import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeNulFields,
  fetch,
  git,
  publishExactNewRef,
  remoteTransport,
  remoteRefSha,
} from '../src/git.mjs';
import {
  cherry,
  integrationProof,
  sourceHeadTrailer,
} from '../src/patch-identity.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

/** Real repository fixture: patch identity cannot be tested against a mock. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'adlc-'));
  const run = (args, options = {}) => git(args, { cwd: dir, ...options });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'ADLC Test']);
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'base']);
  return { dir, run };
}

function commitFile(run, dir, name, body, message) {
  writeFileSync(join(dir, name), body);
  run(['add', name]);
  run(['commit', '--quiet', '--message', message]);
}

function commitGithubProfile(run, dir) {
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' } },
  });
  commitFile(run, dir, '.agentic-os.json', `${JSON.stringify(profile, null, 2)}\n`, 'profile');
  ensureRepositoryTrust(dir, profile, { allowCreate: true });
}

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));

test('ancestor proof when the lane is merged fast-forward', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/one']);
  commitFile(run, dir, 'one.txt', 'one\n', 'add one');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--ff-only', 'agent/dev/one']);

  const proof = integrationProof('main', 'agent/dev/one', { cwd: dir });
  assert.equal(proof.kind, 'ancestor');
});

test('remote publication is an exact advertised-ref observation', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-remote-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', 'origin', 'main']);
  assert.equal(remoteRefSha('origin', 'main', dir), run(['rev-parse', 'main']));
  assert.equal(remoteRefSha('origin', 'missing', dir), null);
});

test('ordinary fetch preserves stale remote-tracking refs for governed cleanup', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-fetch-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  run(['push', '--quiet', 'origin', 'main:retained']);
  run(['update-ref', '-d', 'refs/remotes/origin/retained']);
  const first = fetch('origin', dir);
  assert.equal(first.schema, 'agentic-os/git-fetch/v1');
  assert.equal(first.fetchCompleted, true);
  assert.equal(first.fetchHeadWritten, false);
  assert.equal(first.autoMaintenanceRun, false);
  assert.equal(first.refChanges.length, 1);
  assert.equal(existsSync(join(dir, '.git', 'FETCH_HEAD')), false);
  const retained = run(['rev-parse', 'refs/remotes/origin/retained']);
  run(['--git-dir', bare, 'update-ref', '-d', 'refs/heads/retained']);
  fetch('origin', dir);
  assert.equal(run(['rev-parse', 'refs/remotes/origin/retained']), retained);
});

test('fetch response loss reobserves exact refs and reports unknown object writes', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-fetch-response-loss-'));
  const support = mkdtempSync(join(tmpdir(), 'adlc-fetch-wrapper-'));
  t.after(() => rmSync(support, { recursive: true, force: true }));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  const oid = run(['rev-parse', 'HEAD']);
  run(['push', '--quiet', 'origin', 'main:recovered']);
  run(['update-ref', '-d', 'refs/remotes/origin/recovered']);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = -c ] && [ "$2" = fetch.writeCommitGraph=false ] && [ "$3" = fetch ]; then',
    '  "$REAL_GIT" "$@" || exit',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${support}:${priorPath}`;
  process.env.REAL_GIT = realGit;
  t.after(() => { process.env.PATH = priorPath; delete process.env.REAL_GIT; });

  assert.throws(() => fetch('origin', dir), (error) => {
    assert.equal(error.reason, 'blocked-fetch-result-unknown');
    assert.equal(error.artifacts.writeResultUnknown, true);
    assert.equal(error.artifacts.objectWriteResultUnknown, true);
    assert.equal(error.artifacts.reobservationExact, true);
    assert.equal(error.artifacts.effectsRetained, true);
    assert.equal(error.artifacts.refChanges.length, 1);
    assert.equal(error.artifacts.refChanges[0].after.oid, oid);
    return true;
  });
  assert.equal(run(['rev-parse', 'refs/remotes/origin/recovered']), oid);
  assert.equal(existsSync(join(dir, '.git', 'FETCH_HEAD')), false);
});

test('remote options and absent remotes fail before fetch interpretation', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = run(['for-each-ref', '--format=%(refname)']);
  for (const remote of [undefined, '--prune', '--all', 'missing']) {
    assert.throws(() => fetch(remote, dir),
      (error) => error?.reason === 'blocked-configured-remote');
  }
  assert.equal(run(['for-each-ref', '--format=%(refname)']), before);
});

test('remote publication creates the captured OID once and never rewrites it', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-publish-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  const captured = run(['rev-parse', 'HEAD']);
  commitFile(run, dir, 'later.txt', 'later\n', 'move local ref after capture');
  const moved = run(['rev-parse', 'HEAD']);

  publishExactNewRef('origin', 'agent/dev/captured', captured, dir);
  assert.equal(remoteRefSha('origin', 'agent/dev/captured', dir), captured);
  assert.notEqual(captured, moved);
  assert.throws(() => publishExactNewRef('origin', 'agent/dev/captured', moved, dir));
  assert.equal(remoteRefSha('origin', 'agent/dev/captured', dir), captured);
});

test('push response loss reobserves and reports the exact retained remote ref', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-push-response-loss-'));
  const support = mkdtempSync(join(tmpdir(), 'adlc-push-wrapper-'));
  t.after(() => rmSync(support, { recursive: true, force: true }));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  const oid = run(['rev-parse', 'HEAD']);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const wrapper = join(support, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$1" = push ]; then',
    '  "$REAL_GIT" "$@" || exit',
    '  exit 23',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${support}:${priorPath}`;
  process.env.REAL_GIT = realGit;
  t.after(() => { process.env.PATH = priorPath; delete process.env.REAL_GIT; });
  const ref = 'agent/dev/response-loss';
  assert.throws(() => publishExactNewRef('origin', ref, oid, dir), (error) => {
    assert.equal(error.reason, 'blocked-remote-publication-result-unknown');
    assert.equal(error.artifacts.writeResultUnknown, true);
    assert.equal(error.artifacts.reobservationExact, true);
    assert.equal(error.artifacts.effectsRetained, true);
    assert.equal(error.artifacts.refPublished, true);
    assert.equal(error.artifacts.remoteRefCurrentOid, oid);
    return true;
  });
  assert.equal(remoteRefSha('origin', ref, dir), oid);
});

test('a captured remote refuses retargeting before publication', (t) => {
  const { dir, run } = fixture();
  const first = mkdtempSync(join(tmpdir(), 'adlc-first-'));
  const second = mkdtempSync(join(tmpdir(), 'adlc-second-'));
  t.after(() => rmSync(second, { recursive: true, force: true }));
  t.after(() => rmSync(first, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of [first, second]) run(['init', '--quiet', '--bare', path]);
  run(['remote', 'add', 'origin', first]);
  const captured = remoteTransport('origin', dir).fetchUrl;
  run(['remote', 'set-url', 'origin', second]);
  const ref = 'agent/dev/captured-transport';
  assert.throws(() => publishExactNewRef('origin', ref, run(['rev-parse', 'HEAD']), dir, captured),
    (error) => error?.reason === 'blocked-remote-transport-race');
  assert.equal(remoteRefSha('origin', ref, dir), null);
  assert.equal(git(['--git-dir', first, 'rev-parse', '--verify', `refs/heads/${ref}`], {
    cwd: dir, allowFail: true,
  }), null);
});

test('land uses the committed primary profile, not candidate profile bytes', (t) => {
  const { dir, run } = fixture();
  const origin = mkdtempSync(join(tmpdir(), 'adlc-trusted-origin-'));
  const upstream = mkdtempSync(join(tmpdir(), 'adlc-candidate-upstream-'));
  const laneRoot = mkdtempSync(join(tmpdir(), 'adlc-profile-lane-'));
  const lanePath = join(laneRoot, 'lane');
  for (const path of [origin, upstream]) run(['init', '--quiet', '--bare', path]);
  for (const path of [laneRoot, upstream, origin, dir])
    t.after(() => rmSync(path, { recursive: true, force: true }));
  const profile = (remote) => createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: `refs/remotes/${remote}/main` },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  const trustedProfile = profile('origin');
  writeFileSync(join(dir, '.agentic-os.json'), `${JSON.stringify(trustedProfile, null, 2)}\n`);
  run(['add', '.agentic-os.json']);
  run(['commit', '--quiet', '--message', 'trusted profile']);
  ensureRepositoryTrust(dir, trustedProfile, { allowCreate: true });
  run(['remote', 'add', 'origin', origin]);
  run(['remote', 'add', 'upstream', upstream]);
  run(['push', '--quiet', 'origin', 'main']);
  run(['push', '--quiet', 'upstream', 'main']);
  const ref = 'agent/dev/candidate-profile';
  run(['worktree', 'add', '--quiet', '-b', ref, lanePath, 'main']);
  writeFileSync(join(lanePath, '.agentic-os.json'), `${JSON.stringify(profile('upstream'), null, 2)}\n`);
  git(['add', '.agentic-os.json'], { cwd: lanePath });
  git(['commit', '--quiet', '--message', 'candidate weakens profile'], { cwd: lanePath });
  const head = git(['rev-parse', 'HEAD'], { cwd: lanePath });
  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: lanePath, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(remoteRefSha('origin', ref, dir), head);
  assert.equal(remoteRefSha('upstream', ref, dir), null);
});

test('profile remote publishes to upstream without contacting conflicting origin', (t) => {
  const { dir, run } = fixture();
  const origin = mkdtempSync(join(tmpdir(), 'adlc-origin-'));
  const upstream = mkdtempSync(join(tmpdir(), 'adlc-upstream-'));
  const lanePath = join(mkdtempSync(join(tmpdir(), 'adlc-upstream-lane-')), 'lane');
  for (const path of [origin, upstream]) run(['init', '--quiet', '--bare', path]);
  t.after(() => rmSync(join(lanePath, '..'), { recursive: true, force: true }));
  t.after(() => rmSync(upstream, { recursive: true, force: true }));
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['remote', 'add', 'origin', origin]);
  run(['remote', 'add', 'upstream', upstream]);
  const profile = createRepositoryProfile({
    repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/upstream/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(dir, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  writeFileSync(join(dir, '.gitignore'), '*.cache\n');
  run(['add', '.agentic-os.json']);
  run(['add', '.gitignore']);
  run(['commit', '--quiet', '--message', 'add repository profile']);
  ensureRepositoryTrust(dir, profile, { allowCreate: true });
  run(['push', '--quiet', 'origin', 'main']);
  run(['push', '--quiet', 'upstream', 'main']);
  const ref = 'agent/dev/upstream-only';
  run(['worktree', 'add', '--quiet', '-b', ref, lanePath, 'main']);
  const laneRun = (args) => git(args, { cwd: lanePath });
  commitFile(laneRun, lanePath, 'lane.txt', 'lane\n', 'publish upstream lane');
  writeFileSync(join(lanePath, 'uncommitted.txt'), 'visible authored bytes\n');
  const blocked = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: lanePath, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' },
  });
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stderr, /blocked-publish-byte-risk/u);
  assert.equal(remoteRefSha('upstream', ref, dir), null);
  unlinkSync(join(lanePath, 'uncommitted.txt'));
  writeFileSync(join(lanePath, 'dependency.cache'), 'ignored dependency bytes remain\n');
  const head = laneRun(['rev-parse', 'HEAD']);

  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: lanePath, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no pull-request integration capability selected/u);
  assert.equal(remoteRefSha('upstream', ref, dir), head);
  assert.equal(remoteRefSha('origin', ref, dir), null);
  assert.equal(readFileSync(join(lanePath, 'dependency.cache'), 'utf8'),
    'ignored dependency bytes remain\n');
});

test('a lost cache cannot republish an already-integrated lane or contact the provider', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-integrated-'));
  const support = mkdtempSync(join(tmpdir(), 'adlc-provider-'));
  const lanePath = join(support, 'lane');
  const providerMarker = join(support, 'provider-called');
  t.after(() => rmSync(support, { recursive: true, force: true }));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  commitGithubProfile(run, dir);
  run(['push', '--quiet', 'origin', 'main']);
  const ref = 'agent/dev/already-integrated';
  run(['worktree', 'add', '--quiet', '-b', ref, lanePath, 'main']);
  const laneRun = (args) => git(args, { cwd: lanePath });
  commitFile(laneRun, lanePath, 'integrated.txt', 'integrated\n', 'integrated lane');
  run(['merge', '--quiet', '--ff-only', ref]);
  run(['push', '--quiet', 'origin', 'main']);
  const gh = join(support, 'gh');
  writeFileSync(gh, `#!/bin/sh\ntouch ${JSON.stringify(providerMarker)}\nexit 99\n`);
  chmodSync(gh, 0o755);

  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: lanePath,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${support}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-already-integrated/u);
  assert.equal(remoteRefSha('origin', ref, dir), null);
  assert.equal(existsSync(providerMarker), false);
});

test('hidden tracked lane bytes block publication before remote or provider mutation', (t) => {
  const { dir, run } = fixture();
  const bare = mkdtempSync(join(tmpdir(), 'adlc-hidden-remote-'));
  const support = mkdtempSync(join(tmpdir(), 'adlc-hidden-provider-'));
  const lanePath = join(support, 'lane');
  const providerMarker = join(support, 'provider-called');
  t.after(() => rmSync(support, { recursive: true, force: true }));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(['init', '--quiet', '--bare', bare]);
  run(['remote', 'add', 'origin', bare]);
  commitGithubProfile(run, dir);
  run(['push', '--quiet', 'origin', 'main']);
  const ref = 'agent/dev/hidden-bytes';
  run(['worktree', 'add', '--quiet', '-b', ref, lanePath, 'main']);
  const laneRun = (args) => git(args, { cwd: lanePath });
  commitFile(laneRun, lanePath, 'owned.txt', 'committed\n', 'add owned');
  laneRun(['update-index', '--assume-unchanged', '--', 'owned.txt']);
  writeFileSync(join(lanePath, 'owned.txt'), 'hidden authored bytes\n');
  const gh = join(support, 'gh');
  writeFileSync(gh, `#!/bin/sh\ntouch ${JSON.stringify(providerMarker)}\nexit 99\n`);
  chmodSync(gh, 0o755);

  const result = spawnSync(process.execPath, [CLI, 'land'], {
    cwd: lanePath,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${support}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-publish-byte-risk/u);
  assert.equal(remoteRefSha('origin', ref, dir), null);
  assert.equal(existsSync(providerMarker), false);
  assert.equal(readFileSync(join(lanePath, 'owned.txt'), 'utf8'), 'hidden authored bytes\n');
  assert.match(laneRun(['ls-files', '-v', '--', 'owned.txt']), /^[a-z]/u);
});

test('squash merge destroys ancestry but exact content identity still proves it', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/two']);
  commitFile(run, dir, 'two.txt', 'two\n', 'add two');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/two']);
  run(['commit', '--quiet', '--message', 'squashed two']);

  // Ancestry is gone: the lane tip is not reachable from main.
  const laneTip = git(['rev-parse', 'agent/dev/two'], { cwd: dir });
  const reachable = git(['merge-base', '--is-ancestor', laneTip, 'main'], {
    cwd: dir,
    allowFail: true,
  });
  assert.equal(reachable, null, 'squash must break ancestry for this test to mean anything');

  const proof = integrationProof('main', 'agent/dev/two', { cwd: dir });
  assert.equal(proof.kind, 'exact-tree-projection');
  assert.deepEqual(proof.pending, []);
});

test('Source-Head correlation cannot prove integration when content differs', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/three']);
  commitFile(run, dir, 'three.txt', 'three\n', 'add three');
  const laneTip = git(['rev-parse', 'HEAD'], { cwd: dir });

  run(['switch', '--quiet', 'main']);
  // Deliberately different content, so patch identity cannot succeed.
  commitFile(run, dir, 'three.txt', 'three, adjusted in the queue\n', 'add three\n\nqueue squash');
  run(['commit', '--quiet', '--amend', '--message', `add three\n\n${sourceHeadTrailer(laneTip)}`]);

  const { pending } = cherry('main', 'agent/dev/three', { cwd: dir });
  assert.equal(pending.length, 1, 'patch identity must not be the proof here');

  assert.equal(integrationProof('main', 'agent/dev/three', { cwd: dir }), null);
});

test('a multi-commit squash is proven by exact touched-path state', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/multi']);
  commitFile(run, dir, 'p.txt', 'p\n', 'add p');
  commitFile(run, dir, 'q.txt', 'q\n', 'add q');

  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/multi']);
  run(['commit', '--quiet', '--message', 'landed both, no trailer']);

  // Per-commit identity cannot see it: neither lane commit matches the squash.
  const { pending } = cherry('main', 'agent/dev/multi', { cwd: dir });
  assert.equal(pending.length, 2, 'both lane commits look pending to per-commit identity');

  const proof = integrationProof('main', 'agent/dev/multi', { cwd: dir });
  assert.equal(proof.kind, 'exact-tree-projection');
});

test('reworded cherry-picks are proven by their exact net tree projection', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/cherry']);
  commitFile(run, dir, 'c.txt', 'c\n', 'add c');
  const first = run(['rev-parse', 'HEAD']);
  commitFile(run, dir, 'd.txt', 'd\n', 'add d');
  const second = run(['rev-parse', 'HEAD']);

  run(['switch', '--quiet', 'main']);
  commitFile(run, dir, 'unrelated.txt', 'main-only\n', 'advance main');
  run(['cherry-pick', '--no-commit', first]);
  run(['commit', '--quiet', '--message', 'reworded c']);
  run(['cherry-pick', '--no-commit', second]);
  run(['commit', '--quiet', '--message', 'reworded d']);

  assert.equal(integrationProof('main', 'agent/dev/cherry', { cwd: dir }).kind,
    'exact-tree-projection');
});

test('content identity does not fire when any touched path differs', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/partial']);
  commitFile(run, dir, 'r.txt', 'r\n', 'add r');
  commitFile(run, dir, 's.txt', 's\n', 'add s');

  run(['switch', '--quiet', 'main']);
  commitFile(run, dir, 'r.txt', 'r\n', 'only r landed');

  assert.equal(integrationProof('main', 'agent/dev/partial', { cwd: dir }), null);
});

test('whitespace-insensitive patch identity cannot authorize exact-byte retirement', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/whitespace']);
  writeFileSync(join(dir, 'base.txt'), 'hello world\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'preserve authored whitespace']);

  run(['switch', '--quiet', 'main']);
  writeFileSync(join(dir, 'base.txt'), 'helloworld\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'different bytes']);

  const patchEquivalent = cherry('main', 'agent/dev/whitespace', { cwd: dir });
  assert.equal(patchEquivalent.pending.length, 0,
    'the regression requires Git patch-id to ignore this whitespace difference');
  assert.equal(integrationProof('main', 'agent/dev/whitespace', { cwd: dir }), null);
});

test('a later disjoint advance preserves projection but a touched-path change invalidates it', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/later']);
  commitFile(run, dir, 'later.txt', 'lane bytes\n', 'lane bytes');
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/later']);
  run(['commit', '--quiet', '--message', 'squash lane']);
  commitFile(run, dir, 'disjoint.txt', 'disjoint\n', 'disjoint advance');
  assert.equal(integrationProof('main', 'agent/dev/later', { cwd: dir }).kind,
    'exact-tree-projection');

  writeFileSync(join(dir, 'later.txt'), 'different later bytes\n');
  run(['add', 'later.txt']);
  run(['commit', '--quiet', '--message', 'change touched path']);
  assert.equal(integrationProof('main', 'agent/dev/later', { cwd: dir }), null);
});

test('mode and deletion state are part of the exact projection', (t) => {
  const modeFixture = fixture();
  t.after(() => rmSync(modeFixture.dir, { recursive: true, force: true }));
  modeFixture.run(['switch', '--quiet', '--create', 'agent/dev/mode']);
  chmodSync(join(modeFixture.dir, 'base.txt'), 0o755);
  modeFixture.run(['add', 'base.txt']);
  modeFixture.run(['commit', '--quiet', '--message', 'make executable']);
  modeFixture.run(['switch', '--quiet', 'main']);
  assert.equal(integrationProof('main', 'agent/dev/mode', { cwd: modeFixture.dir }), null);

  const deleteFixture = fixture();
  t.after(() => rmSync(deleteFixture.dir, { recursive: true, force: true }));
  deleteFixture.run(['switch', '--quiet', '--create', 'agent/dev/delete']);
  unlinkSync(join(deleteFixture.dir, 'base.txt'));
  deleteFixture.run(['add', '--all']);
  deleteFixture.run(['commit', '--quiet', '--message', 'delete base']);
  deleteFixture.run(['switch', '--quiet', 'main']);
  assert.equal(integrationProof('main', 'agent/dev/delete', { cwd: deleteFixture.dir }), null);
});

test('literal leading-colon and newline paths remain exact', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = ':literal\nname.txt';
  run(['switch', '--quiet', '--create', 'agent/dev/literal']);
  writeFileSync(join(dir, path), 'literal bytes\n');
  run(['add', '--all']);
  run(['commit', '--quiet', '--message', 'literal path']);
  run(['switch', '--quiet', 'main']);
  run(['merge', '--quiet', '--squash', 'agent/dev/literal']);
  run(['commit', '--quiet', '--message', 'squash literal path']);
  assert.equal(integrationProof('main', 'agent/dev/literal', { cwd: dir }).kind,
    'exact-tree-projection');
});

test('non-UTF-8 and unterminated path inventories fail closed', () => {
  assert.equal(decodeNulFields(Buffer.from([0xff, 0])), null);
  assert.equal(decodeNulFields(Buffer.from('unterminated')), null);
  assert.deepEqual(decodeNulFields(Buffer.from(':literal\nname\0')), [':literal\nname']);
});

test('an unintegrated lane yields no proof at all', (t) => {
  const { dir, run } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  run(['switch', '--quiet', '--create', 'agent/dev/four']);
  commitFile(run, dir, 'four.txt', 'four\n', 'add four');
  run(['switch', '--quiet', 'main']);

  assert.equal(integrationProof('main', 'agent/dev/four', { cwd: dir }), null);
});
