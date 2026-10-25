import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectWorkflow, startWorkflow, readWorkflowManifestPage, WORKFLOW_PHASES,
  collectWorkflowValue, readSelectedWorkflow, assertWorkflowEffect, validateWorkflowPlanning,
  rebindWorkflowCandidate, createWorkflowEffectGuard, releaseWorkflowAllocation } from '../bin/agentic-os-workflow.mjs';
import { checkoutCapacity } from '../bin/agentic-os-admission.mjs';
import { get, put } from '../src/lane-records.mjs';
import { applySelectedSourceTransplant, planSelectedSourceTransplant, prepareSelectedSourceTransplant,
  verifySelectedSourceTransplantRecovery } from '../src/lane-selected-source-transplant.mjs';

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
  assert.throws(()=>collect(endInput),/selection-stale/);
  assert.equal(git('config','--get','agentic-os.workflowManifest'),next.manifest);
  assert.equal(readSelectedWorkflow(root,repository,{worktreeId:'first'}).path,retained.manifest);
  const resumed=collect({...endInput,previous:{file:retained.manifest,digest:retained.digest}});
  assert.equal(readSelectedWorkflow(root,repository,{worktreeId:'first'}).path,resumed.manifest);
  assert.equal(readSelectedWorkflow(root,repository,{worktreeId:'unique-next'}).path,next.manifest);
  assert.throws(()=>readSelectedWorkflow(root,repository,{input:retained.manifest}),/selection-stale/);
});

function executionFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-execution-'))), root = join(base, 'repo'); mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const planningPath = 'native-prd-tad-adr-mvp-gtm.md'; writeFileSync(join(root, planningPath), '# Native plan\n');
  writeFileSync(join(root, 'other-prd-tad-adr-mvp-gtm.md'), '# Other native plan\n');
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

test('allocation release stays standalone when no workflow selection was ever retained', t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-allocation-standalone-'))), root = join(base, 'repo'); mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'native-prd-tad-adr-mvp-gtm.md'), '# Native plan\n');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'source');
  assert.deepEqual(releaseWorkflowAllocation(root, 'github.com/example/native', 'agent/device/legacy'), {
    schema: 'agentic-os/workflow-allocation-release/v1',
    authority: false,
    status: 'standalone',
    ref: 'agent/device/legacy',
    worktreeId: null,
    allocationHead: null,
    workflow: null,
    workflowDigest: null,
    released: false,
  });
});

test('source-bound handoffs reject dirty admission and survive immutable workflow successors', t => {
  const s = executionFixture(t), initial = s.selected(), old = initial.members[0].child;
  const participants = ['writer', 'reviewer'].map(role => ({ memberId: s.worktreeId, traceId: role, role }));
  const traces = participants.map(({ traceId }) => {
    const bytes = JSON.stringify({ schema: 'agent-toolkit-run/v1', runId: traceId, status: 'completed',
      candidate: { revision: s.revision }, context: { plan: { repository: s.repository, revision: s.revision } },
      page: { total: 1, offset: 0 }, coverage: { partial: false },
      spans: [{ spanId: traceId, kind: 'agent', operation: `${traceId} handoff`, status: 'completed' }] });
    const file = join(s.base, `${traceId}.json`); writeFileSync(file, bytes);
    return { id: traceId, phase: 'preparation', file, digest: createHash('sha256').update(bytes).digest('hex') };
  });
  const child = collectWorkflowValue(s.root, s.repository, { ...old, traces });
  s.collect({ execution: { ...s.execution, readiness: { version: 1, participants } },
    members: [{ id: s.worktreeId, file: child.manifest, digest: child.digest }] });
  assert.equal(s.guard({ phase: 'ci' }).status, 'eligible');
  for (const phase of ['checks', 'ci']) for (const mode of ['effect', 'dependencies'])
    assert.throws(() => s.guard({ phase, mode, dirty: true }), error =>
      error.blockers.some(row => row.reason === 'dirty-handoff-candidate'));
  assert.equal(s.guard({ phase: 'preparation', dirty: true }).status, 'eligible');
  s.collect({}); assert.equal(s.guard({ phase: 'ci' }).status, 'eligible');
  assert.throws(() => s.collect({ execution: s.execution }), /readiness-relaxation/);
  const retained = s.selected().members[0];
  writeFileSync(join(dirname(retained.path), 'trace-0.json'), '{}');
  assert.throws(() => s.guard({ phase: 'ci' }), /trace-digest/);
});

