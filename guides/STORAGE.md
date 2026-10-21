---
title: Storage
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: "agentic-os"
continuity_id: "STORAGE-001"
prd_revision: "1.11.0"
tad_revision: "1.11.0"
adr_revision: "1.11.0"
load_policy: on-demand
version: "1.11.0"
date: "2026-10-21"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--cache-storage-economy"
agent_id: "codex-storage-inventory-summary"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "f25e2b5301291d7f0f168ae452475b4a12021004"
mvp_revision: "1.11.0"
gtm_revision: "1.11.0"
---

# Storage

[Shared cache policy](CACHE.md) owns cross-mechanism lifecycle declarations; this guide owns
disk and cache diagnosis, economical maintenance, compaction and recoverable effects; see
[quarantine triage](STORAGE-QUARANTINE-INVENTORY.md).

Large collaboration-ledger revisions left as loose Git objects and quarantined dependency installations
can consume GiB in a small product repository. Reduce allocated storage while preserving source, recovery
objects, refs, reflogs, and original quarantine receipts. Existing lifecycle cleanup still owns retirement
and quarantine; storage maintenance does not infer integration, retirement or deletion authority.

## Economic maintenance order

Use the shared [cache lifecycle policy](CACHE.md), then start with the cheapest complete observation:
shallow metadata first, one exact deep target only when it changes a decision. Prefer the owning
package or application verifier/garbage collector before manual removal; keep its required cache if
offline rebuild or recovery depends on it. Recheck after material growth, disk pressure or a failed
owner operation, not on a timer or every invocation. Compare allocated bytes before and after, subtract
any retained recovery copy, and include scan, verification, human review and rehydration time.
If ownership or a working restore path is unknown, retain the bytes.

This audit measured npm cache verification at about 968 MiB of allocated reduction in 6.1 seconds.
The same local run's artifact compression saved 24 KiB in 122.9 seconds; do not repeat that operation
on unchanged data. These are host-specific observations, not general performance guarantees.

## Storage diagnosis — STORAGE-001@1.1.0

PRD: distinguish retained archives from live Git objects before recommending expensive maintenance.
The motivating Graph observation on 2026-09-14 measured 34.5 GiB for all of `.git`, of which
34.19 GiB was `agentic-user-authorized-archive`; selected cleanup shared state was 87.1 MiB logical.
The whole-directory size did not establish a cleanup budget failure. These are historical observations,
not savings estimates or current inventories. The operator requested this enhancement; demand and
monetary value remain unmeasured.

TAD/ADR: extend the existing storage CLI with a metadata-only report and one on-demand module.
Shallow discovery is the default. Recursive accounting is explicit, globally bounded and never opens
payload bytes. Reuse the current compaction/relocation owner for effects; reports introduce no alternate
cleanup authorization, retention deletion, timers, caches or dependencies. Existing storage behavior below
is retained. This successor's MVP is diagnosis; verified legacy archive import and deduplication are deferred.

```sh
node bin/agentic-os-storage.mjs report --repository=/absolute/repository
node bin/agentic-os-storage.mjs report --repository=/absolute/repository \
  --deep --category=retained-archives --max-entries=20000 --max-ms=2000
```

The report covers direct children of the resolved Git common directory, including when invoked from a
linked worktree. Categories are `git-objects`, `git-metadata`, `worktree-registrations`, `quarantine`,
`recovery`, `retained-archives`, `agent-state`, and `other`. Names classify storage only; they do not prove
provenance, obsolescence or reclaimability. External recovery stores, checkout dependencies and symlink
targets are outside this report. Use existing recovery `inventory` for catalog provenance.

Without `--deep`, directory rows are `unmeasured`: observed directory allocation is not a recursive size.
With `--category`, that category is scanned first and other directories remain unmeasured. Omit the
category to scan all discovered roots. Incomplete discovery, entry/time/depth limits, mount boundaries,
special files, observed changes or read errors produce explicit partial coverage. Partial byte counts
are observations, not full sizes or consistent-snapshot lower bounds. Even a complete scan is not an
atomic snapshot or content verification. Reports have `grantsAuthority: false` and `reclaimableBytes: null`.

Logical bytes count regular-file and symlink sizes per path; allocation uses filesystem block counts,
deduplicating observed device/inode identities across rows. Shared inodes are charged to the first row
visited. APFS clone sharing/compression and underlying filesystem accounting can make allocation differ
from exclusive physical usage or space freed by deletion. The common directory's own inode is excluded.

