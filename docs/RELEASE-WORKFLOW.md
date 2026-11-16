# Release workflow

1. START: `npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
2. In its lane, finish authorized work and affected checks; `npm run land -- --message="feat: ..."`
   commits/publishes. Clean worktrees can contain unpublished commits. END never selects parking or abandonment;
   that needs an explicit owner decision. Correct the same open, unqueued PR; preserve history and refresh checks.
3. END from canonical selects only caller-authorized effects:

   ```sh
   agentic-os complete-adlc --apply --ref=<lane> --expected-head=<sha> --effects=merge,sync,cleanup --stopped
   ```

Authority-controlling source also needs `--authority-head=<sha>`. Required checks/reviews still gate integration.
Reuse covered grants; rerun after interruption. Exit `2` names a wait or uncovered effect; receipts grant no authority.
Merge, sync, recoverable cleanup and allocation release retain separate proof. Refs/objects and unrelated bytes stay.
For blockers load [recovery](../guides/USER-CLEANUP.md).
Batch: `agentic-os complete-adlc --worktrees=<registered-root>`.
[DEPLOY](../guides/DEPLOY-WORKFLOW.md) separately requires verified Dev/Prod identity and rollback evidence.
Source closure never implies product delivery.
