# Release workflow

After [START](./START-WORKFLOW.md), run affected checks and
`npm run release:common -- publish --message="<message>"`.
After protected merge and canonical sync, run `complete-adlc --ref=<lane>`.
`close` is diagnostics only. Cleanup retains recovery bytes and needs exact proof;
use `--bundle --stopped` for authenticated cleanup.

`complete-adlc --worktrees=<absolute-directory>` closes registered lanes serially
in a bounded pass, preserving blocked work. Resume to process remaining lanes.
Published heads stay immutable; use `successor`. Each effect keeps its own grant.
Continue [DEPLOY](../guides/DEPLOY-WORKFLOW.md) only with deployment authority.
