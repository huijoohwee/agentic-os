import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectWorkflow, WORKFLOW_PHASES, readWorkflowManifestPage, startWorkflow } from '../bin/agentic-os-workflow.mjs';

test('collection stores native lifecycle routes and measurement coverage in one immutable root',t=>{
 const base=mkdtempSync(join(realpathSync(tmpdir()),'workflow-metadata-')),root=join(base,'repo');
 t.after(()=>rmSync(base,{recursive:true,force:true}));mkdirSync(root);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(root,'source'),'owned');git('add','source');git('-c','commit.gpgsign=false','commit','-m','source');
 const source={repository:'github.com/example/project',revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 const bytes=JSON.stringify({schema:'agentic-os/sprint-finish/v1',laneHead:source.revision,integratedRevision:source.revision,grantsAuthority:false});
 writeFileSync(join(base,'receipt.json'),bytes);
 const input=join(base,'input.json');writeFileSync(input,JSON.stringify({schema:'agentic-os/workflow-observation-input/v1',id:'coverage',source,
  lifecycle:{authority:true},expected:WORKFLOW_PHASES,phases:[{id:'integration',file:'receipt.json',digest:createHash('sha256').update(bytes).digest('hex')}]}));
 const result=collectWorkflow(root,source.repository,input),text=readFileSync(result.manifest,'utf8'),manifest=JSON.parse(text);
 assert(result.manifest.includes('/.workspace/.artifacts/workflows/'));
 assert.equal(manifest.lifecycle.authority,false);assert.equal(manifest.lifecycle.targetRoot,'.worktrees');
 assert.deepEqual(manifest.lifecycle.phases,WORKFLOW_PHASES);
 assert.equal(manifest.lifecycle.invocation.recommend,'/workflow.recommend #read-only @input:<manifest>');
 assert.equal(manifest.archive.measurements.models.captured,0);
 assert.equal(manifest.archive.measurements.reported.tokens,0);
 assert.equal(readWorkflowManifestPage(root,text).profile.workflow.missing.length,6);
 assert.equal(collectWorkflow(root,source.repository,input).manifest,result.manifest);
 assert.equal(readFileSync(result.manifest,'utf8'),text);
});


test('planning-bound startup captures one reusable root with no invented phase or production proof', t => {
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'workflow-start-'))),root=join(parent,'repo');mkdirSync(root);
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','--quiet','--initial-branch=main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 const plan='native-prd-tad-adr-mvp-gtm.md';writeFileSync(join(root,plan),'# Native plan\n');git('add','.');git('commit','--quiet','-m','base');
 const revision=git('rev-parse','HEAD'),repository='github.com/example/native';
 const args={revision,planningPath:plan,worktreeId:'device--change'};
 const first=startWorkflow(root,repository,args),bytes=readFileSync(first.manifest,'utf8'),manifest=JSON.parse(bytes);
 assert.equal(manifest.planning.digest,createHash('sha256').update('# Native plan').digest('hex'));
 assert.equal(manifest.source.tree,git('rev-parse','HEAD^{tree}'));
 assert.equal(manifest.members.length,1);assert.deepEqual(manifest.releaseTargets,['device--change']);
 assert.equal(manifest.releaseEvidence.length,0);
 const result=readWorkflowManifestPage(root,bytes);
 assert.equal(result.profile.workflow.members.length,1);
 assert.notEqual(result.status,'completed');
 assert.equal(result.profile.workflow.missing.length,9);
 assert(result.spans.every(span => span.resources.tokens === null));
 assert.equal(startWorkflow(root,repository,args).manifest,first.manifest);
 assert.equal(readFileSync(first.manifest,'utf8'),bytes);
 // A working-tree edit cannot silently change the committed planning join.
 writeFileSync(join(root,plan),'uncommitted change');assert.equal(startWorkflow(root,repository,args).manifest,first.manifest);
 for(const planningPath of ['../native-prd-tad-adr-mvp-gtm.md','missing-prd-tad-adr-mvp-gtm.md','README.md'])
  assert.throws(()=>startWorkflow(root,repository,{...args,planningPath}),/blocked-workflow-planning/);
});
