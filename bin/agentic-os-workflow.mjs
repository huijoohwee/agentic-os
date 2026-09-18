import { traceWorkflow } from './agentic-os-workflow-trace.mjs';
/** Native lifecycle evidence collection. Local artifacts are not execution or release authority. */
import { lstatSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { commonDir, observeGit, git, worktreeInventory, acquireOperationLock, finishOperationLock, assertDirectoryAncestors } from '../src/git.mjs';
import { hash, readRegular } from './agentic-os-test-inputs.mjs';
import { readWorkflowObservation, workflowObservation } from './agentic-os-workflow-observation.mjs';

import { buildArchive, readArchive, receiptClock, traceReferences, workflowGroup, WORKFLOW_GROUP } from './agentic-os-workflow-archive.mjs';

export const WORKFLOW_PHASES = Object.freeze(['preparation', 'checks', 'ci', 'integration', 'cleanup', 'synchronization', 'runtime']);
const fail = reason => { throw Error(`blocked-workflow-${reason}`); };
const inside = (root, path) => { const p = relative(root, path); return p !== '' && !p.startsWith(`..${sep}`) && p !== '..' && !isAbsolute(p); };
const read = (path, budget) => { assertDirectoryAncestors(path, sep); return readRegular(dirname(path), basename(path), budget).text; };
const PHASE_SCHEMAS = Object.freeze({ preparation: 'agentic-os/flight-observation/v1', checks: 'agentic-os/validation-observation/v1',
  ci: 'agentic-os/pipeline-observation/v1', integration: 'agentic-os/sprint-finish/v1', cleanup: 'agentic-os/user-cleanup-receipt/v1',
  synchronization: 'agentic-os-canonical-sync-receipt/v2', runtime: 'agentic-local-runtime-readiness/v1' });
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function workflowPaths(root, repository) {
  const common = commonDir(root);
  if (basename(common) !== '.git') fail('canonical-layout');
  const parent = dirname(dirname(common));
  const configured = observeGit(['config', '--local', '--get-all', 'agentic-os.workspaceRoot'], { cwd: root, allowFail: true });
  if (configured !== null && (!configured || /[\r\n\x00]/u.test(configured))) fail('workspace-root');
  const workspace = configured === null ? join(parent, '.workspace') : resolve(dirname(common), configured);
  assertDirectoryAncestors(join(workspace, 'entry'), sep, { allowMissing: true });
  return { workspace, targets: join(parent, '.worktrees'), storage: join(workspace, '.artifacts', 'workflows', hash(repository).slice(0, 24)) };
}
function lifecycleMetadata() {
  return { start: 'agentic-os/docs/START-WORKFLOW.md', release: 'agentic-os/docs/RELEASE-WORKFLOW.md', phases: WORKFLOW_PHASES,
    storage: '.workspace/.artifacts/workflows/<repository-digest>/<manifest-digest>/manifest.json', targetRoot: '.worktrees',
    reader: 'agentic-os', authority: false,
    invocation: { mcp: ['workflow.targets','workflow.collect','workflow.export','workflow.recommend'],
      inspect: '/workflow.export #read-only @input:<manifest>', recommend: '/workflow.recommend #read-only @input:<manifest>',
      formats: ['json','sse'] } };
}
function decorate(observation) {
  const workflow = observation.profile.workflow;
  workflow.lifecycle = lifecycleMetadata();
  workflow.optimization ??= { authority: false, strategy: 'observe-rank-execute-reevaluate',
    ranking: workflow.phases.flatMap(phase => (phase.feedback ?? []).map(row => ({ ...row, phase: phase.id,
      evidenceDigest: phase.digest, revision: phase.revision }))).sort((a, b) => b.meanMs - a.meanMs || a.id.localeCompare(b.id)).slice(0, 5),
    policy: 'Reuse the validation economy scheduler and exact-input cache; preserve mandatory checks and dependency order. Re-measure the same cohort before claiming savings.' };
  return observation;
}
export function discoverWorkflowTargets(root, repository) {
  const paths = workflowPaths(root, repository), inventory = worktreeInventory(root);
  if (inventory.length > 64) fail('target-budget');
  return { schema: 'agentic-os/workflow-targets/v1', authority: false, repository, ...paths,
    expected: WORKFLOW_PHASES, targetsScope: 'registered worktrees of this repository under the default target root',
    observations: inventory.filter(row => inside(paths.targets, row.path)).map(row => ({
      path: row.path, branch: row.branch, revision: row.head, detached: row.detached,
      locked: row.locked, prunable: row.prunable, contentLoaded: false,
    })), next: 'Collect an exact workflow manifest, then use Canvas Import local file with the returned manifest path; retain its referenced files.' };
}
export function collectWorkflow(root, repository, input) {
  const inputPath = resolve(input), manifest = JSON.parse(read(inputPath, 32000));
  return collectManifest(root, repository, manifest, inputPath);
}
function collectManifest(root, repository, manifest, inputPath) {
  if (manifest.source?.repository !== repository) fail('repository-binding');
  if (!/^[a-f0-9]{40}$/u.test(manifest.source?.revision ?? '') || !/^[a-f0-9]{40}$/u.test(manifest.source?.tree ?? '')) fail('source-binding');
  if (observeGit(['cat-file', '-t', manifest.source.revision], { cwd: root }) !== 'commit') fail('source-binding');
  if (observeGit(['rev-parse', '--verify', `${manifest.source.revision}^{tree}`], { cwd: root }) !== manifest.source.tree) fail('tree-binding');
  if (manifest.schema === WORKFLOW_GROUP) return collectGroup(root, repository, manifest, inputPath);
  // Lifecycle completeness is fixed by the owner; a caller cannot omit release phases to claim completion.
  if (JSON.stringify(manifest.expected) !== JSON.stringify(WORKFLOW_PHASES)) fail('phase-coverage');
  const receipts = new Map();
  workflowObservation(manifest, file => {
    const text = read(resolve(dirname(inputPath), file), 128000);
    const phase = manifest.phases.find(row => row.file === file);
    let receipt; try { receipt = JSON.parse(text); } catch { receipt = JSON.parse(text.split('\n')[0]); }
    if (receipt.schema !== PHASE_SCHEMAS[phase.id]) fail('phase-schema');
    receipts.set(file, text); return text;
  });
  const traces = traceReferences(manifest);
  for (const ref of traces) {
    const bytes = read(resolve(dirname(inputPath), ref.file), 128000);
    if (hash(bytes) !== ref.digest) fail('trace-digest');
    if (receipts.has(ref.file)) fail('duplicate-file');
    receipts.set(ref.file, bytes);
  }
  const captured = buildArchive(manifest, file => receipts.get(file), receiptClock(receipts));
  const stored = { ...manifest, lifecycle: lifecycleMetadata(), phases: manifest.phases.map(phase => ({ ...phase, file: `${phase.id}.json` })),
    traces: traces.map((ref, index) => ({ ...ref, file: `trace-${index}.json` })), archive: captured.archive };
  const files = new Map(stored.phases.map((ref,index) => [ref.file,receipts.get(manifest.phases[index].file)]));
  stored.traces.forEach((ref,index) => files.set(ref.file,receipts.get(traces[index].file)));
  for (const [file, content] of captured.files) files.set(file, content);
  const bytes = json(stored), digest = hash(bytes), paths = workflowPaths(root, repository);
  const directory = join(paths.storage, digest), manifestPath = join(directory, 'manifest.json');
  if (Buffer.byteLength(bytes) > 32000) fail('manifest-budget');
  const lock = acquireOperationLock('agentic-os-workflow', root);
  if (!lock) fail('busy');
  let error, result;
  try {
    assertDirectoryAncestors(join(paths.storage, 'entry'), sep, { allowMissing: true });
    mkdirSync(paths.storage, { recursive: true, mode: 0o700 });
    assertDirectoryAncestors(join(directory, 'entry'), sep, { allowMissing: true });
    if (lstatSync(directory, { throwIfNoEntry: false })) {
      if (read(manifestPath, 32000) !== bytes) fail('storage-drift');
      for (const [file, content] of files) if (read(join(directory, file), 128000) !== content) fail('storage-drift');
      result = { reused: true };
    } else {
      const staging = mkdtempSync(join(paths.storage, '.collect-'));
      for (const [file, content] of files) writeFileSync(join(staging, file), content, { flag: 'wx', mode: 0o600 });
      writeFileSync(join(staging, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
      // One clone-wide exclusive writer; a failed partial collection remains private for diagnosis.
      if (lstatSync(directory, { throwIfNoEntry: false })) fail('storage-race');
      renameSync(staging, directory);
      result = { reused: false };
    }
    result = { schema: 'agentic-os/workflow-collection/v1', authority: false, ...result,
      source: manifest.source, digest, manifest: manifestPath, bytes: Buffer.byteLength(bytes)
        + [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0),
      storage: paths.storage, targetRoot: paths.targets, expected: WORKFLOW_PHASES };
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'workflow collection', result, error });
}
/** Capture a planning-bound initial root before lane provisioning; no phase is fabricated. */
export function startWorkflow(root, repository, { revision, planningPath, worktreeId }) {
  if (!/^[a-f0-9]{40}$/u.test(revision) || !/^[a-zA-Z0-9:._-]{1,128}$/u.test(worktreeId)) fail('start-binding');
  const planning = { repository, revision, path: planningPath };
  validatePlanning(root, repository, planning, false);
  planning.digest = hash(observeGit(['show', `${revision}:${planningPath}`], { cwd: root }));
  const source = { repository, revision, tree: observeGit(['rev-parse', `${revision}^{tree}`], { cwd: root }) };
  const id = `workflow-${hash(json({ source, planning, worktreeId })).slice(0, 32)}`;
  const inputPath = join(root, 'workflow-input.json'); // Resolution base only; never written.
  const child = collectManifest(root, repository, { schema: 'agentic-os/workflow-observation-input/v1',
    id, source, context: { workflowId: id, worktreeId }, expected: WORKFLOW_PHASES, phases: [] }, inputPath);
  return collectManifest(root, repository, { schema: WORKFLOW_GROUP, id, source, planning,
    boundary: 'start', members: [{ id: worktreeId, file: child.manifest, digest: child.digest }], releaseTargets: [worktreeId] }, inputPath);
}

export function runWorkflow(root, argv, profile, out = console.log) {
  const operation = argv[0], input = argv.find(value => value.startsWith('--input='))?.slice(8);
  const offsetText = argv.find(value => value.startsWith('--offset='))?.slice(9);
  const format = argv.find(value => value.startsWith('--format='))?.slice(9) ?? 'json';
  if (!['json','sse'].includes(format) || format === 'sse' && operation !== 'export') fail('format');
  if (offsetText !== undefined && !/^(0|[1-9][0-9]*)$/u.test(offsetText)) fail('offset');
  const result = operation === 'targets' ? discoverWorkflowTargets(root, profile.repository)
    : operation === 'trace' ? traceWorkflow(root, input)
    : operation === 'collect' ? collectWorkflow(root, profile.repository, input)
      : ['export', 'recommend'].includes(operation) ? exportWorkflow(root, profile.repository, input, operation, Number(offsetText ?? 0)) : fail('operation');
  const output = json(result);
  if (Buffer.byteLength(output) > 256000) fail('output-budget');
  // Same finite JSON snapshot/DONE framing consumed by the existing Canvas observation stream.
  // Each request pins one immutable root and page; no background polling or mutable latest file.
  const streamed = result.status === 'blocked' ? {...result,status:'failed',capturedStatus:'blocked'} : result;
  out(format === 'sse' ? `data: ${JSON.stringify(streamed)}\n\ndata: [DONE]\n` : output.trimEnd()); return 0;
}

export function exportWorkflow(root, repository, input, operation, offset) {
  const path = resolve(input), manifestBytes = read(path, 32000), manifest = JSON.parse(manifestBytes);
  if (manifest.source?.repository !== repository) fail('repository-binding');
  if (manifest.schema === WORKFLOW_GROUP) {
    if (basename(dirname(path)) !== hash(manifestBytes)) fail('archive-manifest-digest');
    verifyGroupRelease(manifest, path);
    const result = workflowGroup(manifest, groupLoader(root, repository), {offset, adviceOnly:operation==='recommend'});
    return operation === 'recommend' ? {...result,currentRevision:observeGit(['rev-parse','HEAD'],{cwd:root}),
      sourceMatches:observeGit(['rev-parse','HEAD'],{cwd:root})===manifest.source.revision,manifestDigest:hash(manifestBytes)} : decorate(result);
  }
  if (!manifest.archive) {
    if (operation === 'recommend' || offset !== 0) fail('archive-required-recollect');
    return decorate(readWorkflowObservation(path));
  }
  if (basename(dirname(path)) !== hash(manifestBytes)) fail('archive-manifest-digest');
  const result = readArchive(manifest, file => {
    if (basename(file) !== file) fail('archive-path');
    return read(join(dirname(path),file),128000);
  }, {offset, adviceOnly: operation === 'recommend'});
  if (operation === 'recommend') {
    const currentRevision = observeGit(['rev-parse','HEAD'],{cwd:root});
    return {...result, currentRevision, sourceMatches:currentRevision===manifest.source.revision,
      disposition:'recommendations-only-revalidate-before-change', manifestDigest:hash(manifestBytes)};
  }
  return decorate(result);
}

function groupLoader(root, repository) {
  const paths=workflowPaths(root,repository), archiveRoot=join(paths.workspace,'.artifacts','workflows');
  return ref=>{
    const path=resolve(paths.workspace,ref.file);
    if(!inside(archiveRoot,path) || basename(path)!=='manifest.json')fail('member-path');
    const bytes=read(path,32000);
    if(hash(bytes)!==ref.digest || basename(dirname(path))!==ref.digest)fail('member-digest');
    return {manifest:JSON.parse(bytes),path,read:file=>{
      if(basename(file)!==file)fail('member-file');
      return read(join(dirname(path),file),128000);
    }};
  };
}
function verifyGroupRelease(manifest, path) {
  for(const ref of manifest.releaseEvidence??[]){
    if(!/^release-\d+\.json$/u.test(ref.file))fail('release-file');
    const bytes=read(join(dirname(path),ref.file),128000);
    if(hash(bytes)!==ref.digest)fail('release-digest');
  }
}
function validatePlanning(root, repository, planning, checkDigest = true) {
  if (!planning || planning.repository !== repository || !/^[a-f0-9]{40}$/u.test(planning.revision ?? '')
    || typeof planning.path !== 'string' || /[\\\x00-\x1f]/u.test(planning.path) || planning.path.startsWith('/')
    || planning.path.split('/').some(part => !part || part === '..' || part === '.')
    || !/prd-tad-adr-mvp-gtm\.md$/iu.test(planning.path)
    || checkDigest && !/^[a-f0-9]{64}$/u.test(planning.digest ?? '')) fail('planning-binding');
  const entry = observeGit(['ls-tree', planning.revision, '--', planning.path], { cwd: root });
  if (!/^100644 blob [a-f0-9]{40}\t/u.test(entry ?? '')) fail('planning-file');
  const planned = observeGit(['show', `${planning.revision}:${planning.path}`], { cwd: root });
  if (Buffer.byteLength(planned) > 128000) fail('planning-budget');
  // The native Git reader trims terminal newlines; historical group digests use that text.
  if (checkDigest && hash(planned) !== planning.digest) fail('planning-digest');
}
function collectGroup(root, repository, manifest, inputPath) {
  const paths=workflowPaths(root,repository), load=groupLoader(root,repository), files=new Map();
  const planning=manifest.planning;
  validatePlanning(root, repository, planning);
  if(!Array.isArray(manifest.members))fail('members');
  const members=manifest.members.map(ref=>{
    const normalized={...ref,file:relative(paths.workspace,resolve(dirname(inputPath),ref.file))};
    load(normalized); return normalized;
  });
  const releaseEvidence=(manifest.releaseEvidence??[]).map((ref,index)=>{
    const bytes=read(resolve(dirname(inputPath),ref.file),128000), value=JSON.parse(bytes);
    const member=members.find(row=>row.id===ref.memberId), source=member&&load(member).manifest.source;
    if(hash(bytes)!==ref.digest || !value || typeof value.schema!=='string' || value.schema.length>128
      || ref.repository!==source?.repository || !/^[a-f0-9]{40}$/u.test(ref.revision??''))fail('release-binding');
    if(value.schema==='agentic-local-runtime-readiness/v1' || value.environment && value.environment!=='production')fail('release-environment');
    const revision=value.sourceRevision??value.source?.revision;
    const repo=value.repository??value.source?.repository;
    if(revision && revision!==ref.revision || repo && (repo.startsWith('github.com/')?repo:`github.com/${repo}`)!==ref.repository)fail('release-source');
    const file=`release-${index}.json`;files.set(file,bytes);
    const observedStatus=['deployed','runtime-ready','passed','completed','production-complete'].includes(value.status)?'completed'
      : ['failed','blocked'].includes(value.status)?'failed':'queued';
    return {...ref,file,schema:value.schema,observedStatus,authorityVerified:false};
  });
  let previous, older, sequence=1;
  if(manifest.previous){
    previous={...manifest.previous,file:relative(paths.workspace,resolve(dirname(inputPath),manifest.previous.file))};
    older=load(previous).manifest;
    if(older.schema!==WORKFLOW_GROUP || older.id!==manifest.id || older.source.repository!==repository
      || JSON.stringify(older.planning)!==JSON.stringify(planning) || !Number.isSafeInteger(older.sequence)
      || older.members.some(ref=>!members.some(next=>next.id===ref.id))
      || older.releaseTargets.some(id=>!manifest.releaseTargets?.includes(id)))fail('previous-binding');
    for(const ref of older.members){
      const before=load(ref).manifest,after=load(members.find(next=>next.id===ref.id)).manifest;
      if(before.source.repository!==after.source.repository || before.context.worktreeId!==after.context.worktreeId)fail('previous-member-binding');
    }
    sequence=older.sequence+1;
  }
  const boundary=manifest.boundary??older?.boundary;
  if(boundary!==undefined && !['start','end'].includes(boundary)
    || boundary==='end' && !older?.boundary || older?.boundary==='end' && boundary!=='end')fail('boundary-transition');
  const stored={schema:WORKFLOW_GROUP,id:manifest.id,source:manifest.source,lifecycle:lifecycleMetadata(),planning,members,
    releaseTargets:manifest.releaseTargets,releaseEvidence,sequence,...(previous?{previous}:{}),...(boundary?{boundary}:{})};
  // Validate every referenced archive and all pages at collection; exports load requested pages only.
  workflowGroup(stored,load,{adviceOnly:true});
  for(const ref of members){const child=load(ref);for(let offset=0;offset<child.manifest.archive.total;offset+=32)
    readArchive(child.manifest,child.read,{offset});}
  const bytes=json(stored), digest=hash(bytes), directory=join(paths.storage,digest), manifestPath=join(directory,'manifest.json');
  if(Buffer.byteLength(bytes)>32000)fail('manifest-budget');
  const lock=acquireOperationLock('agentic-os-workflow',root);if(!lock)fail('busy');
  let error,result;
  try{
    // This existing clone-local locator is navigation only. An older same-workflow request
    // must not replace a newer root or race another successor of the selected root.
    if(boundary){
      const selected=observeGit(['config','--local','--get','agentic-os.workflowManifest'],{cwd:root,allowFail:true});
      if(selected && selected!==manifestPath){
        const selectedBytes=read(selected,32000), current=JSON.parse(selectedBytes);
        if(current.id!==stored.id && (boundary!=='start' || sequence!==1))fail('selection-workflow');
        if(current.id===stored.id && (current.sequence>=sequence || previous?.digest!==hash(selectedBytes)))fail('selection-stale');
      }
    }
    assertDirectoryAncestors(join(directory,'entry'),sep,{allowMissing:true});
    mkdirSync(paths.storage,{recursive:true,mode:0o700});
    const reused=Boolean(lstatSync(directory,{throwIfNoEntry:false}));
    if(reused){if(read(manifestPath,32000)!==bytes)fail('storage-drift');verifyGroupRelease(stored,manifestPath);}
    else{
      const staging=mkdtempSync(join(paths.storage,'.collect-'));
      for(const [file,content] of files)writeFileSync(join(staging,file),content,{flag:'wx',mode:0o600});
      writeFileSync(join(staging,'manifest.json'),bytes,{flag:'wx',mode:0o600});
      if(lstatSync(directory,{throwIfNoEntry:false}))fail('storage-race');renameSync(staging,directory);
    }
    if(boundary)git(['config','--local','agentic-os.workflowManifest',manifestPath],{cwd:root});
    result={schema:'agentic-os/workflow-collection/v1',authority:false,reused,source:manifest.source,digest,manifest:manifestPath,
      ...(boundary?{boundary,selected:true}:{}),
      sequence,members:members.length,storage:paths.storage,targetRoot:paths.targets,bytes:Buffer.byteLength(bytes)};
  }catch(caught){error=caught;}
  return finishOperationLock(lock,{label:'workflow collection',result,error});
}

/** User-selected bytes identify an existing immutable root; never accept a browser filesystem path. */
export function readWorkflowManifestPage(root, manifestText, offset = 0) {
  if (typeof manifestText !== 'string' || Buffer.byteLength(manifestText) > 32000) fail('manifest-budget');
  const manifest = JSON.parse(manifestText), repository = manifest.source?.repository;
  if (!/^github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(repository ?? '')
    || repository.split('/').some(part => part === '.' || part === '..')
    || ![WORKFLOW_GROUP, 'agentic-os/workflow-observation-input/v1'].includes(manifest.schema)) fail('manifest');
  const digest = hash(manifestText), paths = workflowPaths(root, repository);
  const path = join(paths.storage, digest, 'manifest.json');
  if (read(path, 32000) !== manifestText) fail('manifest-digest');
  const observation = exportWorkflow(root, repository, path, 'export', offset);
  return { ...observation, manifestDigest: digest };
}
