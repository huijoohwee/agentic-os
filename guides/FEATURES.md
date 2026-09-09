---
title: "Reference Implementation — Feature Index"
doc_type: "Feature Index"
version: "1.0.0"
date: "2026-09-09"
lang: "en-US"
frontmatter_contract: "required"
owner: "System architect function"
local_rung: "spec-complete"
delivered_rung: "undocumented"
lane: "authoring"
load_policy: "on-demand"
continuity_id: "TAD-COMPOSE-ARCH-001"
architecture_revision: "1.6.0"
architecture_source_revision: "46c14586282a952d4af76e9f61e3b53f9e32dfab"
guideline_revision: "2.4.0"
guideline_source_revision: "7bb36e9df2dfe14497c789b531bbc674c3d8da91"
worktree_id: "feature-index"
verification_scope: "source-grounded feature index; no runtime or commercial promotion"
---


Current composition identities and accepted product revisions live in
[`catalog/composition-source-lock.json`](../catalog/composition-source-lock.json).
Revision-qualified links and grounding tables below record historical evidence, not current pins.
Use `composition:runtime:check` with exact owner roots and `agentic-os pin --consumer=<root>`
for current observations; refreshing a pin does not refresh historical verification evidence.
# Reference implementation — Feature Index

The composition-level feature list for the seven-repository system: what users can achieve, who owns each capability, what source exists, and what must still be proved. The first target is discovery → explicit confirmation → settlement → receipt/replay → marketplace readback in a mobile browser. Individual product tools and widgets remain in their owners' inventories.

