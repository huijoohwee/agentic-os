# Validation execution economy

On-demand companion to [Validation economy](VALIDATION-ECONOMY.md). These existing
contracts retain their identities and scope; source scanning is documented in the parent.

## Planning-bound startup evidence (WORKFLOW-OBS-006)

Pass `--plan=<repository-relative-prd-tad-adr-mvp-gtm.md>` to the existing `agentic-os start`
command to capture the initial immutable group root after preflight/context hydration and before
worktree provisioning. The path must name a regular committed planning document at the fetched
base revision; mixed-case native filenames are accepted. No path or plan is guessed. Calls without
this option retain their existing behavior. A local non-host-qualified profile cannot opt into
this GitHub-bound collector. Use the returned `workflow` JSON's `manifest` locator directly.

The initial child contains every expected lifecycle phase as missing and unreported resources as
unknown. It is a planning snapshot, not a successful preparation/admission receipt. If provisioning
fails, its printed root survives with that same incomplete meaning. Identical inputs reuse exact
bytes. There is no mutable latest file. Continue via existing `workflow collect`: retain the root's
workflow/worktree identity, collect actual phase receipts at their original revisions, and bind
`previous` when collecting its successor group. Existing JSON/SSE export and recommendations read
these roots immediately. Production targets remain incomplete until separate deployment/runtime
receipts are captured and independently verified by their owners. No stream polling is installed.

Acceptance: initial root exists before provisioning; planning digest and tree match committed source;
all absent phases and release evidence remain incomplete; repeated start capture reuses its root;
invalid, absent or symbolic-link planning input fails before capture. Test: workflow collection suite.
Rollback: omit `--plan` or revert startup integration; preserve all already collected evidence.


## Native execution exclusion (ADLC-OBS-004)

PRD: the release operator needs one bounded execution of each selected command, without recursive
wrappers, aliases repeating a stage, or simultaneous processes competing for the same clone resources.
Preserve source-bound reuse, failure evidence, required provider checks and independent disjoint work.

TAD: extend the existing command executor and receipt lock owner. Before launching a child (including
its optional accounting probe), claim a command-digest lock in the clone-common private artifact scope.
The same command/arguments in sibling worktrees conflict even if their sources differ; command identity
is deliberately conservative, not proof of semantic equivalence. An inherited, bounded ancestry of
opaque digests rejects recursive cycles and depth beyond 16. Stage preflight rejects the same command
under different IDs before executing any stage. `node` and the running Node executable share identity.
Release the exact lock after process teardown, including timeout, cancellation and spawn failure.
A crashed owner leaves a blocking lock; never infer that deleting it or killing another process is safe.

ADR: reuse existing locks, input-bound check receipts and CI observation. No daemon, new result ledger,
paid capacity, weakened gate or automatic retry. This guards cooperating native executors in one clone;
it cannot prove arbitrary shell-command equivalence or exclude direct shell/provider execution. Release
preflight still owns cross-host/CI conflicts. Consumer stages without declared input contracts do not
gain unsafe result caching; the affected-check owner remains responsible for valid proof reuse.
Expanded aggregate receipts store repeated suite metadata as explicit defaults, preserving every
obligation and measurement within the existing byte cap; regression coverage reconstructs 232 results.

MVP: verify duplicate-stage preflight, cross-process/worktree exclusion, allowed distinct commands,
recursive rejection, timeout and spawn-error cleanup with real tiny process fixtures. Run affected OS
checks and required CI once after batching repairs. Budget: seven files (including the release-contract assertion), 30 KB and 20 active minutes;
external provider waiting is separate. No changed always-load module or dependency is introduced;
release-routing prose changes only in its existing workflow document.

GTM: use the current release loop as the free pilot. Report prevented executions and measured timing
separately from provider waits; no CPU, token, cash or savings claim without compatible observations.
Rollback is a checked source revert; preserve failed runs and private receipts.


## CI gate allocation (ADLC-OBS-005@0.1.0)

PRD: execute Agentic OS readiness/doc/module evaluators once per CI run. The required `budgets`
job owns them; `test` owns affected behavior and packaging. Both statuses remain required. Avoid
serializing the jobs, another runner, artifact transfer, cache, or an unchanged second evaluator.

TAD/ADR: `check:ci` binds the event checkout and verifies the exact existing budgets workflow contract,
current test job, workflow ref, run and attempt before allocating evaluator coverage. Contract drift
blocks the test job. The native receipt/export records that separate gate as `not-observed`; this is
allocation, never proof of a passed gate or permission to merge. Local `check` retains evaluators first.

MVP: reject missing/changed ownership and wrong revisions; prove one behavior execution without the
second evaluator, local evaluator failure propagation, and honest exported coverage. Run the affected
checks and protected `test` plus `budgets` gates. Roll back through a source revert preserving receipts.

GTM: compare compatible CI observations before claiming elapsed or cash savings. This removes one
known evaluator invocation, not a measured number of seconds. Bound this slice to seven files, 30 KB
and 20 active minutes; external CI wait is separate. No always-loaded prompt or required gate changes.
