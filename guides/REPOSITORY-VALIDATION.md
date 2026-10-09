---
title: "Repository Validation PRD-TAD-ADR-MVP-GTM"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.1.3"
owner: "agentic-os"
date: "2026-10-09"
lang: "en-US"
frontmatter_contract: "required"
load_policy: "on-demand"
continuity_id: "REPOSITORY-VALIDATION-001"
prd_revision: "1.1.3"
tad_revision: "1.1.3"
adr_revision: "1.1.3"
mvp_revision: "1.1.3"
gtm_revision: "1.1.3"
status: "implementation"
---

# Repository validation

[Shared cache policy](CACHE.md) routes cross-mechanism lifecycle decisions. This guide retains
the consumer check-input, receipt-reuse and validation authority contract.

## PRD

`REPOSITORY-VALIDATION-001@1.1.3`: a solo maintainer changes one source concern and
runs the checks affected by its declared inputs and dependencies through the pinned
Agentic OS owner. Context: repeated whole-repository checks delay delivery. Intent:
reduce avoidable execution without changing test assertions or protected authority.
Directive: reuse the existing owner runners, preserve known failures, and broaden
when the declared dependency boundary cannot explain a change.

Role/Subject: repository maintainer. Action/Verb: validates. Object: exact candidate
inputs. Outcome: a bounded selected-check receipt with explicit coverage and reuse.
This is the consumer execution contract; [validation economy](VALIDATION-ECONOMY.md)
remains the reusable policy and native OS test-runner guide.

| Criterion | Acceptance and validation |
|---|---|
| V01 | The selected repository identity matches its Git origin and supplies one closed check contract. Malformed inputs fail before commands. |
| V02 | Changed, added, deleted, staged and unstaged files select owner checks. A changed prerequisite selects its dependents; selected dependents bring required prerequisites exactly once. |
| V03 | Unmapped paths select declared conservative fallback. Policy, package, workflow and hook changes select the declared complete broad fallback. Missing baseline is an error. |
| V04 | Local success is reusable for one hour only with matching command, declared dependency inputs, policy, runner, environment, platform and log bytes. A matching deterministic failure blocks another attempt unless explicitly refreshed. |
| V05 | CI validates its actual event/checkout baseline, uses fresh execution, and rejects dirty sources. Local receipts never substitute for protected checks. |
| V06 | Source drift, recursive invocation, timeout, process failure and output bounds cannot produce passing evidence. Logs retain a bounded tail without skipping command execution. |
| V07 | Consumers invoke the pinned common executor through default validation and protected CI; owner commands remain in their source repositories. Unenrolled consumers are not claimed enforced. |
| V08 | Every actual command updates bounded private cost observations. Learned order preserves selected coverage, prerequisites and mandatory precedence; stale or incompatible observations restore declared order. Reuse never counts as new execution. |
| V09 | Before an expensive diagnostic retry, inspect retained evidence, identify the unanswered question and bind its incremental work to source/context and explicit limits. Partial traces, sampled cutoffs and unavailable resources remain qualified; fresh CI and mandatory coverage remain intact. |
| V10 | Readiness proof inspection traverses the Markdown inventory once per invocation and reuses its count; it never reuses document bytes or proof results across invocations. |
| V11 | A reviewed lazy-import edge narrows impact to declared route suites only when the exact importer/dependency pair is present and every listed suite's input fingerprint binds the deferred bytes. Missing or stale edge contracts fail closed. |

V01–V06 are exercised by `__tests__/repository-validation*.test.mjs` and the existing
`__tests__/test-{impact,runner}.test.mjs`; V10 is checked by
`__tests__/readiness-proof.test.mjs`. V07 requires each consumer's reviewed
package pin, script/workflow diff, protected checks and exact integration receipt. V11
is checked by `__tests__/test-impact.test.mjs` against the repository's registered lazy edges.

## TAD and ADR

TAD `1.1.3` consumes PRD `1.1.3`; ADR `1.1.3` binds V01–V11. Agentic OS owns the
selector, process bounds, input observation and receipt reuse. Each consumer owns
`.agentic-os-validation.json`: source input boundaries, prerequisite relationships,
existing commands and conservative fallback. Do not copy the executor or add a
second persistent repository registry. Discover source/reference/projection roles
through [fleet ownership](../FLEET.md) and checks through `test/repositories.json`.

The readiness-proof CLI inspects one Markdown path inventory per invocation and reuses
that inventory's count in its success output. It does not retain document bytes or proof
results: every later invocation rereads the tree and performs fresh evidence checks. This
removes a redundant recursive directory traversal without changing claim coverage or
proof requirements; `__tests__/readiness-proof.test.mjs` checks the single inventory pass.

The consumer policy has schema `agentic-os/repository-validation-policy/v1` and
exact fields `repository`, `broadInputs`, `always`, `fallback`, and `checks`.
Each check has `id`, `command` (an argv array), `inputs` (literal file/directory
boundaries), `requires` (other check IDs), `reuse` (`local` or `never`), and
`timeoutMs`. `*` means the entire repository; directory boundaries end in `/`.
Fallback is nonempty and must cover all required validation for a broad change. It replaces overlapping narrow checks when selected; mandatory checks and prerequisites remain. Check IDs and
command arrays are unique; missing prerequisites and cycles fail validation.

