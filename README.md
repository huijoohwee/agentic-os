---
title: "Agentic OS"
doc_type: "Index"
version: "1.0.1"
date: "2026-09-23"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
---

# agentic-os

The Agent Development Lifecycle (ADLC) harness: a clonable workspace for multi-worktree, multi-agent
development that lands work on a canonical branch. Node.js 20.11+, Git, npm; zero runtime dependencies.

This page is the repository entry point and routes to owners. It defines no requirement, design, or
decision of its own — each one lives with the owner named below.

## Install and verify

```sh
git clone https://github.com/huijoohwee/agentic-os.git
cd agentic-os
npm install
npm run setup     # select packaged hooks; refuses to clobber an existing hook manager
npm run doctor    # report harness and remote drift, change nothing
npm run check     # affected behavior and packaging, plus readiness, doc and module budgets
```

Commit the repository's `.agentic-os.json` profile before any repository-bound command.
Forking under a different owner starts at the [fork guide](guides/FORK.md).

## Daily loop

```sh
npm run release:common --help                                  # the full operator flow
npm run release:common -- start <scope> --write=<path[,path...]>
npm run release:common -- publish --message="feat: ..."
npm run release:common -- complete --ref=<lane>               # wait for merge, then close and retire the lane when local evidence is sufficient
npm run release:common -- complete --ref=<lane> --bundle=<json> --stopped
```

`complete` without a bundle now uses the exact local merged-review and required-check evidence to
quarantine the retained lane when the profile-governed local cleanup path is sufficient. Use
`--bundle` and `--stopped` when the exact authenticated cleanup plan is required instead.

`npm run status`, `npm run reap`, and `agentic-os completion status --ref=<lane>` are the read-only
diagnostics. [START-WORKFLOW](docs/START-WORKFLOW.md), [RELEASE-WORKFLOW](docs/RELEASE-WORKFLOW.md),
and the [deploy workflow](guides/DEPLOY-WORKFLOW.md) are the SSOT for the universal lifecycle grammar;
cleanup is globally required but repo-local in mechanics inside those stages. The
[user cookbook](guides/USER-COOKBOOK.md) owns the smallest path for a direct edit.

## Owners

| Concern | Owner |
|---|---|
| Product requirements, architecture, decisions | [PRD-TAD-ADR-MVP-GTM](guides/PRD-TAD-ADR-MVP-GTM.md) |
| Repository composition and technology decisions | [tech stack](guides/TECH-STACK.md) |
| Implemented lifecycle capabilities | [features](guides/FEATURES.md), [catalog](catalog/features.json) |
| Lane state machine | [LANE](docs/LANE.md) |
| Provider handoff and protected ordering | [MERGE-QUEUE](docs/MERGE-QUEUE.md) |
| Provider-neutral records and the trust boundary | [GOVERNANCE](docs/GOVERNANCE.md) |
| Evidence and completion semantics | [EVIDENCE](docs/EVIDENCE.md), [completion](docs/LIFECYCLE-COMPLETION.md) |
| Check selection, receipts and observation economy | [validation economy](guides/VALIDATION-ECONOMY.md) |
| Shared cache lifecycle and local owner declarations | [cache management](guides/CACHE.md) |
| Byte and module budgets | [BUDGETS](docs/BUDGETS.md) |
| `/`, `#`, `@` route register | [INVOCATION](docs/INVOCATION.md), [catalog](catalog/invocation.json) |
| Backend tool and transport contract | [MCP](docs/MCP.md) |
| Bounded codebase map, search and read | [context](guides/CONTEXT.md) |
| Cleanup consent and quarantine | [user cleanup](guides/USER-CLEANUP.md) |
| Universal lifecycle principles | [ADLC guidelines](docs/adlc-guidelines.md) |
| Always-load agent instructions | [AGENTS](AGENTS.md) |
| Work allocation across devices | [FLEET](FLEET.md) |
| Shared check discovery and fixtures | [test/README](test/README.md) |
| Workspace routing across repositories | [DOCUMENTS](DOCUMENTS.md) |

Portable, host-registered skills ship beside the runtime: [Canvas](skills/canvas/SKILL.md) and
[ESP-IDF](skills/esp-idf/SKILL.md). Both are instruction assets read without a Node.js runtime.

**Reference implementation** — the profile selects a Git repository adapter and a GitHub provider
adapter, and `agentic-canvas-os`, `agentic-commerce-os`, and `agentic-graph` are the composed
consumers. The adapters are swappable and the consumer set is this project's own choice; accepted
revisions are pinned in [composition-source-lock.json](catalog/composition-source-lock.json).

## Consuming as a package

Pin an exact 40-hex source revision rather than a floating name, so the audited governance bytes are
identifiable. Consumers reference the packaged evaluator instead of copying it:

```sh
npm --prefix node_modules/agentic-os run evals
node bin/agentic-os.mjs pin --consumer=/absolute/root    # report consumer pin drift
```

The package root exposes the four provider-neutral request operations — `claim`, `continue`,
`integrate`, `retire` — under [GOVERNANCE](docs/GOVERNANCE.md), which owns their records and limits.

## Governing artifact

`PRD-TAD-ADR-ADLC-PIPELINE-001@1.3.2` in [PRD-TAD-ADR-MVP-GTM](guides/PRD-TAD-ADR-MVP-GTM.md) is the
single governing artifact for scope, candidate, integration, release, and runtime evidence.
Precedence runs from that artifact, to its named composition owner, to derived indexes, to navigation
and command documents including this one. Raise a conflict at the owner, not here.
