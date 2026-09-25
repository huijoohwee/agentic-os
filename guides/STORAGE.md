---
title: Storage compaction
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: "agentic-os"
continuity_id: "STORAGE-001"
prd_revision: "1.4.0"
tad_revision: "1.4.0"
adr_revision: "1.4.0"
load_policy: on-demand
version: "1.4.0"
date: "2026-09-25"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--storage-retention-economy"
agent_id: "codex-storage-retention-economy"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "847c1f8099cc53282135c8d2ddc200b6e099afc7"
mvp_revision: "1.4.0"
gtm_revision: "1.4.0"
---

# Storage compaction

[Shared cache policy](CACHE.md) owns cross-mechanism lifecycle declarations; this guide owns
disk diagnosis, compaction and recoverable effects.

Large collaboration-ledger revisions left as loose Git objects and quarantined dependency installations
can consume GiB in a small product repository. Reduce allocated storage while preserving source, recovery
objects, refs, reflogs, and original quarantine receipts. Existing lifecycle cleanup still owns retirement
and quarantine; storage compaction does not infer integration, retirement or deletion authority.

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
and 200,000 nodes. The deadline includes bounded Git location discovery and is checked between filesystem
calls; a blocked filesystem call cannot be preempted. `cost` records elapsed time, stat/directory calls,
entries and zero content bytes read. No persistent cache is written. Partial results still return JSON
and exit zero; invalid arguments and failed repository resolution exit nonzero.

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
Include peak temporary space and retained evidence; a full-size backup can erase the intended benefit.
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

The local session pilot selected 16 completed root tasks and 1,829 completed subtasks. Native deletion
used 1,750 requests; all 1,417 retained task records and original paths, including three pins, were
verified afterward. Fifteen files under old date directories had recent activity, demonstrating why
folder age was unsuitable. Full backup readback passed; app-level task restoration remains untested.

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

<a id="operator-workflow"></a>

## PRD: operator workflow

Run the packaged `bin/agentic-os-storage.mjs` only on demand. It is not loaded by agent startup, and adds
no dependencies, polling, background worker or recurring job. The operator must have user authorization
and stop writers across the shared clone before applying. `--stopped` records that assertion; the shared
cleanup lock coordinates cooperative callers but cannot exclude uncooperative processes.

```sh
node bin/agentic-os-storage.mjs plan --repository=/absolute/repository --kind=git > /private/git-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/git-plan.json \
  --authorize=agentic-os:storage:<planDigest> --stopped
```

Git compaction first packs and verifies every object, including unreachable objects, into a retained
clone-private recovery pack. It saves refs, logs and worktree metadata, then uses `git repack -a -d
--keep-unreachable`. Full object-ID, ref, reflog and worktree inventories must match before and after;
`git fsck --full --no-dangling` must pass. No branch deletion, history rewrite, reflog expiry, `gc`, or
object pruning is performed. Backup bytes count against net savings and are reported separately.
Stores with at most one pack, fewer than 128 loose objects and less than 8 MiB of loose storage skip
packing. Larger stores first measure the verified candidate pack plus recovery metadata. If retaining
that backup and a similarly sized compact store cannot save space, only the new candidate is discarded;
the source object store remains untouched. Previously committed recovery copies are never removed.
`netBytesReclaimed` subtracts retained backup bytes from target savings; receipt metadata is additional.
These on-demand thresholds prevent small repeated runs from accumulating full recovery copies.

For one completed quarantine on macOS with a compression-capable APFS/HFS+ volume:

```sh
node bin/agentic-os-storage.mjs plan --repository=/absolute/repository \
  --kind=dependencies --quarantine=<exact-64-character-coordinate> > /private/dependency-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/dependency-plan.json \
  --authorize=agentic-os:storage:<planDigest> --stopped
```

Only that quarantine's `projection/node_modules` is eligible. Native `ditto --hfsCompression --noclone`
prepares a copy; the existing streamed preservation manifest must match before swapping directories.
The full projection must still match its original quarantine receipt afterward. Files, modes, symlink
bytes, authored patches, dependency availability, registration and receipt bytes remain preserved;
filesystem representation alone changes. This mode never selects checkout dependencies. Unsupported platforms
refuse this operation; a volume offering no savings leaves the original untouched. No package install,
network call, source download or lifecycle script is needed.

