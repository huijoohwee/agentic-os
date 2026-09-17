/** One immutable manifest joins receipt bytes, all captured span pages and next-session advice. */
import { hash } from './agentic-os-test-inputs.mjs';
import { workflowObservation } from './agentic-os-workflow-observation.mjs';
import { normalizeToolkitCostLog } from '../runtime/agents/agent-toolkit-contract.js';
const fail = reason => { throw Error(`blocked-workflow-archive-${reason}`); };
const requireFact = (value, reason) => { if (!value) fail(reason); };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,128}$/u.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const timestamp = value => typeof value === 'string' ? number(Date.parse(value)) : number(value);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const reference = (file, bytes, extra = {}) => ({ file, digest: hash(bytes), ...extra });
const blank = () => ({ cpuMs: null, peakMemoryBytes: null, tokens: null, costUsd: null });

// Source clocks make repeated collection deterministic; export refreshes only inspection expiry.
export function receiptClock(receipts) {
  let latest = 0, nodes = 0;
  function visit(value, depth = 0) {
    requireFact(++nodes <= 100000 && depth <= 32, 'clock-budget');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['observedAt', 'exportedAt', 'startedAt', 'finishedAt', 'completedAt', 'verifiedAt'].includes(key)) {
        const at = timestamp(child); if (at !== null) latest = Math.max(latest, at);
      } else if (typeof child === 'object') visit(child, depth + 1);
    }
  }
  for (const bytes of receipts.values()) {
    let values; try { values = [JSON.parse(bytes)]; } catch { values = bytes.trim().split('\n').map(line => JSON.parse(line)); }
    for (const value of values) visit(value);
  }
  requireFact(latest <= Date.now(), 'future-clock'); return latest;
}

export function traceReferences(manifest) {
  const refs = manifest.traces ?? [];
  requireFact(Array.isArray(refs) && refs.length <= 16, 'trace-budget');
  const ids = new Set(), digests = new Set(manifest.phases.map(row => row.digest));
  for (const ref of refs) {
    requireFact(id(ref.id) && !ids.has(ref.id) && manifest.expected.includes(ref.phase)
      && typeof ref.file === 'string' && /^[a-f0-9]{64}$/u.test(ref.digest) && !digests.has(ref.digest), 'trace-reference');
    ids.add(ref.id); digests.add(ref.digest);
  }
  if (manifest.context !== undefined) {
    requireFact(manifest.context && !Array.isArray(manifest.context), 'context');
    for (const [key, value] of Object.entries(manifest.context))
      requireFact(['worktreeId', 'sessionId', 'turnId', 'threadId'].includes(key) && id(value), 'context');
  }
  return refs;
}

