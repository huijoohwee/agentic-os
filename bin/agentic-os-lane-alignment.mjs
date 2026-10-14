#!/usr/bin/env node
/** Exact disjoint or squash-equivalent protected-source refresh; imported lazily by START admission. */
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { acquireOperationLock, atomicAdvanceRef, commonDir, configuredRemote, currentBranch, decodeNulFields, finishOperationLock, git, gitDir, headSha, isAncestor, observeGit, quarantineWorktreeEntries, remoteRefSha, remoteTransport, repoRoot, retireCleanProjectionUnderExclusiveContract, worktrees } from '../src/git.mjs';
import { assertDirectoryAncestors } from '../src/git.mjs';
import { snapshotWorktreeEntry } from '../src/file-integrity.mjs';
import { abortCanonicalIndex, installStagedEntries, prepareCanonicalIndex, publishCanonicalIndex, removeStagedTree, stageTreeEntries } from '../src/canonical-staging.mjs';
import { parseTreeEntries } from '../src/canonical-resources.mjs';
import { readBoundedFile, snapshotBoundedJson } from '../src/catalog-input.mjs';
import { assertDevice, isLaneRef, laneRef } from '../src/lane-id.mjs';
import { get, putExact } from '../src/lane-records.mjs';
import { successorLineage } from '../src/lane-state.mjs';
import { gh, remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { repositoryIdentity } from '../src/github-rest.mjs';
import { flag, option, positional } from './agentic-os-argv.mjs';
const SCHEMA = 'agentic-os/lane-alignment-plan/v1', MAX = 500_000, TARGET_ENTRY_MAX = 1024 * 1024, AGGREGATE = 4 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/u, hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, detail = {}) => { throw Object.assign(new Error(`blocked-lane-alignment-${code}: ${JSON.stringify(detail)}`), { reason: `blocked-lane-alignment-${code}`, detail }); };
const json = value => JSON.stringify(value), same = (a, b) => json(a) === json(b);
const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const snapshot = value => snapshotBoundedJson(value, { maxDepth: 4, maxNodes: 4096, maxStringBytes: 4096, maxAggregateStringBytes: MAX, maxArrayLength: 256, maxObjectKeys: 32 });
function capture(path, options) { try { return snapshotWorktreeEntry(path, options); } catch (error) { fail('dirty', { path, cause: error.message }); } }
const paths = (raw, directories = false) => { const value = decodeNulFields(raw); if (!value || value.length > 256) fail('paths'); return value.map(rawPath => { const path = directories ? rawPath.replace(/\/$/u, '') : rawPath;
  if (!path || Buffer.byteLength(path) > 4096 || /[\\\x00-\x1f\x7f]/u.test(path) || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part)) || path.startsWith('/')) fail('path', { path }); return path;
}); };
function changes(cwd, from, to) { return paths(git(['diff', '--name-only', '--no-renames', '-z', from, to, '--'], { cwd, binary: true, maxBuffer: MAX })).sort(); }
function tree(cwd, revision) { return parseTreeEntries(decodeNulFields(git(['ls-tree', '-r', '-l', '-z', revision], { cwd, binary: true, maxBuffer: 4 * AGGREGATE })), 50_000); }
function entryEqual(a, b) { return (!a && !b) || Boolean(a && b && a.oid === b.oid && a.mode === b.mode); }
function cleanIndex(cwd, revision) {
  if (observeGit(['config', '--bool', 'core.sparseCheckout'], { cwd, allowFail: true }) === 'true') fail('index');
  if (observeGit(['diff', '--cached', '--ita-visible-in-index', '--quiet', revision, '--'], { cwd, allowFail: true }) === null || observeGit(['ls-files', '--unmerged'], { cwd })) fail('index');
  const entries = decodeNulFields(observeGit(['ls-files', '-v', '-z'], { cwd, binary: true }));
  if (!entries || entries.some(row => row[1] !== ' ' || row[0] === row[0].toLowerCase() || row[0] === 'S')) fail('index');
}
function identity({ cwd, ref, expectedHead, targetRef, expectedTarget, stopped }, acceptedHead = expectedHead) {
  if (stopped !== true) fail('stopped');
  if (!SHA.test(expectedHead ?? '') || !SHA.test(expectedTarget ?? '') || !isLaneRef(ref) || !/^refs\/remotes\/[^/]+\/.+/u.test(targetRef ?? '')) fail('input');
  if (!isAbsolute(cwd) || realpathSync(cwd) !== cwd || realpathSync(repoRoot(cwd)) !== cwd || gitDir(cwd) === commonDir(cwd) || currentBranch(cwd) !== ref || !worktrees(cwd).some(row => realpathSync(row.path) === cwd && row.branch === ref)) fail('path');
  if (headSha('HEAD', cwd) !== acceptedHead) fail('head');
  if (headSha(targetRef, cwd) !== expectedTarget) fail('target');
  const remote = configuredRemote(targetRef.split('/')[2], cwd), transport = remoteTransport(remote, cwd);
  if (remoteRefSha(remote, ref, cwd, transport.fetchUrl) !== null) fail('published');
  return cwd;
}
function squashBinding(input, expected = null) {
  const record = get(input.ref, input.cwd), link = successorLineage(record);
  const refuse = () => { if (expected) fail('squash-lineage'); return null; };
  if (!link || record.ref !== input.ref || record.worktree !== input.cwd
    || !['active', 'planned'].includes(record.state) || record.base !== input.targetRef) return refuse();
  const previous = get(link.predecessorRef, input.cwd), localRef = `refs/heads/${link.predecessorRef}`;
  if (!previous || previous.ref !== link.predecessorRef || previous.head !== link.predecessorHead
    || previous.worktree !== record.worktree || previous.base !== record.base
    || previous.baseSha !== record.baseSha || !['published', 'queued', 'integrated'].includes(previous.state)
    || observeGit(['symbolic-ref', '--quiet', localRef], { cwd: input.cwd, allowFail: true }) !== null
    || headSha(localRef, input.cwd) !== link.predecessorHead
    || !isAncestor(link.predecessorHead, input.expectedHead, input.cwd)) return refuse();
  const remote = configuredRemote(input.targetRef.split('/')[2], input.cwd), transport = remoteTransport(remote, input.cwd);
  if (remoteRefSha(remote, link.predecessorRef, input.cwd, transport.fetchUrl) !== link.predecessorHead) return refuse();
  const tree = headSha(`${link.predecessorHead}^{tree}`, input.cwd);
  if (!SHA.test(tree ?? '') || tree !== headSha(`${input.expectedTarget}^{tree}`, input.cwd)) return refuse();
  const binding = { ref: link.predecessorRef, head: link.predecessorHead, tree };
  if (expected && !same(binding, expected)) return refuse();
  return binding;
}
function assertSquashBinding(plan) { if (plan.squashPredecessor) squashBinding(plan, plan.squashPredecessor); }
function alignmentFences(plan) { return plan.squashPredecessor ? [[`refs/heads/${plan.squashPredecessor.ref}`, plan.squashPredecessor.head]] : []; }
function noFilters(cwd, allPaths) {
  if (allPaths.some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'))) fail('filters');
  const settings = observeGit(['config', '--get-regexp', '^(core\.autocrlf|core\.eol|merge\.default)$'], { cwd, allowFail: true }) ?? '';
  if (settings.split('\n').filter(Boolean).some(row => !/^(?:core\.(?:autocrlf false|eol native)|merge\.default text)$/u.test(row))) fail('filters');
  if (allPaths.length) {
    const attrs = decodeNulFields(observeGit(['--literal-pathspecs', 'check-attr', '--all', '-z', '--', ...allPaths], { cwd, binary: true, maxBuffer: MAX }));
    if (!attrs || attrs.some((value, index) => index % 3 === 1 && ['filter', 'working-tree-encoding', 'eol', 'text', 'merge'].includes(value))) fail('filters');
  }
}
function dirtySnapshot(cwd, revision) {
  const changed = changes(cwd, revision, 'HEAD');
  const tracked = paths(git(['diff', '--name-only', '--no-renames', '-z', revision, '--'], { cwd, binary: true, maxBuffer: MAX }));
  const untracked = paths(observeGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd, binary: true, maxBuffer: MAX }));
  const all = [...new Set([...changed, ...tracked, ...untracked])].sort(); if (all.length > 256) fail('paths');
  const budget = { bytes: 0 }, base = tree(cwd, revision);
  return all.map(path => {
    assertDirectoryAncestors(path, cwd);
    const stat = lstatSync(join(cwd, path), { throwIfNoEntry: false });
    if (!stat) return { path, status: 'deleted', mode: null, size: 0, sha256: null };
    if (!stat.isFile() || stat.isSymbolicLink()) fail('dirty', { path });
    const saved = capture(join(cwd, path), { maxBytes: MAX, aggregateBytes: AGGREGATE, budget });
    return { path, status: base.has(path) ? 'modified' : 'untracked', mode: saved.mode, size: saved.bytes.length, sha256: hash(saved.bytes) };
  });
}
function assertDirty(plan) {
  const budget = { bytes: 0 };
  for (const saved of plan.dirty) {
    assertDirectoryAncestors(saved.path, plan.cwd);
    const stat = lstatSync(join(plan.cwd, saved.path), { throwIfNoEntry: false });
    if (saved.status === 'deleted') { if (stat) fail('dirty', { path: saved.path }); continue; }
    if (!stat?.isFile() || stat.isSymbolicLink()) fail('dirty', { path: saved.path });
    const actual = capture(join(plan.cwd, saved.path), { maxBytes: MAX, aggregateBytes: AGGREGATE, budget });
    if (actual.mode !== saved.mode || actual.bytes.length !== saved.size || hash(actual.bytes) !== saved.sha256) fail('dirty', { path: saved.path });
  }
}
function verifyUnion(plan, candidate) {
  const old = tree(plan.cwd, plan.expectedHead), target = tree(plan.cwd, plan.expectedTarget), actual = tree(plan.cwd, candidate);
  assertSquashBinding(plan);
  const incoming = new Set(plan.squashPredecessor ? [] : plan.incomingPaths);
  if (changes(plan.cwd, plan.expectedHead, candidate).some(path => !incoming.has(path))) fail('postcondition');
  for (const path of new Set([...old.keys(), ...actual.keys(), ...incoming])) {
    if (!entryEqual(actual.get(path), (incoming.has(path) ? target : old).get(path))) fail('postcondition', { path });
  }
  if (!isAncestor(plan.expectedHead, candidate, plan.cwd) || !isAncestor(plan.expectedTarget, candidate, plan.cwd)) fail('postcondition');
  const parents = observeGit(['show', '--no-patch', '--format=%P', candidate], { cwd: plan.cwd });
  if (parents !== `${plan.expectedHead} ${plan.expectedTarget}`) fail('postcondition');
}
const body = plan => Object.fromEntries(Object.entries(plan).filter(([key]) => !['resume', 'liveHead', 'digest'].includes(key)));
function descriptor(value) {
  const plan = snapshot(value), required = ['schema', 'cwd', 'ref', 'expectedHead', 'targetRef', 'expectedTarget', 'stopped', 'journalPath', 'oldRef', 'candidateRef', 'mergeBase', 'authoredPaths', 'incomingPaths', 'dirty', 'candidateHead'];
  if (!plan || required.some(key => !Object.hasOwn(plan, key)) || Object.keys(plan).some(key => ![...required, 'digest', 'resume', 'liveHead', 'squashPredecessor'].includes(key)) || plan.schema !== SCHEMA || plan.stopped !== true || !SHA.test(plan.expectedHead ?? '') || !SHA.test(plan.expectedTarget ?? '') || !SHA.test(plan.mergeBase ?? '') || plan.candidateHead !== null && !SHA.test(plan.candidateHead ?? '')) fail('journal');
  if (!same(journalLocation(plan), { journalPath: plan.journalPath, oldRef: plan.oldRef, candidateRef: plan.candidateRef }) || plan.cwd !== realpathSync(plan.cwd) || observeGit(['merge-base', plan.expectedHead, plan.expectedTarget], { cwd: plan.cwd }) !== plan.mergeBase) fail('journal');
  if (!Array.isArray(plan.dirty) || !Array.isArray(plan.authoredPaths) || !Array.isArray(plan.incomingPaths) || !plan.incomingPaths.length || !same(changes(plan.cwd, plan.mergeBase, plan.expectedHead), plan.authoredPaths) || !same(changes(plan.cwd, plan.mergeBase, plan.expectedTarget), plan.incomingPaths)) fail('journal');
  if (Object.hasOwn(plan, 'squashPredecessor')) {
    const binding = plan.squashPredecessor;
    if (!binding || Object.keys(binding).sort().join(',') !== 'head,ref,tree'
      || !isLaneRef(binding.ref) || !SHA.test(binding.head ?? '') || !SHA.test(binding.tree ?? '')) fail('journal');
    assertSquashBinding(plan);
  }
  let bytes = 0;
  for (const entry of plan.dirty) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'mode,path,sha256,size,status' || !['modified', 'deleted', 'untracked'].includes(entry.status) || entry.status === 'deleted' && (entry.mode !== null || entry.size !== 0 || entry.sha256 !== null) || entry.status !== 'deleted' && (!['100644', '100755'].includes(entry.mode) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX || !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? ''))) fail('journal');
    bytes += entry.size; if (bytes > AGGREGATE) fail('journal');
  }
  const all = [...new Set([...plan.incomingPaths, ...plan.authoredPaths, ...plan.dirty.map(entry => entry.path)])]; paths(Buffer.from(all.join('\0') + '\0'));
  if (!plan.squashPredecessor && plan.incomingPaths.some(path => [...plan.authoredPaths, ...plan.dirty.map(entry => entry.path)].some(other => overlap(path, other)))) fail('journal');
  return plan;
}
function privateDirectory(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('journal');
}
function journalLocation(input) {
  const id = hash(json([input.cwd, input.ref, input.expectedHead, input.targetRef, input.expectedTarget]));
  return { journalPath: join(commonDir(input.cwd), 'agentic-os-lane-alignment', id, 'plan.json'), oldRef: `refs/agentic-os/lane-alignment/${id}/old`, candidateRef: `refs/agentic-os/lane-alignment/${id}/candidate` };
}
function readJournal(path) {
  privateDirectory(dirname(path)); privateDirectory(dirname(dirname(path)));
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('journal');
  let parsed;
  try { parsed = descriptor(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBoundedFile(path, MAX, 'alignment journal')))); } catch (error) { fail('journal', { cause: error.message }); }
  const keys = 'authoredPaths,candidateHead,candidateRef,cwd,digest,dirty,expectedHead,expectedTarget,incomingPaths,journalPath,mergeBase,oldRef,ref,schema,stopped,targetRef';
  if (!parsed || Object.keys(parsed).filter(key => key !== 'squashPredecessor').sort().join(',') !== keys || parsed.schema !== SCHEMA || parsed.digest !== hash(json(body(parsed))) || !SHA.test(parsed.candidateHead ?? '') || !SHA.test(parsed.mergeBase ?? '')) fail('journal');
  return parsed;
}
function verifyCompleted(plan) {
  recoveryPins(plan);
  identity(plan, plan.candidateHead); cleanIndex(plan.cwd, plan.candidateHead); assertDirty(plan); verifyUnion(plan, plan.candidateHead);
  const expectedPaths = plan.dirty.map(row => row.path).sort(), actual = dirtySnapshot(plan.cwd, plan.candidateHead);
  if (!same(actual, plan.dirty) || !same(actual.map(row => row.path).sort(), expectedPaths)) fail('postcondition');
  const target = tree(plan.cwd, plan.candidateHead);
  for (const path of plan.squashPredecessor ? [] : plan.incomingPaths) {
    const desired = target.get(path), stat = lstatSync(join(plan.cwd, path), { throwIfNoEntry: false });
    if (!desired) { if (stat) fail('postcondition', { path }); continue; }
    const captured = capture(join(plan.cwd, path), { maxBytes: TARGET_ENTRY_MAX });
    const bytes = git(['cat-file', 'blob', desired.oid], { cwd: plan.cwd, binary: true, maxBuffer: TARGET_ENTRY_MAX });
    if (!stat?.isFile() || captured.mode !== desired.mode || !captured.bytes.equals(bytes)) fail('postcondition', { path });
  }
}
function recoveryPins(plan, allowMissing = false) {
  for (const [ref, oid] of [[plan.oldRef, plan.expectedHead], [plan.candidateRef, plan.candidateHead]]) {
    if (observeGit(['symbolic-ref', '--quiet', ref], { cwd: plan.cwd, allowFail: true }) !== null) fail('journal');
    const actual = headSha(ref, plan.cwd); if (actual !== oid && !(allowMissing && actual === null)) fail('journal');
  }
}
/** Observe only. A retained journal may describe old HEAD or a fully verified candidate. */
export function planLaneAlignment(input) {
  input = snapshot(input); if (!input || Object.keys(input).sort().join(',') !== 'cwd,expectedHead,expectedTarget,ref,stopped,targetRef') fail('input');
  input = { ...input, cwd: realpathSync(input.cwd) };
  const location = journalLocation(input);
  if (existsSync(location.journalPath)) {
    const stored = readJournal(location.journalPath);
    if (!same(location, { journalPath: stored.journalPath, oldRef: stored.oldRef, candidateRef: stored.candidateRef }) || ['cwd', 'ref', 'expectedHead', 'targetRef', 'expectedTarget', 'stopped'].some(key => stored[key] !== input[key])) fail('journal');
    const liveHead = headSha('HEAD', input.cwd);
    if (![stored.expectedHead, stored.candidateHead].includes(liveHead)) fail('head');
    if (liveHead === stored.candidateHead) verifyCompleted(stored);
    else {
      identity(stored); cleanIndex(stored.cwd, stored.expectedHead); assertDirty(stored);
      if (!same(dirtySnapshot(stored.cwd, stored.expectedHead), stored.dirty)) fail('partial');
      recoveryPins(stored, true);
    }
    return { ...stored, resume: true, liveHead };
  }
  identity(input); cleanIndex(input.cwd, input.expectedHead);
  const mergeBase = observeGit(['merge-base', input.expectedHead, input.expectedTarget], { cwd: input.cwd });
  if (!SHA.test(mergeBase ?? '')) fail('base');
  const authoredPaths = changes(input.cwd, mergeBase, input.expectedHead), incomingPaths = changes(input.cwd, mergeBase, input.expectedTarget), dirty = dirtySnapshot(input.cwd, input.expectedHead);
  if (!incomingPaths.length) fail('empty');
  const occupied = [...authoredPaths, ...dirty.map(row => row.path)];
  const overlapping = incomingPaths.some(path => occupied.some(other => overlap(path, other)));
  const squashPredecessor = overlapping ? squashBinding(input) : null;
  if (overlapping && !squashPredecessor) fail('overlap');
  const ignored = paths(observeGit(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd: input.cwd, binary: true, maxBuffer: MAX }), true);
  if (!squashPredecessor && incomingPaths.some(path => ignored.some(other => overlap(path, other)))) fail('overlap');
  noFilters(input.cwd, [...new Set([...incomingPaths, ...occupied])]);
  const old = tree(input.cwd, input.expectedHead), target = tree(input.cwd, input.expectedTarget), budget = { bytes: 0 };
  for (const path of squashPredecessor ? [] : incomingPaths) {
    assertDirectoryAncestors(path, input.cwd, { allowMissing: true });
    for (const entry of [old.get(path), target.get(path)].filter(Boolean)) {
      if (!['100644', '100755'].includes(entry.mode) || entry.size > TARGET_ENTRY_MAX || entry.size > AGGREGATE - budget.bytes) fail('path', { path }); budget.bytes += entry.size;
    }
    const stat = lstatSync(join(input.cwd, path), { throwIfNoEntry: false });
    if (stat && !stat.isFile()) fail('path', { path });
    if (!old.has(path) && stat) fail('overlap', { path });
    if (old.has(path)) {
      const actual = capture(join(input.cwd, path), { maxBytes: TARGET_ENTRY_MAX });
      if (actual.mode !== old.get(path).mode || !actual.bytes.equals(git(['cat-file', 'blob', old.get(path).oid], { cwd: input.cwd, binary: true, maxBuffer: TARGET_ENTRY_MAX }))) fail('dirty', { path });
    }
  }
  return { schema: SCHEMA, ...input, ...location, mergeBase, authoredPaths, incomingPaths, dirty, ...(squashPredecessor ? { squashPredecessor } : {}), candidateHead: null, resume: false, liveHead: input.expectedHead };
}
/** Persist exact candidate and recovery pins before any checkout materialization. */
export function prepareLaneAlignment(plan) {
  plan = descriptor(plan); if (plan.squashPredecessor) identity(plan, headSha('HEAD', plan.cwd) === plan.candidateHead ? plan.candidateHead : plan.expectedHead);
  noFilters(plan.cwd, [...plan.incomingPaths, ...plan.authoredPaths, ...plan.dirty.map(row => row.path)]);
  const artifacts = { operation: 'lane-alignment', phase: 'preparation', effectsRetained: Boolean(plan.candidateHead), previousHead: plan.expectedHead, targetHead: plan.expectedTarget, journalPath: plan.journalPath, oldRef: plan.oldRef, candidateRef: plan.candidateRef, candidateHead: plan.candidateHead, candidateTree: null, objectWriteAttempted: false, objectWriteResultUnknown: false, journalWriteAttempted: false, journalWriteResultUnknown: false, journalPublished: false, refPinWriteAttempted: false, refPinWriteResultUnknown: false, refPinAttempted: null, oldRefObserved: false, candidateRefObserved: false, prepared: false };
  try {
  if (plan.candidateHead) {
    const stored = readJournal(plan.journalPath); if (!same(body(stored), body(plan))) fail('journal');
    artifacts.journalPublished = true; verifyUnion(plan, plan.candidateHead);
  } else {
    identity(plan); cleanIndex(plan.cwd, plan.expectedHead); assertDirty(plan);
    artifacts.effectsRetained = true; artifacts.objectWriteAttempted = true; artifacts.objectWriteResultUnknown = true;
    const merged = plan.squashPredecessor ? headSha(`${plan.expectedHead}^{tree}`, plan.cwd) : git(['merge-tree', '--write-tree', plan.expectedHead, plan.expectedTarget], { cwd: plan.cwd, maxBuffer: MAX }).split('\n')[0];
    if (!SHA.test(merged)) fail('merge'); artifacts.candidateTree = merged; artifacts.objectWriteResultUnknown = false;
    const seconds = Math.max(...[plan.expectedHead, plan.expectedTarget].map(ref => Number(observeGit(['show', '--no-patch', '--format=%ct', ref], { cwd: plan.cwd }))));
    artifacts.objectWriteResultUnknown = true;
    const candidateHead = git(['-c', 'commit.gpgSign=false', 'commit-tree', merged, '-p', plan.expectedHead, '-p', plan.expectedTarget], { cwd: plan.cwd, input: `agentic-os exact ${plan.squashPredecessor ? 'squash-equivalent' : 'disjoint'} lane alignment\n`, env: { GIT_AUTHOR_NAME: 'agentic-os', GIT_AUTHOR_EMAIL: 'alignment@agentic-os.invalid', GIT_COMMITTER_NAME: 'agentic-os', GIT_COMMITTER_EMAIL: 'alignment@agentic-os.invalid', GIT_AUTHOR_DATE: `${seconds} +0000`, GIT_COMMITTER_DATE: `${seconds} +0000` } });
    artifacts.candidateHead = candidateHead; artifacts.objectWriteResultUnknown = false; plan = { ...plan, candidateHead }; verifyUnion(plan, candidateHead);
    const parent = dirname(dirname(plan.journalPath));
    if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 }); privateDirectory(parent);
    if (!existsSync(dirname(plan.journalPath))) mkdirSync(dirname(plan.journalPath), { mode: 0o700 }); privateDirectory(dirname(plan.journalPath));
    const stored = { ...body(plan) }; stored.digest = hash(json(stored));
    const bytes = Buffer.from(json(stored)); if (bytes.length > MAX) fail('journal');
    if (existsSync(plan.journalPath)) { if (!same(readJournal(plan.journalPath), stored)) fail('journal'); }
    else {
      artifacts.journalWriteAttempted = true; artifacts.journalWriteResultUnknown = true;
      const descriptor = openSync(plan.journalPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset, bytes.length - offset); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      for (const path of [dirname(plan.journalPath), parent]) { const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)); try { fsyncSync(fd); } finally { closeSync(fd); } }
    }
    artifacts.journalPublished = true; artifacts.journalWriteResultUnknown = false; plan = { ...stored, resume: plan.resume, liveHead: plan.liveHead };
  }
  for (const [ref, oid] of [[plan.oldRef, plan.expectedHead], [plan.candidateRef, plan.candidateHead]]) {
    if (observeGit(['symbolic-ref', '--quiet', ref], { cwd: plan.cwd, allowFail: true }) !== null) fail('journal');
    const current = headSha(ref, plan.cwd); if (current && current !== oid) fail('journal');
    if (!current) { artifacts.refPinWriteAttempted = true; artifacts.refPinWriteResultUnknown = true; artifacts.refPinAttempted = ref; atomicAdvanceRef(ref, oid, '0'.repeat(40), [[`refs/heads/${plan.ref}`, plan.expectedHead], [plan.targetRef, plan.expectedTarget], ...alignmentFences(plan)], plan.cwd); artifacts.refPinWriteResultUnknown = false; }
  }
  return plan;
  } catch (error) {
    try { artifacts.journalPathExists = existsSync(plan.journalPath); for (const [ref, label] of [[plan.oldRef, 'old'], [plan.candidateRef, 'candidate']]) { const row = git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', ref], { cwd: plan.cwd, maxBuffer: 4096 }).split('\n').find(value => value.startsWith(`${ref}\0`)); const fields = row?.split('\0'); artifacts[`${label}RefCurrentOid`] = fields?.[1] ?? null; artifacts[`${label}RefSymbolicTarget`] = fields?.[2] || null; artifacts[`${label}RefObserved`] = true; } } catch (observed) { artifacts.observationError = observed.message; }
    if (artifacts.effectsRetained) Object.assign(error, { retainedOperation: true, operationError: { reason: error.reason ?? null, message: error.message }, operationArtifacts: artifacts }); throw error;
  }
}
/** Apply a disjoint clean delta or proved same-tree ancestry join; retain partial-effect evidence. */
export function applyLaneAlignment(input) {
  const plan = prepareLaneAlignment(input);
  if (headSha('HEAD', plan.cwd) === plan.candidateHead) { verifyCompleted(plan); return receipt(plan, true); }
  identity(plan); cleanIndex(plan.cwd, plan.expectedHead); assertDirty(plan);
  if (!same(dirtySnapshot(plan.cwd, plan.expectedHead), plan.dirty)) fail('partial');
  if (plan.squashPredecessor) {
    // Identical index/tree: no checkout, staging or quarantine operation is needed.
    const artifacts = { effectsRetained: true, operation: 'lane-alignment', journalPath: plan.journalPath,
      oldRef: plan.oldRef, candidateRef: plan.candidateRef, previousHead: plan.expectedHead,
      candidateHead: plan.candidateHead, targetHead: plan.expectedTarget, refPublished: false };
    try {
      assertSquashBinding(plan);
      atomicAdvanceRef(`refs/heads/${plan.ref}`, plan.candidateHead, plan.expectedHead,
        [[plan.targetRef, plan.expectedTarget], [plan.oldRef, plan.expectedHead],
          [plan.candidateRef, plan.candidateHead], ...alignmentFences(plan)], plan.cwd);
      artifacts.refPublished = true;
      verifyCompleted(plan); return receipt(plan, plan.resume);
    } catch (error) {
      throw Object.assign(error, { retainedOperation: true,
        operationError: { reason: error.reason ?? null, message: error.message }, operationArtifacts: artifacts,
        recovery: 'Preserve journal, refs and bytes; reobserve the exact ancestry join before retrying.' });
    }
  }
  const old = tree(plan.cwd, plan.expectedHead), target = tree(plan.cwd, plan.candidateHead), limits = { maxEntryBytes: TARGET_ENTRY_MAX, maxAggregateBytes: AGGREGATE, maxParentDirectories: 1024 };
  const source = plan.incomingPaths.filter(path => old.has(path)).map(path => ({ path, ...old.get(path) }));
  const targets = plan.incomingPaths.filter(path => target.has(path)).map(path => ({ path, ...target.get(path) }));
  let index, staging; const artifacts = { effectsRetained: true, operation: 'lane-alignment', journalPath: plan.journalPath, oldRef: plan.oldRef, candidateRef: plan.candidateRef, previousHead: plan.expectedHead, candidateHead: plan.candidateHead, quarantinePath: null, installed: false, indexPublished: false, refPublished: false };
  try {
    index = prepareCanonicalIndex(plan.candidateHead, plan.cwd, AGGREGATE);
    staging = stageTreeEntries('agentic-os-lane-alignment-target', plan.candidateHead, targets, limits, plan.cwd);
    const exclusive = `agentic-os:lane-alignment:exclusive:${plan.digest}`;
    const preserved = quarantineWorktreeEntries('agentic-os-lane-alignment-source', source, (entry, slot, root) => {
      assertDirty(plan);
      const saved = capture(join(root, slot), { maxBytes: TARGET_ENTRY_MAX });
      if (saved.mode !== entry.mode || !saved.bytes.equals(git(['cat-file', 'blob', entry.oid], { cwd: plan.cwd, binary: true, maxBuffer: TARGET_ENTRY_MAX }))) fail('postcondition');
    }, plan.cwd, Buffer.from(json({ schema: SCHEMA, digest: plan.digest, exclusiveContract: exclusive })), { maxEntryBytes: TARGET_ENTRY_MAX, maxAggregateBytes: AGGREGATE, maxManifestBytes: MAX });
    artifacts.quarantinePath = preserved.path;
    preserved.verify(); identity(plan); assertDirty(plan);
    retireCleanProjectionUnderExclusiveContract(preserved, { exclusiveContract: exclusive, inventoryCount: 0 });
    installStagedEntries(staging.path, targets, plan.cwd, limits); artifacts.installed = true;
    publishCanonicalIndex(index); artifacts.indexPublished = true;
    atomicAdvanceRef(`refs/heads/${plan.ref}`, plan.candidateHead, plan.expectedHead, [[plan.targetRef, plan.expectedTarget], [plan.oldRef, plan.expectedHead], [plan.candidateRef, plan.candidateHead]], plan.cwd); artifacts.refPublished = true;
    verifyCompleted(plan); removeStagedTree(staging); return { ...receipt(plan, plan.resume), quarantinePath: preserved.path, quarantineManifestPath: preserved.manifestPath };
  } catch (error) {
    if (index && !index.published) try { abortCanonicalIndex(index); } catch (caught) { artifacts.indexCleanupError = caught.message; }
    throw Object.assign(error, { retainedOperation: true, operationError: { reason: error.reason ?? null, message: error.message }, operationArtifacts: { ...artifacts, stagingPath: staging?.path ?? null }, recovery: 'Preserve journal and bytes; retry only an exact completed source effect. Partial materialization requires reviewed native recovery.' });
  }
}
function receipt(plan, resumed) { return { ...(plan.squashPredecessor ? { squashPredecessor: plan.squashPredecessor } : {}), schema: 'agentic-os/lane-alignment-receipt/v1', previousHead: plan.expectedHead, head: plan.candidateHead, targetHead: plan.expectedTarget, preservedDirtyPaths: plan.dirty.map(row => row.path), incomingPaths: plan.incomingPaths, journalPath: plan.journalPath, oldRef: plan.oldRef, candidateRef: plan.candidateRef, resumed }; }
export function validateLaneAlignmentInput(value) {
  const input = snapshotBoundedJson(value, { maxDepth: 2, maxNodes: 16, maxStringBytes: 4096, maxAggregateStringBytes: 16384, maxArrayLength: 0, maxObjectKeys: 8 });
  if (!input || Object.keys(input).sort().join(',') !== 'device,expectedHead,expectedTarget,mission,schema,scope,stopped' || input.schema !== 'agentic-os/lane-alignment-input/v1' || input.stopped !== true || !SHA.test(input.expectedHead ?? '') || !SHA.test(input.expectedTarget ?? '') || !isAbsolute(input.mission ?? '') || resolve(input.mission) !== input.mission || /[\x00-\x1f]/u.test(input.mission)) fail('input');
  assertDevice(input.device); laneRef(input.scope, input.device); return input;
}
const PROVIDER_REBIND_SCHEMA = 'agentic-os/provider-lane-rebind-plan/v1';
const providerRebindHash = value => createHash('sha256').update(value).digest('hex');
const providerRebindJson = value => Array.isArray(value) ? `[${value.map(providerRebindJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${providerRebindJson(value[key])}`).join(',')}}` : JSON.stringify(value);
const providerRebindDigest = value => providerRebindHash(providerRebindJson(value));
const providerRebindBlock = (reason, message) => Object.assign(new Error(message), {
  reason: `blocked-lane-provider-rebind-${reason}`,
});
function providerPathRange(left, right, cwd) {
  const value = observeGit(['diff', '--name-only', '-z', '--no-renames', left, right], {
    cwd, binary: true, allowFail: true,
  });
  const paths = value === null ? null : decodeNulFields(value);
  if (!paths || paths.length > 1_024) throw providerRebindBlock('path-budget', 'provider refresh path range is unavailable or exceeds 1,024 paths');
  return [...new Set(paths)].sort();
}
function providerWorktreeMatchesRevision(worktree, revision) {
  return observeGit(['diff', '--quiet', revision, '--'], { cwd: worktree, allowFail: true }) === ''
    && observeGit(['diff', '--cached', '--quiet', revision, '--'], { cwd: worktree, allowFail: true }) === '';
}
function providerUntrackedPaths(worktree) {
  const read = args => decodeNulFields(observeGit(args, { cwd: worktree, binary: true }) ?? Buffer.alloc(0));
  return [...new Set([
    ...read(['ls-files', '--others', '--directory', '--exclude-standard', '-z']),
    ...read(['ls-files', '--others', '--directory', '--ignored', '--exclude-standard', '-z']),
  ].map(path => path.replace(/\/$/u, '')).filter(Boolean))].sort();
}
function providerAssertNoCollision(plan) {
  const paths = providerUntrackedPaths(plan.worktree), overlaps = (left, right) => left === right
    || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  if (plan.changedPaths.some(path => paths.some(local => overlaps(path, local))))
    throw providerRebindBlock('untracked-collision', 'provider update would replace or cover a visible or ignored local path');
}
function providerReview({ profile, pr, root, provider }) {
  const identity = repositoryIdentity(profile.repository);
  if (!identity) throw providerRebindBlock('repository', 'provider profile has no exact host-qualified repository identity');
  const raw = provider(['api', `repos/${identity.name}/pulls/${pr}`, '--hostname', identity.host], { cwd: root, json: true });
  if (!raw || typeof raw !== 'object') throw providerRebindBlock('provider-read', 'GitHub PR observation failed');
  const review = { number: raw.number, state: raw.state,
    head: { sha: raw.head?.sha, ref: raw.head?.ref, repository: raw.head?.repo?.full_name ?? null },
    base: { sha: raw.base?.sha, ref: raw.base?.ref, repository: raw.base?.repo?.full_name ?? null } };
  if (review.number !== pr || !['open', 'closed'].includes(review.state))
    throw providerRebindBlock('provider-shape', 'GitHub PR observation is incomplete or has an unsupported state');
  return review;
}
function providerRefreshPostcondition(plan, root) {
  const row = worktrees(root).find(item => item.branch === plan.ref);
  return headSha(`refs/heads/${plan.ref}`, root) === plan.head && row?.path === plan.worktree
    && currentBranch(plan.worktree) === plan.ref && headSha('HEAD', plan.worktree) === plan.head
    && observeGit(['status', '--porcelain=v2', '--untracked-files=no'], { cwd: plan.worktree }) === '';
}
function providerRefreshReceipt(plan, resumed) {
  return { schema: 'agentic-os/provider-lane-rebind-receipt/v1', ref: plan.ref, pr: plan.pr,
    worktree: plan.worktree, previousHead: plan.previousHead, head: plan.head,
    previousBaseSha: plan.previousBaseSha, baseSha: plan.baseSha, planDigest: plan.digest, providerVerified: true,
    providerAuthority: false, integrationProof: false, cleanupAuthority: false, deploymentAuthority: false,
    retainedRefs: true, resumed };
}
export function planProviderLaneRefresh({ cwd = process.cwd(), ref, pr, expectedHead, expectedBase,
  profile, provider = gh, remoteReader = remoteRefSha }) {
  const root = repoRoot(cwd), branch = profile?.canonical?.localRef?.replace(/^refs\/heads\//u, '');
  if (!isLaneRef(ref) || !Number.isSafeInteger(pr) || pr < 1
    || !/^[0-9a-f]{40}$/u.test(expectedHead ?? '') || !/^[0-9a-f]{40}$/u.test(expectedBase ?? ''))
    throw providerRebindBlock('request', 'provider refresh requires an exact lane, PR, head SHA and base SHA');
  if (!branch || currentBranch(root) !== branch
    || observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: root }) !== '')
    throw providerRebindBlock('canonical', 'provider refresh must run from clean canonical main');
  const record = get(ref, root), worktree = record?.worktree;
  if (!record || record.state !== 'published' || record.pr !== pr || record.base !== profile.canonical.remoteRef
    || !/^[0-9a-f]{40}$/u.test(record.head ?? '') || !/^[0-9a-f]{40}$/u.test(record.baseSha ?? '')
    || !existsSync(worktree ?? '')) throw providerRebindBlock('record', 'one exact published PR-bound lane record and mounted worktree are required');
  const mounted = worktrees(root).find(row => row.branch === ref && row.path === worktree);
  if (!mounted || currentBranch(worktree) !== ref || headSha('HEAD', worktree) !== record.head
    || headSha(`refs/heads/${ref}`, root) !== record.head)
    throw providerRebindBlock('identity', 'mounted worktree, local lane ref and published record must match');
  if (observeGit(['diff', '--quiet', 'HEAD', '--'], { cwd: worktree, allowFail: true }) !== ''
    || observeGit(['diff', '--cached', '--quiet', 'HEAD', '--'], { cwd: worktree, allowFail: true }) !== '')
    throw providerRebindBlock('dirty', 'tracked worktree or index changes must be resolved before provider refresh');
  const remote = record.base.match(/^refs\/remotes\/([^/]+)\//u)?.[1], transport = remote && remoteTransport(remote, root);
  const configuredIdentity = repositoryIdentity(profile.repository), observedIdentity = transport && remoteRepositoryIdentity(transport.fetchUrl);
  if (!remote || !configuredIdentity || !observedIdentity || configuredIdentity.host !== observedIdentity.host
    || configuredIdentity.name !== observedIdentity.name)
    throw providerRebindBlock('repository', 'configured repository and protected Git remote do not match');
  const review = providerReview({ profile, pr, root, provider }), providerName = configuredIdentity.name;
  const baseBranch = branch;
  if (review.state !== 'open' || review.head.ref !== ref || review.head.repository !== providerName
    || review.base.ref !== baseBranch || review.base.repository !== providerName
    || review.head.sha !== expectedHead || review.base.sha !== expectedBase)
    throw providerRebindBlock('provider-binding', 'live PR repository, branch, head, base or state differs from the exact request');
  const remoteHead = remoteReader(remote, ref, root, transport.fetchUrl);
  if (remoteHead !== expectedHead || headSha(record.base, root) !== expectedBase
    || headSha(profile.canonical.localRef, root) !== expectedBase)
    throw providerRebindBlock('remote-binding', 'live source ref and clean canonical base must match the provider PR');
  if (record.head === expectedHead || record.baseSha === expectedBase
    || observeGit(['merge-base', '--is-ancestor', record.baseSha, expectedBase], { cwd: root, allowFail: true }) !== ''
    || observeGit(['merge-base', '--is-ancestor', record.head, expectedHead], { cwd: root, allowFail: true }) !== '')
    throw providerRebindBlock('ancestry', 'provider update must advance the published head and protected base');
  const parents = (observeGit(['rev-list', '--parents', '-n', '1', expectedHead], { cwd: root }) ?? '').split(/\s+/u);
  if (parents.length !== 3 || parents[0] !== expectedHead || parents[1] !== record.head || parents[2] !== expectedBase)
    throw providerRebindBlock('merge-shape', 'provider head must be the exact two-parent update merge of the old lane head and current base');
  const mergeTree = observeGit(['merge-tree', '--write-tree', record.head, expectedBase], { cwd: root, allowFail: true })
    ?.trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(mergeTree ?? '') || headSha(`${expectedHead}^{tree}`, root) !== mergeTree)
    throw providerRebindBlock('merge-tree', 'provider merge tree does not equal the locally verified merge result');
  const reserved = [...new Set(record.writePaths ?? [])].sort();
  if (!reserved.length || reserved.length > 1_024) throw providerRebindBlock('reservation', 'published lane reservation is empty or exceeds its bound');
  const sourcePaths = providerPathRange(expectedBase, expectedHead, root);
  const changedPaths = providerPathRange(record.head, expectedHead, root);
  const covered = path => reserved.some(parent => path === parent || path.startsWith(`${parent}/`));
  if (!sourcePaths.length || sourcePaths.some(path => !covered(path)))
    throw providerRebindBlock('reservation', 'updated PR projection escapes the original lane reservation');
  const untracked = providerUntrackedPaths(worktree), overlaps = (left, right) => left === right
    || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  if (changedPaths.some(path => untracked.some(local => overlaps(path, local))))
    throw providerRebindBlock('untracked-collision', 'provider update would replace or cover a visible or ignored local path');
  const expectedRefs = [...new Map([[record.base, expectedBase], [profile.canonical.localRef, expectedBase]])];
  const body = { schema: PROVIDER_REBIND_SCHEMA, root, ref, pr, worktree, previousHead: record.head,
    previousBaseSha: record.baseSha, head: expectedHead, base: record.base, baseSha: expectedBase,
    providerReview: review, remoteHead, sourcePaths, changedPaths, reservation: reserved,
    untrackedPathsSha256: providerRebindHash(JSON.stringify(untracked)),
    previousRecordSha256: providerRebindDigest(record), expectedRefs, profileDigest: profile.profileDigest,
    updatedRecord: { ...record, head: expectedHead, baseSha: expectedBase },
    request: { ref, pr, expectedHead, expectedBase } };
  return { ...body, digest: providerRebindDigest(body) };
}
function readProviderLaneRefreshPlan(path) {
  let value;
  try { value = JSON.parse(readBoundedFile(path, 128_000, 'provider lane rebind plan').toString('utf8')); }
  catch { throw providerRebindBlock('plan', 'plan file is unreadable, non-regular or exceeds its 128,000-byte bound'); }
  const { digest, authorization, ...body } = value ?? {};
  if (body.schema !== PROVIDER_REBIND_SCHEMA || typeof digest !== 'string'
    || digest !== providerRebindDigest(body) || authorization !== undefined
      && authorization !== `agentic-os:provider-lane-rebind:${digest}`)
    throw providerRebindBlock('plan', 'plan schema, digest or embedded authorization is invalid');
  return value;
}
export function applyProviderLaneRefresh({ cwd = process.cwd(), planPath, authorization, stopped,
  profile, provider = gh, remoteReader = remoteRefSha }) {
  if (!stopped) throw providerRebindBlock('stopped', 'apply requires --stopped after writers have stopped');
  const root = repoRoot(cwd), plan = readProviderLaneRefreshPlan(resolve(planPath));
  if (root !== plan.root || profile?.profileDigest !== plan.profileDigest
    || authorization !== `agentic-os:provider-lane-rebind:${plan.digest}`)
    throw providerRebindBlock('authorization', 'repository, profile or exact plan authorization differs');
  const lock = acquireOperationLock('agentic-os-provider-lane-rebind', root);
  if (!lock) throw providerRebindBlock('busy', 'another provider lane rebind owns the clone-wide operation lock');
  let result, error = null;
  try {
    const current = get(plan.ref, root);
    if (current && providerRebindDigest(current) === providerRebindDigest(plan.updatedRecord) && providerRefreshPostcondition(plan, root)) {
      const review = providerReview({ profile, pr: plan.pr, root, provider });
      const remote = plan.base.match(/^refs\/remotes\/([^/]+)\//u)?.[1], transport = remoteTransport(remote, root);
      if (providerRebindDigest(review) !== providerRebindDigest(plan.providerReview)
        || remoteReader(remote, plan.ref, root, transport.fetchUrl) !== plan.head)
        throw providerRebindBlock('provider-drift', 'provider PR or source ref moved after the lane was refreshed');
      result = providerRefreshReceipt(plan, true);
    } else {
      if (!current || providerRebindDigest(current) !== plan.previousRecordSha256)
        throw providerRebindBlock('record-drift', 'published lane record changed after planning');
      if (headSha(`refs/heads/${plan.ref}`, root) === plan.head) {
        const remote = plan.base.match(/^refs\/remotes\/([^/]+)\//u)?.[1], transport = remoteTransport(remote, root);
        const review = providerReview({ profile, pr: plan.pr, root, provider });
        if (providerRebindDigest(review) !== providerRebindDigest(plan.providerReview)
          || remoteReader(remote, plan.ref, root, transport.fetchUrl) !== plan.head
          || plan.expectedRefs.some(([name, sha]) => headSha(name, root) !== sha)
          || !worktrees(root).some(row => row.branch === plan.ref && row.path === plan.worktree)
          || currentBranch(plan.worktree) !== plan.ref || headSha('HEAD', plan.worktree) !== plan.head)
          throw providerRebindBlock('recovery-binding', 'partially applied provider refresh no longer matches its exact provider and ref plan');
        if (!providerWorktreeMatchesRevision(plan.worktree, plan.previousHead))
          throw providerRebindBlock('recovery-bytes', 'resume requires tracked index and worktree bytes to remain at the exact previous head');
        providerAssertNoCollision(plan);
        git(['reset', '--hard', '--no-recurse-submodules', plan.head], { cwd: plan.worktree });
        if (!providerRefreshPostcondition(plan, root)
          || plan.expectedRefs.some(([name, sha]) => headSha(name, root) !== sha))
          throw providerRebindBlock('recovery-postcondition', 'resumed provider refresh did not reach its exact planned head');
        putExact(plan.updatedRecord, current, root);
        result = providerRefreshReceipt(plan, true);
      } else {
      let fresh;
      try { fresh = planProviderLaneRefresh({ cwd: root, ...plan.request, profile, provider, remoteReader }); }
      catch (caught) {
        if (caught.reason?.startsWith('blocked-lane-provider-rebind-'))
          throw providerRebindBlock('stale-plan', 'provider, refs, reservation or worktree changed after planning');
        throw caught;
      }
      if (fresh.digest !== plan.digest) throw providerRebindBlock('stale-plan', 'provider, refs, reservation or worktree changed after planning');
      atomicAdvanceRef(`refs/heads/${plan.ref}`, plan.head, plan.previousHead, plan.expectedRefs, root);
      providerAssertNoCollision(plan);
      git(['reset', '--hard', '--no-recurse-submodules', plan.head], { cwd: plan.worktree });
      if (plan.expectedRefs.some(([name, sha]) => headSha(name, root) !== sha)
        || !providerRefreshPostcondition(plan, root))
        throw providerRebindBlock('postcondition', 'exact provider head refresh did not satisfy the planned local postcondition');
      putExact(plan.updatedRecord, current, root);
      result = providerRefreshReceipt(plan, false);
      }
    }
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'provider lane rebind', result, error,
    artifacts: error?.reason?.startsWith('blocked-lane-provider-rebind-') ? {
      planDigest: plan.digest, ref: plan.ref, pr: plan.pr, worktree: plan.worktree,
      previousHead: plan.previousHead, targetHead: plan.head, refsMayHaveAdvanced: headSha(`refs/heads/${plan.ref}`, root) === plan.head,
    } : null });
}
export function runProviderLaneRefresh(root, argv, profile, out) {
  try {
    if (positional(argv)[0] === 'plan') {
      const plan = planProviderLaneRefresh({ cwd: root, profile, ref: option(argv, 'ref'), pr: Number(option(argv, 'pr')),
        expectedHead: option(argv, 'expected-head'), expectedBase: option(argv, 'expected-base') });
      out(JSON.stringify({ ...plan, authorization: `agentic-os:provider-lane-rebind:${plan.digest}` })); return 0;
    }
    out(JSON.stringify(applyProviderLaneRefresh({ cwd: root, planPath: option(argv, 'plan'),
      authorization: option(argv, 'authorize'), stopped: flag(argv, 'stopped'), profile }))); return 0;
  } catch (error) { out(JSON.stringify({ error: error.reason ?? 'blocked-lane-provider-rebind', message: error.message })); return 1; }
}

async function main() {
  const argv = process.argv.slice(2); if (argv.length !== 1 || !argv[0].startsWith('--input=') || !argv[0].slice(8)) fail('input');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBoundedFile(resolve(argv[0].slice(8)), MAX, 'lane alignment input')));
  const root = repoRoot(process.cwd()), { trustedRepositoryProfile, repositoryKind } = await import('./agentic-os-auxiliary.mjs');
  const { profile } = trustedRepositoryProfile(root, { allowUnanchored: false });
  if (!profile || repositoryKind(profile) !== 'git') fail('profile');
  const { providerPolicy } = await import('../src/lane-state.mjs'), policy = providerPolicy(profile);
  const store = await import('../src/lane-records.mjs'), { cmdStart } = await import('./agentic-os-admission.mjs');
  if (raw?.schema === 'agentic-os/lane-selected-source-transplant-input/v1') {
    const owner = await import('../src/lane-selected-source-transplant.mjs'), input = owner.validateSelectedSourceTransplantInput(raw);
    return cmdStart(root, [input.scope, `--device=${input.device}`, `--mission=${input.mission}`, `--expected-head=${input.expectedHead}`, '--readmit'], policy, profile, {
      out: text => process.stdout.write(`${text}\n`), err: text => process.stderr.write(`${text}\n`), projectCache: (record, cwd) => store.put(record, cwd), effectReceipt: (_operation, value) => value,
      remoteName: (value, cwd) => configuredRemote(value.protectedRef.split('/')[2], cwd), requireCanonical: (cwd, value) => { if (currentBranch(cwd) !== value.protectedBranch) fail('canonical'); }, refresh: { expectedTarget: input.expectedTarget, stopped: true, input: { expectedBase: input.expectedBase, selectedPaths: input.paths }, owner: { plan: owner.planSelectedSourceTransplant, prepare: owner.prepareSelectedSourceTransplant, apply: owner.applySelectedSourceTransplant } },
    });
  }
  const input = validateLaneAlignmentInput(raw);
  return cmdStart(root, [input.scope, `--device=${input.device}`, `--mission=${input.mission}`, `--expected-head=${input.expectedHead}`, '--readmit'], policy, profile, {
    out: text => process.stdout.write(`${text}\n`), err: text => process.stderr.write(`${text}\n`), projectCache: (record, cwd) => store.put(record, cwd), effectReceipt: (_operation, value) => value,
    remoteName: (value, cwd) => configuredRemote(value.protectedRef.split('/')[2], cwd), requireCanonical: (cwd, value) => { if (currentBranch(cwd) !== value.protectedBranch) fail('canonical'); }, refresh: { expectedTarget: input.expectedTarget, stopped: true, owner: { plan: planLaneAlignment, prepare: prepareLaneAlignment, apply: applyLaneAlignment } },
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(async error => { const { formatRetainedOperation } = await import('./agentic-os-report.mjs'); const retained = formatRetainedOperation(error); if (retained) process.stderr.write(`${retained}\n`); process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
