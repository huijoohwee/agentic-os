# Release workflow

Ends at protected integration and closeout. RELEASE is global protocol; consumers bind
checks, cleanup, deploy, rollback. CI is in scope only until the exact published
revision merges. Continue with [`guides/DEPLOY-WORKFLOW.md`](../guides/DEPLOY-WORKFLOW.md).

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
- `complete` auto-retires the local lane when merged evidence is sufficient; use `--bundle`
  with `--stopped` for authenticated cleanup.
- Merge proof, closeout, cleanup, sync, deploy, rollback, and Prod auth keep separate receipts.
