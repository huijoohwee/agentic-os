import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { checkWorkspace } from '../bin/agentic-os-workspace-check.mjs';
import { fixture, consolidate } from './helpers/workspace.mjs';
const header = '---\nschema: memory-log/v1\nagent: test\ndevice: a\nperiod: 2026-09\n'
  + 'timestamp_format: YYYYMMDDTHHmmssZ\nappend_policy: append-only\nsource_contract: https://example.com/contract\n---\n';
const record = (second, ref = 'https://example.com/source') => `\n## @mem-20260910T0000${second}Z\n`
  + `type: decision\nscope: task\nsummary: Retain evidence.\nrefs: [${ref}]\n`;
function setup(t) {
  const s = consolidate(fixture(t));
  const records = join(s.sources.memory, 'records'); mkdirSync(records);
  const shard = join(records, '2026-09.md'); writeFileSync(shard, header + record('01'));
  mkdirSync(join(s.sources.todo, 'todo/2026-09'), { recursive: true });
  writeFileSync(join(s.sources.todo, 'todo/2026-09/accepted.md'), 'immutable source\n');
  writeFileSync(join(s.sources.artifacts, 'retained.txt'), 'keep folder present\n');
  s.commit(s.container);
  const base = s.run(s.container, ['rev-parse', 'HEAD']);
  return { ...s, shard, base, check: () => checkWorkspace({ root: s.container, base,
    head: s.run(s.container, ['rev-parse', 'HEAD']), config: s.config }) };
}
test('check binds append-only memory and changed artifact digests to exact commits, ignoring dirty bytes', t => {
  const s = setup(t), bytes = Buffer.from('finalized evidence\n');
  writeFileSync(s.shard, header + record('01') + record('02'));
  writeFileSync(join(s.sources.artifacts, 'result.txt'), bytes); s.commit(s.container);
  writeFileSync(join(s.sources.artifacts, 'result.txt'), 'unfinished local edits\n');
  const result = s.check();
  assert.equal(result.status, 'passed'); assert.equal(result.memoryEntries, 2);
  assert.equal(result.artifacts[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.artifacts[0].bytes, bytes.length);
  assert.equal(result.grantsAuthority, false);
  const invoked = s.invoke('workspace', 'check', `--repository=${s.container}`,
    `--config=${join(s.root, '.agentic-os-workspace.json')}`, `--base=${s.base}`, `--head=${result.head}`);
  assert.equal(invoked.status, 0, invoked.stderr);
});
test('accepted planning records and memory prefixes cannot be rewritten by concurrent writers', t => {
  const s = setup(t);
  writeFileSync(s.shard, header + record('01').replace('Retain evidence.', 'Rewrite accepted history.'));
  s.commit(s.container); assert.throws(s.check, /append-only/u);
  writeFileSync(s.shard, header + record('01') + record('02'));
  writeFileSync(join(s.sources.todo, 'todo/2026-09/accepted.md'), 'rewritten\n');
  s.commit(s.container); assert.throws(s.check, /immutable-planning-record/u);
});
test('new references must resolve locally or use credential-free web URLs', t => {
  const s = setup(t);
  writeFileSync(s.shard, header + record('01') + record('02', 'missing.md')); s.commit(s.container);
  assert.throws(s.check, /reference-missing/u);
  writeFileSync(s.shard, header + record('01') + record('02', 'https://user:secret@example.com/doc')); s.commit(s.container);
  assert.throws(s.check, /reference-url/u);
});
test('retained artifacts, symlinks and oversized additions fail closed without loading the historical corpus', t => {
  const s = setup(t), artifact = join(s.sources.artifacts, 'new.txt');
  rmSync(join(s.sources.artifacts, 'README.md')); s.commit(s.container);
  assert.throws(s.check, /retained-artifact-removed/u);
  writeFileSync(join(s.sources.artifacts, 'README.md'), 'artifacts\n');
  symlinkSync('/outside', artifact); s.commit(s.container);
  assert.throws(s.check, /regular-file/u);
  rmSync(artifact); writeFileSync(artifact, Buffer.alloc(500000)); s.commit(s.container);
  assert.throws(s.check, /changed-blob-budget/u);
});
test('check rejects branch names and divergent histories', t => {
  const s = setup(t);
  assert.throws(() => checkWorkspace({ root: s.container, base: 'main', head: s.base, config: s.config }), /exact-revisions/u);
  const other = s.run(s.container, ['commit-tree', 'HEAD^{tree}', '-m', 'unrelated']);
  assert.throws(() => checkWorkspace({ root: s.container, base: s.base, head: other, config: s.config }), /history-not-forward/u);
});
