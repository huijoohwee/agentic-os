import { traceWorkflow } from './agentic-os-workflow-trace.mjs';
/** Native lifecycle evidence collection. Local artifacts are not execution or release authority. */
import { lstatSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { commonDir, observeGit, git, worktreeInventory, acquireOperationLock, finishOperationLock, assertDirectoryAncestors } from '../src/git.mjs';
import { hash, readRegular } from './agentic-os-test-inputs.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { readWorkflowObservation, workflowObservation } from './agentic-os-workflow-observation.mjs';

import { buildArchive, readArchive, receiptClock, traceReferences, workflowGroup, WORKFLOW_GROUP,
  validateWorkflowExecution, workflowEligibility } from './agentic-os-workflow-archive.mjs';

export const WORKFLOW_PHASES = Object.freeze(['preparation', 'checks', 'ci', 'integration', 'cleanup', 'synchronization', 'runtime']);
const fail = reason => { throw Error(`blocked-workflow-${reason}`); };
const inside = (root, path) => { const p = relative(root, path); return p !== '' && !p.startsWith(`..${sep}`) && p !== '..' && !isAbsolute(p); };
const read = (path, budget) => { assertDirectoryAncestors(path, sep); return readRegular(dirname(path), basename(path), budget).text; };
const PHASE_SCHEMAS = Object.freeze({ preparation: 'agentic-os/flight-observation/v1', checks: 'agentic-os/validation-observation/v1',
  ci: 'agentic-os/pipeline-observation/v1', integration: 'agentic-os/sprint-finish/v1', cleanup: 'agentic-os/user-cleanup-receipt/v1',
  synchronization: 'agentic-os-canonical-sync-receipt/v2', runtime: 'agentic-local-runtime-readiness/v1' });
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const selectionKey = (repository, kind, id) => `agentic-os.workflow-${kind}-${hash(json([repository, id]))}`;
const selection = (root, key) => {
  const value = observeGit(['config', '--local', '--get-all', key], { cwd: root, allowFail: true });
  if (value !== null && (!value || /[\r\n\x00]/u.test(value))) fail('selection-locator');
  return value;
};
function retainSelection(root, repository, selected) {
  const { manifest, path, members } = selected;
  git(['config', '--local', selectionKey(repository, 'owner', manifest.id), path], { cwd: root });
  for (const member of members.filter(row => row.child.source.repository === repository))
    git(['config', '--local', selectionKey(repository, 'member', member.child.context.worktreeId), path], { cwd: root });
  for (const row of manifest.allocations ?? [])
    git(['config', '--local', selectionKey(repository, 'ref', row.ref), path], { cwd: root });
}

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
export function collectWorkflowValue(root, repository, value, inputPath = join(root, 'workflow-input.json')) {
  if (Buffer.byteLength(json(value)) > 32000) fail('manifest-budget');
  return collectManifest(root, repository, value, resolve(inputPath));
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
export function startWorkflow(root, repository, { revision, planningPath, worktreeId, execution }) {
  if (!/^[a-f0-9]{40}$/u.test(revision) || !/^[a-zA-Z0-9:._-]{1,128}$/u.test(worktreeId)) fail('start-binding');
  const planning = validateWorkflowPlanning(root, repository, { revision, planningPath });
  const source = { repository, revision, tree: observeGit(['rev-parse', `${revision}^{tree}`], { cwd: root }) };
  const id = `workflow-${hash(json({ source, planning, worktreeId })).slice(0, 32)}`;
  const inputPath = join(root, 'workflow-input.json'); // Resolution base only; never written.
  const child = collectManifest(root, repository, { schema: 'agentic-os/workflow-observation-input/v1',
    id, source, context: { workflowId: id, worktreeId }, expected: WORKFLOW_PHASES, phases: [] }, inputPath);
  return collectManifest(root, repository, { schema: WORKFLOW_GROUP, id, source, planning,
    ...(execution === undefined ? {} : { execution }),
    boundary: 'start', members: [{ id: worktreeId, file: child.manifest, digest: child.digest }], releaseTargets: [worktreeId] }, inputPath);
}

/** Read the existing immutable owner; the local selected-path config is navigation only. */
export function readSelectedWorkflow(root, repository, { input = null, required = false, worktreeId = null, ref = null } = {}) {
  const key = [ref && selectionKey(repository, 'ref', ref), worktreeId && selectionKey(repository, 'member', worktreeId)]
    .find(key => key && selection(root, key)) ?? 'agentic-os.workflowManifest';
  const selected = selection(root, key);
  if (!input && !selected) { if (required) fail('selection-required'); return null; }
  let path = resolve(input ?? selected), bytes = read(path, 32000), manifest = JSON.parse(bytes);
  const ownerKey = selectionKey(repository, 'owner', manifest.id), owner = selection(root, ownerKey);
  if (owner && resolve(owner) !== path) {
    if (input) fail('selection-stale');
    const latest = JSON.parse(read(resolve(owner), 32000));
    if (latest.id !== manifest.id) fail('selection-binding');
    path = resolve(owner); bytes = read(path, 32000); manifest = latest;
  }
  const digest = hash(bytes);
  const paths = workflowPaths(root, repository);
  if (!inside(join(paths.workspace, '.artifacts', 'workflows'), path)
    || basename(path) !== 'manifest.json' || basename(dirname(path)) !== digest) fail('selection-digest');
  if (manifest.schema !== WORKFLOW_GROUP || manifest.source?.repository !== repository) {
    if (manifest.execution !== undefined) fail('foreign-declared-owner');
    if (required || input) fail('selection-binding'); return null;
  }
  if (!owner && input && selected && resolve(selected) !== path) {
    const current = JSON.parse(read(resolve(selected), 32000));
    if (current.id === manifest.id) fail('selection-stale');
  }
  if (!/^[a-f0-9]{40}$/u.test(manifest.source.revision ?? '')
    || observeGit(['rev-parse', `${manifest.source.revision}^{tree}`], { cwd: root }) !== manifest.source.tree) fail('source-binding');
  validatePlanning(root, repository, manifest.planning); verifyGroupRelease(manifest, path);
  const load = groupLoader(root, repository);
  workflowGroup(manifest, load, { adviceOnly: true });
  const members = manifest.members.map(ref => {
    const loaded = load(ref), child = loaded.manifest;
    const receipts = new Map(), receiptBytes = file => {
      if (!receipts.has(file)) receipts.set(file, loaded.read(file)); return receipts.get(file);
    };
    const observation = workflowObservation(child, receiptBytes, Date.now(), { all: true });
    const advice = readArchive(child, loaded.read, { adviceOnly: true });
    // Use validated native receipt progress, never caller-written recommendation status.
    advice.progress = observation.spans.filter(row => row.parentSpanId === 'root').map(row => {
      const phase = child.phases.find(value => value.id === row.spanId), text = receiptBytes(phase.file);
      let receipt; try { receipt = JSON.parse(text); } catch { receipt = null; }
      return { id: row.spanId, digest: row.subjectDigest, revision: row.component.revision, status: row.status,
        partial: receipt?.coverage?.partial === true || (receipt?.coverage?.totalStages ?? 0) > (receipt?.stages?.length ?? 0) };
    });
    return { ref, child, path: loaded.path, read: loaded.read, advice };
  });
  validateAllocations(manifest.allocations, members);
  if (manifest.previous) {
    const older = load(manifest.previous).manifest;
    assertGroupSuccessor(manifest, older, manifest.members, load, true);
  }
  if (key !== 'agentic-os.workflowManifest' && !members.some(row => row.child.context.worktreeId === worktreeId)
    && !manifest.allocations?.some(row => row.ref === ref)) fail('selection-member-binding');
  if ((!owner || key !== 'agentic-os.workflowManifest') && selection(root, key) !== selected || selection(root, ownerKey) !== owner)
    fail('selection-drift');
  return { manifest, path, digest, members };
}

/** Restrict one native action; exact-input reuse and effect authority stay with its owner. */
export function assertWorkflowEffect({ root, repository, phase, worktreeId, revision, dirty = false, ref = null, mode = 'effect' }) {
  if (!WORKFLOW_PHASES.includes(phase) || !/^[a-f0-9]{40}$/u.test(revision ?? '')
    || !['effect', 'dependencies'].includes(mode)) fail('effect-binding');
  const selected = readSelectedWorkflow(root, repository, { worktreeId, ref });
  const standalone = { status: 'standalone', authority: false, dependencyCoverage: 'undeclared' };
  if (!selected || selected.manifest.execution === undefined) return standalone;
  const allocation = ref && selected.manifest.allocations?.find(row => row.ref === ref);
  const member = selected.members.find(row => row.child.source.repository === repository
    && row.child.context.worktreeId === (allocation?.worktreeId ?? worktreeId));
  if (allocation && !member) fail('allocation-member-binding');
  if (!member) return standalone;
  const { manifest, digest } = selected;
  const decision = workflowEligibility(manifest, selected.members).actions.find(row => row.memberId === member.ref.id && row.phase === phase);
  if (!decision) fail('effect-phase');
  const blockers = [...decision.blockers];
  if (dirty && manifest.execution.readiness && ['checks', 'ci'].includes(phase))
    blockers.push({ memberId: member.ref.id, phase, reason: 'dirty-handoff-candidate' });
  if (member.child.source.revision !== revision) blockers.push({ memberId: member.ref.id, phase,
    reason: 'candidate-revision-drift', requiredRevision: member.child.source.revision, revision });
  if (mode === 'effect' && dirty && !['checks', 'preparation'].includes(phase)) blockers.push({ memberId: member.ref.id, phase, reason: 'dirty-candidate' });
  const binding = { workflowId: manifest.id, manifestDigest: digest, memberId: member.ref.id, phase, revision,
    dependencyCoverage: 'declared', authority: false, mode, blockers };
  const fingerprint = hash(json(binding));
  if (blockers.length) throw Object.assign(Error(`blocked-workflow-dependencies: ${json({ ...binding, fingerprint }).trim()}`), {
    reason: 'blocked-workflow-dependencies', ...binding, fingerprint,
    recheck: { condition: 'candidate or prerequisite receipt changes', manifestDigest: digest,
      prerequisites: blockers.map(({ memberId, phase, requiredRevision, evidenceDigest }) => ({ memberId, phase, requiredRevision, evidenceDigest })) },
  });
  return { ...binding, status: 'eligible', fingerprint };
}

/** Keep one declared identity across rechecks, including blocked prerequisite decisions. */
export function createWorkflowEffectGuard(context) {
  let bound = null;
  return (mode = 'effect') => {
    const input = context();
    let result, error;
    try { result = input === null ? { status: 'standalone', authority: false, dependencyCoverage: 'undeclared' }
      : assertWorkflowEffect({ ...input, mode }); }
    catch (caught) { result = caught; error = caught; }
    const identity = result.workflowId && result.memberId ? JSON.stringify([result.workflowId, result.memberId]) : null;
    if (bound && (result.status === 'standalone' || identity && identity !== bound)) fail('effect-identity-drift');
    if (identity) bound ??= identity;
    if (error) throw error;
    return result;
  };
}

/** Record only the candidate committed by a native owner; historical receipts remain historical. */
export function rebindWorkflowCandidate({ root, repository, ref, worktreeId, previousRevision, revision, expectedDecision }) {
  const declared = expectedDecision?.status === 'eligible';
  if (!declared && expectedDecision?.status !== 'standalone' || declared && (expectedDecision.phase !== 'ci'
    || expectedDecision.mode !== 'dependencies' || expectedDecision.revision !== previousRevision)) fail('candidate-rebind-decision');
  const selected = readSelectedWorkflow(root, repository, { worktreeId, ref });
  if (!selected || selected.manifest.execution === undefined) {
    if (declared) fail('effect-identity-drift');
    return { status: 'standalone', authority: false };
  }
  const allocation = selected.manifest.allocations?.find(row => row.ref === ref);
  const member = selected.members.find(row => row.child.source.repository === repository
    && row.child.context.worktreeId === (allocation?.worktreeId ?? worktreeId));
  if (!member) {
    if (allocation) fail('allocation-member-binding');
    if (declared) fail('effect-identity-drift');
    return { status: 'standalone', authority: false };
  }
  if (!declared || expectedDecision.workflowId !== selected.manifest.id || expectedDecision.memberId !== member.ref.id) fail('effect-identity-drift');
  if (![previousRevision, revision].every(value => /^[a-f0-9]{40}$/u.test(value ?? ''))
    || !isLaneRef(ref) || allocation && allocation.state !== 'active') fail('candidate-rebind-binding');
  const registration = worktreeInventory(root).find(row => row.branch === ref && resolve(row.path) === resolve(root));
  if (!registration || registration.head !== revision || registration.detached
    || observeGit(['rev-parse', '--path-format=absolute', '--git-dir'], { cwd: root }) === commonDir(root)
    || observeGit(['rev-parse', 'HEAD'], { cwd: root }) !== revision
    || observeGit(['merge-base', '--is-ancestor', previousRevision, revision], { cwd: root, allowFail: true }) === null)
    fail('candidate-rebind-source');
  if (member.child.source.revision !== previousRevision) fail('candidate-rebind-drift');
  if (previousRevision === revision) return { status: 'unchanged', authority: false, manifest: selected.path, digest: selected.digest };
  const child = collectWorkflowValue(root, repository, { ...member.child,
    source: { repository, revision, tree: observeGit(['rev-parse', `${revision}^{tree}`], { cwd: root }) },
    phases: member.child.phases.map(phase => ({ ...phase, revision: phase.revision ?? previousRevision,
      file: join(dirname(member.path), phase.file) })),
    // Traces bind their own candidate; retain them in the previous immutable member, never relabel them.
    traces: [],
  });
  const paths = workflowPaths(root, repository), manifest = selected.manifest;
  const result = collectWorkflowValue(root, repository, { ...manifest,
    previous: { file: selected.path, digest: selected.digest },
    members: manifest.members.map(row => row.id === member.ref.id ? { ...row, file: child.manifest, digest: child.digest }
      : { ...row, file: resolve(paths.workspace, row.file) }),
    releaseEvidence: (manifest.releaseEvidence ?? []).map(row => ({ ...row, file: join(dirname(selected.path), row.file) })),
    ...(manifest.allocations === undefined ? {} : { allocations: manifest.allocations.map(row => row.ref === ref
      ? { ...row, headRevision: revision } : row) }),
  }, join(paths.workspace, 'workflow-input.json'));
  return { ...result, status: 'rebound', previousRevision, revision };
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
function planningDocument(path, text) {
  if (/prd-tad-adr-mvp-gtm\.md$/iu.test(path)) return true;
  if (!path.endsWith('.md') || !text.startsWith('---\n')) return false;
  const end = text.indexOf('\n---\n', 4);
  if (end < 4) return false;
  const frontmatter = text.slice(4, end);
  return /^doc_type:[\t ]*(?:"PRD-TAD-ADR-MVP-GTM"|'PRD-TAD-ADR-MVP-GTM'|PRD-TAD-ADR-MVP-GTM)[\t ]*$/mu.test(frontmatter);
}
function validatePlanning(root, repository, planning, checkDigest = true) {
  if (!planning || planning.repository !== repository || !/^[a-f0-9]{40}$/u.test(planning.revision ?? '')
    || typeof planning.path !== 'string' || /[\\\x00-\x1f]/u.test(planning.path) || planning.path.startsWith('/')
    || planning.path.split('/').some(part => !part || part === '..' || part === '.')
    || checkDigest && !/^[a-f0-9]{64}$/u.test(planning.digest ?? '')) fail('planning-binding');
  const entry = observeGit(['ls-tree', planning.revision, '--', planning.path], { cwd: root });
  if (!/^100644 blob [a-f0-9]{40}\t/u.test(entry ?? '')) fail('planning-file');
  const planned = observeGit(['show', `${planning.revision}:${planning.path}`], { cwd: root });
  if (Buffer.byteLength(planned) > 128000) fail('planning-budget');
  if (!planningDocument(planning.path, planned)) fail('planning-binding');
  // The native Git reader trims terminal newlines; historical group digests use that text.
  if (checkDigest && hash(planned) !== planning.digest) fail('planning-digest');
  return { repository, revision: planning.revision, path: planning.path, digest: hash(planned) };
}
/** Validate the exact committed planning join before admission performs any upstream effect. */
export function validateWorkflowPlanning(root, repository, { revision, planningPath, digest } = {}) {
  return validatePlanning(root, repository, { repository, revision, path: planningPath, digest }, digest !== undefined);
}
function validateAllocations(allocations = [], members, previous = []) {
  if (!Array.isArray(allocations) || allocations.length > 32) fail('allocation-budget');
  const keys = ['worktreeId', 'ref', 'path', 'baseRevision', 'headRevision', 'writeDigest', 'state', 'operation'];
  const identities = ['worktreeId', 'ref', 'path'], seen = identities.map(() => new Set());
  for (const row of allocations) {
    if (!row || !keys.every(key => Object.hasOwn(row, key))
      || Object.keys(row).some(key => !keys.includes(key) && !['previousWriteDigest', 'predecessorRef'].includes(key))
      || !/^[a-zA-Z0-9:._-]{1,128}$/u.test(row.worktreeId ?? '') || !isLaneRef(row.ref)
      || typeof row.path !== 'string' || row.path.length > 4096 || /[\x00-\x1f]/u.test(row.path)
      || !isAbsolute(row.path) || resolve(row.path) !== row.path
      || ![row.baseRevision, row.headRevision].every(value => /^[a-f0-9]{40}$/u.test(value ?? ''))
      || !/^[a-f0-9]{64}$/u.test(row.writeDigest ?? '') || !['pending', 'active'].includes(row.state)
      || !['create', 'readmit'].includes(row.operation)
      || Object.hasOwn(row, 'previousWriteDigest') && (row.operation !== 'readmit'
        || !/^[a-f0-9]{64}$/u.test(row.previousWriteDigest ?? ''))
      || Object.hasOwn(row, 'predecessorRef') && (row.operation !== 'readmit'
        || !isLaneRef(row.predecessorRef) || row.predecessorRef === row.ref)) fail('allocation-binding');
    identities.forEach((key, index) => { if (seen[index].has(row[key])) fail('allocation-duplicate'); seen[index].add(row[key]); });
  }
  for (const before of previous) {
    const after = allocations.find(row => row.worktreeId === before.worktreeId);
    if (!after || ['worktreeId', 'path', 'baseRevision'].some(key => after[key] !== before[key])
      || before.state === 'active' && after.state === 'pending' && after.operation !== 'readmit') fail('allocation-lineage');
    if (before.ref !== after.ref) {
      if (before.state !== 'active' || after.state !== 'pending' || after.operation !== 'readmit'
        || after.predecessorRef !== before.ref) fail('allocation-predecessor');
    } else if (after.predecessorRef !== before.predecessorRef) fail('allocation-predecessor');
    if (before.state === 'active' && after.state === 'pending') {
      if (after.previousWriteDigest !== before.writeDigest) fail('allocation-scope-proof');
    } else if (before.writeDigest !== after.writeDigest || before.operation !== after.operation
      || before.state === 'pending' && before.headRevision !== after.headRevision
      || before.state === 'pending' && before.operation === 'readmit' && (
        before.previousWriteDigest === undefined || after.state === 'pending' && after.previousWriteDigest !== before.previousWriteDigest
        || after.previousWriteDigest !== undefined && after.previousWriteDigest !== before.previousWriteDigest)) fail('allocation-scope-proof');
  }
}
function assertGroupSuccessor(manifest, older, members, load, checkSequence = false) {
  if (older.schema !== WORKFLOW_GROUP || older.id !== manifest.id || older.source.repository !== manifest.source.repository
    || JSON.stringify(older.planning) !== JSON.stringify(manifest.planning) || !Number.isSafeInteger(older.sequence)
    || checkSequence && manifest.sequence !== older.sequence + 1
    || older.members.some(ref => !members.some(next => next.id === ref.id))
    || older.releaseTargets.some(id => !manifest.releaseTargets?.includes(id))) fail('previous-binding');
  for (const ref of older.members) {
    const before = load(ref).manifest, after = load(members.find(next => next.id === ref.id)).manifest;
    if (before.source.repository !== after.source.repository || before.context.worktreeId !== after.context.worktreeId) fail('previous-member-binding');
  }
  validateWorkflowExecution(manifest.execution, members.map(ref => ({ ref, child: load(ref).manifest })), older.execution);
  validateAllocations(manifest.allocations, members, older.allocations);
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
    sequence=older.sequence+1;
  }
  const execution = manifest.execution === undefined ? older?.execution : manifest.execution;
  const allocations = manifest.allocations === undefined ? older?.allocations : manifest.allocations;
  validateWorkflowExecution(execution, members.map(ref => ({ ref, child: load(ref).manifest })));
  validateAllocations(allocations, members);
  if (older) assertGroupSuccessor({ ...manifest, execution, allocations }, older, members, load);
  const boundary=manifest.boundary??older?.boundary;
  if(boundary!==undefined && !['start','end'].includes(boundary)
    || boundary==='end' && !older?.boundary || older?.boundary==='end' && boundary!=='end')fail('boundary-transition');
  const indexRef=manifest.codebaseIndex?.snapshot??older?.codebaseIndex?.snapshot;
  let snapshot;
  if(indexRef){
    const file=isAbsolute(indexRef.file)?indexRef.file:resolve(paths.workspace,indexRef.file);
    const locator=relative(paths.workspace,file).split(sep).join('/');
    if(!locator.startsWith('.artifacts/codebase-index/') || !inside(paths.workspace,file))fail('codebase-location');
    const content=read(file,512000),value=JSON.parse(content);
    if(hash(content)!==indexRef.digest || value.schema!=='agentic-graph-agent-graph-ingest/v1'
      || value.ok!==true || value.complete!==true || !/^kg:graph:[a-f0-9]{32}$/u.test(value.graphId??'')
      || !/^[a-f0-9]{64}$/u.test(value.snapshotDigest??''))fail('codebase-binding');
    snapshot={file:locator,digest:indexRef.digest,graphId:value.graphId,snapshotDigest:value.snapshotDigest};
  }
  const stored={schema:WORKFLOW_GROUP,id:manifest.id,source:manifest.source,lifecycle:lifecycleMetadata(),planning,members,
    ...(execution === undefined ? {} : { execution }), ...(allocations === undefined ? {} : { allocations }),
    codebaseIndex:{owner:'agentic-graph',storage:'browser-workspace',authority:false,
      path:`/.workspace/${encodeURIComponent(manifest.id)}/codebase-index.ref.json`,...(snapshot?{snapshot}:{})},
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
    const navigation = boundary ? readSelectedWorkflow(root, repository) : null;
    if(boundary){
      const selected=selection(root,selectionKey(repository,'owner',stored.id)) ?? navigation?.path;
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
    if(boundary){
      // Bootstrap the previously selected legacy owner before another START moves navigation.
      if(navigation && !selection(root,selectionKey(repository,'owner',navigation.manifest.id)))
        retainSelection(root,repository,navigation);
      retainSelection(root,repository,{manifest:stored,path:manifestPath,
        members:members.map(ref=>({child:load(ref).manifest}))});
      git(['config','--local','agentic-os.workflowManifest',manifestPath],{cwd:root});
    }
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
