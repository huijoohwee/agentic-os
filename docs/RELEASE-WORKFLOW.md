# Release workflow

Ends at protected integration and lane closeout. CI is in scope only until the exact
published revision merges. Deploy, Dev/preview/Prod promotion, auth, and rollback use separate
consumer-owned workflows with separate receipts.

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the lane worktree and run focused checks.
3. `npm run release:common -- publish --message="<message>"`
4. After merge, from canonical run `complete` or `close`.

Command surface:
- `start`: `doctor -> status -> lane`
- `publish`: `land`
- `complete`: wait for merge, then `close`
- `close`: `finish -> reap -> completion status`
- `finish`: diagnostic `finish -> reap`

Notes:
- `publish` stops at provider handoff until protected integration completes.
- `complete` auto-retires the exact local lane when clean merged evidence is sufficient; use `--bundle`
  with `--stopped` for authenticated cleanup.
- Merge proof, closeout, cleanup, sync, deploy, rollback, and Prod auth keep separate receipts.
