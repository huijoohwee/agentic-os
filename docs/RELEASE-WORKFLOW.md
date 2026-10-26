# Release workflow

`publish` hands off after checks; merge requires green checks.
`complete --ref=<lane>` waits for exact integration and reports closeout
keeping the lane mounted.
`closeout --ref=<lane>` is read-only; `close` is diagnostic.

`agentic-os complete-adlc --worktrees=<dir> [--ref=<lane>]` reports source, delivery, retention; `--ref`
limits the pass to one registered lane, and exit `2` keeps END ADLC open. Add `--cleanup --stopped` to remove
only the exact empty directory after a `selected: 0` pass. A non-empty
directory is preserved and the command exits `2`; this option never removes a lane checkout or Git data.
No activation: delivery `not-required`.

Cleanup is separate: exact eligible targets require `--bundle --stopped`.
Source closeout grants no cleanup, sync, or production authority; see [DEPLOY](../guides/DEPLOY-WORKFLOW.md).

`retire-empty-active --ref=<lane>` quarantines a clean lane at its base; refs, objects, and registration remain.
