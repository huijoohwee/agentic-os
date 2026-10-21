# Release workflow

`npm run release:common -- <action>`: `publish` hands off after checks; merges need green checks.
`complete --ref=<lane>` waits for integration; `close` is diagnostics only.

`closeout --ref=<lane>` reports ADLC state and next owner/action in lane or canonical checkout; no fetch, writes or
effect authority.

Cleanup: exact eligible-target evidence; `--bundle --stopped` preserves recovery bytes.
Separate grants: integration, retirement, cleanup, sync, production; see [DEPLOY](../guides/DEPLOY-WORKFLOW.md).

`retire-empty-active --ref=<lane>` quarantines a clean active lane if recorded head=base; retains refs, objects,
projection, registration; no provider, merge or deploy authority.
