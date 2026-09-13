#!/usr/bin/env node
/** On-demand allocation check over an explicit task-registry snapshot; no writes or authority. */
import { resolve, relative, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { parseWritePaths, pathsOverlap } from '../src/worktree.mjs';
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';

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
    if (argv[0] === '--discover') return runCapabilityCli(argv.slice(1), io);
    if (argv.some(arg => arg.startsWith('--ownership='))) return runOwnershipCli(argv, io);
    if (argv.length !== 1 || !argv[0].startsWith('--input=') || argv[0] === '--input=')
      fail('usage: npm run fleet:check -- --input=/absolute/path/to/registry-snapshot.json');
    const bytes = readBoundedFile(resolve(argv[0].slice(8)), FLEET_LIMITS.bytes, 'fleet snapshot');
    const report = evaluateFleetAllocation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    io.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  } catch (error) { io.error(`fleet allocation: ${error.message}`); return 1; }
}

export const OWNERSHIP_LIMITS = Object.freeze({ repositories: 8, artifacts: 2048,
  fileBytes: 500_000, totalBytes: 32_000_000, milliseconds: 10_000, findings: 128 });
const POLICY_PATH = fileURLToPath(new URL('../catalog/fleet-ownership.json', import.meta.url));
const CAPABILITY_KINDS = ['catalog', 'prompt', 'agent', 'skill', 'command', 'contract', 'runtime', 'guide', 'projection', 'reference'];
const CAPABILITY_TRANSPORTS = ['source', 'cli', 'module', 'http', 'mcp', 'native-chat'];
const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const readJson = file => JSON.parse(decode(readBoundedFile(file, FLEET_LIMITS.bytes, 'fleet input')));

export function validateOwnershipPolicy(value) {
  const policy = JSON.parse(canonicalJson(value));
  exact(policy, ['schema', 'repositories', 'responsibilities', 'historical'], 'ownership policy');
  if (policy.schema !== 'agentic-os/fleet-ownership-policy/v1') fail('invalid ownership policy schema');
  list(policy.repositories, OWNERSHIP_LIMITS.repositories, 'repositories', true);
  for (const entry of policy.repositories) {
    exact(entry, ['id', 'directory', 'role', 'planningRoots'], 'repository owner');
    repository(entry.id, 'repository.id'); relativePath(entry.directory, 'directory');
    if (!['source', 'projection', 'reference'].includes(entry.role)) fail('invalid repository role');
    list(entry.planningRoots, 16, 'planningRoots').forEach(p => relativePath(p, 'planning root'));
  }
  unique(policy.repositories.map(r => r.id), 'repository identities');
  unique(policy.repositories.map(r => portable(r.directory)), 'repository directories');
  const repos = new Set(policy.repositories.map(r => r.id));
  list(policy.responsibilities, 64, 'responsibilities', true);
  for (const item of policy.responsibilities) {
    exact(item, ['id', 'owner', 'source', 'consumers', ...('discovery' in item ? ['discovery'] : [])], 'responsibility');
    id(item.id, 'responsibility.id'); relativePath(item.source, 'responsibility.source');
    if (!repos.has(item.owner)) fail('unknown responsibility owner');
    list(item.consumers, OWNERSHIP_LIMITS.repositories, 'consumers'); unique(item.consumers, 'consumers');
    if (item.consumers.some(r => !repos.has(r) || r === item.owner)) fail('unknown or recursive consumer');
    if ('discovery' in item) {
      exact(item.discovery, ['kinds', 'summary', 'transport'], 'capability discovery');
      list(item.discovery.kinds, CAPABILITY_KINDS.length, 'capability kinds', true);
      unique(item.discovery.kinds, 'capability kinds');
      if (item.discovery.kinds.some(k => !CAPABILITY_KINDS.includes(k))) fail('unknown capability kind');
      text(item.discovery.summary, 'capability summary');
      if (!CAPABILITY_TRANSPORTS.includes(item.discovery.transport)) fail('unknown capability transport');
      if (policy.repositories.find(r => r.id === item.owner).role !== 'source'
        && item.discovery.transport !== 'source') fail('projections and references cannot own execution');
    }
  }
  unique(policy.responsibilities.map(r => r.id), 'responsibility ownership');
  list(policy.historical, 32, 'historical');
  for (const item of policy.historical) {
    exact(item, ['repository', 'path', 'sha256'], 'historical artifact');
    if (!repos.has(item.repository) || !/^[a-f0-9]{64}$/u.test(item.sha256)) fail('invalid historical identity');
    relativePath(item.path, 'historical path');
  }
  return policy;
}

