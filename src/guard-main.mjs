#!/usr/bin/env node
/**
 * Read-only main guard. Invoked by .githooks/pre-commit and .githooks/pre-push.
 *
 * The canonical `main` worktree is the runtime and synchronization owner. Once
 * it becomes a work surface it drifts dirty and behind, and every lane based on
 * it inherits that drift. The guard makes the rule mechanical rather than
 * remembered.
 */

import { currentBranch, repoRoot } from './git.mjs';
import { isLaneRef } from './lane-id.mjs';
import { PROTECTED_BRANCH } from './worktree.mjs';

export const OVERRIDE_ENV = 'AGENTIC_OS_ALLOW_MAIN_WRITE';

export function evaluate({ branch, phase, override }) {
  if (override === '1') {
    return { allow: true, note: `${OVERRIDE_ENV}=1 override in effect for ${phase}` };
  }
  if (branch === null) {
    return { allow: true, note: 'detached HEAD is a lane provisioning step' };
  }
  if (branch === PROTECTED_BRANCH) {
    return {
      allow: false,
      reason: 'blocked-main-authoring',
      message: [
        `refusing to ${phase} on "${PROTECTED_BRANCH}".`,
        '',
        `"${PROTECTED_BRANCH}" is the read-only runtime and sync owner. Author in a lane:`,
        '',
        '  npm run lane -- <scope>',
        '',
        'If bytes are already here, move them into a lane instead of committing:',
        '',
        `  git stash push --include-untracked && npm run lane -- <scope> && git stash pop`,
        '',
        `Override only for a repository-owned operation: ${OVERRIDE_ENV}=1`,
      ].join('\n'),
    };
  }
  if (!isLaneRef(branch)) {
    return {
      allow: true,
      note: `"${branch}" is not a lane ref; lanes are agent/<device>/<scope>`,
    };
  }
  return { allow: true, note: `lane ${branch}` };
}

function main() {
  const phase = process.argv[2] ?? 'commit';
  const root = repoRoot();
  const verdict = evaluate({
    branch: currentBranch(root),
    phase,
    override: process.env[OVERRIDE_ENV],
  });
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
