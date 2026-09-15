---
title: "Reference implementation — Durable Agent Workflows"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.1.0"
date: "2026-09-15"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
status: "implementation-in-progress"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
continuity_id: "DURABLE-AGENT-WORKFLOWS-001"
prd_revision: "0.1.0"
tad_revision: "0.1.0"
adr_revision: "0.1.0"
mvp_revision: "0.1.0"
gtm_revision: "0.1.0"
worktree_id: "device-0232231d4a19--durable-workflow-plan"
agent_id: "codex-01a0a3a3"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e9675f27d1eb1e30ae6b8f82669ff7e546d85c65/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
guideline_sha256: "ae7dff38da1f98386f1b45ee54857734cef8f480b453152c30a4330dae2f31c4"
reviewed_source_revision: "c6ab75f579e993ff811d205a9cbab74fb7d5d9cd"
verification_scope: "Integrated runtime and sandbox release receipts; full application migration and Graph production pending"
---

# Reference implementation — Durable Agent Workflows

`DURABLE-AGENT-WORKFLOWS-001@0.1.0` joins the five roles below. This capability plan extends
[composition DR-8](TECH-STACK.md#dr-8--specify-future-ownership-transfer-without-migrating-repositories)
and [F10](FEATURES.md#f10--native-agent-composition-and-skill-harness) without replacing their historical evidence.
The original proposal introduced the migration scope; implementation was explicitly approved on 2026-09-15.
[Fleet](../FLEET.md) and its policy remain the ownership registry.
The [native feature policy](PRD-TAD-ADR-MVP-GTM.md#native-feature-inspiration-default) governs scope approval.

### Implementation receipts and remaining acceptance

This table separates integrated source, deployed behavior and remaining work. The proposal inspection
below is retained as the historical baseline; its revisions are not current dependency pins.

| Surface | Verified observation | Remaining acceptance |
|---|---|---|
| Shared runtime and invocation | [OS protected source](https://github.com/huijoohwee/agentic-os/tree/57c8c66b58bf46469c23416e10e43aacdfe174fd/runtime/agents) owns durable runs, SQLite, retries, leases and shared operation dispatch. [PR 169](https://github.com/huijoohwee/agentic-os/pull/169) passed 1,411 tests and the required integration gate. | Full source retirement and all public caller paths remain separate. |
| Canvas composition | [Protected Canvas source](https://github.com/huijoohwee/agentic-canvas-os/tree/8460fc01c7dbd8af6880d346a71829e20887c44e) forwards migrated runtime modules to OS and product admission to Commerce. | Remaining application, lifecycle, docs and deployment ownership transfer; zero active legacy consumers. |
| Runtime docs and catalog | [Migration manifest](../runtime/agents/MIGRATION-DOCS.json) binds 19 native documents and a separately preserved immutable historical proof. Fleet discovery points presets, skills and the progressive facade to their existing OS owners. | Graph source and browser documentation cutover; remove replaced Canvas bodies after consumer checks. |
| Commerce public sandbox | [Release 34996283147](https://github.com/huijoohwee/agentic-commerce-os/actions/runs/34996283147) binds source `393d680c7f68f0b9eb33458bca8359c15908f871`, Worker version `5d3520e0-a009-4f5a-ad89-694cfd248fdd`, the public route and browser checks. | A matching receipt for the actual model-generated listing and full retained-job rollback proof. Sandbox fixtures alone do not satisfy these. |
| Graph invocation and routing | [PR 1017](https://github.com/huijoohwee/agentic-graph/pull/1017) integrates lazy durable-run invocation and the GameXR route alias at `3b424d9e80f113dbab93b195798bd9521241aafe`. | Protected Graph production release, public invocation/readback and generated mirror parity. |

The public Commerce execution host is a pinned, device-session local FOSS model reached through the
authenticated relay. Availability depends on that device session; this is not an always-on or elastic
hosted executor. Technical review checkboxes are automated test observations, not an actual buyer review.
Historical provider proof retains its original paid Dev scope and cannot establish current free-core
readiness. WTP, accepted price, customers and real revenue remain unvalidated.

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

**Must:** AC-D01–D08 below. **Should:** adaptive concurrency after a measured bottleneck, preserving caps.
**Could:** optional managed queue/workflow adapters after parity and verified free eligibility.
**Won't:** new orchestration dependencies, a second ledger/catalog/dashboard, paid inference in the free
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

## MVP — reference implementation

The production loop requires all AC-D01–D08. Increments are checkpoints, not reduced completion scope.
Use one writer per path and one lane per active source repository under the existing claim policy.

| Increment / RAO | Dependency-closed outcome and budget | Exit evidence |
|---|---|---|
| P0 / RAO-D00: planner specifies migration | This proposal, two navigation edits; ≤25 KB added, 0 runtime modules/dependencies, 0 always-load bytes; 30-minute planning cap | Reviewable five-role plan, baseline checks and concrete scope decision |
| P1 / RAO-D01: runtime maintainer extracts core | 60–90 active minutes estimate; ≤24 runtime modules, ≤300 KB source; migrate tested 19-file closure and needed store seam, plus owner tests | OS package/relocation/import tests, Canvas caller parity, no import back-edge; fresh estimate if closure exceeds cap |
| P2 / RAO-D02: runtime maintainer completes durable loop | 90–120 active minutes estimate; ≤12 added/changed modules, ≤150 KB; persisted retry/checkpoint, local executor, existing invocation/browser adapters | Restart/concurrency/replay/error/retention tests and mobile offline demo, AC-D02–D07 |
| P3 / RAO-D03: integrator completes application/caller transfer | Inventory remaining Canvas indexed files first; batches ≤20 modules and ≤300 KB with 60-minute caps; no guessed total migration size | Pinned consumer checks, every active file assigned, exact old-source absence, AC-D01/D08 |
| P4 / RAO-D04: release owner proves delivery | After P1–P3 and valid release inputs; full applicable suite, route/namespace rehearsal, protected deployment and readback | Version-bound public E2E, rollback and removal receipts; no production ETA while external inputs are missing |

Refresh scope/caps on drift. External waits record owner, blocker, condition and recheck; time grants no authority.

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

[cid]: https://github.com/huijoohwee/huijoohwee.github.io/blob/e9675f27d1eb1e30ae6b8f82669ff7e546d85c65/guidelines/cid-guidelines.md#shared-field-contract
[commerce-plan]: https://github.com/huijoohwee/agentic-commerce-os/blob/134c41f0d77af6ffd2fe401520bc3b1438df47e6/docs/prd-tad-adr-mvp-gtm-20260909T1320Z-solopreneur-mvp-gtm.md
[workflow-price]: https://developers.cloudflare.com/workflows/reference/pricing/
[queue-price]: https://developers.cloudflare.com/queues/platform/pricing/
[state-price]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[container-price]: https://developers.cloudflare.com/containers/platform/pricing/