Defaults: 2,000 ms, 20,000 visited nodes, at most 256 roots and depth 64. Explicit maxima are 60,000 ms
and 200,000 roots/nodes. `--max-roots` raises root discovery only for an explicit run; the default
remains 256. The deadline includes bounded Git location discovery and is checked between filesystem
calls; a blocked filesystem call cannot be preempted. `cost` records elapsed time, stat/directory calls,
entries and zero content bytes read. No persistent cache is written. Partial results still return JSON
and exit zero; invalid arguments and failed repository resolution exit nonzero.

### Workspace lane-cache inventory and compaction

For the enrolled clone's cumulative immutable lane records, run the read-only owner report:

```sh
node /absolute/path/to/agentic-os/bin/agentic-os-storage.mjs report \
  --repository=/absolute/path/to/agentic-os --lane-cache --deep \
  --max-roots=20000 --max-entries=20000 --max-ms=2000
```

`--lane-cache` resolves the clone's configured workspace root and selects only its exact
`.local/lane-cache/<clone-digest>` directory. The report gives cumulative logical and allocated bytes
for observed files; it does not read payloads or prove a consistent snapshot. `status=partial` means
the total is unknown. Raise explicit bounds only as needed, up to 200,000 roots/nodes and 60 seconds.
The live Git index names current immutable records, but an unreferenced file may still support an
older index revision or recovery; never infer it is disposable or delete it manually.

The record owner has no shard eviction or garbage-collection operation. For an exact in-place
allocation optimization, stop every writer, require a complete report, and use the existing
`artifact-compression` storage owner only when the selected workspace root is a Git repository and
the measured target can produce positive net savings. This owner is macOS-only:

```sh
node /absolute/path/to/agentic-os/bin/agentic-os-storage.mjs plan \
  --repository=/absolute/path/to/workspace-repository --kind=artifact-compression \
  --artifact=.local/lane-cache/<clone-digest> > /private/lane-cache-plan.json
node /absolute/path/to/agentic-os/bin/agentic-os-storage.mjs apply \
  --plan=/private/lane-cache-plan.json --authorize=agentic-os:storage:<plan-digest> --stopped
```

Review that the plan binds the exact reported directory. Apply verifies the full file manifest before
swapping, retains the original through that verification, and removes no lane record. It is supported
only where the existing storage owner supports native compression. Check `contentPreserved`,
`targetBytesReclaimed` and `netBytesReclaimed` in the receipt; stop if the manifest differs or net
savings are zero/negative. This preserves the live byte content at the same path, not a second raw
backup. If a separate recovery copy must remain, count its allocation in net savings; do not compact
when the retained copy erases the benefit. No expiry, timer or automatic cleanup follows.

Acceptance/evidence plan for this successor (PRD → TAD/ADR → MVP):

- **AC-S01:** shallow reports separate archives/objects and leave payloads and repository state untouched.
- **AC-S02:** recursive reports distinguish sparse logical size/allocation, deduplicate hardlinks, exclude
  symlink targets, and mark partial or selected-category coverage explicitly.
- **AC-S03:** discovery/depth/entry bounds, special files, linked worktree resolution and CLI argument
  refusals are exercised by `node --test __tests__/storage-report.test.mjs`; run `npm run check` for
  affected storage/recovery, packaging and repository contracts. CI binds the final committed candidate.

GTM: pilot this command on the existing Graph archive; report actual elapsed time and coverage.
Resource savings and restore correctness are not established by diagnostics. No automatic archive
import, expiry or Git repack follows from the report. Source owners: `bin/agentic-os-storage.mjs`,
`bin/agentic-os-storage-report.mjs`, `__tests__/storage-report.test.mjs`; original retention/protection
contracts remain owned by the existing storage and cleanup modules. This adds one lazy CLI module,
zero runtime dependencies and zero always-loaded documentation bytes.

Pilot evidence (2026-09-14, macOS arm64/Node 24, authoring surface): Graph shallow discovery took
38 ms for 50 nodes; the selected Git-object scan took 79 ms and completed that row (1,050 nodes,
92,872,704 allocated bytes). The archive scan reached its 20,000-node cap in 757 ms and correctly
returned partial coverage. All three read zero payload bytes. These single-run observations are not
cross-device benchmarks or full archive measurements. Local repository check receipts live in the
lane's Git administration directory; PR checks provide revision-bound release evidence.

## Directory triage — STORAGE-001@1.2.0

PRD: the 2026-09-23 local disk recovery found old checkout build output and dependency installs that
the Git-common report cannot show. A whole-workspace recursive scan took minutes among retained
quarantines. The operator needs a cheap first view of an exact directory, followed by one selected
bounded scan, before deciding whether the owning generator can rebuild a target. This is an observed
operator pain; time saved, cash saved, demand and willingness to pay remain unmeasured.

