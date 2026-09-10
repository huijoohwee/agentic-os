---
title: "Private Workspace Startup"
doc_type: "Runtime Guide"
version: "2.0.0"
date: "2026-09-10"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
---

# Private workspace startup

The selected private `huijoohwee/.workspace` repository owns shared context on `main`:

```text
GitHub/.workspace/       one Git repository and remote
  .memory/              curated knowledge; generated indexes stay in .git locally
  .todo/                immutable task records and current Kanban coordination
  .artifacts/           retained evidence and produced artifacts
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

TODO and artifact observations do not fetch payloads or mutate refs, working files or evidence.
They share one remote advertisement in v2. Memory fetch uses the shared Git repository: a new
commit may transfer artifact objects too. Git transport is not a payload budget or sparse clone;
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
releases owned locks. No polling daemon or background writer is installed.

Fetch and fast-forward a clean `main` before creating a scoped branch. Preserve dirty files and
divergence; reconcile through normal Git review. Use distinct task/context paths for concurrent
writers; append memory records without rewriting accepted bytes. Required checks and authorized
merge precede cleanup. Startup reads committed context and never adopts uncommitted work.

The adapter loads only for startup/workspace/memory commands. Config is bounded to 4 KiB; local
metadata to 8 KiB per Git read, remote advertisements to 4 KiB and five seconds. Memory fetch has
a 15-second deadline; its corpus, shard and cache bounds remain in the memory guide. No dependency,
new `src/` module or always-loaded context is added.

Continuity `WORKSPACE-STARTUP-001`, PRD/TAD/ADR `2.0.0`: one private collaboration source replaces
three separately synchronized repositories at the operator's request. The existing memory reader
accepts a bounded nested directory; v2 validates one clone identity and distinct role paths, while
v1 preserves its explicit compatibility contract. Source histories and migration receipts stay
at the private owner. `__tests__/workspace-startup.test.mjs` and `startup-memory.test.mjs` verify
startup, scoped retrieval, offline reuse, dirty-byte preservation, remote advances, locks, nested
paths and identity failures. Run `npm run check` for package regression and budget gates.
