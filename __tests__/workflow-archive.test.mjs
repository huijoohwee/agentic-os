import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildArchive, readArchive, receiptClock } from '../bin/agentic-os-workflow-archive.mjs';
import { toolArguments } from '../src/mcp-server.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const source = { repository:'github.com/example/project', revision:'a'.repeat(40), tree:'b'.repeat(40) };
function fixture(count=70, trace, owner=source) {
  const files=new Map();
  const checks={schema:'agentic-os/validation-observation/v1',authority:false,source:owner,status:'passed',startedAt:100,finishedAt:200,
    stages:Array.from({length:count},(_,i)=>({id:`check-${i}`,status:'passed',elapsedMs:1})),
    feedback:{authority:false,ranking:[{id:'expensive-check',meanMs:5000,samples:3,failureRate:0}]}};
  const bytes=JSON.stringify(checks); files.set('checks.json',bytes);
  const manifest={schema:'agentic-os/workflow-observation-input/v1',id:'complete-worktree',source:owner,expected:['checks'],
    context:{worktreeId:'lane-1',sessionId:'session-1',turnId:'turn-1',threadId:'thread-1'},
    phases:[{id:'checks',file:'checks.json',digest:hash(bytes)}]};
  if(trace){const body=JSON.stringify(trace);files.set('trace.json',body);manifest.traces=[{id:'model-run',phase:'checks',file:'trace.json',digest:hash(body)}];}
  const read=file=>files.get(file), captured=buildArchive(manifest,read,receiptClock(files));
  for(const [file,bytes] of captured.files)files.set(file,bytes);
  manifest.archive=captured.archive;
  return {files,read,manifest};
}
function nativeTrace() {
  return {schema:'agent-toolkit-run/v1',runId:'run-1',candidate:{revision:source.revision},
    context:{plan:{repository:source.repository,revision:source.revision}},page:{total:2,offset:0},coverage:{partial:false},
    spans:[{spanId:'root',parentSpanId:null,kind:'workflow',operation:'run',status:'completed',startedAt:100,durationMs:100},
      {spanId:'model',parentSpanId:'root',kind:'model',operation:'work',status:'completed',startedAt:110,durationMs:80,
        links:[{spanId:'root',kind:'dependency'}],resources:{cpuMs:20,peakMemoryBytes:1000},cost:{status:'reported',model:'local-model',prompt_tokens:124,completion_tokens:51,cache_hits:0,estimated_cost_usd:0},
        evaluation:{status:'completed',score:1,evidence:{id:'eval-1',digest:'d'.repeat(64)}},secret:'never-export',input:'private prompt',output:'private response'}]};
}
test('one manifest references every captured span exactly once across bounded pages',()=>{
 const {manifest,read}=fixture();const rows=[];
 for(let offset=0;offset<manifest.archive.total;offset+=32){
  const page=readArchive(manifest,read,{offset,now:1000});assert(page.spans.length<=32);rows.push(...page.spans);
  assert.equal(page.page.nextCursor,offset+32<manifest.archive.total?String(offset+32):null);
 }
 assert.equal(rows.length,72);assert.equal(new Set(rows.map(r=>r.spanId)).size,72);
 assert.equal(manifest.archive.coverage.projectedSpansOmitted,0);
 assert.equal(manifest.archive.coverage.partial,false);
 assert.equal(manifest.archive.pages.length,3);
});
test('next-context advice is source-bound, inert and reads no span-page bodies',()=>{
 const {manifest,read}=fixture();const loaded=[];
 const advice=readArchive(manifest,file=>{loaded.push(file);return read(file);},{adviceOnly:true});
 assert.deepEqual(loaded,['recommendations.json']);assert.equal(advice.authority,false);assert.equal(advice.executable,false);
 assert.equal(advice.appliesTo.length,4);assert.equal(advice.ranking[0].meanMs,5000);
 assert.equal(advice.recommendations[0].evidence.evidenceDigest,manifest.phases[0].digest);
 assert.deepEqual(advice.context,manifest.context);assert.equal(advice.savingsClaim,null);
});
test('native model usage preserves known zero and source evidence without payloads or cash claims',()=>{
 const {manifest,read}=fixture(1,nativeTrace());const page=readArchive(manifest,read,{now:1000});
 const row=page.spans.find(s=>s.kind==='model');assert.equal(row.model,'local-model');assert.equal(row.resources.cpuMs,20);assert.equal(row.links[0].kind,'dependency');assert.equal(row.resources.tokens,175);
 assert.equal(row.evaluation.score,1);assert.equal(row.evaluation.evidence.id,'eval-1');assert.equal(row.cost.estimated_cost_usd,0);assert.equal(row.cost.actual_cost_usd,null);assert.equal(row.cost.basis,'estimated');
 assert.equal(row.timing.startOffsetMs,10);assert.equal(row.timing.inclusiveMs,80);
 assert.equal(row.subjectDigest,manifest.traces[0].digest);assert.equal(page.spans[0].resources.tokens,null);
 for(const secret of ['never-export','private prompt','private response'])assert(!JSON.stringify(page).includes(secret));
 assert.equal(page.profile.workflow.optimization.models.reported,1);
});
test('unreported and reused model costs stay unknown and do not become current consumption',()=>{
 for(const mode of ['unreported','reused']){
  const trace=nativeTrace();if(mode==='unreported')trace.spans[1].cost={status:'unreported'};else trace.spans[1].status='reused';
  const {manifest,read}=fixture(1,trace);const row=readArchive(manifest,read).spans.find(s=>s.kind==='model');
  assert.equal(row.cost,null);assert.equal(row.resources.tokens,null);assert.equal(row.resources.costUsd,null);
 }
});
test('reject tampered page or recommendation bytes, invalid offsets and broken index coverage',()=>{
 const {manifest,read,files}=fixture();assert.throws(()=>readArchive(manifest,read,{offset:1}),/offset/);
 assert.throws(()=>readArchive(manifest,read,{offset:96}),/offset/);
 const original=files.get('spans-32.json');files.set('spans-32.json','{}');
 assert.throws(()=>readArchive(manifest,read,{offset:32}),/digest/);files.set('spans-32.json',original);
 files.set('recommendations.json','{}');assert.throws(()=>readArchive(manifest,read,{adviceOnly:true}),/digest/);
 manifest.archive.pages[1].offset=64;assert.throws(()=>readArchive(manifest,read),/page-index/);
});
test('reject wrong source, duplicate spans, invalid token counts and future model clocks',()=>{
 for(const mutate of [r=>r.candidate.revision='c'.repeat(40),r=>r.context.plan.repository='github.com/other/repo',
  r=>r.spans[1].spanId='root',r=>r.spans[0].parentSpanId='model',r=>r.spans[1].cost.prompt_tokens=-1,r=>r.spans[1].startedAt=Date.now()+60000]){
  const trace=nativeTrace();mutate(trace);assert.throws(()=>fixture(1,trace));
 }
});
test('upstream missing spans and missing parents remain partial even when all supplied bytes are archived',()=>{
 const trace=nativeTrace();trace.page.total=3;trace.coverage.partial=true;trace.spans[1].parentSpanId='absent';
 const {manifest,read}=fixture(1,trace);assert.equal(manifest.archive.coverage.partial,true);
 assert.equal(manifest.archive.coverage.unresolvedParents.length,1);
 assert(readArchive(manifest,read,{adviceOnly:true}).recommendations.some(r=>r.id==='coverage-first'));
});
test('CLI/MCP page selection rejects invalid or misplaced offsets',()=>{
 assert.deepEqual(toolArguments('workflow.export',{input:'index.json',offset:32}),['workflow','export','--input=index.json','--offset=32']);
 for(const offset of [-1,1,1.5,'32'])assert.throws(()=>toolArguments('workflow.export',{input:'x',offset}));
 assert.throws(()=>toolArguments('workflow.recommend',{input:'x',offset:32}));
 assert.deepEqual(toolArguments('workflow.recommend',{input:'x'}),['workflow','recommend','--input=x']);
});

