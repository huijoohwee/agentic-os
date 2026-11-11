# Release workflow

1. START: `npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
2. Work in its printed worktree. `npm run land -- --message="feat: ..."` commits and publishes.
   Required CI gates integration. Corrections fast-forward the same open, unqueued PR.
   Preserve history/prose; refresh checks for each SHA.
3. END from canonical, selecting only effects already authorized by the caller:

   ```sh
   agentic-os complete-adlc --apply --ref=<lane> --expected-head=<sha> --effects=merge,sync,cleanup --stopped
   ```

Authority-controlling source also requires `--authority-head=<sha>`. Required checks/reviews remain enforced.
Rerun after interruption; exit `2` names the next wait or uncovered effect. Receipts never grant authority.
Merge, sync, recoverable quarantine and allocation release keep separate proof. Refs/objects are retained.
Unrelated untracked files stay in place; tracked edits, collisions and identity drift require recovery.

Load [cleanup/recovery](../guides/USER-CLEANUP.md) only for a concrete blocker. Read-only inventory:
`agentic-os complete-adlc --worktrees=<registered-root>`. Legacy `release-common complete --ref=<lane>` remains.
Production is separate: load [DEPLOY](../guides/DEPLOY-WORKFLOW.md) for selected delivery, promote the verified
Dev artifact, verify Prod identity and retain rollback evidence. Source closure never implies product delivery.
