import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, consolidate, policy } from './helpers/workspace.mjs';
import { syncWorkspace } from '../bin/agentic-os-workspace-sync.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { memoryTaskContext, searchMemory, readMemory, captureMemory } from '../bin/agentic-os-memory-task.mjs';

const header = (period = '2026-09') => `---\nschema: memory-log/v1\nagent: test\ndevice: test-device\nperiod: ${period}\ntimestamp_format: YYYYMMDDTHHmmssZ\nappend_policy: append-only\nsource_contract: https://example.invalid/memory-log\n---\n`;
const record = (id = '20260911T010000Z', summary = 'Keep shared decisions pinned.', refs = '[../evidence.md]') =>
  `## @mem-${id}\ntype: decision\nscope: task-memory\nsummary: ${summary}\nrefs: ${refs}\n`;
const handoff = body => `# Task completion\nExisting check and release evidence.\n\n\x60\x60\x60memory-log/v1\n${body}\x60\x60\x60\n`;
function setup(t) {
  const s = consolidate(fixture(t));
  mkdirSync(join(s.sources.memory, 'records'));
  writeFileSync(join(s.sources.memory, 'records/2026-09.md'), header() + record());
  writeFileSync(join(s.sources.memory, 'evidence.md'), 'committed evidence\n');
  writeFileSync(join(s.sources.memory, 'MEMORY.md'), 'keyword first\nother context\nkeyword second\nkeyword third\n');
  s.commit(s.container); s.run(s.container, ['push', '--quiet', 'origin', 'main']);
  const receipt = syncWorkspace(s.root, policy), revision = receipt.sourceRevision;
  return { ...s, receipt, revision, context: () => memoryTaskContext(s.root, policy, revision) };
}
test('pinned retrieval is local-only, bounded, and preserves dirty source and cache bytes', t => {
  const s = setup(t), cache = s.receipt.sources.memory.index;
  const before = readFileSync(cache), inode = statSync(cache).ino;
  writeFileSync(join(s.sources.memory, 'evidence.md'), 'unfinished owner draft\n');
  renameSync(s.config.remote, `${s.config.remote}-offline`);
  const context = s.context();
  const result = searchMemory(context, { query: 'shared decisions' });
  assert.equal(result.matches.length, 1); assert.equal(result.indexReused, true);
  assert.equal(result.remoteFreshness, 'not-checked-refresh-before-effects');
  assert.equal(readMemory(context, { path: '.memory/evidence.md' }).lines[0], 'committed evidence');
  assert.equal(readFileSync(join(s.sources.memory, 'evidence.md'), 'utf8'), 'unfinished owner draft\n');
  assert.deepEqual(readFileSync(cache), before); assert.equal(statSync(cache).ino, inode);
  assert.equal(s.run(s.container, ['rev-parse', 'HEAD']), s.revision);
});
test('explicit archive search and reads paginate without loading the archive into the response', t => {
  const s = setup(t), context = s.context();
  const first = searchMemory(context, { path: '.memory/MEMORY.md', query: 'keyword', limit: 1 });
  assert.deepEqual(first.matches, [{ line: 1, text: 'keyword first' }]); assert.equal(first.hasMore, true);
  const next = searchMemory(context, { path: '.memory/MEMORY.md', query: 'keyword', limit: 1,
    afterLine: first.nextAfterLine });
  assert.equal(next.matches[0].line, 3);
  const read = readMemory(context, { path: '.memory/MEMORY.md', line: 2, lines: 1 });
  assert.deepEqual(read.lines, ['other context']); assert.equal(read.nextLine, 3);
  assert.equal(searchMemory(context, { query: 'absent' }).matches.length, 0);
});
test('peer refresh and independent device caches never change an already pinned task revision', t => {
  const s = setup(t);
  const secondRoot = join(s.parent, 'second-consumer'), secondSource = join(s.parent, 'second-workspace');
  s.run(s.parent, ['clone', '--quiet', s.root, secondRoot]);
  s.run(s.parent, ['clone', '--quiet', s.config.remote, secondSource]);
  s.run(secondRoot, ['config', '--local', 'agentic-os.workspaceRoot', secondSource]);
  const second = syncWorkspace(secondRoot, policy);
  assert.equal(second.sourceRevision, s.revision);
  assert.notEqual(second.sources.memory.index, s.receipt.sources.memory.index);
  writeFileSync(join(s.sources.memory, 'records/2026-09.md'), header() + record()
    + '\n' + record('20260911T020000Z', 'New peer decision.'));
  s.commit(s.container); s.run(s.container, ['push', '--quiet', 'origin', 'main']);
  const newer = syncWorkspace(s.root, policy);
  const old = s.context();
  assert.equal(old.indexReused, false);
  assert.equal(searchMemory(old, { query: 'peer' }).matches.length, 0);
  assert.throws(() => captureMemory(old, handoff(record('20260911T030000Z'))), /refresh-before-capture/);
  assert.equal(syncWorkspace(secondRoot, policy).sourceRevision, newer.sourceRevision);
  assert.equal(searchMemory(memoryTaskContext(secondRoot, policy, newer.sourceRevision),
    { query: 'peer' }).matches.length, 1);
  assert.equal(searchMemory(memoryTaskContext(secondRoot, policy, newer.sourceRevision),
    { query: 'task-memory', limit: 1 }).matches[0].id, '@mem-20260911T020000Z');
});
test('capture reuses a handoff record, preserves source, and becomes idempotent after publication', t => {
  const s = setup(t), file = join(s.sources.memory, 'records/2026-09.md'), before = readFileSync(file);
  const body = record('20260911T020000Z', 'Capture the existing handoff decision.');
  const proposal = captureMemory(s.context(), handoff(body));
  assert.equal(proposal.status, 'proposal'); assert.equal(proposal.sourceWritten, false);
  assert.equal(proposal.grantsAuthority, false); assert.equal(proposal.append, '\n' + body);
  assert.deepEqual(readFileSync(file), before);
  writeFileSync(file, Buffer.concat([before, Buffer.from(proposal.append)]));
  s.commit(s.container); s.run(s.container, ['push', '--quiet', 'origin', 'main']);
  const newer = syncWorkspace(s.root, policy), context = memoryTaskContext(s.root, policy, newer.sourceRevision);
  assert.equal(captureMemory(context, handoff(body)).status, 'already-present');
  assert.throws(() => captureMemory(context, handoff(record('20260911T020000Z', 'Conflicting summary.'))),
    /record-id-conflict/);
  assert.deepEqual(readFileSync(file).subarray(0, before.length), before);
});
test('capture validates new month headers, chronology, references, and one explicit bounded block', t => {
  const s = setup(t), context = s.context(), next = record('20261001T000000Z');
  const proposal = captureMemory(context, handoff(header('2026-10') + next));
  assert.equal(proposal.create, true); assert.equal(proposal.path, '.memory/records/2026-10.md');
  assert.throws(() => captureMemory(context, handoff(next)), /source-header-required/);
  for (const body of [record('20260910T000000Z'), record('20260911T020000Z', 'Bad ref.', '[../absent.md]'),
    record('20260911T020000Z', 'Bad URL.', '[https://user:secret@example.invalid/a]')])
    assert.throws(() => captureMemory(context, handoff(body)), /entry-order|reference-missing|reference-url/);
  assert.throws(() => captureMemory(context, handoff(record()) + handoff(record())), /one-bounded-memory-block/);
  assert.throws(() => captureMemory(context, 'an ordinary handoff'), /one-bounded-memory-block/);
  assert.throws(() => captureMemory(context, 'x'.repeat(16385)), /handoff-budget/);
});
test('unsafe paths, symlinks, oversized text, malformed bounds and unaccepted revisions fail closed', t => {
  const s = setup(t), context = s.context();
  for (const path of ['../secret', '.memory/../README.md', '.todo/docs/TODO.md', '.git/config'])
    assert.throws(() => readMemory(context, { path }), /memory-path/);
  for (const options of [{ query: '' }, { query: 'x'.repeat(257) }, { query: 'x', limit: 21 },
    { query: 'x', afterLine: 1 }]) assert.throws(() => searchMemory(context, options), /query|budget|pagination/);
  assert.throws(() => readMemory(context, { path: '.memory/MEMORY.md', lines: 81 }), /numeric-budget/);
  assert.throws(() => memoryTaskContext(s.root, policy, 'main'), /exact-snapshot-required/);
  symlinkSync('/outside', join(s.sources.memory, 'link'));
  writeFileSync(join(s.sources.memory, 'large.md'), 'x'.repeat(500000));
  writeFileSync(join(s.sources.memory, 'long-line.md'), 'x'.repeat(17000));
  s.commit(s.container); const head = s.run(s.container, ['rev-parse', 'HEAD']);
  assert.throws(() => memoryTaskContext(s.root, policy, head), /snapshot-not-accepted/);
  s.run(s.container, ['push', '--quiet', 'origin', 'main']); syncWorkspace(s.root, policy);
  const newer = memoryTaskContext(s.root, policy, head);
  assert.throws(() => readMemory(newer, { path: '.memory/link' }), /regular-file/);
  assert.throws(() => readMemory(newer, { path: '.memory/large.md' }), /blob-budget/);
  assert.throws(() => readMemory(newer, { path: '.memory/long-line.md' }), /output-budget/);
});
test('CLI validates grammar, requires enrollment/cache, and exposes pinned search without a new fetch', t => {
  for (const argv of [['search', '--query=x'], ['read', '--revision=HEAD'], ['capture', '--handoff=x'],
    ['search', '--revision=x', '--query=y', '--offline']])
    assert.ok(validateCommandArguments('memory', argv));
  const s = setup(t);
  const result = s.invoke('memory', 'search', `--revision=${s.revision}`, '--query=shared');
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"operation":"search"/);
  renameSync(s.receipt.sources.memory.index, `${s.receipt.sources.memory.index}.saved`);
  assert.throws(() => s.context(), /unavailable-no-cache/);
  s.run(s.root, ['config', '--local', '--unset', 'agentic-os.workspaceRoot']);
  assert.throws(() => s.context(), /workspace-enrollment-required/);
});
