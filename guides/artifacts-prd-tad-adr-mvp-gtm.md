---
title: "Versioned Project Workspace"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.3.1"
revision: "0.3.1"
date: "2026-10-03"
lang: "en-US"
frontmatter_contract: "required"
owner: "Versioned workspace product owner"
continuity_id: "VERSIONED-WORKSPACE-001"
prd_revision: "0.3.1"
tad_revision: "0.3.1"
adr_revision: "0.3.1"
mvp_revision: "0.3.1"
gtm_revision: "0.3.1"
local_rung: "dev-proven"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--artifacts-planning"
agent_id: "codex-root"
load_policy: "on-demand"
lifecycle_status: "implementation-in-progress"
guideline_revision: "3.4.0"
source_docs: ["artifacts-reference-implementation.md", "artifacts-implementation-handoff.md"]
---
# Versioned Project Workspace

PRD defines the outcome; TAD consumes PRD; ADR selects the implementation; MVP and GTM project
`VERSIONED-WORKSPACE-001@0.3.1`. This successor responds to explicit authorization to implement a
zero-spend local product. The [source companion](artifacts-reference-implementation.md) binds
actual owners; the [handoff](artifacts-implementation-handoff.md) owns evidence and remaining work.
Source publication, deployment, customer outreach and payment remain separate effects.

## Context and directive

**Context:** the existing MIT artifact owner and hardened Git wrapper are the smallest headless seam. Explicit user instruction separately covers existing private local views; distribution remains undeclared. The managed reference requires paid access and is unavailable. **Intent:** retain, inspect and hand off local files without required remote/model/account spend. **Directive:** extend those owners and synchronize existing file/version/schedule views, then verify bounded journeys. **Role/Action/Outcome:** product owner joins implementation and evidence so exact versions and consistent views are reviewable. This record confers no release authority.

"0" is a grounded technical opportunity with unvalidated customer pain. "1" targets one operator
editing, checkpointing, inspecting and exporting a project within five minutes, with stale-write
rejection and retained drafts. An earlier native-keyboard 360×800 browser journey took 64 seconds; buyer demand and physical-phone reach remain unproved.

## PRD

**Vision:** make a small project a portable, versioned file tree rather than a collection of
unrecoverable edits. A project may contain notes, configuration or code; stored code is inert.
**User/buyer:** solo developer or small-team operator who shares project revisions with agents.
**Beneficiary:** collaborator receiving exact files and version identity. **Operator:** maintainer
responsible for access, quotas, recovery and support. Initial pilot geography: local/remote English
speaking prospects reachable by the operator; jurisdiction and entity remain unspecified.

### Pain, stories and priority

Pain and WTP labels are **unvalidated**. Ordering is a technical reuse hypothesis; buyer
observations will revise it. Covered implementation proceeds without asserting validated demand.

| Pain / feature | Hook → break → fix → close | Reuse / priority |
|---|---|---|
| P1 / F1 | Edit → reload loses work → local draft → recover exact text | Original bounded browser draft UI; Must |
| P2 / F2 | Save milestone → files lack one version → immutable checkpoint → inspect original tree | MIT artifact owner + native Git; Must |
| P3 / F3 | Two local writers share base → stale edit replaces work → expected-base fence → retain loser draft | Native ref CAS + nonwaiting quota admission; Must |
| P4 / F4 | Agent asks for artifact → route claims another store → disclose actual owner → exact receipt | Extend same two tool identities; Must |
| P5 / F5 | Move devices → local state isolated → manual export/import → verify exact portable files | Bounded portable bundle; Must |
| P7 / F6 | Switch file or restore version → views show another file or stale selection → shared document identity and fenced restore → all three views derive selected bytes | Existing private local view owners; Must under explicit user authorization |
| P6 / H1 | Remote collaborators need shared state → concurrent host unavailable → hosted collaboration | Won't this increment; no remote fallback |

