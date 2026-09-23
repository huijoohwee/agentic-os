import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runRepositoryValidation, validationArguments, validationPlanReceipt } from '../bin/agentic-os-validation.mjs';
import { selectValidationChecks } from '../bin/agentic-os-validation-policy.mjs';
import { hash, LIMITS } from '../bin/agentic-os-test-inputs.mjs';
import { executeCommand, previousCheck, writeCheck, receiptDirectory, COMMAND_PROGRESS_INTERVAL_MS } from '../bin/agentic-os-test-receipt.mjs';

function fixture(t) {
  const keys = ['CI','GITHUB_ACTIONS','GITHUB_EVENT_PATH','GITHUB_EVENT_NAME','GITHUB_SHA','AGENTIC_OS_VALIDATION_ACTIVE'];
  const saved = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  keys.forEach(key => { delete process.env[key]; });
  t.after(() => keys.forEach(key => {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }));
  const root = mkdtempSync(join(tmpdir(), 'validation-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Validation Test');
  git('remote', 'add', 'origin', 'https://github.com/example/consumer.git');
  mkdirSync(join(root, 'source')); mkdirSync(join(root, 'checks'));
  writeFileSync(join(root, '.gitignore'), '.cache/\n');
  writeFileSync(join(root, 'source/a.txt'), 'pass'); writeFileSync(join(root, 'source/b.txt'), 'pass');
  writeFileSync(join(root, 'checks/run.mjs'), `import {mkdirSync,appendFileSync,readFileSync,writeFileSync} from 'node:fs';
const id=process.argv[2]; mkdirSync('.cache',{recursive:true}); appendFileSync('.cache/calls',id+'\\n');
if(id==='a'&&readFileSync('source/a.txt','utf8')==='fail') process.exitCode=2;
if(id==='a'&&readFileSync('source/a.txt','utf8')==='mutate') writeFileSync('source/b.txt','changed during execution');
console.log('checked '+id);\n`);
  const check = (id, inputs, requires = []) => ({id,command:['node','checks/run.mjs',id],inputs,requires,reuse:'local',timeoutMs:3000});
  const policy = {schema:'agentic-os/repository-validation-policy/v1',repository:'github.com/example/consumer',
    broadInputs:['config/'],always:['contract'],fallback:['fallback'],checks:[
      check('contract',['.gitignore']),check('prepare',['checks/run.mjs']),
      check('a',['source/a.txt'],['prepare']),check('b',['source/b.txt'],['prepare']),
      {...check('fallback',[]),reuse:'never'},
    ]};
  writeFileSync(join(root,'.agentic-os-validation.json'),JSON.stringify(policy));
  git('add','.');git('commit','-m','baseline');git('update-ref','refs/remotes/origin/main','HEAD');
  const messages=[], run=(...flags)=>runRepositoryValidation(['run',`--root=${root}`,...flags],{out:message=>messages.push(message)});
  const calls=()=>readFileSync(join(root,'.cache/calls'),'utf8').trim().split('\n');
  const receipt=()=>JSON.parse(readFileSync(join(root,'.git/agentic-os-tests/validation-last.json'),'utf8'));
  return {root,git,run,calls,receipt,messages};
}

test('real owner checks run once, reuse exact local inputs, and keep unrelated checks skipped', async t => {
  const f=fixture(t);writeFileSync(join(f.root,'source/a.txt'),'changed');
  assert.equal(await f.run(),0);assert.deepEqual(f.calls(),['contract','prepare','a']);
  const costs=()=>JSON.parse(readFileSync(join(f.root,'.git/agentic-os-tests/validation-economy.json'),'utf8'));
  const measured=costs();assert.equal(measured.checks.a.samples,1);
  assert.equal(await f.run(),0);assert.equal(f.calls().length,3);
  assert.deepEqual(costs(),measured);assert.equal(f.receipt().resources.estimatedMs,0);
  assert.ok(f.receipt().results.every(result=>result.reused));
  writeFileSync(join(f.root,'source/b.txt'),'unrelated change');
  assert.equal(await f.run(),0);assert.deepEqual(f.calls(),['contract','prepare','a','b']);
  assert.equal(f.receipt().outcome,'passed');assert.equal(f.receipt().authority,false);
  assert.equal(await f.run('--fresh'),0);assert.equal(f.calls().length,8);
  const count=f.calls().length;assert.equal(await f.run('--only=b','--fresh'),0);
  assert.deepEqual(f.calls().slice(count),['prepare','b']);assert.deepEqual(f.receipt().plan.partition,['b']);
});

test('unchanged deterministic failure stops without another command and remains failed evidence', async t => {
  const f=fixture(t);writeFileSync(join(f.root,'source/a.txt'),'fail');
  assert.equal(await f.run(),1);assert.equal(f.receipt().outcome,'failed');
  const before=f.calls();assert.equal(await f.run(),1);assert.deepEqual(f.calls(),before);
  assert.equal(f.receipt().outcome,'blocked');assert.match(f.receipt().error,/unchanged-failure:a/);
  assert.equal(await f.run('--fresh'),1);assert.ok(f.calls().length>before.length);
});

test('explicit failure retry reuses valid mandatory and prerequisite results without hiding failure', async t => {
  const f=fixture(t);writeFileSync(join(f.root,'source/a.txt'),'fail');
  assert.equal(await f.run(),1);assert.deepEqual(f.calls(),['contract','prepare','a']);
  const output=[];
  assert.equal(await runRepositoryValidation(['plan',`--root=${f.root}`,'--retry-failed'],{out:value=>output.push(value)}),0);
  const plan=JSON.parse(output[0]);
  assert.equal(plan.checks.find(check=>check.id==='contract').reuse,true);
  assert.equal(plan.checks.find(check=>check.id==='a').unchangedFailure,false);
  assert.equal(await f.run('--retry-failed'),1);assert.deepEqual(f.calls(),['contract','prepare','a','a']);
  assert.equal(f.receipt().outcome,'failed');
  assert.deepEqual(f.receipt().results.map(result=>[result.id,result.reused]),[['contract',true],['prepare',true],['a',false]]);
  const before=f.calls();assert.equal(await f.run(),1);assert.deepEqual(f.calls(),before);
  writeFileSync(join(f.root,'source/a.txt'),'repaired');
  assert.equal(await f.run('--retry-failed'),0);assert.deepEqual(f.calls().slice(before.length),['a']);
  assert.equal(f.receipt().authority,false);
});

test('failure retry preserves whole-plan identity and reruns invalidated success', async t => {
  const f=fixture(t), path=join(f.root,'.agentic-os-validation.json');
  const policy=JSON.parse(readFileSync(path,'utf8'));
  for (const check of policy.checks) { check.reuse='local-plan'; check.inputs=['*']; }
  writeFileSync(path,JSON.stringify(policy));f.git('add','.');f.git('commit','-m','plan-bound checks');
  f.git('update-ref','refs/remotes/origin/main','HEAD');
  writeFileSync(join(f.root,'source/a.txt'),'fail');
  assert.equal(await f.run(),1);const before=f.calls().length;
  assert.equal(await f.run('--retry-failed'),1);assert.deepEqual(f.calls().slice(before),['a']);
  f.git('add','.');f.git('commit','-m','changed exact candidate');
  const changed=f.calls().length;assert.equal(await f.run('--retry-failed'),1);
  assert.deepEqual(new Set(f.calls().slice(changed)),new Set(['contract','prepare','a']));
});

test('failure retry cannot request fresh execution simultaneously or override CI', async t => {
  assert.throws(()=>validationArguments(['run','--retry-failed','--fresh']),/without --fresh/);
  assert.throws(()=>validationArguments(['ci','--retry-failed']),/local run or plan/);
  assert.throws(()=>validationArguments(['run','--retry-failed','--retry-failed']),/duplicate/);
  const f=fixture(t);process.env.CI='true';
  await assert.rejects(()=>f.run('--retry-failed'),/local only; CI requires fresh/);
  assert.throws(f.calls,/ENOENT/);
});

test('whole-plan partitions join without rerunning passed commands, and explicit fresh still executes', async t => {
  const f=fixture(t), path=join(f.root,'.agentic-os-validation.json');
  const policy=JSON.parse(readFileSync(path,'utf8'));
  for (const check of policy.checks) { check.reuse='local-plan'; check.inputs=['*']; }
  writeFileSync(path,JSON.stringify(policy)); f.git('add','.'); f.git('commit','-m','declare deterministic plans');
  assert.equal(await f.run('--only=fallback'),0); assert.deepEqual(f.calls(),['fallback']);
  const validationTime=f.receipt().results[0].validatedAt;
  assert.equal(await f.run(),0); assert.deepEqual(f.calls(),['fallback','contract']);
  const reused=f.receipt().results.find(result=>result.id==='fallback');
  assert.equal(reused.reused,true); assert.equal(reused.validatedAt,validationTime);
  assert.equal(await f.run('--fresh'),0); assert.equal(f.calls().length,4);
  f.git('commit','--allow-empty','-m','different candidate');
  assert.equal(await f.run(),0); assert.equal(f.calls().length,6,'HEAD change invalidates whole-plan reuse');
});

test('source mutation during a passing command cannot publish a passing receipt', async t => {
  const f=fixture(t);writeFileSync(join(f.root,'source/a.txt'),'mutate');
  assert.equal(await f.run(),1);assert.equal(f.receipt().outcome,'blocked');
  assert.match(f.receipt().error,/input-drift/);
  assert.equal(f.receipt().results.some(result=>result.id==='a'),false);
});

test('plan does not execute and malformed owner identity is rejected before checks', async t => {
  const f=fixture(t), output=[];
  assert.equal(await runRepositoryValidation(['plan',`--root=${f.root}`],{out:value=>output.push(value)}),0);
  assert.equal(JSON.parse(output[0]).selectedChecks,1);
  assert.throws(f.calls,/ENOENT/);
  f.git('remote','set-url','origin','https://github.com/example/other.git');
  await assert.rejects(f.run,/repository-identity/);assert.throws(f.calls,/ENOENT/);
});

test('consumer logs retain a bounded tail without stopping successful verbose checks', async t => {
  const f=fixture(t);
  const result=await executeCommand(f.root,process.execPath,['-e',"process.stdout.write('é'.repeat(10000)+'\\nfinished\\n')"],
    {outputMode:'tail',outputBytes:1023,timeoutMs:3000});
  assert.equal(result.exitCode,0);assert.equal(result.reason,null);assert.equal(result.outputTruncated,true);
  assert.ok(Buffer.byteLength(result.output)<=1023);assert.match(result.output,/finished\n$/);
  const check={id:'consumer-tail',name:'tail',command:process.execPath,args:['-e','output'],fingerprint:'exact',stage:'owner-check',report:'exit'};
  const directory=receiptDirectory(f.root);writeCheck(directory,check,result);
  assert.equal(previousCheck(directory,check)?.outcome,'passed');
  const strict=await executeCommand(f.root,process.execPath,['-e',"process.stdout.write('x'.repeat(10000))"],
    {outputBytes:1023,timeoutMs:3000});
  assert.equal(strict.reason,'output-budget');
});

test('execution timeout and changed log bytes cannot become reusable success', async t => {
  const f=fixture(t);
  const timed=await executeCommand(f.root,process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:150});
  assert.equal(timed.reason,'timeout');
  const result=await executeCommand(f.root,process.execPath,['-e',"console.log('pass')"],{timeoutMs:3000});
  const check={id:'consumer-tamper',name:'tamper',command:process.execPath,args:['-e','pass'],fingerprint:'exact',stage:'owner-check',report:'exit'};
  const directory=receiptDirectory(f.root);writeCheck(directory,check,result);
  writeFileSync(join(directory,'consumer-tamper.log'),'different');
  assert.equal(previousCheck(directory,check),null);
});