TAD: reuse `storage report` with exactly one of `--repository` (existing Git-common view) or
`--directory` (direct children of an absolute, real, non-aliased directory). The directory view needs
no Git repository and makes no filesystem changes. It classifies direct child names as `dependencies`,
`generated-output`, `git-administration`, `worktrees`, `workspace-state`, `quarantine`, `recovery` or
`other`. A name is a discovery hint, never proof of provenance or disposability. Inspect the workspace
root shallowly, then select a specific checkout or retained directory for the next report:

```sh
node bin/agentic-os-storage.mjs report --directory=/absolute/GitHub
node bin/agentic-os-storage.mjs report --directory=/absolute/GitHub/selected-checkout \
  --deep --category=generated-output --max-entries=20000 --max-ms=2000
```

The existing 2-second/20,000-entry defaults and 60-second/200,000-entry maxima apply across the
whole report; at most 256 direct children and depth 64 are visited. Selected deep scans prioritize
that category and leave other directories unmeasured. Directory aliases, symlink targets and mount
crossings are not traversed. `statfs` reports volume total and available bytes at observation time;
it does not attribute free space to any path. Logical and allocated bytes retain the existing
hardlink accounting and APFS clone caveat. Partial observations never become full size estimates.
The report reads zero payload bytes, writes no cache, and keeps `reclaimableBytes: null` and
`grantsAuthority: false`.

ADR: extend the existing on-demand report and preservation owner, rather than adding a crawler,
timer or eviction policy. No ignored name, age, category or size authorizes removal. The operator
must verify the exact generator or package lock, active readers, source/receipt ownership and
recovery obligations before an effect. Lifecycle quarantines and shared evidence retain their
separate authority. The new view does not compress, archive, prune or delete anything.

MVP acceptance: **AC-S04** — a shallow selected-directory report distinguishes generated output,
dependencies and protected state without reading payloads or mutating entries, and reports volume
availability separately from path sizes. **AC-S05** — an explicit category scan respects the common
entry/time/depth bounds; aliases, mixed root flags and wrong categories fail closed. Verify with
`node --test __tests__/storage-report.test.mjs`, a live shallow workspace pilot, then the affected
repository checks. Source budget: four existing files, at most 15 KiB changed and no dependency or
always-load addition. Rollback reverts the checked source while retaining prior storage receipts.

GTM: use one local shallow workspace report to record actual elapsed time, entries and coverage.
Any future deletion must report observed volume availability before and after its separately
authorized effect. Do not convert directory allocation into expected freed bytes or monetary savings.

## Exact cache triage — STORAGE-001@1.3.0

PRD: the 2026-09-23 local recovery found large old installs and generated caches, while a retained
Terraform state lived beside rebuildable provider binaries. Repeated whole-category scans spend time
on unrelated siblings and blur cache hints with owner data. Give the operator one cheap exact-child
measurement before choosing whether to keep, compress or archive an idle cache. Demand, rebuild time,
physical bytes freed and cash savings are not yet measured.

TAD: extend the existing metadata-only `storage report --directory` with `--name=<direct-child>`.
The exact name bypasses sibling discovery and reports one child; it cannot be combined with
`--repository` or `--category`, and rejects base-directory aliases, traversal, missing names and control characters.
`--deep` scans only that child's tree under the existing entry/time/depth limits. The row can be
complete, while the report remains partial for the parent directory; `selectedChildComplete` states
the selected scope explicitly. No payload bytes, persistent cache or startup work are added.

```sh
node bin/agentic-os-storage.mjs report --directory=/absolute/checkout
node bin/agentic-os-storage.mjs report --directory=/absolute/checkout \
  --deep --name=.cache --max-entries=20000 --max-ms=2000
```

