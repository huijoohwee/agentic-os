---
title: Storage recovery and retirement
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: agentic-os
continuity_id: STORAGE-OPERATIONS-001
prd_revision: 1.0.0
tad_revision: 1.0.0
adr_revision: 1.0.0
mvp_revision: 1.0.0
gtm_revision: 1.0.0
version: 1.0.0
date: "2026-10-21"
load_policy: on-demand
lang: en-US
frontmatter_contract: required
local_rung: undocumented
delivered_rung: undocumented
lane: authoring
universal_scope: false
worktree_id: "device-0232231d4a19--cache-storage-economy"
agent_id: codex-storage-cache-economy
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: f25e2b5301291d7f0f168ae452475b4a12021004
---

# Storage recovery and retirement

This companion contains the exact mutation, preservation, and recovery procedures for [Storage](STORAGE.md).

## Native storage operations

### Native retirement and quarantine economy — STORAGE-001@1.9.0

PRD: reduce repeated scans, failed copies and cleanup that merely moves disk cost. TAD/ADR: prioritize
net allocation reduction against total verification/rebuild effort; reuse owners and still-valid receipts.
Distinguish detached residue from native lifecycle projections whose receipts require their original
paths. Archive or relocate only payloads allowed by the retention owner and authorized recovery choice;
keep native projections in place when their owner supports only compression. Preserve immutable evidence
and publish a separate durable recovery locator before removing an authorized former payload. A locator
does not establish native receipt compatibility. Verify required metadata separately: a content/mode/link
manifest alone does not cover ownership, timestamps, xattrs, ACLs or flags; disclose unverified surfaces.
After interruption, follow the owner's resume contract. Manual recovery needs exact authorization and
revalidated archive hash, restore proof, source and journal; an incomplete copy is not reusable. For a
verified pre-swap dependency stage after HEAD movement, a fresh exact plan may continue only when package
source hashes, object alternates, live target and staged manifests still match; it preserves the original
plan and binds the new head/plan in the existing operation. Any partial swap or other drift stays blocked.

MVP acceptance: **AC-S11** reconcile accepted native requests with registry/payload absence and protected
versions/data; **AC-S12** verify detached-payload recovery/locators while preserving path-dependent native
receipts; **AC-S13** check tool capabilities and peak space before copying, then reconcile net allocation
including evidence/staging and exclude prior cleanup; **AC-S14** bind dependency alternates, reject drift and keep Git compaction fail-closed; **AC-S15** resume a verified pre-swap copy after HEAD-only movement under fresh plan, identical lock inputs/manifests, and idle checks; reject other drift. Review these cases against private
artifacts `macintosh-hd-reclaim-20261003` (14.84 GiB selected allocation removed) and
`quarantine-reclaim-20261004` (1.23 GiB net after recovery); keep their final verification receipts.
Archive bytes/modes/links passed; application/provenance restoration remains untested. Local observations
establish no cross-device benchmark or promised saving. Budget: four existing files, under 20 KiB changed,
45 active minutes, zero new modules, dependencies or always-load bytes; measure actual net reclaim separately.
GTM: measure phase/restore costs before another pass; retain eligible warm caches when eviction costs more.
Money/performance gains remain unmeasured. One on-demand guide, under 6 KiB added, zero new modules,
dependencies or always-load bytes. Run `npm run check` and prose/evidence review; publish via RELEASE.
Rollback reverts guidance, preserving effects/recovery. No new deletion API, timer or retention expiry.

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
prepares a copy; the full projection manifest is checked before and after swapping directories.
Files, modes, symlink bytes, authored patches, dependency availability, registration and receipt bytes
remain preserved; filesystem representation alone changes. The planner accepts the exact legacy,
user-cleanup, empty-active-lane-retirement and local-owner eligibility schemas, binding each to its
native coordinate digest. Unknown or mismatched schemas fail closed. No checkout dependencies,
package install, network call, source download or lifecycle script are selected.

For the exact checkout's installed dependencies, stop its development servers, tests, package managers,
and other consumers first, then opt into the separate target kind:

```sh
node bin/agentic-os-storage.mjs plan --repository=/absolute/checkout \
  --kind=worktree-dependencies > /private/checkout-dependency-plan.json
node bin/agentic-os-storage.mjs apply --plan=/private/checkout-dependency-plan.json \
  --authorize=agentic-os:storage:<planDigest> --stopped
```