test('long command progress is bounded, numeric and stops on completion without changing its result', async t => {
  const f=fixture(t), progress=[];
  t.mock.timers.enable({apis:['setInterval']});
  const pending=executeCommand(f.root,process.execPath,['-e',"console.log('retained child output')"],
    {timeoutMs:3000,onProgress:value=>progress.push(value)});
  t.mock.timers.tick(COMMAND_PROGRESS_INTERVAL_MS-1);assert.equal(progress.length,0);
  t.mock.timers.tick(1);assert.equal(progress.length,1);
  assert.deepEqual(Object.keys(progress[0]).sort(),['elapsedMs','observedOutputBytes','quietMs','timeoutMs']);
  assert.ok(Object.values(progress[0]).every(value=>Number.isFinite(value)&&value>=0));
  assert.equal(Object.isFrozen(progress[0]),true);
  const result=await pending;
  assert.equal(result.exitCode,0);assert.equal(result.reason,null);
  assert.equal(result.output,'retained child output\n');
  assert.equal(result.outputDigest,hash(Buffer.from(result.output)));
  t.mock.timers.tick(COMMAND_PROGRESS_INTERVAL_MS*3);assert.equal(progress.length,1);
});

test('failed progress reporting terminates the command and cannot become passing evidence', async t => {
  const f=fixture(t);
  t.mock.timers.enable({apis:['setInterval']});
  assert.throws(()=>executeCommand(f.root,process.execPath,[],{onProgress:true}),/progress-handler/);
  const pending=executeCommand(f.root,process.execPath,['-e','setInterval(()=>{},1000)'],
    {timeoutMs:3000,onProgress:()=>{throw new Error('reporter failed')}});
  t.mock.timers.tick(COMMAND_PROGRESS_INTERVAL_MS);
  const result=await pending;assert.equal(result.reason,'progress-handler-failed');
  t.mock.timers.tick(COMMAND_PROGRESS_INTERVAL_MS);
});

