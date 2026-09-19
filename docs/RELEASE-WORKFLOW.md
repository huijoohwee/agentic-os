# Release workflow

Canonical path:

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree; overlaps wait.
3. Reuse bound proof; run affected checks once.
4. `npm run release:common -- publish --message="<message>"`
5. Wait for protected integration; default is squash.
6. `npm run release:common -- finish --ref=<lane>`

Use `npm run release:common --help`. `start` runs `doctor`, `status`, then
`lane`; `publish` runs `land`; `finish` runs `finish`, then `reap`.

Exception path:

- `npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]`
  only after publish.
- Cleanup, sync, deploy, rollback, and Prod authorization need separate
  receipts.
- Dev integration is not terminal release proof.
- Apply the global prompt plus handover.
