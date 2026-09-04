# Release workflow

At release start/resume, apply the global prompt's completion-estimate and external-wait rule.

Run `agentic-os land` from the exact clean lane; checks pass before its exact committed diff lands by
profile-selected protected integration. Never copy lane files into canonical. Re-fetch
canonical; run `agentic-os finish --ref=<lane>` to prove integration and remove that clean worktree while
retaining its branch and commits. Dirty, unbound, or unintegrated lanes fail closed. Sync, deploy, and roll
back remain separate. See `MERGE-QUEUE.md`.
