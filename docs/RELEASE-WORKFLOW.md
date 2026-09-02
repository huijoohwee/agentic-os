# Release workflow

At release start/resume, give a bounded active-work ETA; refresh after material drift. External waits
state dependency/condition and next recheck; they are not ETA.

Run `agentic-os land` from the exact clean lane; checks pass on that head before profile-selected protected
integration. Re-fetch canonical and run `agentic-os reap --ref=<lane>` for exact proof. Retire, clean, sync,
deploy, and roll back only with separate authorized receipts. See `MERGE-QUEUE.md` and
`LIFECYCLE-COMPLETION.md`.
