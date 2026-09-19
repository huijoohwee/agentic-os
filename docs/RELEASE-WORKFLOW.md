# Release workflow

Default path:

1. Reuse bound proof; run affected checks once.
2. `npm run release:common -- publish --message="<message>"`
3. Wait for protected integration; default is squash
4. `npm run release:common -- finish --ref=<lane>`

Exceptions:

- `npm run successor -- <scope> --expected-head=<published-head>` only after
  publish.
- [Cleanup](LIFECYCLE-COMPLETION.md), sync, deploy, rollback, and Prod
  authorization need separate receipts.
- Dev integration is not terminal release proof; continue with
  [release closure](../guides/PRD-TAD-ADR-MVP-GTM.md#workflow-obs-002--durable-lifecycle-and-release-closure).
- Apply the global prompt plus
  [handover](../guides/PRD-TAD-ADR-MVP-GTM.md#planning-release-handover);
  forbid unchanged repetition or overlap.
