/** Read owner-declared checks and optional unsigned results; never execute candidate code. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile, snapshotBoundedJson } from '../src/catalog-input.mjs';
import { validateRepositoryProfile } from '../src/governance.mjs';
const gitReader = await import('./composition-git.mjs').catch(() => null);
const worktreeReader = gitReader && await import('./composition-runtime-check.mjs');

export const CHECK_INPUT_SCHEMA = 'agentic-os/check-discovery-input/v1';
export const CHECK_RESULT_SCHEMA = 'agentic-os/check-result-observation/v1';
export const CHECK_REPORT_SCHEMA = 'agentic-os/check-discovery-report/v1';
const CATALOG_SCHEMA = 'agentic-os/repository-check-catalog/v1';
const CATALOG = fileURLToPath(new URL('../test/repositories.json', import.meta.url));
const MAX_REPOSITORIES = 32;
const INPUT_BYTES = 65_536, SOURCE_BYTES = 131_072, OUTPUT_BYTES = 499_999;
const SHA = /^[0-9a-f]{64}$/u, REVISION = /^[0-9a-f]{40}$/u;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new TypeError(code), { code }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys, required = keys) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) fail('invalid_record_fields');
}
function text(value, maximum = 1024) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) fail('invalid_text');
  return value;
}
function relativeFile(value) {
  text(value);
  if (path.posix.normalize(value) !== value || value.startsWith('../') || value === '..'
    || path.posix.isAbsolute(value) || value.includes('\\') || value.includes(':')) fail('invalid_source_path');
  return value;
}
function array(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail('invalid_array_bound');
  return value;
}
function json(bytes, maxObjectKeys = 256) {
  return snapshotBoundedJson(JSON.parse(utf8.decode(bytes)), {
    maxDepth: 10, maxNodes: 20_000, maxStringBytes: 16_384,
    maxAggregateStringBytes: SOURCE_BYTES, maxArrayLength: 256, maxObjectKeys,
  });
}
function readInput(target) {
  const supplied = path.resolve(target);
  if (lstatSync(supplied).isSymbolicLink()) fail('input_symlink');
  const absolute = realpathSync(supplied);
  const bytes = readBoundedFile(absolute, INPUT_BYTES, 'check discovery input', { expectedPath: absolute });
  return { path: absolute, sha256: sha(bytes), value: json(bytes) };
}
function currentInput(record) {
  return sha(readBoundedFile(record.path, INPUT_BYTES, 'check discovery input', { expectedPath: record.path })) === record.sha256;
}
function catalogEntries(value) {
  exact(value, ['schema', 'repositories']);
  if (value.schema !== CATALOG_SCHEMA) fail('catalog_schema_invalid');
  const ids = new Set(), identities = new Set();
  const rows = array(value.repositories, MAX_REPOSITORIES);
  if (rows.length === 0) fail('catalog_requires_repository');
  for (const row of rows) {
    exact(row, ['id', 'repository', 'packages', 'workflows']);
    text(row.id, 128); text(row.repository, 256);
    if (ids.has(row.id) || identities.has(row.repository)) fail('duplicate_catalog_repository');
    ids.add(row.id); identities.add(row.repository);
    const refs = new Set();
    for (const pkg of array(row.packages, 4)) {
      exact(pkg, ['path', 'scripts']); relativeFile(pkg.path);
      if (refs.has(pkg.path) || !pkg.path.endsWith('package.json')) fail('duplicate_or_invalid_package');
      refs.add(pkg.path);
      const names = array(pkg.scripts, 16);
      if (new Set(names).size !== names.length) fail('duplicate_script');
      names.forEach(name => text(name, 128));
    }
    for (const workflow of array(row.workflows, 8)) {
      relativeFile(workflow);
      if (!workflow.startsWith('.github/workflows/') || refs.has(workflow)) fail('invalid_workflow_ref');
      refs.add(workflow);
    }
  }
  return rows;
}
function gitState(root, entry, evaluate) {
  if (!gitReader) fail('trusted_git_unavailable');
  if (!evaluate) {
    const revision = gitReader.compositionRevision(root);
    if (!revision) fail('revision_unavailable');
    return { revision, clean: null, digest: null, code: 'not-evaluated' };
  }
  const state = worktreeReader.inspectGitWorktree(root, entry.id, entry.repository.replace(/^github\.com\//u, ''));
  if (!state.revision) fail(state.code ?? 'revision_unavailable');
  return { revision: state.revision, clean: state.clean, digest: state.worktreeStateDigest, code: state.code };
}
function argvFor(packagePath, script) {
  const directory = path.posix.dirname(packagePath);
  return ['npm', ...(directory === '.' ? [] : ['--prefix', directory]), 'run', script];
}
/** Advisory coverage of exact npm chains; opaque commands remain independently requested. */
function validationPlan(commands, packages) {
  const key = (pkg, script) => JSON.stringify([pkg, script]);
  const reference = command => ({ package: command.package, script: command.script });
  const invocation = /^npm (?:--prefix(?:=| )(?<prefix>[A-Za-z0-9/._-]+) )?(?:run (?<script>[A-Za-z0-9][A-Za-z0-9:._-]{0,127})|(?<test>test))(?: --workspace=(?<workspace>[@A-Za-z0-9/._-]+))?$/u;
  let remaining = 4096;
  const closure = (packagePath, script, active = new Set()) => {
    const identity = key(packagePath, script), pkg = packages.get(packagePath);
    if (--remaining < 0 || active.size >= 32 || active.has(identity) || !pkg
      || typeof pkg.manifest.scripts[script] !== 'string') return null;
    // Keep npm lifecycle hooks in the intact invocation; never infer coverage from hook bodies.
    const covered = new Set([identity]);
    const parts = pkg.manifest.scripts[script].trim().split(/\s*&&\s*/u);
    if (parts.length > 64) return null;
    const calls = parts.map(part => invocation.exec(part));
    // Never infer unconditional execution from shell syntax, flags or filtered invocations.
    if (calls.some(call => !call)) return covered;
    const next = new Set([...active, identity]);
    for (const call of calls) {
      let target = packagePath;
      const { prefix, workspace, script: nestedScript, test } = call.groups;
      if (prefix) {
        // Resolve only normalized relative prefixes to already cataloged manifests; never scan.
        if (workspace || path.posix.isAbsolute(prefix) || path.posix.normalize(prefix) !== prefix) return covered;
        target = path.posix.join(path.posix.dirname(packagePath), prefix, 'package.json');
        if (!packages.has(target)) return covered;
      }
      if (workspace) {
        // Resolve only explicit root workspace entries among already bounded owner manifests.
        if (packagePath !== 'package.json' || !Array.isArray(pkg.manifest.workspaces)) return null;
        const matches = [...packages.entries()].filter(([name, value]) => name !== 'package.json'
          && pkg.manifest.workspaces.includes(path.posix.dirname(name))
          && (value.manifest.name === workspace || path.posix.dirname(name) === workspace));
        if (matches.length !== 1) return null;
        target = matches[0][0];
      }
      const nested = closure(target, nestedScript ?? test, next);
      if (!nested) return null;
      for (const child of nested) covered.add(child);
      if (covered.size > 128) return null;
    }
    return covered;
  };
  const requested = new Map(commands.map((command, index) => [key(command.package, command.script), index]));
  const candidates = commands.map((command, index) => ({ index,
    covers: [...(closure(command.package, command.script) ?? new Set([key(command.package, command.script)]))]
      .filter(identity => requested.has(identity)).map(identity => requested.get(identity)),
  })).sort((a, b) => b.covers.length - a.covers.length || a.index - b.index);
  const covered = new Set(), selected = [];
  for (const candidate of candidates) {
    if (covered.has(candidate.index)) continue;
    selected.push(candidate);
    candidate.covers.forEach(index => covered.add(index));
  }
  return {
    status: 'advisory', requestedCommands: commands.length, plannedCommands: selected.length,
    duplicateCommandsAvoided: commands.length - selected.length,
    sourceBindings: [...packages].map(([name, value]) => ({ package: name, sha256: value.sha256 })),
    execute: selected.sort((a, b) => a.index - b.index).map(candidate => ({
      ...reference(commands[candidate.index]), argv: commands[candidate.index].argv,
      coversOnSuccess: candidate.covers.sort((a, b) => a - b).map(index => reference(commands[index])),
    })),
    conditions: 'Use unchanged source and execution context, exact argv and successful complete runs. '
      + 'Failed, interrupted or filtered runs grant no inferred coverage. This plan executes nothing and caches no results.',
  };
}
function inspectOwner(entry, rootPath, roots, evaluate) {
  const row = { id: entry.id, repository: entry.repository, root: rootPath ?? null,
    sourceStatus: 'unavailable', revision: null, clean: false, requiredChecks: [], commands: [], workflows: [],
    findings: [], results: [], validationPlan: null };
  if (!rootPath) { row.findings.push('root_not_supplied'); return { row }; }
  try {
    const root = realpathSync(rootPath);
    if (roots.has(root)) fail('duplicate_repository_root');
    roots.add(root); row.root = root;
    const before = gitState(root, entry, evaluate); row.revision = before.revision; row.clean = before.clean;
    const reads = [];
    const read = relative => {
      const source = gitReader.readCompositionHeadFile(root, before.revision, relative, SOURCE_BYTES, 'owner check source');
      const record = { path: relative, blob: source.oid, sha256: sha(source.bytes) };
      reads.push(record);
      return { ...record, bytes: source.bytes };
    };
    const profileSource = read('.agentic-os.json');
    const profile = validateRepositoryProfile(json(profileSource.bytes));
    if (profile.repository !== entry.repository) fail('repository_identity_mismatch');
    row.profile = { path: profileSource.path, sha256: profileSource.sha256, digest: profile.profileDigest };
    row.requiredChecks = profile.requiredChecks;
    const packages = new Map();
    for (const pkg of entry.packages) {
      const source = read(pkg.path), manifest = json(source.bytes, 512);
      if (!plain(manifest.scripts)) fail('package_scripts_missing');
      packages.set(pkg.path, { manifest, sha256: source.sha256 });
      for (const script of pkg.scripts) {
        const command = manifest.scripts[script];
        if (typeof command !== 'string' || !command.trim() || Buffer.byteLength(command) > 16_384) fail('referenced_script_missing');
        row.commands.push({ package: pkg.path, script, sourceSha256: source.sha256,
          argv: argvFor(pkg.path, script), definition: command });
      }
    }
    row.validationPlan = validationPlan(row.commands, packages);
    for (const workflow of entry.workflows) {
      const source = read(workflow);
      row.workflows.push({ path: workflow, sha256: source.sha256 });
    }
    if (evaluate && !before.clean) row.findings.push(before.code);
    row.sourceStatus = !evaluate ? 'not-evaluated' : before.clean ? 'matched' : before.digest ? 'dirty' : 'unavailable';
    const verify = () => {
      const after = gitState(root, entry, evaluate);
      return after.revision === before.revision && after.digest === before.digest && after.code === before.code
        && reads.every(record => {
          const source = gitReader.readCompositionHeadFile(root, before.revision, record.path, SOURCE_BYTES, 'owner check source');
          return sha(source.bytes) === record.sha256;
        });
    };
    return { row, verify };
  } catch (error) {
    row.validationPlan = null;
    row.sourceStatus = 'unavailable'; row.findings.push(error.code ?? 'owner_observation_failed');
    return { row };
  }
}
/** Group validated, unsigned failures from one observation; never combine runs or infer coverage. */
function failurePlan(result) {
  const groups = new Map(), unmappedFailures = [];
  const prerequisites = new Map(), unmappedPrerequisiteFailures = [];
  for (const { id, occurrence, source, prerequisite } of result.failures) {
    const failure = { id, occurrence };
    if (prerequisite) {
      const key = JSON.stringify([prerequisite.repository, prerequisite.path]);
      if (!prerequisites.has(key)) prerequisites.set(key, { prerequisite, failures: [] });
      prerequisites.get(key).failures.push(failure);
    } else unmappedPrerequisiteFailures.push(failure);
    if (source === null) { unmappedFailures.push(failure); continue; }
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(failure);
  }
  const sourceGroups = [...groups].map(([source, failures]) => ({ source, failures }))
    .sort((a, b) => b.failures.length - a.failures.length || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return {
    status: 'advisory', basis: 'reported-test-source', reportedFailed: result.coverage.counts.failed,
    listedFailures: result.failures.length,
    unlistedFailures: result.coverage.counts.failed - result.failures.length,
    sourceGroups, unmappedFailures, fullValidationRequired: true,
    ...(prerequisites.size ? {
      prerequisiteGroups: [...prerequisites].sort(([ak, a], [bk, b]) =>
        b.failures.length - a.failures.length || (ak < bk ? -1 : ak > bk ? 1 : 0)).map(([, group]) => group),
      unmappedPrerequisiteFailures,
    } : {}),
    conditions: 'Inspect larger source groups first and verify the shared cause before batching repairs. '
      + 'Source mappings are unsigned caller reports, not verified dependency or root-cause analysis. '
      + 'Each case occurrence appears once in each partition; separate runs are never combined. '
      + 'Optional prerequisite groups are unsigned reported locators, not verified dependencies; no referenced path is read. '
      + 'Unmapped and unlisted failures remain unresolved. Use the enclosing result binding and original scope; '
      + 'stale, dirty or unavailable source remains historical evidence. '
      + 'Run affected owner checks during repairs and full applicable validation on final bytes. '
      + 'This plan executes nothing, grants no coverage and estimates no time savings.',
  };
}
function validateResult(value) {
  exact(value, ['schema', 'repository', 'revision', 'command', 'coverage', 'outcome', 'failures'],
    ['schema', 'repository', 'revision', 'command', 'coverage', 'outcome']);
  if (value.schema !== CHECK_RESULT_SCHEMA || !REVISION.test(value.revision)) fail('result_identity_invalid');
  text(value.repository, 256);
  exact(value.command, ['package', 'script', 'sourceSha256', 'argv']);
  relativeFile(value.command.package); text(value.command.script, 128);
  if (!SHA.test(value.command.sourceSha256)) fail('result_command_digest_invalid');
  array(value.command.argv, 64).forEach(arg => text(arg, 4096));
  exact(value.coverage, ['scope', 'complete', 'counts'], ['scope', 'complete']);
  text(value.coverage.scope, 1024);
  if (typeof value.coverage.complete !== 'boolean'
    || !['passed', 'failed', 'interrupted', 'unknown'].includes(value.outcome)) fail('result_outcome_invalid');
  if (value.outcome === 'passed' && !value.coverage.complete) fail('incomplete_result_claims_pass');
  if (value.coverage.counts !== undefined) {
    const counts = value.coverage.counts;
    exact(counts, ['total', 'passed', 'failed', 'skipped']);
    if (Object.values(counts).some(count => !Number.isSafeInteger(count) || count < 0)
      || counts.passed + counts.failed + counts.skipped !== counts.total
      || (value.outcome === 'passed' && counts.failed !== 0)) fail('result_counts_invalid');
  }
  if (value.failures !== undefined) {
    const failures = array(value.failures, 256), counts = value.coverage.counts;
    if (!counts || !['failed', 'interrupted'].includes(value.outcome) || failures.length > counts.failed)
      fail('result_failures_invalid');
    const cases = new Set();
    for (const failure of failures) {
      exact(failure, ['id', 'occurrence', 'source', 'prerequisite'], ['id', 'occurrence', 'source']);
      if (Object.hasOwn(failure, 'prerequisite')) {
        exact(failure.prerequisite, ['repository', 'path']);
        text(failure.prerequisite.repository, 256);
        relativeFile(failure.prerequisite.path);
        if (failure.prerequisite.path === '.' || failure.prerequisite.path.endsWith('/')) fail('invalid_prerequisite_path');
      }
      text(failure.id, 1024);
      if (!Number.isSafeInteger(failure.occurrence) || failure.occurrence < 1) fail('result_occurrence_invalid');
      if (failure.source !== null) {
        relativeFile(failure.source);
        if (failure.source === '.' || failure.source.endsWith('/')) fail('invalid_source_path');
      }
      const identity = JSON.stringify([failure.id, failure.occurrence]);
      if (cases.has(identity)) fail('duplicate_failure_occurrence');
      cases.add(identity);
    }
  }
  return value;
}
function matchesCommand(actual, expected) {
  const alternatives = [expected.argv];
  if (expected.script === 'test') alternatives.push([...expected.argv.slice(0, -2), 'test']);
  return alternatives.some(prefix => prefix.every((arg, index) => actual[index] === arg)
    && (actual.length === prefix.length || actual[prefix.length] === '--'));
}
export function discoverRepositoryChecks(inputPath, { catalogPath = CATALOG } = {}) {
  const input = readInput(inputPath), catalog = readInput(catalogPath), entries = catalogEntries(catalog.value);
  exact(input.value, ['schema', 'repositories', 'results'], ['schema', 'repositories']);
  if (input.value.schema !== CHECK_INPUT_SCHEMA) fail('input_schema_invalid');
  const base = path.dirname(input.path), selected = new Map();
  for (const item of array(input.value.repositories, MAX_REPOSITORIES)) {
    exact(item, ['id', 'root']); text(item.root, 4096);
    if (selected.has(item.id) || !entries.some(entry => entry.id === item.id)) fail('input_repository_invalid');
    selected.set(item.id, path.resolve(base, item.root));
  }
  const evidence = [], resultKeys = new Set(), unmatchedResults = [];
  for (const reference of array(input.value.results ?? [], 32)) {
    text(reference, 4096);
    const record = readInput(path.resolve(base, reference)); evidence.push(record);
    const result = validateResult(record.value);
    const { package: packagePath, script, sourceSha256, argv } = result.command;
    const key = JSON.stringify([result.repository, result.revision, packagePath, script, sourceSha256, argv, result.coverage.scope]);
    if (resultKeys.has(key)) fail('duplicate_result_observation');
    resultKeys.add(key);
  }
  const seenRoots = new Set(), owners = entries.map(entry => inspectOwner(entry, selected.get(entry.id), seenRoots,
    evidence.some(record => record.value.repository === entry.repository)));
  for (const record of evidence) {
    const result = record.value;
    const owner = owners.find(item => item.row.repository === result.repository)?.row;
    const command = owner?.commands.find(item => item.package === result.command.package && item.script === result.command.script);
    const binding = !owner || owner.sourceStatus !== 'matched' ? 'source_unavailable'
      : result.revision !== owner.revision ? 'stale_revision'
        : !command || result.command.sourceSha256 !== command.sourceSha256 || !matchesCommand(result.command.argv, command)
          ? 'command_mismatch' : 'matched';
    const observation = { receipt: record.path, receiptSha256: record.sha256, repository: result.repository,
      revision: result.revision, command: result.command, coverage: result.coverage,
      reportedOutcome: result.outcome, binding, authenticated: false };
    if (result.failures !== undefined) observation.failurePlan = failurePlan(result);
    (owner?.results ?? unmatchedResults).push(observation);
  }
  for (const owner of owners) {
    if (!owner.verify) continue;
    try { if (owner.verify()) continue; } catch {}
    owner.row.validationPlan = null;
    owner.row.sourceStatus = 'changed'; owner.row.findings.push('source_changed_during_observation');
    owner.row.results.forEach(result => { result.binding = 'source_changed'; });
  }
  if (![input, catalog, ...evidence].every(currentInput)) fail('input_changed_during_observation');
  const report = { schema: CHECK_REPORT_SCHEMA, catalogSha256: catalog.sha256, inputSha256: input.sha256,
    repositories: owners.map(owner => owner.row), unmatchedResults,
    candidateCodeExecuted: false, providerChecksQueried: false, authenticatedEvidenceObserved: false,
    integrationAuthorized: false, productionReady: false,
    scope: 'Owner references and unsigned result observations only; command discovery does not establish execution or ecosystem coverage.' };
  if (Buffer.byteLength(`${JSON.stringify(report, null, 2)}\n`) > OUTPUT_BYTES) fail('report_byte_limit');
  return report;
}
export function runCheckDiscovery(inputPath) {
  try {
    process.stdout.write(`${JSON.stringify(discoverRepositoryChecks(inputPath), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`check discovery: ${error.code ?? error.message}\n`);
    return 1;
  }
}
export function runChecksProcess(inputPath, {
  entrypoint = fileURLToPath(import.meta.url), timeoutMs = 30_000,
} = {}) {
  return new Promise(resolve => {
    const environment = { ...process.env }; delete environment.NODE_OPTIONS; delete environment.NODE_PATH;
    const child = spawn(process.execPath, [entrypoint, '--worker', inputPath], {
      env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', stopped = '', finished = false;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const stop = reason => { stopped ||= reason; kill(); };
    const cancel = () => stop('cancelled');
    const timer = setTimeout(() => stop('ETIMEDOUT'), timeoutMs);
    process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
    const finish = (code, error) => {
      if (finished) return; finished = true; clearTimeout(timer);
      process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
      resolve({ exitCode: stopped || error ? 1 : code ?? 1, stdout: stopped || error ? '' : stdout,
        stderr: stopped || error ? `check discovery stopped: ${stopped || error.code}\n` : stderr });
    };
    const append = (channel, chunk) => {
      if (stopped) return;
      const next = (channel === 'stdout' ? stdout : stderr) + chunk;
      if (Buffer.byteLength(next) > OUTPUT_BYTES) { stop('output_byte_limit'); return; }
      if (channel === 'stdout') stdout = next; else stderr = next;
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));
    child.once('error', error => finish(1, error));
    child.once('exit', kill);
    child.once('close', code => finish(code));
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 4 && process.argv[2] === '--worker') process.exitCode = runCheckDiscovery(process.argv[3]);
  else process.exitCode = 1;
}
