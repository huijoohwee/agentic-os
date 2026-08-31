/**
 * Integration oracle. Answers "is this lane already on the protected branch?"
 * as a computed fact, replacing a ledger, receipt chain, or recovery document.
 *
 * Squash merges rewrite lane commits into one new commit, so ancestry alone
 * reports a finished lane as unmerged forever. Two weaker but sufficient proofs
 * cover that: a Source-Head trailer written by the queue, and patch identity.
 */

import { git, gitLines, isAncestor, commitsAhead, headSha } from './git.mjs';

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

/** Stable patch id of an arbitrary diff, or null when the diff is empty. */
function patchId(diffArgs, { cwd } = {}) {
  const diff = git(diffArgs, { cwd, allowFail: true });
  if (!diff) return null;
  const id = git(['patch-id', '--stable'], { cwd, input: `${diff}\n`, allowFail: true });
  return id ? id.split(' ')[0] : null;
}

/**
 * A squash merge collapses N lane commits into one, so no individual lane commit
 * is patch-equivalent to anything upstream. Compare the lane's combined diff
 * against each candidate upstream commit instead.
 */
export function squashIdentityProof(base, ref, { cwd, limit = 200 } = {}) {
  const mergeBase = git(['merge-base', base, ref], { cwd, allowFail: true });
  if (!mergeBase) return null;

  const combined = patchId(['diff', `${mergeBase}...${ref}`], { cwd });
  if (!combined) return null;

  const candidates = gitLines(
    ['rev-list', `--max-count=${limit}`, `${mergeBase}..${base}`],
    { cwd },
  );
  for (const candidate of candidates) {
    if (patchId(['diff-tree', '-p', candidate], { cwd }) === combined) {
      return {
        kind: 'squash-identity',
        detail: `${base} commit ${candidate} carries this lane's combined diff`,
        pending: [],
      };
    }
  }
  return null;
}

/** Commit on `base` whose message carries a Source-Head trailer for `sha`. */
export function findSourceHeadCommit(base, sha, { cwd } = {}) {
  if (!sha) return null;
  const args = [
    'log',
    base,
    '--fixed-strings',
    `--grep=${sourceHeadTrailer(sha)}`,
    '--format=%H',
    '--max-count=1',
  ];
  const found = git(args, { cwd, allowFail: true });
  return found || null;
}

/**
 * Strongest available proof that `ref` is integrated into `base`, or null.
 *
 * @returns {{kind: 'ancestor'|'source-head-trailer'|'patch-identity',
 *            detail: string, pending: string[]} | null}
 */
export function integrationProof(base, ref, { cwd } = {}) {
  const tip = headSha(ref, cwd);
  if (!tip) return null;

  if (isAncestor(tip, base, cwd)) {
    return { kind: 'ancestor', detail: `${tip} is an ancestor of ${base}`, pending: [] };
  }

  const trailerCommit = findSourceHeadCommit(base, tip, { cwd });
  if (trailerCommit) {
    return {
      kind: 'source-head-trailer',
      detail: `${base} commit ${trailerCommit} records ${sourceHeadTrailer(tip)}`,
      pending: [],
    };
  }

  const laneCommits = commitsAhead(base, ref, cwd);
  if (laneCommits.length === 0) {
    return { kind: 'ancestor', detail: `${ref} adds no commits over ${base}`, pending: [] };
  }

  const { upstream, pending } = cherry(base, ref, { cwd });
  if (pending.length === 0 && upstream.length > 0) {
    return {
      kind: 'patch-identity',
      detail: `${upstream.length} lane commit(s) patch-equivalent to ${base}`,
      pending: [],
    };
  }

  return squashIdentityProof(base, ref, { cwd });
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
      integrated.push({ branch, proof: proof.kind, detail: proof.detail });
    } else {
      const { upstream, pending } = cherry(base, branch, { cwd });
      open.push({ branch, alreadyUpstream: upstream.length, pending: pending.length });
    }
  }
  return { integrated, open };
}
