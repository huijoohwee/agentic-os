# Release workflow

`publish` hands off after checks; merge requires green checks.
`complete --ref=<lane>` waits for exact integration and reports closeout
keeping the lane mounted.
`closeout --ref=<lane>` is read-only; `close` is diagnostic.

`agentic-os complete-adlc --worktrees=<dir>` reports source, delivery, retention; exit `2` keeps END ADLC open.
No activation: delivery `not-required`.

Cleanup is separate: exact eligible targets require `--bundle --stopped`.
Source closeout grants no cleanup, sync, or production authority; see [DEPLOY](../guides/DEPLOY-WORKFLOW.md).

`retire-empty-active --ref=<lane>` quarantines a clean lane at its base; refs, objects, and registration remain.
