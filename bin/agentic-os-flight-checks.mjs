/** Execute canonically enrolled checks; retain failures before any consumer-owned effect. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalJson } from '../src/governance.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { acquireOperationLock, commonDir, finishOperationLock, headSha, observeGit } from '../src/git.mjs';
import { flightInputs, flightRequirements, publicationByteRisks } from './agentic-os-auxiliary.mjs';
import { option } from './agentic-os-argv.mjs';

const SCHEMA = 'agentic-os/flight-check-gate/v1';
const ATTEMPTS = 3, OUTPUT_BYTES = 65_536, TOTAL_TIMEOUT_MS = 900_000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const save = (file, value) => writeFileSync(file, canonicalJson(value) + '\n', { flag: 'wx', mode: 0o600 });
const json = file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
  readBoundedFile(file, OUTPUT_BYTES, 'flight check record', { expectedPath: file })));
function directory(file) {
  if (!existsSync(file)) mkdirSync(file, { mode: 0o700 });
  const stat = lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(file) !== file) fail('blocked-flight-ledger-kind');
  return file;
}
function readContext(file) {
  const absolute = resolve(file), bytes = readBoundedFile(absolute, OUTPUT_BYTES, 'flight check context');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || Object.keys(value).sort().join(',') !== 'artifactDigest,configurationDigest,schema,sourceRevision'
    || value.schema !== 'agentic-os/flight-check-context/v1'
    || !/^[0-9a-f]{40}$/u.test(value.sourceRevision)
    || ![value.artifactDigest, value.configurationDigest].every(v => /^[0-9a-f]{64}$/u.test(v))
    || canonicalJson(value) + '\n' !== bytes.toString('utf8')) fail('blocked-flight-check-context-invalid');
  return { value, digest: hash(bytes), path: absolute };
}
function snapshot(root, profile, context, operation) {
  const requirements = flightRequirements(root, profile);
  if (requirements?.schema !== 'agentic-os/flight-requirements/v3'
    || !requirements.operations.includes(operation)) fail('blocked-flight-checks-unconfigured');
  if (headSha('HEAD', root) !== context.value.sourceRevision
    || headSha(profile.canonical.localRef, root) !== context.value.sourceRevision
    || headSha(profile.canonical.remoteRef, root) !== context.value.sourceRevision
    || publicationByteRisks(root).blocked) fail('blocked-flight-check-source-unreviewed');
  const remote = flightRequirements(root, profile, null, profile.canonical.remoteRef);
  if (remote.digest !== requirements.digest) fail('blocked-flight-check-enrollment-stale');
  const inputs = flightInputs(root, requirements, 'pre', Date.now(), operation);
  const missing = inputs.filter(input => !input.satisfied);
  if (missing.length) throw Object.assign(new Error('blocked-flight-prerequisites'), {
    code: 'blocked-flight-prerequisites', findings: missing });
  const checks = requirements.checks.filter(check => check.operations.includes(operation));
  if (!checks.some(check => check.kind === 'browser')) fail('blocked-flight-browser-check-missing');
  if (checks.reduce((sum, check) => sum + check.timeoutMs, 0) > TOTAL_TIMEOUT_MS) fail('blocked-flight-check-time-budget');
  const tree = observeGit(['rev-parse', 'HEAD^{tree}'], { cwd: root });
  const plans = checks.map(check => {
    const script = realpathSync(resolve(root, check.script)), tail = relative(root, script);
    if (isAbsolute(tail) || tail === '..' || tail.startsWith('../')
      || !/^100(?:644|755) blob /u.test(observeGit(['ls-tree', 'HEAD', '--', check.script], { cwd: root })))
      fail('blocked-flight-check-script-untracked');
    const environment = Object.fromEntries(check.environment.map(name => {
      const value = process.env[name];
      if (typeof value !== 'string' || !value.trim()) fail('blocked-flight-check-environment-missing');
      return [name, value];
    }));
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT'])
      if (process.env[name] !== undefined) environment[name] ??= process.env[name];
    // Run IDs, attempt numbers, timestamps and cosmetic check labels cannot reset a failure.
    const binding = { repository: profile.repository, tree, artifactDigest: context.value.artifactDigest,
      configurationDigest: context.value.configurationDigest,
      command: { script: check.script, args: check.args }, environmentDigest: hash(canonicalJson(environment)),
      runner: { node: process.version, platform: process.platform, arch: process.arch } };
    return { check, script, environment, binding, fingerprint: hash(canonicalJson(binding)) };
  });
  if (new Set(plans.map(plan => plan.fingerprint)).size !== plans.length) fail('blocked-flight-check-command-duplicate');
  return { requirements, plans, tree };
}
function priorAttempt(base, plan) {
  const folder = join(base, plan.fingerprint);
  if (!existsSync(folder)) return { folder, attempt: 1, blocked: null };
  directory(folder);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = join(folder, `${attempt}-started.json`), result = join(folder, `${attempt}-result.json`);
    if (!existsSync(started)) {
      if (existsSync(result)) fail('blocked-flight-ledger-inconsistent');
      return { folder, attempt, blocked: null };
    }
    const entry = json(started);
    if (entry.fingerprint !== plan.fingerprint || entry.attempt !== attempt
      || canonicalJson(entry.binding) !== canonicalJson(plan.binding)) fail('blocked-flight-ledger-binding');
    if (!existsSync(result)) return { folder, attempt, blocked: 'interrupted-check-needs-reconciliation' };
    const observed = json(result);
    if (observed.fingerprint !== plan.fingerprint || observed.attempt !== attempt
      || !['passed', 'failed', 'interrupted', 'drift'].includes(observed.outcome)) fail('blocked-flight-ledger-binding');
    if (observed.outcome === 'passed' && (observed.exitCode !== 0 || observed.reason !== null))
      fail('blocked-flight-ledger-binding');
    for (const channel of ['stdout', 'stderr']) {
      const file = join(folder, `${attempt}-${channel}.log`), log = observed.logs?.[channel];
      const bytes = readBoundedFile(file, OUTPUT_BYTES, 'retained check diagnostics', { expectedPath: file });
      if (log?.path !== file || log.bytes !== bytes.length || log.digest !== hash(bytes)) fail('blocked-flight-ledger-diagnostics');
    }
    if (observed.outcome !== 'passed') return { folder, attempt, blocked: 'unchanged-failed-check' };
  }
  return { folder, attempt: ATTEMPTS, blocked: 'check-attempt-budget-exhausted' };
}
function executeCheck(root, plan, contextPath) {
  return new Promise(resolveResult => {
    // Context bytes are bound separately; moving the file cannot erase a prior failure.
    const environment = { ...plan.environment, AGENTIC_OS_FLIGHT_CONTEXT: contextPath };
    const child = spawn(process.execPath, ['--', plan.script, ...plan.check.args], {
      cwd: root, env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    let stopped = null, spawnError = false;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const stop = code => { stopped ||= code; kill(); };
    const cancel = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), plan.check.timeoutMs);
    process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => {
      const remaining = OUTPUT_BYTES - output[channel].length;
      output[channel] = Buffer.concat([output[channel], bytes.subarray(0, remaining)]);
      if (bytes.length > remaining) stop('output-budget');
    });
    child.once('error', () => { spawnError = true; });
    child.once('exit', kill); // A check cannot leave descendants running after it reports success.
    child.once('close', (code, signal) => {
      clearTimeout(timer); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
      resolveResult({ outcome: stopped || spawnError || signal ? 'interrupted' : code === 0 ? 'passed' : 'failed',
        exitCode: code, reason: stopped || (spawnError ? 'spawn-failed' : signal ? 'signal' : null), ...output });
    });
  });
}
export async function runFlightGate(root, argv, profile) {
  let lock = null, report;
  const observedAt = new Date().toISOString(), results = [];
  try {
    const context = readContext(option(argv, 'context')), operation = option(argv, 'operation');
    const initial = snapshot(root, profile, context, operation);
    lock = acquireOperationLock('agentic-os-flight-checks', root);
    if (!lock) fail('blocked-flight-checks-concurrent');
    const common = realpathSync(commonDir(root));
    const base = directory(join(directory(join(common, 'agentic-os')), 'flight-checks'));
    const plans = initial.plans.map(plan => ({ ...plan, ...priorAttempt(base, plan) }));
    const blocked = plans.filter(plan => plan.blocked).map(plan => ({ id: plan.check.id,
      owner: plan.check.owner, fingerprint: plan.fingerprint, reason: plan.blocked }));
    if (blocked.length) report = { ok: false, code: 'blocked-flight-check-history', blocked };
    else {
      const stable = () => {
        if (readContext(context.path).digest !== context.digest) fail('blocked-flight-check-context-drift');
        const current = snapshot(root, profile, context, operation);
        if (current.requirements.digest !== initial.requirements.digest
          || canonicalJson(current.plans.map(p => p.binding)) !== canonicalJson(initial.plans.map(p => p.binding)))
          fail('blocked-flight-check-binding-drift');
      };
      for (const plan of plans) {
        stable(); directory(plan.folder);
        const startedAt = new Date().toISOString();
        save(join(plan.folder, `${plan.attempt}-started.json`), { fingerprint: plan.fingerprint,
          attempt: plan.attempt, binding: plan.binding, sourceRevision: context.value.sourceRevision, startedAt });
        const result = await executeCheck(root, plan, context.path);
        try { stable(); } catch { result.outcome = 'drift'; result.reason = 'check-binding-drift'; }
        const logs = {};
        for (const channel of ['stdout', 'stderr']) {
          const file = join(plan.folder, `${plan.attempt}-${channel}.log`);
          writeFileSync(file, result[channel], { flag: 'wx', mode: 0o600 });
          logs[channel] = { path: file, bytes: result[channel].length, digest: hash(result[channel]) };
        }
        const record = { id: plan.check.id, owner: plan.check.owner, fingerprint: plan.fingerprint,
          attempt: plan.attempt, outcome: result.outcome, reason: result.reason, exitCode: result.exitCode,
          startedAt, completedAt: new Date().toISOString(), logs };
        save(join(plan.folder, `${plan.attempt}-result.json`), record); results.push(record);
        if (record.outcome !== 'passed') break;
      }
      stable();
      report = { ok: results.length === plans.length && results.every(r => r.outcome === 'passed'),
        sourceRevision: context.value.sourceRevision, tree: initial.tree, contextDigest: context.digest,
        requirementsDigest: initial.requirements.digest, operation, checks: results };
    }
  } catch (error) { report = { ok: false, code: error.code ?? error.reason ?? 'blocked-flight-check-input', checks: results,
    ...(Array.isArray(error.findings) ? { findings: error.findings } : {}) }; }
  if (lock) {
    try { finishOperationLock(lock, { label: 'flight-checks', result: report }); }
    catch { report = { ...report, ok: false, code: 'blocked-flight-check-lock-release' }; }
  }
  const output = { schema: SCHEMA, observedAt, ...report, authorizesEffects: false, productionReady: false,
    nextAction: report.ok ? 'continue_existing_authorized_owner_operation' : 'repair_or_reconcile_before_release',
    automaticRetry: false, successReused: false, ledgerScope: 'shared-git-clone' };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  return report.ok ? 0 : 1;
}
