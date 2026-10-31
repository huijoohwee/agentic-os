# Release workflow

`publish` follows checks; merge requires green checks. `promote plan|apply` binds the exact PR head. `complete` waits
for exact integration and keeps the lane mounted.

`complete-adlc --worktrees=<dir> [--ref=<lane>]` reports source, delivery, and retention; exit `2` keeps END ADLC
open. It cannot merge, deploy, or clean lanes. PRD snapshots preserve exact bytes and grant no effect authority.

Delivery binds exact activation and paths; Dev and Prod readbacks use the same candidate. Missing activation is not a
no-deploy disposition; docs-only work needs an exact owner-bound reason. See [DEPLOY](../guides/DEPLOY-WORKFLOW.md).

`closeout --ref=<lane>` is read-only; local/cached refs do not prove live remote state. Full closeout needs a
workspace receipt and absent path. Ref deletion needs separate exact authority and a receipt.

Cleanup `--bundle --stopped` removes only an empty parent at `selected: 0`, never a lane or Git data. Source closeout
grants no cleanup, sync, or production authority. `retire-empty-active` retains refs, objects, and registration.

cleanup-user sweep is read-only; worktree plans; [branch-retirement plan|apply](GOVERNANCE.md).
