# Release workflow

At release start/resume, apply the global prompt's completion-estimate and external-wait rule.
Run `agentic-os land` from the clean lane; after checks, its exact committed diff lands by
profile-selected protected integration. Never copy lane files into canonical. Re-fetch canonical;
run `agentic-os finish --ref=<lane>` to prove integration and remove that clean worktree; retain its branch.
Sync/deploy/rollback stay separate. See `MERGE-QUEUE.md` and `../guides/LIFECYCLE-FLIGHT.md` for phase checks.
