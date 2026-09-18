import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectWorkflow, startWorkflow, readWorkflowManifestPage, WORKFLOW_PHASES } from '../bin/agentic-os-workflow.mjs';

test('one selected workflow retains multiple worktrees through idempotent start/end boundaries', t => {
  const base=realpathSync(mkdtempSync(join(tmpdir(),'workflow-boundaries-'))),root=join(base,'repo');mkdirSync(root);
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  const planningPath='native-prd-tad-adr-mvp-gtm.md';writeFileSync(join(root,planningPath),'# Native plan\n');
  git('add','.');git('-c','commit.gpgsign=false','commit','-m','source');
  const repository='github.com/example/native',revision=git('rev-parse','HEAD');
  const startArgs={revision,planningPath,worktreeId:'first'};
  const first=startWorkflow(root,repository,startArgs),bytes=readFileSync(first.manifest,'utf8'),manifest=JSON.parse(bytes);
  assert.equal(first.boundary,'start');assert.equal(first.selected,true);
  assert.deepEqual(manifest.codebaseIndex,{owner:'agentic-graph',storage:'browser-workspace',authority:false,
    path:`/.workspace/${manifest.id}/codebase-index.ref.json`});
  assert.equal(git('config','--local','--get','agentic-os.workflowManifest'),first.manifest);
  assert.equal(startWorkflow(root,repository,startArgs).manifest,first.manifest);
  const input=join(base,'input.json'),collect=value=>{writeFileSync(input,JSON.stringify(value));return collectWorkflow(root,repository,input);};
  const second=collect({schema:'agentic-os/workflow-observation-input/v1',id:'second',source:manifest.source,
    context:{workflowId:manifest.id,worktreeId:'second'},expected:WORKFLOW_PHASES,phases:[]});
  const workspace=join(base,'.workspace');
  const endInput={...manifest,boundary:'end',previous:{file:first.manifest,digest:first.digest},
    members:[...manifest.members.map(ref=>({...ref,file:resolve(workspace,ref.file)})),{id:'second',file:second.manifest,digest:second.digest}]};
  const end=collect(endInput),endBytes=readFileSync(end.manifest,'utf8'),ended=JSON.parse(endBytes);
  assert.equal(end.sequence,2);assert.equal(end.members,2);assert.equal(end.boundary,'end');
  assert.deepEqual(ended.codebaseIndex,manifest.codebaseIndex);
  assert.equal(ended.previous.digest,first.digest);assert.equal(readFileSync(first.manifest,'utf8'),bytes);
  assert.equal(git('config','--get','agentic-os.workflowManifest'),end.manifest);
  assert.equal(collect(endInput).manifest,end.manifest);assert.equal(collect(endInput).reused,true);
  const observation=readWorkflowManifestPage(root,endBytes);
  assert.equal(observation.profile.workflow.boundary,'end');assert.equal(observation.profile.workflow.members.length,2);
  assert.notEqual(observation.status,'completed');assert.equal(observation.profile.workflow.receiptAuthorityVerified,false);
  assert.throws(()=>startWorkflow(root,repository,startArgs),/selection-stale/);
  assert.throws(()=>collect({...endInput,boundary:'start',previous:{file:end.manifest,digest:end.digest}}),/boundary-transition/);
  assert.throws(()=>collect({...endInput,previous:undefined}),/boundary-transition/);
  assert.throws(()=>collect({...endInput,boundary:'complete'}),/boundary-transition/);
  // Removing a participating worktree cannot silently shrink end-of-workflow coverage.
  assert.throws(()=>collect({...endInput,previous:{file:end.manifest,digest:end.digest},members:endInput.members.slice(0,1)}),/previous-binding/);
  assert.equal(git('config','--get','agentic-os.workflowManifest'),end.manifest);
  const next=startWorkflow(root,repository,{...startArgs,worktreeId:'unique-next'});
  assert.notEqual(JSON.parse(readFileSync(next.manifest,'utf8')).id,manifest.id);
  assert.throws(()=>collect(endInput),/selection-workflow/);
  assert.equal(git('config','--get','agentic-os.workflowManifest'),next.manifest);
});
