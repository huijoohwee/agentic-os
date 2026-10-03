# Validation execution economy

On-demand companion to [Validation economy](VALIDATION-ECONOMY.md). These existing
contracts retain their identities and scope; source scanning is documented in the parent.

## Diagnostic escalation economy

The [repository validation owner](REPOSITORY-VALIDATION.md) binds V09. Before another expensive
diagnostic, inspect the retained failure receipt and bounded log once. State the question the next
run can answer and the missing evidence that makes it necessary. A timeout without a compiler
diagnostic proves incomplete execution; it does not identify a compiler error or expensive source type.
Before a rerun can overwrite mutable aggregate/per-command receipts or logs, retain their bounded
content-bound predecessor through the existing diagnostic export and private handover owners.
For a large-object assertion, evaluate the same identity/equality condition as a Boolean and report
a concise custom failure message with bounded useful scalar context instead of rendering an entire
object or DOM tree. Preserve exact assertion semantics and parent-owned timeout/output/teardown limits.
Pass Boolean operands to the assertion, for example
`assert.equal(Object.is(actualNode, expectedNode), true, boundedMessage)` for identity equality.
A custom message alone need not prevent an assertion formatter from inspecting the original objects.
An oversized diagnostic is a resource risk, not evidence of a termination cause without its receipt.

Use the existing executor, locks, process-group teardown and private artifacts. Bind source/tree,
working bytes, runner/configuration/environment, command, cache behavior and predecessor receipt.
Bind actual helper/compiler/dependency bytes where consumed; a lockfile alone is insufficient.
Declare the deadline, output and artifact byte bounds, observation cadence and stop condition before
launch. Separate a hard enforced limit from a sampled cutoff: sampling can overshoot between reads.
Record the actual stop, elapsed time and retained bytes; retain measured partial CPU/RSS values with
their coverage, and mark unavailable accounting unknown.
Preserve the original gate deadline and every required check. Diagnostic results grant no gate parity.
Charge sequel runs cumulatively against the sprint's time and artifact allowances; per-run limits do
not reset them. Verify owned process teardown and lock release before retry; crashed locks stay blocked.

Choose the cheapest observation that answers the question: retained log and receipt first, existing
phase/progress metadata next, then a bounded targeted diagnostic. Escalate a partial trace only when
its observed phase coverage explains what additional evidence the next run should collect. A larger
trace cap, renamed command or new turn alone is no retry reason. A concrete changed input or newly
observed limitation must justify the incremental work; stop when that question is answered or its cap
is reached. Keep forced/cold-cache and tracing overhead explicit instead of comparing them with a
normal warm gate. Do not clear caches, raise deadlines or rerun the aggregate to erase a failure.

For partial traces, retain complete-event counts, open events, unobserved phases and truncation. Inclusive
parent/child, file/expression and type-relation durations overlap; do not sum them into total cost or
treat one open event at cutoff as the cause. Measured savings require compatible before/after inputs.
Record the next decision and its retained evidence rather than generating another trace by default.
Distinguish observer-triggered cancellation from compiler failure. Equal cache snapshots prove byte
stability at those observations, not absence of intermediate deletion or normal-gate cache validity.

This is agent execution policy, not automatic stage caching or a new artifact monitor. Raw consumer
stages have no declared input contracts; unchanged Git source does not prove unchanged generated,
external or provider inputs. Keep their fresh execution semantics and required CI. Deterministic
checks use the existing declared-input failure guard; diagnostic retries retain their failed evidence.
No new module, dependency, always-load instruction or background observer is introduced.

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