As an operator I want F1 to resume without internet; F2 to hand over a specific version; F3 to
avoid silent lost writes; F5 to move files deliberately. As an agent caller I want F4 to discover
which store actually serves a request. **Should:** readable version list with truncation disclosure.
**Could:** search after repeat-use demand. **Won't this increment:** remote concurrent hosting,
automatic two-device synchronization, arbitrary code execution, binary editing, autonomous merge,
public signup, model inference, billing, deployment, credentials or network-enabled Git fallback.

### Verifiable acceptance criteria

VCCs bind the selected local variant. Owner tests passed 44/44 with unchanged source, and actual browser checks satisfy the bounded local
slice on earlier browser bytes. Current lifecycle-corrected owner tests pass 44/44; five real component/store/hook cases prove the existing-view slice. Latest full browser execution and native integration remain unproved.

| ID / feature | Given → when → then / observable end state | Check / constraint |
|---|---|---|
| V1 / F1 | Given an admitted draft, save and reload the local browser; exact text remains or storage failure retains current visible text with an unavailable/read-only warning | Browser reload/storage-failure cases; memory cannot report durable success |
| V2 / F2 | Given two checkpoints, inspect each immutable version; both return original file tree and commit identity | Project runtime checkpoint/immutable-read cases; inspect never changes HEAD |
| V3 / F3 | Given competing requests on one expected head, apply different trees; one advances the head and the loser receives stale/busy with retained draft | Native ref-CAS and two-request race cases; no last-write-wins |
| V4 / F5 | Given an export, import into a distinct admitted local project; paths, UTF-8 bytes and SHA-256 content digests match | Project runtime export/import/traversal cases; actual second-device journey separate |
| V5 / F4 | Given discover/list/inspect and plan/apply, invoke supported surfaces; results identify actual native store, version, limits and unsupported routes | Project contract/HTTP/MCP discovery-route checks; 0 serving tokens |
| V6 / F1–F5 | Given oversized, unsafe-path, denied-origin/token or stale inputs, invoke operation; refuse unauthorized mutation while retaining authored bytes | Quota/security/no-network cases; Git protocols stay disabled |
| V7 / F1–F5 | Given 360px viewport and keyboard navigation, complete edit → checkpoint → inspect → export in ≤5 minutes | Timed local browser pilot; viewport proof is distinct from physical mobile |
| V8 / F3,F5 | Given competing aggregate admission/import, accept only quota-admitted operation; refuse over-capacity without deleting history | Nonwaiting quota-reservation cases; store and drafts each independently bounded |
| V9 / F6 | Given interleaved file versions, select one file; floating/list and bottom graph show only its normalized identity and restore original global indexes | Actual component click and store cases; no unrelated history for an unversioned file |
| V10 / F6 | Given an edit, another file and shared diagram IDs, restore the first file; file bytes, active path and schedule derive that exact snapshot, preserving other files | Actual edit/switch/restore hook case; document edits retain selection, identity changes clear it |
| V11 / F6 | Given a file click awaiting editor/save, restore history before completion; the pending click returns false and never reactivates the old request | Actual selection hook exercises both async boundaries; generation fence also surrounds write-queue settlement |
| V12 / F6 | Given changing video/frame dimensions, recover layout without starving paint; coalesce mutations to one pending frame, stop after 240 frames and cancel on unmount | Real hook/store drift and exhaustion cases; original frozen input remains unavailable |

| Metric | Baseline | Target / observation window |
|---|---|---|
| TTV | Earlier native keyboard local-browser journey: 64s | ≤5 min; observed 360×800 viewport, physical-phone/buyer proof separate |
| Loss/conflict | Project rate unknown | 0 silent lost writes in V1–V4/V8 |
| Serving tokens | No model selected | 0 prompt/completion per product operation |
| Incremental spend | No paid provider selected | $0 new plan, dependency, account, hosting or overage |
| Operator TCO | Hardware/electricity/support unknown | Record active minutes and real costs; no total-zero-TCO claim |
| Readiness | local dev-proven / delivered undocumented | ≥1 satisfying local VCC; full gate/complete conformance/delivery not claimed |
| Commercial result | No buyer/WTP/collection | One fulfilled $1 offer after accepted journey; hypothesis |

