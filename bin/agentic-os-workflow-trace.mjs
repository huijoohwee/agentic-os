/** On-demand, bounded repository traversal. References are navigation evidence, never execution proof. */
import { posix, resolve, dirname, basename } from 'node:path';
import { createCodebaseContext, contextPath, boundedContext } from './agentic-os-context-index.mjs';
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { hash, readGit, readRegular } from './agentic-os-test-inputs.mjs';
import { readValidationObservation } from './agentic-os-validation-observation.mjs';

const fail = reason => { throw Error(`blocked-workflow-trace:${reason}`); };
const key = ({ path, script }) => script ? `${path}#script:${script}` : path;
const scriptName = value => typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,128}$/u.test(value);
const safe = value => { try { return contextPath(value); } catch { return null; } };

export function traceWorkflow(root, input) {
  const file = resolve(input), request = JSON.parse(readRegular(dirname(file), basename(file), 16000).text);
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some(k => !['path','script','observation','view'].includes(k))
    || (request.view !== undefined && request.view !== 'mission')) fail('input');
  const entry = { path: contextPath(request.path), ...(request.script === undefined ? {} : { script: request.script }) };
  if (entry.script !== undefined && (!scriptName(entry.script) || posix.basename(entry.path) !== 'package.json')) fail('script');
  const context = createCodebaseContext({ root }), started = Date.now(), clock = performance.now(), cpu = process.cpuUsage(), files = new Map();
  const nodes = [], edges = [], unresolved = [], queue = [{ ...entry, depth: 0 }], seen = new Set(), verifications = [];
  let revision = null, bytes = 0, sourceReadBytes = 0, parsedFiles = 0, reusedFiles = 0;
  const load = path => {
    if (files.has(path)) return files.get(path);
    if (files.size >= 20 || Date.now() - started > 10000) fail('budget');
    const inspected = context.traceSource(path);
    verifications.push(inspected.verify);
    sourceReadBytes += inspected.sourceReadBytes; parsedFiles += inspected.parsedFiles; reusedFiles += inspected.reusedFiles;
    if (revision !== null && revision !== inspected.revision) fail('revision-drift');
    revision = inspected.revision;
    if (!inspected.file) return null;
    bytes += inspected.file.bytes; if (bytes > 512000) fail('source-byte-budget');
    files.set(path, inspected.file); return inspected.file;
  };
  const link = (from, target, kind, line, depth) => {
    if (edges.length >= 64) fail('edge-budget');
    edges.push({ from, to: key(target), kind, line });
    if (depth >= 6) { unresolved.push({ from, reason: 'depth-budget', target: key(target) }); return; }
    queue.push({ ...target, depth: depth + 1 });
  };
  const commandLinks = (command, from, path, line, depth) => {
    // Only literal npm-run and node-file commands. Never execute or evaluate shell text.
    for (const part of command.split(/\s*&&\s*/u)) {
      const npm = /^npm\s+(?:(?:-C|--prefix)\s+([a-zA-Z0-9_./-]+)\s+)?run\s+([a-zA-Z0-9:._-]+)\s*$/u.exec(part.trim());
      const node = /^node\s+([a-zA-Z0-9_./-]+\.[cm]?js)\s*$/u.exec(part.trim());
      const directory = posix.basename(path) === 'package.json' ? posix.dirname(path) : '.';
      if (npm) {
        const target = safe(posix.normalize(posix.join(directory, npm[1] ?? '.', 'package.json')));
        if (target) link(from, { path: target, script: npm[2] }, 'npm-script', line, depth);
        else unresolved.push({ from, line, reason: 'outside-source-boundary' });
      } else if (node) {
        const target = safe(posix.normalize(posix.join(directory, node[1])));
        if (target) link(from, { path: target }, 'node-entry', line, depth);
        else unresolved.push({ from, line, reason: 'outside-source-boundary' });
      } else unresolved.push({ from, line, reason: 'opaque-command' });
      if (unresolved.length > 64) fail('unresolved-budget');
    }
  };
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index], id = key(item);
    if (seen.has(id)) continue;
    if (nodes.length >= 20 || Date.now() - started > 10000) fail('budget');
    seen.add(id);
    let file;
    try { file = load(item.path); } catch (error) {
      if (/ENOENT/u.test(error.message)) { unresolved.push({ from: id, reason: 'missing-source' }); continue; }
      throw error;
    }
    if (!file) { unresolved.push({ from: id, reason: 'not-visible-source' }); continue; }
    nodes.push({ id, path: item.path, sha256: file.sha256, bytes: file.bytes, depth: item.depth,
      ...(item.script ? { script: item.script } : {}) });
    if (item.script) {
      const command = JSON.parse(file.text).scripts?.[item.script];
      if (typeof command !== 'string') { unresolved.push({ from: id, reason: 'script-not-declared' }); continue; }
      const line = file.text.split('\n').findIndex(value => value.includes(JSON.stringify(item.script) + ':')) + 1;
      commandLinks(command, id, item.path, line || null, item.depth);
    } else if (/\.ya?ml$/u.test(item.path)) {
      file.text.split('\n').forEach((line, index) => {
        const run = /^\s*(?:-\s+)?run:\s*(.+)$/u.exec(line);
        if (run) commandLinks(run[1], id, item.path, index + 1, item.depth);
      });
    } else {
      for (const reference of file.imports) {
        const target = reference.value.startsWith('.') ? safe(posix.normalize(posix.join(posix.dirname(item.path), reference.value))) : null;
        if (target) link(id, { path: target }, 'literal-import', reference.line, item.depth);
        else unresolved.push({ from: id, line: reference.line, reason: 'external-or-unresolved-import' });
      }
    }
  }
  // Deferred exact-byte and inventory checks bind the complete traversal before any result escapes.
  for (const verify of verifications) verify();
  if (readGit(root, ['rev-parse','HEAD']).trim() !== revision) fail('revision-drift');
  const calls = new Map();
  for (const edge of edges.filter(edge => edge.kind !== 'literal-import')) {
    const entries = calls.get(edge.to) ?? []; entries.push(edge); calls.set(edge.to, entries);
  }
  const duplicates = [...calls].filter(([, entries]) => entries.length > 1).map(([target, evidence]) => ({ target, evidence }));
  let measured = null;
  if (request.observation !== undefined) {
    if (typeof request.observation !== 'string') fail('observation-path');
    const observation = readValidationObservation(root, resolve(dirname(file), request.observation));
    const tree = readGit(root, ['rev-parse','HEAD^{tree}']).trim();
    const repository = remoteRepositoryIdentity(readGit(root, ['config','--get','remote.origin.url']).trim())?.repository;
    if (observation.source.repository !== repository || observation.source.revision !== revision || observation.source.tree !== tree || observation.source.dirty !== false
      || readGit(root, ['status','--porcelain=v1','--untracked-files=normal']).trim()) fail('observation-source-drift');
    measured = { runId: observation.runId, coverage: observation.coverage,
      ranking: [...observation.stages].filter(stage => stage.status !== 'reused').sort((a,b) => (b.elapsedMs ?? 0)-(a.elapsedMs ?? 0))
        .slice(0,5).map(({id,elapsedMs,resources,model,modelIdentityBasis}) => ({id,elapsedMs,resources,model,modelIdentityBasis})) };
  }
  const snapshotDigest = hash(JSON.stringify([...files].map(([path,file]) => [path,file.sha256]))), usage = process.cpuUsage(cpu);
  const observation = { elapsedMs: performance.now() - clock,
    cpuMs: (usage.user + usage.system) / 1000, cpuScope: 'current-process-excluding-git-children', sourceReadBytes,
    parsedFiles, reusedFiles, tokens: null, costUsd: null, grantsAuthority: false };
  const source = { revision, snapshotDigest, sourceMode: 'working-tree' }; if (request.view === 'mission') {
    const component = { id: 'agentic-os/context', revision, digest: snapshotDigest }, unknown = { cpuMs: null, peakMemoryBytes: null, tokens: null, costUsd: null };
    const spans = [{ spanId: 'source-discovery', parentSpanId: null, kind: 'source-discovery',
      operation: 'Codebase source discovery', status: 'completed', subjectDigest: snapshotDigest, component,
      timing: { startOffsetMs: 0, inclusiveMs: observation.elapsedMs, exclusiveObservedMs: null, scope: 'source-traversal-wall' }, resources: { ...unknown, cpuMs: observation.cpuMs },
      evaluation: { status: 'unevaluated' } },
    ...nodes.map(node => ({ spanId: node.id, parentSpanId: 'source-discovery', kind: 'source',
      operation: node.id, status: 'completed', subjectDigest: node.sha256, component: { id: node.path, revision, digest: node.sha256 },
      links: edges.filter(edge => edge.from === node.id && nodes.some(target => target.id === edge.to))
        .map(edge => ({ spanId: edge.to, kind: edge.kind })),
      timing: { startOffsetMs: null, inclusiveMs: null, exclusiveObservedMs: null }, resources: unknown, evaluation: { status: 'unevaluated' } }))];
    return boundedContext({ schema: 'agent-toolkit-run/v1', authority: false, runId: `source-${hash(JSON.stringify([key(entry),snapshotDigest])).slice(0,16)}`,
      status: 'completed', observedAt: Date.now(), subjectDigest: snapshotDigest, candidate: component, profile: { workflow: { source, observation, measured } },
      evaluation: { status: 'unevaluated' }, spans, page: { offset: 0, total: spans.length, nextCursor: null },
      coverage: { partial: unresolved.length > 0, expectedSpans: spans.length, droppedEvents: 0, kind: 'bounded-literal-navigation-not-runtime-call-graph', unresolved } });
  }
  return boundedContext({ schema: 'agentic-os/workflow-source-trace/v1', authority: false, executable: false,
    source,
    entry: key(entry), nodes, edges, unresolved, duplicates, measured,
    observation,
    coverage: { complete: unresolved.length === 0, kind: 'bounded-literal-navigation-not-runtime-call-graph', files: files.size, bytes },
    recommendations: [ ...(duplicates.length ? [{ id: 'duplicate-command-paths', action: 'Review repeated invocation paths at the source owner; confirm runtime overlap before removing a check.', savings: null }] : []),
      { id: measured ? 'profile-measured-stages' : 'capture-measured-baseline', action: measured
        ? 'Use the source-matched timing and resource ranking to select the next optimization; retain mandatory coverage.'
        : 'Attach a current native validation receipt to rank actual time and resources; do not infer token or cash costs from source.' } ],
  });
}