ADR: classify `cache`, `.cache`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`,
`.parcel-cache`, `.vite` and `.turbo` as cache **name hints**; `.venv` and `node_modules` as
dependencies. `.terraform` remains `other` because it can contain backend metadata beside providers.
Nested caches can be selected by making their parent the `--directory`. A category, ignore rule, age
or measured size never proves rebuildability or authorizes removal. Check the owning tool and lockfile,
active readers, offline restore need and measured rebuild cost. Use the existing exact
`artifact-compression` plan when bytes must stay online, or `artifact-archive` only when the owner
establishes the selected untracked output is obsolete. Both retain separate authorization, stopped
writer, manifest and recovery receipts; no automatic eviction, timer or wildcard sweep is added.

MVP: **AC-S06** exact-child scans avoid sibling traversal even beyond the 256-root discovery cap,
read zero payload bytes and mark parent coverage partial without presenting selected bytes as
reclaimable. **AC-S07** unsafe names, mixed scopes and category/name combinations fail closed;
`.terraform` is not treated as a cache. Verify with `node --test __tests__/storage-report.test.mjs`
and `npm run check`. Source cap: four existing files, under 15 KiB changed, zero dependencies and
zero always-load bytes. Time to a source candidate: one bounded local sprint; provider checks and
protected merge are separate waits. Rollback reverts this report extension without changing
existing storage receipts.

GTM: pilot one exact cache report and compare elapsed time, visited entries and filesystem
availability with the prior shallow view. Do not claim speedup, resource or monetary savings from
one observation, or infer deletion savings from allocated size on APFS. A 2026-09-23 local pilot on
Graph Canvas `.vite` scanned 1,691 entries in 67 ms with zero payload bytes read; the selected row
completed, its parent coverage stayed partial, and it granted no cleanup authority. These are
single-run diagnostic observations, not a benchmark or an eviction receipt.

## Retiring development data — STORAGE-001@1.4.0

PRD: the 2026-09-25 home-directory cleanup encountered generated caches, virtual-machine disks,
simulator data and task history with different recovery obligations. Large size and old directory
dates were insufficient selection rules. The operator needs exact eligibility, an affordable recovery
choice and measured net benefit before removing state. This successor documents the observed workflow;
it adds no deletion command or automatic retention policy. Shared cache lifecycle remains in [CACHE.md](CACHE.md).

### TAD: classify and select through the owner

| Data class | Evidence needed before choosing an effect |
|---|---|
| Generated cache or installed dependency | Owning generator, locked inputs, active consumers, offline need and rebuild cost; preserve authored files mixed into the directory. |
| VM, container or simulator store | Exact instance and disk/volume inventory; distinguish downloadable tooling from unique local images, databases, app/test data and settings. |
| Task history and session records | Latest activity, whole-task completion, live/queued work, pins, attachments, required evidence and all records affected by cascading deletion. |
| Recovery, quarantine or lifecycle evidence | Existing retention owner and receipt; recovery retention stays on hold until separately authorized. |

Start with shallow metadata and one exact bounded scan using the report limits above. Record partial
coverage and unknown ownership explicitly. Select exact paths or native IDs; never turn a directory
name, ignored status, age, stopped process or matching bytes into disposal authority. Recreating a
toolchain or an empty virtual device does not restore its unique data. Bind explicit discard authority
to that loss when no recoverable copy will remain; a small metadata inventory is not a data backup.

Use the owning application's supported deletion/retirement interface and verify the installed tool
version and cascade semantics. Keep native metadata and files consistent; do not unlink registered
history files, edit live databases or vacuum them as an incidental cleanup step. When the native owner
is unavailable, a filesystem fallback needs its own exact scope, understood effects, recovery/discard
decision and authorized plan. Lack of a native command alone does not establish those conditions.

Native dry runs can refresh metadata or use the network; inspect installed-version behavior and include
that cost. Bind selected targets and retained versions, rejecting scope drift before execution. An
accepted asynchronous request remains pending until native records and backing payloads reconcile.
Journal it once; reobserve within a bounded deadline. On timeout preserve pending status and diagnose
through the owner; do not duplicate an unresolved deletion request.

For history retention, an operator-selected cutoff such as seven days is only a candidate filter.
Use the latest relevant record/file activity plus live application state; creation dates and date-folder
names are insufficient. A completed turn does not prove the task's objective is complete. Reconcile
the app's pin/active state with backend records; one database may omit pins or loaded tasks. Preserve
recent, active, pinned, queued, unfinished, blocked and uncertain work, their dependent descendants,
and history needed by retained work. Review final outcomes for unresolved decisions and evidence needs.
Before a cascading parent deletion, prove that every affected descendant is independently eligible;
retain the parent when any member is protected. Unregistered or unclassified files remain unselected.

Bind the plan to exact paths/IDs, source identities, activity cutoff, retention exclusions, owner/tool
version, cascade closure and recovery choice. Recheck these before each effect, including path aliases,
symlinks, mount boundaries, visible readers/writers and newly active work. Stop on drift or uncertain
outcomes; journal completed effects and reconcile native state before retrying. Process/open-file
observations are snapshots, so keep the selected consumers stopped or use owner-enforced exclusion
through completion. They cannot prove operating-system-wide exclusion of future writers.

### Recovery and economical execution

Choose retention, supported in-place compression, verified export followed by retirement, or explicit
discard according to the data owner and actual need. When recovery is selected, retain its bytes and
metadata before destructive effects, in private storage with an exact manifest and restore instructions.
Read every retained payload back and verify its source hash; verify modes, links and native format
where required for restoration. Reobserve the source after copying. A valid archive, image-blob closure
or transcript hash proves only that verification surface. Record application import, VM boot and task
resume as separate tested/untested outcomes. Extract to a new private location for verification;
never overwrite newer live state as a restore shortcut. A same-disk copy is not independent backup.

Budget discovery, backup, verification, native deletion and likely rebuild/restore before execution.
Before bulk copying, reuse valid installed-tool/API capability proof; test unknown or changed capabilities
on a disposable fixture. Budget source, archive, independent extraction and metadata together. Retain
the source if measured net savings do not justify verification, storage and restore cost.
Use a small, already-authorized batch to measure native request throughput before committing to a
long pass. Estimate remaining duration from that observation and state uncertainty. Set operation,
entry, read/output-byte and concurrency limits; a longer owner operation needs its own bounded plan
and checkpoints. The compaction command deadlines below still apply to those commands unchanged.

Reuse one compatible native process when supported, stream bounded chunks, and start compression with
one worker. Increase concurrency only for independent targets when the owner permits it and a bounded
measurement shows a benefit. Avoid repeated whole-home scans, process startup per record and model
calls for mechanical deletion. Reuse verified inventories while their bindings remain valid; refresh
on drift. At a budget boundary, preserve the journal and completed receipts, then replan remaining
work without bypassing preservation checks. No timer, global TTL or automatic recovery expiry follows.

Report source logical bytes, target allocation removed, retained recovery/evidence allocation and
net allocation reduction separately. Net reduction subtracts newly retained recovery, metadata and
staging from removed allocation. Record observed volume availability before backup and after completion,
with timestamps and elapsed time per phase. APFS sharing and concurrent work prevent attributing every
free-space change to the selected paths. Report missing CPU, I/O, rebuild and monetary costs as unknown.
Verify selected native records and paths are absent and protected records and paths remain present;
command success alone is insufficient. Keep exact manifests, authority and receipts private with the owner.

ADR: retain the existing storage, cache and application owners. This guide supplies operator decisions;
it introduces no generic session cleaner, database writer, additional manifest schema or scheduler.
Rollback of this documentation change reverts its source only; completed deletion and retained recovery
continue under their original receipts. [Native session history](prd-tad-adr-mvp-gtm-session-history.md)
owns product history/indexing design; this local retirement observation does not establish its acceptance.

### MVP and GTM: evidence and handover

The session pilot selected 16 completed roots and 1,829 subtasks; native deletion used 1,750 requests.
All 1,417 retained records/paths, including three pins, were verified. Fifteen files in old folders had
recent activity: folder age was unsuitable. Backup readback passed; app-level restoration is untested.

| Session pilot observation (2026-09-25, one macOS host) | Result |
|---|---:|
| Removed file allocation / retained archive and evidence | 7.16 GiB / 2.99 GiB |
| Net allocation reduction / observed available-space change | 4.17 GiB / 3.85 GiB |
| Backup and full readback | 25.83 seconds |
| Final serial native pass, 1,709 requests | 1,656.70 seconds |

Private evidence is retained in the workspace artifact `codex-session-retirement-20260925`:
`REPORT.md`, `final-verification.json`, `backup-verification.json` and per-effect receipts. The final
pass excludes earlier batches and discovery; it is not total operator time. A four-request concurrency
trial showed no observed improvement and was discontinued. These are historical observations, not
cross-device benchmarks, application recovery proof or cash savings.

MVP acceptance for this documentation successor: **AC-S08** review the selection rules against the
cases of recent activity in old folders, separately stored pins and protected descendants; **AC-S09** distinguish explicit
discard, byte recovery and application restoration; **AC-S10** reconcile gross, retained, net and volume
figures with the private receipts and include execution cost. These prose/evidence checks are covered
by the observations above; run `npm run check` for affected repository contracts before publication.
This is one existing on-demand document, under 15 KiB changed, zero new modules/dependencies or
always-load bytes. Source handoff targets a 15-minute local sprint; provider checks/merge are separate.
Publish through [RELEASE](../docs/RELEASE-WORKFLOW.md); exact merge and closeout retain their own receipts.
Development evidence here is the documentation and historical pilot; source checks do not certify
new deletion automation, consumer compliance or production/runtime delivery. No browser preview applies.

GTM: reuse the free local workflow for the next authorized cleanup, measuring net space gained and total
active/machine time, including recovery and rebuild. Prefer the smallest eligible target whose benefit
justifies that cost. Demand, willingness to pay, support cost and monetary savings remain unmeasured.

See [Storage recovery and retirement](STORAGE-RECOVERY.md) for the exact retirement, preservation and recovery procedures.

## Local artifact cache triage — STORAGE-001@1.11.0

PRD: reduce oversized local artifacts at low measurement cost without losing Graph-owned evidence.
Run a content-free exact-child report first; scope any later history comparison to that selected child.

```sh
node /absolute/path/to/agentic-os/bin/agentic-os-storage.mjs report \
  --directory=/absolute/workspace/.workspace/.artifacts --deep \
  --name=<exact-child> --max-entries=100000 --max-ms=15000
