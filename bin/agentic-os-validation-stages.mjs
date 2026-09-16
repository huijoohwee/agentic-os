/** Trusted consumer commands share bounded execution and private stage observations. No result reuse. */
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { hash, readGit } from './agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, receiptDirectory, writeCheck, writeReceipt } from './agentic-os-test-receipt.mjs';

export const STAGES_FILE = 'validation-stages.json';
export const STAGES_SCHEMA = 'agentic-os/validation-stages/v1';
export function validationStageDirectory(root) {
  const directory = join(receiptDirectory(root), 'stages');
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw Error('blocked-validation-stage-directory');
  return directory;
}

export async function runValidationStages(root, stages, { out = console.log } = {}) {
  if (!Array.isArray(stages) || !stages.length || stages.length > 128) throw Error('blocked-validation-stage-count');
  const ids = new Set();
  for (const stage of stages) {
    if (!stage || Object.keys(stage).sort().join() !== 'command,id,timeoutMs'
      || !/^[a-z][a-z0-9.-]{0,95}$/u.test(stage.id) || ids.has(stage.id)
      || !Array.isArray(stage.command) || !stage.command.length || stage.command.length > 32
      || !['node', 'npm', 'python3', 'env'].includes(stage.command[0])
      || stage.command.some(arg => typeof arg !== 'string' || !arg || arg.length > 2048 || /[\x00-\x1f]/u.test(arg))
      || !Number.isInteger(stage.timeoutMs) || stage.timeoutMs < 100 || stage.timeoutMs > 900000)
      throw Error('blocked-validation-stage-definition');
    ids.add(stage.id);
  }
  const directory = validationStageDirectory(root);
  const source = () => ({
    repository: remoteRepositoryIdentity(readGit(root, ['config', '--get', 'remote.origin.url']).trim())?.repository,
    revision: readGit(root, ['rev-parse', 'HEAD']).trim(), tree: readGit(root, ['rev-parse', 'HEAD^{tree}']).trim(),
    dirty: Boolean(readGit(root, ['status', '--porcelain=v1', '--untracked-files=normal']).trim()),
  });
  const initial = source(), startedAt = Date.now(), started = performance.now();
  const receipt = { schema: STAGES_SCHEMA, authority: false, source: initial, startedAt, expectedStages: stages.length,
    outcome: 'running', results: [], active: null, observedOutputBytes: 0, emittedDiagnosticBytes: 0 };
  const emit = message => { receipt.emittedDiagnosticBytes += Buffer.byteLength(message) + 1; out(message); };
  const save = () => writeReceipt(directory, STAGES_FILE, receipt);
  const release = lockReceipts(directory);
  try {
    save();
    for (const [index, stage] of stages.entries()) {
      if (JSON.stringify(source()) !== JSON.stringify(initial)) throw Error('blocked-validation-stage-source-drift');
      const remaining = 900000 - (performance.now() - started);
      if (remaining <= 0) throw Error('blocked-validation-stage-time-budget');
      receipt.active = { id: stage.id, startedAt: Date.now(), elapsedMs: 0, observedOutputBytes: 0 };
      emit(`stage ${index + 1}/${stages.length} ${stage.id}: running`); save();
      const result = await executeCommand(root, stage.command[0], stage.command.slice(1), {
        timeoutMs: Math.min(stage.timeoutMs, remaining), outputMode: 'tail', outputBytes: 48000,
        onProgress: progress => {
          receipt.active = { id: stage.id, startedAt: receipt.active.startedAt, ...progress };
          emit(`stage ${index + 1}/${stages.length} ${stage.id}: ${Math.floor(progress.elapsedMs / 1000)}s, ${progress.observedOutputBytes} output bytes`);
          save();
        },
      });
      const check = { id: `stage-${hash(JSON.stringify(stage.command)).slice(0, 24)}`, name: stage.id,
        command: stage.command[0], args: stage.command.slice(1), fingerprint: hash(JSON.stringify({ source: initial, stage })) };
      const saved = writeCheck(directory, check, result);
      receipt.results.push({ id: stage.id, ...saved.result, reused: false });
      receipt.observedOutputBytes += result.observedOutputBytes ?? 0;
      receipt.active = null;
      emit(`stage ${index + 1}/${stages.length} ${stage.id}: ${(result.elapsedMs / 1000).toFixed(2)}s, exit ${result.exitCode}`);
      save();
      if (result.exitCode !== 0 || result.reason) {
        emit(result.output.slice(-12000));
        receipt.outcome = 'failed';
        throw Error(`validation stage ${stage.id} failed; retained log ${saved.result.log}`);
      }
    }
    if (JSON.stringify(source()) !== JSON.stringify(initial)) throw Error('blocked-validation-stage-source-drift');
    receipt.outcome = 'passed';
    return receipt;
  } catch (error) {
    if (receipt.outcome === 'running') receipt.outcome = 'blocked';
    throw error;
  } finally {
    receipt.finishedAt = Date.now(); receipt.elapsedMs = performance.now() - started;
    try { save(); } finally { release(); }
  }
}
