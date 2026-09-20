# Release workflow
Path:
1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree.
3. `npm run release:common -- publish --message="<message>"`
4. `npm run release:common -- complete --ref=<lane> [--timeout-ms=<ms>] [--bundle=<json>] [--stopped]` from canonical.
Command surface:
- `start` runs `doctor`, `status`, then `lane`
- `publish` runs `land`
- `complete` waits for the exact review to merge, then runs `close`
- `complete` also runs authenticated cleanup when `--bundle` and `--stopped` are supplied
- `close` runs `finish`, `reap`, then `completion status`
- `finish` runs `finish`, then `reap`
Notes:
- `doctor -> status -> lane -> land -> finish` remains the exact chain.
- `land` and `successor` require the bound lane worktree.
- `publish` still stops at provider handoff; protected integration remains external until `complete` or `close`.
- `complete` is the default post-publish convenience surface.
- authenticated cleanup still requires the existing completion evidence bundle; `complete` just runs the existing `completion:plan` and `completion:apply` path for that exact bundle.
- `close` remains the post-merge primitive.
- `finish` is the diagnostic primitive.
- `successor` is post-publish only:
  `npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]`
- `npm run completion:scaffold -- --ref=<lane>` prints the scaffold.
- Merge proof, closeout, and cleanup stay separate.
- Cleanup, sync, deploy, rollback, and Prod auth need separate receipts.
