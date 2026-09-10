---
schema: agentic-os/lifecycle-flight-guide/v2
title: Lifecycle flight observations
owner: agentic-os
load_policy: on-demand
runtime_contract: bin/agentic-os-auxiliary.mjs
verification: node --test __tests__/lifecycle-flight.test.mjs
---
# Lifecycle flight observations

Use the pinned Agentic OS package to discover unavailable prerequisites before expensive checks,
recheck the candidate during handoff, and inspect the result after integration and cleanup.
The command is read-only and emits bounded JSON. Exit 1 means a missing, invalid, expired, or changed
input, or an unfinished observed step. Exit 0 means the selected observations passed.

Every report states `observationOnly: true` and `authorizesEffects: false`. File digest matches prove
byte identity; they do not authenticate an issuer. Environment presence does not validate a credential
or evaluator configuration. Existing owner checks, protected CI, runtime verification, authority
retirement, and authorized cleanup remain required. No report executes candidate code or changes Git.

## Enroll prerequisites once

The owner commits `.agentic-os-flight.json` to its canonical branch through protected review.
`doctor` checks its pre-flight requirements. `land` checks them before autonomous staging/commit and
checks pre/in prerequisites at existing publication inspection boundaries. Absent configuration leaves
existing repositories unchanged; an enrolled malformed manifest blocks instead of silently opting out.
Candidate edits cannot override the canonical manifest. A manifest differing from fetched upstream
policy blocks publication until canonical reconciliation; a stale checkout cannot omit new requirements.

The V1 manifest has exactly `schema`, `maxAgeSeconds`, and `requirements`. Encode it using the package's
`canonicalJson` export plus one LF, so duplicate JSON keys and noncanonical input fail closed. This
readable example is the object to encode, not the final wire bytes:

```json
{
  "schema": "agentic-os/flight-requirements/v1",
  "maxAgeSeconds": 900,
  "requirements": [{
    "id": "evaluator-context",
    "owner": "external-evaluator",
    "kind": "environment",
    "input": "EVALUATOR_CONTEXT",
    "sha256": null,
    "expiresAt": null,
    "phases": ["pre", "in"],
    "remedy": "Supply the approved evaluator context, then rerun pre-flight."
  }]
}
```

Each V1 requirement has exactly the eight fields above. IDs are unique lowercase identifiers. Owners and
remedies are bounded text. `input` names an environment variable; its value is never included in the
report or hashed. A consumer such as Commerce can declare its evaluator trust-anchor, Git executable,
runtime root, and executor-module variables here without adding a consumer controller to Agentic OS.

For public evidence metadata, use `kind: "evidence"`, a 64-character lowercase SHA-256, and an exact UTC
`expiresAt` such as `2026-12-01T00:00:00.000Z`. The environment value must name an absolute regular file
outside every registered worktree. Its bounded bytes must match the owner-declared digest and must not
be expired. Symlinks, unavailable files, candidate-owned artifacts and oversized evidence fail closed.
Declare only public metadata here: never point this mode at secrets or private credentials. These
checks cannot replace signature verification or the independently operated evaluator.

Bounds: 32 requirements, 64 KiB manifest/checkpoint, 128 KiB per public artifact (4 MiB maximum per pass),
and checkpoint age from 1 to 3,600 seconds. Phase lists select pre/in/post obligations explicitly.
An empty requirements array declares that this contract has no external inputs.

## Select resources by operation

Use `agentic-os/flight-requirements/v2` when prerequisites differ by operation. The owner adds a
top-level `operations` list (1–32 unique IDs, including the reserved `publication`) and an
`operations` list to every requirement. An empty requirement list applies that requirement to all
operations; a nonempty list selects only the named operations. Phase selection still applies.
V1 enrollment keeps all existing phase obligations and rejects operation selection.

For example, extend the canonical object above with:

```json
{
  "schema": "agentic-os/flight-requirements/v2",
  "operations": ["publication", "edge-browser", "paid-loop"],
  "maxAgeSeconds": 900,
  "requirements": [{
    "id": "sandbox-context",
    "owner": "sandbox-runtime-owner",
    "kind": "environment",
    "input": "SANDBOX_RUNTIME_CONTEXT",
    "sha256": null,
    "expiresAt": null,
    "phases": ["pre", "in"],
    "operations": ["paid-loop"],
    "remedy": "Resolve the sandbox runtime through its owning runner, then repeat paid-loop pre-flight."
  }]
}
```

