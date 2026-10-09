# Start workflow

`npm run release:common -- start <scope> --write=<paths> --plan=<committed-plan> [--checkout-limit=<0..5>]`

Five max/repo; canonical excluded; no nesting. One checkout/new mission;
resume `--mission=<manifest>`; cap binds; zero reuses.
No `--plan`/`--mission`: clone selection; new task: committed `--plan`.
`--readmit --expected-head=<sha>` extends disjoint scope; published lanes use
`successor`. Work in returned checkout.
Browser UI: immediately run `npm run dev`; visibly open reported URL for review,
recheck after edits. No script/browser/page: report blocker, not live proof.
Headless: N/A.

See `guides/LANE-RECERTIFICATION.md`.
