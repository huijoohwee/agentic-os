# Release workflow

Reuse bound proof; run affected checks once. Apply the global prompt and
[handover](../guides/PRD-TAD-ADR-MVP-GTM.md#planning-release-handover).
Forbid unchanged repetition, recursion, duplicate/conflicting/overlapping execution.
Land the exact checked diff by protected integration; default squash. `finish --ref=<lane>` retains refs.
[Cleanup](LIFECYCLE-COMPLETION.md), sync/deploy/rollback need separate receipts.
For Dev → Prod, follow
[release closure](../guides/PRD-TAD-ADR-MVP-GTM.md#workflow-obs-002--durable-lifecycle-and-release-closure):
continue covered owner actions to authenticated live verification and the terminal release receipt; report gaps.