`agentic-os flight pre --operation=edge-browser` neither accesses the sandbox input nor reads its
evidence file. `--operation=paid-loop` requires it. Unknown operations or malformed declarations
fail before filtering. Omitting the option selects `publication`; `doctor` and `land` use that same
reserved operation. Requirements needed for every action use an empty operation list. Publication
requirements cannot be waived with a runtime selection or candidate manifest edit.

Choose the operation from the actual owner runner's coverage, not its name or available tools. Missing
metadata means unknown requirements, not resource-free execution. The owner must enroll the reviewed
manifest and call the matching flight operation before expensive setup; a package upgrade alone does
not migrate a consumer runner. Keep the operation unchanged in later checkpoints:

```sh
agentic-os flight pre --operation=paid-loop > /absolute/external/paid-loop-pre.json
# Run the owner's complete paid-loop check.
agentic-os flight in --operation=paid-loop --checkpoint=/absolute/external/paid-loop-pre.json
```

The operation is bound into the checkpoint source identity. Edge-browser evidence cannot satisfy
paid-loop or publication observations. Inputs omitted by selection carry no readiness claim. A
missing required input blocks that operation; it is neither a failed product assertion nor a pass.
Run other independently required operations with their own checkpoints and retain blocked coverage.

Resource policy is provider-neutral: use the same contract for container engines, browsers, model
endpoints, accelerators or credentials. Activate only the selected runner's dependencies, share them
only under its existing ownership/locking policy, and release only resources it acquired. For the
Commerce reference case, full paid-loop coverage needs its sandbox engine; edge-only browser coverage
does not establish that loop. This observer never starts, installs, probes or stops a tool, interprets
commands, or grants execution authority. Environment presence is still only presence; the owner must
verify runtime identity and readiness. Worktree enumeration for public evidence is also lazy and occurs
only when a selected evidence input is present.

## Use all three phases

Run pre-flight in the clean committed lane before its expensive owner checks. Store observations
outside the worktree so they do not become candidate changes:

```sh
agentic-os flight pre > /absolute/external/flight-pre.json
# Run the owning repository's required checks.
agentic-os flight in --checkpoint=/absolute/external/flight-pre.json
```

Pre-flight captures the repository/profile, retained lane ref, HEAD/tree, canonical revision, worktree
path, and requirements digest. In-flight requires a successful pre/in checkpoint with the same source
and requirements, checks its age, repeats prerequisite observations, and refuses candidate byte risks,
ref changes, or canonical drift. A source/configuration change requires a fresh pre-flight checkpoint
and relevant owner checks. Long operations must refresh expired checkpoints; do not edit timestamps.
Environment checks observe presence only; public evidence pins detect changes in evidence bytes.

After the authorized protected merge, exact cleanup and canonical synchronization, run from canonical:

```sh
agentic-os flight post --ref=agent/device/lane --checkpoint=/absolute/external/flight-pre.json
```

Post-flight still binds the retained source ref and requirements; canonical advancement is expected.
It separately reports exact integration classification, target worktree/path absence, canonical
synchronization, and canonical byte cleanliness. A leftover path, including a dangling symlink, is
unfinished cleanup. An unrelated worktree never becomes a cleanup target. Runtime and authority
retirement verification are explicitly false because this command has not authenticated those effects.

Remote refs are cached observations: refresh them through the existing authorized workflow before
interpreting post-flight. A checkpoint digest detects corruption, not malicious replacement, and no
checkpoint is accepted as permission by a mutation command. These are sampled observations, not locks
or continuous monitoring; mutation controllers must still perform their own immediate revalidation.

`--ref=<lane>` selects a retained local lane from canonical. `--requirements=<file>` previews an explicit
manifest without enrolling it; it never replaces the manifest that `land` reads from canonical policy.
Use the same preview file at every phase. The report contains missing IDs, owners and remedies but no
environment values or evidence content. Malformed input produces a typed refusal without raw data.

## Prepare consumer review metadata before publication

Preview every enrolled prerequisite for an operation before its expensive checks:

```sh
agentic-os flight plan --operation=publication
```

