/** Portable, non-authoritative metadata projection. Never exports logs, argv, environment or local paths. */
import { dirname, basename, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { hash, readGit, readRegular } from './agentic-os-test-inputs.mjs';
import { resourceObservation, economyFeedback } from './agentic-os-validation-economy.mjs';
import { STAGES_FILE, STAGES_SCHEMA, validationStageDirectory } from './agentic-os-validation-stages.mjs';

export const VALIDATION_OBSERVATION_SCHEMA = 'agentic-os/validation-observation/v1';
const fail = () => { throw Error('blocked-validation-observation'); };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,95}$/u.test(value) ? value : fail();
function externalChecks(receipt, revision) {
  const external = receipt.externalRequiredChecks ?? [];
  if (!Array.isArray(external) || external.length > 1 || external.some(check => check.name !== 'budgets'
    || check.workflow !== '.github/workflows/ci.yml' || !/^[a-f0-9]{64}$/u.test(check.workflowDigest)
    || check.revision !== revision || !/^[1-9][0-9]*$/u.test(check.runId)
    || !/^[1-9][0-9]*$/u.test(check.runAttempt) || check.status !== 'not-observed'
    || Object.keys(check).length !== 7)) fail();
  return external;
}

function feedbackProjection(value) {
  if (value === undefined) return undefined;
  if (value?.status !== 'advisory' || value.authority !== false || !Array.isArray(value.ranking) || value.ranking.length > 5) fail();
  const checks = {};
  for (const row of value.ranking) {
    const id = identifier(row.id);
    if (Object.hasOwn(checks, id) || !Number.isInteger(row.samples) || row.samples < 1 || row.samples > 32
      || number(row.meanMs) === null || row.meanMs > 86400000 || number(row.failureRate) === null || row.failureRate > 1
      || number(row.observedAt) === null || row.sourceRevision !== null && !/^[a-f0-9]{40}$/u.test(row.sourceRevision)) fail();
    const resourceMeans = {};
    if (!row.resourceMeans || typeof row.resourceMeans !== 'object' || Array.isArray(row.resourceMeans)) fail();
    for (const [key, n] of Object.entries(row.resourceMeans)) {
      if (!['cpuMs', 'peakMemoryBytes', 'tokens', 'costUsd', 'queueWaitMs'].includes(key) || number(n) === null || n > Number.MAX_SAFE_INTEGER) fail();
      resourceMeans[key] = n;
    }
    checks[id] = { samples: row.samples, meanMs: row.meanMs, failureRate: row.failureRate,
      observedAt: row.observedAt, sourceRevision: row.sourceRevision, resourceMeans };
  }
  return economyFeedback({ checks });
}

