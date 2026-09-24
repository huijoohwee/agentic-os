---
title: "Reference implementation — Markdown documentation management"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.1.0"
date: "2026-09-24"
lang: "en-US"
owner: "Documentation maintenance"
frontmatter_contract: "required"
continuity_id: "DOC-MGMT-001"
prd_revision: "0.1.0"
tad_revision: "0.1.0"
adr_revision: "0.1.0"
mvp_revision: "0.1.0"
gtm_revision: "0.1.0"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
lifecycle_status: "proposed"
load_policy: "on-demand"
worktree_id: "device-0232231d4a19--markdown-doc-management"
agent_id: "codex-documentation-management"
guideline_revision: "3.3.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/987dd1d1e6d25761f2279d49a53c40a210466679/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "0433c86a3528f2130d952a1b63c9e40feb41fde3"
---
# Reference implementation — Markdown documentation management

## Identity and scope — reference implementation

Five roles join `DOC-MGMT-001@0.1.0`. This extension consumes P01/T01 authoring and P05/T05 release
from `PRD-TAD-ADR-ADLC-PIPELINE-001@1.4.9` at [the inspected revision][pipeline]. It specifies document
maintenance; the pipeline still owns admission, evidence and publication. [Authoring][guideline],
[frontmatter][frontmatter] and [templates][templates] retain their existing definitions.

**CID/RAO:** Context: missing template-update contract. Intent: prevent drift/content loss. Directive:
extend existing owners with exact provenance. Maintainer → update enrolled Markdown → validated
candidate, explicit conflict or no-change result.

This increment edits the plan/index only; implementation is proposed. Reuse website `schema/`,
`guidelines/`, `template/`; no new repository/parser/service/model call or external reference adoption.

## Codebase grounding — reference implementation

Observed local commits, 2026-09-24; re-ground before implementation. Source is not deployment proof.

| ID / repository / exact local revision | Grounded behavior / smallest gap |
|---|---|
| G1 / `agentic-os` `0433c86a3528f2130d952a1b63c9e40feb41fde3` | [Frontmatter][os-frontmatter], `src/catalog-input.mjs`, package export `./frontmatter`: bounded parsed mapping, not YAML parsing or semantic schema validation. [Index][os-index] routes existing owners. |
| G2 / website `987dd1d1e6d25761f2279d49a53c40a210466679` | [Guideline][frontmatter], [reader][reader], `scripts/lib/planning-frontmatter.mjs`: restricted YAML then shared snapshot. `schema/AgenticRAG/documentation.jsonld` and `metadata.jsonld` describe patterns/graph fields; neither alone enforces this proposed contract. |
| G3 / website G2 | [Core templates][templates], [template directory][template-dir]: existing `template_inputs`, `$schema`, executable graph metadata. `template/document-template.md` has no YAML header. Enroll a non-executable template first; existing templates are not uniformly conformant. |
| G4 / `agentic-canvas-os` `893bd6b63390e6f31dccc55715283aee675400d0` | [Docs validator][canvas-docs], `scripts/docs-source-references.mjs`, `docs/PRD-TAD-ADR-MVP-GTM.md`, [CI][canvas-ci]: docs job, local schema and legacy status. Extend checks; never bulk relabel readiness. |
| G5 / `agentic-graph` `2874751715a1e1f0a12c06415141a93c894c9d90` | [Frontmatter][graph-frontmatter], `canvas/src/cli/doc-sanity-check.ts`, `canvas/package.json`, [CI][graph-ci]: rich renderer fields, lint/sanity and release manifests. Preserve semantics; avoid mutating `docs:update`. |
| G6 / G1 + G2 | [Check catalog][catalog], [OS CI][os-ci], [website CI][site-ci]: existing budget and guideline checks. These do not prove fleet-wide template ancestry validation. No matching sync/multi-gitter integration found in inspected docs/scripts. |

Related candidates: `agentic-commerce-os`, `huijoohwee`, `GameXR`. Inspect owners/pins/parsers/CI and
authority before enrollment. Keep private records private and mirrors under source release control.

## PRD — reference implementation

### Pain, users and outcome

