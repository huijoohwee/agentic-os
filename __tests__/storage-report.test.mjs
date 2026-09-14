import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readdirSync,
  readFileSync, lstatSync, linkSync, symlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { reportStorage, REPORT_LIMITS } from '../bin/agentic-os-storage-report.mjs';
import { runStorage } from '../bin/agentic-os-storage.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os-storage.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'storage-report-'))), root = join(workspace, 'repo');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(root); git(root, 'init', '-q', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'gc.auto', '0'); git(root, 'commit', '--allow-empty', '-qm', 'base');
  const common = join(root, '.git'), archive = join(common, 'agentic-user-authorized-archive');
  mkdirSync(archive); writeFileSync(join(archive, 'retained'), 'recoverable content');
  return { workspace, root, common, archive,
    report: (options = {}) => reportStorage({ cwd: root, maxMs: 10_000, ...options }) };
}
test('shallow report distinguishes retained archives from objects without traversing or writing them', t => {
  const s = fixture(t), names = readdirSync(s.common), head = readFileSync(join(s.common, 'HEAD'));
  const result = s.report(), archive = result.rows.find(row => row.category === 'retained-archives');
  assert.equal(archive.status, 'unmeasured'); assert.equal(archive.entries, 1);
  assert.equal(archive.logicalBytesObserved, 0); assert.deepEqual(archive.reasons, ['not-scanned']);
  assert.ok(result.rows.some(row => row.category === 'git-objects'));
  assert.equal(result.status, 'partial'); assert.equal(result.totals.complete, false);
  assert.equal(result.contentVerified, false); assert.equal(result.grantsAuthority, false);
  assert.equal(result.reclaimableBytes, null); assert.equal(result.cost.contentBytesRead, 0);
  assert.equal(result.mode, 'shallow'); assert.equal(result.snapshotConsistent, false);
  assert.deepEqual(readdirSync(s.common), names); assert.deepEqual(readFileSync(join(s.common, 'HEAD')), head);
});
test('deep report measures sparse logical bytes separately from allocation and deduplicates hardlinks', t => {
  const s = fixture(t), file = join(s.archive, 'sparse');
  writeFileSync(file, 'x'); truncateSync(file, 16 * 1024 * 1024); linkSync(file, join(s.archive, 'same-inode'));
  const result = s.report({ deep: true }), row = result.rows.find(row => row.category === 'retained-archives');
  assert.equal(result.status, 'complete'); assert.equal(result.totals.complete, true);
  assert.equal(row.logicalBytesObserved, 32 * 1024 * 1024 + Buffer.byteLength('recoverable content'));
  assert.equal(row.sharedInodes, 1);
  const expected = [s.archive, file, join(s.archive, 'retained')]
    .reduce((sum, path) => sum + lstatSync(path).blocks * 512, 0);
  assert.equal(row.allocatedBytesObserved, expected);
  assert.equal(result.totals.allocatedBytesObserved,
    result.rows.reduce((sum, item) => sum + item.allocatedBytesObserved, 0));
});
test('cross-category hardlinks contribute physical blocks only once across the report', t => {
  const s = fixture(t), metadata = join(s.common, 'another-payload');
  linkSync(join(s.archive, 'retained'), metadata);
  const result = s.report({ deep: true }), row = result.rows.find(item => item.name === 'another-payload');
  assert.equal(row.sharedInodes, 1); assert.equal(row.allocatedBytesObserved, 0);
  assert.equal(row.logicalBytesObserved, Buffer.byteLength('recoverable content'));
});
test('category selection spends the entry budget on the requested archives first', t => {
  const s = fixture(t);
  for (let i = 0; i < 100; i++) writeFileSync(join(s.archive, `item-${i}`), 'data');
  const result = s.report({ deep: true, category: 'retained-archives', maxEntries: 25 });
  assert.equal(result.rows[0].category, 'retained-archives');
  assert.equal(result.rows[0].status, 'partial'); assert.ok(result.rows[0].reasons.includes('entry-budget'));
  assert.equal(result.cost.visitedEntries, 25); assert.equal(result.totals.complete, false);
  assert.ok(result.rows.slice(1).every(row => row.status === 'partial' && row.entries === 0));
});
test('selected-category totals do not pretend to cover unscanned directories', t => {
  const s = fixture(t), result = s.report({ deep: true, category: 'retained-archives' });
  assert.equal(result.rows[0].status, 'complete');
  assert.equal(result.rows.find(row => row.category === 'git-objects').status, 'unmeasured');
  assert.equal(result.totals.complete, false);
});
test('elapsed-time budget stops discovery and reports partial coverage', t => {
  const s = fixture(t); let ticks = 0;
  const clock = t.mock.method(performance, 'now', () => ++ticks < 3 ? 0 : 3_000);
  try {
    const result = s.report({ maxMs: 2_000 });
    assert.equal(result.status, 'partial'); assert.equal(result.discoveryComplete, false);
    assert.ok(result.reasons.includes('time-budget'));
    assert.equal(result.cost.visitedEntries, 0);
    assert.equal(result.cost.elapsedMs, 3_000);
  } finally { clock.mock.restore(); }
});
test('symlinks to external directories are counted without following their payloads', t => {
  const s = fixture(t), outside = join(s.workspace, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'large'), Buffer.alloc(4096));
  symlinkSync(outside, join(s.archive, 'alias'));
  const result = s.report({ deep: true }), row = result.rows.find(item => item.category === 'retained-archives');
  assert.equal(row.entries, 3); assert.equal(row.symlinks, 1);
  assert.equal(row.logicalBytesObserved, Buffer.byteLength(outside) + Buffer.byteLength('recoverable content'));
});
test('special files are reported as partial without opening or blocking on their content', t => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO fixture');
  const s = fixture(t); execFileSync('mkfifo', [join(s.archive, 'pipe')]);
  const result = s.report({ deep: true }), row = result.rows.find(item => item.category === 'retained-archives');
  assert.ok(row.reasons.includes('special-file')); assert.equal(row.status, 'partial');
});
test('root discovery and recursion depth return explicit incomplete coverage', t => {
  const s = fixture(t);
  for (let i = 0; i <= REPORT_LIMITS.roots; i++) writeFileSync(join(s.common, `extra-${i}`), 'x');
  const report = s.report(); assert.equal(report.discoveryComplete, false);
  assert.ok(report.reasons.includes('root-budget')); assert.equal(report.rows.length, REPORT_LIMITS.roots);
  const d = fixture(t); let path = d.archive;
  for (let i = 0; i <= REPORT_LIMITS.depth; i++) { path = join(path, 'd'); mkdirSync(path); }
  const deep = d.report({ deep: true });
  assert.ok(deep.rows.find(row => row.category === 'retained-archives').reasons.includes('depth-budget'));
});
test('linked worktrees resolve the shared common directory, not their registration directory', t => {
  const s = fixture(t), lane = join(s.workspace, 'lane'); git(s.root, 'worktree', 'add', '-qb', 'lane', lane);
  const report = reportStorage({ cwd: lane, maxMs: 10_000 });
  assert.equal(report.root, lane); assert.equal(report.common, s.common);
  assert.ok(report.rows.some(row => row.category === 'retained-archives'));
  assert.ok(report.rows.some(row => row.category === 'worktree-registrations'));
});
test('CLI emits structured diagnostics and rejects unknown, duplicate and unbounded arguments', t => {
  const s = fixture(t);
  const output = execFileSync(process.execPath, [CLI, 'report', `--repository=${s.root}`, '--deep',
    '--category=retained-archives', '--max-ms=10000'], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).schema, 'agentic-os/storage-report/v1');
  for (const flags of [['--deep=false'], ['--max-ms'], ['--max-ms=0'], ['--max-ms=60001'],
    ['--max-entries=200001'], ['--category=unknown', '--deep'], ['--category=git-objects'],
    ['--deep', '--deep'], ['--authorize=anything'], ['--store=/tmp/store']])
    assert.throws(() => runStorage(['report', `--repository=${s.root}`, ...flags]), /blocked-storage/);
  for (const maxEntries of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => s.report({ maxEntries }), /budget/);
});
