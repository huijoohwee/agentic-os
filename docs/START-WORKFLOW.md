# Start workflow

Native START owns admission and reuse. For the first declared mission, use
`npm run release:common -- start <scope> --write=<paths> --plan=<committed-plan> --checkout-limit=<0..32>`.
Resume the currently selected immutable workflow group with `--mission=<manifest>`; reuse its selected
mission and eligible lane before allocating a checkout; `--expected-head=<40hex>`
can bind reuse to the current revision after committed work. The first explicit limit
also permits adopting a legacy root; it never raises an existing declared cap.
Zero permits reuse only. Missing allowance in a declared mission blocks allocation
before effects; standalone legacy START remains supported without claiming these
mission controls are enforced. Observing legacy records does not grant capacity.

Before extending an active unpublished bound lane, run
`npm run release:common -- start <scope> --write=<paths> --mission=<manifest> --readmit --expected-head=<40hex>`.
Native admission checks exact identity and disjoint reservations; it does not adopt
another owner or create a replacement checkout. Published lanes require RELEASE's
successor path. CLI and MCP `lane` use this same admission, with no authority bypass.

Work only in the printed lane worktree. Follow the execution economy contract in
[`PRD-TAD-ADR-MVP-GTM.md`](../guides/PRD-TAD-ADR-MVP-GTM.md) (`ADLC-EXEC-001`) and
continue with [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md).