import { workflowGroup, WORKFLOW_GROUP, validateWorkflowExecution, workflowEligibility } from '../bin/agentic-os-workflow-archive.mjs';
function groupFixture(){
 const left=fixture(70),right=fixture(1,nativeTrace());
 left.manifest.context={workflowId:'shared-adlc',worktreeId:'left'};
 right.manifest.context={workflowId:'shared-adlc',worktreeId:'right'};
 const members=[left,right].map((value,i)=>({id:i?'right':'left',file:`member-${i}.json`,digest:hash(JSON.stringify(value.manifest))}));
 return {left,right,manifest:{schema:WORKFLOW_GROUP,id:'shared-adlc',source,planning:{digest:'c'.repeat(64)},members,releaseTargets:['right'],releaseEvidence:[]},
  load:ref=>ref.id==='left'?left:right};
}
test('one ADLC root traverses two worktrees without duplicate ids or copied span pages',()=>{
 const {manifest,load}=groupFixture(),rows=[];let next=0;
 do{const view=workflowGroup(manifest,load,{offset:next,now:1000});rows.push(...view.spans);next=view.page.nextCursor===null?null:Number(view.page.nextCursor);
 assert(view.spans.length<=32);assert.equal(view.authority,false);}while(next!==null);
 assert.equal(rows.length,78);assert.equal(new Set(rows.map(row=>row.spanId)).size,78);
 const ids=new Set(rows.map(row=>row.spanId));assert(rows.filter(row=>row.parentSpanId).every(row=>ids.has(row.parentSpanId)));
 assert.equal(rows.find(row=>row.kind==='model').resources.tokens,175);
 assert(rows.slice(1).every(row=>typeof row.timing.scope==='string'));
 assert(rows.slice(1).some(row=>row.timing.startOffsetMs!==null));
 assert(!('spans' in manifest));assert(!('archive' in manifest));
});
test('ADLC rejects unrelated workflows, repeated worktree identity, duplicate roots and dropped release targets',()=>{
 for(const change of [g=>g.right.manifest.context.workflowId='unrelated',g=>g.right.manifest.context.worktreeId='left',
  g=>g.manifest.members[1].digest=g.manifest.members[0].digest,g=>g.manifest.releaseTargets=['absent']]){
  const group=groupFixture();change(group);assert.throws(()=>workflowGroup(group.manifest,group.load));
 }
});
test('production deployment and runtime remain separate missing evidence; advice stays per worktree',()=>{
 const {manifest,load}=groupFixture();let view=workflowGroup(manifest,load);
 assert.equal(view.status,'running');assert.equal(view.profile.workflow.release.authorityVerified,false);
 assert.deepEqual(view.profile.workflow.missing,['right:deployment','right:runtime']);
 manifest.releaseEvidence=[{memberId:'right',kind:'deployment',environment:'production',digest:'d'.repeat(64)}];
 view=workflowGroup(manifest,load);assert.deepEqual(view.profile.workflow.missing,['right:runtime']);
 const advice=workflowGroup(manifest,load,{adviceOnly:true});assert.equal(advice.totals.tokens,null);assert.equal(advice.executable,false);
 assert(advice.recommendations.filter(row=>row.id!=='release-coverage').every(row=>['left','right'].includes(row.memberId)&&row.manifestDigest));
 assert(advice.recommendations.some(row=>row.id==='release-coverage'));
 assert.deepEqual(toolArguments('workflow.export',{input:'index.json',format:'sse'}),['workflow','export','--input=index.json','--format=sse']);
 assert.throws(()=>toolArguments('workflow.export',{input:'index.json',format:'html'}));
});

