---
title: "Private Workspace Startup"
doc_type: "Runtime Guide"
version: "2.1.1"
date: "2026-09-13"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
---

# Private workspace startup

For opt-in multi-device/provider work admission and compact handoffs, use the lazy
[shared collaboration contract](COLLABORATION.md). It shares coordination metadata, not vendor sessions.

The selected private `huijoohwee/.workspace` repository owns shared context on `main`:

```text
GitHub/.workspace/       one Git repository and remote
  .memory/              curated knowledge; generated indexes stay in .git locally
  .todo/                immutable task records and current Kanban coordination
  .artifacts/           local evidence; only its README is shared in essential publication mode
```

`agentic-os` owns startup composition; each subfolder has one content responsibility.
Hidden names do not establish privacy. Verify repository visibility and keep device credentials,
Git metadata, caches and personal assistant indexes local. Historical references retain their
original identities; new content links use the consolidated source and an exact commit.

## Enroll once per consuming clone

On a new device, clone the one private repository, then enroll from canonical `agentic-os`:

```sh
git clone --branch main https://github.com/huijoohwee/.workspace.git ../.workspace
git config --local agentic-os.workspaceRoot ../.workspace
node bin/agentic-os.mjs workspace
```

Clone only into an absent destination. Do not overwrite existing data or reset dirty work.
Relative enrollment resolves from the canonical worktree; linked lanes share it. Other clones
and devices enroll independently. Forks select their own remote in the protected configuration.
Installed consumers use their installed CLI; the package does not distribute private source
configuration or enroll a clone automatically.

`.agentic-os-workspace.json` uses `agentic-os/workspace/v2`: one exact `remote` and `branch`, plus
three distinct `sources` with `path` values. Memory adds its relative shard `directory`; TODO adds
its contract `entry`. Paths must be real subfolders of the selected clone, without aliases or
nested repositories. Runtime configuration comes from the consumer's exact protected revision;
uncommitted edits and lane-only config cannot redirect startup.

The earlier `workspace/v1` contract remains supported for existing independent source clones.
Migrate those clones explicitly before selecting v2. Do not configure both `agentic-os.workspaceRoot`
and the older standalone `agentic-os.memoryRoot`; standalone memory remains a compatibility mode.
The migration must inventory all dirty, untracked and ignored bytes, retain source Git history,
verify publication and quiesce active writers before removing old paths. A successful startup
observation is not permission to delete a legacy directory.

