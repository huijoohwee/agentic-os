/**
 * Lane records. One JSON file in the git common directory, so every worktree of
 * the clone reads the same file and nothing lands in the repository tree.
 *
 * This is a best-effort cache of observable state, never an authority. Its
 * shared read-modify-write form can lose a concurrent cache update, so safety
 * decisions must be recomputed from exact git and provider observations.
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { commonDir } from './git.mjs';

export const SCHEMA = 'agentic-os/lanes/v1';

export function storePath(cwd = process.cwd()) {
  return join(commonDir(cwd), 'agentic-os', 'lanes.json');
}

function empty() {
  return { schema: SCHEMA, lanes: {} };
}

export function load(cwd = process.cwd()) {
  const file = storePath(cwd);
  if (!existsSync(file)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed?.schema !== SCHEMA || typeof parsed.lanes !== 'object') return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function save(store, cwd = process.cwd()) {
  const file = storePath(cwd);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

export function get(ref, cwd = process.cwd()) {
  return load(cwd).lanes[ref] ?? null;
}

export function put(record, cwd = process.cwd()) {
  const store = load(cwd);
  store.lanes[record.ref] = { ...store.lanes[record.ref], ...record };
  save(store, cwd);
  return store.lanes[record.ref];
}

export function remove(ref, cwd = process.cwd()) {
  const store = load(cwd);
  delete store.lanes[ref];
  save(store, cwd);
}

export function list(cwd = process.cwd()) {
  return Object.values(load(cwd).lanes);
}

export function newRecord({ ref, device, scope, base, baseSha, worktree }) {
  return {
    ref,
    device,
    scope,
    state: 'planned',
    base,
    baseSha,
    worktree,
    pr: null,
    createdAt: new Date().toISOString(),
  };
}
