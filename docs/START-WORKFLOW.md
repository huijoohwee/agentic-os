# Start workflow

`npm run release:common -- start <scope> --write=<paths> --plan=<committed-plan> --checkout-limit=<0..32>`

Resume the current immutable root with `--mission=<manifest>`; `--expected-head=<sha>`
binds committed edits. Zero allows reuse; declared caps cannot increase. Legacy standalone
START remains compatible without mission enforcement. Exact active unpublished owners can
extend disjoint scope with `--readmit --expected-head=<sha>`; published owners use `successor`.

Work in the printed checkout. Scope, evidence and limits: existing
[`ADLC-EXEC-001`](../guides/PRD-TAD-ADR-MVP-GTM.md#adlc-exec-001--native-execution-economy-authorized-implementation).