P1: manually reconcile shared rules and local content. P2: template changes may miss documents or
lose local decisions. P3: repository checks do not establish uniform conformance. The request
establishes these jobs; frequency, lost minutes, defect rate and willingness to pay are **unvalidated**.
User: maintainer. Possible buyer: small engineering team. Beneficiaries: reviewers and readers.
Manual review is the baseline alternative.

“0” is this inspected inventory. “1” targets one safe document update in each named repository,
passing applicable checks and repeating with zero diff during one pilot week. Previously cached inputs
support offline read/edit/compare/check. Mobile browsers review Markdown/proposals; shell execution
and offline publication are outside that surface. Device handoff binds commits and receipts.

### Requirements and VCCs

All rows are Must. V-Dn names proposed acceptance cases, not existing tests; Dn ↔ T-Dn is bidirectional.

| ID / pain | Given → when → then; named VCC / design |
|---|---|
| D1 / P1 | Enrolled file + explicit profile → check → existing YAML/identity validate; malformed, duplicate and over-budget inputs fail at source. V-D1 `metadata-profile` / T-D1. |
| D2 / P1 | Reviewed pins → online/offline check → deterministic results; missing/tampered baseline or untrusted schema URL blocks dependent updates. V-D2 `pinned-inputs` / T-D2. |
| D3 / P2 | Old/new template + local edits → prepare → preserve disjoint changes; overlap, missing baseline or ambiguous rename/deletion causes conflict and zero accepted writes. V-D3 `preserve-local` / T-D3. |
| D4 / P2 | Explicit repo/path allowlist → batch → only enrolled regular non-executable `.md` changes; all other bytes stay identical. V-D4 `markdown-boundary` tests traversal, symlinks, collisions, oversize/binary and unauthorized files / T-D4. |
| D5 / P3 | Document or rule/pin change → CI → deterministic findings gate candidate; affected docs only, full enrolled rescan for profile/pin changes. V-D5 `ci-document-gate` / T-D5. |
| D6 / P2 | Prepared candidate → rerun/interruption → identical inputs no-op; head drift/races refuse apply; recovery preserves before/after bytes and concurrent edits. V-D6 `replay-recovery` / T-D6. |
| D7 / P3 | Four pilot candidates → review → exact source/check/result receipts and timed walkthrough; authoring, release, runtime and demand remain distinct. V-D7 `pilot-evidence` / T-D7. |

Should: concise drift/conflict guidance. Could: scheduled discovery after pilot. Won't this increment:
automatic merge, arbitrary discovery, code/config sync, broad reformatting, schema repair, generated
edits, hosted UI or runtime/revenue claims. Discovery/read uses zero model tokens and grants no effect.

## TAD — reference implementation

### Ownership and dependency direction

Schema/guidelines → templates → consumer Markdown → local parser/shared snapshot/profile → CI.
Updater produces candidates; lifecycle owners admit/publish/integrate. No reverse product dependency,
sibling source import, duplicate registry or field definitions; schemas are read-only sync inputs.

| Component / criterion | Reuse decision / smallest delta / owner |
|---|---|
| T-D1 / D1 | Extend common authoring constraints, reuse actual local parser and locked `agentic-os/frontmatter`; schema owner adds only missing rules and fixtures. |
| T-D2 / D2 | Reuse `schema`/`$schema`, `source_docs`, `guideline_source/revision`, `template_inputs` and role revisions where supported. Profile owner proves provenance representation; no new sidecar. |
| T-D3 / D3 | One new central entrypoint, proposed `bin/agentic-os-doc-sync.mjs` (absent at G1), handles check/dry-run/apply. OS owner splits pure helpers only for responsibility/size. |
| T-D4 / D4 | Native lanes + [multi-gitter][multi-gitter] dispatch the same pinned script from outside target clones; no per-repo copies. Lifecycle owner validates the adapter. |
| T-D5 / D5 | Extend existing validators/CI discovery; one logical document job per repo, reusing Canvas's job. Consumer owners separately bootstrap code/YAML. |
| T-D6 / D6 | Reuse native head binding, writer lease and immutable publication; updater stages candidates and keeps bounded interrupted-write recovery. |
| T-D7 / D7 | Reuse Evidence References and ADLC receipts; maintainer updates this artifact's successor, no new evidence database. |

