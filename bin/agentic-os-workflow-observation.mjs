/** Bounded, read-only lifecycle receipt projection. This never executes or authorizes a phase. */
import { dirname, resolve, basename } from 'node:path';
import { hash, readRegular } from './agentic-os-test-inputs.mjs';
const SCHEMA = 'agentic-os/workflow-observation-input/v1';
const digestPattern = /^[a-f0-9]{64}$/u, revisionPattern = /^[a-f0-9]{40}$/u;
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/u.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => typeof value === 'string' ? number(Date.parse(value)) : number(value);
const fail = reason => { throw Error(`blocked-workflow-observation-${reason}`); };
const requireFact = (value, reason) => { if (!value) fail(reason); };
const blankResources = () => ({ cpuMs: null, peakMemoryBytes: null, tokens: null, costUsd: null });
const resources = value => Object.fromEntries(Object.keys(blankResources()).map(key => [key, number(value?.[key])]));
function nativeReceipt(value, phase, source) {
  const revision = phase.revision || source.revision;
  requireFact(revisionPattern.test(revision), 'revision');
  const result = { status: 'completed', start: null, finish: null, elapsedMs: null, resources: blankResources(), children: [], feedback: null };
  switch (value.schema) {
    case 'agentic-os/validation-observation/v1': {
      requireFact(value.authority === false && value.source?.repository === source.repository && value.source?.revision === revision
        && Array.isArray(value.stages) && value.stages.length <= 128, 'validation-binding');
      requireFact(['passed', 'failed', 'blocked', 'running'].includes(value.status), 'validation-status');
      result.status = value.status === 'passed' ? 'completed' : value.status;
      result.start = time(value.startedAt); result.finish = time(value.finishedAt); result.elapsedMs = number(value.elapsedMs);
      result.resources = resources(value.resources);
      result.children = value.stages.map(stage => {
        requireFact(identifier(stage.id) || typeof stage.id === 'string' && /^[a-z][a-z0-9.-]{0,95}$/u.test(stage.id), 'stage-id');
        requireFact(['passed', 'failed', 'reused', 'running'].includes(stage.status), 'stage-status');
        return { id: stage.id, status: stage.status === 'passed' ? 'completed' : stage.status,
          start: time(stage.startedAt), finish: time(stage.finishedAt), elapsedMs: number(stage.elapsedMs),
          resources: stage.status === 'reused' ? blankResources() : resources(stage.resources) };
      });
      // Existing ranked feedback remains advisory. Do not export arbitrary receipt payloads.
      if (value.feedback?.authority === false && Array.isArray(value.feedback.ranking)) result.feedback = value.feedback.ranking.slice(0, 5)
        .filter(row => identifier(row.id) && number(row.meanMs) !== null).map(row => ({ id: row.id, meanMs: row.meanMs,
          samples: number(row.samples), failureRate: number(row.failureRate) }));
      break;
    }
    case 'agentic-os/flight-observation/v1':
      requireFact(value.source?.head === revision && value.source?.repository === source.repository
        && value.observationOnly === true && value.authorizesEffects === false, 'flight-binding');
      result.status = value.ok === true ? 'completed' : 'blocked';
      result.start = result.finish = time(value.observedAt); break;
    case 'agentic-os/sprint-finish/v1':
      requireFact(value.laneHead === revision && revisionPattern.test(value.integratedRevision) && value.grantsAuthority === false, 'finish-binding');
      break;
    case 'agentic-os/user-cleanup-receipt/v1':
      requireFact(value.review?.head === revision && value.providerAuthority === false && value.result === 'quarantined'
        && value.bytesDeleted === false && value.branchesMutated === false, 'cleanup-binding');
      break;
    case 'agentic-os-canonical-sync-receipt/v2':
      requireFact(value.targetHead === revision && value.sourceRetired === true && value.copyOnly === false, 'sync-binding');
      result.status = value.visibleStatusClean === true && value.ignoredPathsPreservedInPlace === true ? 'completed' : 'blocked'; break;
    case 'agentic-local-runtime-readiness/v1':
      requireFact(`github.com/${value.source?.repository}` === source.repository && value.source?.revision === revision, 'runtime-binding');
      result.status = value.ready === true && value.status === 'runtime-ready' ? 'completed' : 'blocked';
      result.start = time(value.startedAt); result.finish = time(value.verifiedAt);
      result.elapsedMs = result.start !== null && result.finish !== null ? result.finish - result.start : null; break;
    default: fail('unsupported-receipt');
  }
  for (const row of [result, ...result.children]) requireFact(row.start === null || row.finish === null || row.finish >= row.start, 'clock');
  return result;
}

