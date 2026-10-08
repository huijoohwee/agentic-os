/**
 * Integration oracle. Answers "is this lane already on the protected branch?"
 * as a computed local classification. It never replaces authenticated authority,
 * an Integration Receipt, or recovery evidence.
 *
 * Squash merges rewrite lane commits into one new commit, so ancestry alone
 * reports a finished lane as unmerged forever. Exact path-state identity covers
 * squash without trusting whitespace-insensitive patch IDs or commit messages.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { readBoundedFile } from './catalog-input.mjs';
import {
  commitsAhead, currentBranch, decodeNulFields, headSha, isAncestor, observeGit,
  observeGitLines, repoRoot, worktrees,
} from './git.mjs';
import { isLaneRef } from './lane-id.mjs';
import * as laneRecords from './lane-records.mjs';

export const SOURCE_HEAD_TRAILER = 'Source-Head';
export const SUPPORTED_CHANGE_CLASSES = Object.freeze(['docs-only']);
const DOCS_ONLY_PATTERNS = [/^docs\//u, /^guides\//u, /\.md$/u, /^AGENTS\.md$/u,
  /^README\.md$/u, /^DOCUMENTS\.md$/u, /^FLEET\.md$/u, /^PRD-.*\.md$/u];

export function classifyLaneChangeClass(targetPath) {
  const head = observeGit(['rev-parse', '--verify', 'HEAD'], { cwd: targetPath, allowFail: true });
  if (!head) return 'unknown';
  const base = observeGit(['merge-base', 'origin/main', 'HEAD'], { cwd: targetPath, allowFail: true });
  if (!base) return 'unknown';
  const paths = changedPaths(base, head, { cwd: targetPath });
  if (!paths) return 'unknown';
  if (paths.length === 0) return 'empty';
  return paths.every(path => DOCS_ONLY_PATTERNS.some(pattern => pattern.test(path))) ? 'docs-only' : 'mixed';
}

/** Local byte-preservation check only; never historical integration or cleanup authority. */
export function assertPreservedSuccessorJoins(base, tip, protectedRef, cwd) {
  const refuse = message => { throw Object.assign(new Error(message), { reason: 'blocked-successor-merge' }); };
  const joins = observeGitLines(['rev-list', '--min-parents=2', '--max-count=33', `${base}..${tip}`], { cwd });
  if (joins.length > 32) refuse('successor preserved-join inventory exceeds 32 commits');
  for (const revision of joins) {
    const parents = observeGit(['show', '--no-patch', '--format=%P', revision], { cwd }).trim().split(' ');
    if (parents.length !== 2 || !isAncestor(parents[1], protectedRef, cwd))
      refuse('successor requires an exact two-parent protected join');
    const trees = observeGitLines(['rev-parse', ...[revision, ...parents].map(value => `${value}^{tree}`)], { cwd });
    if (trees.length !== 3 || trees.some(tree => tree !== trees[0]))
      refuse('successor refuses joins that change either parent tree');
  }
}

/** Trailer line the merge queue puts in the squash message. */
export function sourceHeadTrailer(sha) {
  return `${SOURCE_HEAD_TRAILER}: ${sha}`;
}

/**
 * Patch-identity split of `ref` against `base`, via git cherry.
 * `-` means an equivalent patch already exists upstream, `+` means pending.
 */
export function cherry(base, ref, { cwd } = {}) {
  const upstream = [];
  const pending = [];
  for (const line of observeGitLines(['cherry', base, ref], { cwd })) {
    const mark = line[0];
    const sha = line.slice(2).trim();
    if (mark === '-') upstream.push(sha);
    else if (mark === '+') pending.push(sha);
  }
  return { upstream, pending };
}

function changedPaths(mergeBase, tip, { cwd } = {}) {
  const output = observeGit(
    ['diff', '--name-only', '-z', '--no-renames', mergeBase, tip],
    { cwd, binary: true, allowFail: true },
  );
  return decodeNulFields(output);
}

const PROJECTION_BATCH_PATHS = 128;
const PROJECTION_BATCH_PATH_BYTES = 32 * 1024;
const PROJECTION_BATCH_OUTPUT_BYTES = 64 * 1024;

/** Bound process arguments; parent/child selectors must never share an ls-tree query. */
function* projectionBatches(paths) {
  let batch = [], bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path) + 1;
    if (size > PROJECTION_BATCH_PATH_BYTES) { yield null; return; }
    if (batch.length >= PROJECTION_BATCH_PATHS || bytes + size > PROJECTION_BATCH_PATH_BYTES
      || batch.some((other) => path.startsWith(`${other}/`) || other.startsWith(`${path}/`))) {
      yield batch;
      batch = []; bytes = 0;
    }
    batch.push(path); bytes += size;
  }
  if (batch.length > 0) yield batch;
}

