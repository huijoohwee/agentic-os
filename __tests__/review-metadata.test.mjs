import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { validateReviewMetadata } from '../bin/agentic-os-review-body.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'review-metadata-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const run=(...args)=>git(args,{cwd:root}),ref='agent/device/metadata';
  run('init','-b',ref);run('config','user.name','Fixture');run('config','user.email','fixture@example.invalid');
  run('remote','add','origin','https://github.com/example/consumer.git');
  writeFileSync(join(root,'body-check.mjs'),`import {readFileSync,writeFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8'));writeFileSync('.git/body-input.json',JSON.stringify(input));
if(input.body.includes('INVALID'))process.exitCode=1;`);
  writeFileSync(join(root,'.agentic-os-validation.json'),JSON.stringify({schema:'agentic-os/repository-validation-policy/v1',
    repository:'github.com/example/consumer',reviewBodyCheck:'body-check.mjs',broadInputs:[],always:[],fallback:['source'],
    checks:[{id:'source',command:['node','never-execute-source.mjs'],inputs:['*'],requires:[],reuse:'never',timeoutMs:1000}]}));
  run('add','.');run('commit','-m','fixture');const head=run('rev-parse','HEAD');
  const event={action:'edited',changes:{body:{from:'previous'}},repository:{full_name:'example/consumer'},pull_request:{number:1,
    head:{sha:head,ref},base:{sha:head},title:'Reviewed title',body:`Authored body\nLane: ${ref}\nSource-Head: ${head}`}};
  const eventPath=join(root,'.git/event.json'),environment={...process.env,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request',
    GITHUB_EVENT_PATH:eventPath,GITHUB_SHA:head};
  const save=()=>writeFileSync(eventPath,JSON.stringify(event));
  const validate=()=>{save();return validateReviewMetadata(root,environment);};
  return {root,event,environment,save,validate};
}
test('ordinary description edits run only the existing body owner through the shared CLI',t=>{
  const f=fixture(t);f.save();
  const cli=fileURLToPath(new URL('../bin/agentic-os-review-body.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[cli,'metadata'],{cwd:f.root,env:f.environment,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const receipt=JSON.parse(result.stdout);assert.equal(receipt.authority,false);
  assert.equal(receipt.sourceValidation,'not-executed');assert.deepEqual(receipt.changed,['body']);
  assert.equal(JSON.parse(readFileSync(join(f.root,'.git/body-input.json'),'utf8')).body,f.event.pull_request.body);
  f.event.changes={title:{from:'Old title'}};assert.equal(f.validate().outcome,'passed');
});
test('base changes, unknown changes and source events never take the metadata path',t=>{
  const f=fixture(t);
  for(const changes of [{base:{ref:{from:'main'}}},{body:{from:'old'},head:{from:'old'}},{},[]]){
    f.event.changes=changes;assert.throws(f.validate,/source-validation-required/);
  }
  f.event.changes={body:{from:'old'}};f.event.action='synchronize';assert.throws(f.validate,/source-validation-required/);
});
test('invalid body, duplicate identity, wrong checkout and repository fail closed',t=>{
  const f=fixture(t),original=f.event.pull_request.body;
  f.event.pull_request.body+='\nINVALID';assert.throws(f.validate,{reason:'blocked-review-body-invalid'});
  f.event.pull_request.body=original+'\nSource-Head: '+f.event.pull_request.head.sha;assert.throws(f.validate,/review-identity/);
  f.event.pull_request.body=original;f.environment.GITHUB_SHA='0'.repeat(40);assert.throws(f.validate,/ci-checkout/);
  f.environment.GITHUB_SHA=f.event.pull_request.head.sha;f.event.repository.full_name='other/repo';assert.throws(f.validate,/identity/);
});