This is a derived navigation and acceptance index, not another feature database or a complete independent PRD. [TECH-STACK.md](./TECH-STACK.md) owns architecture and embedded decisions; [PRD/TAD/ADR Guidelines](../../huijoohwee.github.io/guidelines/prd-tad-adr-guidelines.md), [templates](../../huijoohwee.github.io/guidelines/prd-tad-adr-templates.md) and [CID/RAO/SVO](../../huijoohwee.github.io/guidelines/cid-guidelines.md#shared-field-contract) own authoring. [catalog/features.json](../catalog/features.json) remains the machine-readable commercial-candidate input. No second schema, controller or copied catalog is introduced.

## How to read the index

**Priority**: Must = required for the target technical loop or its safe delivery; Should = a useful follow-on without widening the initial transaction; Could = optional extension. Reuse implemented Must capabilities; priority is not an instruction to rebuild them. Commercial priority is unvalidated for every prospective offer. Load only prerequisites relevant to the selected behavior; this is not an always-on platform checklist.

**Observation**: source observed = implementation and an owner check exist at the cited revision; partial = source exists but the named integration or deployment gap remains; planned = intended behavior without an accepted executable proof here. These are inventory dispositions, not readiness rungs. All delivered feature rungs remain undocumented in this index; the document's spec-complete rung describes the index only. File presence and a named check do not prove that the check has passed.

**Shared trace**: `DIR-DOC-PUBLISH-01` / `TAD-COMPOSE-ARCH-001` → feature `Fnn` → `AC-Fnn` / `VCC-Fnn` → linked source and named TAD/ADR join. Each acceptance sentence is `AC-Fnn`; its linked owner check plus stated constraint is `VCC-Fnn`. `RAO-Fnn` uses the named owner function as Role/Subject, the acceptance transformation as Action/Verb, and the observed result as Outcome/Object. These are reference IDs within the existing CID contract, not a new runtime message format. Planned entries explicitly lack an executable VCC.

Source links and the binding table below are revision-specific. Refresh affected evidence and companion joins when an owner changes. Linked owner checks are verification starting points: VCC closure requires every stated outcome to be observed, and structural checks alone cannot prove behavior or delivery. This documentation change does not execute all product runtimes or renew prior production claims.

## MVP order and decision rationale

| Order | Feature scope | Exit condition |
|---|---|---|
| Reuse the foundation | F07, F10–F18, F20, F25 | Existing owner contracts and checks remain coherent; no new orchestration owner or dependency |
| Close technical gaps | F08, F09, F19 | Free-only execution transport, independent evaluator/lifecycle migration and authenticated release/configuration evidence are complete |
| Prove the composed loop | F01–F05 with the relevant foundation | Exact deployed versions pass discovery, confirmation, settlement readback, replay and marketplace checks; offline drafts never authorize offline money movement |
| Improve or expand on evidence | F06, F21–F24 | A measured bottleneck or validated payer justifies the smallest additional capability |

**Constraints ↔ Argumentation ↔ Outranking**: hard constraints reject paid plans/add-ons/overages, unknown licenses/costs, duplicate state owners and unsupported readiness claims. The near-built native composition is preferred over a new hosted dashboard or proxy because it reuses code and closes an existing loop; its weakness is unfinished runtime proof and unvalidated demand. This is a technical sequencing judgment, not a calculated commercial winner. New evidence reopens the affected comparison; no fabricated scalar score replaces the constraints.

The existing ranker was observed with catalog digest `sha256:17714ee450c8d72ac1ff194392d67e9b5a463f96e9d69571e0ce3f6a6325d985`: `no-admissible-candidate`, `selected: null`. All five existing offers lack named-payer/demand evidence. Its 4/8-hour estimates are catalog inputs, not delivery promises. Demand validation remains separately pending and does not block technical runtime implementation. Use `npm run feature:rank` for the current result; do not make this Markdown an alternative ranking input.

## Buyer and merchant journey — reference implementation

### F01 — Offer discovery

**Must · source observed · owner G.** As a buyer, I want supported offers with provider evidence so I can compare a verifiable result.

**AC-F01 / VCC-F01:** Given a supported structured intent, when discovery runs, then the result names the exact provider evidence; unsupported input fails without synthesizing an offer. Verify with [owner check](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/cloudflare/workers/agentic-graph-mcp/commerce-discovery-provider.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/cloudflare/workers/agentic-graph-mcp/commerce-discovery-provider.ts).

**Dependencies / TAD–ADR join:** F17 and provider authentication; Commerce consumes discovery; effect admission F07 applies to mutations, not public capability reads. DR-4; RAO-RUNTIME-02.

### F02 — Explicit checkout confirmation

**Must · source observed · owner C.** As a buyer, I want the current total and a deliberate confirmation so an agent cannot silently authorize payment.

**AC-F02 / VCC-F02:** Given a prepared checkout, when confirmation is absent or stale, then settlement is withheld; a valid confirmation is bound to the exact checkout and provider request. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/shared/human-confirmation.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/src/edge/checkout-confirmation-handler.ts).

**Dependencies / TAD–ADR join:** F01, F03, F07. DR-2/5; RAO-RUNTIME-03.

### F03 — Settlement and exact replay

**Must · source observed · owner G.** As a buyer, I want one money effect and a stable receipt so retries cannot charge me twice.

**AC-F03 / VCC-F03:** Given an authorized confirmation, when it is replayed, then the same settlement outcome is returned with no second effect; production acceptance additionally requires paid-route and settlement readback evidence. Verify with [owner check](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/cloudflare/workers/agentic-graph-travel-commerce/test/commerce-checkout-provider.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/cloudflare/workers/agentic-graph-travel-commerce/src/commerce-checkout-provider.ts).

**Dependencies / TAD–ADR join:** F07, F09, F19 for delivered proof; existing payment owner and configured payee. DR-2/4/5; VCC-RUNTIME-X402-03.

### F04 — Marketplace state and vendor settlement readback

**Must · source observed · owner G.** As a merchant or buyer, I want listing and settlement state from its authoritative owner so projections cannot invent a sale.

**AC-F04 / VCC-F04:** Given an authenticated marketplace request, when state is read or mutated, then evidence and fences are checked and exact replay preserves the owner outcome; Commerce holds derived projections only. Verify with [owner check](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/cloudflare/workers/agentic-graph-marketplace/test/commerce-provider.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts).