test('shared ADLC keeps distinct repositories source-bound and loads only requested span pages',()=>{
 const group=groupFixture(),other=fixture(1,undefined,{...source,repository:'github.com/example/other'});
 other.manifest.context={workflowId:'shared-adlc',worktreeId:'other'};
 group.manifest.members[1].digest=hash(JSON.stringify(other.manifest));
 const reads=[];const load=ref=>{const value=ref.id==='left'?group.left:other;return {...value,read:file=>{reads.push(`${ref.id}:${file}`);return value.read(file);}};};
 const advice=workflowGroup(group.manifest,load,{adviceOnly:true});
 assert.equal(advice.members[1].source.repository,'github.com/example/other');assert(reads.every(file=>file.endsWith('recommendations.json')));
 reads.length=0;const page=workflowGroup(group.manifest,load,{offset:32,now:1000});
 assert.equal(page.spans.length,32);assert(!reads.some(file=>file.startsWith('right:spans-')));
});


test('measurement index counts known zero without summing overlapping spans or reused usage',()=>{
 const trace=nativeTrace();trace.spans[1].model='local-model';
 const {manifest,read}=fixture(1,trace),index=manifest.archive.measurements;
 assert.equal(index.models.captured,1);assert.equal(index.models.identified,1);assert.equal(index.models.usageReported,1);
 assert.equal(index.reported.costUsd,1);assert.equal(index.reported.tokens,1);assert.equal(index.totals,null);
 assert.equal(index.actualCostUsd,null);assert.equal(index.units.costUsd,'estimated-USD');
 assert.equal(index.evaluations.reported,2);assert.equal(index.authorityVerified,false);
 trace.spans[1].status='reused';const reused=fixture(1,trace).manifest.archive.measurements;
 assert.equal(reused.models.captured,0);assert.equal(reused.reported.costUsd,0);assert.equal(reused.historicalSpans,1);
 assert.equal(readArchive(manifest,read,{adviceOnly:true}).models.evidence[0].model,'local-model');
});
test('group advice exposes member phase gaps and model evidence without loading span pages',()=>{
 const group=groupFixture();group.left.manifest.expected.push('runtime');const reads=[];
 const load=ref=>{const value=group.load(ref);return {...value,read:file=>{reads.push(file);return value.read(file);}};};
 const advice=workflowGroup(group.manifest,load,{adviceOnly:true});
 assert.deepEqual(advice.members[0].missing,['runtime']);assert(advice.members[0].recommendations.digest);
 assert.equal(advice.members[1].measurements.models.identified,1);
 assert.equal(advice.models[1].evidence[0].cost.prompt_tokens,124);
 assert(reads.every(file=>file==='recommendations.json'));
 assert(workflowGroup(group.manifest,group.load).profile.workflow.missing.includes('left:phase:runtime'));
 delete group.left.manifest.archive.measurements;
 assert.equal(workflowGroup(group.manifest,group.load,{adviceOnly:true}).members[0].measurements,null);
});

