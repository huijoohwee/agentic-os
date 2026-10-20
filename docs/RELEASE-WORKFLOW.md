# Release workflow

Run checks then `npm run release:common -- publish`; it stops at provider handoff.
Green checks precede an authorized merge. Use `complete --ref=<lane>`; `close` is diagnostic.
Cleanup preserves recovery bytes and requires exact eligible-target evidence; `--bundle --stopped` proves it.

Each effect needs a separate grant.
[DEPLOY](../guides/DEPLOY-WORKFLOW.md) needs its own authority.

`npm run release:common -- retire-empty-active --ref=<lane>` quarantines a clean active lane at its admitted base.
A recorded head is permitted only when it equals that base. It retains refs, objects, projection, and registration;
it grants no provider, merge, or deployment authority.
