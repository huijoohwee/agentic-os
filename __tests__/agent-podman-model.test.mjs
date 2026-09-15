import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,realpathSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createPodmanModelCommand,createPodmanModelVerifier} from '../runtime/adapters/podman-containment-verifier.js';

function setup(t){
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'model-verify-')));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const modelPath=join(directory,'model.gguf'),apiKeyPath=join(directory,'key');
  writeFileSync(modelPath,'fixture model',{mode:0o600});writeFileSync(apiKeyPath,'a'.repeat(64)+'\n',{mode:0o600});
  const modelSha256=createHash('sha256').update('fixture model').digest('hex'),imageDigest='sha256:'+'b'.repeat(64),containerId='c'.repeat(64);
  const item={Id:containerId,Path:'/app/llama-server',State:{Running:true,Paused:false},ImageDigest:imageDigest,
    Config:{Image:'registry.example/server@'+imageDigest,Cmd:createPodmanModelCommand({modelSha256})},
    EffectiveCaps:[],BoundingCaps:[],HostConfig:{CapAdd:[],ReadonlyRootfs:true,Privileged:false,PublishAllPorts:false,
      SecurityOpt:['no-new-privileges'],PidMode:'private',IpcMode:'private',NetworkMode:'bridge',Memory:1536*1024*1024,NanoCpus:2e9,PidsLimit:128,
      PortBindings:{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'18765'}]}},
    Mounts:[{Type:'bind',Source:modelPath,Destination:'/models/model.gguf',RW:false},
      {Type:'bind',Source:apiKeyPath,Destination:'/run/model-key',RW:false}]};
  const options={modelPath,modelSha256,apiKeyPath,imageDigest,containerId,endpoint:'http://127.0.0.1:18765/v1/chat/completions'};
  let calls=0,processStatus=['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].map(key=>key+':\t0000000000000000').join('\n');
  const verifier=createPodmanModelVerifier({...options,runPodman:async(args,{signal})=>{
    assert.equal(signal.aborted,false);calls++;
    if(args[0]==='exec'){assert.deepEqual(args,['exec',containerId,'cat','/proc/1/status']);
      return {stdout:processStatus};}
    assert.deepEqual(args,['container','inspect',containerId]);return {stdout:JSON.stringify([item])};}});
  return {directory,item,options,verifier,calls:()=>calls,setProcessStatus:value=>{processStatus=value;}};
}

test('current bytes and pinned running container produce a redacted host observation',async t=>{
  const {verifier,options,calls}=setup(t);const observation=await verifier.verifyArtifacts();
  assert.equal(observation.verified,true);assert.equal(observation.modelSha256,options.modelSha256);
  assert.equal(observation.authority,false);assert.equal(calls(),2);
  assert.equal(JSON.stringify(observation).includes(options.apiKeyPath),false);
  assert.deepEqual(await verifier.getHeaders(),{authorization:'Bearer '+'a'.repeat(64)});
});

test('changed model, writable secrets and symlink substitutions fail before container acceptance',async t=>{
  const {verifier,options,directory,calls}=setup(t);
  writeFileSync(options.modelPath,'different model');await assert.rejects(verifier.verifyArtifacts);assert.equal(calls(),0);
  writeFileSync(options.modelPath,'fixture model');chmodSync(options.apiKeyPath,0o644);await assert.rejects(verifier.verifyArtifacts);
  chmodSync(options.apiKeyPath,0o600);rmSync(options.modelPath);symlinkSync(join(directory,'key'),options.modelPath);
  await assert.rejects(verifier.verifyArtifacts);assert.equal(calls(),0);
});

for(const [name,mutate] of [
  ['wrong image',x=>{x.ImageDigest='sha256:'+'d'.repeat(64);}],
  ['stopped container',x=>{x.State.Running=false;}],
  ['different executable',x=>{x.Path='/bin/sh';}],
  ['different model arguments',x=>{x.Config.Cmd=['--model','/other.gguf'];}],
  ['public binding',x=>{x.HostConfig.PortBindings['8080/tcp'][0].HostIp='0.0.0.0';}],
  ['additional mount',x=>{x.Mounts.push({Type:'bind',Source:'/',Destination:'/host',RW:false});}],
  ['writable model mount',x=>{x.Mounts[0].RW=true;}],
  ['unbounded resources',x=>{x.HostConfig.Memory=0;}],
  ['extra privilege',x=>{x.HostConfig.CapAdd=['CAP_SYS_ADMIN'];}],
])test(name+' is refused',async t=>{const {item,verifier}=setup(t);mutate(item);await assert.rejects(verifier.verifyArtifacts);});

test('already-aborted verification cannot invoke the container adapter',async t=>{
  const {verifier,calls}=setup(t);await assert.rejects(()=>verifier.verifyArtifacts({signal:AbortSignal.abort()}));assert.equal(calls(),0);
});

test('named pipes are refused without waiting for a writer', {timeout:2000}, async t=>{
  const {verifier,options,calls}=setup(t);
  rmSync(options.modelPath);execFileSync('mkfifo',[options.modelPath]);
  await assert.rejects(verifier.verifyArtifacts);assert.equal(calls(),0);
});

test('actual process capability readback must contain every zero capability field',async t=>{
  const {verifier,setProcessStatus}=setup(t);
  setProcessStatus('CapEff:\t0000000000000000');await assert.rejects(verifier.verifyArtifacts);
  setProcessStatus(['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].map(key=>key+':\t0000000000000001').join('\n'));
  await assert.rejects(verifier.verifyArtifacts);
});