**Dependencies / TAD–ADR join:** F07, F17; joins F03 through the existing marketplace service contract. DR-4/5; RAO-RUNTIME-02.

### F05 — Mobile and offline draft continuity

**Must · source observed · owner C.** As a mobile operator, I want bounded local drafts to survive connection loss so work can resume safely.

**AC-F05 / VCC-F05:** Given an offline client, when changes queue locally and connectivity returns, then bounded drafts reconcile under the current claim and stale fences fail; offline drafts never imply offline settlement authority. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/shared/local-store.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/src/edge/client/local-store.ts).

**Dependencies / TAD–ADR join:** F07; online provider readback for money effects. DR-4; five-flow trace.

### F06 — Offer-change monitoring

**Should · source observed · owner C.** As a buyer, I want changed offers surfaced before confirmation so the agent cannot buy against stale terms.

**AC-F06 / VCC-F06:** Given an active offer watch, when terms change or bounded retries exhaust, then a visible change or failure state is returned and any renewed purchase requires current confirmation. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/workers/offer-watch.property.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/src/core/offer-watch.ts).

**Dependencies / TAD–ADR join:** F01, F02. DR-4; RAO-RUNTIME-03.

## Agent execution and trust — reference implementation

### F07 — Authenticated effect admission

**Must · source observed · owner A.** As an operator, I want each effect admitted against its full intent so a valid-looking partial request cannot grant extra authority.

**AC-F07 / VCC-F07:** Given signed authority and a full mutation intent, when admission validates them, then the permit binds that intent and deployment identity; forgery or stale fences cause no write. Verify with [owner check](https://github.com/huijoohwee/agentic-canvas-os/blob/954de91689abc1ab99a783e54f5ca7ac61387449/__tests__/commerce-admission-provider.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-canvas-os/blob/954de91689abc1ab99a783e54f5ca7ac61387449/agent-api/src/commerce-admission-provider.js).

**Dependencies / TAD–ADR join:** Independently configured credentials, full-intent contract and deployment identity. DR-3/5; RAO-RUNTIME-01.

### F08 — Bounded isolated execution

**Must · partial · owner C.** As an operator, I want untrusted jobs isolated from host files, secrets and network so automation has a finite blast radius.

**AC-F08 / VCC-F08:** Given an immutable approved image and bounded job, when the isolated process runs, then resource limits, cancellation and cleanup are enforced; forbidden host/network access fails. Local execution alone does not satisfy production transport. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/operational/isolated-process.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/scripts/isolated-process.ts).

**Dependencies / TAD–ADR join:** Existing qualified Podman host. Production transport is a separate consumer integration in F19, not a prerequisite for local execution. DR-7/11; technology-stack hosting decision.

### F09 — Independent runtime evidence

**Must · partial · owner C.** As a reviewer, I want independently issued checks so an implementation cannot certify itself as production ready.

**AC-F09 / VCC-F09:** Given an external trust anchor, executor and exact source baseline, when evidence is evaluated, then candidate-controlled or incomplete context fails closed and a valid verdict binds the actual execution. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/shared/evidence-runtime-context.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/scripts/evidence-runtime-context.ts).

**Dependencies / TAD–ADR join:** F08; evaluator enrollment and lifecycle-owner migration remain unproved. DR-6; VCC-RUNTIME-AUTHORITY-02.

### F10 — Native agent composition and skill harness

**Must · source observed · owner A.** As an operator, I want reusable bounded agent capabilities so products compose an existing execution facade instead of adding another orchestration framework.