function treeEntries(revision, paths, { cwd } = {}) {
  const output = observeGit(['--literal-pathspecs', 'ls-tree', '-z', revision, '--', ...paths], {
    cwd, binary: true, allowFail: true, maxBuffer: PROJECTION_BATCH_OUTPUT_BYTES,
  });
  const records = decodeNulFields(output);
  if (!records || records.length > paths.length) return null;
  const selected = new Set(paths), seen = new Set();
  for (const record of records) {
    const tab = record.indexOf('\t'), path = record.slice(tab + 1);
    if (tab < 0 || !selected.has(path) || seen.has(path)
      || !/^(?:100(?:644|755) blob|120000 blob|160000 commit|040000 tree) [0-9a-f]{40}(?:[0-9a-f]{24})?$/u
        .test(record.slice(0, tab))) return null;
    seen.add(path);
  }
  return output;
}

/** Exact mode/type/blob state for every path changed by the lane. */
export function exactTreeProjectionProof(base, ref, { cwd } = {}) {
  const mergeBase = observeGit(['merge-base', base, ref], { cwd, allowFail: true });
  if (!mergeBase) return null;
  const paths = changedPaths(mergeBase, ref, { cwd });
  if (!paths || paths.length === 0) return null;
  // Reuse one bounded read per tree/batch, never a proof across observations or effects.
  for (const batch of projectionBatches(paths)) {
    if (batch === null) return null;
    const baseEntries = treeEntries(base, batch, { cwd });
    if (!baseEntries) return null;
    const laneEntries = treeEntries(ref, batch, { cwd });
    if (!laneEntries || !baseEntries.equals(laneEntries)) return null;
  }
  return {
    kind: 'exact-tree-projection',
    detail: `${paths.length} lane-touched path(s) exactly match ${base}`,
    pathCount: paths.length,
    pending: [],
  };
}

/** Exact historical transition in a reviewed PR series; never integration authority. */
export function reviewedEquivalentTransitionProof(merge, detached, reviewed, head, { cwd } = {}) {
  if (!headSha(merge, cwd) || !headSha(detached, cwd) || !headSha(reviewed, cwd)
    || detached === reviewed || !isAncestor(reviewed, head, cwd)
    || isAncestor(reviewed, `${merge}^`, cwd)) return null;
  const parent = revision => {
    const values = observeGit(['show', '-s', '--format=%P', revision], { cwd }).split(' ').filter(Boolean);
    return values.length === 1 ? values[0] : null;
  };
  const oldParent = parent(detached), reviewedParent = parent(reviewed);
  if (!oldParent || !reviewedParent) return null;
  const oldPaths = changedPaths(oldParent, detached, { cwd });
  const reviewedPaths = changedPaths(reviewedParent, reviewed, { cwd });
  if (!oldPaths || !reviewedPaths || !oldPaths.length || oldPaths.length > 512
    || JSON.stringify(oldPaths) !== JSON.stringify(reviewedPaths)) return null;
  for (const batch of projectionBatches(oldPaths)) {
    if (!batch) return null;
    for (const [a, b] of [[oldParent, reviewedParent], [detached, reviewed]]) {
      const left = treeEntries(a, batch, { cwd }), right = treeEntries(b, batch, { cwd });
      if (!left || !right || !left.equals(right)) return null;
    }
  }
  return { kind: 'reviewed-equivalent-superseded-transition',
    detachedHead: detached, reviewedCommit: reviewed, pathCount: oldPaths.length, sourceIntegrated: false };
}

/**
 * Strongest available proof that `ref` is integrated into `base`, or null.
 *
 * @returns {{kind: 'ancestor'|'exact-tree-projection',
 *            detail: string, pending: string[]} | null}
 */
export function integrationProof(base, ref, { cwd } = {}) {
  const baseTip = headSha(base, cwd);
  const tip = headSha(ref, cwd);
  if (!baseTip || !tip) return null;

  if (isAncestor(tip, baseTip, cwd)) {
    return { kind: 'ancestor', baseHead: baseTip, head: tip,
      detail: `${tip} is an ancestor of ${baseTip}`, pending: [] };
  }

  const laneCommits = commitsAhead(baseTip, tip, cwd);
  if (laneCommits.length === 0) {
    return { kind: 'ancestor', baseHead: baseTip, head: tip,
      detail: `${tip} adds no commits over ${baseTip}`, pending: [] };
  }

  const content = exactTreeProjectionProof(baseTip, tip, { cwd });
  return content ? { ...content, baseHead: baseTip, head: tip } : null;
}

