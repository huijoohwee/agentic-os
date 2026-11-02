# Release workflow

## Default source path

1. Start one lane: `npm run release:common -- start <scope> --write=<paths> [--plan=<PRD-path>]`.
2. Run `npm run check`.
3. Publish its exact head: `npm run release:common -- publish`.
4. Pass protected review/checks; merge the PR.
5. Record integration: `npm run release:common -- complete --ref=<lane>`.

A plan grants no effects. Completion is not delivery, cleanup, sync, or deployment.

## Optional paths

Load only when needed; reuse evidence until drift.

- **Observe:** `agentic-os complete-adlc --worktrees=<registered-root>` is read-only (exit `2` =
  open). Use `npm run reap -- --ref=<lane>` if integration is unclear.
- **Deploy:** load [DEPLOY](../guides/DEPLOY-WORKFLOW.md) only in scope. Bind exact activation/paths;
  read back the same candidate in Dev/Prod. Missing activation is not “no deploy.” Docs-only work
  needs an exact owner-bound reason.
- **Close/clean:** closeout is read-only; cached refs are not live proof. Full closeout needs a
  receipt + absent path; ref deletion needs separate authority + receipt. Cleanup removes only an
  empty parent (`selected: 0`), never lane/Git data. Empty-lane retirement keeps refs, objects and
  registration. See [GOVERNANCE](GOVERNANCE.md) and [USER CLEANUP](../guides/USER-CLEANUP.md).
