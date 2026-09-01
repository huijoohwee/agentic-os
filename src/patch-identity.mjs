/**
 * Integration oracle. Answers "is this lane already on the protected branch?"
 * as a computed local classification. It never replaces authenticated authority,
 * an Integration Receipt, or recovery evidence.
 *
 * Squash merges rewrite lane commits into one new commit, so ancestry alone
 * reports a finished lane as unmerged forever. Exact path-state identity covers
 * squash without trusting whitespace-insensitive patch IDs or commit messages.
 */

import { commitsAhead, decodeNulFields, git, gitLines, headSha, isAncestor } from './git.mjs';

export const SOURCE_HEAD_TRAILER = 'Source-Head';

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
  for (const line of gitLines(['cherry', base, ref], { cwd })) {
    const mark = line[0];
    const sha = line.slice(2).trim();
    if (mark === '-') upstream.push(sha);
    else if (mark === '+') pending.push(sha);
  }
  return { upstream, pending };
}

function changedPaths(mergeBase, tip, { cwd } = {}) {
  const output = git(
    ['diff', '--name-only', '-z', '--no-renames', mergeBase, tip],
    { cwd, binary: true, allowFail: true },
  );
  return decodeNulFields(output);
}

function treeEntry(revision, path, { cwd } = {}) {
  return git(['--literal-pathspecs', 'ls-tree', '-z', revision, '--', path], {
    cwd,
    binary: true,
    allowFail: true,
  });
}

/** Exact mode/type/blob state for every path changed by the lane. */
export function exactTreeProjectionProof(base, ref, { cwd } = {}) {
  const mergeBase = git(['merge-base', base, ref], { cwd, allowFail: true });
  if (!mergeBase) return null;
  const paths = changedPaths(mergeBase, ref, { cwd });
  if (!paths || paths.length === 0) return null;
  const mismatched = paths.filter((path) => {
    const baseEntry = treeEntry(base, path, { cwd });
    const laneEntry = treeEntry(ref, path, { cwd });
    return !Buffer.isBuffer(baseEntry) || !Buffer.isBuffer(laneEntry)
      || !baseEntry.equals(laneEntry);
  });
  if (mismatched.length > 0) return null;
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

/**
 * Whole-repository reap survey. Read-only: it decides nothing and deletes
 * nothing, it only classifies every lane branch.
 */
export function surveyLanes(base, branches, { cwd } = {}) {
  const integrated = [];
  const open = [];
  for (const branch of branches) {
    const proof = integrationProof(base, branch, { cwd });
    if (proof) {
      integrated.push({ branch, head: proof.head, baseHead: proof.baseHead,
        proof: proof.kind, detail: proof.detail });
    } else {
      const { upstream, pending } = cherry(base, branch, { cwd });
      open.push({ branch, alreadyUpstream: upstream.length, pending: pending.length });
    }
  }
  return { integrated, open };
}
