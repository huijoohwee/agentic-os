---
title: "Reference implementation — Durable Agent Workflows"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.2.0"
date: "2026-09-16"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
status: "economics-observability-implementation-approved; prior-migration-in-progress"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
continuity_id: "DURABLE-AGENT-WORKFLOWS-001"
prd_revision: "0.2.0"
tad_revision: "0.2.0"
adr_revision: "0.2.0"
mvp_revision: "0.2.0"
gtm_revision: "0.2.0"
worktree_id: "device-0232231d4a19--agent-economics-plan"
agent_id: "codex-01a0a823"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e9675f27d1eb1e30ae6b8f82669ff7e546d85c65/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
guideline_sha256: "ae7dff38da1f98386f1b45ee54857734cef8f480b453152c30a4330dae2f31c4"
reviewed_source_revision: "3663442db70b0e75c5eba487a86e7b444e9e7029"
verification_scope: "Native economics, tracing, evaluation and Graph mission-control proposal; prior receipts retain their subjects; new runtime and delivery unverified"
---

# Reference implementation — Durable Agent Workflows

`DURABLE-AGENT-WORKFLOWS-001@0.2.0` joins the five roles below. This capability plan extends
[composition DR-8](TECH-STACK.md#dr-8--specify-future-ownership-transfer-without-migrating-repositories)
and [F10](FEATURES.md#f10--native-agent-composition-and-skill-harness) without replacing their historical evidence.
The predecessor `0.1.0` at `3663442db70b0e75c5eba487a86e7b444e9e7029` retains its migration
implementation approval from 2026-09-15. This successor preserves AC-D01–D08 and proposes AC-D09–D14.
The 2026-09-16 explicit IMPLEMENT instruction approves AC-D09–D14 at document SHA-256
`16558c61e4c4b2ecd74ac41c6353a0a870f6c51b5cc6bb025a2b3bafd65f7cd0`. Implementation proceeds through
E1–E3 below; product release retains its candidate-bound gates. The earlier migration grant remains valid.
[Fleet](../FLEET.md) and its policy remain the ownership registry.
The [native feature policy](PRD-TAD-ADR-MVP-GTM.md#native-feature-inspiration-default) governs scope approval.

### Implementation receipts and remaining acceptance

This table separates integrated source, deployed behavior and remaining work. The proposal inspection
below is retained as the historical baseline; its revisions are not current dependency pins.

| Surface | Verified observation | Remaining acceptance |
|---|---|---|
| Shared runtime and invocation | [OS protected source](https://github.com/huijoohwee/agentic-os/tree/57c8c66b58bf46469c23416e10e43aacdfe174fd/runtime/agents) owns durable runs, SQLite, retries, leases and shared operation dispatch. [PR 169](https://github.com/huijoohwee/agentic-os/pull/169) passed 1,411 tests and the required integration gate. | Full source retirement and all public caller paths remain separate. |
| Canvas composition | [Protected Canvas source](https://github.com/huijoohwee/agentic-canvas-os/tree/8460fc01c7dbd8af6880d346a71829e20887c44e) forwards migrated runtime modules to OS and product admission to Commerce. | Remaining application, lifecycle, docs and deployment ownership transfer; zero active legacy consumers. |
| Original runtime coverage | [Test migration manifest](../runtime/agents/MIGRATION-TESTS.json) maps six original Canvas composition and skill suites plus two fixtures to OS. Assertions and property seeds stay intact; test-only dependencies are isolated from the runtime. | [PR 171](https://github.com/huijoohwee/agentic-os/pull/171) passed 1,482 tests; subsequent Canvas test retirement remains. |
| Alignment auditor | [Native migration manifest](../bin/alignment-audit-migration.json) maps the original 33 modules, 42 suites, two test helpers and four config/fixture files to optional OS tool paths. Tests retain assertions, property seeds and 25 independent 100-run properties. | Protected owner checks and Canvas source retirement. |
| Runtime docs and catalog | [Migration manifest](../runtime/agents/MIGRATION-DOCS.json) binds 19 native documents and a separately preserved immutable historical proof. Fleet discovery points presets, skills and the progressive facade to their existing OS owners. | [Graph PR 1018](https://github.com/huijoohwee/agentic-graph/pull/1018) completed source/browser documentation cutover and passed its Integration Gate; Canvas body retirement remains. |
| Commerce public sandbox | [Release 34998738855](https://github.com/huijoohwee/agentic-commerce-os/actions/runs/34998738855) binds source `033bcb56e9d6d3839fef29e65962f34ceccc3c4a`, Worker version `e9fb843e-1aab-4058-bf37-e013e8801c8b`, the public route and 11 browser groups. The device-session model generated a listing; test-mode checkout, reload and download events were observed. | Full retained-job provider rollback proof. Test-mode payment is not buyer, WTP or real-revenue evidence. |
| Graph invocation and routing | [PR 1017](https://github.com/huijoohwee/agentic-graph/pull/1017) integrates lazy durable-run invocation and the GameXR route alias at `3b424d9e80f113dbab93b195798bd9521241aafe`. | Protected Graph production release, public invocation/readback and generated mirror parity. |

The public Commerce execution host is a pinned, device-session local FOSS model reached through the
authenticated relay. Availability depends on that device session; this is not an always-on or elastic
hosted executor. Technical review checkboxes are automated test observations, not an actual buyer review.
Historical provider proof retains its original paid Dev scope and cannot establish current free-core
readiness. WTP, accepted price, customers and real revenue remain unvalidated.

The optional alignment auditor is invoked with `npm run alignment-audit:verify` for its native fixtures,
or `node bin/alignment-audit.mjs <config.json> --mode verify` for explicitly selected sources. Verification
uses an in-memory output sink. `--mode run` writes only under the configured output directory; neither
mode grants deployment, lifecycle or runtime authority. The main OS command loads no auditor modules.

## PRD — reference implementation

**CID / RAO / SVO:** Context: runtime capabilities span product/lifecycle owners. Intent: deliver customer
jobs reliably after interruptions. Directive: consolidate execution, connect resumable commerce fulfillment,
then retire replaced sources after cutover. Role/Subject: maintainer; Action/Verb: consolidate;
Outcome: verified fulfillment loop; Object: native workflow runtime. Fields follow the [CID contract][cid].

### Buyer pain and scope

Target payer hypothesis: a solo service seller preparing a repeatable customer deliverable, such as a
catalog/listing package. Pain hypotheses are lost progress after closing a browser, duplicate fulfillment
after retries, and unclear per-job cost. No interviewed payer, accepted price, or WTP evidence is attached.

Rank by buyer pain and nearest existing implementation:

1. Resumable fulfillment with a visible result and receipt: reuse Commerce drafts/sandbox and Canvas runs.
2. Cost and failure readback: reuse Toolkit metadata and source-owned payment receipt verification.
3. Broader marketplace automation and fleet scaling: follow only after the first loop and measured load.

**Must:** preserved AC-D01–D08 plus proposed AC-D09–D14 below. **Should:** adaptive concurrency after a measured bottleneck, preserving caps.
**Could:** optional managed queue/workflow adapters after parity and verified free eligibility.
**Won't:** new orchestration dependencies, a second ledger/catalog or standalone hosted dashboard, paid inference in the free
core, unrestricted retries, unbounded scaling, or automatic actual payment.

| Criterion / VCC | Observable acceptance | Source owner / design / evidence |
|---|---|---|
| AC-D01 / VCC-D01 | Each migrated capability has one implementation owner; source package imports no consumer. Existing callers pass after pinning; replaced bodies are absent. | OS + migrating Canvas consumers / T01, ADR-D01 / E01, E03 |
| AC-D02 / VCC-D02 | Persist a job before acknowledging it; restart the process/isolate and resume a committed step. Duplicate requests yield one effect/receipt; ambiguous effects reconcile before retry. | OS core and state adapter / T02 / E02 baseline; E03 required |
| AC-D03 / VCC-D03 | Delayed retries survive restart; permanent failures, cancellation, expired authority and exhausted budget stop work. Stale leases cannot commit. | OS scheduler / T02 / E02 baseline; E03 required |
| AC-D04 / VCC-D04 | Queue depth and per-principal concurrency have hard bounds. Two workers never commit the same claim; disconnected devices retain checkpoints; reconnect revalidates the fence. | OS state and executor / T02–T03 / E03 required |
| AC-D05 / VCC-D05 | One redacted run trace reports attempt, state, wait, executor revision and known cost. Unknown cost stays unknown; no credentials, full prompts or private outputs enter telemetry. | OS observability / T04 / E03 required |
| AC-D06 / VCC-D06 | MCP, browser WebMCP and `/`, `@`, `#` reach the same operation and authorization checks; malformed/oversized calls and wrong-principal access fail before work. Metadata discovery loads no executor. | OS invocation + Graph browser / T05 / E03–E04 required |
| AC-D07 / VCC-D07 | Mobile browser starts a draft job, disconnects, resumes it, reviews output, uses an explicitly confirmed sandbox checkout, and reads one fulfillment/payment receipt after replay. | Commerce + Graph + OS / T06 / E04 required |
| AC-D08 / VCC-D08 | Exact source/pin/route/deployment checks pass; namespace/data recovery is rehearsed; removed sources have zero active consumers and a retained recovery revision. | Release owners / T07 / E05 required |

Target: five user actions and ten active minutes to a fixture job and sandbox receipt; unproven. Measure
provider wait separately. Long work consists of checkpointed, bounded attempts. Payment remains product-owned.

### Proposed economics, observability and operator visibility

**DIR-D09 / shared CID:** Context: existing run observations expose estimates and bounded execution,
but inspected sources do not establish project-wide reservations or a joined task-to-plan context.
Intent: a solo seller can choose the next deliverable, understand remaining resources and stop excess work.
Directive: extend existing run admission, context and presentation owners. Role/Subject: runtime maintainer;
Action/Verb: bind; Object: each run to its plan, reserved resources and attributable evidence;
Outcome: AC-D09–D14 below. TAD-D09–D14 and ADR-D03/D04 consume this PRD at `0.2.0`;
MVP/GTM consume the same exact join. Inspection and evaluation answer why a job failed or wasted work.

| Criterion / VCC | Given → when → then | Single implementation owner / check target |
|---|---|---|
| AC-D09 | Given a task, project and goal with exact plan revisions, when admitted or resumed, then validate the five-role CID/revision join and pass only selected bounded context to the executor. Missing/stale/unresolved joins block that run before work; siblings proceed. | OS context/admission; existing swarm, invocation and context suites plus stale-join/replay cases; TAD-D09 |
| AC-D10 | Given two runs sharing one project allocation, when they reserve concurrently, then only work within remaining project, agent and run caps executes. Restart, timeout, cancellation and replay cannot release uncertain spend, double-count usage or reset a period. | OS existing durable store and execution boundaries; independent competing-process/store tests; TAD-D10 |
| AC-D11 | Given authorized run observations, when the operator opens Graph's existing dashboard, then show task→project→goal, agent, state, freshness, limit/reserved/used/remaining and next allowed action. Run list, span tree, timing and topology share one selection and filters; unknown, stale, partial, unavailable and zero remain distinct. | Graph dashboard/model, table and flow owners plus existing run bridge; mobile, keyboard, offline, view-switch and two-session browser cases; TAD-D11 |
| AC-D12 | Given one Commerce deliverable job, when its plan-bound free execution completes and sandbox checkout replays, then the existing fulfillment/payment receipt remains authoritative and the operator sees its run/economics references without another payment effect. | Commerce existing workflow/receipt integration; full applicable sandbox browser loop; TAD-D12 |
| AC-D13 / VCC-D13 | Given nested and concurrent attempts, when trace events repeat, arrive late, truncate or resume after restart, then preserve source/run/task/attempt/span identity, causal links, coverage and exact-once usage attribution. Principal isolation and authoritative reservations survive optional telemetry failure. | OS Toolkit contract/ledger/profiler/store and invocation; replay, fan-out/fan-in, skew, missing-span, pagination and redaction cases; TAD-D13 |
| AC-D14 / VCC-D14 | Given a failed run or span, when an authorized evaluator checks exact evidence and compares a baseline with a candidate, then bind evaluator/dataset/metric/subject revisions, show score or reason for no score, and hold on missing, duplicate or untrusted evidence. Evaluation consumes the same resource limits; results never authorize deployment or payment. | OS Toolkit evaluation/cohort/optimizer owners; changed-profile, partial-sample, duplicate-evidence, lease/replay and evaluation-budget cases; TAD-D14 |

Pain ranking: (1) avoid runaway or repeated execution, (2) recover the reason and result of a blocked job,
(3) locate a slow/failing step and compare verified quality/economics before repeating an offer. Existing durable runs and Toolkit make these closer
to delivery than a new hosted control plane. WTP, savings and actual revenue remain unvalidated.
Must scope includes task/agent/project allocations and their goal/plan reference; calendar-period policies
are explicit bounded windows, never a hidden reset. Should: user-selected priority within existing fairness.
Could: cross-project portfolio allocation, continuous evaluation and richer annotations after measured demand.
Won't: raw prompt/output capture, a prompt registry, a new analytics service, automated budget increases,
paid inference/overages, exchange-rate estimation, billing, wallet/settlement changes or a second scheduler.

## TAD — reference implementation

### Proposal grounding and original gaps

Inspection subjects below are not dependency pins. All eight checkouts matched fetched `origin/main`
with empty visible status. Refresh HEAD and authority before implementation.

| Subject | Exact inspected revision | Relevant native source / disposition |
|---|---|---|
| OS | `c6ab75f579e993ff811d205a9cbab74fb7d5d9cd` | `runtime/{json-contract,reasoning-continuity}.mjs`, `src/{invocation,mcp-server,rank}.mjs`, `catalog/{invocation,fleet-ownership,composition-source-lock}.json`; confirmed reusable seams |
| Canvas | `c6c9b84a67f1b1aadc09adca4c1b2322274a538f` | `agent-api/src/{running-agents,agent-swarm,agent-toolkit,agent-orchestration,agent-runtime-composition}.js`; confirmed existing execution, claims and observer components |
| Commerce | `134c41f0d77af6ffd2fe401520bc3b1438df47e6` | Existing [MVP/GTM owner][commerce-plan] consumes sandbox checkout; actual collection remains separate and unverified here |
| Graph | `13df22bea2e3e7dc5496fa94c028aa7c6e5b4b28` | `package.json` declares `dev:apex` and `dev`; `.github/workflows/release.yml` owns generated publication; execution/deployment not exercised here |
| Website | `e9675f27d1eb1e30ae6b8f82669ff7e546d85c65` | Pinned authoring/CID rules; confirmed owner, no schema relocation |
| Production mirror | `66c09b2adb947c80387fb42546dcf375a6b1cf86` | Generated output; no authored runtime migration target |
| Public-entry reference | `99144fe144889a9d5b5c1cbf92b4e4dd51268782` | Standalone `81rv10` stays a reference; Graph owns Launch Copilot per fleet policy |
| Spatial client | `9497d74626e0ada8f95caf132b8b54ff3b95ce78` | GameXR remains frontend owner; only changed shared imports/routes require migration |

**Confirmed:** a static relative-import closure from the five Canvas runtime entry modules above contains
19 files / 210,722 bytes. It excludes injected provider, HTTP, state, Worker and browser adapters; it is
not a whole-repository migration inventory. The existing swarm defaults are 32 tasks, parallelism 8,
2 attempts, 60-second task timeout and 30-minute run retention. These bounds do not prove durable
multi-day execution or automatic elastic scaling.

**Confirmed:** `durable-object-state-store.js` and `worker/agent-state.js` support atomic claims and
restart recovery. The Worker also imports commerce admission and deployment identity contracts: moving
it wholesale would couple generic scheduling to a product authority. Split that seam before relocation.

**Contradicted:** the currently configured autonomous path is not a free provider-neutral executor:
`autonomous-runtime-config.js` requires explicit spend approval and one named paid inference adapter.
The generic composition accepts an injected `executeAgentStep`, which is the reusable seam.

**Absent in the OS executable catalog:** durable job start/status/cancel/retry commands. `/queue.show`
observes GitHub repository policy; it is not a background-task queue. Existing documentation metadata
and HTTP route declarations do not establish executable MCP/WebMCP parity.

**Unverified:** free-plan eligibility, namespace transfer, long-job recovery, consumer cutover, demand and payment.

### Migration partition and dependency order

This is the approved migration partition, not a competing current owner registry. Each row has
one destination; migration commits update the registry only after the destination source exists.

| Component / current source | Destination and required change | Remove/retain condition |
|---|---|---|
| T01: generic run, orchestration, swarm and Toolkit families under Canvas `agent-api/src/` | OS lazy `runtime/agents/` package subpaths; relocate the 19-file closure, unifying JSON/continuity only where contract parity is proved | Remove migrated Canvas bodies after all callers pin the OS revision; temporary re-export only for an identified compatibility consumer |
| T02: store interfaces and `durable-object-state-store.js`; shared portions of `worker/agent-state.js` | OS runtime state interfaces and optional edge adapter; retain stable records, IDs, claim epochs and idempotency keys | Product admission, principal policy and deployment identity stay in injected adapters; no delete/recreate of namespaces |
| T03: provider, function, sandbox and autonomous runtime adapters | OS optional adapter package paths after contract split; reuse the execution injection for a licensed local FOSS model/Podman runner and deterministic fixtures | Replace mandatory paid-provider composition; keep provider choices lazy and explicit; preserve contract-bound HTTP compatibility |
| T04: `agent-toolkit-observability.js` and profiler | OS observer module; share the current structured metadata events, keeping per-run accounting separate from payment state | Remove duplicate instrumentation only after the same redacted result is observed by consumers |
| T05: invocation dictionaries, catalog and dispatch; Canvas handlers; Graph browser adapters | Existing OS catalog/CLI/MCP plus Graph WebMCP registration; one dispatch function for each operation | No new registry; old route/alias forwards only while a named pinned consumer needs it |
| T06: Canvas `web/`, source-backed agent/skill/preset assets, reusable product docs | Agent control UI, catalogs and runtime docs move into lazy OS application assets; Graph keeps its renderer and resolves OS assets explicitly | Inventory every active docs/raw URL and asset hash; retained historical documents are recovery evidence, not a second editable owner |
| T07: Canvas `wrangler.jsonc`, Worker composition and deployment tests | OS optional deployable entry/config after source and caller parity; update Commerce service binding/pins and Graph release dependency through their owners | Retire old active source/route only after version-bound cutover and recovery proof; no repository/history deletion |
| Remaining Canvas `scripts/`, `adapters/`, `src/`, `evals/`, tests and routing docs | Assign each indexed file to its migrated feature or its existing OS lifecycle owner; use shared website validators by reference | The final indexed-file inventory must have zero unassigned active files; unrelated ignored/user bytes remain preserved |

Build order: OS core → optional adapters/assets → Canvas compatibility → Commerce/Graph pins → publication.
OS imports no consumer code. Source imports and release prerequisites remain acyclic; HTTP request/reply may
be bidirectional. Preserve source history, prove equivalent shared contracts, and avoid sibling scans/fetches.

### Run protocol, recovery and scaling

Persist an accepted operation with principal, exact definition revision, request digest, stable run/step
identity, deadlines and cost budget before returning its handle. Reuse the current store claim/replace
contract. A worker obtains a fenced lease, runs one bounded step, stores its checkpoint, and commits an
effect receipt before advancing. A crash after a remote effect but before commit enters reconciliation;
it must not blindly repeat an external payment or non-idempotent tool call.

Enhance the existing scheduler with persisted eligibility time and typed transient/permanent failure,
bounded exponential retry delay, explicit attempt exhaustion and terminal failure retention. A retry
uses the original effect key; a changed request/definition requires a new reviewed operation. Cancellation
invalidates further commits and preserves the observed effect state. Waiting on user approval persists
state and releases execution capacity; resume authenticates current principal and scope again.

One durable store owns each job. Browser storage holds drafts/read models. Handoff pauses the old writer,
verifies checkpoint digest/epoch, then grants the new writer. Reject unknown schemas and prove recovery readability.

Start with one worker, scaling active workers only within configured per-principal/global caps and measured
queue backlog. Persist backpressure/next-eligible time; do not busy-poll or allocate cloud containers.
Admission rejects known insufficient budget; unknown model cost cannot be represented as zero.
Use deterministic fixtures, then a licensed local model; fixtures do not prove AI quality. Podman is optional.

### Invocation and user journey

Reuse Canvas `/api/agent-swarm/{start,work,settle,status,cancel}` contracts where they fit. Add the missing
run operation adapters to the existing OS catalog and MCP server, validating exact JSON keys and bounds.
Proposed CLI tokens are `/run.start`, `/run.status`, `/run.cancel`, `/run.retry`, with existing `@input:`
and `#read-only`/`#mutating` semantics. These tokens are **not implemented** by this proposal.
Map each token to the same typed operation as MCP and Graph WebMCP; status must be principal-scoped.
Browser execution cannot accept executable source, shell strings or provider credentials from a tool call.

The seller drafts a deliverable → explicitly starts the job → closes/reopens the mobile browser → reviews
the resumed result → confirms sandbox checkout → reads one fulfillment and payment receipt. Reuse the
Commerce product's current draft, payment and receipt owners. Offline drafts queue intent only; reconnection
must authenticate and reconcile before any external effect. Payment timeout is pending/unknown until the
payment owner supplies authoritative readback. Nothing in this plan authorizes real money movement.

### Flow coverage and deployment boundary

The existing [composition guide](TECH-STACK.md) supplies shared topology. The durable flow delta is:

| Flow | Native path and error exit |
|---|---|
| Workflow | Draft → admitted job → bounded steps → review → sandbox checkout → receipt; denied/expired authority stops the affected step |
| Data | Immutable input digest → one durable ledger → checkpoint/effect reference → redacted read model; oversized/untrusted input rejected |
| Harness | Discover → validate → claim → execute → reconcile/commit → observe; stale claim cannot advance or emit accepted output |
| Topology | Mobile Graph/Commerce → OS adapter → local or eligible edge executor → existing state owner; offline preserves draft/checkpoint |
| Recovery | Interrupt → retain original IDs → verify state/effect → reauthorize resume → replay result; schema or owner drift blocks cutover |

Source integration, deployment, namespace transfer and removal have separate receipts. Keep Graph's actual
release sequence: source checks → generated candidate → protected authorization → Cloudflare deployment →
public/browser verification → verified mirror publication. The requested Dev → Prod → Cloudflare shorthand
does not override that controller. `airvio.co`, `/agentic-commerce-os/`, `/agentic-graph`, `/81rv10` and
`/GameXR` are requested acceptance surfaces; deployed availability remains unverified in this plan.
GameXR's configured lowercase `/gamexr/` and shared Pages release ownership require explicit source-side
route reconciliation before asserting the case-sensitive requested path. Never hand-edit the mirror.

Free-tier reference constraints checked 2026-09-15: [Workflows][workflow-price] is available on Free with
bounded CPU/steps/storage; [Queues][queue-price] includes 10,000 operations/day and 24-hour retention;
[Durable Objects][state-price] Free requires SQLite-backed storage. Therefore a queue cannot be the only
long-term job ledger. [Cloudflare Containers][container-price] requires Paid and is excluded. Recheck the
selected account and quotas before deployment; no paid plan/add-on/overage is authorized. Managed products
are optional adapters, not FOSS dependencies or replacements for the portable core.

### Economics and observability source grounding — 2026-09-16

These exact local source observations refresh only the proposed extension. OS was fetched and matched
`origin/main`; other rows are clean local HEAD observations, not fresh remote or deployment receipts.

| Owner / inspected revision | Source and disposition |
|---|---|
| OS `3663442db70b0e75c5eba487a86e7b444e9e7029` | `runtime/agents/{agent-swarm-contract,agent-swarm-ledger,agent-swarm-coordinator,worker}.js`: confirmed task context, fenced claims and bounded wakes. Typed plan ancestry and shared spend reservations absent in the inspected owners. |
| OS same revision | `runtime/agents/{running-agent-contract,agent-toolkit-profiler,agent-toolkit-ledger,sqlite-store,durable-object-store}.js`: confirmed cost aggregation, profiling and persistent claim seams. Post-execution estimates do not prove pre-execution budget enforcement. |
| OS same revision | [Toolkit contract](../runtime/agents/agent-toolkit-contract.js), [ledger](../runtime/agents/agent-toolkit-ledger.js), [profiler](../runtime/agents/agent-toolkit-profiler.js), [observability](../runtime/agents/agent-toolkit-observability.js): nested spans with revision-bound components, run-level usage/evaluation, span percentiles, cohort comparison and optional metadata-only export exist. Per-span usage/evaluation, task/attempt correlation and bounded cross-run browsing are proposed gaps. |
| Graph `ccf87bae948dbd04744561372f83d7e9c6461a4c` | `canvas/src/features/panels/views/DashboardView.tsx` renders `GraphStatsPanel`; confirmed existing shell, proposed mission-control projection absent there. `mcp/os-status-{contract,runtime}.js` owns status views; reuse its partial-failure semantics without relocating its product ownership. |
| Graph same revision | [Dashboard model][graph-dashboard], [DOM table][graph-table] and [flow graph seam][graph-flow] already consume graph data, selection and native styling. `hooks/active-graph-data/activeViewGraph.ts` owns view derivation; `features/graph-stats/hooks/useStatsSelection.ts` owns scoped statistics selection. These are reusable seams, not an implemented trace viewer. Existing editable dashboard rows require a read-only inspection boundary. |
| Commerce `0162872948dbf27d9811daea9e59ffc0b81f9cf3` | `docs/prd-tad-adr-mvp-gtm-handoff.md` retains source-bound sandbox evidence and unvalidated demand; no current live/payment proof inferred. |
| Canvas `99f8bc2aa2831b9c364a3774754bb806f6421ae9` | `agent-api/src/agent-toolkit.js` and orchestration caller seams remain consumer cutover targets under the prior migration; no new economics implementation owner. |
| Website `aa6c35c4345b796efba7e223d7330baaaf25d2c2` | Authoring guideline SHA-256 `ae7dff38da1f98386f1b45ee54857734cef8f480b453152c30a4330dae2f31c4` matches the existing pinned rules; CID/schema ownership stays here. |
| Mirror `b0245722689402e0bc29fdc0b8aca3300e3f6513`; entry reference `99144fe144889a9d5b5c1cbf92b4e4dd51268782`; GameXR `d3e840bfd45ffb269dba330c369aa8ee94587baa` | Explicit fleet mapping confirms their declared projection/reference/spatial roles. No new write owner or route is proposed. |

The supplied images and read-only browser inspection inform interaction needs: nested spans, durations,
causal topology, filtered runs and evaluation visibility. Their example values are not local benchmarks
or buyer evidence. The native design below uses existing owners; no reference code, dependency, branding,
source-specific terminology, layout copy or asset enters this plan or the proposed implementation.

### TAD-D09–D14: native delta and recovery

**TAD-D09 / context.** Enhance swarm request normalization and immutable request digest with a bounded
context reference: task/project/goal identities, owner repository, exact artifact revision/digest, and
one CID plus five companion revisions. Consume shared CID/RAO/SVO meanings; do not define a competing
schema. Resolve only explicitly enrolled, authorized references through existing context readers.
Never crawl siblings, auto-fetch URLs, or import whole plans into every prompt. Reject cycles, excessive
depth, mismatched digests and unauthorized projects before executor dispatch. Revalidate on resume;
offline may inspect cached evidence labelled with its revision, but cannot mint authority or extra quota.

**TAD-D10 / budget.** Extend the existing durable state owner with one project allocation record and
stable reservation identities joined to principal/project/run/task/attempt and policy revision/window.
All devices executing that allocation use the same authoritative store. Local SQLite supports cooperating
processes on one device; disconnected replicas cannot issue competing reservations. Reads remain portable.
One atomic claim/replace reserves all applicable project/agent/run dimensions inside that project record;
no independent per-level read-then-write counters. An idempotent run journal joins the reservation before
dispatch. A crash between these records conservatively retains the reservation; recovery reconciles it.
Reject a retry whose content, principal, policy or period differs from the original reservation.

Reserve a trusted upper bound for input/output tokens, attempts and elapsed time before every model/tool
execution, including planning and synthesis. Adapters must enforce their declared maximum; unsupported or
unbounded adapters are ineligible. Monetary admission for this free core is zero incremental provider spend
under explicit free/local eligibility; unknown machine TCO remains unknown. Paid routes remain blocked.
Store accounting amounts as bounded integers in explicit units, never floating-point spend authorities.
Runtime observations distinguish reserved, observed, estimated, unknown and remaining amounts. Never sum
parent aggregates with their child calls or interpret missing telemetry as zero. Missing or over-bound
usage freezes further work under that allocation until reconciled; do not pretend already-spent usage
was prevented. Budget increases require an explicit current owner decision and policy revision.

Commit usage once using the execution/effect identity. Timeout, uncertain effect and lost response retain
the reservation until an authoritative read establishes usage or quiescent non-execution. Expired leases
alone cannot release it. Duplicate completion/cancel cannot refund twice. Check conservation, restart,
cross-run races, changed-policy replay and isolation between principals with independent invariant tests.
No new database, external billing feed, monthly polling job or payment ledger is introduced.

**TAD-D11 / UI.** Extend Graph's existing dashboard with a lazy Agentic OS view backed by the same
principal-scoped run operations and Toolkit projections. Existing Graph statistics remain addressable.
On mobile show goal/project selector, resource summary, attention queue and selected-run detail vertically;
on wide screens use a list/detail split. Summaries show active, waiting and blocked counts plus known
usage/remaining resources. Run rows show task, agent, state, freshness and the next permitted action.
Detail reveals joined plan/criterion, attempt, component revision, resource breakdown, evaluation and receipt.
One bounded projection supplies the existing dashboard model, table and flow renderer; one selected
`runId/spanId` survives view/filter switches and refresh. Use source-namespaced node IDs, preserve the
active document and restore its selection on exit. Inspection cannot call document edit/drag/save handlers
or overwrite authored graph data. Extend the owning source adapter and selection seam, not a second graph
store, renderer, dashboard app or media-timeline subsystem. Reuse theme, typography and accessible controls.

| Native view | Operator question / behavior |
|---|---|
| Run list and overview | Which job needs attention? Reuse bounded table filtering/sort/columns for project, agent, task, time window, state, cost coverage and evaluation. Show run count, failure rate, known tokens and run p50/p95/p99 with population/sample count, unit, window and coverage; never label span percentiles as run latency. Session grouping is an optional authorized correlation reference, not a new session service. |
| Span tree | Where did this run fail? Expand containment with kind, operation, status, duration, attributable usage and evaluation count; search keeps ancestors visible and discloses hidden matches. Retrieval uses a tool operation/component, retaining native span kinds. Keyboard and text status are required. |
| Timing list | Where was time spent? Show start offset, duration, overlap and wait/retry intervals from recorded clocks. Keep inclusive duration distinct from known exclusive duration; no sum of overlapping children or invented critical path. Unfinished/skewed intervals remain explicit. |
| Execution topology | Which observed steps led here? Feed read-only `GraphData` into the existing flow seam; distinguish containment, dependency and handoff links, planned versus observed nodes, and retry attempts. Show fan-out/fan-in only with evidence, preserve missing endpoints as unresolved, and collapse groups without losing selected-span identity. |
| Evidence detail and comparison | Is the result acceptable? Display exact source/plan/subject links, redacted artifact references, metric definition, evaluator revision, result status and baseline/candidate coverage. Deep links reauthorize on read; expired evidence is labelled rather than silently replaced. |

A blocked row explains the missing context, capacity, budget or authority and exposes only the existing
allowed operation. Priority changes affect pending eligible work, preserve fairness and cannot bypass
resource admission. Live refresh is opt-in, visible-only, ≥5 seconds apart and one in-flight request per
scope; pause on hide/offline, back off errors up to 60 seconds, provide manual refresh and label last-observed data. Do not export prompts,
secrets or private outputs into dashboard telemetry. Cached views allow inspection, not offline execution.
Default mobile view is the text list; load tree, timing and graph detail only on demand. Bound rows/nodes
to the returned page; disclose clipping and provide paging. Existing graph statistics token counts describe
document content and must remain separate from runtime model-token accounting. Abort obsolete requests;
filter changes and principal/session changes invalidate pending responses and scoped caches.
MCP, WebMCP and `/`, `@`, `#` reuse the same invocation/authorization seam; add no parallel command registry.
The grounded browser seam is Graph's `canvas/src/features/agent-ready/durableRunTransport.ts`, consumed
by `durableRunWebMcpTools.ts`; it fixes the same-origin endpoint and accepts no caller credentials/host.
Its current OS operation allowlist is only start/status/cancel/retry. Trace queries and evaluation require
explicit typed extensions to that shared dispatch/response contract and host authorization, with read-only
queries distinguished from idempotent evaluation mutations; they are not existing browser capabilities.

**TAD-D12 / integration.** Commerce supplies its job/receipt reference to the native run context and
consumes the resulting projection; Graph owns presentation, OS owns execution accounting, Commerce/Graph
payment owners retain money movement. Pin only protected owner revisions in consumers. Website, entry
reference, GameXR and generated mirror require no authored feature changes in this increment. Update their
consumers only if a verified contract dependency changes. Preserve the existing release sequence above.

**TAD-D13 / trace evidence.** Extend Toolkit contract/ledger/profiler/store owners and the existing run
invocation seam. Use run identity as the trace identity; join principal, project/task/attempt, span/parent,
component revision, plan CID/revisions and receipt by validated references. Cross-run links require the
same authorization; a grouping ID grants none. Reuse native span kinds, strict field validation, exact
replay identity and terminal-state fences. Reject conflicting repeated IDs, invalid parents and cycles;
late remote observations cannot rewrite authoritative history. Retried attempts have distinct identities.
Record clock origin/sequence and trusted elapsed time; cross-device offsets and exclusive time are unknown
unless comparable. Keep observed failures, cancellation, timeout, unfinished spans and retention expiry distinct.

Usage belongs to the executor effect/attempt once; parent totals are derived views. Legacy run-only usage
stays run-only, never apportioned across spans. Sampling/truncation, dropped-event count and observed versus
expected coverage are explicit. A disabled/failed optional exporter cannot stop the operation; missing usage
still invokes TAD-D10's accounting hold. Sampled traces never become the reservation/settlement ledger.
Reuse defaults: 128 spans/run, 32 retained runs/principal, 64 samples/cohort and existing record/TTL limits;
do not silently widen them. Add authenticated bounded discovery over the existing admission/store owner,
not storage-wide scans: page ≤32 runs, query window ≤retention, opaque principal/filter/revision-bound cursor,
stable snapshot ordering, expired-cursor response and indexed references removed with their records.
List pages contain summaries only; detail is separately paged within the existing 256 KiB response cap.
Show snapshot/page coverage; metrics for a clipped page cannot claim a whole-window population.
Return only validated metadata/digests and authorized artifact references. No raw prompts, outputs, secrets,
PII-bearing labels or arbitrary attributes; private payload reads remain in their existing authorized owner.
Offline caches retain scope/revision/expiry and clear on principal change. Export is opt-in metadata only.

**TAD-D14 / evaluation.** Reuse Toolkit evaluation leases, evidence digests, exact evaluator/dataset/metric
profiles, cohort comparison and optimizer. Add an explicit run-or-span subject with immutable digest and
source/candidate revision; model/prompt/config references are revision-bound inputs, not copied registries.
Prefer existing deterministic local evaluators for contract validity, fulfillment completeness and replay
consistency. Optional local FOSS model evaluation needs an eligible adapter and TAD-D10 reservation; never
call a paid judge. Cache only identical subject/profile/config digests; replay cannot score or charge twice.
Keep pending, reported, invalid, failed, timed-out and unevaluated outcomes distinct, with metric unit/direction
and bounded explanation/evidence references. An annotation or model score is not buyer acceptance.
Compare exact matching profiles and dataset revisions; reject duplicate subject evidence, report excluded
untrusted/failed/missing samples and their denominators, retain raw scores, and apply declared quality/latency/
cost thresholds only to eligible comparable samples. Missing cost/quality or insufficient samples yields
`insufficient-evidence`/hold. Measured score changes are not statistical significance or causal improvement.
Operator-selected bounded evaluation is MVP scope; continuous/background evaluation is deferred. Constraints
→ argumentation → outranking consumes these results as recommendations; it cannot self-promote, mutate
prompts, increase quotas, approve a release, or change the payment receipt.

Recovery: version the changed durable record and retain the previous reader/package/Worker revision.
Additive records must remain readable across the rollback window; block downgrade if that is unproved.
Never delete active reservations, overwrite checkpoints, auto-retry uncertain effects or hand-edit mirrors.
Source integration, consumer adoption, public E2E, rollback and real-money proof remain separate exits.
The inspected core is 28/28 modules and 276,264/300,000 bytes: only 23,736 bytes of net headroom.
Keep these caps and the per-file bound. Refactor existing owners within scope; do not hide extra core
modules in another directory or increase caps to manufacture compliance. Reassess E1 if it cannot fit.

## ADR — reference implementation

**ADR-D01, proposed 2026-09-15:** consolidate the native runtime and its tests into OS behind explicit,
lazy package boundaries. Migrate remaining Canvas application assets/adapters after the core; then retire
replaced sources. Keep commerce rules/payment state, Graph rendering and website schema ownership intact.
This changes physical runtime ownership after approval and parity, rather than merely renaming a service.

**Constraints ↔ Argumentation ↔ Outranking:** reject paid orchestration, duplicate ledgers, copying external
implementations, unbounded work and unsupported production claims. Keeping current separate ownership is
the smallest immediate delta but does not satisfy consolidation. A rewrite/new orchestration service adds
contract and recovery risk. Relocating the tested native modules with dependency-ordered cutover best
meets consolidation and reuse; state/route migration is its principal risk. Select that option provisionally.
Do not invent numerical ROI/WTP scores; `src/rank.mjs` remains the executable ranker for grounded catalog data.

**ADR-D02, proposed:** treat long work as resumable bounded steps and use one existing durable ledger.
Add a managed queue/workflow adapter only if measured load warrants its incremental state and deployment
burden. Free-tier availability alone is not a reason to introduce another service.

Consequences: fewer owners and reusable local execution require explicit adapters and pin updates. Savings
and performance gains are unmeasured. Recover with prior package/Worker revisions and preserved state;
reconcile unknown effects. Preserve live records/namespaces. Remove shims when named consumers reach zero.

**ADR-D03, proposed 2026-09-16:** extend the existing durable workflow and Toolkit owners for economics,
with a lazy projection in Graph's native dashboard. AC-D09–D12 map one-to-one to TAD-D09–D12 above.
Constraints reject paid hosts/inference, duplicate data/control planes and unverifiable spend caps.
Argumentation: a display-only meter is smaller but cannot enforce shared limits; a standalone hosted
console adds deployment and synchronization owners. Atomic reservations plus the existing display shell
best satisfy the solo-operator need and native ownership. Consequences are state migration, conservative
holds when usage is uncertain and explicit consumer pins. Dollar ROI is unmeasured. Recovery follows
the existing retained-state release/rollback path. This decision supersedes only the prior exclusion of
an operator view inside an existing surface; it does not authorize a second dashboard application.

**ADR-D04, proposed 2026-09-16:** extend Toolkit evidence and evaluation for AC-D13/D14; harmonize
Graph's existing dashboard, data table and flow renderer for AC-D11. Constraints require principal isolation,
bounded metadata, free execution, honest coverage and one accounting owner. Argumentation: copied viewers
or a new analytics service duplicate storage/selection/deployment; dashboard-only counters hide causality;
raw payload capture increases private-data exposure. Outranking selects a single native run projection with
lazy views and on-demand evaluation. Consequences: explicit schema/index migration, read-only UI binding,
partial-history states and extra tests within existing caps. Recovery retains prior readers and durable
evidence; renderer rollback cannot erase accounting. Scores remain evidence, never execution authority.

## MVP — reference implementation

The migration loop retains AC-D01–D08; the proposed economics/observability loop requires AC-D09–D14. Increments are checkpoints, not reduced completion scope.
Use one writer per path and one lane per active source repository under the existing claim policy.

| Increment / RAO | Dependency-closed outcome and budget | Exit evidence |
|---|---|---|
| P0 / RAO-D00: planner specifies migration | This proposal, two navigation edits; ≤25 KB added, 0 runtime modules/dependencies, 0 always-load bytes; 30-minute planning cap | Reviewable five-role plan, baseline checks and concrete scope decision |
| P1 / RAO-D01: runtime maintainer extracts core | 60–90 active minutes estimate; ≤24 runtime modules, ≤300 KB source; migrate tested 19-file closure and needed store seam, plus owner tests | OS package/relocation/import tests, Canvas caller parity, no import back-edge; fresh estimate if closure exceeds cap |
| P2 / RAO-D02: runtime maintainer completes durable loop | 90–120 active minutes estimate; ≤12 added/changed modules, ≤150 KB; persisted retry/checkpoint, local executor, existing invocation/browser adapters | Restart/concurrency/replay/error/retention tests and mobile offline demo, AC-D02–D07 |
| P3 / RAO-D03: integrator completes application/caller transfer | Inventory remaining Canvas indexed files first; batches ≤20 modules and ≤300 KB with 60-minute caps; no guessed total migration size | Pinned consumer checks, every active file assigned, exact old-source absence, AC-D01/D08 |
| P4 / RAO-D04: release owner proves delivery | After P1–P3 and valid release inputs; full applicable suite, route/namespace rehearsal, protected deployment and readback | Version-bound public E2E, rollback and removal receipts; no production ETA while external inputs are missing |

Refresh scope/caps on drift. External waits record owner, blocker, condition and recheck; time grants no authority.

### Proposed implementation increments and limits

| Increment / accountable role | Exact delta / prerequisites | Exit and resource cap |
|---|---|---|
| E1 / OS runtime maintainer | TAD-D09/D10/D13/D14 in existing swarm, persistent store, executor, invocation and Toolkit owners. Add context/reservations, trace correlation/attribution/bounded discovery and run/span evaluation; reuse leases, profiler/cohorts and optional exporter. | AC-D09/D10/D13/D14; 150–240 active minutes estimate, ≤14 changed runtime modules, zero net new runtime modules, ≤150 KB touched source, total core ≤300 KB; refresh if exceeded |
| E2 / Graph product maintainer | After E1's protected package and authorized scope, update the existing OS status product plan, dashboard/model, table/flow projection, selection/read-only boundary, run bridge and browser coverage; contract-only Canvas pin/shims only for active callers. | AC-D11; 120–180 active minutes estimate, ≤12 modules/120 KB, at most 3 new UI/adapter modules; 360 px/keyboard/offline/cross-principal and shared-view-selection proof |
| E3 / Commerce integration and release owners | After E1/E2, update the existing Commerce plan and job/receipt context; verify complete draft→run→resume→review→sandbox receipt/readback with the existing release and rollback controllers. | AC-D12 and retained AC-D07/D08; 45–90 active minutes estimate, ≤4 modules/40 KB; public completion waits on exact provider/authority evidence |

These are sequential dependency checkpoints, not permission to stop after partial behavior. Implementation
has the concrete `0.2.0` scope approval above; earlier migration authority is neither revoked nor expanded.
Plan preparation changes one on-demand file; this amendment refreshes the initial 20 KB delta allowance
to ≤35 KB added over `0.1.0`, ≤65 KB total and <600 lines, with zero runtime modules/dependencies/always-load
bytes. Validation target ≤10 active minutes after drafting. Keep changed source files below 600 lines and
every bundle below 500,000 bytes. Expanded implementation estimate is 315–510 active minutes, refreshed after E1;
external provider/approval waits have conditions and rechecks, never a guessed production ETA.

Demo: select one plan-bound seller job, admit two competing attempts against a deliberately small shared
cap, observe exactly one eligible reservation, interrupt/restart, reconcile usage, resume within remaining
capacity, inspect on mobile/offline, then replay the existing sandbox receipt. Include unknown-cost,
wrong-principal, stale-plan, expired-fence, changed-window and uncertain-effect branches. No paid call.
Trace one concurrent fan-out/fan-in fixture with a failed tool and distinct retry; switch tree/timing/graph
without losing selection. Search a nested span, inspect its exact evidence, run a deterministic evaluation,
compare two exact revisions, and hold on insufficient samples. Check truncation, skew, delayed events,
cursor expiry, hidden/offline refresh, logout cache invalidation and unchanged authored graph data.

### Successor validation — local authoring surface

ER-D09: doctor/status passed selected shallow invariants; fetched OS main equals the inspected SHA.
Baseline fleet ownership passed: eight repositories, 17 responsibilities, 550 planning artifacts, zero
findings. Local observations establish no cross-device lease or deployment authority.
ER-D10: candidate fleet ownership passed with eight repositories, 17 responsibilities and zero findings.
Native frontmatter parsing and all five `0.2.0` role joins passed. At document SHA-256
`e29eaea02fe92e709b03fc69369396a65c9ad6212acf93bd409fc36eddb7c27b`, full validation selected 209 suites.
The nine-minute owner runner passed 135 suites/1,004 tests, then interrupted one suite on its total time
budget. Preserve `/tmp/agent-economics-full-receipt-20260916.json`; that command exited 1, not green.
A separate bounded Node batch ran exactly the interrupted/unrun 74 suites: 692/692 tests passed in
169.146 seconds, none skipped/cancelled. Combined coverage: 209 suites, 1,696 passed tests, no assertion
failures. Logs: `/tmp/agent-economics-full-check-20260916.log` and
`/tmp/agent-economics-remaining-check-20260916.log`; these are device-local observations, not CI receipts.
The final documentation-only corrections use `npm run check` and a fresh fleet check; the native result
receipt outside this document binds their exact input digest. No final result is predicted here.
Session input bytes, tool-call totals, model tokens/cost and active operator minutes were not instrumented;
leave them unmeasured. Runtime modules, dependencies and always-load-byte delta are zero.
New economics, tracing/evaluation extensions, dashboard, consumer integration and public E2E are
**unimplemented/unverified** in this proposal. No old result satisfies AC-D09–D14. The amendment requires
a fresh affected-check receipt, fleet check, source-link and five-role join review at its final digest.

Extend existing [swarm recovery](../__tests__/agent-durable-workflow.test.mjs),
[persistent claims](../__tests__/agent-durable-store.test.mjs),
[Toolkit integrity](../__tests__/agent-toolkit-integrity.test.mjs) and
[package limits](../__tests__/agent-package.test.mjs) checks for E1. Graph's existing
`canvas/src/__tests__/durableRunWebMcp.test.ts` is the invocation parity owner; new mobile/dashboard
acceptance extends `dashboardCanvasModel.test.ts`, `dashboardActiveSourceFlowGraph.test.ts` and
`dashboardCanvasInteraction.test.tsx` beside Graph's native browser coverage. Extend OS
`__tests__/agent-toolkit.test.mjs` for attribution, evaluation and profiler population boundaries; independent
assertions cover conservation, isolation, deduplication, exclusions and corruption/recovery. Commerce's
`test/local-first/workflow-drafts.test.mjs` and full `test:browser` own the consumer rehearsal.
These are test extension targets, not proof that the new criteria already pass.

Run owner-selected affected checks while editing. Before release run OS `npm run check:all`, complete
changed-owner suites, Graph mobile/browser and Commerce sandbox E2E, exact package/import/composition
checks and provider required checks. No fleet-wide rerun for unchanged reference/projection repositories;
mirror verification belongs to the protected publisher. Source/full-suite success cannot prove public parity.

### Verification and evidence

| Evidence | Command / result / limitation |
|---|---|
| E01 | OS doctor/status and `fleet:check -- --ownership=<eight explicit roots>` passed at the inspected baseline: 8 repos, 17 responsibilities, 546 artifacts, zero findings. Local scope observation is not cloud-exclusive ownership. |
| E02 | Canvas `node --test __tests__/durable-agent-state.test.mjs __tests__/agent-swarm.test.mjs __tests__/agent-runtime-composition.test.mjs`: 30/30 passed, 0 skipped, 2.315 seconds; local fixtures at the exact Canvas revision above. This is existing behavior, not migration or production evidence. |
| E03 | OS full validation passed at the PR 169 source above: 1,411 tests in 149 suites, including migrated runtime and recovery coverage. Canvas's protected composition checks passed for PR 931. These receipts cover those exact candidates; rerun affected and final applicable checks for remaining migration changes. |
| E04 | Required after caller changes: Commerce `npm run test`, `npm run check`, `npm run test:browser`; Graph owner-selected runtime and browser suites, MCP stdio/WebMCP parity; mobile offline and sandbox receipt replay. Preserve entire applicable suite coverage; a filtered smoke cannot claim E2E parity. |
| E05 | Required at release: affected-owner full validation and builds, exact provider required checks, package pin/composition checks, fresh public route/browser evidence, state migration/recovery and exact cleanup receipts. GameXR tests/build only if its source/imports/routes change; mirror checks run through Graph's controller. |
| E06 | Proposal implementation was approved on 2026-09-15. Link/frontmatter, fleet and source validation remain required for each changed candidate; structural success does not upgrade runtime readiness. |

Use existing affected selection while editing and full applicable owner/E2E checks at release. Bind results
to SHA/tree, dependencies, command, environment and coverage; preserve provider check identities.

## GTM — reference implementation

Reuse [Commerce's first-dollar plan][commerce-plan] and its demand/economics evidence; do not create a
parallel offer, payment ledger or lead list. Initial channel hypothesis: a manually recruited solo seller
with a real recurring fulfillment job. First-dollar hypothesis: a fixed-scope assisted deliverable. Price/payment require prospect evidence and
the payment owner's authorization; this plan authorizes no outreach, invoices or actual payments.

Constraints reject paid acquisition/infrastructure and unverified economics. Argumentation favors one
assisted job because existing drafts, fulfillment and receipts can be observed quickly; a self-service
subscription requires additional unvalidated onboarding/billing. Outranking selects the assisted pilot
for validation, not as a proven high-WTP business. Marketplace expansion waits for repeat usage evidence.

Record demand, offer, transaction, fulfillment, runtime and economics independently. Measure result time,
restart/duplicate failures, queue wait, known tokens/cost, operator time, conversion and repeat use. Sandbox
proves no revenue. Functionality, theme alignment, integration and agent experience remain **unassessed**
until the timed demo/user observation. Feed evidence into the existing immutable workspace Context.

### Economics and observability pilot evidence boundary

For the same solo seller segment, compare one repeated deliverable before/after the proposed loop:
record first-result time, active operator minutes, retries, reservation conservation, known tokens,
estimated versus observed cost, incomplete telemetry and receipt readback. Targets are ≤10 active minutes
to first fixture result and identifying a blocked job/reason within 30 seconds; both remain unmeasured.
Also measure time to locate the failed/slow span, evaluation coverage and false accept/reject counts against
an owner-reviewed fixed fixture set, with unchanged quality thresholds and exact baseline/candidate profiles.
The value hypothesis is fewer repeated jobs and operator debugging minutes; traces or score badges alone
do not prove quality, savings or willingness to pay. A real seller must judge the delivered result.
The price hypothesis remains the existing fixed-scope assisted offer; do not create subscription billing
or fabricate a high-WTP ranking. The first dollar requires a prospect-selected deliverable, agreed price,
authorized real payment and accepted fulfillment recorded by their existing owners. Sandbox evidence
covers only the mechanism. No outreach, invoice or financial transaction is performed by this proposal.

Constraints → argumentation → outranking retains one assisted pilot over a new hosted platform because it
reuses the nearest working loop and can test an actual pain with less setup. Reopen the choice after
measured buyer/retention evidence. Demand, offer, transaction, fulfillment, runtime and economics each
keep separate evidence. Feed the measured outcome into the existing workspace successor Context.

[cid]: https://github.com/huijoohwee/huijoohwee.github.io/blob/e9675f27d1eb1e30ae6b8f82669ff7e546d85c65/guidelines/cid-guidelines.md#shared-field-contract
[graph-dashboard]: https://github.com/huijoohwee/agentic-graph/blob/ccf87bae948dbd04744561372f83d7e9c6461a4c/canvas/src/components/DashboardCanvas/dashboardModel.ts
[graph-table]: https://github.com/huijoohwee/agentic-graph/blob/ccf87bae948dbd04744561372f83d7e9c6461a4c/canvas/src/features/graph-data-table/ui/GraphDataTableDomTableView.tsx
[graph-flow]: https://github.com/huijoohwee/agentic-graph/blob/ccf87bae948dbd04744561372f83d7e9c6461a4c/canvas/src/components/FlowCanvas/useFlowCanvasGraphState.ts
[commerce-plan]: https://github.com/huijoohwee/agentic-commerce-os/blob/134c41f0d77af6ffd2fe401520bc3b1438df47e6/docs/prd-tad-adr-mvp-gtm-20260909T1320Z-solopreneur-mvp-gtm.md
[workflow-price]: https://developers.cloudflare.com/workflows/reference/pricing/
[queue-price]: https://developers.cloudflare.com/queues/platform/pricing/
[state-price]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[container-price]: https://developers.cloudflare.com/containers/platform/pricing/
