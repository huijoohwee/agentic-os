# Release workflow

1. START: `npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
2. Finish authorized work and affected checks in the lane; `npm run land -- --message="feat: ..."`
   commits/publishes. Clean worktrees can contain unpublished commits.
   Parking/abandonment requires an explicit owner decision.
   Corrections fast-forward the same open, unqueued PR; preserve history and refresh checks.
   Use successors after publish. Preflight base, active PRs and workflow SHA before CI; cleanup inventory follows merge.
3. END from canonical selects only caller-authorized effects:

   ```sh
   agentic-os complete-adlc --apply --ref=<lane> --expected-head=<sha> --effects=merge,sync,cleanup --stopped
   ```

END = remote integration plus canonical sync; local merge/cleanup alone is not END.
Authority-controlling source also needs `--authority-head=<sha>`. Required checks/reviews gate integration.
Reuse covered grants; rerun after interruption. Exit `2` names a wait or uncovered effect; receipts grant no authority.
Merge, sync, recoverable cleanup and allocation release retain separate proof. Refs/objects and unrelated bytes stay.
`merge` proves remote inclusion; `sync` realigns canonical to the fetched revision required by `npm run dev`.
Tracked edits, collisions or identity drift require recovery.
For blockers load [recovery](../guides/USER-CLEANUP.md).
Batch: `agentic-os complete-adlc --worktrees=<registered-root>`.
Delivery: [DEPLOY](../guides/DEPLOY-WORKFLOW.md) requires Dev/Prod identity and rollback proofs.
Source closure never implies product delivery.

## GitHub consumer enforcement

GitHub consumer repositories must commit a governed repository profile before release closeout is considered healthy:

- `adapters.provider` must select `github/1`
- `capabilities` must include `protected-integration:pull-request`
- `requiredChecks` must be non-empty
- each required check must match a GitHub workflow job `name:`
- `cleanup.worktreeProjection` and `cleanup.worktreeRegistration` must both be `remove-clean`
- `package.json` must expose `doctor`, `lane`, `land`, `successor`, `release:common`, `sync:canonical`

`agentic-os doctor` evaluates the trusted committed profile at the canonical
protected ref. Local uncommitted edits do not satisfy consumer enforcement.
