# Start workflow

Default path:

1. `npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]`
2. Work only in the printed lane worktree; overlaps wait.
3. `npm run release:common -- publish --message="<message>"`, then
   [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md).

Exceptions:

- `npm run successor -- <scope> --expected-head=<published-head>` only after
  publish.
- Cross-repo writes follow `../FLEET.md`; consumers may call that checkout.
