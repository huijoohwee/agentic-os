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

The first observation is immediate. A changed nonterminal state may be rechecked after 5 seconds;
the first unchanged observation returns control. One call makes at most 12 observations and lasts
at most 60 seconds, including provider reads. Each API call has a 15-second limit and an output cap
below 500 kB. Calls are sequential and waits cannot pass the observation deadline. `--timeout-ms`
defaults to 60 seconds; larger values fail before provider access. Use one observer per exact run.
The command itself does not rerun, cancel, download, merge or deploy.

Exit 0 means the bound run completed successfully; 1 means a failed run or an
observation error (inspect the event/error); 2 is `verified_wait`, meaning the
run is not proven terminal. It returns `continue_independent_work`, the exact run binding and a
minimum 60-second recheck delay. Follow a provider event or independent-work milestone after that
delay. If no covered work remains, report the dependency and yield; never loop fresh watch windows.
Use the [productive-wait policy](AUTONOMOUS-GOAL-PURSUIT.md#productive-external-waits). Output includes elapsed
monotonic time, poll count and `authority: false`. Even a green run does not replace
readiness, source integration, cleanup or deployment checks.

A deterministic unchanged-run test returns after two observations and one five-second wait.
Progress can be reported until a terminal result or the count/deadline bound; unchanged elapsed time
alone is not progress. These are executable limits, not claims of measured end-to-end savings.

`release-common complete` applies the same 60-second / 12-observation ceiling and unchanged-state
handoff to exact reviews. Its default is 60 seconds. Late merge observations cannot start closeout;
merged receipts still pass the existing independent cleanup and retirement checks.
