# Release workflow

Ends at protected integration and closeout. RELEASE is global; consumers bind
checks and repo-local cleanup/deploy/rollback. CI ends when the exact published
revision merges. Continue with [`guides/DEPLOY-WORKFLOW.md`](../guides/DEPLOY-WORKFLOW.md).

1. Use [`START-WORKFLOW.md`](./START-WORKFLOW.md) to admit or reuse the lane under its mission allowance.
2. Work only in the lane worktree and run focused checks.
3. `npm run release:common -- publish --message="<message>"`
4. After merge: `complete --ref=<lane>` or `complete-adlc --ref=<lane>` → profile cleanup → closeout or deploy.

`complete-adlc` keeps branch, commits and manifest; `close` is diagnostics only.
Recovery bytes remain retrievable.

Notes:
- Extend active unpublished reservations through START `--readmit`, with the explicit
  immutable mission and exact expected head. After publication, use native `successor`;
  retain the published predecessor and mission cap. Capacity is not release authority.
- `publish` stops at provider handoff until protected integration completes.
- `complete` auto-retires the lane when merged evidence is sufficient; use `--bundle --stopped`
  when cleanup needs exact authenticated proof.
- Merge proof, closeout, cleanup, sync, deploy, rollback, and Prod auth keep separate receipts.
