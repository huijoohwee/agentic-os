import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectWorkflow, collectWorkflowValue, WORKFLOW_PHASES, readSelectedWorkflow, readWorkflowManifestPage,
  startWorkflow, validateWorkflowPlanning } from '../bin/agentic-os-workflow.mjs';
import { readmissionPredecessors, successorRecordPlan } from '../src/lane-state.mjs';

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
 const plan='adlc-economy.md',notPlan='notes.md';writeFileSync(join(root,plan),'---\ndoc_type: "PRD-TAD-ADR-MVP-GTM"\n---\n# Native plan\n');writeFileSync(join(root,notPlan),'---\ndoc_type: "Guidelines"\n---\n# Notes\n');git('add','.');git('commit','--quiet','-m','base');
 const revision=git('rev-parse','HEAD'),repository='github.com/example/native';
 const args={revision,planningPath:plan,worktreeId:'device--change'};
 const first=startWorkflow(root,repository,args),bytes=readFileSync(first.manifest,'utf8'),manifest=JSON.parse(bytes);
 assert.equal(manifest.planning.digest,createHash('sha256').update('---\ndoc_type: "PRD-TAD-ADR-MVP-GTM"\n---\n# Native plan').digest('hex'));
 assert.equal(manifest.source.tree,git('rev-parse','HEAD^{tree}'));
 assert.equal(manifest.members.length,1);assert.deepEqual(manifest.releaseTargets,[]);
 assert.equal(manifest.releaseEvidence.length,0);
 const result=readWorkflowManifestPage(root,bytes);
 assert.equal(result.profile.workflow.members.length,1);
 assert.notEqual(result.status,'completed');
 assert.deepEqual(result.profile.workflow.expected,['planning','worktrees']);
 assert.equal(result.profile.workflow.release.boundary,'not-declared');
 assert.equal(result.profile.workflow.closure.target,'workflow-receipts-complete');
 assert.equal(result.profile.workflow.missing.length,7);
 assert(result.spans.every(span => span.resources.tokens === null));
 assert.equal(startWorkflow(root,repository,args).manifest,first.manifest);
 assert.equal(readFileSync(first.manifest,'utf8'),bytes);
 // A working-tree edit cannot silently change the committed planning join.
 writeFileSync(join(root,plan),'uncommitted change');assert.equal(startWorkflow(root,repository,args).manifest,first.manifest);
 for(const planningPath of ['../adlc-economy.md','missing-prd-tad-adr-mvp-gtm.md',notPlan,'README.md'])
  assert.throws(()=>startWorkflow(root,repository,{...args,planningPath}),/blocked-workflow-planning/);
 const production=startWorkflow(root,repository,{...args,worktreeId:'device--production',releaseTargets:['device--production']});
 assert.deepEqual(JSON.parse(readFileSync(production.manifest,'utf8')).releaseTargets,['device--production']);
});

test('START snapshots an explicit untracked planning draft and successors reuse its exact bytes', t => {
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'workflow-draft-'))),root=join(parent,'repo');mkdirSync(root);
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','--quiet','--initial-branch=main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(root,'source'),'base');git('add','source');git('commit','--quiet','-m','base');
 const plan='undocumented-draft/prd-tad-adr-mvp-gtm-local.md',content='---\ndoc_type: PRD-TAD-ADR-MVP-GTM\n---\n# Local draft\n';
 mkdirSync(join(root,'undocumented-draft'));writeFileSync(join(root,plan),content);
 const repository='github.com/example/draft',revision=git('rev-parse','HEAD'),worktreeId='device--draft';
 const bomPlan='undocumented-draft/bom.md';
 writeFileSync(join(root,bomPlan),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(content)]));
 assert.throws(()=>validateWorkflowPlanning(root,repository,{revision,planningPath:bomPlan}),/blocked-workflow-planning-encoding/);
 const first=startWorkflow(root,repository,{revision,planningPath:plan,worktreeId}),manifest=JSON.parse(readFileSync(first.manifest,'utf8'));
 assert.equal(manifest.planning.source,'working-tree');assert.equal(manifest.planning.snapshotFile,'planning.md');
 assert.equal(manifest.planning.digest,createHash('sha256').update(content).digest('hex'));
 assert.deepEqual(validateWorkflowPlanning(root,repository,{revision,planningPath:plan}).planning,manifest.planning);
 assert.equal(readFileSync(join(dirname(first.manifest),'planning.md'),'utf8'),content);
 symlinkSync(plan,join(root,'linked-prd.md'));
 assert.throws(()=>validateWorkflowPlanning(root,repository,{revision,planningPath:'linked-prd.md'}),/blocked-test-file|planning-file/);
 writeFileSync(join(root,plan),'changed after START');
 const selected=readSelectedWorkflow(root,repository,{input:first.manifest,required:true});
 assert.equal(selected.manifest.planning.digest,manifest.planning.digest);
 const next=collectWorkflowValue(root,repository,{...selected.manifest,
  members:selected.members.map(row=>({...row.ref,file:row.path})),previous:{file:selected.path,digest:selected.digest}},join(root,'workflow-input.json'));
 assert.equal(readFileSync(join(dirname(next.manifest),'planning.md'),'utf8'),content);
 assert.equal(readSelectedWorkflow(root,repository,{input:next.manifest,required:true}).manifest.planning.digest,manifest.planning.digest);
});