For the exact checkout's installed dependencies, stop its development servers, tests, package managers,
and other consumers first, then opt into the separate target kind:

```sh
node bin/agentic-os-storage.mjs plan --repository=/absolute/checkout \
  --kind=worktree-dependencies > /private/checkout-dependency-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/checkout-dependency-plan.json \
  --authorize=agentic-os:storage:<planDigest> --stopped
```

This target is always the selected checkout's direct `node_modules` directory. Tracked installations,
directory aliases, and symlinked package sources are refused. The plan binds HEAD, dependency content,
and package manifest/lockfile hashes (including absent files); source or installation drift blocks the
swap. It reuses the same compression, manifest comparison and recovery journal as quarantine storage.
No packages, optional platform dependencies or authored patches are removed. macOS `lsof` observations
before copying, before swapping and before discarding the verified original block visible processes
whose working directory is in the checkout or which hold dependency files open, including from another
checkout. Observations are bounded to 30 seconds each and do not prove OS-wide exclusivity; the operator
must keep consumers stopped through completion. Run the application's executable/package checks after
the receipt is returned, then resume development. Run again only after a material dependency reinstall;
an already compressed copy with no saving is discarded without replacing the installation.

Generated-output cleanup is distinct from compression. Remove only exact, idle outputs verified against
their owning generator. An old filename, matching file contents, or an ignored directory alone does not
prove obsolescence. Keep local database state and quarantine/recovery evidence under their existing
retention policy. Source cleanup belongs in its owning scoped lane and must update affected references.

For canonical-sync quarantines, select `--kind=canonical-quarantine` and
`--quarantine=agentic-os-canonical-sync-quarantine-<six-character-suffix>`. This compresses the exact
clone-private recovery directory in place, including source slots and manifests. It recognizes the
source-owned v1/v2 manifest and binds its digest plus the full directory manifest; no recovery slot,
receipt or original manifest is removed or rewritten. This is separate from lifecycle retirement.

<a id="exact-obsolete-artifacts"></a>

## TAD: exact obsolete artifacts

On macOS, archive an explicitly selected untracked directory only after its source owner establishes
that it is obsolete or disposable output. An ignored name alone is insufficient authority.

```sh
node bin/agentic-os-storage.mjs plan --repository=/absolute/repository \
  --kind=artifact-archive --artifact=data/outputs/retired-preview > /private/artifact-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/artifact-plan.json \
  --authorize=agentic-os:storage:<planDigest> --stopped
```

The exact relative directory must have direct ancestors and contain no tracked paths. Root selection,
traversal, `.git`, `.wrangler`, aliases, special files and hardlinks pointing outside the selected tree are refused. A gzip tar archive is
extracted into a private verification directory; the existing streamed manifest compares every file,
mode and symlink. Reobserving the original and checking open files precedes removal. Recovery bytes
and instructions are durable first. There is no glob, recursive discovery, age heuristic, automatic
retention expiry or deletion of existing recovery records. Nested cached repositories are retained
inside the verified archive. Partial archive operations remain for manual recovery; they cannot resume
deletion. A completed replay requires the selected path to remain absent and the checkout HEAD unchanged.

Keep active ingestion stores, local databases and production mirrors with their owners. Fix obsolete
output paths at the owning generator; exclude disposable outputs from Git and regenerate only on demand.
For an installed package, compression preserves its actual bytes; it does not prove those bytes match
the lockfile. Diagnose package drift against the exact locked artifact before any separate repair.

Use `--kind=artifact-compression --artifact=<exact-untracked-directory>` for retained caches or nested
workspace dependencies that must remain available offline. The same selection checks and manifest
apply, but the verified filesystem-compression swap keeps the directory in place. It does not archive
or delete the selected data. Keep its readers and writers stopped through completion.

