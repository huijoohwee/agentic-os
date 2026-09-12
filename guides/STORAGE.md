---
title: Storage compaction
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: "agentic-os"
continuity_id: "STORAGE-001"
prd_revision: "1.0.1"
tad_revision: "1.0.1"
adr_revision: "1.0.1"
load_policy: on-demand
version: "1.0.1"
date: "2026-09-12"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-cba000d3779d--planning-v27"
agent_id: "codex-01a0940a"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "817c1da8dac21d688d7c531b234482c64ee4340b"
mvp_revision: "1.0.1"
gtm_revision: "1.0.1"
---

# Storage compaction

Large collaboration-ledger revisions left as loose Git objects and quarantined dependency installations
can consume GiB in a small product repository. Reduce allocated storage while preserving source, recovery
objects, refs, reflogs, and original quarantine receipts. Existing lifecycle cleanup still owns retirement
and quarantine; storage compaction does not infer integration, retirement or deletion authority.

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