Domain object: **versioned project tree**. Core function, usefulness, innovation/theme fit and
agent integration are unassessed; no contiguous rubric level is claimed. Physical-phone reach,
offline cold install and actual second-device transfer remain explicit unverified reach.

## TAD

Selected implementation extends the MIT local host owner. An original dependency-free browser
edits local working dictionaries; HTTP and optional existing SDK stdio use one artifact contract;
native FOSS Git bare objects/refs retain authoritative project versions. Separately, explicitly authorized existing private local views share their current document and snapshot owners. Their snapshots are not native Git project versions; no checkpoint adapter between these stores is claimed.

### Owners and topology

| ID / responsibility (SVO) | Owner / decision | Minimum delta |
|---|---|---|
| C1 Contract owner describes operations | Existing `mcp/workspace-artifact-contract.js`; extend-owner | Project discover/list/inspect/checkpoint/import/export within same plan/apply definitions |
| C2 Artifact owner plans/applies effects | Existing `mcp/workspace-artifact-runtime.js`; extend-owner | Project dispatch and exact plan fencing; retain existing file behavior |
| C3 Version owner retains project trees | New `mcp/workspace-project-runtime.js`; narrow local domain | Native Git bare objects, immutable reads, ref CAS, quota reservation and portable bundles |
| C4 HTTP owner serves isolated local UI | New `mcp/workspace-project-server.js`; retain-local | Node loopback HTTP, same contract, token and Host/Origin/Sec-Fetch admission |
| C5 Browser owner prepares local changes | New `mcp/workspace-project-client.js` + `workspace-project.html`; retain-local | File tree, drafts, checkpoint/history/export/import and simple owned grammar |
| C6 Lifecycle owner evaluates release effects | Existing Graph/OS controllers; reuse | Native lane, exact checks and separate source/deploy/cleanup receipts |
| C7 Existing view owners synchronize selected document | Existing file selection, shared history, version views and diagram hooks; extend-owner | Eight modules; normalized identity, owner-index mapping, snapshot restoration and async selection fences |
| C8 Storyboard owner bounds media layout recovery | Existing runtime scene, split by live geometry, DOM recovery, seed authority and pure placement | Coalesce DOM mutations into the existing frame loop; finite total retry budget, four modules below 600 lines |