Internal hardlink groups, including npm's linked executable binaries, must be wholly contained in the
selected tree. Their path topology and link counts are bound and verified after copying. External
hardlinks are refused. Allocated-byte accounting counts each regular-file inode once.

## Bounds and recovery

Plans expire after one hour; exact authorization binds their digest. Commands have 20-minute deadlines,
64 MiB output ceilings, and Git uses two compression threads with 128 MiB window memory each (not a
total RSS limit). Object inventory caps at 500,000; filesystem accounting caps at 150,000 entries;
dependency/projection manifests cap at 4 GiB and 100,000 entries and stream file bytes in 64 KiB chunks.
Git pack verification is quiet; bounded `show-index` output supplies the exact verified object IDs.
These limits belong to storage compaction and do not raise lifecycle cleanup admission ceilings.

Receipts, plans, recovery packs and swap journals are under `.git/agentic-os-storage/<planDigest>/`.
Original lifecycle receipts are immutable. A completed replay checks the preserved inventory; a partial
operation is retained and refused by default. Inspect its journal before recovery. If a dependency swap stopped
with the target absent, the journal's `original` directory retains the exact original bytes. If both
exist, verify both manifests before restoring or removing anything. The original is removed only after
the replacement and full projection have been verified. Do not delete a partial operation blindly.

For a fully swapped dependency operation with both the target and retained original still intact,
`apply --plan=<same-plan> --authorize=agentic-os:storage:<same-digest> --stopped --resume` explicitly
resumes finalization. It revalidates the stored plan, exact swap journal, both manifests, package sources
or quarantine receipt, and idle-process observations before removing the verified original. A transient
Spotlight reader can therefore be allowed to exit before resuming, without another copy or directory swap.
The original one-hour authorization window still applies. Missing/changed copies, partial deletion and
Git recovery remain manual; resume never reconstructs or guesses missing data.

For Git recovery, the retained `backup.json` names a verified pack/index containing every original object;
restore those files to the repository object pack directory with writers stopped. Saved refs/logs and
metadata are historical recovery evidence, not instructions to overwrite newer work.

Use fresh plans when loose-object storage grows materially; do not create a timer or compact on every
agent invocation. Keep retired ledger writers retired, reuse the existing coordination store, and
separate transient state from growing full-file Git snapshots. The portable Git operation and optional
macOS filesystem adapter share the existing lock and preservation manifest implementation.

Validation: `node --test __tests__/storage.test.mjs`, then `npm run check`. Real Git fixtures cover
unreachable object retention, recovery packs, stale plans, concurrent locks, partial operations and
replay. macOS fixtures cover compression, original receipt parity, executable modes and symlinks.
Checkout fixtures additionally cover executable invocation, manifest/lockfile/HEAD drift, tracked targets,
aliases, active processes in and outside the checkout, preservation after a refused copy, and explicit
resume with changed-journal/copy and active-reader refusals.

Additional validation covers no-op growth thresholds, uneconomic candidate disposal, complete archive
restoration, tracked/state/alias/traversal refusals, active readers and changed-source preservation.

Canonical-quarantine, retained-cache compression and internal/external hardlink cases are covered too.

## ADR: shared recovery location

Completed Git recovery packs and artifact archives can be relocated to a private local store. This
extends STORAGE-001 with configurable placement, bounded inventory, immutable provenance records,
exact duplicate reuse and separate restore verification. Existing receipts and incomplete operations
remain in their original clone. There is no automatic expiry, cache eviction or backup service.

Configure each participating clone explicitly; the path is device configuration, never a source default:

```sh
node bin/agentic-os-storage.mjs configure --repository=/absolute/repository \
  --store=/absolute/workspace/.agentic-os-store
node bin/agentic-os-storage.mjs inventory --repository=/absolute/repository
node bin/agentic-os-storage.mjs plan --repository=/absolute/repository \
  --kind=recovery-relocation --operation=<completed-storage-plan-digest> > /private/relocation-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/relocation-plan.json \
  --authorize=agentic-os:storage:<relocation-plan-digest> --stopped
```

