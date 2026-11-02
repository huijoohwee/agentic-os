# Release workflow

## Default source path

1. Start with `npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`; work in its printed worktree.
2. Use `npm run check` while iterating when useful. For final publication, run
   `npm run land -- --message="feat: ..."`; it runs affected checks, commits reserved paths, and publishes the exact
   lane head.
3. Complete the repository's protected PR checks and review, then merge the PR. Solo maintainers use PR plus
   CI, set required approvals to zero, keep bypass off, and never self-approve.
4. Record source integration with `npm run release:common -- complete --ref=<lane>`.

Plans bind requirements and scope; they grant no effect authority.
Source completion is not product delivery, workspace cleanup, branch retirement, canonical sync, or deployment.

## On demand

Load only the workflow a lane needs and reuse evidence until its inputs drift.

- **Observe:** `agentic-os complete-adlc --worktrees=<registered-root>` is read-only; exit `2` means open.
- **Deploy:** load [DEPLOY](../guides/DEPLOY-WORKFLOW.md) only for a delivery-bound scope.
- **Cleanup:** use the exact stopped target and its authorized receipt. See [USER CLEANUP](../guides/USER-CLEANUP.md).
- **Recovery or retirement:** use only the named AOS workflow when a concrete blocker requires it.

The release command never grants deployment or cleanup authority. See [GOVERNANCE](GOVERNANCE.md) for effect
boundaries.
