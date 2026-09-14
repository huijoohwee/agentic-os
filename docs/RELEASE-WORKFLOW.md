# Release workflow

At release start/resume, apply the global prompt's completion-estimate and external-wait rule.
Pre-land: [handover](../guides/PRD-TAD-ADR-MVP-GTM.md#planning-release-handover).
The exact committed diff lands by profile-selected protected integration.
Default: squash; merge commit is an explicit backup; provider rebase requires a revision-bound choice.
Follow [method controls](../guides/INTEGRATION-METHODS.md); preserve shared refs.
Never copy lane files into canonical.
After merge, run `agentic-os finish --ref=<lane>` to observe integration and retain the worktree.
Authenticated cleanup: `LIFECYCLE-COMPLETION.md`. Sync/deploy/rollback stay separate.
