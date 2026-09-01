#!/usr/bin/env node
/**
 * Read-only canonical-branch guard. Invoked by pre-commit and pre-push hooks.
 *
 * The profile's canonical worktree is the runtime and synchronization owner. Once
 * it becomes a work surface it drifts dirty and behind, and every lane based on
 * it inherits that drift. The guard makes the rule mechanical rather than
 * remembered.
 */

import { realpathSync } from 'node:fs';
import { commonDir, currentBranch, git, repoRoot, worktrees } from './git.mjs';
import { loadRepositoryProfileAtRef } from './git-repository.mjs';
import { isLaneRef } from './lane-id.mjs';
import { PROTECTED_BRANCH } from './worktree.mjs';

export const OVERRIDE_ENV = 'AGENTIC_OS_ALLOW_MAIN_WRITE';

export function protectedRefForRepository(root) {
  const primary = worktrees(root)[0];
  if (!primary?.branch || primary.detached || isLaneRef(primary.branch))
    throw new TypeError('primary canonical worktree identity is unavailable');
  const profile = loadRepositoryProfileAtRef({
    repository: primary.path, ref: `refs/heads/${primary.branch}`,
  });
  if (profile && profile.canonical.localRef !== `refs/heads/${primary.branch}`)
    throw new TypeError('committed profile does not bind the primary canonical branch');
  return profile?.canonical.localRef ?? `refs/heads/${PROTECTED_BRANCH}`;
}

export function evaluate({ branch, phase, override, protectedBranch = PROTECTED_BRANCH }) {
  if (override === '1') {
    return { allow: true, note: `${OVERRIDE_ENV}=1 override in effect for ${phase}` };
  }
  if (branch === protectedBranch) {
    return {
      allow: false,
      reason: 'blocked-main-authoring',
      message: [
        `refusing to ${phase} on "${protectedBranch}".`,
        '',
        `"${protectedBranch}" is the read-only runtime and sync owner. Author in a lane:`,
        '',
        '  npm run lane -- <scope>',
        '',
        'If bytes are already here, preserve the checkout and use the repository-owned recovery flow.',
        `Override only for a repository-owned operation: ${OVERRIDE_ENV}=1`,
      ].join('\n'),
    };
  }
  if (!isLaneRef(branch)) {
    return {
      allow: false,
      reason: 'blocked-non-lane-authoring',
      message: [
        `refusing to ${phase} on ${branch === null ? 'detached HEAD' : `non-lane branch "${branch}"`}.`,
        '',
        'Author only in a bound lane: agent/<device>/<scope>.',
        `Override only for a repository-owned operation: ${OVERRIDE_ENV}=1`,
      ].join('\n'),
    };
  }
  return { allow: true, note: `lane-shaped ref ${branch}` };
}

export function isBoundLane(branch, root) {
  if (!isLaneRef(branch)) return false;
  const entry = worktrees(root).find((candidate) => candidate.branch === branch);
  try {
    const gitDir = git(['rev-parse', '--path-format=absolute', '--git-dir'], { cwd: root });
    const linked = realpathSync(gitDir) !== realpathSync(commonDir(root));
    return linked && Boolean(entry) && realpathSync(entry.path) === realpathSync(root);
  } catch { return false; }
}

function main() {
  const phase = process.argv[2] ?? 'commit';
  const root = repoRoot();
  const protectedRef = protectedRefForRepository(root);
  if (phase === 'protected-ref') {
    process.stdout.write(`${protectedRef}\n`);
    return 0;
  }
  const branch = currentBranch(root);
  const protectedBranch = protectedRef.slice('refs/heads/'.length);
  const verdict = evaluate({
    branch,
    phase,
    override: process.env[OVERRIDE_ENV],
    protectedBranch,
  });
  if (verdict.allow && process.env[OVERRIDE_ENV] !== '1' && !isBoundLane(branch, root)) {
    verdict.allow = false;
    verdict.message = `refusing to ${phase}: ${branch} is not bound to this registered worktree.`;
  }
  if (verdict.allow) {
    if (process.env.AGENTIC_OS_GUARD_VERBOSE === '1' && verdict.note) {
      process.stderr.write(`agentic-os: ${verdict.note}\n`);
    }
    return 0;
  }
  process.stderr.write(`\nagentic-os: ${verdict.message}\n\n`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
