# Validation economy

Use the source owner's existing runner and validators. Profile a completed run before rerunning it.
Batch related repairs, run the affected checks, then run the full applicable suite once on the final bytes.
Repeat a passing check only when changed inputs, a failure, or an unresolved concern requires it.

## Place assertions at the boundary they protect

Input matrices call the production validator with real bounded inputs. Keep integration cases for the
distinct command, process, filesystem, provider, and publication boundaries. Avoid replaying an entire
lifecycle for every encoding or syntax variant when the same validator rejects them.

For example, `__tests__/land-receipt-integrity.test.mjs` keeps all eleven malformed-file cases. Two run
through the CLI: unreadable input and the budget after native identity trailers. The other nine call
`pullRequestText` on real files in the same isolated fixture. Valid publication, exact size/BOM handling,
and body mutation during push still exercise the CLI. No validator, policy, or production observation
is mocked, cached, or relaxed by this optimization.

## Reuse evidence precisely

Batch independent exact remote refs through `remoteRefShas` when they share one observation boundary.
Successor validation reads predecessor and destination together, then obtains new advertisements before
and after binding. Transport identity is checked before and after each call. The batch accepts at most
32 distinct names / 32 KiB of input and 64 KiB of output; duplicate or unrequested advertisements fail.
This reduces repeated Git and transport work in both lifecycle execution and its end-to-end tests.
There is no cross-call cache: a new call can observe a moved or newly created ref.

Record the command, source identity, environment, scope, outcome, and elapsed time. A focused run remains
focused. Keep prior full-suite failures visible; a faster run does not make them pass. Reuse historical
evidence only with its original identity and an explicit account of which relevant inputs stayed equal.
Unknown dependencies, changed runner/configuration, or runtime inputs require fresh applicable checks.
Never treat a result cache or a matching commit alone as proof of dirty worktree bytes or live readiness.

Keep reusable policy here, executable checks in their owning repositories, and ecosystem result history
in upstream `agentic-os/test/log.md`. Shared contract fixtures and the repository check index also live
in `agentic-os/test/`; consumers resolve pinned package assets instead of copying them. This guide is lazy-loaded and adds no always-load bytes or runtime dependency.

## Batch failures from an existing run

`agentic-os observe --checks --input=<file>` accepts optional `failures` in each unsigned
`agentic-os/check-result-observation/v1` receipt. Each entry has `id` (case name), `occurrence`
(positive ordinal for that name within the run), and `source` (repository-relative test file or `null`
when unknown). Use the owner's registry or runner output to map cases; do not guess production owners
from error text. Keep the original command, revision, scope, completeness and counts.

At most 256 entries fit one receipt, still within its existing 65,536-byte input budget. Include counts
and a `failed` or `interrupted` outcome. Partial lists are allowed: `unlistedFailures` explicitly retains
the remainder. Duplicate case occurrences, invalid paths and contradictory counts fail validation.

Each result's advisory `failurePlan` groups only its listed failures by reported test source, largest
group first with source-path tie breaking. Unmapped cases remain separate. Inspect the group to find a
shared cause, batch related repairs, and use affected owner checks before full validation on final bytes.
Grouping is not root-cause proof, an execution filter, a pass cache, or measured time savings. Source
bindings stay on the enclosing result; dirty/stale observations remain historical and unauthenticated.
Different runs are never merged or deduplicated. This uses the existing CLI/MCP discovery path and runs
no candidate code; it neither waives release checks nor establishes runtime readiness.
