# Release workflow

After [START](./START-WORKFLOW.md), run affected checks, then
`npm run release:common -- publish --message="<message>"`.
Publication stops at provider handoff. After exact protected merge, use
`complete --ref=<lane>` (alias `complete-adlc`); `close` is diagnostics only.
Cleanup preserves recovery bytes and requires exact eligible-target evidence;
`--bundle --stopped` supplies authenticated proof where required.

Published candidates stay immutable; native `successor` retains their checkout and
mission cap. Integration, retirement, cleanup, sync and production grants remain separate.
Continue [DEPLOY](../guides/DEPLOY-WORKFLOW.md) only with its authority.