test('release closure continues after green checks and requires matching Production receipts plus end',()=>{
 const {manifest,load}=groupFixture();
 let closure=workflowGroup(manifest,load,{adviceOnly:true}).closure;
 assert.equal(closure.status,'incomplete');
 assert.equal(closure.next.phase,'production-deployment');
 assert.equal(closure.next.owner,'consumer-release-owner');
 manifest.boundary='end';
 assert.equal(workflowGroup(manifest,load).status,'running');
 manifest.releaseEvidence=['deployment','runtime'].map((kind,i)=>({memberId:'right',kind,
  environment:'production',repository:source.repository,revision:source.revision,
  digest:String(i+1).repeat(64),schema:'consumer-release/v1',observedStatus:'completed'}));
 closure=workflowGroup(manifest,load,{adviceOnly:true}).closure;
 assert.equal(closure.status,'observed-complete');assert.equal(closure.next,null);
 assert.equal(closure.authorizesEffects,false);assert.equal(closure.authorityVerified,false);
 assert.equal(workflowGroup(manifest,load).status,'completed');
 delete manifest.boundary;
 assert.equal(workflowGroup(manifest,load).status,'running');
 assert.equal(workflowGroup(manifest,load,{adviceOnly:true}).closure.next.phase,'workflow-end');
 manifest.boundary='end';manifest.releaseEvidence[1].revision='f'.repeat(40);
 assert.equal(workflowGroup(manifest,load).status,'failed');
 assert.equal(workflowGroup(manifest,load,{adviceOnly:true}).closure.status,'blocked');
 manifest.releaseEvidence[1].revision=source.revision;manifest.releaseEvidence[1].observedStatus='failed';
 assert.equal(workflowGroup(manifest,load,{adviceOnly:true}).closure.next.phase,'production-runtime');
 assert.equal(workflowGroup(manifest,load).status,'failed');
});

