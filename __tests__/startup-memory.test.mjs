import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
  symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireOperationLock, finishOperationLock, git } from '../src/git.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { hydrateMemory } from '../bin/agentic-os-memory.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
const entry = (time, summary = 'Use the source owner before changing a consumer.') =>
  `\n## @mem-20260910T${time}Z\ntype: decision\nscope: collaboration\nsummary: ${summary}\nrefs: [repo@revision:DOCUMENTS.md]\n`;
const header = `---
schema: memory-log/v1
agent: test-harness
device: fixture
period: 2026-09
timestamp_format: YYYYMMDDTHHmmssZ
append_policy: append-only
source_contract: https://example.invalid/docs/MEMORY-LOG.md
---
# September memory
`;
function fixture(t, { enrolled = true, records = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-memory-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const run = (cwd, args, options = {}) => git(args, { cwd, ...options });
  const init = name => {
    const root = join(parent, name); mkdirSync(root);
    run(root, ['init', '--quiet', '--initial-branch=main']);
    run(root, ['config', 'user.name', 'Memory Test']);
    run(root, ['config', 'user.email', 'test@example.invalid']);
    return root;
  };
  const source = init('.memory'), root = init('repo'), bare = join(parent, 'remote.git');
  const shard = join(source, 'records', '2026-09.md');
  writeFileSync(join(source, 'README.md'), 'Private curated source\n');
  if (records) { mkdirSync(join(source, 'records')); writeFileSync(shard, header + entry('010101')); }
  const commit = cwd => { run(cwd, ['add', '.']); run(cwd, ['commit', '--quiet', '-m', 'fixture']); };
  commit(source);
  run(parent, ['init', '--quiet', '--bare', bare]);
  run(source, ['remote', 'add', 'origin', bare]);
  run(source, ['push', '--quiet', '-u', 'origin', 'main']);
  const config = { schema: 'agentic-os/memory-source/v1', remote: bare, branch: 'main', directory: 'records' };
  writeFileSync(join(root, '.agentic-os-memory.json'), JSON.stringify(config));
  const profile = createRepositoryProfile({ repository: 'local:memory-test',
    canonical: { localRef: 'refs/heads/main', remoteRef: policy.protectedRef },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    cleanup: { worktreeProjection: 'retain', worktreeRegistration: 'retain', remoteTrackingRef: 'retain',
      localBranch: 'retain', remoteBranch: 'retain', unreachableObjects: 'retain' } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  commit(root);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const repoRemote = join(parent, 'repo.git'); run(parent, ['init', '--quiet', '--bare', repoRemote]);
  run(root, ['remote', 'add', 'origin', repoRemote]); run(root, ['push', '--quiet', '-u', 'origin', 'main']);
  if (enrolled) run(root, ['config', '--local', 'agentic-os.memoryRoot', '../.memory']);
  return { parent, root, source, bare, config, run, shard, commit,
    invoke: (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' }),
    hydrate: options => hydrateMemory(root, policy, options) };
}
const load = receipt => JSON.parse(readFileSync(receipt.index)).index;

test('unconfigured startup performs no memory import and preserves normal lane admission', t => {
  const s = fixture(t, { enrolled: false });
  s.run(s.source, ['remote', 'set-url', 'origin', '/missing-source']);
  assert.deepEqual(s.hydrate(), { status: 'disabled', reason: 'local-enrollment-required' });
  const result = s.invoke('start', 'no-memory', '--device=device-a', '--write=change.txt');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /memory \{/u);
  assert.equal(existsSync(join(s.source, '.git', 'agentic-os-memory')), false);
});

test('startup pins committed records, leaves dirty source untouched, and reuses an unchanged index', t => {
  const s = fixture(t), original = readFileSync(s.shard);
  writeFileSync(s.shard, 'dirty private bytes never indexed\n');
  const result = s.invoke('start', 'with-memory', '--device=device-a', '--write=change.txt');
  assert.equal(result.status, 0, result.stderr);
  const first = JSON.parse(result.stdout.match(/^memory (.+)$/mu)[1]);
  assert.equal(first.status, 'ready'); assert.equal(first.entries, 1); assert.equal(first.grantsAuthority, false);
  const index = load(first), mtime = statSync(first.index).mtimeMs;
  assert.equal(index.source.revision, s.run(s.source, ['rev-parse', 'HEAD']));
  assert.equal(index.entries[0].summary, 'Use the source owner before changing a consumer.');
  assert.equal(s.run(s.source, ['show', `${index.source.revision}:${index.entries[0].path}`]), original.toString().trim());
  assert.equal(readFileSync(s.shard, 'utf8'), 'dirty private bytes never indexed\n');
  assert.equal(statSync(first.index).mode & 0o777, 0o600);
  const second = s.hydrate(); assert.equal(second.reused, true); assert.equal(second.index, first.index);
  assert.equal(statSync(first.index).mtimeMs, mtime);
  const lane = result.stdout.match(/^worktree (.+)$/mu)[1];
  const resumed = spawnSync(process.execPath, [CLI, 'memory', '--offline'], { cwd: lane, encoding: 'utf8' });
  assert.equal(resumed.status, 0, resumed.stderr); assert.match(resumed.stdout, /offline-cache/u);
});

test('two devices converge on a remote append without merging or modifying either checkout', t => {
  const s = fixture(t), first = s.hydrate();
  const secondSource = join(s.parent, 'device-b-memory');
  s.run(s.parent, ['clone', '--quiet', '--branch=main', s.bare, secondSource]);
  const oldHead = s.run(secondSource, ['rev-parse', 'HEAD']);
  writeFileSync(s.shard, readFileSync(s.shard, 'utf8') + entry('020202', 'A second device can read this accepted append.'));
  s.commit(s.source); s.run(s.source, ['push', '--quiet', 'origin', 'main']);
  const second = s.hydrate(); assert.equal(second.entries, 2); assert.notEqual(second.sourceRevision, first.sourceRevision);
  s.run(s.root, ['config', '--local', 'agentic-os.memoryRoot', secondSource]);
  const other = s.hydrate(); assert.equal(other.sourceRevision, second.sourceRevision);
  assert.deepEqual(load(other), load(second));
  assert.equal(s.run(secondSource, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(s.run(secondSource, ['status', '--porcelain']), '');
});

test('offline reuse requires a prior validated snapshot and labels freshness honestly', t => {
  const s = fixture(t);
  assert.throws(() => s.hydrate({ offline: true }), /unavailable-no-cache/u);
  const ready = s.hydrate();
  const offline = s.hydrate({ offline: true });
  assert.equal(offline.status, 'offline-cache'); assert.equal(offline.refreshError, 'offline-requested');
  assert.equal(offline.sourceRevision, ready.sourceRevision);
  rmSync(s.bare, { recursive: true });
  const unavailable = s.hydrate();
  assert.equal(unavailable.status, 'offline-cache'); assert.equal(unavailable.refreshError, 'fetch-failed');
});

test('shared source lock refuses a second process before fetch or cache mutation', t => {
  const s = fixture(t), ready = s.hydrate(), before = readFileSync(ready.index);
  const lock = acquireOperationLock('agentic-os-memory', s.source);
  try {
    const result = s.invoke('memory');
    assert.equal(result.status, 1); assert.match(result.stderr, /blocked-memory-busy/u);
    assert.deepEqual(readFileSync(ready.index), before);
  } finally { finishOperationLock(lock, { label: 'test', result: null }); }
  assert.equal(s.hydrate().reused, true);
});

test('remote mismatch fails closed even with a usable cache and creates no lane', t => {
  const s = fixture(t); s.hydrate();
  s.run(s.source, ['remote', 'set-url', 'origin', '/wrong-remote']);
  const result = s.invoke('start', 'bad-memory', '--device=device-a', '--write=change.txt');
  assert.equal(result.status, 1); assert.match(result.stderr, /blocked-memory-remote-identity/u);
  assert.equal(s.run(s.root, ['rev-parse', '--verify', '--quiet', 'agent/device-a/bad-memory'], { allowFail: true }), null);
});

test('config comes from the protected commit, including after a local uncommitted edit', t => {
  const s = fixture(t);
  writeFileSync(join(s.root, '.agentic-os-memory.json'), '{broken');
  assert.equal(s.hydrate().entries, 1);
  s.run(s.root, ['config', '--local', '--add', 'agentic-os.memoryRoot', '../another']);
  assert.throws(() => s.hydrate(), /root-selection/u);
});

test('rewritten, deleted and malformed records preserve the accepted cache and offline source', t => {
  const s = fixture(t), accepted = s.hydrate(), before = readFileSync(accepted.index);
  writeFileSync(s.shard, header + entry('010101', 'Rewritten history'));
  s.commit(s.source); s.run(s.source, ['push', '--quiet', 'origin', 'main']);
  assert.throws(() => s.hydrate(), /append-only/u);
  assert.deepEqual(readFileSync(accepted.index), before);
  assert.equal(s.hydrate({ offline: true }).sourceRevision, accepted.sourceRevision);
  rmSync(s.shard); s.commit(s.source); s.run(s.source, ['push', '--quiet', 'origin', 'main']);
  assert.throws(() => s.hydrate(), /shard-removed/u);
});

test('duplicate or invalid timestamps, symlink shards and oversized input fail before indexing', t => {
  const s = fixture(t);
  for (const content of [header + entry('250101'), header + entry('010101') + entry('010101'),
    header + entry('010101') + 'x'.repeat(65536)]) {
    writeFileSync(s.shard, content); s.commit(s.source); s.run(s.source, ['push', '--quiet', 'origin', 'main']);
    assert.throws(() => s.hydrate());
  }
  rmSync(s.shard); symlinkSync('../README.md', s.shard); s.commit(s.source);
  s.run(s.source, ['push', '--quiet', 'origin', 'main']);
  assert.throws(() => s.hydrate(), /shard-file/u);
});

test('corrupted or symlinked cache is never used or overwritten', t => {
  const s = fixture(t), ready = s.hydrate();
  writeFileSync(ready.index, '{broken'); assert.throws(() => s.hydrate());
  rmSync(ready.index); const victim = join(s.parent, 'private.txt'); writeFileSync(victim, 'preserve');
  symlinkSync(victim, ready.index); assert.throws(() => s.hydrate());
  assert.equal(readFileSync(victim, 'utf8'), 'preserve');
});

test('an empty curated corpus is valid and reports zero records', t => {
  const s = fixture(t, { records: false });
  const result = s.hydrate(); assert.equal(result.status, 'ready'); assert.equal(result.entries, 0);
});


test('non-forward remote history cannot replace an accepted source', t => {
  const s = fixture(t), ready = s.hydrate(), before = readFileSync(ready.index);
  const unrelated = s.run(s.source, ['commit-tree', 'HEAD^{tree}', '-m', 'unrelated root']);
  s.run(s.source, ['push', '--quiet', '--force', 'origin', `${unrelated}:refs/heads/main`]);
  assert.throws(() => s.hydrate(), /history-not-forward/u);
  assert.deepEqual(readFileSync(ready.index), before);
  assert.equal(s.hydrate({ offline: true }).sourceRevision, ready.sourceRevision);
});

test('a hanging transport is terminated at the deadline and returns the accepted offline snapshot', t => {
  const s = fixture(t), ready = s.hydrate(), wrappers = join(s.parent, 'wrappers');
  mkdirSync(wrappers);
  const wrapper = join(wrappers, 'git'), marker = join(wrappers, 'transport-pids');
  writeFileSync(wrapper, '#!/bin/sh\nfor arg do\n  if [ "$arg" = fetch ]; then\n'
    + '    sleep 120 &\n    echo "$$ $!" > "$MEMORY_TEST_PIDS"\n    wait\n    exit 0\n  fi\ndone\n'
    + 'exec /usr/bin/git "$@"\n');
  chmodSync(wrapper, 0o755);
  const oldPath = process.env.PATH, oldMarker = process.env.MEMORY_TEST_PIDS;
  try {
    process.env.PATH = `${wrappers}:${oldPath}`; process.env.MEMORY_TEST_PIDS = marker;
    const result = s.hydrate();
    assert.equal(result.status, 'offline-cache'); assert.equal(result.refreshError, 'timeout');
    assert.equal(result.sourceRevision, ready.sourceRevision);
    for (const pid of readFileSync(marker, 'utf8').trim().split(' ')) {
      const status = spawnSync('ps', ['-o', 'stat=', '-p', pid], { encoding: 'utf8' });
      assert.ok(!status.stdout.trim() || status.stdout.trim().startsWith('Z'), `transport ${pid} remains active`);
    }
  } finally {
    process.env.PATH = oldPath;
    if (oldMarker === undefined) delete process.env.MEMORY_TEST_PIDS; else process.env.MEMORY_TEST_PIDS = oldMarker;
  }
});
