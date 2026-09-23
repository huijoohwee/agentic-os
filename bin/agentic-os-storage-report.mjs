/** Bounded metadata-only storage diagnostics. Sizes never grant cleanup authority. */
import { execFileSync } from 'node:child_process';
import { lstatSync, opendirSync, realpathSync, statfsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

export const REPORT_LIMITS = Object.freeze({ entries: 20_000, milliseconds: 2_000,
  maxEntries: 200_000, maxMilliseconds: 60_000, roots: 256, depth: 64 });
export const REPORT_CATEGORIES = Object.freeze(['git-objects', 'git-metadata',
  'worktree-registrations', 'quarantine', 'recovery', 'retained-archives', 'agent-state', 'other']);
export const DIRECTORY_CATEGORIES = Object.freeze(['dependencies', 'cache', 'generated-output',
  'git-administration', 'worktrees', 'workspace-state', 'quarantine', 'recovery', 'other']);
const metadata = new Set(['HEAD', 'ORIG_HEAD', 'FETCH_HEAD', 'COMMIT_EDITMSG', 'AUTO_MERGE',
  'BISECT_HEAD', 'CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'REVERT_HEAD', 'config',
  'description', 'index', 'packed-refs', 'refs', 'logs', 'reftable', 'shallow', 'info', 'hooks']);
function gitCategory(name) {
  if (name === 'objects') return 'git-objects';
  if (name === 'worktrees') return 'worktree-registrations';
  if (metadata.has(name)) return 'git-metadata';
  if (name === 'agentic-os-cleanup-quarantine' || name.startsWith('agentic-os-canonical-sync-quarantine-'))
    return 'quarantine';
  if (name === 'agentic-os-storage') return 'recovery';
  if (name === 'agentic-user-authorized-archive') return 'retained-archives';
  if (name.startsWith('agentic-')) return 'agent-state';
  return 'other';
}
function directoryCategory(name) {
  if (['node_modules', '.venv'].includes(name)) return 'dependencies';
  if (['cache', '.cache', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
    '.parcel-cache', '.vite', '.turbo'].includes(name)) return 'cache';
  if (['.next', '.nuxt', '.svelte-kit', '.output', 'dist', 'build',
    'coverage', 'test-results', 'playwright-report'].includes(name)) return 'generated-output';
  if (name === '.git') return 'git-administration';
  if (name === '.worktrees' || name.endsWith('.worktrees')) return 'worktrees';
  if (name === '.workspace') return 'workspace-state';
  if (name === 'agentic-os-cleanup-quarantine' || name.startsWith('agentic-os-canonical-sync-quarantine-'))
    return 'quarantine';
  if (name === '.recovery' || name === 'agentic-os-storage' || name.startsWith('.acos-recovery-'))
    return 'recovery';
  return 'other';
}
function bound(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error('blocked-storage-report-budget');
  return value;
}
function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function locations(cwd, timeout) {
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_INDEX_FILE', 'GIT_SHALLOW_FILE'])
    if (process.env[key]) throw new Error('blocked-storage-git-environment');
  const output = execFileSync('git', ['--no-optional-locks', '--no-replace-objects', 'rev-parse',
    '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { cwd, encoding: 'utf8',
    timeout, maxBuffer: 16_384, stdio: ['ignore', 'pipe', 'pipe'] });
  const paths = output.trimEnd().split('\n');
  if (paths.length !== 2 || paths.some(path => !path || path.includes('\r')))
    throw new Error('blocked-storage-report-location');
  return { root: realpathSync(paths[0]), common: realpathSync(paths[1]) };
}

export function reportStorage({ cwd = process.cwd(), deep = false, category: selected = null,
  directory = null, name = null, maxEntries = REPORT_LIMITS.entries,
  maxMs = REPORT_LIMITS.milliseconds } = {}) {
  bound(maxEntries, REPORT_LIMITS.maxEntries); bound(maxMs, REPORT_LIMITS.maxMilliseconds);
  const categories = directory === null ? REPORT_CATEGORIES : DIRECTORY_CATEGORIES;
  if (typeof deep !== 'boolean' || selected !== null && (!deep || !categories.includes(selected)))
    throw new Error('blocked-storage-report-selection');
  if (name !== null && (directory === null || selected !== null || typeof name !== 'string'
    || !name || name === '.' || name === '..' || /[/\\\u0000-\u001f\u007f]/u.test(name)))
    throw new Error('blocked-storage-report-name');
  const started = performance.now(), observedAt = new Date().toISOString();
  let where, base;
  if (directory === null) {
    where = locations(cwd, maxMs); base = where.common;
  } else {
    if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('blocked-storage-report-directory');
    base = resolve(directory);
    const entry = lstatSync(base);
    if (!entry.isDirectory() || realpathSync(base) !== base) throw new Error('blocked-storage-report-directory');
    where = { directory: base };
    if (name !== null) {
      try { lstatSync(join(base, name)); }
      catch { throw new Error('blocked-storage-report-name'); }
    }
  }
  const classify = directory === null ? gitCategory : directoryCategory;
  const volume = statfsSync(base, { bigint: true });
  const safeBytes = value => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  const filesystem = { totalBytes: safeBytes(volume.blocks * volume.bsize),
    availableBytes: safeBytes(volume.bavail * volume.bsize), source: 'statfs', snapshotConsistent: false };
  const deadline = started + maxMs;
  let visitedEntries = 0, statCalls = 0, directoryReads = 0;
  const reasons = new Set(), seen = new Set(), rows = [];
  const expired = () => performance.now() >= deadline;
  function stat(path) { statCalls++; return lstatSync(path, { bigint: true }); }
  function stopReason() {
    if (expired()) return 'time-budget';
    if (visitedEntries >= maxEntries) return 'entry-budget';
    return null;
  }
  function add(row, value) {
    row.entries++; visitedEntries++;
    if (value.isFile() || value.isSymbolicLink()) row.logicalBytesObserved += Number(value.size);
    const key = `${value.dev}:${value.ino}`;
    if (!seen.has(key)) {
      seen.add(key); row.allocatedBytesObserved += Number(value.blocks) * 512;
    } else row.sharedInodes++;
    if (!Number.isSafeInteger(row.logicalBytesObserved) || !Number.isSafeInteger(row.allocatedBytesObserved))
      throw new Error('size-overflow');
  }
  function walk(path, row, depth) {
    const stopped = stopReason();
    if (stopped) { row.reasons.add(stopped); return; }
    let directory = null;
    try {
      const before = stat(path); add(row, before);
      if (before.isSymbolicLink()) { row.symlinks++; return; }
      if (!before.isDirectory()) {
        if (!before.isFile()) row.reasons.add('special-file');
        return;
      }
      if (!deep || selected !== null && selected !== row.category) {
        row.reasons.add('not-scanned'); return;
      }
      if (depth >= REPORT_LIMITS.depth) { row.reasons.add('depth-budget'); return; }
      if (before.dev !== baseStat.dev) { row.reasons.add('mount-boundary'); return; }
      if (realpathSync(path) !== path) { row.reasons.add('directory-alias'); return; }
      directory = opendirSync(path);
      if (identity(stat(path)) !== identity(before)) { row.reasons.add('changed'); return; }
      for (;;) {
        const stopped = stopReason();
        if (stopped) { row.reasons.add(stopped); break; }
        directoryReads++;
        const entry = directory.readSync();
        if (!entry) break;
        walk(join(path, entry.name), row, depth + 1);
      }
      if (identity(stat(path)) !== identity(before)) row.reasons.add('changed');
    } catch (error) { row.reasons.add(error.code ?? error.message); }
    finally { if (directory) directory.closeSync(); }
  }
  const baseStat = stat(base), names = name === null ? [] : [name];
  let discovered = true, rootStream = null;
  if (name === null) {
    try {
      rootStream = opendirSync(base);
      for (;;) {
        if (expired()) { reasons.add('time-budget'); discovered = false; break; }
        directoryReads++;
        const entry = rootStream.readSync();
        if (!entry) break;
        if (names.length >= Math.min(REPORT_LIMITS.roots, maxEntries)) {
          reasons.add('root-budget'); discovered = false; break;
        }
        names.push(entry.name);
      }
    } catch (error) { reasons.add(error.code ?? error.message); discovered = false; }
    finally { if (rootStream) rootStream.closeSync(); }
  }
  // Inspect the explicitly selected category first, then small Git state before retained archives.
  names.sort((a, b) => {
    const priority = name => classify(name) === selected ? -1 : categories.indexOf(classify(name));
    return priority(a) - priority(b) || a.localeCompare(b);
  });
  for (const name of names) {
    const row = { name, path: join(base, name), category: classify(name), entries: 0,
      logicalBytesObserved: 0, allocatedBytesObserved: 0, sharedInodes: 0, symlinks: 0, reasons: new Set() };
    walk(row.path, row, 0);
    row.status = row.reasons.size ? (row.reasons.size === 1 && row.reasons.has('not-scanned') ? 'unmeasured' : 'partial') : 'complete';
    row.reasons = [...row.reasons].sort(); rows.push(row);
  }
  try { if (identity(stat(base)) !== identity(baseStat)) reasons.add('changed'); }
  catch (error) { reasons.add(error.code ?? error.message); }
  const selectedChildComplete = name === null ? null
    : discovered && !reasons.size && rows.length === 1 && rows[0].status === 'complete';
  const complete = name === null && discovered && !reasons.size && rows.every(row => row.status === 'complete');
  const totals = { logicalBytesObserved: rows.reduce((n, row) => n + row.logicalBytesObserved, 0),
    allocatedBytesObserved: rows.reduce((n, row) => n + row.allocatedBytesObserved, 0) };
  const result = { schema: 'agentic-os/storage-report/v1', ...where, observedAt,
    mode: deep ? 'recursive-metadata' : 'shallow', selectedCategory: selected,
    selectedName: name, selectedChildComplete,
    status: complete ? 'complete' : 'partial', discoveryComplete: discovered, reasons: [...reasons].sort(),
    coverage: directory === null ? 'git-common-directory-children'
      : name === null ? 'selected-directory-children' : 'selected-directory-child',
    filesystem, snapshotConsistent: false, contentVerified: false,
    grantsAuthority: false, reclaimableBytes: null, totals: { ...totals, complete }, rows,
    cost: { elapsedMs: Math.ceil(performance.now() - started), visitedEntries, statCalls,
      directoryReads, statfsCalls: 1, contentBytesRead: 0, maxEntries, maxMs, maxRoots: REPORT_LIMITS.roots,
      maxDepth: REPORT_LIMITS.depth, deadlineKind: 'cooperative-between-filesystem-calls' },
    recommendations: [] };
  const archives = rows.filter(row => row.category === 'retained-archives');
  if (archives.length) result.recommendations.push({ code: 'review-retained-archives',
    reason: 'Archive sizes are separate from Git objects. Verify provenance, duplicates and restore coverage before planning retention changes.' });
  if (!complete) result.recommendations.push({ code: 'incomplete-measurement',
    reason: name === null
      ? 'Observed bytes are not full directory sizes. Select one category or exact child for a bounded deep report.'
      : 'Only the exact child was selected. Its row status describes that child; siblings remain outside coverage.' });
  if (directory !== null && rows.some(row => ['dependencies', 'generated-output'].includes(row.category)))
    result.recommendations.push({ code: 'verify-generator-before-removal',
      reason: 'Directory names suggest rebuildable data only. Verify the generator, lockfile or output contract, active readers and exact target before any removal.' });
  if (directory !== null && rows.some(row => row.category === 'cache'))
    result.recommendations.push({ code: 'verify-cache-before-effect',
      reason: 'A cache name does not prove rebuildability. Verify its owner, active readers, offline restore path and rebuild cost before an exact archive or compression plan.' });
  result.recommendations.push({ code: 'separate-cleanup-admission',
    reason: directory === null
      ? 'Total Git-directory size does not establish the cleanup shared-state budget. Use the cleanup owner for exact admission.'
      : 'Observed directory size and ignore status grant no removal authority. Use the exact source owner and effect receipt.' });
  return result;
}
