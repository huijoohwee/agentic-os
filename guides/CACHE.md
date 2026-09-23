---
title: "Shared cache management"
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: "agentic-os"
continuity_id: "CACHE-001"
version: "1.0.0"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
date: "2026-09-23"
lang: "en-US"
frontmatter_contract: "required"
load_policy: "on-demand"
local_rung: "spec-complete"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: true
worktree_id: "device-0232231d4a19--cache-contract"
agent_id: "codex-cache-contract"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "dacd8e21b9916ff73548f6c8dcbe233022fb2d9f"
---

# Shared cache management

`CACHE-001@1.0.0` joins PRD, TAD, ADR, MVP and GTM below. OS owns this shared policy;
each mechanism and product owns its implementation, configuration and evidence.
Load this guide when designing, changing or reclaiming a cache. Discover local owners through
[workspace document routing](../DOCUMENTS.md#repository-concerns).

## PRD

Context: a builder repeatedly computes, fetches or validates the same inputs while retained
cache bytes compete with source and recovery storage. Intent: reduce avoidable latency, CPU,
I/O, network transfer and token use within zero-spend constraints. Directive: reuse only data
whose identity and permitted use remain valid; bound retention and measure the whole operation.
Role/Subject: cache owner. Action/Verb: declares. Object: the cache's lifecycle and evidence.
Outcome: reviewable reuse and reclamation decisions with product correctness preserved.
These fields use the [shared authoring seam](PRD-TAD-ADR-MVP-GTM.md); no new schema is introduced.

Scope covers process memory, prompt/context, local validation receipts, protected CI evidence,
disk artifacts, browser/service-worker storage and HTTP/edge caches. Authoritative local data
may share a storage API or directory with a cache; classify it by ownership and recoverability.
Curated [workspace memory](MEMORY.md) and unsynced user work retain their own lifecycle.

| Acceptance | Design and verification |
|---|---|
| AC-C01 | One shared owner and local references; review navigation and package contents. |
| AC-C02 | Local declarations identify keys, limits, freshness, invalidation and recovery; review the declaration against code and owner tests. |
| AC-C03 | Mutable or unauthorized reuse cannot supply effects or overwrite newer state; owner tests cover invalidation, isolation and concurrent completion. |
| AC-C04 | Reclamation preserves authored bytes and obeys the existing effect owner; review exact target and recovery receipts. |
| AC-C05 | Performance claims identify inputs, coverage and observed cost; compare bounded cold/warm runs at the owner. |

AC-C01 is this documentation delivery. AC-C02–C05 govern subsequent owner changes and require
their own evidence; this guide does not certify every existing cache or consumer as compliant.
No new cache engine, periodic scan, paid service, dependency, global TTL or cleanup command is required.

## TAD

TAD `1.0.0` consumes PRD `1.0.0`; ADR `1.0.0` binds the decisions below.

### Local cache declaration

Place a short declaration beside the existing implementation contract. Reuse existing fields,
code constants, tests and commands by reference. This checklist is prose, not a new manifest
format or required file per cache. Mark an inapplicable field with its reason and a missing
observation as unknown; neither establishes runtime compliance.

| Field | Required decision or reference |
|---|---|
| Owner and purpose | Source repository/path, responsible mechanism, consumer and avoided work. |
| Storage and data class | Memory/disk/browser/edge location; derived data versus authored, unsynced or recovery state. |
| Identity and isolation | All material inputs: source/content revision, configuration, toolchain/schema and relevant environment; repository, workspace, tenant and authorization scope where applicable. Never store raw credentials in keys or logs. |
| Bounds | Entries and/or bytes, maximum entry size, retention policy, operation deadline and eviction behavior; reference actual limits and account for quota failures. |
| Freshness | Immutable identity or TTL/revalidation rule; allowed stale-read window and offline behavior, if any. A TTL alone does not establish input identity. |
| Invalidation and concurrency | Changes that invalidate entries; in-flight deduplication scope, cancellation, atomic publication and protection against an older operation replacing newer state. |
| Recovery and disposal | How to rebuild, validate, roll back or restore; network/toolchain needs and rebuild cost; exact deletion owner and permissions. |
| Observation and checks | Hit/miss/stale/eviction signals where implemented, cold/warm measurements, owner test command and remaining gaps. |

Choose the least expensive correct mechanism: direct computation, bounded memoization or the
owner's existing store. Keep a cache only when avoided work warrants lookup, validation,
storage and rebuild costs. No caching is a valid declaration for sensitive, rapidly changing,
cheap or unreconstructable inputs. Dependencies and installed toolchains need their own
restore policy; a directory name does not establish that its contents are disposable.

### Lifecycle

1. **Admit:** classify the data, bind owner and isolation, select explicit bounds and document
   the source needed to rebuild it. If correctness or recovery is unknown, retain owner data
   and resolve the missing contract before enabling reuse or deletion.
2. **Read:** verify key, permitted scope and freshness. A miss, expiry or corrupt derived entry
   takes the documented recompute/refetch path. If offline, use only an explicitly permitted
   stale-read policy with visible age/coverage, or return an unavailable result.
3. **Populate:** bound work and payloads. Coalesce identical work only within the same valid
   isolation/key. Publish complete results atomically where persistence needs it; a superseded
   asynchronous completion must not overwrite the current revision or another writer's entry.
4. **Invalidate/evict:** apply owner-defined revision, schema, auth, time or capacity changes.
   Separate disposable derived entries from outboxes, authored records and recovery bytes.
   Ordinary implementation eviction follows its declared policy; operator cleanup uses the
   existing effect workflow and exact target authority.
5. **Recover/observe:** rebuild or restore through the owner, verify the result and record actual
   cost. Repeated misses, slow rebuilds or quota pressure justify revisiting limits; they do
   not authorize new services or background polling.

Wrong or stale cache state may trigger recomputation; missing authority must fail closed.
Cached success cannot grant integration, cleanup, canonical sync, deployment or payment effects.
Reobserve the live bytes, provider and authority required by the selected effect. Preserve known
validation failures; reuse must not search backward for an older green result.

### Existing owners

These routes identify where to resolve detail; they are not a second cache inventory.

| Concern | Mechanism and detailed contract owner |
|---|---|
| Prompt prefix, context revision and continuity | [CONTEXT.md](CONTEXT.md); provider-reported cache usage is distinct from local prefix reuse. |
| Local check selection and receipt reuse | [REPOSITORY-VALIDATION.md](REPOSITORY-VALIDATION.md) and [VALIDATION-ECONOMY.md](VALIDATION-ECONOMY.md); deterministic inputs and live checks have different reuse rules. |
| Protected provider evidence | [CI-EVIDENCE-REUSE.md](CI-EVIDENCE-REUSE.md); exact source, inputs, run/attempt and provider reobservation govern eligibility. |
| Disk diagnosis and recoverable effects | [STORAGE.md](STORAGE.md), [cleanup](USER-CLEANUP.md); classification and size observations grant no disposal authority. |
| Product/browser/HTTP caches | The product's existing contract through [repository routing](../DOCUMENTS.md#repository-concerns); keying, offline UX, service-worker activation and endpoint cacheability remain local. |

Canvas context integration consumes the OS context owner. Graph parser, browser and workspace
storage, GameXR offline shell activation and Commerce HTTP response policy stay with their
respective product owners. A writable local store labelled "cache" can contain unsynced work;
preserve it until the owning contract proves safe reconstruction or recovery. Honor an endpoint's
`no-store` policy and authorization boundaries; a shared guideline cannot widen cacheability.

### Performance and economics

Start from an observed bottleneck. Use the same source, configuration, workload and environment
for a bounded cold/warm comparison, keeping required validation and outcome coverage constant.
Record sample count, cache state, lookup/validation/population/rebuild time and retained bytes.
Use existing [validation cost observations](VALIDATION-ECONOMY.md) for harness work. Add owner
metrics only when they answer a concrete decision; avoid another telemetry service or history store.

Report wall time, CPU/RSS, I/O/network and provider token/cache-hit usage only where observed.
Include hashing and invalidation work; do not double-count nested checks or label historical
reused cost as new execution. Separate logical bytes, allocated bytes and observed free-space
change. Unknown monetary cost remains unknown; estimates identify their rate and assumptions.
No paid plans, add-ons or overages are allowed. Faster local lookup is not evidence of total
release savings, provider billing savings, buyer demand or production performance.

## ADR

- **ADR-C01 — One policy owner:** AC-C01–C02 use this on-demand guide and existing local
  declarations. Target repositories reference the selected OS revision; copies would introduce
  competing policy and more update work. Detailed implementation contracts remain at their owners.
- **ADR-C02 — Identity before reuse:** AC-C02–C03 bind keys, scope, freshness and concurrent
  publication to the actual mechanism. Keep local receipt and provider evidence rules distinct;
  their detailed owners resolve safe reuse. No global TTL or blanket invalidation policy is added.
- **ADR-C03 — Preserve recoverability:** AC-C03–C04 separate derived data from owner state and
  route operator effects to existing lifecycle/storage owners. Naming and diagnostics are insufficient
  deletion evidence; reconstruction cost and offline requirements affect retention choices.
- **ADR-C04 — Measure net benefit:** AC-C05 compares observed complete operations using existing
  instrumentation before introducing more machinery. Free/FOSS and zero-spend boundaries remain.

## MVP

This revision delivers shared policy and navigation. It changes no runtime behavior, consumer
package pin, cache capacity or retention setting. The packaged `guides` directory already includes
this asset; no executable module, dependency or always-load prompt bytes are added.

Source acceptance: run `npm run check`, resolve added Markdown targets, verify this guide in
`npm pack --dry-run --json --ignore-scripts`, and keep each changed document below 600 lines.
The implementation budget is seven documentation files and at most 20 KiB of changed text.
These checks verify AC-C01 source delivery; AC-C02–C05 require the selected owner's declaration,
affected tests and observations when that mechanism is changed. No fleet-wide audit is claimed.

## GTM and adoption

Use [DOCUMENTS.md](../DOCUMENTS.md) or the installed OS guide at an exact source revision to
discover this policy. A mutable discovery link does not update a pinned consumer dependency.
When a target cache next changes, reference `CACHE-001@1.0.0` and the selected 40-hex OS revision
from its existing owner document; record local declarations or gaps there, then run its affected
checks. No new root `CACHE.md` is needed where that owner already exists. A target with an
independent cache lifecycle may use a local guide for its implementation and reference this policy.

Select a pilot from a measured latency/storage problem, reuse the existing mechanism and compare
the bounded workload above. Report adoption, correctness and cost evidence separately. Rollback
of this documentation uses the normal source workflow; runtime cache rollback remains local.
Runtime enforcement, whole-fleet conformance, performance savings and commercial value are
unmeasured by this delivery. Source integration and deployment keep their separate receipts.
