# Start workflow

`npm run release:common -- start <scope> --write=<paths> --plan=<committed-plan> [--checkout-limit=<0..5>]`

Five task checkouts max per local repo; canonical excluded. Forbid nesting.
New plans default to one; use two for independent work, three–five for sprint value.
New plans create a mission. Resume via `--mission=<manifest>`; caps stay binding.
Zero allows reuse. `--readmit --expected-head=<sha>` extends disjoint private scope.
Published lanes use `successor`. Work in the returned checkout.
Details: [ADLC-EXEC-001](../guides/PRD-TAD-ADR-MVP-GTM.md).
