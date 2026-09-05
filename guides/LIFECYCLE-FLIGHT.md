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

The manifest has exactly `schema`, `maxAgeSeconds`, and `requirements`. Encode it using the package's
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

Each requirement has exactly the eight fields above. IDs are unique lowercase identifiers. Owners and
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

## Scope and cost

The three phases share the existing bounded evidence command module, Git observers and integration
oracle. Core module delta is zero; runtime dependency delta is zero; per-consumer controller multiplier
is zero. Workflow references replace existing prose to keep the always-load budget flat. This guide
loads only when the consumer uses flight observations. Consumers adopt a reviewed package pin and a
reviewed manifest; installing the package alone does not configure an external evaluator.

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
