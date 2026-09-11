# Validation economy

Use the source owner's existing runner and validators. Profile a completed run before rerunning it.
Batch related repairs, then run the dependency-closed affected checks on final bytes.
Repeat a passing check only when changed inputs, a failure, or an unresolved concern requires it.

## Affected validation (TEST-IMPACT-001@1.0.0)

PRD: narrow source changes require their direct/transitive behavior checks and mandatory contracts;
unknown impact cannot produce a narrow pass. TAD: the existing test entrypoint combines old/new Git
dependency edges, reviewed non-import contracts, safety sentinels, and fresh cheap evaluators.
ADR: keep the dependency-free runner and stable required CI job names; retain explicit broad checks
for shared contracts and a weekly/manual canary. No product runtime or release authority changes.

`npm run check`, `npm test`, and `npm run land` use affected validation. `npm run check:plan` prints
the exact selected suites and reasons without executing them. Local selection includes committed,
staged, unstaged, added and deleted files from the merge base with `origin/main`; `-- --base=<ref>`
selects another baseline. A missing baseline fails with a diagnostic instead of an empty green run.

The graph conservatively includes literal imports/re-exports, self-package exports, file references
and subprocess entrypoints. `test/impact-contracts.json` owns non-import dependencies and the
packaging group. Changed tests run directly; deletion and rename use old edges too. Unknown paths,
opaque affected module loads, changes to the selector/contracts/package/hooks/CI/shared lifecycle
primitives, more than 128 changed files, or over 80% affected suites broaden to the source inventory.
Review computed imports, generated inputs and process boundaries in that map when adding them.

Readiness/doc/module evaluators run first. Behavior and packaging are separate bounded stages;
packaging executes only if selected (clone/install, packed setup, space paths, setup trust, exports).
CI retains its required `test` and `budgets` jobs. The event baseline is PR base, merge-group base,
or push-before; CI checks the actual merged/queued/pushed checkout with fresh execution. It runs no
local full-suite precondition. `npm run check:all` explicitly runs every suite with fresh execution;
the separate weekly/manual canary checks for missed contracts. Investigate any canary failure and
add the missing edge or repair the owning behavior; do not relabel affected results as full coverage.

The private worktree Git directory holds one last receipt and at most three logs. Receipts bind
base/head revisions and trees, actual working bytes and executable modes, index, Git configuration
and refs, package/selector/contracts, selected commands, Node/OS/architecture, environment digest,
counts, outcome and elapsed time. Environment values are never serialized. Source identity is
rechecked before stages and after execution. A one-hour local success can be reused only with exact
matching inputs and log digests. `-- --fresh` disables reuse; CI never accepts local receipts.
These are development observations, not authenticated provider or runtime proofs. External resources
and undeclared ignored inputs are outside this cache: use fresh owner checks for those concerns.

Bounds: 2,048 input files, 499 kB per file, 16 MiB aggregate, 256 suites, four workers, nine minutes
total execution (one minute for evaluators), 480 kB per log and 128 kB per receipt. A worktree lock
prevents competing runs; timeout/cancellation/output overflow kills the process group and fails.
An interrupted lock is explicit evidence to reconcile; it is never silently stolen. No runtime
dependencies, source-core modules or global prompt bytes are added. Tests cover selection, historical
edges, baselines, dirty bytes, contract fallback, receipt rejection and process limits.

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


When runner output identifies a missing prerequisite, a failure may additionally report
`prerequisite: { repository: "github.com/owner/docs", path: "docs/seed.md" }`. Keep the owner's
identity and relative file path; do not infer prerequisites from test names. Each failure has at most
one primary reported prerequisite. The same input bounds apply; malformed locators fail validation.

If any prerequisite is supplied, `prerequisiteGroups` ranks matching repository/path pairs across test
sources by count, then structural locator identity. `unmappedPrerequisiteFailures` retains listed cases
without a locator; `unlistedFailures` still retains missing detail. Source and prerequisite groups are
separate partitions, never additive failure counts. This exposes shared setup leads without rescanning
sources or rerunning tests. Locators remain unsigned reports: discovery does not read their paths,
verify dependency ownership, classify a root cause, suppress execution, or establish readiness.

## Shared bounded input reads

Catalog and evidence ingestion use `src/catalog-input.mjs` rather than consumer copies.
Each read fills one exact unpooled result and uses a one-byte growth probe. This removes
one full payload allocation and copy per successful read; filesystem payload bytes are
unchanged. Short reads, growth, truncation, descriptor identity and metadata races still
fail closed. Every call observes fresh bytes; there is no cross-call evidence cache.

For Git-backed test fixtures, materialize only their declared source surfaces and required authority
files when the check does not need a full working tree. Native sparse checkout can retain the full
index and commit history. Verify the unchanged checks and exact committed-tree identity before
claiming equivalent fixture coverage; record avoided files/bytes separately from observed timings.
