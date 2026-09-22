import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectWorkflow, startWorkflow, readWorkflowManifestPage, WORKFLOW_PHASES,
  collectWorkflowValue, readSelectedWorkflow, assertWorkflowEffect, validateWorkflowPlanning,
  rebindWorkflowCandidate } from '../bin/agentic-os-workflow.mjs';

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
  const indexFile=join(workspace,'.artifacts/codebase-index/native/ingest.json');mkdirSync(dirname(indexFile),{recursive:true});
  const indexText=JSON.stringify({schema:'agentic-graph-agent-graph-ingest/v1',ok:true,complete:true,
    graphId:`kg:graph:${'a'.repeat(32)}`,snapshotDigest:'b'.repeat(64)});
  writeFileSync(indexFile,indexText,{mode:0o600});
  const indexDigest=createHash('sha256').update(indexText).digest('hex');
  const endInput={...manifest,boundary:'end',previous:{file:first.manifest,digest:first.digest},
    codebaseIndex:{snapshot:{file:indexFile,digest:indexDigest}},
    members:[...manifest.members.map(ref=>({...ref,file:resolve(workspace,ref.file)})),{id:'second',file:second.manifest,digest:second.digest}]};
  const end=collect(endInput),endBytes=readFileSync(end.manifest,'utf8'),ended=JSON.parse(endBytes);
  assert.equal(end.sequence,2);assert.equal(end.members,2);assert.equal(end.boundary,'end');
  assert.equal(ended.codebaseIndex.path,manifest.codebaseIndex.path);
  assert.deepEqual(ended.codebaseIndex.snapshot,{file:'.artifacts/codebase-index/native/ingest.json',digest:indexDigest,
    graphId:`kg:graph:${'a'.repeat(32)}`,snapshotDigest:'b'.repeat(64)});
  assert.throws(()=>collect({...endInput,codebaseIndex:{snapshot:{file:indexFile,digest:'0'.repeat(64)}}}),/codebase-binding/);
  assert.throws(()=>collect({...endInput,codebaseIndex:{snapshot:{file:input,digest:indexDigest}}}),/codebase-location/);
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
  const retained=collect({...endInput,previous:{file:end.manifest,digest:end.digest},codebaseIndex:undefined});
  assert.deepEqual(JSON.parse(readFileSync(retained.manifest,'utf8')).codebaseIndex,ended.codebaseIndex);
  const next=startWorkflow(root,repository,{...startArgs,worktreeId:'unique-next'});
  assert.notEqual(JSON.parse(readFileSync(next.manifest,'utf8')).id,manifest.id);
  assert.throws(()=>collect(endInput),/selection-workflow/);
  assert.equal(git('config','--get','agentic-os.workflowManifest'),next.manifest);
});

function executionFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-execution-'))), root = join(base, 'repo'); mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const planningPath = 'native-prd-tad-adr-mvp-gtm.md'; writeFileSync(join(root, planningPath), '# Native plan\n');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'source');
  const repository = 'github.com/example/native', revision = git('rev-parse', 'HEAD'), worktreeId = 'device--change';
  const execution = { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [
    { before: { memberId: worktreeId, phase: 'preparation' }, after: { memberId: worktreeId, phase: 'checks' } },
  ] } };
  startWorkflow(root, repository, { revision, planningPath, worktreeId, execution });
  const selected = () => readSelectedWorkflow(root, repository, { required: true });
  const collect = patch => {
    const previous = selected();
    return collectWorkflowValue(root, repository, { ...previous.manifest, ...patch,
      previous: { file: previous.path, digest: previous.digest } }, join(base, '.workspace', 'input.json'));
  };
  const guard = patch => assertWorkflowEffect({ root, repository, worktreeId, revision, phase: 'checks', ...patch });
  return { base, root, git, repository, revision, worktreeId, execution, selected, collect, guard };
}