/** Discover references only; importing this module never loads capability bodies or runs owners. */
export function discoverCapabilities(policyValue, { query = '', kind = '', limit = 10 } = {}) {
  const policy = validateOwnershipPolicy(policyValue);
  if (typeof query !== 'string' || query.length > 256 || /[\u0000-\u001f\u007f]/u.test(query)
    || kind && !CAPABILITY_KINDS.includes(kind)
    || !Number.isInteger(limit) || limit < 1 || limit > 20) fail('invalid discovery query, kind or limit');
  const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const matches = policy.responsibilities.filter(r => r.discovery && (!kind || r.discovery.kinds.includes(kind))
    && terms.every(term => `${r.id} ${r.owner} ${r.source} ${r.discovery.summary}`.toLowerCase().includes(term)))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 'agentic-os/capability-discovery/v1', ok: true, authority: false, executable: false,
    policyDigest: governanceDigest(policy), total: matches.length, truncated: matches.length > limit,
    entries: matches.slice(0, limit).map(r => ({ id: r.id, owner: r.owner, path: r.source,
      ...r.discovery, sourceRole: policy.repositories.find(repo => repo.id === r.owner).role })) };
}

/** Read one caller-pinned Git blob. No fetch, working-tree read, provider call or execution. */
export function resolveCapability(policyValue, { capabilityId, root, revision, includeContent = false }) {
  const policy = validateOwnershipPolicy(policyValue), started = Date.now();
  const role = policy.responsibilities.find(r => r.id === capabilityId && r.discovery);
  if (!role || typeof root !== 'string' || !isAbsolute(root) || !SHA.test(revision ?? '')
    || typeof includeContent !== 'boolean') fail('resolution requires a known id, absolute root and immutable revision');
  const actualRoot = realpathSync(root);
  const git = args => {
    const remaining = OWNERSHIP_LIMITS.milliseconds - (Date.now() - started);
    if (remaining <= 0) fail('capability resolution time budget exceeded');
    return execFileSync('git', ['--no-optional-locks', ...args], { cwd: actualRoot,
      timeout: Math.min(2000, remaining), maxBuffer: OWNERSHIP_LIMITS.fileBytes });
  };
  if (realpathSync(decode(git(['rev-parse', '--show-toplevel'])).trim()) !== actualRoot
    || remoteRepositoryIdentity(decode(git(['config', '--get', 'remote.origin.url'])).trim())?.repository.toLowerCase() !== role.owner)
    fail('capability repository identity mismatch');
  if (decode(git(['rev-parse', '--verify', `${revision}^{commit}`])).trim() !== revision)
    fail('capability revision must name an exact commit');
  const entry = decode(git(['ls-tree', '--format=%(objectmode) %(objecttype) %(objectname)', revision, '--', role.source])).trim();
  const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})$/u);
  if (!match) fail('capability source must be one regular Git blob');
  const size = Number(decode(git(['cat-file', '-s', match[2]])).trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > OWNERSHIP_LIMITS.fileBytes) fail('capability source exceeds byte budget');
  const bytes = git(['cat-file', 'blob', match[2]]);
  if (bytes.length !== size) fail('capability source size mismatch');
  const source = { repository: role.owner, revision, path: role.source, blob: match[2],
    sha256: digestBytes(bytes), bytes: size,
    url: role.owner.startsWith('github.com/')
      ? `https://${role.owner}/blob/${revision}/${role.source.split('/').map(encodeURIComponent).join('/')}` : null };
  return { schema: 'agentic-os/capability-resource/v1', ok: true, authority: false, executable: false,
    policyDigest: governanceDigest(policy), id: role.id, ...role.discovery, source,
    ...(includeContent ? { content: decode(bytes) } : {}) };
}

export function runCapabilityCli(argv, io = console) {
  try {
    const options = new Map();
    for (const arg of argv) {
      const match = arg.match(/^--(query|kind|limit|id|root|revision)=(.*)$/u);
      const key = match?.[1] ?? (arg === '--include-content' ? 'includeContent' : '');
      if (!key || options.has(key) || match && !match[2]) fail('unknown, empty or duplicate capability option');
      options.set(key, match ? match[2] : true);
    }
    const policy = readJson(POLICY_PATH);
    let report;
    if (options.has('id')) {
      if (['query', 'kind', 'limit'].some(k => options.has(k))) fail('query options cannot accompany resolution');
      report = resolveCapability(policy, { capabilityId: options.get('id'), root: options.get('root'),
        revision: options.get('revision'), includeContent: options.get('includeContent') ?? false });
    } else {
      if (['root', 'revision', 'includeContent'].some(k => options.has(k))) fail('source loading requires an explicit capability id');
      report = discoverCapabilities(policy, { query: options.get('query') ?? '', kind: options.get('kind') ?? '',
        limit: options.has('limit') ? Number(options.get('limit')) : 10 });
    }
    io.log(JSON.stringify(report, null, 2)); return 0;
  } catch (error) { io.error(`capability discovery: ${error.message}`); return 1; }
}