### Frontmatter reuse and provenance

Keep existing field meanings: identity/version/date/language/owner, continuity and five role revisions,
local/delivered rungs and lane. Enrollment explicitly maps path to profile; filenames never determine
identity. Unknown keys follow the consumer's policy. Preserve `graphId`, renderer settings, `flow`,
`widget_bundle`, `spec`, invocation and runtime evidence. Template inputs are data, never expressions.

Use exact commit-and-path locators in existing `source_docs` for template/guideline provenance. Trusted
local resolution determines each role; document URLs never trigger arbitrary fetch/execute. Digests
go in existing receipts. Document `version` is not the template pin; `reviewed_source_revision` keeps
its subject. Updating a template never advances readiness. Ambiguous provenance or unsupported fields
block enrollment until the owning profile changes, without aliases or a parallel manifest.

Reuse central JSON-LD descriptions and authoring constraints; missing executable rules belong to that
schema/profile owner with real fixtures. `$schema` alone validates nothing. Order: bounded read →
strict consumer YAML parse → `snapshotFrontmatter` → semantic profile → separate evidence. Preserve
consumer dialects; the website subset cannot replace rich Graph YAML. Use reviewed local schemas and
files strictly below 500,000 bytes and 600 lines.

### Update and conflict algorithm

1. Bind explicit repository, scope, profile, target head, old/new source commits, updater revision and
   input digests. Missing ancestry blocks; legacy documents need reviewed baseline adoption first.
2. Reconstruct baseline B with its original inputs and renderer; render new baseline N with proposed
   inputs. Compare current L. If historical inputs/renderer cannot be reproduced, stop. Renderer
   changes require compatibility proof; never substitute current inputs into historical B.
3. If L=B, propose N. Otherwise three-way merge only enrolled non-executable sections/metadata.
   Preserve unmanaged bytes/local-only keys. Overlap or ambiguous section boundaries returns conflict.
4. Missing source never means deletion. Renames, deletions and breaking revisions need reviewed
   mappings/migration and recovery; unenrolled documents remain unchanged.
5. Validate all candidates with real profiles and the diff boundary before any apply. Any conflict
   stops that repository. Advance provenance only with accepted bytes; avoid whole-YAML reformatting.
6. Recheck head, inputs and lease, then apply. Keep a bounded before/after journal outside tracked docs.
   Multi-file writes are not atomic: interruption blocks publication. Restore only files matching
   this operation's after-digest; concurrent edits require owner reconciliation.
7. Same accepted inputs produce zero diff/proposals. Repository + pins + scope identify duplicates.
   Published candidates are immutable: use native successors, no force replacement or overwrite fallback.

### Fan-out and CI contract

Proposed script inputs: mode (`check`, `dry-run`, `apply`), repository, source revision and enrolled
scope. Output: bounded diff/findings. `check` is read-only; `dry-run` prepares temporary candidates;
`apply` needs admitted scope and matching inputs. Exit 0 covers only that mode. Unknown inputs fail.
The executable is pinned and central; neither mutable-branch downloads nor consumer copies.

Multi-gitter supplies documented `run`, explicit `-R` targets, `--dry-run`, serial concurrency and
branch-conflict skip. It does not supply native lane authority. Initially run the same script through
multi-gitter **dry-run only** on the four explicit targets; native owners apply/publish reviewed
candidates. Live multi-gitter PR creation waits for an admission-compatible adapter. No auto-merge,
force replacement or lane-guard workaround; report per-repo failures independently.

A `.md` suffix is insufficient: exclude executable Markdown, agent instructions, prompts, skills,
protected runtime metadata and generated mirrors from automatic sync. Reject non-Markdown, symlinks,
submodules, path escape, case collisions and unrecognized content. Enroll files/sections explicitly;
never execute commands or hooks from document data. Code/YAML/bootstrap changes use separate lanes.

