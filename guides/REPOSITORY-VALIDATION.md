---
title: "Repository Validation PRD-TAD-ADR-MVP-GTM"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
owner: "agentic-os"
date: "2026-09-14"
lang: "en-US"
frontmatter_contract: "required"
load_policy: "on-demand"
continuity_id: "REPOSITORY-VALIDATION-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
status: "implementation"
---

# Repository validation

## PRD

`REPOSITORY-VALIDATION-001@1.0.0`: a solo maintainer changes one source concern and
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

V01–V06 are exercised by `__tests__/repository-validation*.test.mjs` and the existing
`__tests__/test-{impact,runner}.test.mjs`. V07 requires each consumer's reviewed
package pin, script/workflow diff, protected checks and exact integration receipt.

## TAD and ADR

TAD `1.0.0` consumes PRD `1.0.0`; ADR `1.0.0` binds V01–V07. Agentic OS owns the
selector, process bounds, input observation and receipt reuse. Each consumer owns
`.agentic-os-validation.json`: source input boundaries, prerequisite relationships,
existing commands and conservative fallback. Do not copy the executor or add a
second persistent repository registry. Discover source/reference/projection roles
through [fleet ownership](../FLEET.md) and checks through `test/repositories.json`.

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
`--fresh` requires a new observation or deliberate diagnostic retry; it is not a
way to hide failed evidence. CI always runs fresh.

Source identity is streamed through 256 KiB buffers, including binary files and
symlink bytes without following targets. Repeated observations inside one invocation
reuse only matching inode/mode/size/mtime/ctime identities. Bounds are 50,000 files,
64 MiB per file, 512 MiB aggregate, 128 checks, 15 minutes per command and one hour
per run. Logs retain at most 480,000 bytes; over 16 MiB of command output fails.
Receipts remain at most 128,000 bytes and always carry `authority: false`.

Decision: extend the existing input/receipt/process owners and add three lazy CLI
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