test('native effect guard blocks unchanged prerequisites, preserves independent work and rejects stale proof', t => {
  const s = executionFixture(t), initial = s.selected();
  const blocked = () => { try { s.guard(); assert.fail('must block'); } catch (error) {
    assert.equal(error.reason, 'blocked-workflow-dependencies'); return error;
  } };
  const first = blocked(), second = blocked();
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.blockers[0].phase, 'preparation'); assert.equal(first.blockers[0].status, 'missing');
  assert.equal(first.recheck.manifestDigest, initial.digest); assert.equal(s.selected().digest, initial.digest);
  assert.equal(s.guard({ phase: 'preparation', dirty: true }).status, 'eligible');
  assert.equal(s.guard({ worktreeId: 'unrelated' }).status, 'standalone');
  assert.throws(() => s.guard({ phase: 'ci', dirty: true }), /dirty-candidate/);
  assert.throws(() => s.guard({ phase: 'preparation', revision: 'f'.repeat(40) }), /candidate-revision-drift/);
  const receipt = JSON.stringify({ schema: 'agentic-os/flight-observation/v1', source: { head: s.revision, repository: s.repository },
    observationOnly: true, authorizesEffects: false, ok: true, observedAt: 0 });
  const file = join(s.base, 'preparation.json'); writeFileSync(file, receipt);
  const old = initial.members[0].child;
  const child = collectWorkflowValue(s.root, s.repository, { ...old, phases: [
    { id: 'preparation', file, digest: createHash('sha256').update(receipt).digest('hex') },
  ] });
  s.collect({ members: [{ id: s.worktreeId, file: child.manifest, digest: child.digest }] });
  assert.equal(s.guard({ dirty: true }).status, 'eligible');
  assert.equal(s.guard({ phase: 'preparation' }).status, 'eligible', 'a completed receipt never skips its native owner');
  const retainedReceipt = join(dirname(child.manifest), 'preparation.json');
  writeFileSync(retainedReceipt, '{}');
  assert.throws(() => s.guard(), /receipt-digest/); writeFileSync(retainedReceipt, receipt);
  const exact = s.selected();
  assert.throws(() => readSelectedWorkflow(s.root, s.repository, { input: initial.path }), /selection-stale/);
  s.git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'next candidate');
  const revision = s.git('rev-parse', 'HEAD');
  const stale = collectWorkflowValue(s.root, s.repository, { ...old,
    source: { ...old.source, revision, tree: s.git('rev-parse', 'HEAD^{tree}') }, phases: [
      { id: 'preparation', revision: s.revision, file, digest: createHash('sha256').update(receipt).digest('hex') },
    ] });
  s.collect({ members: [{ id: s.worktreeId, file: stale.manifest, digest: stale.digest }] });
  assert.throws(() => s.guard({ revision }), error => error.blockers.some(row => row.status === 'stale'));
  assert.equal(readFileSync(exact.path, 'utf8'), JSON.stringify(exact.manifest, null, 2) + '\n');
});

