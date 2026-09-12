---
title: "Fleet Work Allocation"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.1.0"
date: "2026-09-12"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
status: "allocation-check-implemented"
lang: "en-US"
continuity_id: "FLEET-01"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-cba000d3779d--fleet-ownership"
agent_id: "codex-01a0940a"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "ebe98531494295c0548e704a924421128791f631"
prd_revision: "1.1.0"
tad_revision: "1.1.0"
adr_revision: "1.1.0"
mvp_revision: "1.1.0"
gtm_revision: "1.1.0"
---

# Fleet work allocation

Use this guide before dividing one outcome among devices, agents or terminals. It owns the reusable
allocation check; [DOCUMENTS.md](DOCUMENTS.md) remains the workspace navigation owner. This file has
no live device roster, task rows or lock state. Graph's `FLEET.md` is its external export ledger and
remains a separate product concern.

<a id="intent-and-acceptance"></a>

## PRD: intent and acceptance

**CID FLEET-01.** Intent: reduce duplicate implementation and preserve unfinished work across devices.
Role/Subject: dispatcher. Action/Verb: partition. Outcome/Object: one complete, independently reviewable
allocation of a selected outcome. Reuse this CID across the criteria, design and decision below.
The selected outcome and its acceptance criteria come from the owning PRD/TAD/ADR revision.

| Criterion | Design and validation |
|---|---|
| FLEET-01.1: each selected criterion has one responsible task | Reject uncovered, duplicate or unknown requirement IDs. |
| FLEET-01.2: each task has one named owner and execution device | Reject absent identities; identity text alone grants no authority. |
| FLEET-01.3: parallel tasks have disjoint write ownership | Reuse the lane path matcher; reject unordered scope or path overlap. |
| FLEET-01.4: shared files have an explicit order | Compute dependency waves and required handoffs; reject missing dependencies and cycles. |
| FLEET-01.5: checks cannot grant claims or lose work | Read only an explicit bounded snapshot; always report authority and liveClaimsVerified as false. |

Executable evidence: [allocation tests](__tests__/fleet.test.mjs). These criteria describe allocation
validation, not a deployed cross-device ownership service. The checker cannot prove that supplied
requirements exhaust the real product scope; the dispatcher validates that join with the source owner.

<a id="existing-registry-owners"></a>

## TAD: existing registry owners

| Concern | Owner | Update rule |
|---|---|---|
| Immutable plan and successor context | [Workspace TODO contract][todo] and its exact Context record | Append through that contract; preserve historical bytes. |
| Current task, owner, progress and handoff | [Workspace Kanban][kanban] authored rows | One dispatcher writes the selected rows; workers submit evidence to that owner. |
| Derived monthly planning view | Workspace Kanban ledger projection | Generate from the ledger; do not infer live status or ownership. |
| Local branch/worktree observation | Existing `agentic-os status` and `reap` | Observe lifecycle state; do not infer remote exclusivity. |
| Authenticated claim and transfer | Consumer-selected governance authority | Verify current identity, write set, epoch and fence for each authorized effect. |

The operator selected private `huijoohwee/.workspace/.todo` as the shared planning owner. The owner migration moves
the TODO contract, Kanban board and immutable records together, reusing public validators with preserved source
hashes. Canvas retains owner-routing documents only. Historical website logs route to the live index.
Central navigation remains in `DOCUMENTS.md`; moving files does not make simultaneous claims atomic.

## Cross-repository source ownership

The [fleet ownership policy](catalog/fleet-ownership.json) is the sole machine-readable registry for the eight selected repositories and their declared responsibilities. Each responsibility has one source owner; consumer and generated-projection relationships carry no authoring authority. Keep lifecycle governance in Agentic OS, planning rules in the website, product implementations in their named repositories, and generated production content in the existing protected mirror workflow. Launch Copilot uses the Graph runtime; the standalone repository remains a reference. GameXR owns its frontend and consumes the Graph spatial core.

Before cross-repository authoring and before publication, run the existing fleet checker in ownership mode with one explicit JSON mapping from each registered repository identity to its absolute checkout path:

```sh
npm run fleet:check -- --ownership=/absolute/path/to/repository-roots.json
```

Use the selected task worktree when checking an unpublished candidate. Do not create a second persistent owner registry in a consumer. The command verifies each root and Git origin locally, reads only selected Git-indexed or non-ignored candidate files, and rejects missing responsibility sources, a competing source path in another authoring repository, duplicate planning bodies across source repositories, or the same continuity ID owned by different repositories or revisions. Companions may share one exact revision inside their owning repository. Historical exclusions require exact path and SHA-256; modified historical authority fails. Generated mirrors are declared projections, not additional planning owners; their byte parity stays with the existing release checks.

**FLEET-01.6 / SRP:** each declared responsibility has exactly one owner and an existing source artifact. **FLEET-01.7 / MECE:** every registered repository is observed once, and the existing allocation check covers each selected acceptance criterion exactly once. **FLEET-01.8 / SSOT:** current planning identities, revisions and duplicate bodies cannot establish conflicting authority across source repositories. These are finite declared-identity checks; source review must still identify semantic duplication that uses different names and different bytes. Neither a label nor a passing scan proves arbitrary code equivalence.

## Bounded verification and completion

Ownership inspection runs once across at most eight explicit roots, 2,048 files, 500,000 bytes per file, 32 MB total and ten seconds. It starts no model, network, build, test, nested fleet command, recursive directory crawler or background poller. A bound or conflict ends the invocation with a nonzero result; fix the named owning source before trying again.