test('workflow lineage admits only a descendant head for pending readmit recovery', t => {
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'workflow-readmit-recovery-'))),root=join(parent,'repo');mkdirSync(root);
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','--quiet','--initial-branch=main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 const plan='adlc-plan.md';writeFileSync(join(root,plan),'---\ndoc_type: "PRD-TAD-ADR-MVP-GTM"\n---\n# Native plan\n');
 git('add','.');git('-c','commit.gpgsign=false','commit','--quiet','-m','base');
 const repository='github.com/example/readmit',worktreeId='device--lane',ref='agent/device/lane';
 const baseHead=git('rev-parse','HEAD'),started=startWorkflow(root,repository,{revision:baseHead,planningPath:plan,worktreeId,
  execution:{version:1,checkoutLimit:1,dependencies:{version:1,edges:[]}}});
 const initial=readSelectedWorkflow(root,repository,{input:started.manifest,required:true}),writeDigest=createHash('sha256').update(JSON.stringify(['owned.txt'])).digest('hex');
 const pending=collectWorkflowValue(root,repository,{...initial.manifest,
  members:initial.members.map(row=>({...row.ref,file:row.path})),previous:{file:initial.path,digest:initial.digest},
  allocations:[{worktreeId,ref,path:join(parent,'lane'),baseRevision:baseHead,headRevision:baseHead,writeDigest,
   state:'pending',operation:'readmit',previousWriteDigest:writeDigest}]},join(root,'workflow-input.json'));
 const waiting=readSelectedWorkflow(root,repository,{input:pending.manifest,required:true});
 writeFileSync(join(root,'owned.txt'),'candidate');git('add','owned.txt');git('-c','commit.gpgsign=false','commit','--quiet','-m','candidate');
 const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),member=waiting.members[0];
 const child=revision=>collectWorkflowValue(root,repository,{schema:'agentic-os/workflow-observation-input/v1',id:member.child.id,
  source:{repository,revision,tree:git('rev-parse',`${revision}^{tree}`)},context:member.child.context,expected:WORKFLOW_PHASES,phases:[]},join(root,'workflow-input.json'));
 const orphan=git('commit-tree',tree,'-m','unrelated head'),orphanChild=child(orphan),active={...waiting.manifest.allocations[0],headRevision:orphan,state:'active',recoveredFromHead:baseHead};
 delete active.previousWriteDigest;
 const candidate={...waiting.manifest,members:[{...member.ref,file:orphanChild.manifest,digest:orphanChild.digest}],
  allocations:[active],previous:{file:waiting.path,digest:waiting.digest}};
 assert.throws(()=>collectWorkflowValue(root,repository,candidate,join(root,'workflow-input.json')),/allocation-recovery-source/);
 const currentChild=child(head),recovered={...active,headRevision:head};
 const result=collectWorkflowValue(root,repository,{...candidate,members:[{...member.ref,file:currentChild.manifest,digest:currentChild.digest}],allocations:[recovered]},join(root,'workflow-input.json'));
 const current=readSelectedWorkflow(root,repository,{input:result.manifest,required:true});
 assert.equal(current.manifest.allocations[0].state,'active');
 assert.equal(current.manifest.allocations[0].recoveredFromHead,baseHead);
 assert.equal(current.members[0].child.source.revision,head);
 const previousAllocation=current.manifest.allocations[0],nextPending=collectWorkflowValue(root,repository,{...current.manifest,
  members:current.members.map(row=>({...row.ref,file:row.path})),allocations:[{...previousAllocation,state:'pending',
   previousWriteDigest:previousAllocation.writeDigest}],previous:{file:current.path,digest:current.digest}},join(root,'workflow-input.json'));
 const nextWaiting=readSelectedWorkflow(root,repository,{input:nextPending.manifest,required:true});
 writeFileSync(join(root,'next.txt'),'next candidate');git('add','next.txt');git('-c','commit.gpgsign=false','commit','--quiet','-m','next candidate');
 const nextHead=git('rev-parse','HEAD'),nextMember=child(nextHead),nextRow={...nextWaiting.manifest.allocations[0],
  headRevision:nextHead,state:'active',recoveredFromHead:head};delete nextRow.previousWriteDigest;
 const nextRoot=collectWorkflowValue(root,repository,{...nextWaiting.manifest,members:[{...nextWaiting.manifest.members[0],
  file:nextMember.manifest,digest:nextMember.digest}],allocations:[nextRow],
  previous:{file:nextWaiting.path,digest:nextWaiting.digest}},join(root,'workflow-input.json'));
 const repeated=readSelectedWorkflow(root,repository,{input:nextRoot.manifest,required:true});
 assert.equal(repeated.manifest.allocations[0].recoveredFromHead,head);
 assert.equal(repeated.members[0].child.source.revision,nextHead);
});