function resourceTotals(stages, active) {
  const executed = stages.filter(stage => stage.status !== 'reused'), expected = executed.length + (active ? 1 : 0);
  const result = { cpuMs: null, peakMemoryBytes: null, tokens: null, costUsd: null,
    costBasis: 'unreported', queueWaitMs: null, memoryScope: 'maximum-single-process-rss', coverage: { expectedStages: expected } };
  for (const key of ['cpuMs', 'peakMemoryBytes', 'tokens', 'costUsd', 'queueWaitMs']) {
    const known = executed.map(stage => stage.resources[key]).filter(n => n !== null);
    result.coverage[key] = known.length;
    if (known.length && known.length === expected) {
      const n = key === 'peakMemoryBytes' ? Math.max(...known) : known.reduce((a, b) => a + b, 0);
      if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER) fail();
      result[key] = n;
    }
  }
  if (result.costUsd !== null) result.costBasis = 'estimated';
  return result;
}

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
  const external = externalChecks(receipt, source.revision);
  const ids = new Set();
  const stages = receipt.results.map(value => {
    const id = identifier(value.id); if (ids.has(id)) fail(); ids.add(id);
    const elapsedMs = number(value.elapsedMs); if (elapsedMs === null || elapsedMs > 86400000) fail();
    const start = number(value.startedAt), finish = number(value.finishedAt);
    if (start !== null && finish !== null && finish < start) fail();
    return { id, status: value.reused === true ? 'reused' : value.exitCode === 0 && !value.reason ? 'passed' : 'failed',
      startedAt: start, finishedAt: finish, elapsedMs, observedOutputBytes: number(value.observedOutputBytes),
      outputTruncated: value.outputTruncated === true, resources: resourceObservation(value),
      model: value.cost?.status === 'reported' && typeof value.cost.model === 'string' ? value.cost.model.slice(0,128) : null,
      modelIdentityBasis: value.cost?.status === 'reported' && typeof value.cost.model === 'string' ? 'reported-cost-log' : 'unreported' };
  });
  const active = receipt.active ? { id: identifier(receipt.active.id), status: 'running',
    startedAt: number(receipt.active.startedAt), finishedAt: null, elapsedMs: number(receipt.active.elapsedMs),
    observedOutputBytes: number(receipt.active.observedOutputBytes), outputTruncated: false, resources: resourceObservation({}) } : null;
  if (active && ids.has(active.id)) fail();
  const all = active ? [...stages, active] : stages, visible = all.slice(offset, offset + 128);
  const reuse = receipt.reuseEvidence;
  if (reuse && (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/u.test(reuse.runUrl)
    || !Number.isSafeInteger(reuse.runId) || reuse.runId < 1 || !Number.isSafeInteger(reuse.runAttempt) || reuse.runAttempt < 1
    || !/^[a-f0-9]{64}$/u.test(reuse.inputDigest) || !/^[a-f0-9]{40}$/u.test(reuse.sourceRevision)
    || reuse.targetRevision !== source.revision || stages.some(s => s.status !== 'reused'))) fail();
  const output = { schema: VALIDATION_OBSERVATION_SCHEMA, authority: false, exportedAt,
    source: { repository: source.repository, revision: source.revision, tree: source.tree, dirty: source.dirty },
    runId: `validation-${hash(JSON.stringify([source, receipt.startedAt])).slice(0, 24)}`,
    executionOrder: receipt.executionOrder === 'concurrent' ? 'concurrent' : 'sequential',
    status: receipt.outcome, startedAt: receipt.startedAt, finishedAt: number(receipt.finishedAt),
    elapsedMs: number(receipt.elapsedMs), stages: visible,
    ...(reuse ? { reuseEvidence: { runUrl: reuse.runUrl, runId: reuse.runId, runAttempt: reuse.runAttempt,
      inputDigest: reuse.inputDigest, sourceRevision: reuse.sourceRevision, targetRevision: reuse.targetRevision } } : {}),
    ...(receipt.feedbackError || receipt.costObservationError ? { feedbackUnavailable: true } : {}),
    ...(receipt.feedback === undefined ? {} : { feedback: feedbackProjection(receipt.feedback) }),
    resources: { observedOutputBytes: number(receipt.observedOutputBytes), emittedDiagnosticBytes: number(receipt.emittedDiagnosticBytes),
      ...resourceTotals(stages, active) },
    coverage: { capturedStages: visible.length, totalStages: all.length, offset,
      expectedStages: receipt.expectedStages ?? all.length, partial: offset > 0 || all.length > visible.length || receipt.outcome !== 'passed', scope: 'selected-owner-checks', providerAuthority: false,
      ...(external.length ? { externalRequiredChecks: external } : {}) },
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
  const defaults = receipt.resourceDefaults;
  if (defaults !== undefined && (defaults.method !== 'wait4' || defaults.scope !== 'waited-process-tree'
    || defaults.memoryScope !== 'maximum-single-process-rss' || Object.keys(defaults).length !== 3)) fail();
  const external = externalChecks(receipt, identity.headRevision);
  if (external.length && receipt.results.some(result => result.name === 'evaluators')) fail();
  return { ...receipt, schema: STAGES_SCHEMA, executionOrder: 'concurrent',
    outcome: receipt.outcome === 'interrupted' ? 'failed' : receipt.outcome,
    source: { repository, revision: identity.headRevision, tree: identity.headTree, dirty: null },
    expectedStages: (receipt.plan?.suites?.length ?? receipt.results.length - (external.length ? 0 : 1)) + (external.length ? 0 : 1),
    results: receipt.results.map(result => {
      if (typeof result.name !== 'string' || !/^(?:evaluators|__tests__\/[a-z0-9.-]+\.test\.mjs)$/u.test(result.name)) fail();
      const label = result.name.replace(/^__tests__\//u, '').replace(/\.test\.mjs$/u, '');
      return { ...result, ...(defaults && result.resources?.status === 'measured'
        ? { resources: { ...defaults, ...result.resources } } : {}), id: `test-${label.slice(0, 60)}-${hash(result.name).slice(0, 8)}` };
    }) };
}
export function readValidationObservation(root, input, offset = 0) {
  const file = input ? resolve(input) : join(validationStageDirectory(root), STAGES_FILE);
  const bytes = readRegular(dirname(file), basename(file), 128000).text;
  const receipt = JSON.parse(bytes);
  return validationObservation(receipt.schema === 'agentic-os/test-receipt/v2' ? nativeTestReceipt(receipt, root) : receipt, Date.now(), offset);
}