function traceSpans(manifest, read) {
  const spans = [], seen = new Set(), coverage = [];
  for (const ref of traceReferences(manifest)) {
    const bytes = read(ref.file); requireFact(hash(bytes) === ref.digest && Buffer.byteLength(bytes) <= 128000, 'trace-digest');
    const run = JSON.parse(bytes), repository = run.context?.plan?.repository;
    requireFact(run.schema === 'agent-toolkit-run/v1' && id(run.runId) && run.candidate?.revision === manifest.source.revision
      && repository === manifest.source.repository && run.context.plan.revision === manifest.source.revision
      && Array.isArray(run.spans) && run.spans.length <= 32, 'trace-binding');
    requireFact(Number.isSafeInteger(run.page?.total) && run.page.total >= run.spans.length
      && Number.isSafeInteger(run.page?.offset) && run.page.offset >= 0 && run.page.offset + run.spans.length <= run.page.total, 'trace-page');
    coverage.push({ id: ref.id, runId: run.runId, offset: run.page.offset, retained: run.spans.length, total: run.page.total,
      partial: run.coverage?.partial !== false || run.page.total > run.spans.length, upstreamIncomplete: run.traceTruncated === true || (run.coverage?.droppedEvents ?? 0) > 0 || (run.coverage?.expectedSpans ?? run.page.total) > run.page.total, digest: ref.digest });
    const prefix = `trace/${hash(run.runId).slice(0,16)}/`;
    for (const row of run.spans) {
      requireFact(id(row.spanId) && (row.parentSpanId == null || id(row.parentSpanId)) && typeof row.operation === 'string'
        && row.operation.length <= 256 && ['agent','model','tool','retriever','workflow','check'].includes(row.kind)
        && ['queued','running','completed','failed','cancelled','skipped','reused'].includes(row.status), 'trace-span');
      const spanId = `${prefix}${row.spanId}`;
      requireFact(!seen.has(spanId), 'duplicate-span'); seen.add(spanId);
      requireFact(row.links === undefined || Array.isArray(row.links) && row.links.length <= 32 && row.links.every(link => id(link.spanId) && ['dependency','handoff'].includes(link.kind)), 'trace-links');
      let cost = null;
      if (!['reused','skipped'].includes(row.status) && row.cost && !['unreported','not-run'].includes(row.cost.status)) {
        requireFact(['reported','partial'].includes(row.cost.status), 'cost-status');
        cost = { ...normalizeToolkitCostLog(row.cost), status: row.cost.status, basis: 'estimated', actual_cost_usd: null };
      }
      const at = timestamp(row.startedAt), duration = number(row.durationMs ?? row.timing?.inclusiveMs);
      requireFact(at === null || at <= Date.now(), 'trace-clock');
      spans.push({ spanId, parentSpanId: row.parentSpanId == null ? (manifest.phases.some(phase=>phase.id===ref.phase) ? ref.phase : 'root') : `${prefix}${row.parentSpanId}`,
        phase: ref.phase, kind: row.kind, operation: row.operation, taskId: id(row.taskId) ? row.taskId : row.spanId, status: row.status,
        subjectDigest: ref.digest, component: { id: ref.id, revision: manifest.source.revision, digest: ref.digest },
        links: (row.links ?? []).map(link => ({spanId:`${prefix}${link.spanId}`,kind:link.kind})),
        model: cost?.model ?? (id(row.model) ? row.model : null), modelIdentityBasis: cost ? 'reported-cost-log' : id(row.model) ? 'reported-span' : 'unreported', cost, resources: { ...blank(), cpuMs: row.status === 'reused' ? null : number(row.resources?.cpuMs),
          peakMemoryBytes: row.status === 'reused' ? null : number(row.resources?.peakMemoryBytes), tokens: cost ? cost.prompt_tokens + cost.completion_tokens : null,
          costUsd: cost?.estimated_cost_usd ?? null },
        timing: { startOffsetMs: null, inclusiveMs: duration, exclusiveObservedMs: null }, observedStartAt: at,
        evaluation: { status: ['reported','completed','failed','pending','unevaluated'].includes(row.evaluation?.status) ? row.evaluation.status : 'unevaluated',
          score: number(row.evaluation?.score), ...(id(row.evaluation?.evidence?.id) && /^[a-f0-9]{64}$/u.test(row.evaluation?.evidence?.digest)
            ? {evidence:{id:row.evaluation.evidence.id,digest:row.evaluation.evidence.digest}} : {}) } });
    }
  }
  const byId = new Map(spans.map(row=>[row.spanId,row]));
  for (const row of spans) {
    const path = new Set(); let parent = row;
    while (parent) { requireFact(!path.has(parent.spanId),'parent-cycle'); path.add(parent.spanId); parent=byId.get(parent.parentSpanId); }
  }
  // Preserve cross-page parents; missing parents remain explicit rather than fabricated nodes.
  return { spans, coverage, unresolvedParents: spans.filter(row => row.parentSpanId.startsWith('trace/') && !seen.has(row.parentSpanId)).map(row => row.spanId) };
}

