/** Native lifecycle evidence collection. Local artifacts are not execution or release authority. */
import { lstatSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { commonDir, observeGit, worktreeInventory, acquireOperationLock, finishOperationLock, assertDirectoryAncestors } from '../src/git.mjs';
import { hash, readRegular } from './agentic-os-test-inputs.mjs';
import { readWorkflowObservation, workflowObservation } from './agentic-os-workflow-observation.mjs';

import { buildArchive, readArchive, receiptClock, traceReferences } from './agentic-os-workflow-archive.mjs';

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
function decorate(observation) {
  const workflow = observation.profile.workflow;
  workflow.lifecycle = { start: 'agentic-os/docs/START-WORKFLOW.md', release: 'agentic-os/docs/RELEASE-WORKFLOW.md', phases: WORKFLOW_PHASES };
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
    })), next: 'Collect an exact workflow manifest, then export its returned stored manifest path into Canvas.' };
}
export function collectWorkflow(root, repository, input) {
  const inputPath = resolve(input), manifest = JSON.parse(read(inputPath, 32000));
  if (manifest.source?.repository !== repository) fail('repository-binding');
  if (!/^[a-f0-9]{40}$/u.test(manifest.source?.revision ?? '') || !/^[a-f0-9]{40}$/u.test(manifest.source?.tree ?? '')) fail('source-binding');
  if (observeGit(['cat-file', '-t', manifest.source.revision], { cwd: root }) !== 'commit') fail('source-binding');
  if (observeGit(['rev-parse', '--verify', `${manifest.source.revision}^{tree}`], { cwd: root }) !== manifest.source.tree) fail('tree-binding');
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
  const stored = { ...manifest, phases: manifest.phases.map(phase => ({ ...phase, file: `${phase.id}.json` })),
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
export function runWorkflow(root, argv, profile, out = console.log) {
  const operation = argv[0], input = argv.find(value => value.startsWith('--input='))?.slice(8);
  const offsetText = argv.find(value => value.startsWith('--offset='))?.slice(9);
  if (offsetText !== undefined && !/^(0|[1-9][0-9]*)$/u.test(offsetText)) fail('offset');
  const result = operation === 'targets' ? discoverWorkflowTargets(root, profile.repository)
    : operation === 'collect' ? collectWorkflow(root, profile.repository, input)
      : ['export', 'recommend'].includes(operation) ? exportWorkflow(root, profile.repository, input, operation, Number(offsetText ?? 0)) : fail('operation');
  const output = json(result);
  if (Buffer.byteLength(output) > 256000) fail('output-budget');
  out(output.trimEnd()); return 0;
}

function exportWorkflow(root, repository, input, operation, offset) {
  const path = resolve(input), manifestBytes = read(path, 32000), manifest = JSON.parse(manifestBytes);
  if (manifest.source?.repository !== repository) fail('repository-binding');
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
