import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {createAgentRunClient} from '../runtime/agents/invocation.js';
import {request} from './agents/workflow-fixture.mjs';

test('authenticated run redirects never forward a body or credential, and retain uncertain writes', async t => {
  const observed=[];
  const server=createServer((req,res)=>{
    observed.push({url:req.url,authorization:req.headers.authorization});
    if(req.url.startsWith('/target')){res.end('{}');return;}
    const status=Number(req.url.split('/')[1]);
    res.writeHead(status,{location:'/target','content-type':'application/json'});res.end('{}');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const status of [301,302,303,307,308]){
    const client=createAgentRunClient({endpoint:`${origin}/${status}/`,getHeaders:()=>({authorization:'Bearer fixture-private'})});
    await assert.rejects(client.invoke('start',request),{reasonCode:'run_transport_failed',writeResultUnknown:true});
    await assert.rejects(client.invoke('status',{runId:request.runId}),{writeResultUnknown:false});
  }
  assert.equal(observed.length,10);
  assert(observed.every(item=>!item.url.startsWith('/target')&&item.authorization==='Bearer fixture-private'));
});

test('an opaque browser redirect cannot masquerade as a completed operation',async()=>{
  const client=createAgentRunClient({endpoint:'https://runtime.example/',fetchImpl:async()=>({type:'opaqueredirect',status:0})});
  await assert.rejects(client.invoke('start',request),{reasonCode:'run_transport_failed',writeResultUnknown:true});
});