test('effect rechecks latch declared identity across valid selected-root switches and successor refreshes', t => {
  const s = executionFixture(t);
  let context = null;
  const guard = createWorkflowEffectGuard(() => context);
  assert.equal(guard().status, 'standalone');
  context = { root: s.root, repository: s.repository, worktreeId: s.worktreeId, revision: s.revision, phase: 'preparation' };
  const initial = guard('dependencies'); assert.equal(initial.mode, 'dependencies');
  s.collect({});
  const successor = guard(); assert.equal(successor.workflowId, initial.workflowId);
  assert.notEqual(successor.manifestDigest, initial.manifestDigest);
  context = null; assert.throws(() => guard(), /effect-identity-drift/);
  context = { root: s.root, repository: s.repository, worktreeId: s.worktreeId, revision: s.revision, phase: 'preparation' };
  startWorkflow(s.root, s.repository, { revision: s.revision, planningPath: 'native-prd-tad-adr-mvp-gtm.md',
    worktreeId: 'other-valid-member', execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } });
  assert.equal(guard().manifestDigest, successor.manifestDigest, 'an unrelated START preserves the running lane owner');
  context.worktreeId = 'other-valid-member';
  assert.throws(() => guard(), /effect-identity-drift/, 'another eligible declared root cannot replace the latched identity');
});

test('a blocked declared prerequisite also binds subsequent effect rechecks', t => {
  const s = executionFixture(t);
  const guard = createWorkflowEffectGuard(() => ({ root: s.root, repository: s.repository,
    worktreeId: s.worktreeId, revision: s.revision, phase: 'checks' }));
  assert.throws(() => guard('dependencies'), /blocked-workflow-dependencies/);
  startWorkflow(s.root, s.repository, { revision: s.revision,
    planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId: 'legacy-other' });
  assert.throws(() => guard(), /blocked-workflow-dependencies/);
});

test('the first indexed START retains the previous legacy navigation owner', t => {
  const s = executionFixture(t), original = s.selected();
  for (const key of s.git('config', '--name-only', '--get-regexp', '^agentic-os\\.workflow-').split('\n'))
    s.git('config', '--unset-all', key);
  startWorkflow(s.root, s.repository, { revision: s.revision,
    planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId: 'legacy-other' });
  assert.equal(s.guard({ phase: 'preparation' }).workflowId, original.manifest.id);
  assert.throws(() => s.guard(), /blocked-workflow-dependencies/);
  assert.equal(readSelectedWorkflow(s.root, s.repository, { input: original.path }).digest, original.digest);
});

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
  const released = releaseWorkflowAllocation(s.root, s.repository, successor.ref);
  assert.equal(released.released, true);
  assert.equal(s.selected().manifest.allocations[0].state, 'released');
  assert.equal(checkoutCapacity(s.selected(), s.repository, []).consumed, 0);
  assert.throws(() => s.guard({ ref: successor.ref, phase: 'preparation' }), /allocation-released/);
  assert.throws(() => s.collect({ allocations: [{ ...successor, state: 'active' }] }), /allocation-release-lineage/);
  assert.throws(() => releaseWorkflowAllocation(s.root, s.repository, successor.ref), /allocation-release-state/);
  const nextId = 'device--next', current = s.selected();
  const nextMember = collectWorkflowValue(s.root, s.repository, { schema: 'agentic-os/workflow-observation-input/v1', id: nextId,
    source: { repository: s.repository, revision: s.revision, tree: s.git('rev-parse', 'HEAD^{tree}') },
    context: { workflowId: current.manifest.id, worktreeId: nextId }, expected: WORKFLOW_PHASES, phases: [] }, join(s.base, 'next-member.json'));
  const next = { ...row, worktreeId: nextId, ref: 'agent/device/next', path: join(s.base, 'next-lane') };
  s.collect({ members: [...current.members.map(entry => ({ ...entry.ref, file: entry.path })),
    { id: nextId, file: nextMember.manifest, digest: nextMember.digest }], allocations: [...current.manifest.allocations, next] });
  assert.equal(checkoutCapacity(s.selected(), s.repository, []).consumed, 1);
  assert.throws(() => s.collect({ allocations: [row, row] }), /allocation-duplicate/);
});

