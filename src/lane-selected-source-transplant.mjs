#!/usr/bin/env node
/** Move one exact, small unpublished source delta onto a protected source while retaining the original lane. */
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicAdvanceRef, commonDir, configuredRemote, currentBranch, decodeNulFields, git, gitDir, headSha, isAncestor, observeGit, remoteRefSha, remoteTransport, repoRoot, worktrees } from './git.mjs';
import { parseTreeEntries } from './canonical-resources.mjs';
import { readBoundedFile, snapshotBoundedJson } from './catalog-input.mjs';
import { assertDevice, isLaneRef, laneRef } from './lane-id.mjs';
import * as store from './lane-records.mjs';
const SCHEMA = 'agentic-os/lane-selected-source-transplant-plan/v1', INPUT = 'agentic-os/lane-selected-source-transplant-input/v1';
const MAX = 500_000, ENTRY_MAX = 1024 * 1024, AGGREGATE = 4 * 1024 * 1024, SHA = /^[a-f0-9]{40}$/u;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value), same = (left, right) => json(left) === json(right);
const fail = (code, detail = {}) => { throw Object.assign(new Error(`blocked-lane-selected-source-transplant-${code}: ${JSON.stringify(detail)}`), { reason: `blocked-lane-selected-source-transplant-${code}`, detail }); };
const paths = raw => {
  const value = decodeNulFields(raw); if (!value || value.length > 32) fail('paths');
  return [...new Set(value)].sort().map(path => {
    if (!path || Buffer.byteLength(path) > 4096 || /[\\\x00-\x1f\x7f]/u.test(path) || path.startsWith('/') || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part))) fail('path', { path });
    return path;
  });
};
const changes = (cwd, from, to) => paths(git(['diff', '--name-only', '--no-renames', '-z', from, to, '--'], { cwd, binary: true, maxBuffer: MAX }));
const tree = (cwd, revision) => parseTreeEntries(decodeNulFields(git(['ls-tree', '-r', '-l', '-z', revision], { cwd, binary: true, maxBuffer: 4 * AGGREGATE })), 50_000);
function clean(cwd, revision) {
  if (observeGit(['diff', '--cached', '--quiet', revision, '--'], { cwd, allowFail: true }) === null
    || observeGit(['diff', '--quiet', revision, '--'], { cwd, allowFail: true }) === null
    || observeGit(['ls-files', '--unmerged'], { cwd })
    || observeGit(['ls-files', '--others', '--exclude-standard'], { cwd })) fail('dirty');
}
function noFilters(cwd, selected) {
  if (selected.some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'))) fail('filters');
  const attrs = decodeNulFields(observeGit(['--literal-pathspecs', 'check-attr', '--all', '-z', '--', ...selected], { cwd, binary: true, maxBuffer: MAX }));
  if (!attrs || attrs.some((value, index) => index % 3 === 1 && ['filter', 'working-tree-encoding', 'eol', 'text', 'merge'].includes(value))) fail('filters');
}
function privateDirectory(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('journal');
}
function location(input) {
  const id = hash(json([input.cwd, input.ref, input.expectedHead, input.expectedBase, input.targetRef, input.expectedTarget, input.selectedPaths]));
  const root = join(commonDir(input.cwd), 'agentic-os-lane-selected-source-transplant', id);
  return { journalPath: join(root, 'plan.json'), oldRef: `refs/agentic-os/lane-selected-source-transplant/${id}/old`, deltaRef: `refs/agentic-os/lane-selected-source-transplant/${id}/delta`, candidateRef: `refs/agentic-os/lane-selected-source-transplant/${id}/candidate` };
}
function direct(ref, cwd) { return observeGit(['symbolic-ref', '--quiet', ref], { cwd, allowFail: true }) === null; }
function identity(input, acceptedHead = input.expectedHead) {
  if (input.stopped !== true || !SHA.test(input.expectedHead ?? '') || !SHA.test(input.expectedBase ?? '') || !SHA.test(input.expectedTarget ?? '') || !isLaneRef(input.ref)
    || !/^refs\/remotes\/[^/]+\/.+/u.test(input.targetRef ?? '') || !isAbsolute(input.cwd) || repoRoot(input.cwd) !== input.cwd
    || currentBranch(input.cwd) !== input.ref || !worktrees(input.cwd).some(row => row.path === input.cwd && row.branch === input.ref)
    || headSha('HEAD', input.cwd) !== acceptedHead || headSha(input.targetRef, input.cwd) !== input.expectedTarget) fail('identity');
  const remote = configuredRemote(input.targetRef.split('/')[2], input.cwd), transport = remoteTransport(remote, input.cwd);
  if (remoteRefSha(remote, input.ref, input.cwd, transport.fetchUrl) !== null) fail('published');
  const parents = observeGit(['show', '--no-patch', '--format=%P', input.expectedHead], { cwd: input.cwd });
  if (parents !== input.expectedBase || !isAncestor(input.expectedBase, input.expectedTarget, input.cwd)) fail('base');
  return remote;
}
function body(plan) { return Object.fromEntries(Object.entries(plan).filter(([key]) => !['digest', 'resume', 'liveHead'].includes(key))); }
function readJournal(path) {
  privateDirectory(dirname(path)); privateDirectory(dirname(dirname(path)));
  const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) fail('journal');
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBoundedFile(path, MAX, 'selected source transplant journal'))); } catch { fail('journal'); }
  const keys = ['candidateHead', 'candidateRef', 'cwd', 'deltaHead', 'deltaRef', 'expectedBase', 'expectedHead', 'expectedTarget', 'journalPath', 'oldRef', 'recordDigest', 'ref', 'schema', 'selectedPaths', 'stopped', 'targetRef'];
  if (!value || Object.keys(value).sort().join(',') !== [...keys, 'digest'].sort().join(',') || value.schema !== SCHEMA || value.digest !== hash(json(body(value)) || '')
    || ![value.expectedBase, value.expectedHead, value.expectedTarget, value.deltaHead, value.candidateHead].every(value => SHA.test(value ?? ''))) fail('journal');
  return value;
}
function pins(plan) {
  for (const [ref, oid] of [[plan.oldRef, plan.expectedHead], [plan.deltaRef, plan.deltaHead], [plan.candidateRef, plan.candidateHead]])
    if (!direct(ref, plan.cwd) || headSha(ref, plan.cwd) !== oid) fail('journal');
}
function exactRecord(plan, candidate = false) {
  const record = store.get(plan.ref, plan.cwd);
  if (!record || record.worktree !== plan.cwd || record.base !== plan.targetRef) fail('record');
  const digest = hash(json(record));
  if (!candidate && digest !== plan.recordDigest) fail('record');
  if (candidate && (record.head !== plan.candidateHead || record.handoff?.schema !== 'agentic-os-lane-selected-source-transplant/v1'
    || record.handoff?.preservedRef !== plan.oldRef || record.handoff?.preservedHead !== plan.expectedHead)) fail('record');
  return record;
}
function candidateTree(cwd, base, source, target, selected) {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-os-lane-selected-source-transplant-'));
  const index = join(directory, 'index'), env = { GIT_INDEX_FILE: index, GIT_DIR: gitDir(cwd) };
  try {
    const sourceTree = tree(cwd, source); git(['read-tree', base], { cwd, env });
    for (const path of selected) {
      const entry = sourceTree.get(path);
      if (!entry) git(['--literal-pathspecs', 'update-index', '--force-remove', '--', path], { cwd, env });
      else git(['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.oid},${path}`], { cwd, env });
    }
    const deltaTree = git(['write-tree'], { cwd, env });
    const deltaHead = git(['-c', 'commit.gpgSign=false', 'commit-tree', deltaTree, '-p', base], { cwd,
      input: 'agentic-os exact selected-source delta\n', env: { GIT_AUTHOR_NAME: 'agentic-os', GIT_AUTHOR_EMAIL: 'transplant@agentic-os.invalid', GIT_COMMITTER_NAME: 'agentic-os', GIT_COMMITTER_EMAIL: 'transplant@agentic-os.invalid' } });
    let mergedTree; try { mergedTree = git(['merge-tree', '--write-tree', target, deltaHead], { cwd, maxBuffer: MAX }).split('\n')[0]; } catch { fail('merge'); }
    if (!SHA.test(mergedTree ?? '')) fail('merge');
    const candidateHead = git(['-c', 'commit.gpgSign=false', 'commit-tree', mergedTree, '-p', target], { cwd,
      input: 'agentic-os exact selected-source transplant\n', env: { GIT_AUTHOR_NAME: 'agentic-os', GIT_AUTHOR_EMAIL: 'transplant@agentic-os.invalid', GIT_COMMITTER_NAME: 'agentic-os', GIT_COMMITTER_EMAIL: 'transplant@agentic-os.invalid' } });
    return { deltaHead, candidateHead };
  } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
}
function verifyCandidate(plan) {
  const parents = observeGit(['show', '--no-patch', '--format=%P', plan.candidateHead], { cwd: plan.cwd });
  if (parents !== plan.expectedTarget || !same(changes(plan.cwd, plan.expectedTarget, plan.candidateHead), plan.selectedPaths)) fail('postcondition');
  const target = tree(plan.cwd, plan.expectedTarget), candidate = tree(plan.cwd, plan.candidateHead);
  for (const path of new Set([...target.keys(), ...candidate.keys()])) if (!plan.selectedPaths.includes(path) && JSON.stringify(target.get(path) ?? null) !== JSON.stringify(candidate.get(path) ?? null)) fail('postcondition', { path });
}
export function planSelectedSourceTransplant(input) {
  input = snapshotBoundedJson(input, { maxDepth: 4, maxNodes: 256, maxStringBytes: 4096, maxAggregateStringBytes: 32768, maxArrayLength: 32, maxObjectKeys: 16 });
  const keys = ['cwd', 'expectedBase', 'expectedHead', 'expectedTarget', 'ref', 'selectedPaths', 'stopped', 'targetRef'];
  if (!input || Object.keys(input).sort().join(',') !== keys.join(',') || !Array.isArray(input.selectedPaths)) fail('input');
  input = { ...input, cwd: realpathSync(resolve(input.cwd)), selectedPaths: [...new Set(input.selectedPaths)].sort() };
  if (!input.selectedPaths.length) fail('input'); paths(Buffer.from(input.selectedPaths.join('\0') + '\0'));
  const found = location(input);
  if (existsSync(found.journalPath)) {
    const stored = readJournal(found.journalPath);
    if (!same(location(input), { journalPath: stored.journalPath, oldRef: stored.oldRef, deltaRef: stored.deltaRef, candidateRef: stored.candidateRef })
      || keys.some(key => !same(stored[key], input[key]))) fail('journal');
    const liveHead = headSha('HEAD', input.cwd);
    if (liveHead !== stored.expectedHead && liveHead !== stored.candidateHead) fail('head');
    if (liveHead === stored.candidateHead) { identity(stored, stored.candidateHead); pins(stored); verifyCandidate(stored); exactRecord(stored, true); }
    return { ...stored, resume: true, liveHead };
  }
  identity(input); clean(input.cwd, input.expectedHead); noFilters(input.cwd, input.selectedPaths);
  const record = store.get(input.ref, input.cwd);
  if (!record || record.state !== 'active' || record.worktree !== input.cwd || record.base !== input.targetRef || record.head && !isAncestor(record.head, input.expectedHead, input.cwd)) fail('record');
  if (!same(changes(input.cwd, input.expectedBase, input.expectedHead), input.selectedPaths)) fail('selection');
  const sourceTree = tree(input.cwd, input.expectedHead), baseTree = tree(input.cwd, input.expectedBase), targetTree = tree(input.cwd, input.expectedTarget);
  let total = 0;
  for (const path of input.selectedPaths) for (const entry of [sourceTree.get(path), baseTree.get(path), targetTree.get(path)].filter(Boolean)) {
    if (!['100644', '100755'].includes(entry.mode) || entry.size > ENTRY_MAX || entry.size > AGGREGATE - total) fail('path', { path }); total += entry.size;
  }
  return { schema: SCHEMA, ...input, ...found, recordDigest: hash(json(record)), deltaHead: null, candidateHead: null, resume: false, liveHead: input.expectedHead };
}
export function prepareSelectedSourceTransplant(value) {
  let plan = value; if (!plan || plan.schema !== SCHEMA) fail('plan');
  if (plan.deltaHead && plan.candidateHead) { pins(plan); verifyCandidate(plan); return plan; }
  identity(plan); clean(plan.cwd, plan.expectedHead); exactRecord(plan); const built = candidateTree(plan.cwd, plan.expectedBase, plan.expectedHead, plan.expectedTarget, plan.selectedPaths);
  plan = { ...plan, ...built }; verifyCandidate(plan);
  const parent = dirname(dirname(plan.journalPath)); if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 }); privateDirectory(parent);
  if (!existsSync(dirname(plan.journalPath))) mkdirSync(dirname(plan.journalPath), { mode: 0o700 }); privateDirectory(dirname(plan.journalPath));
  const stored = { ...body(plan) }; stored.digest = hash(json(stored)); const bytes = Buffer.from(json(stored));
  if (bytes.length > MAX) fail('journal'); const descriptor = openSync(plan.journalPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeSync(descriptor, bytes); } finally { closeSync(descriptor); }
  plan = stored;
  for (const [ref, oid] of [[plan.oldRef, plan.expectedHead], [plan.deltaRef, plan.deltaHead], [plan.candidateRef, plan.candidateHead]]) {
    if (!direct(ref, plan.cwd) || headSha(ref, plan.cwd) !== null) fail('journal');
    atomicAdvanceRef(ref, oid, '0'.repeat(40), [[`refs/heads/${plan.ref}`, plan.expectedHead], [plan.targetRef, plan.expectedTarget]], plan.cwd);
  }
  return plan;
}
export function applySelectedSourceTransplant(value) {
  const plan = prepareSelectedSourceTransplant(value);
  if (headSha('HEAD', plan.cwd) === plan.candidateHead) { identity(plan, plan.candidateHead); pins(plan); verifyCandidate(plan); exactRecord(plan, true); return receipt(plan, true); }
  identity(plan); clean(plan.cwd, plan.expectedHead); pins(plan); verifyCandidate(plan); const record = exactRecord(plan);
  atomicAdvanceRef(`refs/heads/${plan.ref}`, plan.candidateHead, plan.expectedHead, [[plan.targetRef, plan.expectedTarget], [plan.oldRef, plan.expectedHead], [plan.deltaRef, plan.deltaHead], [plan.candidateRef, plan.candidateHead]], plan.cwd);
  git(['read-tree', '--reset', '-u', plan.candidateHead], { cwd: plan.cwd }); clean(plan.cwd, plan.candidateHead);
  store.putExact({ ...record, head: plan.candidateHead, handoff: { schema: 'agentic-os-lane-selected-source-transplant/v1', preservedRef: plan.oldRef, preservedHead: plan.expectedHead } }, record, plan.cwd);
  return receipt(plan, false);
}
function receipt(plan, resumed) { return { schema: 'agentic-os/lane-selected-source-transplant-receipt/v1', previousHead: plan.expectedHead, baseHead: plan.expectedBase, targetHead: plan.expectedTarget, head: plan.candidateHead, selectedPaths: plan.selectedPaths, oldRef: plan.oldRef, deltaRef: plan.deltaRef, candidateRef: plan.candidateRef, resumed, providerAuthority: false, cleanupAuthority: false }; }
export function validateSelectedSourceTransplantInput(value) {
  const input = snapshotBoundedJson(value, { maxDepth: 3, maxNodes: 128, maxStringBytes: 4096, maxAggregateStringBytes: 32768, maxArrayLength: 32, maxObjectKeys: 16 });
  const keys = ['device', 'expectedBase', 'expectedHead', 'expectedTarget', 'mission', 'paths', 'schema', 'scope', 'stopped'];
  if (!input || Object.keys(input).sort().join(',') !== keys.join(',') || input.schema !== INPUT || input.stopped !== true || ![input.expectedBase, input.expectedHead, input.expectedTarget].every(value => SHA.test(value ?? '')) || !isAbsolute(input.mission ?? '') || resolve(input.mission) !== input.mission || !Array.isArray(input.paths) || !input.paths.length) fail('input');
  assertDevice(input.device); laneRef(input.scope, input.device); paths(Buffer.from(input.paths.join('\0') + '\0')); return input;
}