CI uses pinned local inputs and the consumer parser/common check: affected Markdown on document
changes, all enrolled files on schema/profile/template/pin changes. Include merge-group events where
used. No writes, schema-URL fetch, write credentials or model calls. Unknown/absent assets fail with
remediation. Findings reuse existing Rule ID/type/severity plus path, expected/observed and source pin.

| Repository / existing CI | Reused checks / gap |
|---|---|
| OS / `ci.yml` | `docs:check`, `check`, `evals`; add enrolled on-demand conformance beyond budgets. |
| Canvas / `ci.yml` `docs-contract` | `docs:check`, CI `check:ci -- --only=docs`; add provenance/drift. |
| Graph / `integration.yml` | `doc:lint` and `doc:sanity` with `--workspace=@agentic-graph/canvas`; verify selection and add docs-only gate. |
| Website / `guideline-contract.yml` | `prd-tad-adr-mvp-gtm:policy:check`, parser tests, `npm test`; add provenance/template fixtures. |

### Five flows, invocation and recovery

| Flow | Joined path / criteria |
|---|---|
| User | Edit → compare → inspect preservation/conflicts → accept candidate; D1–D4. |
| System | Pinned owner → one updater → local profile → native lane → CI; D2–D6. |
| Data | B/L/N + inputs → candidate/digests → validated Markdown/receipt; no copied private evidence; D2–D4. |
| Business | Manual baseline → timed pilot → offer → collection/support measurement; D7/GTM. |
| Process | START → prepare/check → RELEASE → separately authorized delivery/recovery; D5–D7. |

Invocation register: T-D3 CLI is **proposed**; T-D4 multi-gitter is **proposed dry-run**. Existing MCP
lifecycle/check discovery is reused. Dedicated MCP/WebMCP sync and `/docs.sync`, `#docs-sync`,
`@template` are **unsupported** until registered with the existing owner and prepare-only browser
checks. Mobile review needs no new UI; offline checks need verified cached inputs.

Authoring requires admitted scope; publication requires native protected exact-head checks. Mirror,
site/runtime delivery and rollback require the consumer controller and separate effect authority;
closed for this increment. Source rollback is a reviewed revert of Markdown AND provenance plus the
same checks. Runtime rollback needs its own predecessor. Retain journals/refs/local work. Incompatible
schema rollback waits for the schema owner's verified recovery path.

## ADR — reference implementation

`ADR-DOC-01` binds PRD/TAD `0.1.0`. Constraints: Markdown-only, free-tier/FOSS, zero model calls,
local-content preservation and native authority. Alternatives: manual copy/review lacks repeatable
drift checks; replacing files loses edits; new repositories duplicate owners; hosted automation adds
cost. Outranking selects existing owners + one script for the closest technical fit. Buyer pain/WTP
is unvalidated; retain manual review as fallback, without claiming a market winner.

`ADR-DOC-02`: reuse frontmatter and pinned `source_docs`, not per-repo lock sidecars. Ambiguous
ancestry blocks enrollment; executable documents retain owner review. Revisit only if real fixtures
cannot represent baseline/inputs; schema owner defines any extension first.

`ADR-DOC-03`: multi-gitter dry-run fan-out, native publication. Live transport publication stays
unimplemented until V-D4/V-D6 prove native admission, scope, immutable retries and provider handoff.

## MVP — reference implementation

### Dependency-ordered delivery and budgets

| Phase / owner | Minimum delta / exit / bounds |
|---|---|
| 0 / maintainer | This plan + index; structural checks. Two files, <25 KB added, <600 lines/file, no modules/dependencies/always-load bytes. |
| 1 / authoring owner | Existing non-executable template + consumer fixtures; V-D1/V-D2. Estimate 45 min, cap 60 min, 4 modules/<40 KB; stop on ambiguous ancestry. |
| 2 / OS owner | One script + native lane; V-D3/V-D4/V-D6. Estimate 60 min, cap 90 min, 4 modules/<60 KB; stop on content loss. |
| 3 / consumer owners | Existing CI + four-target dry-run; V-D5/V-D7. Estimate 45 min, cap 60 min, 4 CI edits/<25 KB; stop on authority mismatch. |

