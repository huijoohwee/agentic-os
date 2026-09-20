# Release workflow
Path:
1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the lane worktree.
3. `npm run release:common -- publish --message="<message>"`
4. From canonical, run `complete` or `close` for that lane.

Command surface:
- `start`: `doctor -> status -> lane`
- `publish`: `land`
- `complete`: wait for merge, then run `close`
  - auto-retire the exact local lane when clean merged evidence is sufficient
  - add `--bundle` and `--stopped` for authenticated cleanup
- `close`: `finish -> reap -> completion status`
- `finish`: diagnostic `finish -> reap`

Notes:
- Exact chain: `doctor -> status -> lane -> land -> finish`.
- `land` and `successor` require the bound lane worktree.
- `publish` stops at provider handoff until protected integration completes.
- `successor` is post-publish only:
  `npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]`
- Merge proof, closeout, cleanup, sync, deploy, rollback, and Prod auth keep separate receipts.
