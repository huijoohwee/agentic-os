#!/usr/bin/env node
/** On-demand allocation check over an explicit task-registry snapshot; no writes or authority. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { parseWritePaths, pathsOverlap } from '../src/worktree.mjs';

export const FLEET_SCHEMA = 'agentic-os/fleet-allocation/v1';
export const FLEET_LIMITS = Object.freeze({ bytes: 500_000, tasks: 128, requirements: 256, paths: 2048 });
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const fail = message => { throw new TypeError(message); };
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    fail(`${label} requires exactly ${keys.join(', ')}`);
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value
    || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text`);
  return value;
};
const id = (value, label) => { if (!ID.test(text(value, label))) fail(`${label} is invalid`); return value; };
const list = (value, max, label, nonempty = false) => {
  if (!Array.isArray(value) || value.length > max || nonempty && !value.length)
    fail(`${label} must be ${nonempty ? 'a nonempty' : 'an'} array of at most ${max} entries`);
  return value;
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
};
const relativePath = (value, label) => {
  text(value, label);
  const parsed = parseWritePaths(value);
  if (parsed.length !== 1 || parsed[0] !== value) fail(`${label} requires one exact relative path`);
  return value;
};
const repository = (value, label) => {
  // Profile identities, never local clone paths or transport URLs. Require a canonical spelling.
  text(value, label);
  if (!/^[a-z0-9][a-z0-9.-]*\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/u.test(value)
    || value.endsWith('.git') || value.split('/').some(part => part === '.' || part === '..'))
    fail(`${label} requires a lowercase host-qualified repository profile identity`);
  return value;
};
const portable = value => value.normalize('NFC').toLowerCase();

function validate(value) {
  const input = JSON.parse(canonicalJson(value)); // Reject accessors, cycles and oversized/non-JSON input.
  exact(input, ['schema', 'source', 'requirements', 'tasks'], 'allocation');
  if (input.schema !== FLEET_SCHEMA) fail(`allocation.schema must be ${FLEET_SCHEMA}`);
  exact(input.source, ['repository', 'revision', 'path'], 'source');
  repository(input.source.repository, 'source.repository');
  if (!SHA.test(input.source.revision ?? '')) fail('source.revision requires an exact Git object id');
  relativePath(input.source.path, 'source.path');
  list(input.requirements, FLEET_LIMITS.requirements, 'requirements', true).forEach(requirement => {
    exact(requirement, ['id', 'acceptance'], 'requirement');
    id(requirement.id, 'requirement.id'); text(requirement.acceptance, 'requirement.acceptance');
  });
  unique(input.requirements.map(item => item.id), 'requirements');
  let pathCount = 0;
  list(input.tasks, FLEET_LIMITS.tasks, 'tasks', true).forEach(task => {
    exact(task, ['id', 'owner', 'scope', 'contextRef', 'requirements', 'writes', 'dependsOn'], 'task');
    id(task.id, 'task.id'); exact(task.owner, ['subject', 'device'], 'task.owner');
    text(task.owner.subject, 'owner.subject'); text(task.owner.device, 'owner.device');
    if (!/^#[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(task.scope ?? '')) fail('task.scope is invalid');
    text(task.contextRef, 'task.contextRef');
    for (const key of ['requirements', 'dependsOn']) {
      list(task[key], FLEET_LIMITS.requirements, `task.${key}`, key === 'requirements')
        .forEach(value => id(value, `task.${key}`));
      unique(task[key], `task.${key}`);
    }
    list(task.writes, 32, 'task.writes').forEach(write => {
      exact(write, ['repository', 'paths'], 'write'); repository(write.repository, 'write.repository');
      list(write.paths, FLEET_LIMITS.paths, 'write.paths', true)
        .forEach(value => relativePath(value, 'write.path'));
      unique(write.paths.map(portable), 'write.paths');
      pathCount += write.paths.length;
      if (pathCount > FLEET_LIMITS.paths) fail('allocation exceeds total write-path budget');
    });
    unique(task.writes.map(write => write.repository), 'task write repositories');
  });
  unique(input.tasks.map(task => task.id), 'task ids');
  return input;
}

/** Validate division of declared work. A passing snapshot never authenticates a live claim. */
export function evaluateFleetAllocation(value) {
  const base = { schema: 'agentic-os/fleet-allocation-report/v1', authority: false, liveClaimsVerified: false };
  let input;
  try { input = validate(value); }
  catch (error) { return { ...base, ok: false, findings: [{ code: 'invalid-input', message: error.message }], waves: [], handoffs: [] }; }
  const tasks = [...input.tasks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const requirements = new Map(input.requirements.map(item => [item.id, []]));
  const findings = [], handoffs = [], levels = new Map(), ancestors = new Map();
  const add = (code, detail) => findings.push({ code, ...detail });
  for (const task of tasks) {
    for (const requirement of task.requirements) {
      if (!requirements.has(requirement)) add('unknown-requirement', { task: task.id, requirement });
      else requirements.get(requirement).push(task.id);
    }
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency) || dependency === task.id) add('invalid-dependency', { task: task.id, dependency });
    }
  }
  for (const [requirement, owners] of [...requirements].sort()) {
    if (owners.length !== 1) add(owners.length ? 'duplicate-requirement-owner' : 'uncovered-requirement', { requirement, tasks: owners });
  }
  let pending = [...tasks];
  while (pending.length) {
    const ready = pending.filter(task => task.dependsOn.every(dependency => levels.has(dependency)));
    if (!ready.length) { add('unresolved-dependencies', { tasks: pending.map(task => task.id) }); break; }
    for (const task of ready) {
      levels.set(task.id, Math.max(-1, ...task.dependsOn.map(dependency => levels.get(dependency))) + 1);
      ancestors.set(task.id, new Set(task.dependsOn.flatMap(dependency => [dependency, ...ancestors.get(dependency)])));
    }
    pending = pending.filter(task => !levels.has(task.id));
  }
  for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) {
    const left = tasks[i], right = tasks[j];
    const ordered = ancestors.get(right.id)?.has(left.id) ? [left.id, right.id]
      : ancestors.get(left.id)?.has(right.id) ? [right.id, left.id] : null;
    const overlaps = [];
    for (const a of left.writes) for (const b of right.writes) {
      if (a.repository !== b.repository) continue;
      const x = a.paths.find(x => b.paths.some(y => pathsOverlap(portable(x), portable(y))));
      if (x) overlaps.push({ repository: a.repository,
        paths: [x, b.paths.find(y => pathsOverlap(portable(x), portable(y)))] });
    }
    if (left.scope === right.scope || overlaps.length) {
      const detail = { tasks: [left.id, right.id], sharedScope: left.scope === right.scope, overlaps };
      if (ordered) handoffs.push({ ...detail, order: ordered, requires: 'verified-stop-and-authority-transfer' });
      else add('concurrent-ownership-overlap', detail);
    }
  }
  const waves = [];
  if (!findings.length) for (const task of tasks) (waves[levels.get(task.id)] ??= []).push(task.id);
  const report = { ...base, ok: findings.length === 0, source: input.source, inputDigest: governanceDigest(input),
    findings, waves, handoffs };
  try { canonicalJson(report); return report; }
  catch { return { ...base, ok: false, inputDigest: report.inputDigest,
    findings: [{ code: 'report-budget-exceeded', message: 'Partition the allocation into smaller dependent scopes' }],
    waves: [], handoffs: [] }; }
}

export function runFleetCli(argv, io = console) {
  try {
    if (argv.length !== 1 || !argv[0].startsWith('--input=') || argv[0] === '--input=')
      fail('usage: npm run fleet:check -- --input=/absolute/path/to/registry-snapshot.json');
    const bytes = readBoundedFile(resolve(argv[0].slice(8)), FLEET_LIMITS.bytes, 'fleet snapshot');
    const report = evaluateFleetAllocation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    io.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  } catch (error) { io.error(`fleet allocation: ${error.message}`); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runFleetCli(process.argv.slice(2));
}