test('closure exposes missing phases before release and keeps legacy progress unknown without page scans',()=>{
 const group=groupFixture();group.left.manifest.expected.push('integration');
 const reads=[];const load=ref=>{const row=group.load(ref);return {...row,read:file=>{reads.push(file);return row.read(file);}};};
 const advice=workflowGroup(group.manifest,load,{adviceOnly:true});
 assert.equal(advice.closure.next.phase,'integration');assert.equal(advice.closure.next.memberId,'left');
 assert.equal(advice.closure.next.evidenceDigest,null);
 assert(reads.every(file=>file==='recommendations.json'));
 const prior=JSON.parse(group.left.files.get('recommendations.json'));delete prior.progress;
 const bytes=JSON.stringify(prior);group.left.files.set('recommendations.json',bytes);
 group.left.manifest.archive.recommendations.digest=hash(bytes);
 assert.equal(workflowGroup(group.manifest,group.load,{adviceOnly:true}).closure.next.phase,'checks');
});

test('explicit dependencies select available upstream work and preserve undeclared legacy coverage', () => {
  const group = groupFixture(); group.left.manifest.expected.push('integration');
  const legacy = workflowGroup(group.manifest, group.load, { adviceOnly: true });
  assert.equal(legacy.closure.dependencyCoverage, 'undeclared');
  const edge = { before: { memberId: 'left', phase: 'integration' }, after: { memberId: 'right', phase: 'checks' } };
  group.manifest.execution = { version: 1, checkoutLimit: 2, dependencies: { version: 1, edges: [edge] } };
  const closure = workflowGroup(group.manifest, group.load, { adviceOnly: true }).closure;
  assert.equal(closure.dependencyCoverage, 'declared');
  assert.equal(closure.next.memberId, 'left'); assert.equal(closure.next.phase, 'integration');
  assert(closure.blocked.some(row => row.memberId === 'right' && row.phase === 'checks'));
  assert(closure.alreadySatisfied.some(row => row.memberId === 'left' && row.phase === 'checks'));
  assert(!closure.eligible.some(row => row.phase === 'production-deployment'));
  assert.equal(closure.authorizesEffects, false);
  const members = group.manifest.members.map(ref => ({ ref, child: group.load(ref).manifest }));
  const validate = edges => validateWorkflowExecution({ ...group.manifest.execution, dependencies: { version: 1, edges } }, members);
  assert.throws(() => validate([edge, edge]), /dependency-duplicate/);
  assert.throws(() => validate([edge, { before: edge.after, after: edge.before }]), /dependency-cycle/);
  assert.throws(() => validate([{ ...edge, before: { memberId: 'absent', phase: 'checks' } }]), /dependency-endpoint/);
  assert.throws(() => validate([{ ...edge, after: { memberId: 'right', phase: 'invented' } }]), /dependency-endpoint/);
  assert.throws(() => validateWorkflowExecution({ ...group.manifest.execution, checkoutLimit: 33 }, members), /execution-contract/);
  assert.throws(() => validateWorkflowExecution(undefined, members, group.manifest.execution), /execution-downgrade/);
});

function readinessFixture() {
  const group = groupFixture(), participants = [];
  for (const ref of group.manifest.members) {
    const value = group.load(ref), child = value.manifest;
    child.expected = ['preparation', 'checks', 'ci', 'integration']; child.traces = [];
    for (const role of ['writer', 'reviewer']) {
      const traceId = `${ref.id}-${role}`, run = { ...nativeTrace(), runId: traceId, status: 'completed' };
      const file = `${traceId}.json`, bytes = JSON.stringify(run); value.files.set(file, bytes);
      child.traces.push({ id: traceId, phase: 'preparation', file, digest: hash(bytes) });
      participants.push({ memberId: ref.id, traceId, role });
    }
    const captured = buildArchive(child, value.read, receiptClock(value.files));
    for (const [file, bytes] of captured.files) value.files.set(file, bytes);
    child.archive = captured.archive; ref.digest = hash(JSON.stringify(child));
  }
  group.manifest.execution = { version: 1, checkoutLimit: 2, dependencies: { version: 1, edges: [] },
    readiness: { version: 1, participants } };
  const members = () => group.manifest.members.map(ref => {
    const value = group.load(ref);
    return { ref, child: value.manifest, read: value.read, advice: readArchive(value.manifest, value.read, { adviceOnly: true }) };
  });
  const decisions = () => workflowEligibility(group.manifest, members());
  const change = (memberId, role, mutate) => {
    const value = group.load({ id: memberId }), trace = value.manifest.traces.find(row => row.id === `${memberId}-${role}`);
    const run = JSON.parse(value.files.get(trace.file)); mutate(run);
    const bytes = JSON.stringify(run); value.files.set(trace.file, bytes); trace.digest = hash(bytes);
  };
  return { ...group, members, decisions, change };
}