**AC-F10 / VCC-F10:** Given a registered capability and valid bounded input, when the facade dispatches it, then the owning executor supplies structured output or failure while retaining state and safety boundaries. Verify with [owner check](https://github.com/huijoohwee/agentic-canvas-os/blob/954de91689abc1ab99a783e54f5ca7ac61387449/__tests__/agent-runtime-composition.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-canvas-os/blob/954de91689abc1ab99a783e54f5ca7ac61387449/agent-api/src/agent-runtime-composition.js).

**Dependencies / TAD–ADR join:** F14, selected provider and applicable native-skill-harness checks; F07 applies when invoking Commerce effects. DR-7/8; Division of Work.

### F11 — Commerce MCP and WebMCP interaction

**Must · source observed · owner C.** As an agent or browser user, I want one governed capability surface so discovery and authorized actions preserve the same contracts.

**AC-F11 / VCC-F11:** Given a supported invocation, when an agent uses MCP or a page-native tool, then routing preserves authorization and bounded output; backend tools cannot bypass human checkout confirmation. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/browser/webmcp.spec.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/src/edge/mcp.ts).

**Dependencies / TAD–ADR join:** F14 for shared resolution; F02/F07 apply to checkout and admitted mutations, while read-only discovery stays independent. DR-5/7; integration contracts.

## Development lifecycle — reference implementation

### F12 — Scoped concurrent development lanes

**Must · source observed · owner O.** As a solo maintainer using multiple devices or agents, I want disjoint write scopes so concurrent work does not overwrite another writer.

**AC-F12 / VCC-F12:** Given the canonical repository and reserved paths, when a lane starts, then it binds a separate branch/worktree and overlaps fail before authoring; user bytes stay intact. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/lane-cache-publication-race.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/src/worktree.mjs).

**Dependencies / TAD–ADR join:** Committed repository profile and identity trust. DR-7/10; repository-local lifecycle boundary.

### F13 — Exact integration classification

**Must · source observed · owner O.** As a maintainer, I want content evidence for branch state so a stale-looking branch is not mistaken for disposable work.

**AC-F13 / VCC-F13:** Given exact fetched revisions, when integration is classified, then ancestry or exact content proof determines the result; a projection grants no merge, retirement or cleanup authority. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/integration-cleanup-proof.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/src/patch-identity.mjs).

**Dependencies / TAD–ADR join:** F12; exact provider state. RAO-RUNTIME-05/06; cross-repository acceptance contract.

### F14 — Shared invocation grammar

**Must · source observed · owner O.** As an agent user, I want consistent slash, tag and binding resolution so each product consumes one dictionary owner.

**AC-F14 / VCC-F14:** Given a supported /, # or @ token and pinned catalog, when deterministic resolution runs, then it returns the declared binding or a bounded error without a model call. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/invocation-core.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/src/invocation.mjs).

**Dependencies / TAD–ADR join:** Pinned package and catalog; repository-specific collaboration grammar stays with its owner. DR-7/8; Division of Work.

### F15 — MCP-native harness access

**Must · source observed · owner O.** As a coding agent, I want native harness tools so I can inspect and operate the admitted lifecycle without shell-text inference.

**AC-F15 / VCC-F15:** Given a valid stdio MCP request, when a tool is invoked, then bounded protocol handling preserves the same repository guards and authority checks as the CLI. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/mcp-server.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/src/mcp-server.mjs).

**Dependencies / TAD–ADR join:** F12, F13; this repository does not supply an in-page browser surface. DR-7; existing catalog candidate mcp-server.

### F16 — Evidence-grounded opportunity ranking

**Must · source observed · owner O.** As a founder, I want constraints and arguments to expose weak offers so implementation convenience is not mistaken for willingness to pay.

**AC-F16 / VCC-F16:** Given catalog candidates and evidence, when ranking runs, then hard constraints exclude inadmissible choices, pairwise comparisons preserve the frontier, and grounded arguments resolve or retain uncertainty; missing demand cannot produce a selected payer. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/rank.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/src/rank.mjs).

**Dependencies / TAD–ADR join:** Existing catalog/features.json; independent demand evidence for commercial selection. DR-10/11; Constraints ↔ Argumentation ↔ Outranking.

### F17 — Static composition evidence

**Must · source observed · owner O.** As an integrator, I want exact interface and fixture observations so cross-repository drift is visible before runtime effects.