/** One finite observation, never an authority grant or proof of arbitrary semantic equivalence. */
export function evaluateFleetOwnership(policyValue, observations, previous = null) {
  const base = { schema: 'agentic-os/fleet-ownership-report/v1', authority: false, liveClaimsVerified: false };
  const findings = [], add = (code, detail) => {
    if (findings.length >= OWNERSHIP_LIMITS.findings) fail('ownership finding budget exceeded');
    findings.push({ code, ...detail });
  };
  try {
    const policy = validateOwnershipPolicy(policyValue);
    const input = JSON.parse(canonicalJson(observations));
    list(input, OWNERSHIP_LIMITS.repositories, 'observations', true);
    unique(input.map(r => r.id), 'observed repositories');
    if (input.length !== policy.repositories.length) fail('incomplete repository observation');
    const declarations = new Map(policy.repositories.map(r => [r.id, r]));
    const cids = new Map(), copies = new Map(); let count = 0;
    for (const repo of input) {
      exact(repo, ['id', 'revision', 'artifacts'], 'repository observation');
      if (!declarations.has(repo.id) || !/^[a-f0-9]{40}$/u.test(repo.revision)) fail('unknown repository or mutable revision');
      list(repo.artifacts, OWNERSHIP_LIMITS.artifacts, 'artifacts');
      unique(repo.artifacts.map(a => a.path), 'artifact paths');
      for (const artifact of repo.artifacts) {
        exact(artifact, ['path', 'sha256', 'continuityId', 'planningRevision', 'bodyDigest'], 'artifact');
        relativePath(artifact.path, 'artifact.path');
        if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) fail('invalid artifact digest');
        if (++count > OWNERSHIP_LIMITS.artifacts) fail('total artifact budget exceeded');
        const historical = policy.historical.find(h => h.repository === repo.id && h.path === artifact.path);
        if (historical) {
          if (historical.sha256 !== artifact.sha256) add('immutable-authority-drift', { repository: repo.id, path: artifact.path });
          continue;
        }
        if (declarations.get(repo.id).role !== 'source' || artifact.continuityId === null) continue;
        id(artifact.continuityId, 'continuityId'); text(artifact.planningRevision, 'planningRevision');
        if (!/^[a-f0-9]{64}$/u.test(artifact.bodyDigest)) fail('invalid planning body digest');
        const key = portable(artifact.continuityId), owner = cids.get(key);
        if (owner && (owner.repository !== repo.id || owner.revision !== artifact.planningRevision))
          add('conflicting-planning-authority', { continuityId: artifact.continuityId,
            owners: [owner, { repository: repo.id, path: artifact.path, revision: artifact.planningRevision }] });
        else cids.set(key, { repository: repo.id, path: artifact.path, revision: artifact.planningRevision });
        const copy = copies.get(artifact.bodyDigest);
        if (copy && copy.repository !== repo.id) add('duplicate-planning-body', { owners: [copy, { repository: repo.id, path: artifact.path }] });
        else copies.set(artifact.bodyDigest, { repository: repo.id, path: artifact.path });
      }
    }
    for (const role of policy.responsibilities) {
      const owner = input.find(r => r.id === role.owner);
      if (!owner.artifacts.some(a => a.path === role.source)) add('missing-responsibility-source', { responsibility: role.id, owner: role.owner, path: role.source });
      for (const other of input) {
        if (other.id !== role.owner && declarations.get(other.id).role === 'source'
          && other.artifacts.some(a => a.path === role.source))
          add('competing-responsibility-source', { responsibility: role.id, owner: role.owner, competitor: other.id, path: role.source });
      }
    }
    const inputDigest = governanceDigest({ policy, observations: input });
    const unchanged = previous?.schema === base.schema && previous.inputDigest === inputDigest;
    return { ...base, ok: !findings.length, inputDigest, repositories: input.length, artifacts: count,
      responsibilities: policy.responsibilities.length, planningFamilies: cids.size, findings,
      nextAction: findings.length ? (unchanged ? 'stop-unchanged-input' : 'fix-owning-source')
        : (unchanged ? 'reuse-passed-evidence' : 'continue-authorized-work') };
  } catch (error) {
    return { ...base, ok: false, findings: [{ code: 'invalid-ownership-input', message: error.message }], nextAction: 'fix-owning-source' };
  }
}