Estimates are assumptions, not implementation authority; START narrows caps. Per batch: one active
repo, ten files/repo, <500 KB diff/report chunk, five min/check, ten min/repo; stop on exhaustion.
Zero paid services/overages and model tokens for sync/check. Implementation-agent cap: 12,000 tokens/
phase, then checkpoint. Use local FOSS execution if hosted free quota is unverified. External waits
name dependency, unblock condition and recheck, never ETA.

Demo: change one rule, compare a locally customized document, show preservation/invalid-input failure
and empty rerun, then review source handoff. Repeat on four documents and inspect mobile/keyboard
review. Four experience criteria remain unassessed until observed.

### Evidence and current handover

Implemented: grounded proposal and index link only. D1–D7 behavior is **not implemented or verified**.
Local/delivered rungs stay `undocumented` pending evaluator evidence; no fleet sync, CI rollout,
deployment, payment or savings claim. Named consumer checks are future integration requirements.

Preflight: canonical is read-only; another published lane reserves the pipeline document. Existing
workflow collector created this separate one-checkout mission; native START admitted these two files
at G1. No other mission caps changed. `DOCUMENTS.md` exposes the extension; a parent link can follow
once its owner releases scope.

Validation, 2026-09-24: `git diff --check`, strict owner frontmatter parsing, five-role revisions and
16 exact source links passed. `npm run check`: evaluator + 20 selected suites passed in 49.1 seconds
(212 suites outside scope), source digest `51de978a086eae4afc39987c4601699df9b5fee15bae34e90ccc741d87b6ab6a`
before this evidence checkpoint. Initial missing locked test dependency was resolved by `npm ci`.
No package/source changes. Agent tokens/total active time are unmetered; incremental service spend $0.
Final candidate checks/publication use RELEASE; provider handoff is not integration or deployment.

Next: authoring owner selects one non-executable template and four exact documents; refresh G1–G6,
prove baseline/inputs, then implement phase 1 in admitted scope. Exit V-D1/V-D2; recheck on source/profile
change. This task grants no fleet or production write authority.

## GTM — reference implementation

Rank 1: free local pilot validates the maintainer job. Rank 2: offer one reachable small engineering
team a **$1 fixed-scope maintenance pilot** after V-D1–V-D7. Rank 3: repeat service after repeat-use
proof. Price/segment are hypotheses; subscription/hosted operation is deferred. No demand, payment,
revenue, retention or savings observed. Outreach needs separate instruction.

Constraints → argumentation → outranking: zero infrastructure/marketing spend; prefer an existing
relationship and walkthrough over unevidenced paid acquisition. Over one week measure review minutes,
conflicts, repeat-run success and support time. Continue if four candidates preserve content and the
prospect requests a repeat; pivot if review costs more; stop on content loss. Record a successor.

Bootstrap, no funding/hiring/inventory. Pilot target: $1; cash stays zero until collected, revenue zero
until agreed delivery. Model/hosting cost target $0; record labor minutes × explicitly chosen rate.
Contribution = $1 − actual fees − variable cost; unknown fees are not zero. Base: no customer/$0 inflow;
upside: one paid repeat; downside: unrecovered labor. No scalable economics or annual forecast claimed.

### From-0-to-1 coverage and deferred audience work

Coverage dispositions do not earn readiness. Every row consumes `DOC-MGMT-001@0.1.0` above.

