# Release workflow

`publish` hands off; merge needs green checks.
`complete --ref=<lane>` waits for exact integration; lane stays mounted.
`closeout --ref=<lane>` reads status; `close` diagnoses.

`agentic-os complete-adlc --worktrees=<dir>` reports source, delivery and retention; exit `2` keeps END ADLC open.
A clean, integrated, current lane may be `source_complete` while `cleanup_pending`. Without an activation binding,
delivery is `not-required`.

Cleanup needs `--bundle --stopped`; closeout grants no cleanup, sync or production authority. See
[DEPLOY](../guides/DEPLOY-WORKFLOW.md).
`retire-empty-active` quarantines a clean base lane; refs, objects and registration persist.
