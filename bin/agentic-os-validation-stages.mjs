/** Trusted consumer commands share bounded execution and private stage observations. No result reuse. */
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { hash, readGit } from './agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, receiptDirectory, writeCheck, writeReceipt } from './agentic-os-test-receipt.mjs';
import { economyContext, readEconomy, recordEconomy, economyFeedback } from './agentic-os-validation-economy.mjs';

export const STAGES_FILE = 'validation-stages.json';
export const STAGES_SCHEMA = 'agentic-os/validation-stages/v1';
export function validationStageDirectory(root, kind = 'stages') {
  if (!['stages', 'ci'].includes(kind)) throw Error('blocked-validation-stage-directory');
  const directory = join(receiptDirectory(root), kind);
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
  const feedbackDirectory = receiptDirectory(root, 'feedback-stages');
  const context = economyContext(hash(JSON.stringify(stages)), 'validation-stages/v1', { root: initial.repository,
    environmentDigest: hash(JSON.stringify([hostname(), process.env.NODE_OPTIONS, process.env.CI])), node: process.version, executable: process.execPath,
    platform: process.platform, arch: process.arch });
  const economy = readEconomy(feedbackDirectory, context, startedAt, stages.map(stage => stage.id));
  const receipt = { schema: STAGES_SCHEMA, authority: false, source: initial, startedAt, expectedStages: stages.length,
    outcome: 'running', results: [], active: null, observedOutputBytes: 0, emittedDiagnosticBytes: 0,
    feedback: economyFeedback(economy), costRegressions: [] };
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
      try {
        const { regression, feedback } = recordEconomy(feedbackDirectory, context, { name: stage.id }, { ...result, sourceRevision: initial.revision,
          observationId: hash(JSON.stringify([initial, startedAt, stage.id])) }, Date.now(), stages.map(stage => stage.id));
        if (regression) receipt.costRegressions.push(regression);
        receipt.feedback = feedback;
      } catch (error) { receipt.feedbackError = error.message; }
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

/** Project a provider-verified plan reuse; never count historical execution as current consumption. */
export function recordCiStageReuse(root, stages, verified) {
  const revision = readGit(root, ['rev-parse', 'HEAD']).trim(), tree = readGit(root, ['rev-parse', 'HEAD^{tree}']).trim();
  if (verified?.reused !== true || verified.basis !== 'merged-pr-tree' || verified.authority !== false
    || verified.target?.revision !== revision || verified.target.tree !== tree || verified.source?.tree !== tree
    || !Array.isArray(stages) || !stages.length || stages.length > 128
    || new Set(stages.map(s => s.id)).size !== stages.length
    || stages.some(s => !/^[a-z][a-z0-9.-]{0,95}$/u.test(s.id))) throw Error('blocked-ci-stage-reuse');
  const dirty = Boolean(readGit(root, ['status', '--porcelain=v1', '--untracked-files=normal']).trim());
  if (dirty) throw Error('blocked-ci-stage-source-drift');
  const at = Date.now(), directory = validationStageDirectory(root), release = lockReceipts(directory);
  const receipt = { schema: STAGES_SCHEMA, authority: false, source: { ...verified.target, dirty },
    startedAt: at, finishedAt: at, elapsedMs: 0, expectedStages: stages.length, outcome: 'passed', active: null,
    observedOutputBytes: 0, emittedDiagnosticBytes: 0,
    reuseEvidence: { runUrl: verified.runUrl, runId: verified.runId, runAttempt: verified.runAttempt,
      inputDigest: verified.evidenceInputDigest, sourceRevision: verified.source.revision, targetRevision: revision },
    results: stages.map(s => ({ id: s.id, reused: true, exitCode: 0, startedAt: at, finishedAt: at,
      elapsedMs: 0, observedOutputBytes: 0, outputTruncated: false })) };
  try { writeReceipt(directory, STAGES_FILE, receipt); } finally { release(); }
  return receipt;
}
