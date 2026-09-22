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
      if (['observedAt', 'exportedAt', 'startedAt', 'finishedAt', 'completedAt', 'verifiedAt', 'executedAt'].includes(key)) {
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
      requireFact(['workflowId', 'worktreeId', 'sessionId', 'turnId', 'threadId'].includes(key) && id(value), 'context');
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
    coverage.push({ id: ref.id, phase: ref.phase, status: run.status, runId: run.runId, offset: run.page.offset, retained: run.spans.length, total: run.page.total,
      partial: run.coverage?.partial !== false || run.page.total > run.spans.length, upstreamIncomplete: run.coverage?.partial !== false || run.coverage?.sourcePartial === true || run.traceTruncated === true || (run.coverage?.droppedEvents ?? 0) > 0 || (run.coverage?.expectedSpans ?? run.page.total) > run.page.total, digest: ref.digest });
    const prefix = `trace/${hash(run.runId).slice(0,16)}/`;
    const starts = run.spans.map(row=>timestamp(row.startedAt)).filter(value=>value!==null);
    const origin = timestamp(run.startedAt) ?? (starts.length ? Math.min(...starts) : null);
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
      requireFact(at === null || at <= Date.now() && (origin === null || at >= origin), 'trace-clock');
      spans.push({ spanId, parentSpanId: row.parentSpanId == null ? (manifest.phases.some(phase=>phase.id===ref.phase) ? ref.phase : 'root') : `${prefix}${row.parentSpanId}`,
        phase: ref.phase, kind: row.kind, operation: row.operation, taskId: id(row.taskId) ? row.taskId : row.spanId, status: row.status,
        subjectDigest: ref.digest, component: { id: ref.id, revision: manifest.source.revision, digest: ref.digest },
        links: (row.links ?? []).map(link => ({spanId:`${prefix}${link.spanId}`,kind:link.kind})),
        model: cost?.model ?? (id(row.model) ? row.model : null), modelIdentityBasis: cost ? 'reported-cost-log' : id(row.model) ? 'reported-span' : 'unreported', cost, resources: { ...blank(), cpuMs: row.status === 'reused' ? null : number(row.resources?.cpuMs),
          peakMemoryBytes: row.status === 'reused' ? null : number(row.resources?.peakMemoryBytes), tokens: cost ? cost.prompt_tokens + cost.completion_tokens : null,
          costUsd: cost?.estimated_cost_usd ?? null },
        timing: { startOffsetMs: number(row.timing?.startOffsetMs) ?? (at === null || origin === null ? null : at-origin), inclusiveMs: duration, exclusiveObservedMs: null, scope: ref.id }, observedStartAt: at,
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
  const workflow = observation.profile.workflow, models = observation.spans.filter(row => row.kind === 'model' || row.model || row.cost);
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
    progress: workflow.expected.map(id => {
      const row = phases.find(phase => phase.spanId === id);
      return { id, status: row?.status ?? 'missing', digest: row?.subjectDigest ?? null,
        revision: row?.component.revision ?? null };
    }),
    source: workflow.source, context: workflow.context ?? null, appliesTo: ['next-workflow','next-session','next-turn','next-thread'],
    strategy: 'observe-recommend-authorized-change-reevaluate', ranking, recommendations: advice,
    models: { captured: models.length, reported: models.filter(row => row.cost?.status === 'reported').length,
      evidence: modelEvidence.slice(0,32), omittedEvidence: Math.max(0,models.length-32), totalTokens: null, estimatedCostUsd: null, actualCostUsd: null },
    revalidation: ['current source revision and write scope', 'same cohort and quality boundary', 'fresh exact-input check eligibility'],
    savingsClaim: null };
}

// Counts describe captured fields, never additive resource totals or provider authority.
function measurementCoverage(spans) {
  const current = spans.filter(row => !['reused','skipped'].includes(row.status));
  const models = current.filter(row => row.kind === 'model' || row.model || row.cost);
  return { scope: 'captured-spans', currentSpans: current.length,
    historicalSpans: spans.filter(row => row.status === 'reused').length,
    units: { cpuMs: 'milliseconds', peakMemoryBytes: 'bytes', tokens: 'tokens', costUsd: 'estimated-USD' },
    reported: Object.fromEntries(Object.keys(blank()).map(key => [key, current.filter(row => number(row.resources?.[key]) !== null).length])),
    models: { captured: models.length, identified: models.filter(row => Boolean(row.model)).length,
      usageReported: models.filter(row => row.cost?.status === 'reported').length },
    evaluations: { reported: spans.filter(row => ['reported','completed','failed'].includes(row.evaluation?.status)).length,
      unevaluated: spans.filter(row => !['reported','completed','failed'].includes(row.evaluation?.status)).length },
    totals: null, actualCostUsd: null, authorityVerified: false };
}

function traceIncomplete(group) {
  if (!group.length) return true;
  let next = 0; const total = group[0].total;
  for (const row of [...group].sort((a,b)=>a.offset-b.offset)) {
    if (row.offset !== next || row.total !== total || row.upstreamIncomplete) return true;
    next += row.retained;
  }
  return next !== total || group.length === 1 && group[0].partial;
}

export function buildArchive(manifest, read, observedAt) {
  const observation = workflowObservation(manifest, read, observedAt, { all: true });
  const traces = traceSpans(manifest, read);
  observation.spans.push(...traces.spans); requireFact(observation.spans.length <= 2048, 'span-budget');
  observation.profile.workflow.context = manifest.context ?? null;
  observation.profile.workflow.traces = traces.coverage;
  const runs = new Map();
  for (const row of traces.coverage) { const group = runs.get(row.runId) ?? []; group.push(row); runs.set(row.runId,group); }
  const partial = [...runs.values()].some(traceIncomplete) || traces.unresolvedParents.length > 0;
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
  return { files, archive: { version:1, observedAt, status:observation.status, total:observation.spans.length, pages,
    coverage:observation.coverage, measurements:measurementCoverage(observation.spans), traces:traces.coverage, recommendations:reference('recommendations.json',bytes) } };
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
  const observation=workflowObservation(manifest,read,now,{all:true});
  const projected=new Map([...observation.spans, ...(page.spans.some(row=>row.spanId.startsWith('trace/')) ? traceSpans(manifest,read).spans : [])].map(row=>[row.spanId,row]));
  observation.spans=page.spans.map(row=>projected.get(row.spanId)??row); observation.profile.workflow.archive=archive;
  observation.profile.workflow.context=manifest.context??null; observation.profile.workflow.optimization=advice;
  observation.page={total:archive.total,offset,nextCursor:offset+32<archive.total?String(offset+32):null};
  observation.coverage={...archive.coverage,sourcePartial:archive.coverage.partial,partial:archive.coverage.partial||archive.total>page.spans.length,
    projectedSpansOmitted:archive.total-page.spans.length};
  return observation;
}

const phaseNames = ['preparation', 'checks', 'ci', 'integration', 'cleanup', 'synchronization', 'runtime'];
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const endpointKey = row => `${row.memberId}/${row.phase}`;
const edgeKey = row => `${endpointKey(row.before)}>${endpointKey(row.after)}`;
const participantKey = row => `${row.memberId}/${row.traceId}/${row.role}`;

// Cooperative source handoffs restrict effects; they do not authenticate agents or release authority.
function readinessBlockers({ ref, child, read }, participants) {
  if (!participants.length) return [];
  const traces = traceSpans(child, read);
  return participants.flatMap(participant => {
    const page = traces.coverage.find(row => row.id === participant.traceId);
    const group = traces.coverage.filter(row => page && row.runId === page.runId), ids = new Set(group.map(row => row.id));
    const spans = traces.spans.filter(row => ids.has(row.component.id));
    const ready = !traceIncomplete(group) && group.every(row => row.phase === 'preparation' && row.status === 'completed')
      && participants.filter(row => ids.has(row.traceId)).length === 1 && spans.length > 0
      && spans.every(row => row.status === 'completed' && !traces.unresolvedParents.includes(row.spanId)
        && !['failed', 'pending'].includes(row.evaluation.status));
    return ready ? [] : [{ memberId: ref.id, phase: 'preparation', participant: participant.traceId,
      role: participant.role, requiredRevision: child.source.revision, evidenceDigest: page?.digest ?? null,
      status: page?.status ?? 'missing', reason: 'participant-handoff-not-current-complete' }];
  });
}

/** Explicit local restrictions; index edges and receipt coverage never grant authority. */
export function validateWorkflowExecution(execution, members, previous) {
  if (execution === undefined) { requireFact(previous === undefined, 'execution-downgrade'); return null; }
  requireFact(exactKeys(execution, ['version', 'checkoutLimit', 'dependencies', ...(execution?.readiness === undefined ? [] : ['readiness'])]) && execution.version === 1
    && Number.isInteger(execution.checkoutLimit) && execution.checkoutLimit >= 0 && execution.checkoutLimit <= 32,
  'execution-contract');
  const dependencies = execution.dependencies;
  requireFact(exactKeys(dependencies, ['version', 'edges']) && dependencies.version === 1
    && Array.isArray(dependencies.edges) && dependencies.edges.length <= 128, 'dependency-contract');
  const nodes = new Set(members.flatMap(({ ref, child }) => child.expected.map(phase => `${ref.id}/${phase}`)));
  const edges = new Set(), outgoing = new Map();
  for (const edge of dependencies.edges) {
    requireFact(exactKeys(edge, ['before', 'after']) && [edge.before, edge.after].every(endpoint =>
      exactKeys(endpoint, ['memberId', 'phase']) && id(endpoint.memberId) && phaseNames.includes(endpoint.phase)
      && nodes.has(endpointKey(endpoint))), 'dependency-endpoint');
    const before = endpointKey(edge.before), after = endpointKey(edge.after), key = edgeKey(edge);
    requireFact(before !== after && !edges.has(key), 'dependency-duplicate'); edges.add(key);
    outgoing.set(before, [...(outgoing.get(before) ?? []), after]);
  }
  const visited = new Set(), visiting = new Set();
  const visit = node => {
    requireFact(!visiting.has(node), 'dependency-cycle'); if (visited.has(node)) return;
    visiting.add(node); for (const next of outgoing.get(node) ?? []) visit(next);
    visiting.delete(node); visited.add(node);
  };
  for (const node of nodes) visit(node);
  const readiness = execution.readiness, participants = readiness?.participants ?? [], participantKeys = new Set();
  if (readiness !== undefined) {
    requireFact(exactKeys(readiness, ['version', 'participants']) && readiness.version === 1
      && Array.isArray(participants) && participants.length > 0 && participants.length <= 64, 'readiness-contract');
    for (const row of participants) {
      requireFact(exactKeys(row, ['memberId', 'traceId', 'role']) && members.some(member => member.ref.id === row.memberId)
        && id(row.traceId) && ['writer', 'reviewer'].includes(row.role)
        && !participantKeys.has(`${row.memberId}/${row.traceId}`), 'readiness-participant');
      participantKeys.add(`${row.memberId}/${row.traceId}`);
    }
    requireFact(members.every(member => member.child.expected.includes('preparation') && ['writer', 'reviewer'].every(role => participants.some(row =>
      row.memberId === member.ref.id && row.role === role))), 'readiness-coverage');
  }
  if (previous !== undefined) {
    requireFact(previous.checkoutLimit === execution.checkoutLimit
      && previous.dependencies.edges.every(edge => edges.has(edgeKey(edge))), 'execution-relaxation');
    requireFact((previous.readiness?.participants ?? []).every(before => participants.some(row =>
      participantKey(row) === participantKey(before))), 'readiness-relaxation');
  }
  return execution;
}

/** Deterministic prerequisite decisions, with no scheduler, waiting or effect execution. */
export function workflowEligibility(manifest, members) {
  const execution = validateWorkflowExecution(manifest.execution, members);
  const rows = members.flatMap(({ ref, child, advice }) => child.expected.map(phase => {
    const receipt = child.phases.find(row => row.id === phase);
    const progress = advice.progress?.find(row => row.id === phase && row.digest === receipt?.digest
      && row.revision === (receipt?.revision ?? child.source.revision));
    const current = receipt && (receipt.revision ?? child.source.revision) === child.source.revision;
    return { memberId: ref.id, phase, memberDigest: ref.digest, requiredRevision: child.source.revision,
      revision: receipt ? receipt.revision ?? child.source.revision : null,
      evidenceDigest: receipt?.digest ?? null,
      status: !current && receipt ? 'stale' : progress?.partial ? 'partial' : progress?.status ?? 'missing' };
  }));
  const byKey = new Map(rows.map(row => [endpointKey(row), row])), prerequisites = new Map();
  const handoffs = new Map(members.map(member => [member.ref.id, readinessBlockers(member,
    (execution?.readiness?.participants ?? []).filter(row => row.memberId === member.ref.id))]));
  for (const edge of execution?.dependencies.edges ?? []) prerequisites.set(endpointKey(edge.after),
    [...(prerequisites.get(endpointKey(edge.after)) ?? []), endpointKey(edge.before)]);
  const ancestors = (key, result = new Set()) => {
    for (const before of prerequisites.get(key) ?? []) if (!result.has(before)) { result.add(before); ancestors(before, result); }
    return result;
  };
  return { coverage: execution ? 'declared' : 'undeclared', readinessCoverage: execution?.readiness ? 'declared-participants' : 'undeclared', authority: false,
    actions: rows.map(row => {
      const blockers = [...ancestors(endpointKey(row))].sort().flatMap(key => {
        const before = byKey.get(key);
        return [...(before.status === 'completed' ? [] : [{ ...before, reason: 'prerequisite-not-current-complete' }]),
          ...(['checks', 'ci'].includes(before.phase) ? handoffs.get(before.memberId) : [])];
      });
      if (['checks', 'ci'].includes(row.phase)) blockers.push(...handoffs.get(row.memberId));
      const unblocks = rows.filter(after => after.status !== 'completed' && ancestors(endpointKey(after)).has(endpointKey(row))).length;
      return { ...row, unblocks, blockers, eligibility: blockers.length ? 'dependency-blocked'
        : row.status === 'completed' ? 'already-satisfied' : execution ? 'eligible' : 'undeclared' };
    }) };
}

/** Navigation for the existing external-agent loop; never an effect executor or authority proof. */
function releaseClosure(manifest, members) {
  const owners = {
    preparation: ['lane-owner', 'Run the enrolled preflight for the exact candidate.'],
    checks: ['validation-owner', 'Run affected checks or reuse their valid input-bound receipts.'],
    ci: ['provider-check-owner', 'Observe the exact protected check run; repair failures in the source lane.'],
    integration: ['integration-owner', 'Land the checked candidate through protected integration, then run finish.'],
    cleanup: ['cleanup-owner', 'Revalidate consent and quarantine only the exact eligible worktree; retain recovery evidence.'],
    synchronization: ['canonical-owner', 'Use governed canonical synchronization and preserve unrelated bytes.'],
    runtime: ['runtime-owner', 'Run the consumer canonical Dev readiness and exact-candidate review.'],
  };
  const eligibility = workflowEligibility(manifest, members);
  const steps = eligibility.actions.map(row => {
    const [owner, action] = owners[row.phase] ?? ['phase-owner', 'Collect the owning phase receipt.'];
    return { ...row, owner, action, status: row.blockers.length ? 'blocked' : row.status };
  });
  for (const memberId of manifest.releaseTargets) {
    const refs = (manifest.releaseEvidence ?? []).filter(row => row.memberId === memberId);
    const paired = refs.length === 2 && refs.every(row => row.repository === refs[0].repository
      && row.revision === refs[0].revision);
    for (const phase of ['deployment', 'runtime']) {
      const ref = refs.find(row => row.kind === phase);
      const bound = ref && /^[a-f0-9]{40}$/u.test(ref.revision ?? '')
        && ref.repository === members.find(row => row.ref.id === memberId).child.source.repository
        && ref.revision === members.find(row => row.ref.id === memberId).child.source.revision;
      steps.push({ memberId, phase: `production-${phase}`, owner: 'consumer-release-owner',
        action: phase === 'deployment'
          ? 'Prepare the exact reviewed candidate, revalidate existing authorization, and run the consumer protected release workflow.'
          : 'Verify that deployed candidate through the consumer live checks and retain its terminal release receipt.',
        status: ref ? !bound || refs.length === 2 && !paired ? 'blocked' : ref.observedStatus ?? 'queued' : 'missing',
        evidenceDigest: ref?.digest ?? null });
    }
  }
  for (const { ref, child } of members) if (child.archive.coverage.partial || child.archive.status !== 'completed')
    steps.push({ memberId: ref.id, phase: 'receipt-coverage', owner: 'evidence-owner',
      action: 'Collect the missing or unsuccessful native phase and trace evidence; preserve unknown measurements.',
      status: ['failed', 'blocked'].includes(child.archive.status) ? 'blocked' : 'missing', evidenceDigest: ref.digest });
  steps.push({ memberId: null, phase: 'workflow-end', owner: 'evidence-owner',
    action: 'Collect the end successor of the same workflow, retaining every member, release target and original receipt.',
    status: manifest.boundary === 'end' ? 'completed' : 'missing', evidenceDigest: null });
  if (eligibility.coverage === 'declared') for (const row of steps.filter(row => row.eligibility === undefined)) {
    const prerequisites = row.phase === 'workflow-end' ? steps.filter(before => before !== row)
      : eligibility.actions.filter(before => before.memberId === row.memberId);
    row.blockers = prerequisites.filter(before => before.status !== 'completed' || before.blockers?.length)
      .map(({ memberId, phase, status, evidenceDigest }) => ({ memberId, phase, status, evidenceDigest, reason: 'receipt-coverage-incomplete' }));
    row.eligibility = row.blockers.length ? 'dependency-blocked' : row.status === 'completed' ? 'already-satisfied' : 'eligible';
    if (row.blockers.length) row.status = 'blocked';
  }
  const pending = steps.filter(row => row.status !== 'completed');
  const eligible = pending.filter(row => !row.blockers?.length && row.eligibility !== 'undeclared')
    .sort((a, b) => (b.unblocks ?? 0) - (a.unblocks ?? 0) || steps.indexOf(a) - steps.indexOf(b));
  return { target: 'production-runtime-ready', status: pending.some(row => ['failed', 'blocked'].includes(row.status))
    ? 'blocked' : pending.length ? 'incomplete' : 'observed-complete',
    authorizesEffects: false, authorityVerified: false, total: steps.length,
    completed: steps.length - pending.length, pending, dependencyCoverage: eligibility.coverage, readinessCoverage: eligibility.readinessCoverage,
    eligible, blocked: pending.filter(row => row.blockers?.length),
    alreadySatisfied: steps.filter(row => row.status === 'completed'),
    next: eligibility.coverage === 'declared' ? eligible[0] ?? null : pending[0] ?? null,
    policy: 'Continue covered actions through their existing owners; wait on exact active runs, repair failed source, and ask only for uncovered decisions. Receipt coverage is not authenticated release authority.' };
}

// An ADLC root is a reference graph, not a second copy of each worktree's spans.
export const WORKFLOW_GROUP = 'agentic-os/workflow-group/v1';
export function workflowGroup(manifest, load, { offset=0, now=Date.now(), adviceOnly=false }={}) {
  requireFact(manifest.schema===WORKFLOW_GROUP && id(manifest.id), 'group');
  requireFact(Array.isArray(manifest.members) && manifest.members.length>0 && manifest.members.length<=32, 'members');
  const ids=new Set(), worktrees=new Set(), digests=new Set();
  const members=manifest.members.map(ref=>{
    requireFact(id(ref.id) && !ids.has(ref.id) && /^[a-f0-9]{64}$/u.test(ref.digest) && !digests.has(ref.digest), 'member-reference');
    ids.add(ref.id); digests.add(ref.digest);
    const loaded=load(ref), child=loaded.manifest;
    requireFact(child.schema==='agentic-os/workflow-observation-input/v1' && child.archive
      && child.context?.workflowId===manifest.id && id(child.context?.worktreeId), 'member-workflow-binding');
    const identity=`${child.source.repository}:${child.context.worktreeId}`;
    requireFact(!worktrees.has(identity), 'duplicate-worktree'); worktrees.add(identity);
    const advice=readArchive(child,loaded.read,{adviceOnly:true});
    return {ref,child,read:loaded.read,advice};
  });
  requireFact(Array.isArray(manifest.releaseTargets) && manifest.releaseTargets.length>0
    && new Set(manifest.releaseTargets).size===manifest.releaseTargets.length && manifest.releaseTargets.every(value=>ids.has(value)), 'release-targets');
  requireFact(Array.isArray(manifest.releaseEvidence??[]) && (manifest.releaseEvidence??[]).length<=64, 'release-budget');
  const releaseKeys=new Set();
  for (const ref of manifest.releaseEvidence??[]) {
    const key=`${ref.memberId}:${ref.kind}`;
    requireFact(manifest.releaseTargets.includes(ref.memberId) && ['deployment','runtime'].includes(ref.kind)
      && /^[a-f0-9]{64}$/u.test(ref.digest) && !releaseKeys.has(key) && ref.environment==='production', 'release-reference');
    releaseKeys.add(key);
  }
  const missingRelease=manifest.releaseTargets.flatMap(memberId=>['deployment','runtime'].filter(kind=>!releaseKeys.has(`${memberId}:${kind}`)).map(kind=>({memberId,kind})));
  const summaries=members.map(({ref,child})=>({id:ref.id,digest:ref.digest,source:child.source,context:child.context,
    total:child.archive.total,coverage:child.archive.coverage,manifest:ref.file,
    expected:child.expected,missing:child.expected.filter(id=>!child.phases.some(row=>row.id===id)),
    measurements:child.archive.measurements??null,recommendations:child.archive.recommendations}));
  const closure=releaseClosure(manifest,members);
  const common={schema:'agentic-os/workflow-group-recommendations/v1',authority:false,executable:false,closure,
    source:manifest.source,workflowId:manifest.id,planning:manifest.planning,appliesTo:['next-workflow','next-session','next-turn','next-thread'],
    members:summaries,release:{boundary:'production-runtime-ready',targets:manifest.releaseTargets,
      evidence:manifest.releaseEvidence??[],missing:missingRelease,authorityVerified:false},
    recommendations:[...members.flatMap(({ref,advice})=>advice.recommendations.slice(0,5).map(row=>({...row,memberId:ref.id,manifestDigest:ref.digest}))),
      ...(missingRelease.length ? [{id:'release-coverage',action:'Capture the missing production deployment and runtime receipts before claiming end-to-end completion.',
        evidence:{missing:missingRelease},condition:'Only authorized provider-native verification can establish production readiness.'}] : [])],
    models:members.map(({ref,advice})=>({memberId:ref.id,manifestDigest:ref.digest,...advice.models})),
    totals:{tokens:null,costUsd:null,actualCostUsd:null},savingsClaim:null,
    policy:'Recommendations only. Revalidate source, cohort, quality and exact-input eligibility; provider-native release verification remains separate.'};
  if(adviceOnly)return common;
  const releaseRows=(manifest.releaseEvidence??[]).map(ref=>({spanId:`release/${hash(ref.memberId).slice(0,16)}/${ref.kind}`,
    parentSpanId:`member/${hash(ref.memberId).slice(0,16)}/root`,kind:'check',operation:`Production ${ref.kind} evidence`,taskId:ref.kind,
    memberId:ref.memberId,status:['completed','failed'].includes(ref.observedStatus)?ref.observedStatus:'queued',
    subjectDigest:ref.digest,component:{id:ref.schema,revision:ref.revision,digest:ref.digest},links:[],cost:null,resources:blank(),
    timing:{startOffsetMs:null,inclusiveMs:null,exclusiveObservedMs:null},evaluation:{status:'unevaluated',score:null}}));
  const total=1+members.reduce((sum,row)=>sum+row.child.archive.total,0)+releaseRows.length;
  requireFact(total<=65601 && Number.isSafeInteger(offset) && offset>=0 && offset%32===0 && offset<total,'group-offset');
  const partial=closure.status!=='observed-complete';
  const failed=closure.status==='blocked';
  const candidate={id:manifest.id,revision:manifest.source.revision,digest:hash(JSON.stringify(manifest))};
  const root={spanId:'root',parentSpanId:null,kind:'workflow',operation:manifest.id,taskId:manifest.id,
    status:failed?'failed':partial?'running':'completed',subjectDigest:candidate.digest,component:candidate,links:[],cost:null,resources:blank(),
    timing:{startOffsetMs:null,inclusiveMs:null,exclusiveObservedMs:null},
    evaluation:{status:'unevaluated',score:null,reasonCode:'Captured receipt coverage; production authority is not verified by this projection.'}};
  const spans=offset===0?[root]:[]; let start=1;
  for(const {ref,child,read} of members){
    const end=start+child.archive.total, first=Math.max(offset,start), last=Math.min(offset+32,end);
    if(first<last){
      const prefix=`member/${hash(ref.id).slice(0,16)}/`, cache=new Map();
      for(let global=first;global<last;global++){
        const local=global-start, pageOffset=Math.floor(local/32)*32;
        if(!cache.has(pageOffset))cache.set(pageOffset,readArchive(child,read,{offset:pageOffset,now}).spans);
        const row=cache.get(pageOffset)[local%32];
        spans.push({...row,spanId:prefix+row.spanId,parentSpanId:row.parentSpanId===null?'root':prefix+row.parentSpanId,
          links:(row.links??[]).map(link=>({...link,spanId:prefix+link.spanId})),
          memberId:ref.id,source:child.source,worktreeId:child.context.worktreeId,
          timing:{...row.timing,scope:row.timing?.scope?`${ref.id}/${row.timing.scope}`:ref.id}});
      }
    }
    start=end;
  }
  spans.push(...releaseRows.slice(Math.max(0,offset-start),Math.max(0,offset+32-start)));
  return {schema:'agent-toolkit-run/v1',authority:false,importedObservation:true,runId:`workflow-${manifest.id}`,
    status:root.status,subjectDigest:candidate.digest,candidate,cohortId:manifest.id,context:null,
    profile:{workflow:{source:manifest.source,expected:['planning','worktrees','production-deployment','production-runtime'],
      missing:[...summaries.flatMap(row=>row.missing.map(phase=>`${row.id}:phase:${phase}`)),...missingRelease.map(ref=>`${ref.memberId}:${ref.kind}`)],phases:[],planning:manifest.planning,members:summaries,
      release:common.release,closure,optimization:common,receiptAuthorityVerified:false,
      boundary:manifest.boundary??null,sequence:manifest.sequence??null,previous:manifest.previous??null,
      measurementScope:'Per worktree and phase; concurrent clocks, nested tokens and costs must not be summed'}},
    evaluation:root.evaluation,observedAt:now,expiresAt:now+60000,spans,
    page:{total,offset,nextCursor:offset+32<total?String(offset+32):null},
    coverage:{sourcePartial:partial,partial:partial||total>spans.length,expectedSpans:total,droppedEvents:null,projectedSpansOmitted:total-spans.length}};
}
