import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectWorkflow, WORKFLOW_PHASES, readWorkflowManifestPage } from '../bin/agentic-os-workflow.mjs';

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
