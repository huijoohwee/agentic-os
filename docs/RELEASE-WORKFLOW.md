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

When a merged profile-governed lane lacks historical provider receipts, closeout offers the explicit
`cleanup-user --recovery --ref=<lane>` path. It verifies the exact merged PR, profile-required checks,
current `main`, and worktree inventory, then quarantines only the worktree projection and registration
under a digest-bound plan and stopped-writer acknowledgement. This records no historical protection,
merge-method, provider-authority, or claim-retirement proof; branch refs and Git objects remain retained.
Use the protected receipt path when provider claim retirement is required. See
[local recovery](../guides/USER-CLEANUP.md#explicit-recovery-for-profile-governed-repositories).

`retire-empty-active --ref=<lane>` quarantines a clean lane at its base;
refs, objects, and registration remain.
