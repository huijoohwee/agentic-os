---
title: "Versioned Project Workspace — Owner Routing"
doc_type: "Reference"
version: "0.5.0"
date: "2026-10-04"
lang: "en-US"
frontmatter_contract: "required"
owner: "agentic-os lifecycle owner"
status: "active"
load_policy: "on-demand"
---
# Versioned project owner routing

The single active product specification for `VERSIONED-WORKSPACE-001` is
[Graph's versioned project PRD/TAD/ADR/MVP/GTM](https://github.com/huijoohwee/agentic-graph/blob/b8dd7a562cfa24eda31eb4f7f328456fffdfbaa4/docs/documents/agentic-graph-versioned-project-prd-tad-adr-mvp-gtm.md).
This file is a migration reference, with no independent requirements or release authority.

| Concern | Owner |
|---|---|
| Shared lifecycle, admission and release contracts | agentic-os |
| Versioned project product, native Git store, Canvas History → Projects UI and five-role specification | agentic-graph |
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

Graph's headless MCP package already declares MIT. Its closure and explicit license
belong to Graph. The user reopened local Canvas integration under revision0.5.0;
Graph PR1538 supplies the native UI and removes the standalone HTML/client. HTTP and
stdio remain headless adapters. Hosted Production remains KIV: local reuse does not
relicense private Canvas or satisfy the protected production controller's gates.
PR1535 / `bd1ae77044faddfb1a89e5219cfa6037586f47fd` remains historical recovery;
preserve its original branch and bundle, without restoring its retired UI variant.

Native Git plus a running loopback Node host is the current implementation. A narrow
browser viewport does not establish phone-only, edge, remote-device or full agent
parity. Source integration, product delivery, Production and disk cleanup require
their own evidence. Workspace artifact `versioned-project-consolidation-20261004`
records the original migration; `versioned-project-canvas-integration-20261004`
records the native UI verification and source closeout. Neither grants authority.