export function recommendations(observation) {
  const workflow = observation.profile.workflow, models = observation.spans.filter(row => row.kind === 'model');
  const modelEvidence = models.map(row => ({ spanId: row.spanId, model: row.model ?? null, modelIdentityBasis: row.modelIdentityBasis, cost: row.cost,
    resources: row.resources, digest: row.subjectDigest, revision: row.component.revision }));
  const ranking = workflow.phases.flatMap(phase => (phase.feedback ?? []).map(row => ({ ...row, phase: phase.id,
    evidenceDigest: phase.digest, revision: phase.revision }))).sort((a,b) => b.meanMs-a.meanMs || a.id.localeCompare(b.id)).slice(0,5);
  const advice = ranking.map(row => ({ id: `reuse-${row.id}`, action: 'Check exact-input cache eligibility before repeating this check.',
    reason: `Observed mean ${row.meanMs} ms across ${row.samples ?? 'unknown'} samples.`, evidence: row,
    condition: 'Reuse only a passed receipt with identical inputs, environment and mandatory-check coverage.' }));
  const phases = observation.spans.filter(row => row.parentSpanId === 'root' && row.kind === 'agent');
  for (const row of phases.filter(row => row.resources.cpuMs !== null || row.resources.peakMemoryBytes !== null).slice(0,3))
    advice.push({id:`resource-${row.spanId}`, action:'Profile the expensive phase before changing concurrency or cache policy.',
      evidence:{spanId:row.spanId,digest:row.subjectDigest,revision:row.component.revision,resources:row.resources,elapsedMs:row.timing.inclusiveMs},
      condition:'Compare the same workload and quality boundary; peak process RSS is not concurrent fleet memory and nested resources must not be summed.'});
  if (models.some(row=>row.cost?.status!=='reported' || !row.model)) advice.push({id:'model-measurement',
    action:'Record model identity and provider-reported input/output usage before choosing a cost optimization.',
    evidence:{missingOrPartial:models.filter(row=>row.cost?.status!=='reported'||!row.model).map(row=>({spanId:row.spanId,digest:row.subjectDigest})).slice(0,8)},
    condition:'Do not substitute token estimates, routing labels or a price guess for a measured model call.'});
  if (models.length) advice.push({ id: 'model-economics', action: 'Compare model latency, tokens and estimated cost on the same evaluated cohort before changing model or prompt.',
    reason: `${models.length} captured model spans; missing measurements are not zero.`,
    evidence: modelEvidence.slice(0,8), condition: 'Preserve quality, model identity, pricing basis and source revision; no automatic model switch.' });
  if (workflow.missing.length || observation.coverage.partial) advice.push({ id: 'coverage-first',
    action: 'Collect missing phase or trace pages before claiming complete resource totals or savings.',
    evidence: { missing: workflow.missing, coverage: observation.coverage }, condition: 'Do not infer omitted or unreported measurements.' });
  if (!advice.length) advice.push({ id: 'baseline-first', action: 'Capture a comparable measured validation cohort before recommending a performance change.',
    evidence: { source: workflow.source }, condition: 'No measured baseline means no savings claim.' });
  return { schema: 'agentic-os/workflow-recommendations/v1', authority: false, executable: false,
    source: workflow.source, context: workflow.context ?? null, appliesTo: ['next-workflow','next-session','next-turn','next-thread'],
    strategy: 'observe-recommend-authorized-change-reevaluate', ranking, recommendations: advice,
    models: { captured: models.length, reported: models.filter(row => row.cost?.status === 'reported').length,
      evidence: modelEvidence.slice(0,32), omittedEvidence: Math.max(0,models.length-32), totalTokens: null, estimatedCostUsd: null, actualCostUsd: null },
    revalidation: ['current source revision and write scope', 'same cohort and quality boundary', 'fresh exact-input check eligibility'],
    savingsClaim: null };
}

