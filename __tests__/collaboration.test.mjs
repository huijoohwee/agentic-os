import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fixture, consolidate, policy } from './helpers/workspace.mjs';
import { syncWorkspace } from '../bin/agentic-os-workspace-sync.mjs';
import { emptyBoard, transitionBoard, validateBoard } from '../bin/agentic-os-collaboration.mjs';
import { collaborationContext, updateBoard, observeBoard, BOARD_REF } from '../bin/agentic-os-collaboration-store.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { toolArguments } from '../src/mcp-server.mjs';
const repository = 'local:workspace-test', sha = 'a'.repeat(40), contextSha = 'b'.repeat(40);
const alice = { device: 'device-a', agent: 'worker-a', provider: 'codex', model: 'inherited' };
const bob = { device: 'device-b', agent: 'worker-b', provider: 'other-llm', model: 'local-model' };
const submit = (id, writePaths = [], revision = sha, memory = contextSha) => ({ expectedRevision: 'absent',
  id, sourceRevision: revision, contextRevision: memory, objective: 'Inspect the pinned change and return bounded evidence.',
  writePaths, maxSeconds: 1200, maxTokens: 4000 });
const change = (board, op, value, now = 1000) => transitionBoard(board, op, value, { repository, now });
const own = (id, actor = alice, epoch = 1) => ({ expectedRevision: sha, id, actor, epoch });
function setup(t) {
  const s = consolidate(fixture(t));
  const profile = JSON.parse(readFileSync(join(s.root, '.agentic-os.json')));
  s.run(s.root, ['config', '--local', 'agentic-os.collaborationEnabled', 'true']);
  const memory = syncWorkspace(s.root, policy).sourceRevision;
  const context = collaborationContext(s.root, policy, profile);
  const source = s.run(s.root, ['rev-parse', policy.protectedRef]);
  return { ...s, profile, context, source, memory, input: id => submit(id, [], source, memory) };
}
function peer(s) {
  const root = join(s.parent, 'consumer-two'), workspace = join(s.parent, 'workspace-two');
  s.run(s.parent, ['clone', '--quiet', s.root, root]); s.run(s.parent, ['clone', '--quiet', s.config.remote, workspace]);
  s.run(workspace, ['config', 'user.name', 'Second device']); s.run(workspace, ['config', 'user.email', 'second@example.invalid']);
  s.run(root, ['config', '--local', 'agentic-os.workspaceRoot', workspace]);
  s.run(root, ['config', '--local', 'agentic-os.collaborationEnabled', 'true']);
  syncWorkspace(root, policy);
  return collaborationContext(root, policy, s.profile);
}
test('cooperative claims cap concurrency and reject overlapping writers without blocking independent reads', () => {
  let board = change(emptyBoard(), 'submit', submit('one', ['src']));
  board = change(board, 'submit', submit('two', ['src/file.mjs']));
  board = change(board, 'submit', submit('read'));
  board = change(board, 'claim', { expectedRevision: sha, id: 'one', actor: alice });
  assert.throws(() => change(board, 'claim', { expectedRevision: sha, id: 'two', actor: bob }), /write-overlap/);
  board = change(board, 'claim', { expectedRevision: sha, id: 'read', actor: bob });
  assert.equal(board.tasks.filter(t => t.state === 'active').length, 2);
  assert.throws(() => change(board, 'claim', { expectedRevision: sha, id: 'two', actor: bob }), /active-budget/);
});
test('expiry retains reservations; stopped owner release permits a newly fenced bounded attempt', () => {
  let board = change(emptyBoard(), 'submit', submit('one', ['src']));
  board = change(board, 'claim', { expectedRevision: sha, id: 'one', actor: alice });
  assert.throws(() => change(board, 'renew', own('one'), 601001), /expired/);
  assert.throws(() => change(board, 'claim', { expectedRevision: sha, id: 'one', actor: bob }, 601001), /already-claimed/);
  assert.throws(() => change(board, 'release', { ...own('one', bob), stopped: true }, 601001), /fence/);
  assert.throws(() => change(board, 'release', { ...own('one'), stopped: false }, 601001), /stop-ack/);
  board = change(board, 'release', { ...own('one'), stopped: true }, 601001);
  board = change(board, 'claim', { expectedRevision: sha, id: 'one', actor: bob }, 601002);
  assert.equal(board.tasks[0].epoch, 2);
  assert.throws(() => change(board, 'renew', own('one'), 601003), /fence/);
  board = change(board, 'release', { ...own('one', bob, 2), stopped: true }, 601003);
  board = change(board, 'claim', { expectedRevision: sha, id: 'one', actor: bob }, 601004);
  board = change(board, 'release', { ...own('one', bob, 3), stopped: true }, 601005);
  assert.throws(() => change(board, 'claim', { expectedRevision: sha, id: 'one', actor: bob }, 601006), /attempt-budget/);
});
test('handoffs bind the holder, stop acknowledgement, source and reported token budget without granting acceptance', () => {
  let board = change(emptyBoard(), 'submit', submit('one'));
  board = change(board, 'claim', { expectedRevision: sha, id: 'one', actor: alice });
  const result = { outcome: 'success', summary: 'No change required.', sourceRevision: sha,
    refs: ['https://example.invalid/evidence'], tokens: 100, stopped: true };
  for (const invalid of [{ ...result, stopped: false }, { ...result, tokens: 4001 },
    { ...result, sourceRevision: contextSha }, { ...result, refs: ['https://user:secret@example.invalid'] }])
    assert.throws(() => change(board, 'report', { ...own('one'), result: invalid }), /handoff|budget|source-drift|reference/);
  board = change(board, 'report', { ...own('one'), result });
  assert.equal(board.tasks[0].state, 'reported');
  assert.throws(() => change(board, 'report', { ...own('one'), result }), /fence/);
  board = change(board, 'archive', own('one'));
  assert.equal(board.tasks.length, 0); assert.equal(board.sequence, 1);
  board = change(board, 'submit', submit('one'));
  board = change(board, 'claim', { expectedRevision: sha, id: 'one', actor: alice });
  assert.equal(board.tasks[0].epoch, 2);
  assert.throws(() => change(board, 'renew', own('one')), /fence/);
});
test('closed contracts reject unsafe paths, duplicate tasks, clock regression, malformed state and oversize input', () => {
  for (const value of [{ ...submit('one'), unexpected: true }, { ...submit('one'), writePaths: ['../x'] },
    { ...submit('one'), writePaths: ['.git/config'] }, { ...submit('one'), maxTokens: 0 },
    { ...submit('one'), objective: 'x'.repeat(1025) }, { ...submit('one'), contextRevision: 'main' }])
    assert.throws(() => change(emptyBoard(), 'submit', value));
  const board = change(emptyBoard(), 'submit', submit('one'));
  assert.throws(() => change(board, 'submit', submit('one')), /task-exists/);
  assert.throws(() => change(board, 'submit', submit('two'), 999), /number/);
  assert.throws(() => validateBoard({ ...board, tasks: [board.tasks[0], structuredClone(board.tasks[0])] }), /duplicate-task/);
  assert.throws(() => validateBoard({ ...board, tasks: [{ ...board.tasks[0], state: 'active' }] }), /claim-state/);
});
test('independent clones share provider-neutral tasks while preserving checkout, index, dirty and vendor-independent state', t => {
  const s = setup(t), other = peer(s);
  const before = readFileSync(join(s.sources.memory, 'README.md'));
  writeFileSync(join(s.sources.memory, 'README.md'), 'unfinished local draft\n');
  const initial = updateBoard(s.context, 'submit', s.input('one'));
  assert.equal(initial.grantsAuthority, false); assert.equal(initial.execution, 'caller-owned');
  const seen = observeBoard(other); assert.equal(seen.revision, initial.revision);
  const claimed = updateBoard(other, 'claim', { expectedRevision: seen.revision, id: 'one', actor: bob });
  assert.equal(observeBoard(s.context, { taskId: 'one' }).task.actor.provider, 'other-llm');
  assert.equal(readFileSync(join(s.sources.memory, 'README.md'), 'utf8'), 'unfinished local draft\n');
  assert.equal(s.run(s.container, ['rev-parse', 'HEAD']), s.memory);
  assert.equal(s.run(s.container, ['diff', '--cached']), '');
  const handoff = { ...own('one', bob), expectedRevision: claimed.revision,
    result: { outcome: 'success', summary: 'Pinned review complete.', sourceRevision: s.source,
      refs: [], tokens: 120, stopped: true } };
  const reported = updateBoard(other, 'report', handoff);
  assert.equal(observeBoard(s.context).revision, reported.revision);
  const archived = updateBoard(other, 'archive', { ...own('one', bob), expectedRevision: reported.revision });
  assert.equal(observeBoard(s.context).revision, archived.revision);
  assert.equal(observeBoard(s.context).tasks.length, 0);
  assert.equal(JSON.parse(s.run(s.container, ['show', `${reported.revision}:board.json`])).tasks[0].state, 'reported');
  assert.deepEqual(readFileSync(join(other.source, '.memory/README.md')), before);
  renameSync(s.config.remote, `${s.config.remote}-offline`);
  assert.equal(observeBoard(s.context, { offline: true }).status, 'offline-context-only');
  assert.throws(() => updateBoard(s.context, 'submit', { ...s.input('two'), expectedRevision: archived.revision }));
});
test('parallel devices race one exact board revision: at most one claim publishes and no task is silently lost', async t => {
  const s = setup(t), other = peer(s), initial = updateBoard(s.context, 'submit', s.input('race'));
  const worker = new URL('../bin/agentic-os-collaboration-store.mjs', import.meta.url).href;
  const launch = (context, actor) => {
    const script = `import {updateBoard} from ${JSON.stringify(worker)};try {console.log(JSON.stringify(updateBoard(${JSON.stringify(context)},'claim',${JSON.stringify({ expectedRevision: initial.revision, id: 'race', actor })})));}catch(e){console.log(JSON.stringify({error:e.message,unknown:e.writeResultUnknown}));process.exitCode=1;}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script]); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    return once(child, 'close').then(([code]) => ({ code, output }));
  };
  const outcomes = await Promise.all([launch(s.context, alice), launch(other, bob)]);
  assert.equal(outcomes.filter(r => r.code === 0).length, 1, JSON.stringify(outcomes));
  assert.match(outcomes.find(r => r.code !== 0).output, /stale-revision|publication-not-current/);
  const observed = observeBoard(s.context, { taskId: 'race' });
  assert.equal(observed.task.epoch, 1); assert.equal(observed.task.state, 'active');
});
test('rejected publication is retained as a reconcile-required outcome and never updates checkout or accepted cache', t => {
  if (process.platform === 'win32') { t.skip('POSIX receive hook fixture'); return; }
  const s = setup(t), initial = updateBoard(s.context, 'submit', s.input('one'));
  const hook = join(s.config.remote, 'hooks/pre-receive'); writeFileSync(hook, '#!/bin/sh\nexit 1\n'); chmodSync(hook, 0o700);
  assert.throws(() => updateBoard(s.context, 'claim', { expectedRevision: initial.revision, id: 'one', actor: alice }),
    error => /publication-not-current/.test(error.message) && error.writeResultUnknown === true);
  const file = join(s.parent, 'rejected.json');
  writeFileSync(file, JSON.stringify({ expectedRevision: initial.revision, id: 'one', actor: alice }));
  const rejected = s.invoke('collaborate', 'claim', `--input=${file}`);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /"candidateOid":"[a-f0-9]{40}"/);
  assert.match(rejected.stderr, /"writeResultUnknown":true/);
  assert.equal(observeBoard(s.context).revision, initial.revision);
  assert.equal(s.run(s.container, ['rev-parse', 'HEAD']), s.memory);
});
test('enrollment, source pins, changed remote identity and rewritten board history fail closed', t => {
  const s = setup(t);
  s.run(s.root, ['config', '--unset', 'agentic-os.collaborationEnabled']);
  assert.throws(() => collaborationContext(s.root, policy, s.profile), /enrollment-required/);
  s.run(s.root, ['config', 'agentic-os.collaborationEnabled', 'true']);
  assert.throws(() => updateBoard(s.context, 'submit', { ...s.input('one'), sourceRevision: sha }), /source-pin/);
  const initial = updateBoard(s.context, 'submit', s.input('one'));
  s.run(s.container, ['push', '--quiet', '--force', 'origin', `${s.memory}:${BOARD_REF}`]);
  assert.throws(() => observeBoard(s.context), /history-rewrite/);
  s.run(s.container, ['remote', 'set-url', 'origin', `${s.config.remote}-other`]);
  assert.throws(() => observeBoard(s.context, { offline: true }), /remote-drift/);
  assert.ok(initial.revision);
});
test('CLI and MCP expose only bounded explicit operations; offline mutation and unknown fields are refused', t => {
  assert.equal(validateCommandArguments('collaborate', ['status', '--offline']), null);
  for (const args of [['claim'], ['claim', '--input=x', '--offline'], ['spawn', '--input=x'], ['status', '--input=x']])
    assert.ok(validateCommandArguments('collaborate', args));
  assert.deepEqual(toolArguments('collaborate', { operation: 'claim', input: 'one.json' }),
    ['collaborate', 'claim', '--input=one.json']);
  assert.deepEqual(toolArguments('collaborate', { operation: 'status', offline: true }), ['collaborate', 'status', '--offline']);
  assert.throws(() => toolArguments('collaborate', { operation: 'claim', input: 'x', offline: false }));
  const s = setup(t), file = join(s.parent, 'input.json'); writeFileSync(file, JSON.stringify(s.input('cli')));
  const result = s.invoke('collaborate', 'submit', `--input=${file}`);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"status":"published"/);
  assert.equal(s.invoke('collaborate', 'status', '--offline').status, 0);
});
