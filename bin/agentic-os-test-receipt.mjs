/** Private worktree test receipts; never provider or deployment proof. */
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executionEnvironment, hash, LIMITS, readGit, readRegular } from './agentic-os-test-inputs.mjs';

export function receiptDirectory(root) {
  const git = realpathSync(readGit(root, ['rev-parse', '--absolute-git-dir']).trim());
  const directory = join(git, 'agentic-os-tests');
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory)
    throw new Error('blocked-test-receipt-directory');
  return directory;
}
export function lockReceipts(directory) {
  const lock = join(directory, 'running');
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
  const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > (name.endsWith('.json') ? LIMITS.receiptBytes : LIMITS.outputBytes))
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
      || receipt.result.elapsedMs < 0 || receipt.result.elapsedMs > Math.max(LIMITS.testMs, check.timeoutMs || 0)
      || receipt.result.log !== `${check.id}.log`
      || readRegular(directory, receipt.result.log, LIMITS.outputBytes).digest !== receipt.result.outputDigest
      || passed && check.report !== 'exit' && check.stage !== 'evaluators' && (!receipt.result.counts?.tests
        || receipt.result.counts.fail !== 0 || receipt.result.counts.cancelled !== 0)) return null;
    return receipt;
  } catch { return null; }
}
export function writeCheck(directory, check, result, finishedAt = Date.now()) {
  const { output, ...summary } = result, log = `${check.id}.log`;
  writeReceipt(directory, log, output);
  const receipt = { schema: 'agentic-os/test-check/v1', authority: false, id: check.id,
    name: check.name, command: [check.command, ...check.args], fingerprint: check.fingerprint,
    finishedAt, outcome: result.exitCode === 0 && !result.reason ? 'passed' : 'failed',
    result: { ...summary, log } };
  writeReceipt(directory, `${check.id}.json`, receipt);
  return receipt;
}
export const COMMAND_PROGRESS_INTERVAL_MS = 30_000;
export function executeCommand(root, command, args, { timeoutMs = LIMITS.testMs, outputBytes = LIMITS.outputBytes,
  outputMode = 'fail', totalOutputBytes = 16 * 1024 * 1024, onProgress } = {}) {
  if (!['fail', 'tail'].includes(outputMode)) throw new Error('blocked-test-output-mode');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new Error('blocked-test-progress-handler');
  return new Promise(resolveResult => {
    const started = performance.now();
    const child = spawn(command, args, { cwd: root, env: executionEnvironment(),
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let length = 0, observedBytes = 0, reason = null, lastOutputAt = started;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const stop = code => { reason ||= code; kill(); };
    const cancel = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
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
      clearTimeout(timer); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
      let output = Buffer.concat(chunks).toString('utf8');
      while (outputMode === 'tail' && Buffer.byteLength(output) > outputBytes) output = output.slice(1);
      resolveResult({ exitCode, reason: reason ?? (signal ? 'signal' : null), elapsedMs: performance.now() - started,
        output, outputDigest: hash(Buffer.from(output)),
        ...(outputMode === 'tail' ? { observedOutputBytes: observedBytes, outputTruncated: observedBytes > outputBytes } : {}),
        counts: Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)]
          .map(match => [match[1], Number(match[2])])) });
    });
  });
}
