# Validation economy

## Native validation observation (ADLC-OBS-001@0.1.0)

PRD / AO-01: the solo operator must locate an expensive or failed validation stage without rerunning it. Record child-stage wall time, output bytes, result and source identity; keep CPU, tokens and monetary cost unknown unless measured. AO-02/AO-03/AO-04 belong to Graph: recover the Apex catalog after a transient failure, inspect connected tree/timing/topology views, and import this bounded read-only observation into the existing JSON/Markdown/Viewer/Canvas workspace. These criteria share CID ADLC-OBS-001, revision 0.1.0 and the subject/operator, action/inspect, outcome/next-validation-decision relationship.

TAD / AO-01: extend the existing validation runner, command executor, private receipts and cost model. The trusted consumer supplies its existing ordered commands; the shared owner records stages and bounds process groups, time and output. Keep child output in bounded local logs and emit concise progress. Export sanitized metadata on demand through the validation CLI; exclude environment values, absolute paths, raw output and command arguments. Graph consumes the portable observation, not private receipt paths. Imported observations grant no execution, evaluation, release or payment authority.

ADR / AO-01: constraints retain exact source checks, mandatory coverage and fresh provider CI. Argumentation rejects another polling service, telemetry database or renderer. Outranking selects structured observations at the existing execution boundary and an early unchanged-failure guard. An unchanged known failure blocks before unrelated expensive checks; it never becomes a cached pass. Provider waits remain distinct from measured local execution. Rollback reverts these source changes and the consumer pin while preserving receipts.

MVP / AO-01–AO-04: baseline OS `2e9b3b9842460e3e29cf2d414f0eb45c07a42281`, Graph `6ecb7192f9017b2e7630d79ccf8975e2b56a59f5`. Budget: 90 active minutes, two repositories, at most 16 source modules and 200 KB changed content; no new dependencies or always-running service. Bound observations to 128 stages and 128 KB; Canvas retains at most 32 spans per imported page. Verify ordered execution, failure/cancellation, output redaction/bounds, unknown resources, malformed imports, recovery, selection synchronization and unchanged authored state. Measure emitted versus observed output bytes separately from elapsed time; no full-suite parity follows from focused checks.