/** Historical, explicit supersession of a lane by a reviewed successor. This is
 * content evidence, not provider authority. Compare the accepted merge tree,
 * rather than today's main tree, so later edits cannot rewrite history. */
export function successorIntegrationProof(merge, predecessor, reviewedHead, replacedPaths, { cwd } = {}) {
  const merged = headSha(merge, cwd), old = headSha(predecessor, cwd), reviewed = headSha(reviewedHead, cwd);
  if (!merged || !old || !reviewed || !isAncestor(old, reviewed, cwd)
    || !Array.isArray(replacedPaths) || replacedPaths.length > 128
    || replacedPaths.some(path => typeof path !== 'string' || !path || path.includes('\0')
      || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..'))
    || new Set(replacedPaths).size !== replacedPaths.length) return null;
  const base = observeGit(['merge-base', merged, old], { cwd, allowFail: true });
  const paths = base ? changedPaths(base, old, { cwd }) : null;
  if (!paths || paths.length === 0 || paths.length > 512 || replacedPaths.some(path => !paths.includes(path))) return null;
  const replaced = new Set(replacedPaths), observedReplacements = [];
  for (const path of paths) {
    const oldEntry = treeEntries(old, [path], { cwd });
    const mergeEntry = treeEntries(merged, [path], { cwd });
    const reviewedEntry = treeEntries(reviewed, [path], { cwd });
    if (!oldEntry || !mergeEntry || !reviewedEntry || !reviewedEntry.equals(mergeEntry)) return null;
    if (replaced.has(path)) {
      if (oldEntry.equals(mergeEntry)) return null;
      observedReplacements.push({ path, old: oldEntry.toString('utf8').split('\t')[0],
        accepted: mergeEntry.toString('utf8').split('\t')[0] });
    } else if (!oldEntry.equals(mergeEntry)) return null;
  }
  if (observedReplacements.length !== replacedPaths.length) return null;
  return { kind: 'reviewed-successor', predecessorHead: old, reviewedHead: reviewed,
    merge: merged, pathCount: paths.length, replacements: observedReplacements };
}

/**
 * Whole-repository reap survey. Read-only: it decides nothing and deletes
 * nothing, it only classifies every lane branch.
 */
export function surveyLanes(base, branches, { cwd } = {}) {
  const integrated = [];
  const open = [];
  for (const branch of branches) {
    const exactRef = branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`;
    const capturedHead = headSha(exactRef, cwd);
    if (!capturedHead) throw Object.assign(new Error(`lane ref is unavailable: ${branch}`), {
      reason: 'blocked-lane-ref-missing',
    });
    const proof = integrationProof(base, capturedHead, { cwd });
    if (proof) {
      integrated.push({ branch, head: proof.head, baseHead: proof.baseHead,
        proof: proof.kind, detail: proof.detail });
    } else {
      const { upstream, pending } = cherry(base, capturedHead, { cwd });
      open.push({ branch, alreadyUpstream: upstream.length, pending: pending.length });
    }
    const currentHead = headSha(exactRef, cwd);
    if (currentHead !== capturedHead)
      throw Object.assign(new Error(`lane ref moved during survey: ${branch}`), {
        reason: 'blocked-lane-ref-race', ref: exactRef, expectedHead: capturedHead, currentHead,
      });
  }
  return { integrated, open };
}

const RELEASE_PLAN = 'agentic-os/reservation-scope-release-plan/v1';
const RELEASE_RECEIPT = 'agentic-os/reservation-scope-release-receipt/v1';
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const scopeFailure = (reason, message) => Object.assign(new Error(message), { reason });
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const scopeDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
function exactTreeEntry(revision, path, cwd, { allowAbsent = false } = {}) {
  const entries = decodeNulFields(observeGit(['ls-tree', '-z', revision, '--', path], {
    cwd, binary: true,
  }));
  if (allowAbsent && entries?.length === 0) return null;
  if (entries?.length !== 1) throw scopeFailure('blocked-reservation-path-tree',
    `reserved path must resolve to one tracked file: ${path}`);
  const tab = entries[0].indexOf('\t'), [mode, type, oid] = entries[0].slice(0, tab).split(' ');
  if (tab < 0 || entries[0].slice(tab + 1) !== path || type !== 'blob'
    || !['100644', '100755'].includes(mode) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid))
    throw scopeFailure('blocked-reservation-path-tree', `reserved path is not a regular file: ${path}`);
  return { mode, type, oid };
}
function releaseEvidence({ path, laneHead, protectedHead, lanePathEntry, protectedPathEntry }) {
  const body = { schema: 'agentic-os/reservation-path-release/v1', path, laneHead, protectedHead,
    lanePathEntry, protectedPathEntry, bytesDiffer: canonicalJson(lanePathEntry) !== canonicalJson(protectedPathEntry) };
  return Object.freeze({ ...body, digest: scopeDigest(body) });
}
const releasedPathEvidence = record => Array.isArray(record?.handoff?.reservationPathReleases) ? record.handoff.reservationPathReleases : [];
function cleanReservedPath(path, worktree) {
  const status = observeGit(['status', '--porcelain=v1', '--untracked-files=all', '--', path], {
    cwd: worktree, binary: true,
  });
  const diff = observeGit(['diff', '--quiet', 'HEAD', '--', path], { cwd: worktree, allowFail: true });
  if (status.length || diff === null)
    throw scopeFailure('blocked-reservation-path-dirty', `reserved path has local edits: ${path}`);
}
function laneCacheDigest(cwd) {
  return scopeDigest(laneRecords.list(cwd).sort((a, b) => a.ref.localeCompare(b.ref)));
}

export function createReservationScopeReleasePlan({ cwd = process.cwd(), ref, path,
  protectedBranch, protectedRef }) {
  const root = repoRoot(cwd);
  if (currentBranch(root) !== protectedBranch || !worktrees(root).some(entry =>
    entry.branch === protectedBranch && realpathSync(entry.path) === realpathSync(root)))
    throw scopeFailure('blocked-not-canonical-worktree', 'scope release requires the registered protected worktree');
  if (!/^refs\/remotes\/[A-Za-z0-9._-]+\//u.test(protectedRef ?? '') || !isLaneRef(ref))
    throw scopeFailure('blocked-scope-release-identity', 'scope release requires exact lane and protected refs');
  const pathSegments = typeof path === 'string' ? path.split('/') : [];
  if (typeof path !== 'string' || !path || path.trim() !== path || path.startsWith('/')
    || path.endsWith('/') || path.startsWith(':') || path.includes(String.fromCharCode(92))
    || path.includes('\0') || ['*', '?', '['].some(symbol => path.includes(symbol))
    || pathSegments.some(segment => !segment || segment === '.' || segment === '..'))
    throw scopeFailure('blocked-scope-release-path', 'scope release accepts one exact normalized path');
  const protectedHead = headSha(`refs/heads/${protectedBranch}`, root);
  if (!protectedHead || headSha(protectedRef, root) !== protectedHead)
    throw scopeFailure('blocked-protected-head-drift', 'protected local and remote-tracking heads differ');
  const record = laneRecords.get(ref, root), lane = worktrees(root).find(entry => entry.branch === ref);
  const laneHead = headSha(`refs/heads/${ref}`, root);
  const activeUnpublished = record?.state === 'active' && record.pr === null
  if (!record || !record.writePaths?.includes(path) || !(record.state === 'published' || activeUnpublished)) throw scopeFailure('blocked-reservation-claim-missing', 'lane does not hold a releasable exact path claim');
  if (!lane || !laneHead || realpathSync(lane.path) !== realpathSync(record.worktree ?? '') || currentBranch(lane.path) !== ref
    || headSha('HEAD', lane.path) !== laneHead || record.state === 'published' && record.head !== laneHead) throw scopeFailure('blocked-lane-identity-drift', 'lane branch, worktree, or published cache head differs');
  cleanReservedPath(path, lane.path);
  const pathEntry = exactTreeEntry(laneHead, path, root);
  const protectedPathEntry = exactTreeEntry(protectedHead, path, root, { allowAbsent: true });
  const remote = /^refs\/remotes\/([^/]+)\//u.exec(protectedRef)?.[1] ?? null;
  if (record.state === 'published' && (!remote || headSha(`refs/remotes/${remote}/${ref}`, root) !== laneHead))
    throw scopeFailure('blocked-reservation-remote-drift', 'published lane remote ref differs from its retained head');
  const retainedPathEvidence = releaseEvidence({ path, laneHead, protectedHead, lanePathEntry: pathEntry,
    protectedPathEntry });
  if (releasedPathEvidence(record).some(item => item?.path === path))
    throw scopeFailure('blocked-reservation-path-released', 'lane path has already been released');
  const claims = laneRecords.list(root).filter(item => item.writePaths?.includes(path))
    .sort((a, b) => a.ref.localeCompare(b.ref)).map(item => ({ ref: item.ref,
      state: item.state, head: item.head ?? null, writePaths: [...item.writePaths] }));
  const plan = { schema: RELEASE_PLAN, authorizesEffects: false, repositoryRoot: root,
    protectedBranch, protectedRef, protectedHead, laneRef: ref, laneHead,
    laneState: record.state, laneRecordHead: record.head ?? null, laneWorktree: lane.path, path, pathEntry,
    protectedPathEntry, retainedPathEvidence,
    laneInventoryDigest: laneCacheDigest(root),
    exactClaims: claims, resultingWritePaths: record.writePaths.filter(item => item !== path) };
  if (!plan.resultingWritePaths.length)
    throw scopeFailure('blocked-empty-successor-scope', 'reservation release cannot empty the lane scope');
  return Object.freeze({ ...plan, planDigest: scopeDigest(plan) });
}

/** Apply only a fresh, digest-authorized plan through the lane cache CAS. */
export function applyReservationScopeRelease({ cwd = process.cwd(), plan, authorization, stopped,
  protectedBranch, protectedRef }) {
  const unsigned = plan && Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planDigest'));
  if (plan?.schema !== RELEASE_PLAN || plan.authorizesEffects !== false
    || scopeDigest(unsigned) !== plan.planDigest)
    throw scopeFailure('blocked-scope-release-plan-invalid', 'scope release plan digest or schema is invalid');
  if (authorization !== `agentic-os:scope-release:${plan.planDigest}` || stopped !== true)
    throw scopeFailure('blocked-scope-release-authorization', 'exact plan authorization and --stopped are required');
  const observe = () => createReservationScopeReleasePlan({ cwd, ref: plan.laneRef,
    path: plan.path, protectedBranch, protectedRef });
  if (canonicalJson(observe()) !== canonicalJson(plan))
    throw scopeFailure('blocked-scope-release-plan-stale', 'repository or lane facts changed after planning');
  const before = laneRecords.get(plan.laneRef, cwd);
  if (!before || canonicalJson(before.writePaths.filter(item => item !== plan.path))
    !== canonicalJson(plan.resultingWritePaths))
    throw scopeFailure('blocked-reservation-claim-missing', 'lane claim changed before compare-and-set');
  const priorReleases = releasedPathEvidence(before);
  const updated = {
    ...before,
    writePaths: plan.resultingWritePaths,
    handoff: {
      ...(before.handoff || {}),
      reservationPathReleases: [...priorReleases, plan.retainedPathEvidence],
    },
  };
  if (canonicalJson(observe()) !== canonicalJson(plan))
    throw scopeFailure('blocked-scope-release-plan-stale', 'repository facts changed before compare-and-set');
  laneRecords.putExact(updated, before, cwd);
  const after = laneRecords.get(plan.laneRef, cwd);
  if (canonicalJson(after) !== canonicalJson(updated))
    throw scopeFailure('blocked-scope-release-postcondition', 'lane cache differs after compare-and-set');
  return Object.freeze({ schema: RELEASE_RECEIPT, effectsRetained: true,
    branchBytesChanged: false, worktreeBytesChanged: false, planDigest: plan.planDigest,
    repositoryRoot: plan.repositoryRoot, laneRef: plan.laneRef, laneHead: plan.laneHead,
    laneState: plan.laneState, pathReleased: plan.path, pathEntry: plan.pathEntry,
    protectedPathEntry: plan.protectedPathEntry, retainedPathEvidence: plan.retainedPathEvidence,
    retainedAuthoredBytes: plan.retainedPathEvidence.bytesDiffer,
    previousRecordDigest: scopeDigest(before),
    resultingRecordDigest: scopeDigest(after), previousWritePaths: before.writePaths,
    resultingWritePaths: after.writePaths });
}

/** CLI adapter for `release-common scope-release`; this path remains lazy. */
export function runReservationScopeRelease(root, argv, policy, out) {
  const value = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  if (argv[0] === 'plan') {
    out(JSON.stringify(createReservationScopeReleasePlan({ cwd: root, ref: value('ref'),
      path: value('path'), protectedBranch: policy.protectedBranch, protectedRef: policy.protectedRef })));
    return 0;
  }
  const plan = JSON.parse(UTF8.decode(readBoundedFile(resolve(value('plan')), 65_536, 'scope release plan')));
  out(JSON.stringify(applyReservationScopeRelease({ cwd: root, plan, authorization: value('authorize'),
    stopped: argv.includes('--stopped'), protectedBranch: policy.protectedBranch,
    protectedRef: policy.protectedRef })));
  return 0;
}
