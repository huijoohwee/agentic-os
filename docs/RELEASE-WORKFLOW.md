# Release workflow
Path:
1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree.
3. `npm run release:common -- publish --message="<message>"`
4. Wait for protected integration; default is squash.
5. `npm run release:common -- close --ref=<lane>` from canonical.
Command surface:
- `start` runs `doctor`, `status`, then `lane`
- `publish` runs `land`
- `close` runs `finish`, `reap`, then `completion status`
- `finish` runs `finish`, then `reap`
Notes:
- `doctor -> status -> lane -> land -> finish` remains the exact chain.
- `land` and `successor` require the bound lane worktree.
- `close` is the default surface.
- `finish` is the diagnostic primitive.
- `successor` is post-publish only:
  `npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]`
- `npm run completion:scaffold -- --ref=<lane>` prints the scaffold.
- Merge proof, closeout, and cleanup stay separate.
- Cleanup, sync, deploy, rollback, and Prod auth need separate receipts.
