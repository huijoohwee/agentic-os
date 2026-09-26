/** Private worktree test receipts; never provider or deployment proof. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { observeGit } from '../src/git-tracked.mjs';
import { executionEnvironment, hash, LIMITS, readGit, readRegular } from './agentic-os-test-inputs.mjs';
export function receiptDirectory(root, scope = 'validation') {
  if (!['validation', 'feedback-stages', 'feedback-ci', 'execution'].includes(scope)) throw Error('blocked-test-receipt-scope');
  const git = realpathSync(resolve(root, readGit(root, ['rev-parse', scope === 'validation' ? '--absolute-git-dir' : '--git-common-dir']).trim()));
  const configured = observeGit(['config', '--local', '--get', 'agentic-os.validationArtifactsRoot'], { cwd: root, allowFail: true });
  if (configured && (!isAbsolute(configured) || realpathSync(configured) !== configured))
    throw new Error('blocked-test-artifact-root');
  // Explicit device-local storage; CI and unenrolled clones retain Git-private defaults.
  const directory = configured ? join(configured, `${scope}-${hash(git).slice(0, 24)}`)
    : join(git, scope === 'validation' ? 'agentic-os-tests' : `agentic-os-${scope}`);
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory)
    throw new Error('blocked-test-receipt-directory');
  return directory;
}
export function lockReceipts(directory, name = 'running') {
  if (!/^(?:running|command-[a-f0-9]{64})$/u.test(name)) throw Error('blocked-test-lock-name');
  const lock = join(directory, name);
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('blocked-tests-already-running'); }
  const identity = lstatSync(lock);
  return () => {
    const current = lstatSync(lock);
    if (current.ino !== identity.ino || current.dev !== identity.dev || !current.isDirectory())
      throw new Error('blocked-test-lock-drift');
    rmdirSync(lock);
  };
}
export function writeReceipt(directory, name, value) {
  const limit = name.endsWith('.full.log') ? FAILURE_OUTPUT_BYTES : name.endsWith('.json') ? LIMITS.receiptBytes : LIMITS.outputBytes;
  let bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n';
  // Preserve every result while avoiding indentation overhead for expanded suites.
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && Buffer.byteLength(bytes) > limit) bytes = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(bytes) > limit && value?.schema === 'agentic-os/test-receipt/v2' && Array.isArray(value.results)) {
    // Compact aggregates retain links to complete per-check receipts.
    const { stages, ...plan } = value.plan;
    const suiteDefaults = { stage: 'behavior', reasons: ['broad-impact'] };
    plan.suiteDefaults = suiteDefaults;
    plan.suites = plan.suites.map(suite => Object.fromEntries(Object.entries(suite)
      .filter(([key, field]) => JSON.stringify(field) !== JSON.stringify(suiteDefaults[key]))));
    const resourceDefaults = { method: 'wait4', scope: 'waited-process-tree', memoryScope: 'maximum-single-process-rss' };
    const results = value.results.map(({ outputDigest, ...result }) => {
      if (result.resources?.status !== 'measured' || Object.entries(resourceDefaults).some(([key, v]) => result.resources[key] !== v)) return result;
      const { method, scope, memoryScope, ...resources } = result.resources;
      return { ...result, resources };
    });
    bytes = JSON.stringify({ ...value, plan, results, resourceDefaults, diagnostics: 'per-check-receipts' }) + '\n';
  }
  if (Buffer.byteLength(bytes) > limit)
    throw new Error('blocked-test-receipt-byte-budget');
  const temporary = join(directory, `${name}.${process.pid}.tmp`);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, join(directory, name));
}
/** One bounded record per check, replaced atomically; logs are content-bound. */
export function previousCheck(directory, check, now = Date.now(), { allowFailure = false } = {}) {
  try {
    const receipt = JSON.parse(readRegular(directory, `${check.id}.json`, LIMITS.receiptBytes).text);
    const passed = receipt.outcome === 'passed' && receipt.result?.exitCode === 0 && receipt.result?.reason === null;
    const failed = allowFailure && receipt.outcome === 'failed' && receipt.result
      && (receipt.result.exitCode !== 0 || receipt.result.reason !== null);
    if (receipt.schema !== 'agentic-os/test-check/v1' || receipt.authority !== false
      || receipt.id !== check.id || receipt.name !== check.name
      || JSON.stringify(receipt.command) !== JSON.stringify([check.command, ...check.args])
      || !passed && !failed
      || !Number.isFinite(receipt.finishedAt) || now - receipt.finishedAt < 0
      || now - receipt.finishedAt > 3_600_000 || !Number.isFinite(receipt.result.elapsedMs)
      || receipt.result.elapsedMs < 0 || receipt.result.elapsedMs > (failed ? 86_400_000 : Math.max(LIMITS.testMs, check.timeoutMs || 0))
      || receipt.result.log !== `${check.id}.log`
      || readRegular(directory, receipt.result.log, LIMITS.outputBytes).digest !== receipt.result.outputDigest
      || passed && check.report !== 'exit' && check.stage !== 'evaluators' && (!receipt.result.counts?.tests
        || receipt.result.counts.fail !== 0 || receipt.result.counts.cancelled !== 0)) return null;
    return receipt;
  } catch { return null; }
}
export function writeCheck(directory, check, result, finishedAt = Date.now()) {
  const { output, fullOutput, fullOutputTruncated, ...summary } = result, log = `${check.id}.log`;
  if (fullOutput !== undefined) {
    if (!Buffer.isBuffer(fullOutput) || fullOutput.length > FAILURE_OUTPUT_BYTES
      || !/^[a-z0-9][a-z0-9.-]*$/u.test(check.id)) throw Error('blocked-test-full-output');
    const name = `${check.id}.full.log`; writeReceipt(directory, name, fullOutput);
    summary.failureOutput = { log: name, digest: hash(fullOutput), bytes: fullOutput.length, truncated: fullOutputTruncated === true };
  }
  writeReceipt(directory, log, output);
  const receipt = { schema: 'agentic-os/test-check/v1', authority: false, id: check.id,
    name: check.name, command: [check.command, ...check.args], fingerprint: check.fingerprint,
    finishedAt, outcome: result.exitCode === 0 && !result.reason ? 'passed' : 'failed',
    result: { ...summary, log } };
  writeReceipt(directory, `${check.id}.json`, receipt);
  return receipt;
}
const require = createRequire(import.meta.url);
const EXECUTION_ANCESTRY = 'AGENTIC_OS_COMMAND_ANCESTRY';
export const commandExecutionKey = (command, args) => hash(JSON.stringify([
  command === 'node' ? process.execPath : command, ...args,
]));
function claimCommand(root, command, args, environment) {
  const directory = receiptDirectory(root, 'execution');
  const commandKey = commandExecutionKey(command, args);
  const key = hash(JSON.stringify([directory, commandKey]));
  let ancestry;
  const inherited = environment[EXECUTION_ANCESTRY] || '[]';
  if (inherited.length > 1200) throw Error('blocked-command-ancestry');
  try { ancestry = JSON.parse(inherited); }
  catch { throw Error('blocked-command-ancestry'); }
  if (!Array.isArray(ancestry) || ancestry.length > 16
    || ancestry.some(entry => typeof entry !== 'string' || !/^[a-f0-9]{64}$/u.test(entry)))
    throw Error('blocked-command-ancestry');
  if (ancestry.includes(key)) throw Error('blocked-command-recursion');
  if (ancestry.length === 16) throw Error('blocked-command-depth');
  const release = lockReceipts(directory, `command-${commandKey}`);
  environment[EXECUTION_ANCESTRY] = JSON.stringify([...ancestry, key]);
  return release;
}
export const COMMAND_PROGRESS_INTERVAL_MS = 30_000;
export const FAILURE_OUTPUT_BYTES = 16 * 1024 * 1024;
export function executeCommand(root, command, args, { timeoutMs = LIMITS.testMs, outputBytes = LIMITS.outputBytes,
  outputMode = 'fail', totalOutputBytes = FAILURE_OUTPUT_BYTES, retainFailureOutput = false, onProgress } = {}) {
  if (!['fail', 'tail'].includes(outputMode)) throw new Error('blocked-test-output-mode');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new Error('blocked-test-progress-handler');
  const started = performance.now(), startedAt = Date.now();
  const { resourceCommand, commandResourceReader } = require('./agentic-os-test-command-resources.cjs');
  const environment = executionEnvironment();
  const release = claimCommand(root, command, args, environment);
  return new Promise(resolveResult => {
    const plan = resourceCommand(command, args, environment), accounting = commandResourceReader(plan);
    const child = spawn(plan.command, plan.args, { cwd: root, env: environment,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', ...(plan.measured ? ['pipe'] : [])] });
    if (plan.measured) child.stdio[3].on('data', accounting.accept);
    const chunks = [], fullChunks = [];
    let length = 0, fullLength = 0, observedBytes = 0, reason = null, lastOutputAt = started, forceTimer;
    const signalGroup = signal => {
      try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); }
      catch { child.kill(signal); }
    };
    const kill = () => signalGroup('SIGKILL');
    const stop = code => {
      if (reason) return;
      reason = code;
      // Nested native executors get a bounded opportunity to terminate their own process groups.
      signalGroup('SIGTERM'); forceTimer = setTimeout(kill, 250);
    };
    const cancel = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), Math.max(1, timeoutMs - (performance.now() - started)));
    // Diagnostics are rate bounded and contain no child output, credentials or source bytes.
    // Keep them outside the content-bound result and release authority.
    const progressTimer = onProgress ? setInterval(() => {
      const now = performance.now();
      try { onProgress(Object.freeze({ elapsedMs: now - started, timeoutMs,
        observedOutputBytes: observedBytes, quietMs: now - lastOutputAt })); }
      catch { stop('progress-handler-failed'); }
    }, COMMAND_PROGRESS_INTERVAL_MS) : null;
    process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => {
      lastOutputAt = performance.now();
      observedBytes += bytes.length;
      if (retainFailureOutput && fullLength < FAILURE_OUTPUT_BYTES) {
        const accepted = bytes.subarray(0, FAILURE_OUTPUT_BYTES - fullLength);
        fullChunks.push(accepted); fullLength += accepted.length;
      }
      if (outputMode === 'tail') {
        chunks.push(bytes); length += bytes.length;
        while (length > outputBytes) {
          const remove = Math.min(length - outputBytes, chunks[0].length);
          if (remove === chunks[0].length) chunks.shift(); else chunks[0] = chunks[0].subarray(remove);
          length -= remove;
        }
        if (observedBytes > totalOutputBytes) stop('output-budget');
        return;
      }
      const remaining = outputBytes - length, accepted = bytes.subarray(0, remaining);
      chunks.push(accepted); length += accepted.length;
      if (bytes.length > remaining) stop('output-budget');
    });
    child.once('error', () => { reason ||= 'spawn-failed'; });
    child.once('exit', kill);
    child.once('close', (exitCode, signal) => {
      if (progressTimer !== null) clearInterval(progressTimer);
      clearTimeout(forceTimer);
      clearTimeout(timer); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
      let output = Buffer.concat(chunks).toString('utf8');
      while (outputMode === 'tail' && Buffer.byteLength(output) > outputBytes) output = output.slice(1);
      const resources = accounting.finish();
      if (resources.spawnFailed) reason ||= 'spawn-failed';
      resolveResult({ exitCode, reason: reason ?? (signal ? 'signal' : null), startedAt, finishedAt: Date.now(), elapsedMs: performance.now() - started,
        output, outputDigest: hash(Buffer.from(output)), resources,
        ...(retainFailureOutput && (exitCode !== 0 || reason || signal)
          ? { fullOutput: Buffer.concat(fullChunks), fullOutputTruncated: observedBytes > fullLength } : {}),
        ...(outputMode === 'tail' ? { observedOutputBytes: observedBytes, outputTruncated: observedBytes > outputBytes } : {}),
        counts: Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)]
          .map(match => [match[1], Number(match[2])])) });
    });
  }).finally(release);
}
