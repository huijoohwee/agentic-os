# Observe an exact pipeline run

Use this lazy command while compilation, integration, runtime checks or CI are
running. It emits JSON Lines only on run/job changes and at the end of the
observation window. Independent work can use a completed platform's result while
other jobs continue. A job result does not establish artifact provenance or
release authority; verify the artifact and its source receipt before use.

```sh
agentic-os pipeline --repo=owner/repository --run=123 --head=<40-character-workflow-head-sha> --attempt=1 --timeout-ms=60000
```

Requires an authenticated `gh` executable and GitHub.com. No checkout or repository
profile is required for this read-only observation. The head binds the workflow
run; workflows that build another source revision need a separate source receipt.
Every poll reads the run, the exact attempt's jobs, then the run again. A changed
repository, run, attempt or SHA stops observation. More than 100 jobs or an
incomplete inventory fails explicitly; no partial inventory is called complete.

The interval starts at 5 seconds, doubles on unchanged state up to 60 seconds,
and resets on changes. Each API call has a 15-second limit and an output cap below
500 kB. Calls are sequential and waits cannot pass the observation deadline.
`--timeout-ms` defaults to 60 seconds and is capped at three hours. Run one watcher
per exact run; do not start duplicate watchers or restart builds because a watch
window elapsed. The command itself does not rerun, cancel, download, merge or deploy.

Exit 0 means the bound run completed successfully; 1 means a failed run or an
observation error (inspect the event/error); 2 is `verified_wait`, meaning the
window elapsed and another fresh observation is needed. Output includes elapsed
monotonic time, poll count and `authority: false`. Even a green run does not replace
readiness, source integration, cleanup or deployment checks.

The deterministic one-hour unchanged-run test uses 63 polls instead of 720 at a
fixed five-second interval (91.25% fewer polls and API requests for the same
three-request observation). Detection delay after an unchanged interval is at
most 60 seconds plus bounded provider latency. This measures watcher economics,
not compiler speed, cloud billing savings, or end-to-end runtime readiness.
