# Release workflow

Canonical path:

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree; overlaps wait.
3. Reuse bound proof; run affected checks once.
4. `npm run release:common -- publish --message="<message>"`
5. Wait for protected integration; default is squash.
6. `npm run release:common -- finish --ref=<lane>`

Primary entrypoint:

- Prefer `npm run release:common --help` for human-facing guidance.
- `release:common start` runs `doctor`, `status`, then `lane`.
- `release:common publish` runs `land`.
- `release:common finish` runs `finish`, then `reap`.

Underlying primitives:

- `doctor -> status -> lane -> land -> finish` remains the exact execution
  chain.
- Use the primitive commands directly only when you need diagnostics or a
  bounded recovery step.

Exception path:

- `npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]`
  only after publish.
- [Cleanup](LIFECYCLE-COMPLETION.md), sync, deploy, rollback, and Prod
  authorization need separate receipts.
- Dev integration is not terminal release proof; continue with
  [release closure](../guides/PRD-TAD-ADR-MVP-GTM.md#workflow-obs-002--durable-lifecycle-and-release-closure).
- Apply the global prompt plus
  [handover](../guides/PRD-TAD-ADR-MVP-GTM.md#planning-release-handover);
  forbid unchanged repetition or overlap.
