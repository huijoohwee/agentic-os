---
title: "Versioned Project Workspace — Owner Routing"
doc_type: "Reference"
version: "0.4.0"
date: "2026-10-04"
lang: "en-US"
frontmatter_contract: "required"
owner: "agentic-os lifecycle owner"
status: "active"
load_policy: "on-demand"
---
# Versioned project owner routing

The single active product specification for `VERSIONED-WORKSPACE-001` is
[Graph's versioned project PRD/TAD/ADR/MVP/GTM](https://github.com/huijoohwee/agentic-graph/blob/ce1b77d357ff379fed07fcff2f463fa578b4f6f5/docs/documents/agentic-graph-versioned-project-prd-tad-adr-mvp-gtm.md).
This file is a migration reference, with no independent requirements or release authority.

| Concern | Owner |
|---|---|
| Shared lifecycle, admission and release contracts | agentic-os |
| Versioned project product, native Git store, standalone UI and five-role specification | agentic-graph |
| Existing neutral host invocation | agentic-canvas-os contract adapter |

Do not copy Graph's project implementation or active product plan into OS or Canvas OS.
Do not add a replacement repo, parallel project backend, new tool namespace or fallback
store. Extract a shared headless capability only after a second real consumer proves
the same stable contract and the upstream owner admits that change.

The former OS reference-implementation and implementation-handoff companions are removed.
Their historical requirements and evidence remain at
[OS a5bf2ec](https://github.com/huijoohwee/agentic-os/tree/a5bf2ecbce6e4e866d5f6109eae34c3f84dc4abd/guides).
Do not resurrect those active variants. The composition architecture test enforces the
retired paths and forbids a local workspace-project runtime owner.

Graph's headless MCP package already declares MIT. Its standalone closure and explicit
license belong to Graph. Private Canvas changes remain KIV at Graph PR1535 / commit
`bd1ae77044faddfb1a89e5219cfa6037586f47fd`; no repository move or documentation change
relicenses them. Preserve their original branch and recovery bundle.

Native Git plus a running loopback Node host is the current implementation. A narrow
browser viewport does not establish phone-only, edge, remote-device or full agent
parity. Source integration, product delivery, Production and disk cleanup require
their own evidence. Workspace artifact `versioned-project-consolidation-20261004`
records this migration, verification and preserved bytes; it grants no authority.