test('selected-source recovery proves a non-ancestral pending allocation with its exact native journal', t => {
  const baseDir = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-selected-source-recovery-'))), root = join(baseDir, 'repo'); mkdirSync(root);
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  const planningPath = 'native-prd-tad-adr-mvp-gtm.md'; writeFileSync(join(root, planningPath), '# Recovery plan\n');
  writeFileSync(join(root, 'source.txt'), 'source base\n'); writeFileSync(join(root, 'target.txt'), 'target base\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base'); const workflowBase = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'source-base.txt'), 'selected source base\n'); git(root, 'add', 'source-base.txt'); git(root, 'commit', '-m', 'selected source base');
  const sourceBase = git(root, 'rev-parse', 'HEAD');
  const remote = join(baseDir, 'remote.git'); git(root, 'init', '--bare', remote); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '-u', 'origin', 'main'); git(root, 'fetch', 'origin');
  git(root, 'switch', '-c', 'stale-allocation'); writeFileSync(join(root, 'stale.txt'), 'unrelated allocation head\n');
  git(root, 'add', 'stale.txt'); git(root, 'commit', '-m', 'unrelated prior allocation'); const staleHead = git(root, 'rev-parse', 'HEAD');
  git(root, 'switch', 'main');
  const lane = join(baseDir, 'lane'), ref = 'agent/device/transplant'; git(root, 'worktree', 'add', '-b', ref, lane, sourceBase);
  writeFileSync(join(lane, 'source.txt'), 'selected source change\n'); git(lane, 'add', 'source.txt'); git(lane, 'commit', '-m', 'selected source');
  const sourceHead = git(lane, 'rev-parse', 'HEAD'); writeFileSync(join(root, 'target.txt'), 'protected target change\n');
  git(root, 'add', 'target.txt'); git(root, 'commit', '-m', 'protected target'); git(root, 'push', 'origin', 'main'); git(root, 'fetch', 'origin');
  const targetHead = git(root, 'rev-parse', 'HEAD'), worktreeId = 'device--transplant', repository = 'github.com/example/recovery';
  put({ ref, device: 'device', scope: 'transplant', state: 'active', base: 'refs/remotes/origin/main', baseSha: sourceBase,
    worktree: realpathSync(lane), pr: null, createdAt: new Date(0).toISOString(), head: sourceHead, writePaths: ['source.txt'] }, root);
  const started = startWorkflow(root, repository, { revision: targetHead, planningPath, worktreeId,
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } });
  const selected = () => readSelectedWorkflow(root, repository, { required: true });
  const collect = patch => { const current = selected(); return collectWorkflowValue(root, repository,
    { ...current.manifest, ...patch, previous: { file: current.path, digest: current.digest } }, join(baseDir, '.workspace', 'workflow-input.json')); };
  const paths = ['source.txt'], writeDigest = createHash('sha256').update(JSON.stringify(paths)).digest('hex');
  const pending = { worktreeId, ref, path: realpathSync(lane), baseRevision: workflowBase, headRevision: staleHead,
    writeDigest, previousWriteDigest: 'a'.repeat(64), state: 'pending', operation: 'readmit' };
  collect({ allocations: [pending] });
  const plan = prepareSelectedSourceTransplant(planSelectedSourceTransplant({ cwd: realpathSync(lane), ref, expectedHead: sourceHead, expectedBase: sourceBase,
    targetRef: 'refs/remotes/origin/main', expectedTarget: targetHead, selectedPaths: paths, stopped: true }));
  const receipt = applySelectedSourceTransplant(plan);
  const current = selected(), priorMember = current.members[0].child;
  const member = collectWorkflowValue(root, repository, { ...priorMember,
    source: { ...priorMember.source, revision: receipt.head, tree: git(lane, 'rev-parse', `${receipt.head}^{tree}`) } }, join(baseDir, 'candidate-member.json'));
  const completed = { ...pending }; delete completed.previousWriteDigest;
  const recovery = { schema: 'agentic-os/workflow-selected-source-recovery/v1', priorAllocationHead: staleHead,
    sourceHead, sourceBase, targetHead, selectedPaths: paths, planDigest: plan.digest };
  collect({ members: [{ id: worktreeId, file: member.manifest, digest: member.digest }],
    allocations: [{ ...completed, headRevision: receipt.head, state: 'active', selectedSourceRecovery: recovery }] });
  assert.equal(selected().manifest.allocations[0].selectedSourceRecovery.planDigest, plan.digest);
  assert.notEqual(git(root, 'merge-base', staleHead, receipt.head), staleHead, 'the prior allocation is not an ancestor of the recovered candidate');
  collect({}); assert.deepEqual(selected().manifest.allocations[0].selectedSourceRecovery, recovery);
  const transplantRecovery = { schema: 'agentic-os/workflow-selected-source-recovery/v1', candidateHead: receipt.head,
    planDigest: plan.digest, priorAllocationHead: staleHead, ref, selectedPaths: paths, sourceBase, sourceHead, targetHead };
  writeFileSync(join(lane, 'source.txt'), 'continued after readmission\n');
  assert.equal(verifySelectedSourceTransplantRecovery(root, transplantRecovery), true,
    'later dirty edits do not invalidate committed recovery evidence');
  collect({});
  git(lane, 'add', 'source.txt'); git(lane, 'commit', '-m', 'continue recovered lane');
  const descendant = git(lane, 'rev-parse', 'HEAD');
  assert.equal(verifySelectedSourceTransplantRecovery(root, transplantRecovery), true,
    'the branch may advance before its workflow cache is refreshed');
  put({ ...get(ref, root), head: descendant }, root);
  assert.equal(verifySelectedSourceTransplantRecovery(root, transplantRecovery), true,
    'a recorded descendant preserves the exact transplant proof');
  collect({});
  const record = get(ref, root); put({ ...record, head: targetHead }, root);
  assert.throws(() => verifySelectedSourceTransplantRecovery(root, transplantRecovery), /blocked-lane-selected-source-transplant-recovery/,
    'a lane ref that no longer descends from the candidate cannot reuse the proof');
  put({ ...record, head: descendant }, root);
  assert.equal(started.selected, true);
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
  const lane = join(s.base, s.worktreeId), ref = 'agent/device/change';
  s.git('worktree', 'add', '-b', ref, lane, s.revision);
  const git = (...args) => execFileSync('git', args, { cwd: lane, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  writeFileSync(join(lane, 'candidate.txt'), 'authorized source\n');
  const expectedDecision = s.guard({ root: lane, ref, dirty: true, mode: 'dependencies', phase: 'ci' });
  assert.equal(expectedDecision.status, 'eligible');
  assert.throws(() => s.guard({ root: lane, ref, dirty: true, phase: 'ci' }), /dirty-candidate/);
  s.collect({});
  const before = s.selected(), retained = readFileSync(before.path, 'utf8');
  assert.notEqual(before.digest, expectedDecision.manifestDigest, 'same-identity successors remain eligible');
  git('add', 'candidate.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'candidate');
  const revision = git('rev-parse', 'HEAD'), request = { root: lane, repository: s.repository, ref,
    worktreeId: s.worktreeId, previousRevision: s.revision, revision, expectedDecision };
  assert.throws(() => rebindWorkflowCandidate({ ...request, root: s.root }), /candidate-rebind-source/);
  assert.throws(() => rebindWorkflowCandidate({ ...request, previousRevision: 'f'.repeat(40) }), /candidate-rebind-decision/);
  const result = rebindWorkflowCandidate(request), current = s.selected();
  assert.equal(result.status, 'rebound'); assert.equal(current.manifest.previous.digest, before.digest);
  assert.equal(current.members[0].child.source.revision, revision);
  assert.equal(current.members[0].child.phases[0].revision, s.revision);
  assert.equal(readFileSync(before.path, 'utf8'), retained);
  assert.throws(() => s.guard({ root: lane, ref, revision }), error => error.blockers.some(row => row.status === 'stale'));
  assert.equal(s.guard({ root: lane, ref, revision, phase: 'ci' }).status, 'eligible');
  assert.throws(() => rebindWorkflowCandidate(request), /candidate-rebind-drift/);
  const currentDecision = s.guard({ root: lane, ref, revision, phase: 'ci', mode: 'dependencies' });
  assert.equal(rebindWorkflowCandidate({ ...request, previousRevision: revision, expectedDecision: currentDecision }).status, 'unchanged');
});

test('candidate rebinding rejects precommit identity and source drift before writing any evidence', t => {
  const s = executionFixture(t), lane = join(s.base, s.worktreeId), ref = 'agent/device/change';
  s.git('worktree', 'add', '-b', ref, lane, s.revision);
  const expectedDecision = s.guard({ root: lane, ref, phase: 'ci', mode: 'dependencies' });
  const standalone = s.guard({ worktreeId: 'unrelated', phase: 'ci', mode: 'dependencies' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'candidate'], { cwd: lane, stdio: 'pipe' });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: lane, encoding: 'utf8' }).trim();
  const request = { root: lane, repository: s.repository, ref, worktreeId: s.worktreeId,
    previousRevision: s.revision, revision, expectedDecision };
  const original = s.selected(), storage = dirname(dirname(original.path));
  const files = () => readdirSync(storage, { recursive: true }).sort();
  const before = files();
  for (const decision of [undefined, { ...expectedDecision, revision }, { ...expectedDecision, phase: 'checks' },
    { ...expectedDecision, mode: 'effect' }]) {
    assert.throws(() => rebindWorkflowCandidate({ ...request, expectedDecision: decision }), /candidate-rebind-decision/);
  }
  assert.deepEqual(files(), before); assert.equal(s.selected().digest, original.digest);
  startWorkflow(s.root, s.repository, { revision: s.revision, planningPath: 'other-prd-tad-adr-mvp-gtm.md',
    worktreeId: s.worktreeId, execution: s.execution });
  const switched = s.selected(), afterSwitch = files();
  assert.notEqual(switched.manifest.id, expectedDecision.workflowId);
  assert.equal(switched.members[0].ref.id, expectedDecision.memberId);
  for (const decision of [expectedDecision, standalone]) {
    assert.throws(() => rebindWorkflowCandidate({ ...request, expectedDecision: decision }), /effect-identity-drift/);
  }
  assert.deepEqual(files(), afterSwitch, 'neither child nor root evidence may be written for the newly selected mission');
  assert.equal(s.selected().digest, switched.digest);
  assert.equal(switched.members[0].child.source.revision, s.revision);
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