test('readiness accepts complete source-current cooperative handoffs without granting release authority', () => {
  const group = readinessFixture(), result = group.decisions();
  assert.equal(result.readinessCoverage, 'declared-participants'); assert.equal(result.authority, false);
  assert(result.actions.filter(row => ['checks', 'ci'].includes(row.phase)).every(row => row.blockers.length === 0));
  const closure = workflowGroup(group.manifest, group.load, { adviceOnly: true }).closure;
  assert.equal(closure.authorizesEffects, false); assert.equal(closure.authorityVerified, false);
  delete group.manifest.execution.readiness;
  assert.equal(group.decisions().readinessCoverage, 'undeclared');
});

test('readiness blocks incomplete or unsuccessful handoffs while independent member work stays eligible', () => {
  const cases = [
    ['running run', run => { run.status = 'running'; }],
    ['failed run', run => { run.status = 'failed'; }],
    ['missing terminal run status', run => { delete run.status; }],
    ['running child', run => { run.spans[1].status = 'running'; }],
    ['failed child', run => { run.spans[1].status = 'failed'; }],
    ['cancelled child', run => { run.spans[1].status = 'cancelled'; }],
    ['skipped child', run => { run.spans[1].status = 'skipped'; }],
    ['reused child', run => { run.spans[1].status = 'reused'; }],
    ['pending evaluation', run => { run.spans[1].evaluation.status = 'pending'; }],
    ['failed evaluation', run => { run.spans[1].evaluation.status = 'failed'; }],
    ['partial page', run => { run.coverage.partial = true; }],
    ['partial source', run => { run.coverage.sourcePartial = true; }],
    ['truncated run', run => { run.traceTruncated = true; }],
    ['dropped spans', run => { run.coverage.droppedEvents = 1; }],
    ['missing expected span', run => { run.coverage.expectedSpans = 3; }],
    ['unretained page', run => { run.page.total = 3; }],
    ['noninitial page', run => { run.page.offset = 2; run.page.total = 4; }],
    ['empty run', run => { run.spans = []; run.page.total = 0; }],
  ];
  for (const [label, mutate] of cases) {
    const group = readinessFixture(); group.change('left', 'reviewer', mutate);
    const result = group.decisions();
    for (const phase of ['checks', 'ci']) {
      const action = result.actions.find(row => row.memberId === 'left' && row.phase === phase);
      assert(action.blockers.some(row => row.participant === 'left-reviewer'), label);
      assert.equal(action.eligibility, 'dependency-blocked', label);
    }
    assert.equal(result.actions.find(row => row.memberId === 'right' && row.phase === 'ci').eligibility, 'eligible', label);
    assert.equal(result.actions.find(row => row.memberId === 'left' && row.phase === 'preparation').eligibility, 'eligible', label);
  }
});

