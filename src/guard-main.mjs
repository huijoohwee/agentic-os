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
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commonDir, currentBranch, gitDir, repoRoot, worktrees } from './git.mjs';
import { loadRepositoryTrust } from './git-repository.mjs';
import { isLaneRef } from './lane-id.mjs';

export const OVERRIDE_ENV = 'AGENTIC_OS_ALLOW_CANONICAL_WRITE';

export function protectedRefForRepository(root) {
  return loadRepositoryTrust(root).canonical.localRef;
}

export function evaluate({ branch, phase, override, protectedBranch }) {
  if (override === '1') {
    return { allow: true, note: `${OVERRIDE_ENV}=1 override in effect for ${phase}` };
  }
  if (typeof protectedBranch !== 'string' || protectedBranch.length === 0)
    throw new TypeError('canonical branch identity is required');
  if (branch === protectedBranch) {
    return {
      allow: false,
      reason: 'blocked-canonical-authoring',
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
    const directory = gitDir(root);
    const linked = realpathSync(directory) !== realpathSync(commonDir(root));
    return linked && Boolean(entry) && realpathSync(entry.path) === realpathSync(root);
  } catch { return false; }
}

function main() {
  const phase = process.argv[2] ?? 'commit';
  const override = process.env[OVERRIDE_ENV];
  if (phase !== 'protected-ref' && override === '1') {
    const verdict = evaluate({ branch: null, phase, override });
    if (process.env.AGENTIC_OS_GUARD_VERBOSE === '1')
      process.stderr.write(`agentic-os: ${verdict.note}\n`);
    return 0;
  }
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
    override,
    protectedBranch,
  });
  if (verdict.allow && override !== '1' && !isBoundLane(branch, root)) {
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

if (process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  process.exit(main());
}
