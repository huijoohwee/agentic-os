/** Portable, non-authoritative metadata projection. Never exports logs, argv, environment or local paths. */
import { dirname, basename, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { hash, readGit, readRegular } from './agentic-os-test-inputs.mjs';
import { STAGES_FILE, STAGES_SCHEMA, validationStageDirectory } from './agentic-os-validation-stages.mjs';

export const VALIDATION_OBSERVATION_SCHEMA = 'agentic-os/validation-observation/v1';
const fail = () => { throw Error('blocked-validation-observation'); };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,95}$/u.test(value) ? value : fail();

export function validationObservation(receipt, exportedAt = Date.now(), offset = 0) {
  if (!receipt || receipt.authority !== false || ![STAGES_SCHEMA, 'agentic-os/repository-validation/v1'].includes(receipt.schema)
    || !Array.isArray(receipt.results) || receipt.results.length > 256 || number(exportedAt) === null) fail();
  const source = receipt.source ?? {};
  if (!/^github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(source.repository)
    || source.repository.split('/').some(part => ['.', '..'].includes(part))
    || !/^[a-f0-9]{40}$/u.test(source.revision) || !/^[a-f0-9]{40}$/u.test(source.tree)
    || source.dirty !== null && typeof source.dirty !== 'boolean' || number(receipt.startedAt) === null
    || !['running', 'passed', 'failed', 'blocked'].includes(receipt.outcome)) fail();
  if (!Number.isInteger(offset) || offset < 0 || offset % 128 || offset > Math.max(0, receipt.results.length - 1)) fail();
  const ids = new Set();
  const stages = receipt.results.map(value => {
    const id = identifier(value.id); if (ids.has(id)) fail(); ids.add(id);
    const elapsedMs = number(value.elapsedMs); if (elapsedMs === null || elapsedMs > 86400000) fail();
    const start = number(value.startedAt), finish = number(value.finishedAt);
    if (start !== null && finish !== null && finish < start) fail();
    return { id, status: value.reused === true ? 'reused' : value.exitCode === 0 && !value.reason ? 'passed' : 'failed',
      startedAt: start, finishedAt: finish, elapsedMs, observedOutputBytes: number(value.observedOutputBytes),
      outputTruncated: value.outputTruncated === true };
  });
  const active = receipt.active ? { id: identifier(receipt.active.id), status: 'running',
    startedAt: number(receipt.active.startedAt), finishedAt: null, elapsedMs: number(receipt.active.elapsedMs),
    observedOutputBytes: number(receipt.active.observedOutputBytes), outputTruncated: false } : null;
  if (active && ids.has(active.id)) fail();
  const all = active ? [...stages, active] : stages, visible = all.slice(offset, offset + 128);
  const output = { schema: VALIDATION_OBSERVATION_SCHEMA, authority: false, exportedAt,
    source: { repository: source.repository, revision: source.revision, tree: source.tree, dirty: source.dirty },
    runId: `validation-${hash(JSON.stringify([source, receipt.startedAt])).slice(0, 24)}`,
    executionOrder: receipt.executionOrder === 'concurrent' ? 'concurrent' : 'sequential',
    status: receipt.outcome, startedAt: receipt.startedAt, finishedAt: number(receipt.finishedAt),
    elapsedMs: number(receipt.elapsedMs), stages: visible,
    resources: { observedOutputBytes: number(receipt.observedOutputBytes), emittedDiagnosticBytes: number(receipt.emittedDiagnosticBytes),
      cpuMs: null, peakMemoryBytes: null, tokens: null, costUsd: null },
    coverage: { capturedStages: visible.length, totalStages: all.length, offset,
      expectedStages: receipt.expectedStages ?? all.length, partial: offset > 0 || all.length > visible.length || receipt.outcome !== 'passed', scope: 'selected-owner-checks', providerAuthority: false },
  };
  if (Buffer.byteLength(JSON.stringify(output)) > 128000) fail();
  return output;
}

/** Adapt the existing OS test receipt; no parallel result store or inferred sequence. */
function nativeTestReceipt(receipt, root) {
  const identity = receipt.identity;
  if (!identity || identity.root !== realpathSync(root) || !/^[a-f0-9]{40}$/u.test(identity.headRevision)
    || readGit(root, ['rev-parse', `${identity.headRevision}^{tree}`]).trim() !== identity.headTree
    || !Array.isArray(receipt.results) || receipt.results.length > 256) fail();
  const repository = remoteRepositoryIdentity(readGit(root, ['config', '--get', 'remote.origin.url']).trim())?.repository;
  return { ...receipt, schema: STAGES_SCHEMA, executionOrder: 'concurrent',
    outcome: receipt.outcome === 'interrupted' ? 'failed' : receipt.outcome,
    source: { repository, revision: identity.headRevision, tree: identity.headTree, dirty: null },
    expectedStages: (receipt.plan?.suites?.length ?? receipt.results.length - 1) + 1,
    results: receipt.results.map(result => {
      if (typeof result.name !== 'string' || !/^(?:evaluators|__tests__\/[a-z0-9.-]+\.test\.mjs)$/u.test(result.name)) fail();
      const label = result.name.replace(/^__tests__\//u, '').replace(/\.test\.mjs$/u, '');
      return { ...result, id: `test-${label.slice(0, 60)}-${hash(result.name).slice(0, 8)}` };
    }) };
}
export function readValidationObservation(root, input, offset = 0) {
  const file = input ? resolve(input) : join(validationStageDirectory(root), STAGES_FILE);
  const bytes = readRegular(dirname(file), basename(file), 128000).text;
  const receipt = JSON.parse(bytes);
  return validationObservation(receipt.schema === 'agentic-os/test-receipt/v2' ? nativeTestReceipt(receipt, root) : receipt, Date.now(), offset);
}
