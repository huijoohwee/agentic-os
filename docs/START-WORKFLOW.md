# Start workflow

Use [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md) as the canonical release
guide.

Start step:

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree; overlaps wait.
3. Continue with the canonical release path in
   [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md).

Notes:

- `release:common start` is the preferred human-facing entrypoint for opening a
  lane because it runs `doctor`, `status`, then `lane`.
- Cross-repo writes follow `../FLEET.md`; consumers may call that checkout.
- `successor` is not a start-path command; use it only after publish.
