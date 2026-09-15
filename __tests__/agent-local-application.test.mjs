import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {startLocalAgentHost} from '../runtime/agents/local-host.js';
import {createAgentSwarmSqliteStore} from '../runtime/agents/sqlite-store.js';
import {fixture,request,context} from './agents/workflow-fixture.mjs';

async function setup(t, application) {
  const directory=mkdtempSync(join(tmpdir(),'local-app-'));
  const stateStore=await createAgentSwarmSqliteStore({directory});
  const runtime=fixture({stateStore,now:Date.now,taskTimeoutMs:500,taskLeaseMs:1000});
  const host=await startLocalAgentHost({runtime,stateStore,authenticate:()=>null,
    resolveContext:()=>context,application:application(runtime)});
  t.after(async()=>{await host.close();stateStore.close();rmSync(directory,{recursive:true,force:true});});
  return {host,runtime,origin:new URL(host.endpoint).origin};
}
const profile=fetch=>({prefix:'/commerce',maxInputBytes:1024,maxOutputBytes:4096,fetch});

test('one bounded application uses its own session admission and the existing durable worker',async t=>{
  let calls=0;
  const {host,runtime,origin}=await setup(t,runtime=>profile(async req=>{
    calls++;
    if(req.headers.get('cookie')!=='session=valid')return Response.json({code:'unauthorized'},{status:401});
    assert.equal(req.headers.get('origin'),origin);
    const body=await req.json();assert.deepEqual(body,{title:'Mug'});
    return Response.json(await runtime.start(request,context),{status:202,headers:{'set-cookie':'session=valid; HttpOnly'}});
  }));
  const send=(body,headers={})=>fetch(origin+'/commerce/run',{method:'POST',body:JSON.stringify(body),
    headers:{'content-type':'application/json',origin,...headers}});
  assert.equal((await send({title:'Mug'})).status,401);
  const accepted=await send({title:'Mug'},{cookie:'session=valid'});
  assert.equal(accepted.status,202);assert.match(accepted.headers.get('set-cookie'),/HttpOnly/);
  for(let n=0;n<100&&(await runtime.status(request.runId,context)).status!=='completed';n++)await pause(20);
  assert.equal((await runtime.status(request.runId,context)).status,'completed');
  assert.equal((await send({title:'Mug'},{cookie:'session=valid'})).status,202);
  assert.equal((await fetch(host.endpoint+'status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  const before=calls;
  assert.equal((await send({title:'Mug'},{origin:'https://foreign.example'})).status,403);
  assert.equal((await fetch(origin+'/commerce-foreign')).status,404);assert.equal(calls,before);
});

test('application body, encoding and output caps reject before oversized content escapes',async t=>{
  let calls=0;
  const {origin}=await setup(t,()=>profile(async()=>{calls++;return new Response('x'.repeat(4097));}));
  assert.equal((await fetch(origin+'/commerce',{method:'POST',body:'x'.repeat(1025)})).status,413);
  assert.equal((await fetch(origin+'/commerce',{method:'POST',headers:{'content-encoding':'gzip'},body:'{}'})).status,415);
  assert.equal(calls,0);
  const res=await fetch(origin+'/commerce');assert.equal(res.status,500);
  assert.equal((await res.json()).code,'application_response_too_large');
});

test('shutdown aborts a pending application and releases its HTTP listener',async t=>{
  let entered,signal;const ready=new Promise(resolve=>{entered=resolve;});
  const {host,origin}=await setup(t,()=>profile(req=>{signal=req.signal;entered();return new Promise(()=>{});}));
  const pending=fetch(origin+'/commerce').catch(()=>null);await ready;await host.close();await pending;
  assert.equal(signal.aborted,true);assert.equal(host.stats().listening,false);
});
