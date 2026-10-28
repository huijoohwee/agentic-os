# Release workflow

`publish` hands off after checks; merge requires green checks.
`complete --ref=<lane>` waits for exact integration and reports closeout
keeping the lane mounted. `closeout --ref=<lane>` is read-only; `close` is diagnostic.

`complete-adlc --worktrees=<dir> [--ref=<lane>]` reports source, delivery and
retention; exit `2` keeps END ADLC open. `--cleanup --stopped` removes only an empty
directory after `selected: 0`, never a lane checkout or Git data. No activation means
delivery `not-required`.

Closeout `closeout.branchDisposition` records cleanup policy and local/cached tracking-ref
states. Live remote state is unobserved because this read-only check never fetches. Current
policy retains branches, tracking refs, and unreachable objects. Deletion needs separate
exact authority and a receipt; it is not required for END ADLC and proves neither storage
reclamation nor claim retirement.

Cleanup is separate: exact eligible targets require `--bundle --stopped`.
Source closeout grants no cleanup, sync, or production authority; see
[DEPLOY](../guides/DEPLOY-WORKFLOW.md).
See [CLEANUP](../guides/CLEANUP-AUTHORITY.md) for same-repository preservation and retirement.
Record-only retirement and cleanup require separate receipts.

`retire-empty-active --ref=<lane>` quarantines a clean lane at its base;
refs, objects, and registration remain.