```

Use `selectedChildComplete` and the selected row's `status` for coverage; top-level `status=partial`
is expected when siblings were not selected. Record logical/allocated bytes, elapsed time, visited
entries and `contentBytesRead`. This report grants no authority or reclaimable-byte estimate. Begin
with default bounds and raise them only for that child; rerun after material changes, not on every
invocation. A local 2026-10-21 report covered 45,913 entries in 561 ms, observed 657,522,771 logical
and 488,681,472 allocated bytes, and read zero content bytes.
The full local artifact-root pass covered 88,605 entries in 2,474 ms and observed 1,755,042,686 logical
and 1,146,216,448 allocated bytes, with zero content bytes read. This is filesystem allocation, not
exclusive physical use or expected deletion savings.

An exact match to a locally reachable Git blob proves byte recovery from that object database only;
it does not prove the current path is obsolete or that its owner permits deletion. Hash only a
selected target when it changes an owner-approved recovery decision. A one-time broader survey took
18.6 seconds to hash 79,308 files (1,755,025,388 bytes), finding 1,442 matches (211,779,584 allocated
bytes). Existing artifact policy preserves records, so history matches alone are never deletion
candidates. If an owner explicitly approves a retirement, bind it to the exact manifest digest and
listed paths; retain that manifest, plan, per-file journal and effect receipt under
`.git/agentic-os-storage/<planDigest>/`. Approval does not carry to a later manifest or authorize Git
object pruning. Do not repeat the full scan while inputs and refs are unchanged. Hashing, allocated
size and local history do not establish independent backup or physical space savings.

One owner-approved retirement on 2026-10-21 unlinked 1,442 exact paths (283,734,034 logical bytes;
211,783,680 allocated bytes) after approval of manifest
`16d72202432a16d8bbc5d2a96f4a74e87ec7c36e858d372e60d3ad9a0e2b78ea`. The complete artifact-root
report observed allocated bytes drop from 1,146,216,448 to 934,432,768; `statfs` available bytes
rose by 193,130,496 during the same interval. These are observed values, not isolated causal savings.
Plan issuance through final receipt took 67 seconds, including reconciliation; the operation read
567,468,068 content bytes for two exact verification passes. The zero-content metadata reports took
4,818 ms before and 1,240 ms after. These are execution measurements, not performance guarantees.
The durable receipt is `.git/agentic-os-storage/a2e096975b522dad70d30590ca13c2106a19b0fb34219bbc90abe1bdf85f4d39`.

A follow-up in-place compression on the remaining largest child,
`.artifacts/agent-observability-economy-20260916`, preserved its 44,966-entry, 379,442,549-byte
manifest (`3abaee99a92a5f4f1b6d7b02958ac35400f76c6dc4a25cccc9c76f9bef0a9028`) and reclaimed only
24,576 allocated bytes from 283,254,784 (<0.01%) in 122.9 seconds from plan issue through receipt.
The post-operation exact-child metadata report took 345 ms, visited 44,966 entries and read zero
content bytes. A complete artifact-root metadata pass then observed 87,163 entries, 1,471,308,732
logical bytes and 934,408,192 allocated bytes in 2,179 ms, also reading zero content bytes. The
receipt is `.git/agentic-os-storage/241df790267c6d1c072ea8f12d4244460d96d76cd86aa47e26401ec87f369633/receipt.json`.
Do not repeat compression on unchanged contents; only reconsider after material new uncompressed
data arrives. For larger savings, fix the owning generator or pursue a separately approved exact
retirement after confirming its recovery path. Both reports are observations without snapshot consistency.

### Remaining local state audit — 2026-10-21

The next largest paths are not interchangeable cache candidates. Before the exact retirement below,
`.git/agentic-os-cleanup-quarantine` accounted for 115,609,600 allocated bytes across 14,397 visited
entries (81,012,550 logical bytes). Its largest exact coordinate accounted for 8,534,133 logical and
10,059,776 allocated bytes across 753 entries. That recovery branch tip was not in local `main`, and
the quarantined worktree's Git pointer no longer resolved after its original worktree was removed.

After explicit owner approval, retirement plan `e0c48e7c0af1023d4e613611bd4b2943dad487f03c078579312a6783d699827e`
removed only coordinate `2a8cfe25b720eb5f0b437e663f535b1e2d3f28dc53b0c5f120057f398da1a732`.
Its receipt records 8,458,243 logical bytes unlinked, recovery bytes discarded, registration retained,
and no branch-ref or object-database mutation. `du -sk` observed the quarantine directory fall from
112,900 KiB to 103,180 KiB (9,953,280 fewer allocated bytes); this does not prove physical free-space
increase. Available volume space was lower at the later observation. The durable receipt is
`.git/agentic-os-cleanup-quarantine/2a8cfe25b720eb5f0b437e663f535b1e2d3f28dc53b0c5f120057f398da1a732/retirement.json`.

The next largest projection was coordinate
`5741fa0ac15897a5ea051967f7e7baa8511c83ff077c3814a00b1579f1204fb8`: 8,444,465 logical bytes,
751 entries and 9,820 KiB allocated. Its branch existed in local and remote-tracking refs but was not
an ancestor of local `main`. After separate explicit owner approval, plan
`12e83bee7f8cea54d1c210e456a57abe637d1dd3c7cb4d0ae8b7e318119b6e82` retired only that coordinate.
Its receipt confirms registration and branch refs retained and no object-database mutation. `du -sk`
observed the quarantine directory fall from 103,180 KiB to 93,468 KiB (9,945,088 fewer allocated
bytes); physical free-space increase is not proven. The receipt is
`.git/agentic-os-cleanup-quarantine/5741fa0ac15897a5ea051967f7e7baa8511c83ff077c3814a00b1579f1204fb8/retirement.json`.

After separate explicit owner approval, plan
`8adda321b8a49bc5b8f8c9c6a7887ae2b2f063cfdab2ba00066d5901173ffd2b` retired only coordinate
`8ce65881c0dedcfdaffe2b4d5a2d1c65754e10d7ca27d0afabf6e6816b74b929`. The bound projection had
digest `c3042324541e0c8abad221ef245083d8428bfcca592f2938309f2259b67ceca5`, 748 entries and
8,343,472 logical bytes; `du -sk` measured its projection at 9,708 KiB before retirement. The receipt
records those logical bytes unlinked, recovery data discarded, registration and branch refs retained,
and no object-database mutation. `du -sk` observed the quarantine root fall from 93,468 to 83,868 KiB
(9,600 KiB less); this does not prove physical free-space increase. The receipt is
`.git/agentic-os-cleanup-quarantine/8ce65881c0dedcfdaffe2b4d5a2d1c65754e10d7ca27d0afabf6e6816b74b929/retirement.json`.

After separate explicit owner approval, plan
`b5953953da3970457bb3ba5ee126b4911cffd2467be083de64211ac2f0a1eda9` retired only coordinate
`5636396a8c4ed78c562276f1526f734f190a75a92aee31c79dfcba1cea3d5fc1`. The bound projection had
digest `32797649b89f3535fa32b3ba3cb9a8ccbb2919698ebaf17a4c1260f910f1ef48`, 748 entries and
8,314,312 logical bytes; `du -sk` measured it at 9,572 KiB before retirement. The receipt records
recovery data discarded, registration and branch refs retained, and no object-database mutation.
`du -sk` observed the quarantine root fall from 83,868 to 74,300 KiB (9,568 KiB less); physical free
space increase remains unproven. The receipt is
`.git/agentic-os-cleanup-quarantine/5636396a8c4ed78c562276f1526f734f190a75a92aee31c79dfcba1cea3d5fc1/retirement.json`.

Two larger remaining projections, coordinates `4b73b84c47d82b1ec6f4a70ce06e8c1ea1a56ac6e48000dbbaebeac944d505f6`
and `683477102aa12521e6348bece7fafd49628b303dd937330d04205c07d9d224c5`, measured 9,132 KiB and
8,676 KiB allocated respectively. The exact retirement planner refused both with
`retirement-evidence`: each detached registration's `HEAD` log records only its initial commit and
does not bind a lane ref. The first projection manifest is `f19470840fd3f04c0ff43898d2af1f727c29c020d08bb2ebdbba621679850ab8`
(735 entries, 7,897,102 logical bytes); its detached HEAD is `3846c48dba4b40702451640e3e78e6bcc91408f4`.
The second manifest is `59e8fcf4ab18cb667ae11a4923cd894851e70086c0f57c73c54cab36772155d4`
(713 entries, 7,478,179 logical bytes); its detached HEAD is `1d3e803f9c28c33ab41f3bf6755e760426e1c956`.
Their operation records contain no branch field, and 375 and 528 local/remote refs respectively
contain those commits. The old checkout path names are hints only. Without an authoritative record
binding a lane ref to each projection, the tool cannot prove which branch owns it. A fresh fetch showed
both detached HEAD commits are ancestors of `origin/main` at `1e9c972bc0ffc85dff0e528792b8a2ba0610485f`.
For each projection, the retained index exactly matches its detached HEAD tree, the projection matches
that index, and Git reports no untracked or ignored files. Thus no working-tree file changes outside
those committed trees were observed. The old checkout directories are absent and neither appears in
`git worktree list`. Even from the clean canonical `main`, the exact retirement planner still refuses
both coordinates with `retirement-evidence`: the detached HEAD logs do not bind a lane ref. Keep both
intact; do not infer source-lane ownership from commit ancestry or path names, and do not bypass the
owner planner. Resume only if the owner supplies verifiable source registration evidence or the owner
adds a reviewed merged-snapshot retirement path, then generate a fresh exact plan and obtain separate
approval. Four approved retirements unlinked 33,560,492 logical bytes total; the quarantine root's measured allocation
fell from 112,900 to 74,300 KiB. This cumulative local observation does not establish volume-level free space.

A complete metadata-only report of the canonical repository covered 26,052 entries in 768 ms,
observed 869,036,032 allocated bytes and read no content. It found no cache or generated-output
category. A name-targeted scan found no `.cache`, `__pycache__`, test-cache or bundler-cache paths;
the only dependency directory found was `node_modules` at 4,644,864 allocated bytes across 1,145
entries. Keep it for offline use: removing it offers less than 5 MB and would require a verified
locked reinstall before builds or checks can run.

The configured npm cache was a larger, separate local target. Before maintenance, `/Users/huijoohwee/.npm/_cacache`
used 3,037,060 KiB allocated. `npm cache verify` ran offline in 6.115 seconds, verified 2,818 content
entries (2,074,524,477 bytes), collected 323 garbage entries (1,008,884,486 logical bytes), and
checked 3,483 index entries. Afterward, `_cacache` used 2,045,412 KiB, an observed allocation drop
of 991,648 KiB; the whole `.npm` directory dropped from 3,898,048 to 2,906,396 KiB. Retain the
verified remaining cache for offline installs. This used npm's integrity-checking garbage collector,
not a full cache clean; [npm documents `cache verify`](https://docs.npmjs.com/cli-commands/cache.html)
as usable offline and as collecting unneeded data. These local size samples do not guarantee a
volume-level free-space increase.

`.git/agentic-runtime/models` accounts for 639,447,040 allocated bytes for one local GGUF model.
The runtime docs treat model provisioning as optional and do not establish an automatic or offline
rehydration path. Preserve this model for local/offline use until its owner identifies a verified
replacement or explicitly approves losing it. Do not read or compress the full model merely to test
for savings while that recovery requirement remains unresolved; first establish an owner-approved
replacement and a worthwhile expected gain.

The repository's Git object directory accounts for 10,932,224 allocated bytes; `git count-objects -v`
reports 355 loose objects, three packs, zero prune-packable objects and zero garbage. Git pruning has
no measured target here, and repacking this small store would add work without a demonstrated material
gain. The enclosing `Documents/GitHub/.workspace` repository's object directory accounts for
247,177,216 allocated bytes across four packs, with 10 loose objects and zero prune-packable objects
or garbage. Its storage is workspace state; the count shows no unreachable-object cleanup target.
Repacking could consolidate packs, but the existing safe path retains a full recovery pack, so first
measure a material reason to expect savings. Recheck only after material object growth. These findings
are local observations, not new retention policy or deletion authority.

MVP: **AC-S17** exact-child triage reports bounded metadata, zero content bytes and explicit coverage;
history matches never imply disposal. Reuse the existing report command, with no index, cache, module,
dependency, timer or always-load addition. Compare elapsed time, visited entries and content bytes;
the samples above are local observations, not promised performance or savings.

See [Storage recovery and retirement](STORAGE-RECOVERY.md) for the exact retirement, preservation and recovery procedures.

## MVP — reference implementation

`STORAGE-001@1.0.1` selects one exact obsolete artifact compacted with recoverable bytes and retained refs. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/storage.test.mjs __tests__/storage-recovery.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `STORAGE-001@1.0.1` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