test('readiness reparses raw enrolled traces instead of trusting archived positive advice', () => {
  const group = readinessFixture(), archived = group.left.manifest.archive;
  assert.equal(readArchive(group.left.manifest, group.left.read, { adviceOnly: true }).progress.find(row => row.id === 'checks').status, 'completed');
  group.left.manifest.traces = [];
  const blockers = group.decisions().actions.find(row => row.memberId === 'left' && row.phase === 'checks').blockers;
  assert.deepEqual(blockers.map(row => row.participant).sort(), ['left-reviewer', 'left-writer']);
  assert.equal(group.left.manifest.archive, archived);
  const wrongPhase = readinessFixture(); wrongPhase.left.manifest.traces[0].phase = 'checks';
  assert(wrongPhase.decisions().actions.find(row => row.memberId === 'left' && row.phase === 'ci')
    .blockers.some(row => row.participant === 'left-writer'));
  const tampered = readinessFixture(); tampered.left.files.set('left-writer.json', '{}');
  assert.throws(() => tampered.decisions(), /trace-digest/);
  for (const mutate of [run => { run.candidate.revision = 'f'.repeat(40); },
    run => { run.context.plan.revision = 'f'.repeat(40); },
    run => { run.context.plan.repository = 'github.com/other/project'; }]) {
    const stale = readinessFixture(); stale.change('left', 'writer', mutate);
    assert.throws(() => stale.decisions(), /trace-binding/);
  }
});

test('readiness enrollment requires distinct roles for every member and cannot shrink across successors', () => {
  const group = readinessFixture(), original = group.manifest.execution, members = group.members();
  const validate = participants => validateWorkflowExecution({ ...original,
    readiness: { version: 1, participants } }, members);
  const rows = original.readiness.participants;
  assert.throws(() => validate(rows.filter(row => row.memberId !== 'right')), /readiness-coverage/);
  assert.throws(() => validate(rows.map(row => row.traceId === 'left-reviewer' ? { ...row, traceId: 'left-writer' } : row)), /readiness-participant/);
  assert.throws(() => validate([...rows, { memberId: 'absent', traceId: 'extra', role: 'writer' }]), /readiness-participant/);
  assert.throws(() => validate(rows.map(row => row.role === 'reviewer' ? { ...row, role: 'unknown' } : row)), /readiness-participant/);
  const { readiness, ...withoutReadiness } = original;
  assert.throws(() => validateWorkflowExecution(withoutReadiness, members, original), /readiness-relaxation/);
  const replacement = { ...original, readiness: { version: 1, participants: rows.map(row =>
    row.traceId === 'left-reviewer' ? { ...row, traceId: 'replacement-reviewer' } : row) } };
  assert.throws(() => validateWorkflowExecution(replacement, members, original), /readiness-relaxation/);
  const added = { ...original, readiness: { version: 1, participants: [...rows,
    { memberId: 'left', traceId: 'additional-reviewer', role: 'reviewer' }] } };
  assert.equal(validateWorkflowExecution(added, members, original), added);
});

test('readiness blockers propagate through old green prerequisite receipts', () => {
  const group = readinessFixture(); group.change('left', 'writer', run => { run.status = 'running'; });
  group.manifest.execution.dependencies.edges = [{ before: { memberId: 'left', phase: 'checks' },
    after: { memberId: 'right', phase: 'ci' } }];
  const actions = group.decisions().actions;
  assert.equal(actions.find(row => row.memberId === 'left' && row.phase === 'checks').status, 'completed');
  assert.equal(actions.find(row => row.memberId === 'right' && row.phase === 'ci').eligibility, 'dependency-blocked');
});

test('readiness closure prioritizes eligible upstream work and retains original order for ties', () => {
  const group = readinessFixture(), closure = () => workflowGroup(group.manifest, group.load, { adviceOnly: true }).closure;
  assert.equal(closure().next.memberId, 'left'); assert.equal(closure().next.phase, 'preparation');
  group.manifest.execution.dependencies.edges = [
    { before: { memberId: 'right', phase: 'preparation' }, after: { memberId: 'left', phase: 'ci' } },
    { before: { memberId: 'left', phase: 'ci' }, after: { memberId: 'right', phase: 'integration' } },
  ];
  const result = closure();
  assert.equal(result.next.memberId, 'right'); assert.equal(result.next.phase, 'preparation');
  assert.equal(result.next.unblocks, 2);
  assert(result.eligible.some(row => row.memberId === 'left' && row.phase === 'preparation'));
  assert(result.blocked.some(row => row.memberId === 'left' && row.phase === 'ci'));
});

function storeReadinessTrace(value, id, run) {
  const file = `${id}.json`, bytes = JSON.stringify(run);
  value.files.set(file, bytes);
  const ref = value.manifest.traces.find(row => row.id === id);
  if (ref) ref.digest = hash(bytes);
  else value.manifest.traces.push({ id, phase: 'preparation', file, digest: hash(bytes) });
}

