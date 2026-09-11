---
title: "On-demand shared collaboration"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.1.0"
date: "2026-09-11"
owner: "agentic-os"
continuity_id: "SHARED-COLLABORATION-001"
prd_revision: "1.1.0"
tad_revision: "1.1.0"
adr_revision: "1.1.0"
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

## On-demand cloud validation

The existing `Test canary` workflow accepts `collaboration=true` on manual dispatch. Its normal weekly
full-suite run is unchanged. Dispatch a reviewed exact source branch and retain the resulting run URL:

```sh
gh workflow run test-canary.yml --ref <exact-candidate-branch> -f collaboration=true
```

`test/collaboration-cloud.mjs` prepares one synthetic enrollment bundle, runs two independent hosted
workers, and independently verifies their receipts against published Git history. It reuses the native
workspace enrollment, memory pin, board transition and Git transport owners; it introduces no runtime
controller, dependency, startup import, credential store or scheduled collaboration loop.

The public repository hosting the workflow is the proof remote. Only synthetic files and task metadata
are published: a fixed `agentic-os/collaboration-fixture-v1` workspace ref and the existing board ref
`agentic-os/collaboration-v1`. They are separate from the real private `.workspace` remote. The source
consumer is a bundled synthetic fixture; `runtimeSha` identifies the actual OS candidate under test.
No private workspace content, credentials, caches or recovery payloads enter the proof. Each worker uses
an independent consumer/workspace clone and a short-lived, repository-scoped Actions token. Preparation
refuses a private repository; standard public Ubuntu runners are used. Verification has read access only.

Acceptance requires distinct Linux boot-identity digests and overlapping worker intervals, one winner for
one exact board revision, two simultaneous disjoint claims, rejection of overlapping and stale writers,
and an explicit stopped release before another worker receives a higher epoch. Both workers preserve
their fixture's dirty drafts, HEAD and index. The verifier checks the corresponding remote commit states,
source/context/runtime pins, stopped reports and zero remaining tasks. Negative results cannot be promoted
by supplying a success flag. Actor labels and Git history still do not grant execution or release authority.

Hosted images can reuse hostnames. The cloud proof hashes the kernel's per-boot UUID and refuses missing
or malformed identities; it never falls back to a hostname. Standard Ubuntu jobs receive separate VMs.
Sources: [Linux boot identity](https://www.kernel.org/doc/html/v6.9/admin-guide/sysctl/kernel.html#random),
[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The proof uses four synthetic tasks, two workers, a 60-second admission rendezvous, a four-minute worker
protocol deadline, at most 48 observations per phase and the native 15-second Git transport limits.
Mutations are never blindly retried. Jobs have 5/8/5-minute preparation/worker/verification limits;
enrollment is at most 1 MiB plus 16 KiB metadata and peer/final receipts at most 64 KiB each. Enrollment
artifacts expire after one day, proof receipts after seven. No dependency cache is created. The two fixed
remote refs and their history remain retained; these bounds are not a lifetime Git-storage quota.

Successful workers report and archive their own stopped tasks. A failed run preserves unfinished claims
and blocks the next run until explicit reconciliation; cancellation does not imply release. Cloud proofs
are serialized across source branches and do not automatically cancel one another. They validate real
cross-runner Git coordination using synthetic enrollment; access to a user's private workspace requires
separate per-runner enrollment and appropriately scoped credentials. Physical user devices, LLM APIs and
product execution remain outside this proof. Local regression: `node --test __tests__/collaboration-cloud.test.mjs`.