test('ordinary run in hosted CI verifies its event, executes fresh and refuses baseline overrides or dirt', async t => {
  const f=fixture(t), before=f.git('rev-parse','HEAD');
  writeFileSync(join(f.root,'source/a.txt'),'changed'); f.git('add','.');f.git('commit','-m','candidate');
  const after=f.git('rev-parse','HEAD');
  assert.equal(await f.run(),0);
  const event=join(f.root,'.git/event.json'); writeFileSync(event,JSON.stringify({before,after}));
  Object.assign(process.env,{CI:'true',GITHUB_ACTIONS:'true',GITHUB_EVENT_PATH:event,GITHUB_EVENT_NAME:'push',GITHUB_SHA:after});
  assert.equal(await f.run(),0); assert.equal(f.receipt().execution,'ci');
  assert.equal(f.receipt().checkout,'event-revision'); assert.ok(f.receipt().results.every(result=>!result.reused));
  const calls=f.calls().length; assert.equal(await f.run(),0); assert.equal(f.calls().length,calls+3);
  await assert.rejects(()=>f.run('--base=HEAD'),/CI owns/);
  writeFileSync(join(f.root,'source/a.txt'),'dirty');await assert.rejects(f.run,/dirty-ci/);
});

test('large generated changes execute fallback and retain bounded passing and failing receipts', async t => {
  const f=fixture(t), paths=Array.from({length:2934},(_,i)=>`generated/${String(i).padStart(4,'0')}-${'asset'.repeat(24)}.txt`);
  mkdirSync(join(f.root,'generated'));
  for (const path of paths) writeFileSync(join(f.root,path),'generated bytes');
  assert.equal(await f.run(),0);assert.deepEqual(f.calls(),['contract','fallback']);
  const receipt=f.receipt();assert.equal(receipt.outcome,'passed');assert.equal(receipt.authority,false);
  assert.equal(receipt.plan.changed.count,paths.length);
  assert.equal(receipt.plan.changed.digest,hash(JSON.stringify(paths)));
  assert.equal(receipt.plan.unmatchedPaths.count,paths.length);
  assert.equal(receipt.plan.changed.abbreviated,true);assert.equal(receipt.plan.changed.sample.length,8);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt,null,2)+'\n')<LIMITS.receiptBytes);
  const script=join(f.root,'checks/run.mjs');
  writeFileSync(script,readFileSync(script,'utf8')+"\nif(id==='fallback') process.exitCode=2;\n");
  assert.equal(await f.run('--fresh'),1);assert.equal(f.receipt().outcome,'failed');
  assert.equal(f.receipt().results.at(-1).exitCode,2);
});

test('receipt summaries bind unsampled paths and full reasons without changing selected checks', t => {
  const f=fixture(t), policy=JSON.parse(readFileSync(join(f.root,'.agentic-os-validation.json'),'utf8'));
  policy.checks.find(check=>check.id==='a').inputs=['generated/'];
  const paths=Array.from({length:3000},(_,i)=>`generated/${i}-${'x'.repeat(300)}`);
  const plan=selectValidationChecks(policy,paths), receipt=validationPlanReceipt(plan);
  assert.deepEqual(receipt.checks.map(check=>check.id),plan.checks.map(check=>check.id));
  assert.equal(receipt.checks.find(check=>check.id==='a').reasons.count,paths.length);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt,null,2))<LIMITS.receiptBytes);
  paths[2999]+='changed';const changed=validationPlanReceipt(selectValidationChecks(policy,paths));
  assert.deepEqual(receipt.changed.sample,changed.changed.sample);
  assert.notEqual(receipt.changed.digest,changed.changed.digest);assert.notEqual(receipt.digest,changed.digest);
});