test('successor lineage rejects missing, mismatched, cyclic and over-budget ancestry', () => {
  const common = { worktree: '/one', base: 'refs/remotes/origin/main', baseSha: 'a'.repeat(40), head: 'a'.repeat(40) };
  const rows = {};
  for (let index = 0; index <= 33; index++) {
    const ref = `agent/device/lane-${index}`;
    rows[ref] = { ...common, ref, ...(index ? { handoff: { schema: 'agentic-os-lane-successor/v1',
      predecessorRef: `agent/device/lane-${index - 1}`, predecessorHead: common.head } } : {}) };
  }
  const record = rows['agent/device/lane-32'];
  assert.equal(readmissionPredecessors(record, rows).length, 32);
  const released = { ...record, handoff: { ...record.handoff, reservationPathReleases: [{
    schema: 'agentic-os/reservation-path-release/v1', path: 'docs/released.md',
    laneHead: common.head, protectedHead: common.head,
    lanePathEntry: { mode: '100644', type: 'blob', oid: common.head },
    protectedPathEntry: { mode: '100644', type: 'blob', oid: common.head },
    bytesDiffer: false, digest: 'b'.repeat(64),
  }] } };
  assert.equal(readmissionPredecessors(released, { ...rows, [record.ref]: released }).length, 32);
  const malformedRelease = { ...released, handoff: { ...released.handoff,
    reservationPathReleases: [{ ...released.handoff.reservationPathReleases[0], path: '../released.md' }] } };
  assert.equal(readmissionPredecessors(malformedRelease, { ...rows, [record.ref]: malformedRelease }), false);
  const recoveryRef = 'agent/device/recovery', predecessorRef = 'agent/device/predecessor',
    recovery = { ref: recoveryRef, device: 'device', scope: 'recovery', state: 'active',
      base: common.base, baseSha: common.baseSha, worktree: common.worktree, pr: null, createdAt: '2026-10-10T00:00:00.000Z',
      writePaths: ['src/owned.mjs'], head: common.head,
      handoff: { ...released.handoff, predecessorRef, predecessorHead: common.head } },
    predecessor = { ...common, ref: predecessorRef, state: 'published', writePaths: recovery.writePaths };
  assert.deepEqual(successorRecordPlan({ boundRef: recoveryRef, successorRef: recoveryRef,
    lanes: { [recoveryRef]: recovery, [predecessorRef]: predecessor }, explicitHead: common.head,
    protectedRef: common.base, tip: common.head, worktree: common.worktree, device: 'device',
    scope: 'recovery', createdAt: 'ignored', writePaths: recovery.writePaths }).plannedRecord, recovery);
  assert.equal(readmissionPredecessors(rows['agent/device/lane-33'], rows), false);
  for (const patch of [undefined, { ...rows['agent/device/lane-0'], head: 'b'.repeat(40) },
    { ...rows['agent/device/lane-0'], worktree: '/other' },
    { ...rows['agent/device/lane-0'], handoff: { schema: 'agentic-os-lane-successor/v1', predecessorRef: record.ref, predecessorHead: common.head } }]) {
    assert.equal(readmissionPredecessors(record, { ...rows, 'agent/device/lane-0': patch }), false);
  }
  const published = { ...rows, 'agent/device/lane-31': { ...rows['agent/device/lane-31'], handoff: null } };
  const allocation = { ref: 'agent/device/lane-0', path: common.worktree,
    baseRevision: common.baseSha, headRevision: common.head };
  assert.equal(readmissionPredecessors(record, published, allocation).length, 2);
  const replacedAnchor = { ...published, 'agent/device/lane-0': {
    ...published['agent/device/lane-0'], head: 'c'.repeat(40),
  } };
  assert.equal(readmissionPredecessors(record, replacedAnchor, allocation).length, 1);
  assert.equal(readmissionPredecessors(record, replacedAnchor, {
    ...allocation, headRevision: 'b'.repeat(40),
  }), false);
  for (const patch of [{ path: '/other' }, { headRevision: 'b'.repeat(40) }, { baseRevision: 'b'.repeat(40) }, { ref: 'agent/device/missing' }]) {
    assert.equal(readmissionPredecessors(record, published, { ...allocation, ...patch }), false);
  }
});
