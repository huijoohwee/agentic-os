import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildArchive, readArchive, receiptClock } from '../bin/agentic-os-workflow-archive.mjs';
import { toolArguments } from '../src/mcp-server.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const source = { repository:'github.com/example/project', revision:'a'.repeat(40), tree:'b'.repeat(40) };
function fixture(count=70, trace) {
  const files=new Map();
  const checks={schema:'agentic-os/validation-observation/v1',authority:false,source,status:'passed',startedAt:100,finishedAt:200,
    stages:Array.from({length:count},(_,i)=>({id:`check-${i}`,status:'passed',elapsedMs:1})),
    feedback:{authority:false,ranking:[{id:'expensive-check',meanMs:5000,samples:3,failureRate:0}]}};
  const bytes=JSON.stringify(checks); files.set('checks.json',bytes);
  const manifest={schema:'agentic-os/workflow-observation-input/v1',id:'complete-worktree',source,expected:['checks'],
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
 assert.equal(row.timing.startOffsetMs,null);assert.equal(row.timing.inclusiveMs,80);
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
