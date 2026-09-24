# Start workflow

`npm run release:common -- start <scope> --write=<paths> --plan=<committed-plan> [--checkout-limit=<0..5>]`

Five checkouts max per repo; canonical excluded; no nesting. New mission defaults
to one. Resume `--mission=<manifest>`; limits bind. Zero reuses.
`--readmit --expected-head=<sha>` extends disjoint scope; published lanes use
`successor`. Work in returned checkout. Browser UI: immediately run its `npm run dev`
and visibly open the reported URL for user review; recheck after edits. No
script/browser/page: report blocker, not live proof. Headless: N/A.
