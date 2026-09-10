---
title: "Private Workspace Startup"
doc_type: "Runtime Guide"
version: "1.0.0"
date: "2026-09-10"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
---

# Private workspace startup

`.workspace` is a local container for three independent private Git repositories:

```text
.workspace/             local directory, not a Git repository
  .memory/              curated shared knowledge; derived indexes stay local
  .todo/                immutable task records and current Kanban coordination
  .artifacts/           retained evidence and produced artifacts
```

Each source keeps its own remote, branch, history, permissions and publication workflow.
`agentic-os` owns startup composition, not these repositories' content or product effect authority.
Hidden names do not establish privacy: select private repositories and retain device credentials locally.
Physical clones and explicit directory aliases are supported. On the current device, these three
entries are aliases to the existing sibling clones, preserving active artifact paths and every byte.
New devices may clone directly into the container. There is no enclosing Git monorepo or submodule.

## Enroll once per consuming clone

Create the container and clone only missing sources into the selected paths. Do not replace an
existing directory, move an active writer, or reset a checkout to obtain a clean startup.
From the canonical `agentic-os` checkout, the usual layout is:

```sh
mkdir -p ../.workspace
git clone --branch main https://github.com/huijoohwee/.memory.git ../.workspace/.memory
git clone --branch main https://github.com/huijoohwee/.todo.git ../.workspace/.todo
git clone --branch main https://github.com/huijoohwee/.artifacts.git ../.workspace/.artifacts
git config --local agentic-os.workspaceRoot ../.workspace
node bin/agentic-os.mjs workspace
```

Run each clone command only when its destination is absent. On an existing installation, an
explicit symlink to the already selected clone provides the same layout without copying its data.
An absolute container path is accepted. Relative paths resolve from the canonical worktree;
linked lanes share enrollment while other clones/devices configure their own location.
Forks commit their own `.agentic-os-workspace.json` source identities on their protected branch.
Installed consumers use their installed `agentic-os` CLI; package installation does not enroll them
or distribute this repository's private-source configuration.

The protected configuration owns source paths, exact remote transports and branches. Memory adds
its selected shard directory; TODO adds its contract entry path. There is one config owner for
workspace enrollment. The older standalone memory mode remains available to its existing consumers;
do not configure both `agentic-os.workspaceRoot` and `agentic-os.memoryRoot`. To migrate an enrolled
standalone clone, remove the latter key, then select the workspace root. Configuration edits in
an uncommitted checkout or a lane cannot redirect a protected startup operation.

## Startup, resume and on-demand retrieval

`agentic-os start <scope> --write=<paths>` observes the enrolled workspace before lane creation.
On resume, run `agentic-os workspace`; `--source=memory|todo|artifacts` selects just one source.
`agentic-os memory` is the memory-only entry point for either enrollment mode.
`--offline` reads available local committed references and the last validated memory index.

| Source | Startup behavior | Load when relevant |
|---|---|---|
| Memory | Refresh the selected Git branch and reuse/rebuild its bounded private index | Relevant scope/summary, then the cited source blob; [memory contract](MEMORY.md) |
| TODO | Check source identity, local committed revision, remote branch and contract blob identity | Exact TODO Context and board row from that source revision |
| Artifacts | Check source identity and local/remote branch revisions | A specifically selected artifact and its producer's validation receipt |

TODO/artifact observation never fetches payloads, changes Git refs, reads the working tree, pushes,
merges, or rewrites evidence. `current` means the advertised branch matched the cached local ref
at observation; it says nothing about dirty local files, record validity or production readiness.
`update-available` identifies a newer/different remote revision without treating local content as
fresh. Use that source's normal Git workflow to fetch/reconcile it before relying on newer content.
`offline-local` means remote freshness is unknown. The memory adapter separately reports
`ready` or `offline-cache`; its snapshot freshness and append checks are described in its guide.

A workspace receipt contains roots, source/config revisions and retrieval pointers, without task
or artifact bodies. Re-read the selected owner and its current validation evidence before taking
action. The TODO owner runs actual corpus/board checks; public website CI uses synthetic records.
An observation has `grantsAuthority: false`; source discovery never replaces claims, protected
checks, release authorization, payment evidence or a producer's artifact validation.

## Concurrency and budgets

Source identities and distinct clone roots are checked before memory hydration. A source mismatch,
missing selected clone or malformed config fails before an enrolled start provisions its lane.
Source-specific requests do not inspect unrelated roots. Existing dirty work stays where its writer
owns it. Consumers sharing one clone serialize workspace observation; the memory source has its
own clone-wide lock for consumers in different repositories. Contention fails explicitly and releases
owned locks; retry after the holder finishes. There is no polling daemon or background writer.

The adapter loads only for startup/workspace/memory commands. Configuration is capped at 4 KiB,
local metadata output at 8 KiB per Git read and remote advertisements at 4 KiB. Each TODO/artifact
remote read has a five-second deadline and memory fetch has its existing 15-second deadline.
No payload scan, embedding, new dependency, new `src/` module or bulk always-loaded context is added.
For disconnected use, request `--offline` and retain the explicit freshness labels.

Continuity `WORKSPACE-STARTUP-001`, PRD/TAD/ADR `1.0.0`: an operator resolves shared context through
one enrollment; the CLI composes existing memory and Git observations; independent source ownership
and lazy retrieval are selected over a combined repository or eager artifact synchronization.
Validation: `__tests__/workspace-startup.test.mjs` exercises enrolled startup/resume, aliases, isolated
source requests, remote advance reporting, dirty-byte preservation, identity/config failures and
lock recovery. Run `npm run check` for the complete package and budget gates.