DAG: artifact schemas → existing dispatcher/project domain → hardened Git adapter →
HTTP/optional stdio → browser view. No new remote module, shared package, datastore schema,
registry or lifecycle controller. Secrets/filesystem/Git/effect authority remain outside browser.
Exact pins, selected/deferred owners and checks are in the
[reference implementation](artifacts-reference-implementation.md#reference-implementation--codebase-grounding).

### Five flows per journey

| Journey | User flow | Workflow | Data flow | Orchestration/harness | Topology |
|---|---|---|---|---|---|
| F1 | Open → edit → draft save → reload | Validate bytes → local save → status | Working dictionary ↔ localStorage or visible view | No model; failed storage never becomes durable success | Browser-only draft |
| F2 | Prepare → checkpoint → history → inspect | Exact plan/apply → objects → ref CAS → readback | Paths/text → blob/tree/commit → ref | One bounded owner request | Browser/stdio → artifact owner → native Git |
| F3 | Apply → stale/busy → inspect → prepare again | Nonwaiting admission → expected-old ref → reject stale | Base + tree → winner or retained draft | No blind retry/automatic merge | Local requests → one store boundary |
| F4 | Discover → inspect/prepare → explicit apply | Same definitions → supported actual capability | Request → receipt + actual surface | 0 tokens; conformant WebMCP feature detection | HTTP/WebMCP or SDK stdio → same owner |
| F5 | Export → transfer → import → inspect | Verify paths/digests → bounded new checkpoint | Version → UTF-8 bundle → admitted project | Manual transfer; no remote account | Local store → transfer → local store |
| F6 | Select file → edit → restore → inspect all views | Normalize path → filter history → restore source snapshot → rederive schedule | Existing source bytes + runtime snapshot → same document authority | Cancel debounce; generation fences editor/save/queue awaits | Existing selection/history owners → version and schedule views |

### Contract and invariants

- C1 owns exact request/result schema and operation names. HTTP, browser aliases, available WebMCP
  and stdio consume its two tool definitions; no second registry or OS-agent parity claim.
- Checkpoint/import binds identity, exact prepared input, expected current version and explicit
  operator apply. The local session mutation token gates the HTTP effect; possession does not
  waive plan/base/path/quota/origin checks. Readback, not a supplied boolean, proves a checkpoint.
- Resolve head once, then read immutable commit/tree. Keep Git OID format separate from independent
  SHA-256 content digests. Files/code remain inert; safely render text, never execute instructions.
- Write objects before expected-old ref CAS. Nonwaiting aggregate admission reports typed
  `ResourceBusy`/busy while another admitted writer owns reservation; no idle waits or blind retry.
- Reuse existing hardened `mcp/repository-pack-git.js`: disable hooks/config injection and
  `protocol.allow=never`; no shell, fetch/push, credentials, provider env or network fallback.
- Bundle verification rejects traversal/absolute/control/symlink/reserved-Git paths and normalized
  collisions, validates UTF-8 content/file count/byte totals/digests before applying.
- No deletion or garbage collection. Display history truncation cannot remove reachable objects.
  Typed failures distinguish invalid, denied, quota, stale, busy, unavailable, missing and unsupported.

### Data lifecycle and budgets

Browser draft and native checkpoint have separate obligations. localStorage retains admitted working
text when available; failure preserves visible text with explicit unavailable/read-only state. Draft
is never an authoritative checkpoint. Per-writer Web Lock ownership and complete bounded ancestor
recovery preserve losing drafts; failed session recovery fences UI effects. Pagehide fences persistence/effects; pageshow must reclaim writer ownership or rekey before resuming, and epochs reject older responses. Blocked draft export currently requires copying visible text. Lifecycle source review/static checks are current; BFCache browser execution is unproved. Git objects/refs own project truth; export/import joins stores.

Product caps: **100 files/project, 256 KiB/file, 2 MiB/project, 100 displayed history entries,
10 MiB aggregate native store and separately 10 MiB aggregate browser drafts**. Count retained
objects and concurrent reservations, not merely current tree size. No automatic history cleanup.
HTTP has a bounded **3 MiB encoded** request ceiling for the 2 MiB logical project; the transport
writes response chunks at **256 KiB**, below 500,000 bytes. Encoding allowance does not raise logical
file/project quotas; byte limits remain fail-loud. A transfer chunk is distinct from a logical bundle.

Implementation sprint: **30 active min**, **≤100 KiB authored source**, **6 owner modules**
(artifact contract/runtime and project runtime/server/client/HTML), package script configuration,
**2 tests**, **0 paid/new dependencies**, **0 serving tokens**, **0 always-load modules/guidance**.
Shared feature caps: F1 6 min, F2 10 min, F3 5 min, F4 4 min, F5 5 min; ≤3 repair rounds total. Existing-view successor: ≤20 active min, eight changed owner modules, ≤80 KiB code plus tests/registry; started about 02:17:45 UTC. No new dependencies or remote effects.
Media freeze successor: diagnostic start 02:40:25 UTC, 15 min plus 10-min refresh; repair estimate 8 min from about 02:58 UTC, four production modules plus one behavioral fixture, ≤100 KiB, zero paid/new dependencies. Assistant-development tokens unknown/separate. Refresh on drift; external wait names dependency,
unblock condition and recheck event rather than an ETA. Existing Node/Git are prerequisites.

### Quality, support and interoperability

| Attribute | Required scenario / limit |
|---|---|
| Recovery | Restart reads acknowledged version; draft-storage failure visible; no memory durability claim |
| Race safety | Exact base/CAS + aggregate reservation; loser retains authored draft |
| Local access | Bind `127.0.0.1`; validate Host/Origin/Sec-Fetch plus session token; CSP connect self; authenticated export uses SameSite Strict HttpOnly session cookie |
| Privacy | No remote credentials/telemetry/model; inert untrusted text |
| Mobile/accessibility | 360px layout, keyboard focus, readable errors; physical phone reach deferred |
| Offline | Installed local Node/Git/browser work without internet; cold-install/service-worker reach unverified |
| Portability | Manual digest-checked export/import; no automatic shared-host synchronization |
| Performance | Local inspect p95 ≤200ms on named admitted pilot tree; unmeasured |
| Operations | Operator pauses unknown state, observes native version and follows recovery |
| AI | No inference/embedding; future AI separately bounded |

In-scope agent readiness: schema discovery and operation/readback. Existing OS agent status,
registry/gateway federation and full Canvas parity are not part of this six-module slice.

### Invocation Register

This is the one product mapping; concrete operation definitions remain C1-owned.

| Route / identity | Owner / capability | Supported mode / boundary |
|---|---|---|
| `agentic-graph.workspace_artifact.plan` | C1/C2/C3; discover/list/inspect/export or prepare checkpoint/import | Existing MCP identity, actual local native store disclosed |
| `agentic-graph.workspace_artifact.apply` | C1/C2/C3; exact checkpoint/import | Existing MCP identity, exact digest/base-fenced local effect |
| Local HTTP | C4 → C2; same plan/apply definitions | Loopback only; reads 0 tokens, mutations token-gated |
| Browser WebMCP | C5 → C4; same two definitions | Feature-detected conformant `document.modelContext`; explicit unavailable state |
| `/inspect #project @local-git` | C5 → C1; prepare inspect input | Simple owned browser grammar; no OS full-parser parity |
| `/checkpoint #project @local-git` | C5 → C1; prepare checkpoint | Preparation only; exact owner plan then explicit apply |
| `/export #project @local-git` | C5 → C1; prepare export | Local version-specific download; no remote publication |

Unknown/ambiguous grammar, duplicate binding and unavailable surfaces fail explicitly. Optional
SDK stdio uses existing manifest dependencies and loads lazily; standalone server/browser adds none.
No new OS catalog, registry, proxy or skill is added by this local preparation grammar.

### Ecosystem and reuse outcome

| Participant / job | Exchange / payer | Owner / interface | Gap / cost and exit |
|---|---|---|---|
| Solo operator retains project | Recoverable version; payer unvalidated | MIT artifact owner/native Git | Support/hardware cost unknown; verified export exit |
| Agent caller reads/prepares | Exact version/schema, no inference charge | Same two identities, HTTP/available WebMCP | Full agent parity unsupported; no supplier account |
| Recipient imports device transfer | Exact portable files | Bundle/same local owner | Actual second-device evidence pending |
| Maintainer supports runtime | Existing lifecycle/receipts | Graph/OS native controller | Source/delivery effects closed independently |

MIT headless scope is selected; private existing-view owner use is separately authorized locally. Node and native Git
are FOSS prerequisites; installed versions/license records belong to release evidence. Free hosting
is not a FOSS finding. No audience/data action derives authorization from this table.

### Lanes, deployment and rollback

Authoring: OS planning lane plus admitted Graph implementation lane. Mirror/source projection:
closed pending reviewed exact source and native RELEASE receipt. Delivery: closed pending product
controller, exact green candidate and covered authority. Local preview is Development, not public
hosting, source release, remote device access or environment deployment.
Rollback stops affected local writes, retains objects/drafts/export, reverts scoped modules/config
to exact predecessor and inspects retained versions. An abandoned writer reservation after a crash requires manually verified recovery; do not delete
a lock to bypass unknown state. No forced refs, silent data conversion,
provider mutation, published-lane rebase, automatic deletion or cleanup is inferred.

## ADR

### ADR-01: Extend MIT artifact owner with native Git and an isolated browser

**Status:** selected for authorized local implementation. **Date:** 2026-10-03. **Context:** prior
browser candidate had unresolved licensing; MIT host artifact operations and hardened Git cover
the nearest eligible seam. **Decision:** extend same plan/apply owner with one narrow native Git
project runtime and original dependency-free localhost UI. Keep draft local and Git authoritative.
**Alternatives:** full Canvas/IndexedDB has mature UI but unresolved eligibility; new general browser
Git duplicates version owners; host CLI alone misses browser review; managed-only violates $0 plans.
**Consequences:** local browser/offline floor with no paid/new dependency; physical mobile and shared
online hosting deferred. Preserve file operations, tool identities, path/errors and exact digest
behavior. No broader Git/MCP/OS-agent/provider parity follows. **Recovery:** revert scoped code/config,
retain objects/drafts/export. This headless choice remains; existing private local views are separately authorized in ADR-03, without a FOSS distribution claim;
replan after three failed repair rounds.

### ADR-02: Keep hosted provider execution outside active MVP

**Status:** selected. No paid plan/addon/overage; FOSS; inert files; owner reuse; bounded race safety.

| Candidate | Hard-constraint disposition | Selection / next evidence |
|---|---|---|
| MIT artifact + native FOSS Git + original localhost browser | Eligible headless posture; 44/44 current owner cases | Selected bounded implementation; V1–V8 checks before acceptance |
| Existing private local views | Distribution license NONE/private; explicit user authorization | Selected scoped owner fixes only; no copied browser datastore or external distribution |
| Requested managed reference | Paid plan required; hosted FOSS not established | Unavailable; no adapter/env/credential/provisioning/fallback |
| New general browser workspace | Duplicates known owners, adds eligibility/feasibility work | Deferred; no extraction/new registry |

Selection is constraint-first, not a scalar score compensating failed gates. MIT reuse supports
minimal delta; missing checks attack readiness; localhost attacks physical-device/shared-host reach.
Selected scope addresses reach through honest manual export/import and viewport proof, without
asserting physical/mobile/hosted parity. Independent runtime evaluator checks before acceptance.
Hosted work requires a separately admitted successor; it is not a conditional active MVP path.

| 12-month TCO | Selected local variant | Deferred alternatives |
|---|---|---|
| Infra/dependency | $0 incremental authorized; electricity/hardware unknown | Paid managed ineligible; browser-wide license unresolved |
| Serving tokens | 0 calls by design | Future AI separately scoped |
| Labor/support | Unknown; record active/support minutes | Availability/security/license work unknown |
| Exit/lock-in | Native Git + verified export | Account/UI schema obligations |

### ADR-03: Synchronize existing views through their shared document owner

**Status:** selected under explicit existing-view user instruction, 2026-10-03. **Decision:** keep normalized active-file identity, shared runtime snapshots and original history indexes in current owners; named documents use only their own diagram frontmatter, while graph-only mode retains its fallback. Restore source/path together, cancel delayed history, clear restored selections and reset matching transport. Same-document edits retain selection; pending file clicks capture restore generation across editor/save/queue awaits. **Alternatives:** replacement UI or adapter to native project commits adds another owner and unproved semantics. **Consequences:** five real hook/component/store cases pass; private source reuse remains local and author-authorized, with no FOSS or native-Git-backed-view claim. **Recovery:** scoped reversal retaining source bytes/snapshots; release needs exact reviewed green candidate.

## MVP

Slice: F1–F6/V1–V11/C1–C7/ADR-01/02/03 at this revision. Implementation is authorized in Graph native
lane. Local **dev-proven**, delivered **undocumented**: 44/44 source-bound owner tests and observed local
browser journey on earlier bytes, plus five current existing-view behavior cases. Local type/build check passes; selected compatibility is 17/17 after scoped history-guard repair; one excluded broad Gantt guard still fails at unchanged HEAD. Latest full browser execution, native integration and delivery remain unproved.

| Demo beat | Bound | Observable reveal |
|---|---|---|
| Hook/probe | 45s | Actual local store/discovery; V5 |
| Edit/checkpoint | 75s | Draft retained, explicit exact checkpoint; V1/V2 |
| Competing save | 60s | Stale/busy request keeps draft; V3/V8 |
| Portable handoff | 60s | Distinct-project import matches export; V4/V6 |
| Close | 30s | 360px/keyboard result with reach limitations; V7 |

Total planned **270s**; observed native-keyboard 360×800 journey **64s**. Physical-device/customer proof remains unverified.

| Phase / outcome | Pain/reuse / owner | Prerequisite / exit / bounds / recovery |
|---|---|---|
| S0 Select local slice | Pain unvalidated; MIT artifact / product owner | Explicit implement instruction + admitted lane; selection recorded |
| S1 Implement checkpoint | Technical reuse hypothesis; C1–C5 | V1–V6/V8; shared 30-active-min/100-KiB/6-module cap; retain bytes |
| S2 Browser outcome | Same journey / isolated UI owner | V7 viewport/keyboard/timing and exact local readback; phone deferred |
| S2b Existing-view coherence | F6 / existing document owners | V9–V11; eight-module/20-active-min/80-KiB cap; five behavior cases pass, full browser proof remains blocked |
| S3 Release exact slice | Lifecycle owner | Native green checks/review/authority → source receipt; deployment/cleanup separate |
| S4 First fulfilled offer | Product owner after accepted slice | Three permitted walkthroughs/one real fulfilled $1 receipt |
| S5 Revisit reach | Buyer request or incident / product owner | Manual second-device evidence first; remote concurrent hosting Won't this increment |

S1/S2 are covered implementation. Outreach/publication/payment/deployment/cleanup remain separate
effects. Recheck source/license/pin drift, quota/CAS failure or buyer evidence. External waits name
condition/recheck, no invented ETA. Search/binary/coediting/provider events remain deferred.

## GTM

F6 sharpens the same unvalidated buyer proposition: one restored document is consistent across files, version graph and schedule. Demonstrate the existing-view slice only after current browser readback; runtime snapshot and native project versions must be disclosed separately. No new market, distribution license, willingness-to-pay or collected-dollar claim follows.

**Positioning hypothesis:** a recoverable, portable project handoff in one sitting for a solo operator.
Current alternatives: manual folders/export, current workspace plus local Git, existing hosted
repository workflows and doing nothing. No measured differentiation, market share or demand exists.
Why now is a hypothesis: agent workflows need exact file/version handoffs; exact file/version handoffs are useful hypotheses; provider novelty does not establish a free eligible offer.

### First-dollar selection and learn loop

Constraints: zero paid acquisition/tooling; no automated outreach/payment; usable accepted result;
the operator can support fulfillment; actual collected cash required for a first-dollar claim.

| Offer/channel candidate | Gate / pairwise reasoning | Experiment |
|---|---|---|
| Direct operator-assisted setup/export for a reachable prospect, proposed $1 one-off | Conditional pass after accepted MVP; fewer new billing/support components than subscription; willingness to pay unknown | 3 invited walkthroughs after explicit outreach authority; record current workaround and quoted pain |
| Self-serve subscription | fail-current-fulfillment: no accepted runtime or billing/support evidence | Deferred until repeat outcomes and payment-owner integration justify it |
| Sponsored/licensed platform integration | buyer/cycle/contract feasibility unknown; incomparable on revenue magnitude | Deferred; product owner rechecks after a concrete buyer request |

Arguments: assisted setup supports short time-to-value and low implementation delta; manual labor
attacks scalability; subscription does not remove current demand and fulfillment gaps. Independent
review accepts this as a conditional experiment only; no channel or price is demand-validated or mechanism-proven.

Pilot funnel: reachable qualified prospect → permitted walkthrough → checkpoint/export accepted →
explicit price accepted → actual collection → supported fulfillment → repeat use within seven days.
Record counts, price/currency, source quote, timestamps, receipt, support minutes and repeat use.
No synthetic receipt establishes collected revenue. Target 1 paid fulfilled result from 3 qualified
walkthroughs; baseline unknown. Continue only after 2/3 complete the target journey and 1 pays;
pivot after 0/3 value it; stop automatic expansion if support >15 min/result or any lost-write incident.
Zero-spend product does not imply free customer labor or profitable economics.

### Venture, operations and financial discovery record

Two sizing methods remain plans: reachable qualified buyers × annual purchase frequency × tested price; independent public segment count × qualified share × annual spend. Datasets/counts are absent, so TAM/SAM/SOM remain unknown.

Dated 2026-10-03 assumptions: proposed $1 (currency unresolved), 3 walkthroughs, 1 collection, 0 model calls/provider spend, support ≤15 min/result. Contribution = collected price − transaction cost − inference/provider cost − support minutes × hourly cost. Fees, hourly cost, conversion, retention, cash and tax inputs are unknown; recognized revenue/cash require reconciliation.

Downside/base/upside collection counts 0/1/3 imply gross 0/1/3 currency units before unknown fees; this is an incomplete sketch. Linked income/cash-flow/balance statements, sensitivities and runway await sourced inputs. Bootstrap/zero funding ask is proposed; no dilution/instrument decision. IP/customer-data/contracts/jurisdiction remain owner review gaps before real customer processing.

One operator, initial 3-prospect existing-device pilot. Incident response pauses writes, preserves drafts/export/operation identity, inspects actual head and invokes owner recovery; no blind retry/deletion. Hiring/funding follows demonstrated capacity limits. Pitch Deck, Business Plan and Financial Model remain deferred under product owner until sourced economics and accepted demo; recheck before audience use. Reveal V1–V11 with real proof. Cost/checkpoint attribution: [handoff](artifacts-implementation-handoff.md#resource-and-cost-ledger).

## From-0-to-1 coverage record

Every row joins `VERSIONED-WORKSPACE-001@0.3.1`; owner is the product owner unless specified.
Covered means the scoped planning record exists, not that runtime acceptance or market validation passed.

| ID | Disposition / source role | Evidence/gap / next check and owner |
|---|---|---|
| C01 Purpose/customer/pain | deferred / PRD | Unvalidated; owner obtains 3 observations |
| C02 Market/timing | deferred / GTM | Two methods; datasets absent before audience use |
| C03 Offer/alternatives | covered / ADR + GTM | Local choices/$1 hypothesis; recheck buyer response |
| C04 Experience | covered / PRD | V1–V11, current cases/earlier viewport; physical reach unproved |
| C05 Architecture/data | covered / TAD | Headless 44/44; existing-view 5/5; separate version owners |
| C06 Quality/security/AI | covered / TAD | Bounds/no-model; QA negative cases and lifecycle browser gap |
| C07 Decisions | covered / ADR | Three decisions/recovery; exact review still open |
| C08 Validated slice | deferred / MVP | Local dev-proven; full native/delivery unproved |
| C09 Acquisition/retention | deferred / GTM | Funnel only; permitted pilot/repeat-use record needed |
| C10 Operations | covered / GTM + TAD | Support/incident bounds; capacity unmeasured |
| C11 Obligations | deferred / ADR + GTM | MIT/private local scope; distribution/IP/jurisdiction unresolved |
| C12 Financial viability | deferred / GTM | Unknown inputs; linked statements absent |
| C13 Capital/milestones | covered / MVP + GTM | Bootstrap/zero ask; revisit actual capacity |
| C14 ADLC | covered / TAD + handoff | Non-green native/compatibility gates; receipts absent |
| C15 Audience projections | deferred / GTM | Three projections await sourced inputs/accepted demo |
| C16 Learning | deferred / MVP + GTM | Thresholds defined; actual pilot outcomes missing |

Dispositioned **16/16**; covered applicable **8/16**; deferred **8**; not-applicable **0**.
Revisit at discovery, baseline, MVP acceptance and audience handoff. Missing facts stay explicit gaps.
This discovery record is not baseline approval; conformance findings, exact check results and the next
bounded action are in the joined handoff. Update these owner documents before every implementing
turn/session ends, including blocked/failed work; preserve source, release and runtime evidence separately.