function pipelineReceipt(events, phase, source, observedAt) {
  requireFact(events.length > 0 && events.length <= 512, 'pipeline-budget');
  const first = events[0], jobs = new Map(); let terminal = null;
  for (const event of events) {
    requireFact(event.schema === 'agentic-os/pipeline-observation/v1' && event.authority === false
      && `github.com/${event.repo}` === source.repository && event.head === (phase.revision || source.revision)
      && Number.isSafeInteger(event.run) && event.run > 0 && event.run === first.run
      && Number.isSafeInteger(event.attempt) && event.attempt > 0 && event.attempt === first.attempt, 'pipeline-binding');
    if (event.job) { requireFact(Number.isSafeInteger(event.job.id) && Array.isArray(event.job.steps) && event.job.steps.length <= 100, 'pipeline-job'); jobs.set(event.job.id, event.job); }
    if (event.event === 'completed') terminal = event;
  }
  const children = [...jobs.values()].flatMap(job => job.steps.map(step => {
    requireFact(Number.isSafeInteger(step.number) && typeof step.name === 'string' && step.name.length <= 512, 'pipeline-step');
    const start = time(step.startedAt), finish = time(step.completedAt);
    requireFact((start === null || start <= observedAt) && (finish === null || finish <= observedAt)
      && (start === null || finish === null || finish >= start), 'pipeline-clock');
    return { id: `job-${job.id}-step-${step.number}`, label: step.name,
      status: step.status === 'completed' ? step.conclusion === 'success' ? 'completed' : step.conclusion === 'skipped' ? 'skipped' : 'failed' : step.status === 'in_progress' ? 'running' : 'queued',
      start, finish, elapsedMs: start === null ? null : (finish ?? observedAt) - start, resources: blankResources() };
  }));
  requireFact(children.length <= 128, 'pipeline-budget');
  requireFact(!terminal || terminal.conclusion !== 'success' || children.every(row => ['completed', 'skipped'].includes(row.status)), 'pipeline-incomplete');
  const starts = children.map(row => row.start).filter(value => value !== null);
  const finishes = children.map(row => row.finish).filter(value => value !== null);
  const start = starts.length ? Math.min(...starts) : null, finish = terminal && finishes.length ? Math.max(...finishes) : null;
  return { schema: 'workflow-pipeline-projection/v1', row: { status: terminal ? terminal.conclusion === 'success' ? 'completed' : 'failed' : 'running',
    start, finish, elapsedMs: start === null ? null : (finish ?? observedAt) - start, resources: blankResources(), children, feedback: null } };
}