function paginatedReadinessFixture() {
  const group = readinessFixture(), value = group.left;
  const run = JSON.parse(value.files.get('left-writer.json'));
  const spans = [...run.spans, ...Array.from({ length: 32 }, (_, index) => ({
    spanId: `work-${index}`, parentSpanId: 'root', kind: 'tool', operation: 'edit',
    status: 'completed', startedAt: 110, durationMs: 1,
  }))];
  for (const offset of [0, 32]) storeReadinessTrace(value, offset === 0 ? 'left-writer' : 'left-writer-page-32', {
    ...run, page: { offset, total: spans.length }, spans: spans.slice(offset, offset + 32),
    coverage: { partial: false, sourcePartial: false, expectedSpans: spans.length, droppedEvents: 0 },
  });
  return group;
}

test('readiness ignores unrelated unresolved parents while preserving participant coverage', () => {
  const group = readinessFixture(), unrelated = { ...nativeTrace(), runId: 'unrelated-run', status: 'completed' };
  unrelated.spans[1].parentSpanId = 'unretained-parent';
  storeReadinessTrace(group.left, 'unrelated-trace', unrelated);
  const captured = buildArchive(group.left.manifest, group.left.read, receiptClock(group.left.files));
  assert.equal(captured.archive.coverage.partial, true);
  assert.equal(captured.archive.coverage.unresolvedParents.length, 1);
  assert(group.decisions().actions.filter(row => row.memberId === 'left' && ['checks', 'ci'].includes(row.phase))
    .every(row => row.blockers.length === 0));
});

test('readiness accepts fully retained multiple pages including parents on an earlier page', () => {
  const group = paginatedReadinessFixture();
  const first = JSON.parse(group.left.files.get('left-writer.json'));
  const last = JSON.parse(group.left.files.get('left-writer-page-32.json'));
  assert.equal(first.spans.length, 32); assert.equal(last.spans.length, 2);
  assert.equal(last.spans[0].parentSpanId, first.spans[0].spanId);
  assert(group.decisions().actions.filter(row => row.memberId === 'left' && ['checks', 'ci'].includes(row.phase))
    .every(row => row.blockers.length === 0));
});

test('readiness rejects missing overlapping or unsuccessful later handoff pages', () => {
  const changes = [
    ['missing page', group => { group.left.manifest.traces = group.left.manifest.traces.filter(row => row.id !== 'left-writer-page-32'); }],
    ['overlapping page', (_group, page) => { page.page.offset = 31; }],
    ['failed later page', (_group, page) => { page.status = 'failed'; }],
    ['running later span', (_group, page) => { page.spans[0].status = 'running'; }],
    ['partial later source', (_group, page) => { page.coverage.sourcePartial = true; }],
    ['partial later coverage', (_group, page) => { page.coverage.partial = true; }],
    ['missing later coverage', (_group, page) => { delete page.coverage; }],
  ];
  for (const [label, change] of changes) {
    const group = paginatedReadinessFixture(), page = JSON.parse(group.left.files.get('left-writer-page-32.json'));
    change(group, page);
    if (group.left.manifest.traces.some(row => row.id === 'left-writer-page-32'))
      storeReadinessTrace(group.left, 'left-writer-page-32', page);
    const action = group.decisions().actions.find(row => row.memberId === 'left' && row.phase === 'ci');
    assert(action.blockers.some(row => row.participant === 'left-writer'), label);
    assert(!action.blockers.some(row => row.participant === 'left-reviewer'), label);
  }
});

test('readiness cannot reuse two pages of one run as separate writer and reviewer handoffs', () => {
  const group = paginatedReadinessFixture();
  group.manifest.execution.readiness.participants.find(row => row.memberId === 'left' && row.role === 'reviewer')
    .traceId = 'left-writer-page-32';
  const action = group.decisions().actions.find(row => row.memberId === 'left' && row.phase === 'ci');
  assert.deepEqual(action.blockers.map(row => row.participant).sort(), ['left-writer', 'left-writer-page-32']);
});