**AC-F17 / VCC-F17:** Given four exact owner roots, when the composition observer runs, then every contributing source read binds HEAD and canonical fixture bytes; it never executes sibling code or promotes source evidence into production proof. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/composition-runtime-check.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/bin/composition-runtime-check.mjs).

**Dependencies / TAD–ADR join:** Exact source lock and provider/consumer artifacts. VCC-RUNTIME-OWNERSHIP-01; RAO-RUNTIME-04.

### F18 — Resource and loading budgets

**Must · source observed · owner O.** As a maintainer, I want bounded modules, documents and work so context growth and repeated checks cannot become an unbounded tax.

**AC-F18 / VCC-F18:** Given authored files and declared runtime limits, when owner evaluators run, then budget violations fail and on-demand guides stay outside the always-loaded set; measured cost is distinct from estimates. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/runtime-budgets.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/bin/agentic-os-doc-budget.mjs).

**Dependencies / TAD–ADR join:** Existing package scripts and owner-specific execution budgets. DR-7/11; quality attributes.

## Production and shared assets — reference implementation

### F19 — Free-only production activation and recovery

**Must · partial · owner C.** As an operator, I want an authorized reproducible release within free quotas so deploying does not introduce paid subscriptions or unverifiable state.

**AC-F19 / VCC-F19:** Given an eligible Free/FOSS runtime and exact authorized versions, when the owner activates a release, then bindings, storage transitions, public routes and recovery receipts match; a paid Containers configuration cannot pass this target. Verify with [owner check](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/test/domain/production-release-safety.test.ts); grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/scripts/production-release/production-controller.ts).

**Dependencies / TAD–ADR join:** F07–F09, F17; migrate legacy lifecycle and sandbox transport; prove current configuration. DR-6/11; RAO-RUNTIME-07/08.

### F20 — Traceable shared specifications

**Must · source observed · owner D.** As a writer or reviewer, I want one shared CID/RAO/SVO and source map so product intent, design and decisions can be traced without duplicate semantics.

