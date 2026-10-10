# Release workflow

Publish after checks: `npm run release:common -- publish`. Publication stops at provider handoff.
Authorized merges require green checks. Complete: `complete --ref=<lane>`; `close`: diagnostics only.
Cleanup preserves recovery bytes and requires exact eligible-target evidence; `--bundle --stopped` proves it.

Integration, retirement, cleanup, sync and production grants remain separate.
[DEPLOY](../guides/DEPLOY-WORKFLOW.md) only with its authority.

`npm run release:common -- retire-empty-active --ref=<lane>` quarantines a clean, active no candidate lane at its
admitted base. It retains refs, objects, projection, registration; no provider, merge or deployment
authority follows.
