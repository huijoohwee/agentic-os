---
title: "On-demand shared collaboration"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
date: "2026-09-11"
owner: "agentic-os"
continuity_id: "SHARED-COLLABORATION-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
load_policy: "on-demand"
---

# On-demand shared collaboration

## PRD: cooperative admission, not execution authority

Enrolled devices and LLM clients need one small shared work contract, bounded concurrent claims and
compact handoffs. Existing lane reservations protect one clone only. This layer coordinates cooperating
clients across clones; existing lane, sandbox, governance, provider and release controls govern effects.
It does not spawn models, grant permissions, meter provider spend or authenticate actor labels.

Acceptance: independent clones discover the same pinned task, race an exact board revision with at most
one winner, admit disjoint work with different provider/model labels, reject overlapping writers and stale
fences, retain expired reservations, report bounded handoffs and archive stopped results without losing
Git history. Offline reads never admit or renew work. Source, index and dirty owner bytes stay untouched.

## TAD: shared metadata and local execution

`bin/agentic-os-collaboration.mjs` owns the closed transition contract. The lazy
`bin/agentic-os-collaboration-store.mjs` reuses workspace enrollment, source identity, memory pins,
canonical JSON, Git-private locking and exact ref transactions. CLI and MCP invoke the same owner.
No dependencies, src modules, background service or always-load guidance are added.

One intentionally separate branch on the existing private workspace remote holds coordination:
`refs/heads/agentic-os/collaboration-v1`. Its only file is canonical `board.json`. Its first commit has
no parent; later commits preserve their exact predecessor. No workspace main files, index, artifacts
or vendor sessions are copied. Main-branch curated memory/TODO publication remains reviewed and separate.

Every mutation requires the current board SHA (`absent` only for first submission). Git compare-and-swap
arbitrates independent clones; a source-wide local lock serializes callers sharing one clone. No automatic
conflict retry occurs. An unconfirmed or no-longer-current publication retains its candidate object and
requires reconciliation: inspect current state/history before deciding whether it happened. Never blindly
repeat an unknown write. Online status may fetch metadata and update its private accepted ref; offline
status reads that ref and reports context-only. Fetch/push do not update HEAD, index or FETCH_HEAD.

Bounds: 64 KiB board, 32 retained tasks, **two active claims across the shared board**, 32 literal write
paths per task, three attempts per retained task, 16 KiB input, 1 KiB objective/summary and eight
credential-free HTTP(S) references. Each transport has a 15-second deadline with no retry loop.
Historical Git objects remain retained and are not a fixed disk-storage budget.

Attempts declare 30–3,600 seconds and 1–1,000,000 tokens. Renewal extends a claim by at most ten minutes,
never beyond the attempt's time budget. Tokens are caller-reported and checked on handoff, not independently
metered. Native callers must enforce execution/model/tool budgets and stop effects. Clock regression fails;
clock skew can reduce availability. Expiry does not terminate a process.

**Expired claims remain reserved.** The old worker must stop and release with its actor and epoch before
reassignment. Lost/offline holders are not automatically taken over; independently authorized recovery is
outside v1. Global monotonic epochs reject stale holders even after archive and task-ID reuse.

## On-demand workflow

After verifying the consumer's trusted profile and [workspace enrollment](WORKSPACE.md), enroll each clone:

```sh
git config --local agentic-os.collaborationEnabled true
agentic-os workspace sync
agentic-os collaborate status
```

Enabling the key starts nothing. The main coordinator submits only authorized independent tasks. Save a
bounded JSON input with the exact source/context pins and current board revision:

```json
{
  "expectedRevision": "absent",
  "id": "review-memory-change",
  "sourceRevision": "<full consumer protected-source SHA>",
  "contextRevision": "<full accepted workspace SHA>",
  "objective": "Review the pinned memory change and return evidence-backed findings.",
  "writePaths": [],
  "maxSeconds": 1200,
  "maxTokens": 4000
}
```

Run `agentic-os collaborate submit --input=<file>`. Empty `writePaths` means read-only; otherwise use sorted,
unique repository-relative literal paths. Submission validates pins; claimants must have source objects and
accepted memory. Each task belongs to the invoking trusted repository identity. Status returns only compact
metadata for that repository; `get --input=<file>` with `{id}` returns one full task.

All remaining operations use `agentic-os collaborate <operation> --input=<file>`:

| Operation | Exact input fields besides `expectedRevision,id` |
|---|---|
| claim | `actor` |
| renew | `actor,epoch` |
| release | `actor,epoch,stopped` with `stopped:true` |
| report | `actor,epoch,result` |
| archive | `actor,epoch`; only a reported task may leave the current board |

`actor` is exactly `{device,agent,provider,model}`, using explicit portable string identifiers. Provider
and model are opaque metadata, not a registry or automatic selection. Use the returned epoch, never guess.
`result` is exactly `{outcome,summary,sourceRevision,refs,tokens,stopped}`: outcome `success` or `blocked`,
`stopped:true`, bounded summary/references and actual reported tokens. Successful read-only results preserve
the source pin. Write results name the produced commit; the coordinator independently observes its diff
and checks. `reported` does not mean accepted, merged or deployed. Release/archive are not worktree cleanup.

After review and durable handoff preservation, archive removes only the current reported record; prior
commits and the fence counter remain. Use unique IDs for new work. Status alone accepts `--offline`.
The existing MCP server's `collaborate` tool accepts `operation`, local `input` pathname, and `offline` only
for status. Array argv is used, never shell interpolation. No additional server or custom agent TOML is needed.

The native coordinator spawns/messages/waits/stops agents only on demand under applicable user, AGENTS or
skill instructions. Pass the task contract and selected memory, not a conversation archive. Before writing,
acquire the shared claim and an existing disjoint native lane, verify its source/write scope, and enforce
the stop deadline. Read-only workers inspect immutable commits, not peers' dirty files. Stop first, report
once, independently review, and use [memory capture](MEMORY.md) for a separately reviewed durable decision.

## ADR, trust and validation

Reuse Git and a neutral CLI/MCP contract instead of adding a daemon, live SQLite sync, session importer,
cloud database or paid orchestration service. Codex, other LLM clients and local tools can cooperate while
their credentials, models and runtime history remain device-local. `.gitignore` is not a database boundary.

Git authenticates repository access, not actor labels, stop acknowledgements, token reports or results.
A malicious writer can forge metadata, deny service or bypass this cooperative protocol. These fences are
not authenticated governance leases, distributed sandbox enforcement or OS process exclusion. Never execute
shared commands automatically or treat a result as independent test, merge, runtime or cleanup proof.
History rewrites fail against an accepted snapshot; first admission has no previous history trust anchor.

Validation: `__tests__/collaboration.test.mjs` covers independent clones, actual concurrent processes with
different provider labels, cap/overlap/fence/expiry behavior, pinned reads, reported budgets, archive/reuse,
dirty preservation, rejected publication, offline operation, identity/history drift and CLI/MCP grammar.
Run affected checks. These are local protocol/process tests, not live proof of multiple physical devices,
multiple LLM APIs or independent enforcement of model spend. Measure total task time/tokens before ROI claims.