**AC-F20 / VCC-F20:** Given the joined feature, architecture and decision revisions, when guideline and grounding checks run, then each criterion names an owner, source and verification condition and any recorded artifact hash matches its stated revision. Verify with [owner check](https://github.com/huijoohwee/huijoohwee.github.io/blob/7bb36e9df2dfe14497c789b531bbc674c3d8da91/scripts/check-prd-tad-adr-guideline.mjs); grounding: [source](https://github.com/huijoohwee/huijoohwee.github.io/blob/7bb36e9df2dfe14497c789b531bbc674c3d8da91/guidelines/prd-tad-adr-guidelines.md).

**Dependencies / TAD–ADR join:** F17; shared schema stays website-owned, stack ownership stays OS-owned. AC-TOPOLOGY-01; DR-10/11.

### F21 — Verified generated publication

**Should · source observed · owner G.** As an operator, I want publication derived from the product owner so a mirror cannot silently become a second application source.

**AC-F21 / VCC-F21:** Given an exact authorized product candidate, when the release controller publishes and verifies it, then the generated mirror follows the owner sequence and preserves other products; a protected source merge alone proves no deployment. Verify with [owner check](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/.github/workflows/release.yml); grounding: [source](https://github.com/huijoohwee/agentic-graph/blob/4e9056ce12fc68a19ddec1381f2aee8b76de36ae/scripts/sync-pages-agentic-graph.mjs).

**Dependencies / TAD–ADR join:** Generated projection P; product release authority; unresolved shared-project ownership excludes conflicting publication. DR-6/10; workspace deployment strategy.

## Optional extensions — reference implementation

### F22 — Spatial browser and native client

**Could · source observed · owner X.** As a spatial-app user, I want the existing browser/native client so spatial interaction can reuse the shared product foundation when demand justifies it.

**AC-F22 / VCC-F22:** Given a supported device, when the source-owned client starts, then its spatial input and runtime satisfy the product checks; a native build or local browser smoke alone proves no shared-site deployment. Verify with [owner check](https://github.com/huijoohwee/GameXR/blob/7609bebd4b72efa2038b9f222e22ca56d13370ed/tests/flight-simulation.test.ts); grounding: [source](https://github.com/huijoohwee/GameXR/blob/7609bebd4b72efa2038b9f222e22ca56d13370ed/src/runtime/GameRuntime.ts).

**Dependencies / TAD–ADR join:** Packaged Graph spatial/shared assets; independent release and routing decision. DR-10; GameXR deployment boundary.

### F23 — Per-agent portable memory tier

**Could · planned · owner O.** As an operator, I want independently recoverable agent memory so identity and state can survive an authorized host change.

**AC-F23 / VCC-F23:** Given a future approved design, when memory is exported and rehydrated, then identity, authorization, idempotency, storage transfer and recovery are proved without adding a second product-state owner. Verify with executable owner check not yet specified; source link is design context only; grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/guides/TECH-STACK.md).

**Dependencies / TAD–ADR join:** New owner design and executable VCC before implementation; no deployed OS memory tier is claimed. DR-8.

### F24 — Merchant and shopping roles

**Could · planned · owner C.** As a prospective merchant, I want a role that solves a validated commercial problem so agent features correspond to a priced useful outcome.

**AC-F24 / VCC-F24:** Given evidenced buyer pain and a priced offer, when a role is selected, then its smallest owner-backed capability has explicit acceptance and commercial evidence; merchant writes remain staged and checkout stays with its current owner. Verify with executable owner check not yet specified; source link is design context only; grounding: [source](https://github.com/huijoohwee/agentic-commerce-os/blob/4774a4fc1543c4bcb1b912fe79c78c61384efc7c/docs/runtime-api.md).

**Dependencies / TAD–ADR join:** Demand validation pending; reuse F01–F04/F10/F11; does not block F08/F09/F19. DR-9.

## Completion — reference implementation

### F25 — Preserved completion and canonical synchronization

**Must · source observed · owner O.** As a maintainer, I want completed work closed without losing authored bytes so the canonical checkout remains a trustworthy next starting point.

**AC-F25 / VCC-F25:** Given exact integration and authorized cleanup, when completion and synchronization run, then only the eligible clean target is removed or retired and canonical advances safely; dirty user bytes, branches and unrelated worktrees are preserved. Verify with [owner check](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/__tests__/canonical-sync.test.mjs); grounding: [source](https://github.com/huijoohwee/agentic-os/blob/46c14586282a952d4af76e9f61e3b53f9e32dfab/src/canonical-sync.mjs).

**Dependencies / TAD–ADR join:** F12, F13; separate receipts and explicit authority for each effect. RAO-RUNTIME-10; lifecycle completion contract.

## Success metrics and economics

| Metric | Baseline | Target / evidence | When |
|---|---|---|---|
| Buyer TTV | Unmeasured | ≤5 actions and ≤10 minutes to one supported receipt; timed mobile smoke | First complete deployed loop |
| Retry safety | Source contracts exist; no current paid receipt joined here | One money effect and identical replay receipt; F03 owner and paid-route evidence | Before accepting delivered behavior |
| Deterministic route cost | Declared target, not a measured monthly total | Zero model calls on discovery/readiness/receipt reads; owner telemetry and tests | Each affected release |
| Infrastructure spend | Actual total unmeasured | Zero incremental spend; enforce eligible Free quotas; no paid plans/add-ons/overages | Before adoption and deployment |
| Model usage | Unmeasured | Declare per-task token, iteration, time and spend limits; collect actual cost logs | Before each model-backed task |
| Operator TTV | Unmeasured | ≤3 steps/5 minutes to invocation; ≤6 steps/30 minutes to target onboarding; timed receipts | First supported walkthrough |
| Commercial return | No selected payer, price, reach or verified demand | Record willingness to pay and collected revenue independently of mechanism proof | Separate demand workstream |
| ROI per feature | Unknown impact, reach, build hours and operating totals | Remains unscored until sourced inputs support the guideline formula; technical order is provisional | Before commercial selection |
| Documentation cost | One bounded index; compliance token cost unmeasured | <300 lines, <500 kB, zero runtime dependencies; README navigation only; zero bytes added to the enforced always-load set | This authoring increment |

Paid services, a new monolithic gateway, a second payment ledger, copied dictionaries, unbounded autonomous purchases and an OS-hosted dashboard are **Won't** for this increment. Free hosted services are not FOSS software; verify both software licensing and host eligibility at adoption. The stricter Free-only user/runtime policy overrides any generic paid-option exception in the authoring guidelines.

## Source bindings — reference implementation

| Code | Repository / responsibility | Inspected revision |
|---|---|---|
| O | `agentic-os` — lifecycle, invocation and evidence tooling | [`46c145862`](https://github.com/huijoohwee/agentic-os/tree/46c14586282a952d4af76e9f61e3b53f9e32dfab) |
| C | `agentic-commerce-os` — commerce control plane and release | [`4774a4fc1`](https://github.com/huijoohwee/agentic-commerce-os/tree/4774a4fc1543c4bcb1b912fe79c78c61384efc7c) |
| A | `agentic-canvas-os` — agent and admission facade | [`954de9168`](https://github.com/huijoohwee/agentic-canvas-os/tree/954de91689abc1ab99a783e54f5ca7ac61387449) |
| G | `agentic-graph` — domain, payment and product publication | [`4e9056ce1`](https://github.com/huijoohwee/agentic-graph/tree/4e9056ce12fc68a19ddec1381f2aee8b76de36ae) |
| D | `huijoohwee.github.io` — shared authoring and schema contracts | [`7bb36e9df`](https://github.com/huijoohwee/huijoohwee.github.io/tree/7bb36e9df2dfe14497c789b531bbc674c3d8da91) |
| P | `huijoohwee` — generated publication projection | [`b7b6c39ce`](https://github.com/huijoohwee/huijoohwee/tree/b7b6c39ce0b5844a43042026a910f7552477c8ff) |
| X | `GameXR` — spatial product runtime | [`7609bebd4`](https://github.com/huijoohwee/GameXR/tree/7609bebd4b72efa2038b9f222e22ca56d13370ed) |

Architecture joins resolve to the [Division of Work](./TECH-STACK.md#division-of-work), [five-flow trace](./TECH-STACK.md#five-flow-trace), [integration contracts](./TECH-STACK.md#integration-contracts-and-interface-invariants), [embedded decisions](./TECH-STACK.md#embedded-decision-records) and [runtime acceptance](./TECH-STACK.md#cross-repository-acceptance-contract). This index does not duplicate topology diagrams, deployment registers or their historical evidence.

## Maintenance and verification

`RAO-FEATURES-01`: Writer indexes independently observable outcomes from exact source and existing criteria. `RAO-FEATURES-02`: Validator checks unique IDs, one owner per outcome, source/check links, priority/dependency coherence, frontmatter, line/byte limits and the OS native suite. `RAO-FEATURES-03`: Publisher integrates the exact green documentation candidate under existing authority; deployment and commercial acceptance are separate.

`VCC-FEATURES-01`: all 25 entries resolve to a source owner and TAD/ADR or acceptance join; implemented/partial entries name an existing owner check; planned entries expose the missing executable proof. Run `npm run check` from OS and verify the cited Git blobs and local companion anchors. A successful documentation check proves index integrity, not any feature's deployed behavior.

**Open questions**: independently managed evaluator enrollment; the eligible always-on execution host and authenticated transport; actual release configuration and paid-loop receipts; Graph/GameXR shared-project routing ownership; payer, priced offer and measured WTP. Route each question to its named owner, and continue unrelated authorized work. Expand an entry into its owner's full PRD/TAD/ADR before changing behavior; do not infer product scope or release authority from this list.