`configure` creates an empty private store or reuses its exact descriptor, then writes the clone's
`.git/agentic-os-storage/store.json`. Conflicting existing configuration, directory aliases, public
permissions and unknown contents are refused. A location inside a Git checkout must already be ignored
and contain no tracked files. The workspace publication allowlist remains the owning publication guard.
Store initialization refuses partial or unfamiliar layouts; it does not adopt arbitrary archive folders.

The store contains `store.json`, `payloads/<manifest-digest>`, `records/<record-id>.json`, and `staging/`.
Record identity includes store ID, clone ID and original operation ID. Immutable payloads with exactly
matching streamed manifests share bytes, while each operation retains its independent provenance.
Records preserve original plan/receipt/proof text, source location, content/mode/link manifest, allocated
bytes, verification time and native restore evidence. Recovery retention is always `hold`; age or a
quota cannot authorize deletion. This local store shares the host disk and is not an independent backup.

Relocation uses the existing clone cleanup lock followed by one store lock, with no waiting loop.
`--stopped` asserts that recovery payloads and their receipts have no uncooperative writers. Active
application readers need not stop because installed dependencies and application stores are not targets.
The original payload is removed only after copying, flushing, matching its full manifest, verifying the
native format, publishing a durable catalog record, and rechecking the original evidence and both copies.
Git verification checks the complete packed object-ID inventory, including unreachable objects. Archive
verification extracts into private staging and checks the original artifact's content, modes and links.
Source and store must not contain each other; another filesystem is supported through copy/verify.
Free-space checks reserve payload logical bytes plus artifact extraction bytes and 16 MiB headroom.

Original receipt paths stay immutable. An added `relocation-plan.json` journals the operation and
`relocation.json` points to its completed central record. Inventory and storage receipt replay resolve
the new location. Preserve these pointers and the catalog when backing up; historical absolute paths
in the original receipts are evidence, not current payload locations.

If copying or validation fails, retain staging and the original. A partial copy cannot resume deletion.
If the catalog was published, an explicit `apply --resume` with the same unexpired plan verifies all
bindings again before finalizing removal. A completed replay revalidates the retained payload and does
not create another copy. Unknown, incomplete or corrupt operation records are reported as retained and
unclassified. Inventory is read-only and metadata-based; it does not claim a fresh deep verification.
It bounds discovery to 2,000 operation entries and records to 512,000 bytes. Existing payload, command,
entry and one-hour plan bounds apply. No daemon, startup import, network call or dependency is added.

Restore an independent payload copy into a new directory without overwriting live repository files:

```sh
node bin/agentic-os-storage.mjs plan --repository=/absolute/repository \
  --kind=recovery-restore --operation=<original-storage-plan-digest> \
  --destination=/private/new-recovery-directory > /private/restore-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/restore-plan.json \
  --authorize=agentic-os:storage:<restore-plan-digest> --stopped
```

The destination receives `recovery/` for Git or `artifact.tar.gz` for an archived artifact, together with
its plan, catalog record and verified restore receipt. Native verification runs again; archive extraction
is temporary verification, not installation into a checkout. Restore refuses existing destinations,
store-internal destinations, aliases and changed payloads. A failed restore retains its partial copy;
choose another new directory after diagnosis. Live Git refs, reflogs, packages, databases, pinned offline
data and active graph output roots remain owned by their applications. Recovery records contain enough
manifest and original evidence to support manual recovery if the source clone becomes unavailable;
the command currently requires the original clone and its immutable operation receipts.

Validation: `node --test __tests__/storage-recovery.test.mjs` exercises real Git object retention,
archive extraction, separate restores, exact duplicate reuse across clones, private configuration,
Git publication exclusion, read-only inventory, expiration, locks, interruption/resume and drift refusal.
Use these checks with the original storage suite and `npm run check` before applying to retained data.

## MVP — reference implementation

`STORAGE-001@1.0.1` selects one exact obsolete artifact compacted with recoverable bytes and retained refs. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/storage.test.mjs __tests__/storage-recovery.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `STORAGE-001@1.0.1` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