A prior report may be supplied with `--previous=/absolute/path/to/report.json`. The result binds policy, repository revisions and artifact digests. An unchanged successful input returns `reuse-passed-evidence`; an unchanged conflicting input returns `stop-unchanged-input`. Those dispositions grant no authority and do not skip current file observation. Reuse existing input-bound test receipts; rerun only the checks invalidated by a source, environment or evidence change. After three mechanical repair attempts without a new observation, preserve the concrete blocker and continue independent useful work instead of repeating the same command. Green required checks and exact integration are completion conditions; do not expand review into unrelated low-value work.

Validation uses the existing [fleet tests](__tests__/fleet.test.mjs), including conflicting owners, renamed duplicate bodies, immutable drift, incomplete coverage, cycles, malformed roots and unchanged-input disposition. The CLI remains read-only and reports `authority: false` and `liveClaimsVerified: false`.

## Dispatcher protocol

1. Select one source revision and the complete acceptance list for the outcome. Give each criterion
   one accountable task. Testing and release can own separate criteria even when they inspect the same code.
2. Give every task one owner, device, semantic scope, registry reference and exact writable repository
   paths. An empty `writes` list means read-only work. Shared contract changes have one writer.
3. Declare dependencies before dispatch. Disjoint work can run together; a shared write path requires
   a dependency, verified stopped writer, preserved checkpoint and an authorized ownership transfer.
4. Export the selected allocation as an ephemeral JSON snapshot and run the check below. Keep the
   existing board as the task source; do not maintain the JSON as a second writable task registry.
5. Acquire and verify the existing consumer authority before admitting writes. Start the lane through
   `agentic-os start` with the approved scope and paths. The allocation report does not replace admission.
6. Revalidate source, declared and actual changed paths, claim generation and dependencies before
   publication. Only verified predecessor integration/handoff opens a dependent wave.
7. Checkpoint commits plus unfinished tracked/untracked bytes before transfer. Preserve refs and evidence
   until authenticated retirement and separately authorized cleanup. Never infer takeover from a timeout.

If shared claim verification is unavailable, one dispatcher must serialize assignment and handoff of
all write scopes across participating devices. Checking open PRs alone leaves a pre-publication race.
Offline workers preserve already authorized local work; reconnect and verify current authority before
publishing or transferring. Unknown ownership blocks affected writes, not independent read-only review.

## Allocation input and command

Run from the `agentic-os` checkout:

```sh
npm run fleet:check -- --input=/absolute/path/to/registry-snapshot.json
```

Installed consumers run `node node_modules/agentic-os/bin/agentic-os-fleet.mjs --input=<path>` from
their pinned package. The command is read-only, uses no network or external dependencies, and exits
nonzero for malformed, incomplete or conflicting allocation. It reads at most 500,000 bytes.

The snapshot has exactly these fields; unknown fields are rejected:

| Field | Meaning |
|---|---|
| `schema` | `agentic-os/fleet-allocation/v1` |
| `source` | `{repository, revision, path}` identifying the selected registry document at an exact Git object ID. |
| `requirements` | Nonempty array of `{id, acceptance}` copied for this check from the selected source scope. |
| `tasks` | Nonempty array of the task records below. |

Each task has exactly `{id, owner, scope, contextRef, requirements, writes, dependsOn}`. `owner` has
exactly `{subject, device}`. `requirements` and `dependsOn` are ID arrays. `writes` is an array of
`{repository, paths}`; `paths` contains literal relative file or directory boundaries, never globs.
`contextRef` identifies the existing board row or immutable planning record. `scope` uses `#kebab-case`.
Repositories use lowercase host-qualified profile identities such as `github.com/owner/repository`.
Normalize transport aliases to that identity before export. Local paths and Git transport URLs are rejected.

The check bounds input to 128 tasks, 256 criteria and 2,048 total write paths. It conservatively treats
case and Unicode-normalization path aliases as overlapping for portable work. It does not resolve
symlinks, inspect repositories, authenticate identities or verify source freshness; admission must do so.
Reports bind the canonical input digest, declared source, proposed waves and required handoffs.
Their `authority: false` and `liveClaimsVerified: false` are invariant, including on success.

<a id="decision-and-remaining-enforcement"></a>

## ADR: decision and remaining enforcement

**ADR FLEET-01, accepted for this implementation.** Add a bounded on-demand allocation check that
reuses the existing lane path semantics and governance hashing. Keep planning in private `huijoohwee/.workspace/.todo`, common
authoring rules in the website and lifecycle authority in the existing consumer-selected adapters.
Do not add a mutable Markdown fleet lock, another backlog, a background poller or a new database.
The added command is loaded only when requested; the always-loaded prompt and source-module budget
are unchanged. Tests cover concurrent writers, ordered handoffs, coverage and malformed input.

Atomic cross-device claims are a separate incomplete integration: connect the existing claim/continue
contracts to one authenticated compare-and-swap authority and enforce its current fence at admission,
publication and integration. Exercise simultaneous claims, stale/offline writers, replay, interruption
and exact checkpoint recovery before claiming automatic exclusion. Existing GitHub recovery authority
must not be treated as a general task-claim service. See [ordering boundaries](docs/MERGE-QUEUE.md).

[todo]: https://github.com/huijoohwee/.workspace/blob/main/.todo/docs/TODO.md
[kanban]: https://github.com/huijoohwee/.workspace/blob/main/.todo/docs/kanban.md

## MVP — reference implementation

`FLEET-01@1.1.0` selects one disjoint allocation for a complete acceptance list. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/fleet.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `FLEET-01@1.1.0` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