test('immutable successors retain execution constraints and partial allocation identities', t => {
  const s = executionFixture(t);
  assert.throws(() => s.collect({ execution: null }), /execution-contract/);
  assert.throws(() => s.collect({ execution: { ...s.execution, checkoutLimit: 2 } }), /execution-relaxation/);
  assert.throws(() => s.collect({ execution: { ...s.execution, dependencies: { version: 1, edges: [] } } }), /execution-relaxation/);
  const row = { worktreeId: s.worktreeId, ref: 'agent/device/change', path: join(s.base, 'existing-lane'),
    baseRevision: s.revision, headRevision: s.revision, writeDigest: 'a'.repeat(64), state: 'pending', operation: 'create' };
  s.collect({ allocations: [row] });
  assert.deepEqual(s.selected().manifest.allocations, [row]);
  assert.throws(() => s.collect({ allocations: [] }), /allocation-lineage/);
  assert.throws(() => s.collect({ allocations: [{ ...row, path: join(s.base, 'replacement') }] }), /allocation-lineage/);
  s.collect({ allocations: [{ ...row, state: 'active' }] });
  assert.throws(() => s.collect({ allocations: [row] }), /allocation-lineage/);
  const readmit = { ...row, operation: 'readmit', previousWriteDigest: row.writeDigest, writeDigest: 'b'.repeat(64) };
  assert.throws(() => s.collect({ allocations: [{ ...readmit, previousWriteDigest: 'c'.repeat(64) }] }), /allocation-scope-proof/);
  s.collect({ allocations: [readmit], execution: undefined });
  assert.deepEqual(s.selected().manifest.execution, s.execution);
  assert.equal(s.selected().manifest.allocations[0].operation, 'readmit');
  assert.equal(s.selected().manifest.allocations[0].previousWriteDigest, row.writeDigest);
  assert.throws(() => s.collect({ allocations: [{ ...readmit, writeDigest: 'c'.repeat(64) }] }), /allocation-scope-proof/);
  assert.throws(() => s.collect({ allocations: [{ ...readmit, previousWriteDigest: 'c'.repeat(64) }] }), /allocation-scope-proof/);
  assert.throws(() => s.collect({ allocations: [{ ...readmit, headRevision: 'c'.repeat(40) }] }), /allocation-scope-proof/);
  s.collect({ allocations: [readmit] });
  const { previousWriteDigest, ...completed } = readmit;
  s.collect({ allocations: [{ ...completed, state: 'active' }] });
  assert.equal(s.selected().manifest.allocations[0].writeDigest, readmit.writeDigest);
  assert.equal(s.selected().manifest.allocations[0].previousWriteDigest, undefined);
  const successor = { ...completed, state: 'pending', ref: 'agent/device/successor', predecessorRef: row.ref,
    previousWriteDigest: completed.writeDigest, writeDigest: 'c'.repeat(64) };
  assert.throws(() => s.collect({ allocations: [{ ...successor, predecessorRef: 'agent/device/unrelated' }] }), /allocation-predecessor/);
  s.collect({ allocations: [successor] });
  assert.equal(s.selected().manifest.allocations.length, 1, 'successor consumes the retained allocation');
  assert.throws(() => s.collect({ allocations: [{ ...successor, state: 'active', predecessorRef: undefined }] }), /allocation-binding/);
  s.collect({ allocations: [{ ...successor, state: 'active' }] });
  assert.equal(s.selected().manifest.allocations[0].predecessorRef, row.ref);
  assert.equal(s.guard({ ref: successor.ref, worktreeId: 'missing-registration', phase: 'preparation' }).status, 'eligible');
  assert.throws(() => s.collect({ allocations: [row, row] }), /allocation-duplicate/);
});

