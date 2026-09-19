# Release workflow

Default path:

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree.
3. `npm run release:common -- publish --message="<message>"`
4. Wait for protected integration; default is squash.
5. `npm run release:common -- finish --ref=<lane>` from canonical.

Command surface:

- `start` runs `doctor`, `status`, then `lane`
- `publish` runs `land`
- `finish` runs `finish`, then `reap`
- `close` runs `finish`, `reap`, then `completion status`

Notes:

- `doctor -> status -> lane -> land -> finish` remains the exact chain.
- `land` and `successor` require the live bound lane worktree.
- `finish` is ref-led and may run after the authoring worktree is detached.
- `successor` is post-publish only.
- `npm run completion:scaffold -- --ref=<lane>` prints the cleanup bundle scaffold.
- Cleanup, sync, deploy, rollback, and Prod authorization still require separate receipts.
