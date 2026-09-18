# Release workflow

Apply the global prompt's estimate/wait rule and [handover](../guides/PRD-TAD-ADR-MVP-GTM.md#planning-release-handover).
Preflight [validation](../guides/VALIDATION-ECONOMY.md#release-validation-scheduling): reuse bound proof;
forbid unchanged repetition, recursion, duplicate/conflicting/overlapping execution. Report changed evidence.
Land the exact diff by profile-selected protected integration;
default squash ([methods](../guides/INTEGRATION-METHODS.md)).
Preserve refs; never copy lanes into canonical. After merge, `agentic-os finish --ref=<lane>` retains it.
[Cleanup](LIFECYCLE-COMPLETION.md), sync/deploy/rollback require separate receipts.
