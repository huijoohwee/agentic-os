# Start workflow

Use [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md) as the canonical guide.

Start step:

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree; overlaps wait.
3. Continue with [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md).

Notes:

- `release:common start` runs `doctor`, `status`, then `lane`.
- Cross-repo writes follow `../FLEET.md`.
