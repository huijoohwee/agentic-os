---
title: Storage compaction
doc_type: PRD-TAD-ADR-MVP-GTM
owner: agentic-os
continuity_id: STORAGE-001
prd_revision: 1.1.0
tad_revision: 1.1.0
adr_revision: 1.1.0
load_policy: on-demand
---

# Storage compaction

Large collaboration-ledger revisions left as loose Git objects and quarantined dependency installations
can consume GiB in a small product repository. Reduce allocated storage while preserving source, recovery
objects, refs, reflogs, and original quarantine receipts. Existing lifecycle cleanup still owns retirement
and quarantine; storage compaction does not infer integration, retirement or deletion authority.

## Operator workflow

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

## Bounds and recovery

Plans expire after one hour; exact authorization binds their digest. Commands have 20-minute deadlines,
16 MiB output ceilings, and Git uses two compression threads with 128 MiB window memory each (not a
total RSS limit). Object inventory caps at 100,000; filesystem accounting caps at 150,000 entries;
dependency/projection manifests cap at 512 MiB and 25,000 entries and stream file bytes in 64 KiB chunks.
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
