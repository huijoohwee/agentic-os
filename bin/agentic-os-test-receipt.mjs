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
export function reusableReceipt(directory, fingerprint, plan, now = Date.now()) {
  try {
    const receipt = JSON.parse(readRegular(directory, 'last.json', LIMITS.receiptBytes).text);
    if (receipt.schema !== 'agentic-os/test-receipt/v1' || receipt.authority !== false
      || receipt.fingerprint !== fingerprint || receipt.outcome !== 'passed'
      || receipt.planDigest !== hash(JSON.stringify(plan)) || receipt.exitCode !== 0
      || !Number.isFinite(receipt.finishedAt) || now - receipt.finishedAt < 0
      || now - receipt.finishedAt > 3_600_000 || !Array.isArray(receipt.results)) return null;
    const expected = ['evaluators', ...plan.stages.filter(stage => stage.tests.length).map(stage => stage.name)];
    if (receipt.results.length !== expected.length || receipt.results.some((result, index) =>
      result.name !== expected[index] || result.exitCode !== 0 || result.reason !== null
      || result.log !== `${expected[index]}.log`
      || readRegular(directory, result.log, LIMITS.outputBytes).digest !== result.outputDigest)) return null;
    return receipt;
  } catch { return null; }
}
export function executeCommand(root, command, args, { timeoutMs = LIMITS.testMs, outputBytes = LIMITS.outputBytes } = {}) {
  return new Promise(resolveResult => {
    const started = performance.now();
    const child = spawn(command, args, { cwd: root, env: executionEnvironment(),
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let length = 0, reason = null;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const stop = code => { reason ||= code; kill(); };
    const cancel = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => {
      const remaining = outputBytes - length, accepted = bytes.subarray(0, remaining);
      chunks.push(accepted); length += accepted.length;
      if (bytes.length > remaining) stop('output-budget');
    });
    child.once('error', () => { reason ||= 'spawn-failed'; });
    child.once('exit', kill);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
      const output = Buffer.concat(chunks).toString('utf8');
      resolveResult({ exitCode, reason: reason ?? (signal ? 'signal' : null), elapsedMs: performance.now() - started,
        output, outputDigest: hash(Buffer.from(output)),
        counts: Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)]
          .map(match => [match[1], Number(match[2])])) });
    });
  });
}
