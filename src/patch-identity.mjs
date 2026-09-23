/**
 * Integration oracle. Answers "is this lane already on the protected branch?"
 * as a computed local classification. It never replaces authenticated authority,
 * an Integration Receipt, or recovery evidence.
 *
 * Squash merges rewrite lane commits into one new commit, so ancestry alone
 * reports a finished lane as unmerged forever. Exact path-state identity covers
 * squash without trusting whitespace-insensitive patch IDs or commit messages.
 */

import {
  commitsAhead, decodeNulFields, headSha, isAncestor, observeGit, observeGitLines,
} from './git.mjs';

export const SOURCE_HEAD_TRAILER = 'Source-Head';

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
