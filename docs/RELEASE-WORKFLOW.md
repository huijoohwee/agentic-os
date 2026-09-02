# Release workflow

At release start/resume, apply the global prompt's completion-estimate and external-wait rule.

Run `agentic-os land` from the exact clean lane; checks pass before its exact committed diff lands by
profile-selected protected integration. Never copy lane files into canonical. Re-fetch
canonical; run `agentic-os reap --ref=<lane>` for exact proof. Retire and clean each
exact target only by its own authorized receipt. Sync, deploy, and roll back with separate authorized
receipts. See `MERGE-QUEUE.md` and `LIFECYCLE-COMPLETION.md`.