export function buildArchive(manifest, read, observedAt) {
  const observation = workflowObservation(manifest, read, observedAt, { all: true });
  const traces = traceSpans(manifest, read);
  observation.spans.push(...traces.spans); requireFact(observation.spans.length <= 2048, 'span-budget');
  observation.profile.workflow.context = manifest.context ?? null;
  observation.profile.workflow.traces = traces.coverage;
  const runs = new Map();
  for (const row of traces.coverage) { const group = runs.get(row.runId) ?? []; group.push(row); runs.set(row.runId,group); }
  const partial = [...runs.values()].some(group => {
    let next = 0; const total = group[0].total;
    for (const row of group.sort((a,b)=>a.offset-b.offset)) {
      if (row.offset !== next || row.total !== total || row.upstreamIncomplete) return true;
      next += row.retained;
    }
    return next !== total || group.length === 1 && group[0].partial;
  }) || traces.unresolvedParents.length > 0;
  observation.coverage = { ...observation.coverage, partial: observation.coverage.partial || partial,
    expectedSpans: observation.spans.length, projectedSpansOmitted: 0, unresolvedParents: traces.unresolvedParents };
  observation.page.total = observation.spans.length;
  const files = new Map(), pages = [];
  for (let offset=0; offset<observation.spans.length; offset+=32) {
    const spans=observation.spans.slice(offset,offset+32), file=`spans-${offset}.json`;
    const bytes=json({ schema:'agentic-os/workflow-spans/v1', offset, total:observation.spans.length, spans });
    requireFact(Buffer.byteLength(bytes)<=128000,'page-budget'); files.set(file,bytes); pages.push(reference(file,bytes,{offset,count:spans.length}));
  }
  const bytes=json(recommendations(observation)); requireFact(Buffer.byteLength(bytes)<=128000,'advice-budget');
  files.set('recommendations.json',bytes);
  return { files, archive: { version:1, observedAt, total:observation.spans.length, pages,
    coverage:observation.coverage, traces:traces.coverage, recommendations:reference('recommendations.json',bytes) } };
}

export function readArchive(manifest, read, { offset=0, now=Date.now(), adviceOnly=false }={}) {
  const archive=manifest.archive;
  requireFact(archive?.version===1 && Number.isSafeInteger(archive.total) && archive.total>=1 && archive.total<=2048
    && Array.isArray(archive.pages) && archive.pages.length===Math.ceil(archive.total/32), 'index');
  requireFact(Number.isSafeInteger(offset) && offset>=0 && offset%32===0 && offset<archive.total,'offset');
  const verified = ref => {
    requireFact(typeof ref?.file==='string' && /^(?:spans-\d+|recommendations)\.json$/u.test(ref.file)
      && /^[a-f0-9]{64}$/u.test(ref.digest),'reference');
    const bytes=read(ref.file);requireFact(Buffer.byteLength(bytes)<=128000 && hash(bytes)===ref.digest,'digest');return JSON.parse(bytes);
  };
  // Validate index coverage without loading every page for a small next-turn read.
  archive.pages.forEach((ref,i)=>requireFact(ref.offset===i*32 && ref.count===Math.min(32,archive.total-i*32)
    && ref.file===`spans-${i*32}.json` && /^[a-f0-9]{64}$/u.test(ref.digest),'page-index'));
  const advice=verified(archive.recommendations);
  requireFact(advice.schema==='agentic-os/workflow-recommendations/v1' && advice.authority===false
    && JSON.stringify(advice.source)===JSON.stringify(manifest.source),'advice-binding');
  if(adviceOnly)return advice;
  const page=verified(archive.pages[offset/32]);
  requireFact(page.schema==='agentic-os/workflow-spans/v1' && page.offset===offset && page.total===archive.total
    && page.spans?.length===archive.pages[offset/32].count,'page-binding');
  const observation=workflowObservation(manifest,read,now);
  observation.spans=page.spans; observation.profile.workflow.archive=archive;
  observation.profile.workflow.context=manifest.context??null; observation.profile.workflow.optimization=advice;
  observation.page={total:archive.total,offset,nextCursor:offset+32<archive.total?String(offset+32):null};
  observation.coverage={...archive.coverage,partial:archive.coverage.partial||archive.total>page.spans.length,
    projectedSpansOmitted:archive.total-page.spans.length};
  return observation;
}
