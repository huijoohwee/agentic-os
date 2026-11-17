# Release workflow

1. START: `npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
2. Finish authorized work and affected checks in the lane; `npm run land -- --message="feat: ..."`
   commits/publishes. Clean worktrees can contain unpublished commits.
   Parking/abandonment requires an explicit owner decision.
   Corrections fast-forward the same open, unqueued PR; preserve history and refresh checks.
3. END from canonical selects only caller-authorized effects:

   ```sh
   agentic-os complete-adlc --apply --ref=<lane> --expected-head=<sha> --effects=merge,sync,cleanup --stopped
   ```

END ADLC means remote-integrated plus canonical-synced. Local merge or cleanup alone is not END ADLC.
Authority-controlling source also needs `--authority-head=<sha>`. Required checks/reviews gate integration.
Reuse covered grants; rerun after interruption. Exit `2` names a wait or uncovered effect; receipts grant no authority.
Merge, sync, recoverable cleanup and allocation release retain separate proof. Refs/objects and unrelated bytes stay.
`merge` proves canonical remote inclusion; `sync` realigns the canonical checkout to the fetched canonical revision
that `npm run dev` requires.
Tracked edits, collisions or identity drift require recovery.
For blockers load [recovery](../guides/USER-CLEANUP.md).
Batch: `agentic-os complete-adlc --worktrees=<registered-root>`.
Delivery: [DEPLOY](../guides/DEPLOY-WORKFLOW.md) requires Dev/Prod identity and rollback proof.
Source closure never implies product delivery.