For the release-to-next-start sequence, use the [pipeline handover](PRD-TAD-ADR-MVP-GTM.md#planning-release-handover).
It reuses the startup receipt and the existing TODO/board owners; local records are shared only after
the owner publication workflow integrates them and the receiving device verifies that revision.

## Startup and resume

`agentic-os start <scope> --write=<paths>` observes enrolled context before lane creation.
On resume run `agentic-os workspace`; `--source=memory|todo|artifacts` selects one responsibility.
`agentic-os memory` selects memory only. `--offline` uses local committed references and the last
validated memory cache, with remote freshness explicitly unknown.

| Source | Startup behavior | Load when relevant |
|---|---|---|
| Memory | Refresh the selected branch; reuse or rebuild the bounded private index | Relevant entry, then cited source blob; [memory contract](MEMORY.md) |
| TODO | Observe revision freshness and the committed contract blob | Exact context record and board row |
| Artifacts | Observe revision freshness without opening artifact bodies | Selected artifact and producer validation receipt |

A full v2 observation validates all selected role trees and the TODO contract at the memory
snapshot revision before atomically publishing its index. Every role in that receipt uses one
source SHA. A missing role or contract preserves the previous accepted index; offline resume
reconstructs every role from that same accepted commit, even when origin/main has advanced.
The index file is an atomic current pointer. Compare its stored source revision with the receipt
before using it; if another refresh advanced it, acquire a new receipt or read the old Git blobs.
Source-specific TODO/artifact observations remain metadata-only and can report update-available.
Memory fetch uses the shared Git repository: a new commit may transfer artifact objects too. Git transport is not a payload budget or sparse clone;
the index itself reads only the configured memory directory. Keep large generated caches local
under source-owned ignore rules. Startup never automatically clones, pushes, merges or rebases.

`current` means the remote branch matched the local tracking ref at observation; it does not
validate dirty files or prove production readiness. `update-available` requires normal source
reconciliation before relying on newer content. Memory reports its separately validated revision
and `ready` or `offline-cache`; consumers must compare receipt revisions before joining sources.
Every observation has `grantsAuthority: false`. Re-read current owners and validation evidence
before effects; context does not replace leases, checks, release approval or payment evidence.

## Concurrent devices and publication

Each device has its own clone and derived index. Consumers sharing one clone serialize workspace
observation; memory hydration also uses the source clone's lock. Contention fails explicitly and
releases owned locks. No polling daemon or background writer is installed. An explicit foreground watch session is
available below; its clone-wide lock is separate from each short observation lock.

Fetch and fast-forward a clean `main` before creating a scoped branch. Preserve dirty files and
divergence; reconcile through normal Git review. Use distinct task/context paths for concurrent
writers; append memory records without rewriting accepted bytes. Required checks and authorized
merge precede cleanup. Startup reads committed context and never adopts uncommitted work.

The adapter loads only for startup/workspace/memory commands. Config is bounded to 4 KiB; local
metadata to 8 KiB per Git read, remote advertisements to 4 KiB and five seconds. Memory fetch has
a 15-second deadline; its corpus, shard and cache bounds remain in the memory guide. No dependency,
new `src/` module or always-loaded context is added.

Continuity `WORKSPACE-STARTUP-001`, PRD/TAD/ADR `2.1.0`: one private collaboration source replaces
three separately synchronized repositories at the operator's request. The existing memory reader
accepts a bounded nested directory; v2 validates one clone identity and distinct role paths, while
v1 preserves its explicit compatibility contract. Source histories and migration receipts stay
at the private owner. `__tests__/workspace-startup.test.mjs` and `startup-memory.test.mjs` verify
startup, scoped retrieval, offline reuse, dirty-byte preservation, remote advances, locks, nested
paths and identity failures. Run `npm run check` for package regression and budget gates.

## Continuous collaboration (WORKSPACE-STARTUP-001@2.1.0)

PRD: active devices discover a published workspace revision within a target of 60 seconds under
healthy connectivity, preserve unfinished local files, and join memory, TODO and artifacts at one SHA.
This is a propagation target after publication, not a guarantee of CI/merge or remote availability.
TAD: reuse the memory fetch/cache and source locks, validate all role references before index
replacement, and read content directly from the receipt's immutable commit. No checkout update is
needed to consume a snapshot. CI composes source-owned planning checks and the bounded checker below.
ADR: Git remains the transport. A Cloudflare notification service would require a new authenticated
endpoint and device connection lifecycle without improving the required 30-second probe interval;
no service, paid capability, dependency or always-loaded context is introduced.

From an enrolled consumer, run a one-shot refresh or a session in its own terminal:

```sh
agentic-os workspace sync
agentic-os workspace watch
```

Watch defaults to a 30-second interval and an eight-hour session, stopping on SIGINT/SIGTERM.
`--interval-ms` accepts 1000–300000; `--duration-ms` accepts 1–43200000. Choose a longer interval
for an idle session. An unchanged remote advertisement reuses the cache without fetching objects.
Only changed revision/config/freshness receipts are printed; no heartbeat files or commits are made.
Offline errors use the accepted cache and exponential backoff capped at five minutes. SIGHUP or
SIGCONT requests a fresh probe immediately after the current bounded operation; otherwise reconnection
is detected on the next probe. Malformed content or lock contention exits explicitly, preserving
accepted data. Stop the existing session before starting another against the same source clone.

`workspace sync --offline` performs no remote request. A missing accepted cache is an explicit error.
The session boundary is the foreground command lifetime; startup does not silently spawn a daemon.

## Workspace CI and publication

The private source workflow pins the harness and planning validator to exact reviewed Git commits.
Keep one read-only Linux validation job with a timeout and per-branch cancellation of superseded
validation. No schedule, write token, model call or automatic artifact upload is required. Required
checks and authorized integration remain publication controls; an observation does not grant them.
If a provider's private-repository plan cannot enforce required checks, report that capability as
unavailable. Keep the repository private and free; verify exact PR checks in the publication client.
Client-side verification does not prevent another writer from bypassing CI with a direct push.

The upstream command reads committed blobs, not dirty files:

```sh
agentic-os workspace check --repository=<workspace-root> --config=<trusted-workspace-json> \
  --base=<full-base-sha> --head=<full-candidate-sha>
```

It validates v2 role roots, the TODO contract blob, the existing bounded memory-log reader, forward
history and accepted memory prefixes. New memory references must be credential-free HTTP(S) URLs
or existing relative Git paths. Remote links are not fetched and their availability is not proven.
Accepted TODO records/import identities are immutable. The existing `.todo` test command separately
validates planning grammar, imported history and the Kanban projection using its pinned website owner.
Both checks must pass: the generic check receipt explicitly labels the remaining owner checks.

The changed-path budget is 512 entries / 64 KiB of Git output; changed role blobs must be regular
files below 500,000 bytes. Without essential publication mode, artifact deletion is rejected. Changed artifact bytes produce an integrity
manifest in the check receipt (commit, path, blob, SHA-256, size). Product-specific manifest semantics,
producer completion and runtime/payment proof still require their existing evaluator. Historical
artifact bodies are not recursively loaded, normalized or retroactively subjected to new size limits.

Without essential publication mode, producers batch completed records/artifacts into a scoped PR. Publish explicit
finalized paths; keep active logs and generated indexes local. A stale base requires reconciliation
and new checks of the resulting exact commit. Concurrent edits to the same memory shard must retain
accepted prefixes and both writers' entries in timestamp order; duplicate IDs fail. Never force-push
or silently select one writer's bytes. The sync session only retrieves accepted context; it does not
stage, commit, push, merge, update working files, or arbitrate ownership. Use the existing repository
publication path and its authority receipts for those effects.

Validation: `workspace-sync.test.mjs` exercises remote publication, coherent offline recovery,
invalid-candidate retention, process termination/lock release and deterministic polling/backoff.
`workspace-check.test.mjs` exercises exact commit checks, dirty-file isolation, immutable records,
reference failures, retained artifacts, symlinks and size bounds. Run `npm run check` before landing.

## Essential publication (WORKSPACE-PUBLICATION-001@1.0.0)

PRD: share only coordination knowledge and minimum workspace configuration; keep logs, screenshots,
builds, archives and runtime evidence on their producing device. TAD: opt in with v2 `publication`
containing `mode: essential` and an exact `files` allowlist. Memory and TODO remain shared trees to
preserve accepted records and their reference closure. Artifact bodies are local-only; a shared README
keeps the artifact role discoverable on a fresh clone. ADR: retain Git and existing sync commands;
use default-deny ignore rules plus an independent committed-tree gate, not sparse checkout alone.

`workspace check` enforces at most 512 shared files, 499999 bytes/file and 5 MB total, rejects local
runtime paths and forced artifact additions, and verifies the generated `.gitignore` exactly. The
trusted harness configuration owns the allowlist; candidate-local config cannot weaken that check.
Generate the ignore text with `workspaceIgnore(config)` from the exported owner module
`bin/agentic-os-workspace-publication.mjs`; consumers retain the resulting projection in `.gitignore`.
The optional policy preserves legacy v1/v2 behavior when absent. No dependency, `src/` module or
always-loaded guidance is added; one on-demand `bin/` module owns publication policy.

For an existing source, `.gitignore` alone is insufficient: untrack excluded paths in a scoped
candidate, without deleting the producer's local files. Retain the original commit/history, inventory
and preservation receipt. Essential mode permits historical artifact removal from the current tree
only after the whole new tree passes the allowlist and budgets; append-only memory and immutable TODO
checks remain unchanged. The check never stages, deletes, rewrites history or proves local preservation.
Do not apply a checkout deletion over active producer data. Other devices must preserve their local
artifact bytes before adopting the migration commit. Use immutable historical GitHub URLs when older
shared records need archived evidence; new artifact bodies are not promised on another device.

Existing history still contains previously published objects. Use `git clone --depth=1` for a new
minimal checkout; an ordinary full clone still downloads old history. No destructive history rewrite
or remote storage-reclamation claim is included. This policy controls future publication, not backup.
