/** Git-native removal for one freshly proven clean linked worktree. */
import { canonicalJson } from './governance.mjs';
import { observeGit, commonDir } from './git.mjs';
import { realpathSync } from 'node:fs';
import { observeWorktreeCleanupTarget, verifyCleanWorktreeRemoval } from './cleanup-quarantine.mjs';
import { createRetirementOpenReaderProbe } from '../bin/agentic-os-cleanup-user.mjs';

function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }

export function removeCleanWorktreeTarget(plan, before, {
  cwd = process.cwd(), authorizeEffects, observePolicy,
} = {}) {
  if (before.cleanupMode !== 'remove-clean' || before.cleanRemovalEligible !== true
    || typeof authorizeEffects !== 'function')
    fail('blocked-clean-removal-ineligible', 'clean removal requires the selected policy and a clean byte inventory');
  const controller = realpathSync(cwd);
  if (realpathSync(commonDir(controller)) !== before.commonDirectory)
    fail('blocked-clean-removal-controller', 'cleanup controller clone changed');
  const executedAt = authorizeEffects();
  const fresh = observeWorktreeCleanupTarget(plan, { cwd: controller,
    observePolicy, forceFreshRecoveryInventory: true });
  if (canonicalJson(fresh) !== canonicalJson(before) || !fresh.cleanRemovalEligible)
    fail('blocked-clean-removal-drift', 'worktree bytes or shared Git state changed before removal');
  createRetirementOpenReaderProbe()(plan.targetPath);
  observeGit(['worktree', 'remove', '--', plan.targetPath], { cwd: controller });
  verifyCleanWorktreeRemoval(plan, before, { cwd: controller });
  return {
    artifacts: { worktreeRemoved: true, registrationRemoved: true,
      branchRetained: true, objectsRetained: true, removalMode: 'git-worktree-remove-no-force' },
    result: Object.freeze({ targetPath: plan.targetPath, projectionQuarantinePath: null,
      registrationQuarantinePath: null, executedAt }),
  };
}