| Domain / owner | Source, disposition and next check at this revision |
|---|---|
| C01 pain / maintainer | PRD: covered; request/source known, WTP/frequency unknown; time pilot. |
| C02 market / offer owner | GTM: deferred; interview before two-method market sizing. |
| C03 offer / offer owner | ADR/GTM: covered as hypothesis; test manual comparison/$1 offer. |
| C04 experience / maintainer | PRD/demo: covered requirements; pilot/mobile check pending. |
| C05 architecture / architect | TAD/G1–G6: covered design; refresh pins. |
| C06 quality / validation owner | V-D1–V-D6: covered check plan; behavioral proof pending. |
| C07 tradeoffs / architect | ADR: covered; revisit after provenance/publication fixtures. |
| C08 slice / maintainer | MVP: covered plan; acceptance pending. |
| C09 retention / offer owner | GTM: covered experiment; outreach/repeat-use unknown. |
| C10 operations / operator | Recovery/budgets: covered design; test interruptions/support effort. |
| C11 obligations / offer owner | Deferred until offer: source licenses, client data terms and payment jurisdiction need review before paid delivery. |
| C12 finances / offer owner | Deferred beyond pilot arithmetic: source customer/fee/labor inputs and linked income/cash/balance statements before business-plan handoff. |
| C13 capital / operator | MVP/GTM: covered bootstrap decision; revisit on repeat demand. |
| C14 execution / lifecycle owner | Handover/boundaries: covered scope; separate release/runtime receipts. |
| C15 projections / offer owner | Deferred: no audience action; central template owns deck/plan/model before handoff. |
| C16 learning / maintainer | GTM/next action: covered experiment; successor after pilot. |

Dispositioned: 16/16; covered applicable: 12/16; deferred: 4; not applicable: 0. Alignment remains open;
reuse existing findings (`unimplemented-guideline`, `unresolvable-reference`, `unproven-claim`,
`duplicate-owner`). Structural inspection is not exhaustive conformance; block dependent transitions only.

[guideline]: https://github.com/huijoohwee/huijoohwee.github.io/blob/987dd1d1e6d25761f2279d49a53c40a210466679/guidelines/prd-tad-adr-mvp-gtm-guidelines.md
[frontmatter]: https://github.com/huijoohwee/huijoohwee.github.io/blob/987dd1d1e6d25761f2279d49a53c40a210466679/guidelines/runtime-frontmatter-guidelines.md
[templates]: https://github.com/huijoohwee/huijoohwee.github.io/blob/987dd1d1e6d25761f2279d49a53c40a210466679/guidelines/prd-tad-adr-mvp-gtm-templates.md
[template-dir]: https://github.com/huijoohwee/huijoohwee.github.io/tree/987dd1d1e6d25761f2279d49a53c40a210466679/template
[reader]: https://github.com/huijoohwee/huijoohwee.github.io/blob/987dd1d1e6d25761f2279d49a53c40a210466679/scripts/lib/git-guidelines/fm-reader.mjs
[pipeline]: https://github.com/huijoohwee/agentic-os/blob/0433c86a3528f2130d952a1b63c9e40feb41fde3/guides/PRD-TAD-ADR-MVP-GTM.md
[os-frontmatter]: https://github.com/huijoohwee/agentic-os/blob/0433c86a3528f2130d952a1b63c9e40feb41fde3/guides/FRONTMATTER.md
[os-index]: https://github.com/huijoohwee/agentic-os/blob/0433c86a3528f2130d952a1b63c9e40feb41fde3/DOCUMENTS.md
[catalog]: https://github.com/huijoohwee/agentic-os/blob/0433c86a3528f2130d952a1b63c9e40feb41fde3/test/repositories.json
[os-ci]: https://github.com/huijoohwee/agentic-os/blob/0433c86a3528f2130d952a1b63c9e40feb41fde3/.github/workflows/ci.yml
[canvas-docs]: https://github.com/huijoohwee/agentic-canvas-os/blob/893bd6b63390e6f31dccc55715283aee675400d0/scripts/docs-contract.mjs
[canvas-ci]: https://github.com/huijoohwee/agentic-canvas-os/blob/893bd6b63390e6f31dccc55715283aee675400d0/.github/workflows/ci.yml
[graph-frontmatter]: https://github.com/huijoohwee/agentic-graph/blob/2874751715a1e1f0a12c06415141a93c894c9d90/canvas/src/lib/markdown/frontmatter.ts
[graph-ci]: https://github.com/huijoohwee/agentic-graph/blob/2874751715a1e1f0a12c06415141a93c894c9d90/.github/workflows/integration.yml
[site-ci]: https://github.com/huijoohwee/huijoohwee.github.io/blob/987dd1d1e6d25761f2279d49a53c40a210466679/.github/workflows/guideline-contract.yml
[multi-gitter]: https://github.com/lindell/multi-gitter#readme