These are reviewed dependency contracts, not automatic proof that arbitrary code
has no other dependencies. Include file reads, generated inputs and cross-module
contracts in the boundaries. Use `reuse: never` for browser/provider checks,
external files, ignored generated inputs and dependencies whose actual bytes are
not bound. Installed dependencies are not fingerprinted by their lockfile alone.
The native OS source runner retains its existing static-import and contract graph.
Its `deferred` impact entries are an exact edge contract for source-literal dynamic
imports: changed deferred modules select the listed route suites, and those suites
bind the module bytes in their fingerprints. Do not defer an edge when its runtime
consumers are unknown; ordinary static and undeclared dynamic edges stay conservative.

### Diagnostic decision contract

V09 addresses the incomplete compiler trace: it reported 6,005 roots; checker and emit were not observed.
That evidence established a coverage gap, not a compiler hotspot. The operator must record
the next diagnostic question, bound predecessor, cache behavior, phase coverage, deadline,
byte cutoff semantics and actual outcome through the existing private receipt/handover owners.
[Diagnostic escalation economy](VALIDATION-ECONOMY-EXECUTION.md#diagnostic-escalation-economy) owns
the on-demand execution policy; this joined plan owns its acceptance and delivery limits.

ADR V09 selects evidence-first bounded diagnosis over automatic unchanged-stage blocking. Consumer
stages may read unbound generated or provider inputs, so Git identity alone cannot safely suppress them.
Keep existing declared-input failure guards, command locks, deadlines, fresh CI and failure retention.
No new cache, profiler, watcher, controller, dependency or runtime assertion is added. Rollback reverts
these two guide changes while preserving every prior diagnostic and release receipt.

ADR V11 selects exact test-route contracts for reviewed lazy CLI imports over file-level fanout from
every importer. The importer/dependency pair must exist in source, the listed suites must cover its
runtime routes, and their check fingerprints must bind the deferred module bytes. All other imports
keep their conservative edges; this cannot skip a required test or make local reuse authoritative for CI.

### Continuous resource feedback

The lazy `agentic-os-validation-economy.mjs` module records command duration and
failure rate after stable source execution. One private worktree receipt contains
at most 128 check records / 64 kB, expires after 14 days, and is written atomically
under the existing validation lock. Context binds policy, runner, repository root,
Node/platform and environment. No provider, background worker, dependency or
always-loaded guidance is introduced. Hosted runners learn only within their own
checkout unless an owner separately designs an authenticated transport.

After three observations for every ready optional check, execution automatically
orders them by smoothed failure rate per millisecond, with a small exploration
floor. Prerequisites and mandatory checks retain precedence. Cold or incomplete
observations keep declared order. A 0.25 moving weight adapts to recent runs;
sample counts saturate at 32. Cost data never selects/skips checks, changes commands,
raises timeouts, grants authority, or substitutes for fresh CI results.

Plans and receipts expose estimated execution time, unknown costs, source bytes,
the execution order and hard run budget. Unknown cost is null, not a 15-minute
estimate. An observed duration above both twice the learned mean and mean plus
one second is reported as a regression. Inspect the owner command before changing
its scope or budget; no automatic assertion, timeout or workflow edits occur.

Checkout work precedes this installed executor. An exact PR synthetic merge needs
depth 2 for the diff only: the merge and both event parents. Each owner must prove
that its other gates need no older history before using that depth. Explicit PR
head, push and merge-group jobs retain sufficient history for a verified merge
base. The runner reports this constraint and never guesses a missing base or fetches
history on its own. [Canvas PR 928](https://github.com/huijoohwee/agentic-canvas-os/pull/928) demonstrates the applicable shallow-merge
contract with a real depth-2 clone regression and fresh protected checks. Compare
checkout/job timings separately from selected command duration; none is a billing
estimate or proof of whole-suite parity.

### Invocation

The common entrypoint is packaged automatically under `bin/`:

```sh
node node_modules/agentic-os/bin/agentic-os-validation.mjs plan
node node_modules/agentic-os/bin/agentic-os-validation.mjs run
node node_modules/agentic-os/bin/agentic-os-validation.mjs run --base=<ref>
node node_modules/agentic-os/bin/agentic-os-validation.mjs run --all --fresh
node node_modules/agentic-os/bin/agentic-os-validation.mjs ci
```

Use `--root=<absolute-path>` for an explicitly selected checkout. Consumers wire
their default validation entrypoint (usually `check`) to `run`, `check:plan` to `plan`,
and their existing protected CI job to `ci`. `run` also detects CI and enforces the
same fresh event-bound execution; local baseline overrides are rejected in CI.
Preserve unfiltered owner commands under explicit names referenced by the policy;
never have a selected command invoke the wrapper recursively. CI retains existing
required status names and source/runtime/release assertions. `workflow_dispatch`
and `schedule` use fresh broad execution; PR/merge-group/push use verified event
baselines. PR checkouts verify either both merge parents or the exact PR head and
provider merge revision; receipts distinguish those surfaces without claiming merge
parity. PR-head jobs fetch the exact provider `GITHUB_SHA` object if it is absent;
the verifier requires either the provider-selected head itself or a merge whose
ordered parents equal the event base and head. Optional or stale `merge_commit_sha`
webhook metadata is not accepted as parent proof. This preserves head-only
coverage for a head checkout. All modes reject unsupported or missing context
instead of empty green.

Existing parallel CI jobs may use `ci --only=<check-id>[,<check-id>]`. This intersects
the affected plan with that job's declared checks and includes their prerequisites;
unknown IDs fail. An unaffected partition executes zero commands and records that
explicitly. Consumer CI must cover every required broad-fallback check across its
jobs, including test shards, and preserve its aggregate status assertions. A partition
receipt claims only its selected checks, never full workflow completion. Local `run`
without `--only` executes the combined plan. Never give a test-only job a wrapper
whose fallback includes builds or deployment effects outside that job's role.

Execution is serial across owner commands because existing build and browser
runners can share generated outputs and ports. Duplicate selected checks and shared
prerequisites run once. The existing process-group executor handles cancellation
and timeout; the same private worktree receipt directory serializes execution.
Only local deterministic checks opt into success reuse or unchanged-failure stops.
After recording a new observation, use `run --retry-failed` to retry failed checks
while reusing still-valid successes, including mandatory checks and prerequisites.
Missing or invalidated results execute normally; failed evidence remains failed.
`plan --retry-failed` previews that selection. This option is local only and cannot
combine with `--fresh`; CI retains fresh execution of its entire selected plan.
`--fresh` requires a new observation or deliberate diagnostic retry; it is not a
way to hide failed evidence. CI always runs fresh.

Source identity is streamed through 256 KiB buffers, including binary files and
symlink bytes without following targets. Repeated observations inside one invocation
reuse only matching inode/mode/size/mtime/ctime identities. Bounds are 50,000 files,
64 MiB per file, 512 MiB aggregate, 128 checks, 15 minutes per command and one hour
per run. Logs retain at most 480,000 bytes; over 16 MiB of command output fails.
Receipts remain at most 128,000 bytes and always carry `authority: false`.

Decision: extend the existing input/receipt/process owners and add four lazy CLI
modules; no runtime dependency, infrastructure, new provider, source-core module,
or always-loaded prompt bytes. A separate executor per repository was rejected.
Local check results do not authorize integration, cleanup, deployment or payment.

## MVP and GTM

Adopt the exact protected OS revision in runnable source and projection consumers,
then bind their existing checks and integration jobs. `81rv10` remains a declared
reference with no package runner; its presence and role belong to fleet inspection.
Do not invent executable coverage or production readiness for that reference.
Keep the owner runtime and consumer adoption receipts separate.

Measure commands executed/reused/skipped and elapsed command time on the same
candidate inputs. Compare a narrow source edit, a shared-contract change and an
unchanged rerun. Source coverage, provider waiting and test failures remain visible.
The intended buyer benefit is faster reliable solo delivery; actual savings, WTP,
revenue and production readiness require measured consumer evidence.

V09 implementation: two existing on-demand guides, at most 8 KiB added, zero modules/dependencies and
zero always-load bytes. Estimate: 15 active minutes for source; cap: 30 active minutes plus native checks.
Use affected `npm run check` for source/document contracts and independent policy review for limits,
partial evidence, input uncertainty and gate preservation. These prove the guide change, not enforcement
against arbitrary tools. Protected source integration and consumer adoption remain separate receipts.
GTM V09: the retained compiler investigation is the free local pilot; compare compatible executed work
before reporting savings. CPU, model tokens, cash cost, demand and willingness to pay stay unmeasured.

## V11 — Exact lazy-route impact

The source selector now keeps each tested lazy CLI edge explicit. A change to a deferred module selects
its declared route suites directly; every such suite's check-input fingerprint includes that module's
bytes. An invalid, missing or changed importer/dependency pair fails before validation. Static imports,
computed loaders and unreviewed dynamic imports retain the prior conservative behavior.

Replay of the prior four-path admission/docs candidate planned 37 of 247 suites with the reviewed route
contracts, versus 77 of 247 before this change: 40 fewer planned suites (52%). The prior runner estimated
337 seconds of command time; no compatible after-run duration has been measured, so no elapsed-time or
cash savings are claimed. The four changed files add no package, service, model call, token use or always-
load bytes. Sprint cap: four files, 8 KiB additions, zero modules/dependencies, one `deferred` contract key,
20 active minutes; protected CI remains fresh and mandatory. Rollback reverts the four-file source candidate
and preserves receipts.

GTM V11: use the free local maintainer loop to compare planned coverage first, then compatible elapsed
command time on a later unchanged cohort. First-dollar conversion, demand, and willingness to pay remain
unmeasured; this change makes no buyer or Production claim.
