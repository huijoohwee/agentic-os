# Release workflow

Ends at protected integration and closeout. RELEASE is global; consumers bind
checks and repo-local cleanup/deploy/rollback. CI ends when the exact published
revision merges. Continue with [`guides/DEPLOY-WORKFLOW.md`](../guides/DEPLOY-WORKFLOW.md).

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the lane worktree and run focused checks.
3. `npm run release:common -- publish --message="<message>"`
4. After merge: `complete --ref=<lane>` or `complete-adlc --ref=<lane>` → profile cleanup → closeout or deploy.

`complete-adlc` keeps branch, commits and manifest; `close` is diagnostics only.
Recovery bytes remain retrievable.

Notes:
- `publish` stops at provider handoff until protected integration completes.
- `complete` auto-retires the lane when merged evidence is sufficient; use `--bundle --stopped`
  when cleanup needs exact authenticated proof.
- Merge proof, closeout, cleanup, sync, deploy, rollback, and Prod auth keep separate receipts.