This target is always the selected checkout's direct `node_modules` directory. Tracked installations, directory aliases
and symlinked package sources are refused. Checkout dependency plans accept one local common-directory
`objects/info/alternates` file, read no-follow with a 64 KiB cap; its digest is rechecked at apply. Changed or missing
bytes block apply. HTTP alternates and `GIT_ALTERNATE_OBJECT_DIRECTORIES` remain unsupported; `kind=git` compaction
rejects alternates. The plan binds HEAD, dependencies and package manifests/lockfiles (including absent files);
source/install drift blocks the swap. It reuses quarantine compression, manifest comparison and recovery journaling.
It removes no packages, optional platform dependencies or authored patches. macOS `lsof` observations before copying,
swapping and discarding the verified original block visible checkout processes and open dependency files, including
from another checkout. Each observation is bounded to 30 seconds and does not prove OS-wide exclusivity; the operator
must keep consumers stopped through completion. Run application executable/package checks after the receipt, then
resume. Re-run only after a material dependency reinstall; a no-saving compression is discarded without replacement.

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

Plans, recovery packs and swap journals live under `.git/agentic-os-storage/<planDigest>/`; original lifecycle
receipts are immutable. Completed replay checks inventory. Unknown partial operations stay retained; inspect
their exact journal and never delete blindly. If a swap left the target absent, `original` retains its bytes;
verify both manifests before restoring or removing either copy. `--resume` with the same unexpired plan
finalizes a fully swapped operation after rechecking its journal, both manifests, package sources/receipt and
idle readers. It may also resume a pre-swap stage only when the directory contains exactly `plan.json` and
`compressed`, the target and sources still match, the staged manifest is exact, and no original or swap journal
exists. It repeats idle and same-volume checks, journals, swaps and runs the existing finalizer without recopying
or discarding the stage. Altered, incomplete, expired or unfamiliar states remain preserved and blocked; missing
copies and partial deletion remain manual recovery. For Git, restore the verified pack/index named in `backup.json`
with writers stopped; saved refs/logs are evidence, never overwrite instructions.

Use fresh plans when loose-object storage grows materially; do not create a timer or compact on every
agent invocation. Keep retired ledger writers retired, reuse the existing coordination store, and
separate transient state from growing full-file Git snapshots. The portable Git operation and optional
macOS filesystem adapter share the existing lock and preservation manifest implementation.

Validation: `node --test __tests__/storage.test.mjs`, then `npm run check`. Real Git fixtures cover
unreachable object retention, recovery packs, stale plans, concurrent locks, partial operations and
replay. macOS fixtures cover compression, original receipt parity, executable modes and symlinks.
Checkout fixtures additionally cover executable invocation, manifest/lockfile/HEAD drift, tracked targets,
aliases, active processes in and outside the checkout, preservation after a refused copy, verified
pre-swap resume, and changed-journal/copy plus active-reader refusals.

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

## Compact recovery inventory — STORAGE-001@1.10.0

PRD: a full read-only recovery inventory can print hundreds of per-operation records even when the
operator needs only the counts and the few records needing follow-up. Reduce terminal, log and agent
context volume while retaining the detailed default for exact inspection. Inventory time and payload
verification remain unchanged; compact output is not a storage-saving claim.

TAD: add `--summary` only to `storage inventory`. Return a separate summary schema with sorted counts
by state, known retained allocation, and at most 32 exact operation details for states other than
`completed-no-payload`. Include the total detail count and a truncation flag. Omit absolute payload
paths and the full operation array. Keep the existing detailed output as the default; `configure`,
plans and applies reject this option. Summary reads the same bounded metadata inventory and opens no
payload content.

```sh
node bin/agentic-os-storage.mjs inventory --repository=/absolute/repository --summary
```

ADR: keep one inventory owner and the existing 2,000-operation bound. Summary results state
`operationsOmitted:true`, `grantsAuthority:false`, and use `knownRetainedAllocatedBytes`; unclassified
records remain explicit details and do not become reclaimable. Operators needing a specific record or
full inventory use the default output. No persistence, automatic cleanup, new module, dependency or
always-load guidance is added.

MVP: **AC-S16** empty and populated inventories produce deterministic compact summaries; exact retained
operation identifiers, states, reasons and known allocation remain visible; output omits the full
operation array; invalid action/flag combinations fail closed. Compare output bytes and elapsed time on
the same current inventory, without claiming scan-time or disk savings. Sprint budget: three existing
files, under 20 KiB changed, zero new modules/dependencies/always-load bytes, one focused check and one
affected repository check.

Observed Graph read-only sample on 2026-10-18 (280 operations, 3 follow-ups): output fell from 57,112
to 1,181 bytes (97.9%). One process run measured 283 ms versus 146 ms; this includes startup and does
not establish scan-time or disk savings.

GTM: use compact output for summaries and handoffs; retain the detailed inventory when a native plan or
restore requires exact record evidence. No storage effect or cleanup decision follows from this flag.

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

