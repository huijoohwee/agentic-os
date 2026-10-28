# Release workflow

`publish` hands off after checks; merge requires green checks. `promote plan|apply` binds the exact PR
head; GitHub squashes into the profile's protected ref (`origin/main` in the standard profile).
`complete --ref=<lane>` waits for exact integration and reports closeout, keeping the lane mounted.

`complete-adlc --worktrees=<dir> [--ref=<lane>]` reports source, delivery and workspace status;
exit `2` means END ADLC remains open. A mounted checkout is `cleanup_pending`. It does not merge,
deploy or clean lanes. `--cleanup --stopped` removes only an empty batch directory after
`selected: 0`, never a lane checkout or Git data.

Delivery binds the exact activation and changed paths. Dev and Prod readbacks use the same
candidate. Docs-only paths may use an exact owner-bound no-deploy reason; see
[DEPLOY](../guides/DEPLOY-WORKFLOW.md).

`closeout --ref=<lane>` is read-only; `close` is diagnostic. Live remote state is not observed.
Branch/ref/object deletion needs separate authority and receipt; it is optional for END ADLC and
proves neither reclamation nor claim retirement. Full closeout needs the workspace receipt and absent path.

Cleanup is separate: exact eligible targets require `--bundle --stopped`. Source closeout grants no cleanup,
sync, or production authority; see [CLEANUP](../guides/CLEANUP-AUTHORITY.md) for preservation and retirement.

`retire-empty-active --ref=<lane>` quarantines a clean lane at its base; refs, objects, and
registration remain.
