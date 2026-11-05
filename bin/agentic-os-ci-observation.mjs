/** Explicit one-shot CI timing observation. No polling, execution or release authority. */
import { gh, remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { hash, readGit } from './agentic-os-test-inputs.mjs';
import { validationObservation } from './agentic-os-validation-observation.mjs';
import { STAGES_SCHEMA, validationStageDirectory } from './agentic-os-validation-stages.mjs';
import { lockReceipts, writeReceipt, receiptDirectory } from './agentic-os-test-receipt.mjs';
import { readEconomy, recordEconomy, economyFeedback } from './agentic-os-validation-economy.mjs';
const fail = () => { throw Error('blocked-ci-observation'); };
const instant = value => { const n = Date.parse(value); return Number.isFinite(n) && n > 0 ? n : fail(); };

export function ciTimingReceipt(value, source, runId, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(runId) || runId <= 0 || value.databaseId !== runId || value.headSha !== source.revision
    || !/^github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(source.repository)
    || value.url !== `https://${source.repository}/actions/runs/${runId}`
    || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || !Array.isArray(value.jobs) || value.jobs.length > 64
    || !['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(value.status)) fail();
  const created = instant(value.attempt > 1 ? value.startedAt : value.createdAt), complete = value.status === 'completed';
  const started = value.jobs.filter(job => job.status !== 'queued' && job.conclusion !== 'skipped').map(job => instant(job.startedAt));
  const start = started.length ? Math.min(...started) : null;
  const end = complete ? instant(value.updatedAt) : null;
  if (created > now || start !== null && start < created || start !== null && start > now || end !== null && (end < (start ?? created) || end > now)) fail();
  const make = (id, from, to, success) => ({ id, startedAt: from, finishedAt: to, elapsedMs: to - from,
    exitCode: success ? 0 : 1, reason: null, reused: false,
    ...(id === 'ci-queue' ? { queueWaitMs: to - from } : {}) });
  const results = start === null ? [] : [make('ci-queue', created, start, true)];
  if (complete && start !== null) results.push(make('ci-execution', start, end, value.conclusion === 'success'));
  const active = complete ? null : { id: start === null ? 'ci-queue' : 'ci-execution',
    startedAt: start ?? created, elapsedMs: now - (start ?? created) };
  return { schema: STAGES_SCHEMA, authority: false, source, executionOrder: 'sequential',
    startedAt: created, finishedAt: end, elapsedMs: (end ?? now) - created,
    outcome: complete ? value.conclusion === 'success' ? 'passed' : 'failed' : 'running', expectedStages: 2,
    results, active, ci: { runId, attempt: value.attempt, url: value.url, queueWaitMs: start === null ? null : start - created } };
}

export const ciObservationId = (receipt, stageId) => hash(JSON.stringify([receipt.ci.runId, receipt.ci.attempt, receipt.source.revision, stageId]));

export function ciCheckCoverage(value, workflow) {
  if (workflow?.id !== value.workflowDatabaseId || workflow.path !== '.github/workflows/ci.yml' || workflow.state !== 'active') fail();
  const checks = ['budgets', 'test'].map(name => {
    const jobs = value.jobs.filter(job => job.name === name);
    if (jobs.length > 1 || jobs.length === 0 && value.status === 'completed') fail();
    return { name, status: jobs[0]?.status ?? 'queued', conclusion: jobs[0]?.conclusion ?? null };
  });
  return { scope: 'required-ci-checks', workflowPath: workflow.path,
    workflowId: workflow.id, attempt: value.attempt, checks };
}

/** The existing test job emits its native result; timing alone is never coverage. */
export function ciValidationProof(log, value) {
  if (typeof log !== 'string' || Buffer.byteLength(log) > 500_000) fail();
  const matches = [...log.matchAll(/agentic-os-ci-proof:([A-Za-z0-9+/=]+)/gu)];
  if (matches.length !== 1 || matches[0][1].length > 100_000) fail();
  let proof; try { proof = JSON.parse(Buffer.from(matches[0][1], 'base64').toString('utf8')); } catch { fail(); }
  if (proof?.schema !== 'agentic-os/ci-check-proof/v1' || proof.runId !== value.databaseId || proof.attempt !== value.attempt
    || !/^[a-f0-9]{40}$/u.test(proof.source?.headRevision ?? '') || !/^[a-f0-9]{40}$/u.test(proof.source?.headTree ?? '')
    || !/^[a-f0-9]{64}$/u.test(proof.source?.sourceDigest ?? '') || proof.source.sourceDigest !== proof.source.committedSourceDigest
    || !Array.isArray(proof.suites) || proof.suites.length < 1 || proof.suites.length > 258
    || new Set(proof.suites).size !== proof.suites.length || proof.suites.some(name => !/^__tests__\/[^/]+\.test\.mjs$/u.test(name))) fail();
  return proof;
}

export function readCiObservation(root, runId, { coverage = false } = {}) {
  if (!/^[1-9][0-9]{0,15}$/u.test(String(runId)) || !Number.isSafeInteger(Number(runId))) fail();
  const repository = remoteRepositoryIdentity(readGit(root, ['config', '--get', 'remote.origin.url']).trim())?.repository;
  if (!repository) fail();
  const value = gh(['run', 'view', String(runId), '--repo', repository.replace(/^github\.com\//u, ''),
    '--json', 'databaseId,attempt,workflowDatabaseId,headSha,createdAt,startedAt,updatedAt,status,conclusion,url,jobs'],
  { cwd: root, timeoutMs: 15_000 });
  if (value == null) fail();
  if (!/^[a-f0-9]{40}$/u.test(value.headSha) || !Number.isSafeInteger(value.workflowDatabaseId) || value.workflowDatabaseId <= 0) fail();
  const source = { repository, revision: value.headSha,
    tree: readGit(root, ['rev-parse', `${value.headSha}^{tree}`]).trim(), dirty: null };
  const receipt = ciTimingReceipt(value, source, Number(runId));
  let checkCoverage = null;
  if (coverage) {
    const workflow = gh(['api', `repos/${repository.replace(/^github\.com\//u, '')}/actions/workflows/ci.yml`], { cwd: root });
    checkCoverage = ciCheckCoverage(value, workflow);
    if (receipt.outcome === 'passed' && checkCoverage.checks.every(check => check.conclusion === 'success')) {
      const job = value.jobs.find(job => job.name === 'test');
      if (!Number.isSafeInteger(job.databaseId) || job.databaseId < 1) fail();
      const log = gh(['run', 'view', String(runId), '--repo', repository.replace(/^github\.com\//u, ''),
        '--job', String(job.databaseId), '--attempt', String(value.attempt), '--log'], { cwd: root, json: false });
      checkCoverage.validation = ciValidationProof(log, value);
    }
  }
  const directory = validationStageDirectory(root, 'ci'), release = lockReceipts(directory);
  try {
    const context = hash(JSON.stringify([repository, value.workflowDatabaseId, 'ci-workflow-timing/v1']));
    const feedbackDirectory = receiptDirectory(root, 'feedback-ci');
    receipt.feedback = economyFeedback(readEconomy(feedbackDirectory, context));
    try { if (receipt.outcome !== 'running') for (const result of receipt.results) {
      receipt.feedback = recordEconomy(feedbackDirectory, context, { name: result.id }, { ...result, sourceRevision: source.revision,
        observationId: ciObservationId(receipt, result.id) }).feedback;
    }
    } catch { receipt.feedbackError = 'feedback-capture-unavailable'; }
    writeReceipt(directory, 'validation-stages.json', receipt);
    const output = validationObservation(receipt);
    return { ...output, kind: coverage ? 'ci-check-coverage' : 'ci-timing', ci: receipt.ci,
      coverage: checkCoverage ?? { ...output.coverage, scope: 'ci-workflow-timing' } };
  } finally { release(); }
}