export function workflowObservation(manifest, read, exportedAt = Date.now()) {
  requireFact(manifest?.schema === SCHEMA && identifier(manifest.id) && number(exportedAt) !== null, 'manifest');
  const source = { repository: manifest.source?.repository, revision: manifest.source?.revision, tree: manifest.source?.tree };
  requireFact(/^github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(source?.repository)
    && !source.repository.split('/').some(part => part === '.' || part === '..')
    && revisionPattern.test(source.revision) && revisionPattern.test(source.tree), 'source');
  requireFact(Array.isArray(manifest.expected) && manifest.expected.length > 0 && manifest.expected.length <= 16
    && manifest.expected.every(identifier) && new Set(manifest.expected).size === manifest.expected.length, 'expected');
  requireFact(Array.isArray(manifest.phases) && manifest.phases.length <= 16, 'phases');
  const ids = new Set(), receipts = new Set();
  const phases = manifest.phases.map(phase => {
    requireFact(identifier(phase.id) && manifest.expected.includes(phase.id) && !ids.has(phase.id)
      && typeof phase.file === 'string' && digestPattern.test(phase.digest) && !receipts.has(phase.digest), 'phase');
    ids.add(phase.id); receipts.add(phase.digest);
    const bytes = read(phase.file);
    requireFact(typeof bytes === 'string' && Buffer.byteLength(bytes) <= 128000 && hash(bytes) === phase.digest, 'receipt-digest');
    let value; try { value = JSON.parse(bytes); } catch {
      const events = bytes.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { fail('receipt-json'); } });
      value = pipelineReceipt(events, phase, source, exportedAt);
    }
    const row = value.schema === 'workflow-pipeline-projection/v1' ? value.row : nativeReceipt(value, phase, source);
    return { ...row, id: phase.id, digest: phase.digest, revision: phase.revision || source.revision, schema: value.schema };
  });
  const complete = phases.filter(row => row.status === 'completed').length;
  const missing = manifest.expected.filter(id => !ids.has(id));
  const failed = phases.some(row => ['failed', 'blocked'].includes(row.status));
  const starts = phases.map(row => row.start).filter(value => value !== null), origin = starts.length ? Math.min(...starts) : null;
  const span = (row, parentSpanId, component) => ({ spanId: row.id, parentSpanId, kind: parentSpanId === 'root' ? 'agent' : 'check',
    operation: row.label || row.id, taskId: row.id, status: row.status, attempt: null, subjectDigest: component.digest,
    component, links: [], timing: { startOffsetMs: row.start === null || origin === null ? null : row.start - origin,
      inclusiveMs: row.elapsedMs, exclusiveObservedMs: null }, resources: row.resources, cost: null,
    evaluation: { status: 'unevaluated', score: null } });
  const roots = [], children = [];
  for (const row of phases) {
    const component = { id: row.schema, revision: row.revision, digest: row.digest };
    roots.push(span(row, 'root', component));
    children.push(...row.children.map(child => span({ ...child, id: `${row.id}/${child.id}` }, row.id, component)));
  }
  const rows = [...roots, ...children];
  const candidate = { id: manifest.id, revision: source.revision, digest: hash(JSON.stringify(manifest)) };
  const status = failed ? 'blocked' : complete === manifest.expected.length ? 'completed' : 'running';
  const root = { spanId: 'root', parentSpanId: null, kind: 'workflow', operation: manifest.id, taskId: manifest.id,
    status, subjectDigest: candidate.digest, component: candidate, links: [], cost: null,
    resources: blankResources(), timing: { startOffsetMs: 0, inclusiveMs: null, exclusiveObservedMs: null },
    evaluation: { status: 'reported', score: complete / manifest.expected.length,
      reasonCode: 'receipt coverage only; no release or payment authority', evidence: { id: manifest.id, digest: candidate.digest } } };
  const output = { schema: 'agent-toolkit-run/v1', authority: false, importedObservation: true, runId: `workflow-${manifest.id}`,
    status, subjectDigest: candidate.digest, candidate, cohortId: manifest.id, context: null,
    profile: { workflow: { source, expected: manifest.expected, missing,
      phases: phases.map(({ id, digest, revision, schema, feedback }) => ({ id, digest, revision, schema, feedback })),
      receiptAuthorityVerified: false, measurementScope: 'individual phases; nested values must not be summed' } },
    evaluation: root.evaluation, observedAt: exportedAt, expiresAt: exportedAt + 60000,
    spans: [root, ...rows.slice(0, 31)], page: { total: rows.length + 1, offset: 0, nextCursor: null },
    coverage: { partial: missing.length > 0 || rows.length > 31 || status !== 'completed', droppedEvents: null, projectedSpansOmitted: Math.max(0, rows.length - 31),
      expectedSpans: rows.length + 1 } };
  requireFact(Buffer.byteLength(JSON.stringify(output)) <= 128000, 'output-budget');
  return output;
}
export function readWorkflowObservation(file) {
  const path = resolve(file), input = readRegular(dirname(path), basename(path), 32000);
  const manifest = JSON.parse(input.text);
  return workflowObservation(manifest, fileName => {
    const target = resolve(dirname(path), fileName);
    return readRegular(dirname(target), basename(target), 128000).text;
  });
}