export function readOwnershipField(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/u);
  const pattern = new RegExp(`^(?:${key}|"${key}"|'${key}'):\\s*(.*?)\\s*$`);
  const matches = lines.map(line => line.match(pattern)).filter(Boolean);
  if (matches.length > 1) fail(`duplicate ${key} field`);
  if (!matches.length) return null;
  const raw = matches[0][1];
  const quoted = raw.match(/^("(?:\\.|[^"\\])*")\s*(?:#.*)?$/u);
  if (quoted) return JSON.parse(quoted[1]);
  const single = raw.match(/^'((?:''|[^'])*)'\s*(?:#.*)?$/u);
  if (single) return single[1].replace(/''/gu, "'");
  const plain = raw.replace(/\s+#.*$/u, '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/u.test(plain)) fail(`unsupported ${key} scalar`);
  return plain;
}

export function collectFleetOwnership(policyValue, roots) {
  const policy = validateOwnershipPolicy(policyValue), started = Date.now(); let bytesRead = 0, count = 0;
  roots = JSON.parse(canonicalJson(roots));
  exact(roots, policy.repositories.map(r => r.id), 'explicit repository roots');
  const bound = () => { if (Date.now() - started >= OWNERSHIP_LIMITS.milliseconds) fail('ownership time budget exceeded'); };
  const run = (root, args) => { bound(); return execFileSync('git', args, { cwd: root, encoding: 'utf8',
    timeout: Math.max(1, Math.min(2000, OWNERSHIP_LIMITS.milliseconds - (Date.now() - started))), maxBuffer: 500_000 }); };
  const observedRoots = new Set();
  return policy.repositories.map(repo => {
    if (!isAbsolute(roots[repo.id])) fail('repository roots must be absolute');
    const root = realpathSync(roots[repo.id]);
    if (observedRoots.has(root) || realpathSync(run(root, ['rev-parse', '--show-toplevel']).trim()) !== root) fail('duplicate or non-root repository');
    observedRoots.add(root);
    const remote = run(root, ['config', '--get', 'remote.origin.url']).trim();
    const identity = remoteRepositoryIdentity(remote)?.repository.toLowerCase();
    if (identity !== repo.id) fail(`repository identity mismatch for ${repo.directory}`);
    const revision = run(root, ['rev-parse', 'HEAD']).trim();
    const sources = policy.responsibilities.map(r => r.source);
    const paths = [...new Set(run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...repo.planningRoots, ...sources]).split('\0').filter(Boolean))].sort();
    const artifacts = [];
    for (const path of paths) {
      if (!path.endsWith('.md') && !sources.includes(path)) continue;
      bound(); if (++count > OWNERSHIP_LIMITS.artifacts) fail('total artifact budget exceeded');
      relativePath(path, 'observed path'); const file = resolve(root, path), real = realpathSync(file);
      if (relative(root, real).startsWith('..') || real !== file) fail('symlinked artifact is not an ownership source');
      const bytes = readBoundedFile(file, OWNERSHIP_LIMITS.fileBytes, 'ownership artifact');
      bytesRead += bytes.length; if (bytesRead > OWNERSHIP_LIMITS.totalBytes) fail('ownership byte budget exceeded');
      const source = decode(bytes), fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
      const field = key => readOwnershipField(fm?.[1] ?? '', key);
      const planning = field('doc_type') === 'PRD-TAD-ADR-MVP-GTM';
      const continuityId = planning ? field('continuity_id') : null;
      if (planning && !continuityId && !policy.historical.some(h => h.repository === repo.id && h.path === path)) fail(`current planning source lacks continuity_id: ${repo.directory}/${path}`);
      const revisions = ['prd', 'tad', 'adr', 'mvp', 'gtm'].map(r => field(`${r}_revision`));
      if (continuityId && (revisions.some(r => !r) || new Set(revisions).size !== 1)) fail(`five-role revision conflict: ${repo.directory}/${path}`);
      artifacts.push({ path, sha256: digestBytes(bytes), continuityId,
        planningRevision: continuityId ? revisions[0] : null,
        bodyDigest: continuityId ? digestBytes(source.slice(fm[0].length).replace(/\r\n/gu, '\n').trim()) : null });
    }
    if (run(root, ['rev-parse', 'HEAD']).trim() !== revision) fail('repository revision changed during observation');
    return { id: repo.id, revision, artifacts };
  });
}

function runOwnershipCli(argv, io) {
  const options = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--(ownership|previous)=(.+)$/u);
    if (!match || options.has(match[1])) fail('use --ownership=<explicit-roots.json> [--previous=<report.json>]');
    options.set(match[1], match[2]);
  }
  const policy = readJson(POLICY_PATH), roots = readJson(resolve(options.get('ownership')));
  const observations = collectFleetOwnership(policy, roots);
  const report = evaluateFleetOwnership(policy, observations, options.has('previous') ? readJson(resolve(options.get('previous'))) : null);
  io.log(JSON.stringify(report, null, 2)); return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runFleetCli(process.argv.slice(2));
}
