import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { acquireOperationLock, finishOperationLock } from '../src/git.mjs';
import { syncWorkspace, watchWorkspace, watchLoop, watchSettings } from '../bin/agentic-os-workspace-sync.mjs';
import { fixture, consolidate, policy, CLI } from './helpers/workspace.mjs';
function writer(s) {
  const path = join(s.parent, 'device-b');
  s.run(s.parent, ['clone', '--quiet', s.config.remote, path]);
  s.run(path, ['switch', '--quiet', 'main']);
  s.run(path, ['config', 'user.name', 'Other Device']);
  s.run(path, ['config', 'user.email', 'other@example.invalid']);
  return path;
}
function publish(s, path) {
  s.commit(path); s.run(path, ['push', '--quiet', 'origin', 'main']);
  return s.run(path, ['rev-parse', 'HEAD']);
}
test('remote publication refreshes all roles at one SHA while preserving dirty files and tracking refs', t => {
  const s = consolidate(fixture(t)), before = syncWorkspace(s.root, policy), other = writer(s);
  writeFileSync(join(s.sources.artifacts, 'README.md'), 'local unfinished bytes\n');
  writeFileSync(join(other, '.todo/docs/TODO.md'), '# Next planning contract\n');
  writeFileSync(join(other, '.artifacts/README.md'), 'published elsewhere\n');
  const next = publish(s, other), receipt = syncWorkspace(s.root, policy);
  const consumer = join(s.parent, 'consumer-b');
  s.run(s.parent, ['clone', '--quiet', s.root, consumer]);
  s.run(consumer, ['config', '--local', 'agentic-os.workspaceRoot', '../device-b']);
  const second = syncWorkspace(consumer, policy);
  assert.equal(second.sourceRevision, next);
  assert.ok(Object.values(second.sources).every(source => source.sourceRevision === next));
  assert.notEqual(second.sources.memory.index, receipt.sources.memory.index);
  assert.equal(receipt.sourceRevision, next);
  assert.ok(Object.values(receipt.sources).every(source => source.sourceRevision === next));
  assert.equal(s.run(s.container, ['rev-parse', 'origin/main']), before.sourceRevision);
  assert.equal(readFileSync(join(s.sources.artifacts, 'README.md'), 'utf8'), 'local unfinished bytes\n');
  const bytes = readFileSync(receipt.sources.memory.index);
  const unchanged = syncWorkspace(s.root, policy);
  assert.equal(unchanged.sources.memory.reused, true);
  assert.deepEqual(readFileSync(receipt.sources.memory.index), bytes);
  const offline = syncWorkspace(s.root, policy, { offline: true });
  assert.equal(offline.sources.memory.status, 'offline-cache');
  assert.ok(Object.values(offline.sources).every(source => source.sourceRevision === next));
});
test('invalid remote TODO preserves the complete accepted snapshot and can recover after repair', t => {
  const s = consolidate(fixture(t)), before = syncWorkspace(s.root, policy), other = writer(s);
  const bytes = readFileSync(before.sources.memory.index);
  rmSync(join(other, '.todo/docs/TODO.md')); publish(s, other);
  assert.throws(() => syncWorkspace(s.root, policy), /todo-contract/u);
  assert.deepEqual(readFileSync(before.sources.memory.index), bytes);
  const offline = syncWorkspace(s.root, policy, { offline: true });
  assert.ok(Object.values(offline.sources).every(source => source.sourceRevision === before.sourceRevision));
  writeFileSync(join(other, '.todo/docs/TODO.md'), '# Repaired\n');
  assert.equal(syncAfterPublish().sourceRevision, s.run(other, ['rev-parse', 'HEAD']));
  function syncAfterPublish() { publish(s, other); return syncWorkspace(s.root, policy); }
});
test('a source clone admits only one session watcher and SIGTERM releases its lock', async t => {
  const s = consolidate(fixture(t)), lock = acquireOperationLock('agentic-os-workspace-watch', s.container);
  try { await assert.rejects(watchWorkspace(s.root, policy), /watch-busy/u); }
  finally { finishOperationLock(lock, { label: 'test', result: null }); }
  const child = spawn(process.execPath, [CLI, 'workspace', 'watch'], { cwd: s.root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close');
  const ready = await Promise.race([once(child.stdout, 'data'), closed.then(() => { throw new Error(stderr); })]);
  assert.match(String(ready[0]), /^workspace /u);
  child.kill('SIGTERM');
  const [code] = await closed; assert.equal(code, 0, stderr);
  const recovered = acquireOperationLock('agentic-os-workspace-watch', s.container);
  assert.ok(recovered); finishOperationLock(recovered, { label: 'test', result: null });
});
test('watch coalesces output, backs off offline, recovers promptly, and respects the session deadline', async () => {
  let elapsed = 0, calls = 0; const emitted = [], waits = [];
  const receipt = (sha, error = null) => ({ sourceRevision: sha, configRevision: 'config',
    sources: { memory: { status: error ? 'offline-cache' : 'ready', refreshError: error } } });
  const values = [receipt('a'), receipt('a'), receipt('a', 'fetch-failed'), receipt('b'), receipt('b')];
  const result = await watchLoop({ intervalMs: 1000, durationMs: 6000, now: () => elapsed,
    observe: () => values[Math.min(calls++, values.length - 1)], emit: value => emitted.push(value),
    sleep: async ms => { waits.push(ms); elapsed += ms; } });
  assert.deepEqual(emitted.map(value => value.sourceRevision), ['a', 'a', 'b']);
  assert.deepEqual(waits, [1000, 1000, 2000, 1000, 1000]);
  assert.equal(result.attempts, 5);
  const controller = new AbortController(); controller.abort();
  const stopped = await watchLoop({ signal: controller.signal, observe: () => assert.fail(), emit: () => assert.fail() });
  assert.equal(stopped.attempts, 0);
});
test('invalid watch budgets and command arguments fail before transport or locks', t => {
  for (const options of [{ intervalMs: 0 }, { intervalMs: NaN }, { durationMs: Infinity }, { durationMs: 43200001 }])
    assert.throws(() => watchSettings(options), /watch-budget/u);
  const s = fixture(t, false);
  for (const args of [['workspace', 'watch', '--offline'], ['workspace', 'sync', '--source=todo'],
    ['workspace', 'check', '--repository=/tmp']]) {
    const result = s.invoke(...args); assert.equal(result.status, 1); assert.match(result.stderr, /invalid-arguments/u);
  }
});