test('native candidate rebinding preserves historical receipts and never grants current prerequisite proof', t => {
  const s = executionFixture(t), first = s.selected(), old = first.members[0].child;
  const receipt = JSON.stringify({ schema: 'agentic-os/flight-observation/v1', source: { head: s.revision, repository: s.repository },
    observationOnly: true, authorizesEffects: false, ok: true, observedAt: 0 });
  const file = join(s.base, 'preparation.json'); writeFileSync(file, receipt);
  const child = collectWorkflowValue(s.root, s.repository, { ...old, phases: [
    { id: 'preparation', file, digest: createHash('sha256').update(receipt).digest('hex') },
  ] });
  s.collect({ members: [{ id: s.worktreeId, file: child.manifest, digest: child.digest }] });
  const before = s.selected(), retained = readFileSync(before.path, 'utf8');
  const lane = join(s.base, s.worktreeId), ref = 'agent/device/change';
  s.git('worktree', 'add', '-b', ref, lane, s.revision);
  const git = (...args) => execFileSync('git', args, { cwd: lane, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  writeFileSync(join(lane, 'candidate.txt'), 'authorized source\n');
  assert.equal(s.guard({ root: lane, ref, dirty: true, mode: 'dependencies', phase: 'ci' }).status, 'eligible');
  assert.throws(() => s.guard({ root: lane, ref, dirty: true, phase: 'ci' }), /dirty-candidate/);
  git('add', 'candidate.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'candidate');
  const revision = git('rev-parse', 'HEAD'), request = { root: lane, repository: s.repository, ref,
    worktreeId: s.worktreeId, previousRevision: s.revision, revision };
  assert.throws(() => rebindWorkflowCandidate({ ...request, root: s.root }), /candidate-rebind-source/);
  assert.throws(() => rebindWorkflowCandidate({ ...request, previousRevision: 'f'.repeat(40) }), /candidate-rebind-source/);
  const result = rebindWorkflowCandidate(request), current = s.selected();
  assert.equal(result.status, 'rebound'); assert.equal(current.manifest.previous.digest, before.digest);
  assert.equal(current.members[0].child.source.revision, revision);
  assert.equal(current.members[0].child.phases[0].revision, s.revision);
  assert.equal(readFileSync(before.path, 'utf8'), retained);
  assert.throws(() => s.guard({ root: lane, ref, revision }), error => error.blockers.some(row => row.status === 'stale'));
  assert.equal(s.guard({ root: lane, ref, revision, phase: 'ci' }).status, 'eligible');
  assert.throws(() => rebindWorkflowCandidate(request), /candidate-rebind-drift/);
  assert.equal(rebindWorkflowCandidate({ ...request, previousRevision: revision }).status, 'unchanged');
});

test('foreign declared roots fail closed while unrelated legacy roots remain standalone', t => {
  const s = executionFixture(t), foreign = 'github.com/example/consumer';
  assert.throws(() => readSelectedWorkflow(s.root, foreign), /foreign-declared-owner/);
  assert.throws(() => s.guard({ repository: foreign }), /foreign-declared-owner/);
  startWorkflow(s.root, s.repository, { revision: s.revision,
    planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId: 'legacy-other' });
  assert.equal(readSelectedWorkflow(s.root, foreign), null);
  assert.equal(s.guard({ repository: foreign }).status, 'standalone');
});

test('planning validation returns the committed binding without changing admission evidence', t => {
  const s = executionFixture(t), before = s.selected(), planningPath = before.manifest.planning.path;
  const inputs = { revision: s.revision, planningPath };
  assert.deepEqual(validateWorkflowPlanning(s.root, s.repository, inputs), before.manifest.planning);
  writeFileSync(join(s.root, planningPath), 'dirty writer-owned plan');
  const status = s.git('status', '--porcelain');
  assert.deepEqual(validateWorkflowPlanning(s.root, s.repository, { ...inputs, digest: before.manifest.planning.digest }), before.manifest.planning);
  assert.throws(() => validateWorkflowPlanning(s.root, s.repository, { ...inputs, digest: '0'.repeat(64) }), /planning-digest/);
  assert.throws(() => validateWorkflowPlanning(s.root, s.repository, { ...inputs, planningPath: '../outside.md' }), /planning-binding/);
  assert.equal(s.selected().digest, before.digest); assert.equal(s.git('status', '--porcelain'), status);
});

test('partial current receipts cannot unlock dependent effects', t => {
  const s = executionFixture(t), current = s.selected(), old = current.members[0].child;
  const receipt = JSON.stringify({ schema: 'agentic-os/validation-observation/v1', authority: false,
    source: old.source, status: 'passed', stages: [], coverage: { partial: true, totalStages: 1 } });
  const file = join(s.base, 'checks.json'); writeFileSync(file, receipt);
  const child = collectWorkflowValue(s.root, s.repository, { ...old, phases: [
    { id: 'checks', file, digest: createHash('sha256').update(receipt).digest('hex') },
  ] });
  s.collect({ members: [{ id: s.worktreeId, file: child.manifest, digest: child.digest }],
    execution: { ...s.execution, dependencies: { version: 1, edges: [...s.execution.dependencies.edges,
      { before: { memberId: s.worktreeId, phase: 'checks' }, after: { memberId: s.worktreeId, phase: 'ci' } },
    ] } } });
  assert.throws(() => s.guard({ phase: 'ci' }), error => error.blockers.some(row => row.phase === 'checks' && row.status === 'partial'));
});