GTM / AO-01–AO-04: use this actual validation loop as the free local pilot. Record time to identify the slowest stage and the next check chosen. The observed prior Graph check block took 794.72 seconds in [the protected PR run](https://github.com/huijoohwee/agentic-graph/actions/runs/35097953831); this is a baseline observation, not savings or buyer proof. Demand, willingness to pay, CPU cost and commercial conversion remain unmeasured.

## Measured resources (ADLC-OBS-001@0.2.0)

PRD / AO-05: the operator can inspect CPU time, peak process RSS, reported model tokens and estimated model cost beside each validation stage and agent span. Preserve known zero, missing, partial and reused observations distinctly. Use the existing OS receipt and agent cost records; Graph owns table, timing, tree, topology and JSON/Markdown/Viewer projections. No observation authorizes execution, spending or release.

TAD / AO-05: instrument the existing bounded command executor through one lazy native helper. Where the host already provides Python 3 and POSIX resource accounting, one isolated supervisor waits for the unchanged command and returns bounded resource metadata over a private descriptor. Capture user/system CPU milliseconds and maximum single-process RSS in bytes; include only waited children and their accounted descendants. Peak process RSS is not concurrent process-tree memory. Unsupported hosts retain direct execution and explicit unavailable metrics. No polling daemon, shell command interpolation, installed dependency or model call is added. Preserve timeout, cancellation, output, exit and process-group teardown semantics. Never parse metrics from command stdout/stderr.

Reuse the existing reported agent cost shape (`status`, `prompt_tokens`, `completion_tokens`, `estimated_cost_usd`) for model usage. Estimates stay labeled estimates; machine costs and actual cash charges require separate evidence. An absent report remains unknown, not zero. Aggregate only sibling executed stages from one source/run; exclude reused observations from current consumption and mark missing coverage. Never add parent and nested stage totals, sum memory peaks, infer full-run metrics from a page, or charge reused historical usage again.

ADR / AO-05: accepted from the 2026-09-17 implementation instruction. Native waited-process accounting was selected over always-running sampling or a new telemetry service because it adds no service and preserves command boundaries. Python is optional host capability, not a package dependency; unsupported or interrupted capture reports its limitation. Source semantics: [Python resource usage](https://docs.python.org/3/library/resource.html#resource-usage), including waited-child scope. Existing token/cost attribution remains in the agent toolkit rather than a second ledger.

MVP / AO-05: execute real CPU/allocation fixtures through the shared runner; verify stdout isolation, nonzero exits, missing executables, timeout/process teardown and unsupported capability. Test unknown/zero/invalid/partial/reused aggregation and bounded exports. Graph consumes the protected OS revision, renders measured resources and existing reported token/cost records, and verifies the same metrics across table, timing and editor projections. All applicable owner and protected CI checks remain required.

GTM / AO-05: use the completed local validation run as the free pilot. Record CPU/RSS capture coverage and overhead alongside wall time; do not infer willingness to pay, cash savings or a pricing rate. Scope: at most 12 source modules, 100 KB of source edits and 90 active implementation minutes across OS and Graph; external CI waits are tracked separately. Rollback through a checked source revert; preserve prior receipts and their measurement provenance.

## CI waits and bounded feedback (ADLC-OBS-001@0.2.0)

PRD / AO-06: distinguish CI queue delay from workflow execution, then use observed expensive or regressing stages to choose the next optimization. The same operator/inspect/next-validation-decision relationship applies. CPU, memory, model usage and cash cost remain unknown when the CI provider has not reported them.

TAD / AO-06: `node node_modules/agentic-os/bin/agentic-os-validation.mjs observe --root=. --ci-run=<run-id>` performs one bounded provider read. Bind the result to repository, run, attempt, commit and local commit tree. Initial CI wait ends at the first job start; retries start at the provider's current-attempt timestamp, excluding earlier attempts. This includes provider preparation and does not isolate runner scheduling alone; workflow execution includes later waits and provider completion overhead. These are timing observations, not job CPU or authenticated release receipts. Running workflows remain partial. There is no background poller.

The existing economy owner keeps a 14-day, 32-sample weighted baseline and ranks at most five expensive stages. Record wall time, CPU, maximum process RSS, reported tokens, estimated cost and queue delay only when known. The dependency-aware owner scheduler already prioritizes likely failures per unit of time after three observations; required coverage and dependency ordering remain unchanged. New resource regressions inform the next profiling choice. Advice does not edit source, waive checks, change deadlines, buy capacity or spend money.

ADR / AO-06: persist stage and CI feedback beneath the configured private artifact root, keyed by the common Git directory so worktree retirement does not erase history. Keep repository, stage definitions, Node/host execution context and CI workflow cohorts separate; a changed cohort starts cold. Short exclusive locks and atomic writes prevent lost updates. Reused results and repeated or older completed CI observations do not train the baseline again. History is disposable optimization data, never source or execution authority. `.workspace` owns private local storage; OS owns the producer and contract. Do not publish logs, machine identifiers, environment values or history bodies.

MVP / AO-06: verify queue/execution separation, running/failed states, impossible timestamps, identity drift, unchanged-read deduplication, bounded resource regressions, known zero and missing data. Expose evidence-linked ranked advice beside the existing Canvas resource view. Export only sanitized bounded records. A feedback capture error leaves execution results intact and is reported explicitly.

GTM / AO-06: run the actual local validation and inspect its exported report. Compare only compatible measured baselines; require observed before/after evidence before claiming savings. Rollback source through the owning checked PR while retaining local reports. This extends the AO-05 module/byte/time budget with workspace documentation only; no additional service or dependency.

Use the source owner's existing runner and validators. Profile a completed run before rerunning it.
Batch related repairs, then run the dependency-closed affected checks on final bytes.
Repeat a passing check only when changed inputs, a failure, or an unresolved concern requires it.

Generated logs, receipts, portable observations and screenshots belong to device-local `.workspace/.artifacts`, outside the published source tree. Set clone-local `git config --local agentic-os.validationArtifactsRoot <absolute-real-artifact-directory>` after creating that private directory. The existing receipt owner isolates each worktree by Git-directory digest; missing enrollment retains the Git-private default for portable clones and CI. Existing records are preserved, not migrated or deleted. Workspace publication remains essential-only; do not force-add artifact bodies.

Export the most recent child-stage metadata with `node node_modules/agentic-os/bin/agentic-os-validation.mjs observe --root=.`. Use `--input=<private-validation-last.json>` for an aggregate owner receipt, or `--input=<private-last.json>` for the existing OS test receipt. OS test observations retain concurrent timing and unknown historical dirty state; no sequential edges are inferred. Expanded aggregate test receipts deduplicate measurement descriptors and stage membership, while diagnostic digests remain in the existing per-check receipts. Every result, count, timestamp and numeric resource measurement remains available within the same 128 KB bound. More than 128 recorded checks require another bounded export with `--offset=128`; coverage reports captured, recorded and expected counts. Exports are bounded, unsigned observations; timestamps do not establish provider proof.

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

## Observe a complete lifecycle

`node bin/agentic-os-validation.mjs observe --workflow=/absolute/private/workflow.json`
joins existing receipts without running their commands. Keep the manifest and outputs in the configured
local `.workspace` artifact directory. The manifest uses `agentic-os/workflow-observation-input/v1`, a
bounded `id`, exact `source: {repository,revision,tree}`, an `expected` list of phase IDs, and `phases`.
Each phase supplies its `id`, local `file`, SHA-256 `digest` of the exact UTF-8 bytes, and optional
`revision` when that phase observes the separately integrated main revision. Expected phases can include
preparation, checks, CI, integration, cleanup, synchronization and runtime. Do not omit an expected phase
to manufacture completion. Capture native JSON separately from command diagnostics.

Accepted owners are flight, validation observation, pipeline JSONL, sprint finish, user cleanup,
canonical sync and local runtime readiness. Unknown schemas, source/revision drift, mixed CI attempts,
duplicate receipts and changed bytes fail. Missing phases remain explicit. The output reuses the native
`agent-toolkit-run/v1` trace contract for local JSON import; it never exports source paths, command argv,
environment, logs or credentials. Lifecycle and child spans retain their original receipt digest and
revision. The root's resource totals stay unknown because phases may contain nested measurements.
Known zero is retained, reused-stage current consumption is unknown, and the existing ranked validation
feedback is carried as advisory data. Receipt coverage is an evaluation metric, not authenticated effect
proof or release authority. Unreported phase timing remains unknown.

Bounds: 16 expected phases, 128 KB per receipt, 32 KB manifest, 128 KB output and 32 visible spans.
Every observed phase is visible before optional step detail; omitted steps and missing phases mark the
trace partial. This is one on-demand read, with no new polling, execution, storage service or dependency.

## Native start-to-release collection

`agentic-os workflow targets` lazily lists this repository's registered targets under the sibling
`.worktrees` root. Storage defaults to sibling `.workspace/.artifacts/workflows/<repository-hash>`;
Explicit local `agentic-os.workspaceRoot` enrollment takes precedence; relative paths resolve from the canonical repository. Nothing scans arbitrary files
or starts a runtime. Detached, locked and prunable targets remain observations, never cleanup grants.

Use the existing `agentic-os/workflow-observation-input/v1` manifest with expected phases in order:
`preparation`, `checks`, `ci`, `integration`, `cleanup`, `synchronization`, `runtime`. Include only
available receipts with exact SHA-256 digests; missing phases remain incomplete. Then run:

```sh
agentic-os workflow collect --input=/absolute/workflow-input.json
agentic-os workflow export --input=/returned/storage/digest/manifest.json
```

Collection verifies repository, commit tree and receipt bindings before writing a private immutable
bundle. Repeating identical collection reuses verified bytes; mismatches and symlinks fail closed.
A new phase produces a new bundle; no latest pointer or shared receipt is overwritten. Failed partial
collections stay private for diagnosis. Limits: 64 registered targets, 16 receipts × 128 KB, a 32 KB
manifest, 32 rendered spans with explicit omission coverage, and 256 KB CLI output. Receipt sources
remain intact; collection survives worktree retirement. Export remains a read-only observation with
60-second freshness, not proof of current provider status or release authority.

MCP tools `workflow.targets`, `workflow.collect`, `workflow.export` use this same owner. Equivalent
invocations are `/workflow.targets #read-only`, `/workflow.collect #mutating @input:/path/input.json`,
and `/workflow.export #read-only @input:/path/stored/manifest.json`. Import exported native JSON into
Canvas to synchronize JSON, Markdown, Viewer and Span tree with timing.

The exported optimization ranking keeps the original evidence digest, revision and sample count.
The existing validation economy owner remains the only learning history: it updates bounded cohort
baselines, orders eligible checks by observed failure/time economics, preserves required checks and
re-measures subsequent runs. Collection never trains on imported, reused or duplicated observations.
CPU is waited-process CPU; memory is maximum process RSS, not total machine RAM; unknown token/cash
cost stays unknown. Ranking is advisory, and receipt coverage is not a savings or release claim.

## Complete worktree capture and next-context recommendations (WORKFLOW-OBS-003)

The returned `manifest.json` is the single entry point. Its `phases`, optional `traces`, and `archive`
reference immutable receipt JSON, span-page JSON and `recommendations.json` with SHA-256 digests.
All captured spans survive the 32-span transport page bound; Canvas resolves every page from one root,
up to 2,048 spans / 16 MiB. Upstream omissions remain explicit.
The default storage stays `.workspace/.artifacts/workflows`; targets stay registered `.worktrees`.
Each collection is a content-addressed snapshot: collect again when evidence changes and hand off
that exact manifest locator. No mutable latest pointer, directory scan or second history ledger is added.

Optional `context` contains bounded `workflowId`, `worktreeId`, `sessionId`, `turnId`, `threadId` identifiers. Optional
`traces` contains at most 16 `{id, phase, file, digest}` references to existing `agent-toolkit-run/v1`
JSON pages, each at most 32 spans/128 KB. Candidate and plan repository/revision must match the
workflow source; foreign runs cannot be silently assigned to this worktree. Keep missing pages,
parents and unknown resources explicit. Do not export prompts, completions, logs or credentials.
A reported native cost log exposes model, prompt/completion tokens, cache hits and estimated USD;
actual cash cost remains null. Different runtime clocks are not presented as one causal timeline.

```sh
agentic-os workflow collect --input=/exact/source-manifest.json
agentic-os workflow export --input=/returned/manifest.json --offset=32
agentic-os /workflow.recommend '#read-only' @input:/returned/manifest.json
```

MCP `workflow.export` accepts `{input, offset, format}` (offset defaults to zero, multiples of 32); page
`nextCursor` supplies the next offset. `workflow.recommend` accepts `{input}` and reads only the
recommendation reference after checking its digest/source binding. Carry the exact manifest path
into the next workflow/session/turn/thread and call recommend on demand before expensive work.
`sourceMatches` describes the current Git revision, not authority or guaranteed applicability.
Revalidate revision/scope, quality cohort and cache eligibility before applying recommendations;
rerun the same cohort afterward. Ranked historical checks reuse the existing economy feedback;
model advice requests a quality-preserving comparison, never an automatic cheaper-model switch.

Bounds: one input manifest ≤32 KB, each source/page/advice ≤128 KB, ≤2048 captured spans and 32
spans per export. There are no model/network calls, background watchers or unbounded file crawls.
Old receipt-only manifests still export; recollect them to obtain the archive and recommendations.


## One ADLC workflow across worktrees (WORKFLOW-OBS-004)

Use `agentic-os/workflow-group/v1` as the single root for one or more participating worktrees.
Each child is an existing collected archive with `context.workflowId` equal to the group `id` and
its own `context.worktreeId`. Membership is explicit; unrelated `.worktrees` are not swept in.
The group input has the usual owner `source`, plus:

- `planning`: `{repository, revision, path, digest}` binds the owner's committed
  `PRD-TAD-ADR-MVP-GTM.md` text (SHA-256 after trimming terminal whitespace as the native Git reader does).
- `members`: up to 32 `{id, file, digest}` references to existing immutable child manifests.
  Supply absolute file paths; stored references are relative to `.workspace` for portability.
- `releaseTargets`: nonempty member IDs expected to reach production.
- `releaseEvidence`: optional `{memberId, kind, environment, repository, revision, file, digest}`
  references, `kind` deployment/runtime and `environment` production. Original JSON bytes are retained;
  schema and caller-supplied source labels are observations, not authenticated provider verification.
- `previous`: optional `{file, digest}` exact earlier group root. New collection increments `sequence`,
  retains prior roots and members, and never overwrites a latest pointer.

Run the same `workflow collect --input=<group-input>` from the owner repository. The returned root
references each child's phase receipts, span pages and advice transitively; it does not duplicate
those pages. A registered child may reside in another repository under the shared `.workspace`.
Cross-worktree span IDs and links are namespaced. Separate clocks are not merged into a misleading
timeline and overlapping CPU/tokens/cost are not summed. Missing deployment/runtime links remain
visible even when all local lifecycle receipts pass; `authorityVerified` remains false. Coverage is
an inventory of captured evidence, not a declaration of production readiness.

```sh
agentic-os workflow export --input=/returned/group/manifest.json --offset=0 --format=sse
agentic-os /workflow.export '#read-only' @input:/returned/group/manifest.json
agentic-os /workflow.recommend '#read-only' @input:/returned/group/manifest.json
```

MCP export accepts `format: "sse"` or default `"json"`. SSE reuses the existing finite observation
protocol: a native `agent-toolkit-run/v1` JSON snapshot in `data:`, followed by `[DONE]`. HTTP adapters
must keep `Cache-Control: no-store` and `Content-Type: text/event-stream`. One response pins one root
and one page; use `nextCursor` to request the next 32-span page. Collection after a lifecycle change
creates a new immutable root to hand off on the existing stream; there is no automatic reconnect loop.
Recommendations retain member/root digests and are consumed on demand in the next context. Each
member archive remains ≤2048 spans, group roots ≤32 KB, output ≤256 KB; oversized output fails loud.

Release validation fills up to four execution slots within each existing stage, longest observed
checks first. A finished check releases its slot immediately; evaluator/behavior/packaging barriers,
exact-input reuse, source-drift checks, failure stops and the total deadline remain mandatory.
Reused span measurements are historical evidence and are excluded from current consumption.
Compare the same selected check set, environment and quality before claiming savings.

## SSOT manifest location and Apex demo (WORKFLOW-OBS-005)

The immutable entry point is the exact `manifestPath` returned by `workflow collect`:
`.workspace/.artifacts/workflows/<repository-digest>/<manifest-digest>/manifest.json`.
`repository-digest` is the first 24 SHA-256 hex characters of the repository identity;
`manifest-digest` is the full SHA-256 of the stored manifest bytes. Resolve the actual path from
`workflow collect`; never guess either digest or choose an arbitrary newest directory.
`workflow targets` reports the configured storage and registered `.worktrees` target inventory.
The clone-local `agentic-os.workspaceRoot` setting overrides the default workspace root for that
repository; keep the local bridge and collector on the same workspace configuration.

For one E2E START-WORKFLOW → RELEASE-WORKFLOW, use its workflow-group root when it has multiple
members, or its individual workflow root when it has one worktree. Keep child manifests, receipt
JSON, span pages and recommendations at their digest-bound locations. A newer observation creates
a successor root; hand off its new exact locator and retain the previous immutable evidence.
An exported inspection JSON is a portable derived snapshot, not a replacement archive SSOT.

Apex Catalog → Agent observability → Import local file selects this `manifest.json` in the local
Dev runtime. The existing translucent preset panel overlays the full Canvas dashboard. One import
resolves all captured pages through the existing JSON/SSE reader; Span tree includes scoped timing,
D3 Topology and JSON/Markdown/Viewer share selection, and original reused resources stay historical.
The source-owned preset retains `/canvas.view.set #canvas-view @canvas-view option=agent-run:tree`;
MCP uses the same Canvas view owner. Selecting a preset neither reads private evidence nor starts a
model run. Import requires the user's file choice; unresolved references fail the whole import.

PRD: remove ambiguity about which file to choose. TAD/ADR: document the existing content-addressed
owner and reuse the catalog description, with no mutable latest pointer or duplicate registry.
MVP/GTM: demonstrate import → inspect → recorded evaluation → export; WTP and savings stay unproven.
Validation: native document digests/catalog checks and Canvas manifest/browser tests. Rollback the
catalog/guidance update independently; all immutable archives and source receipts remain intact.