For a v1 manifest, omit `--operation`. The preview reports all pre/in/post requirements together,
including each input's phases, owner and remedy. Missing future inputs remain visible without changing
phase-specific admission: run `flight pre` for the actual start boundary. A plan cannot serve as an
in-flight checkpoint, even when all its inputs are present. It executes no consumer code and grants no
authority. Dependency, source-map and metadata validators stay with their source owners; run those
read-only checks before build/publication, then retain the enrolled public evidence. Revalidate volatile
inputs at the effect boundary. Do not replace a consumer validator with an environment-presence check.

When the consumer requires review metadata, validate its body with the consumer's existing contract
before the first `land`. Supply that prepared file directly:

```sh
agentic-os land --body-file=/absolute/external/review.md
```

Relative paths resolve from the lane root. The file must be regular, valid UTF-8, nonempty, and without
NUL or authored `Lane:`, `Base-Revision:`, or `Source-Head:` lines. Symlinks and changing files are
rejected. The complete body, including the generated suffix, is limited to 64 KiB. Invalid inputs stop
before autonomous staging/commit, commit hooks or fetch, as well as push/review mutation. This includes
a repeated landing of an already published head. The early check reserves the exact native trailer
size; the actual committed source and fetched base are bound at publication.

`land` captures the file once before publication, preserves its exact text at the beginning (including
YAML front matter and line endings), then appends two LF characters and the three native identity
trailers. Later file changes cannot alter that captured handoff. The harness checks encoding, bounds
and identity ownership; consumer metadata schemas remain consumer-owned. Without the option, a new
review gets generated text and an existing exact-head review keeps its title and body without edits.
An existing review without the exact source-head trailer fails before mutation; provide the validated
body file to repair or explicitly replace its text. Repeating a landing does not reset authored metadata
or restart checks through an unnecessary review edit. This adds no module or always-load guidance.

## Scope and cost

The three phases share the existing bounded evidence command module, Git observers and integration
oracle. Core module delta is zero; runtime dependency delta is zero; per-consumer controller multiplier
is zero. Workflow references replace existing prose to keep the always-load budget flat. This guide
loads only when the consumer uses flight observations. Consumers adopt a reviewed package pin and a
reviewed manifest; installing the package alone does not configure an external evaluator.

## Observe the active CI step

`agentic-os pipeline` retains bounded step identities and provider start/completion timestamps within
its existing repository/run/head/attempt binding. Completed durations and elapsed active-step times
are observations. Missing timestamps remain unavailable. Duplicate steps, malformed timestamps and
reversed durations fail closed; a provider rerun cannot relabel observations from an earlier attempt.
Step changes reset the existing polling backoff. Elapsed time alone does not trigger another event or
workflow. An expired observation window returns the active step, the next observation delay and
`observe_same_run_and_attempt`; it supplies no speculative completion estimate. A terminal failure
returns `inspect_failure_before_retry`. The watcher never restarts a workflow or submits authorization.

Inspect the owner failure, reconcile uncertain effects, and retain the attempt history before any
authorized retry. Do not restart an unchanged deterministic failure. Check reuse, duration forecasting
from comparable history and automatic consumer-validator execution are outside this first sprint.
This slice adds no runtime module, dependency, service or always-load prompt text; one new test module
covers the pre-commit preservation boundary. Existing source files remain below 600 lines.

## Bounded publication cost

Exact publication observations share one raw-byte comparator. Each fresh observation batches at most
32 regular-file descriptors and 32 MiB of source bytes into the existing isolated helper. A batch has
one reusable 64 KiB hashing buffer and a seven-second kill deadline; failed, partial or timed-out
helpers produce no accepted results. This deadline
is stricter for a slow batch than the previous seven seconds per file. Descriptor identities, source
path, executable mode, declared size and end-of-file remain checked; filters and candidate code never
execute. Descriptor cleanup waits for child exit. Symlink and submodule checks retain their contracts.

Pre-fetch, pre-push and post-push checks remain fresh. Results are never cached across effects. Measure
repeated observations on the same disposable tree to compare startup cost; report files, bytes,
process count and elapsed time separately from hosted CI or provider waits. No timing threshold can
replace byte-integrity evidence. This changes no runtime dependency or module count.
