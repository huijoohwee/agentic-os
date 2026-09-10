---
title: "Workspace Document Owners"
doc_type: "Index"
version: "1.1.0"
date: "2026-09-10"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
---

# Workspace document owners

Start here to find the source owner across the seven repositories. This is a routing index;
definitions, guidelines, product contracts and evidence remain at the linked owners.
Read only the row needed for the task, then the owner's local index or contract.

## Shared concerns

| Need | Authoritative entry point |
|---|---|
| Document authoring and ownership rules | [Documentation guidelines][documentation] |
| Naming conventions and syntax profile selection | [Conventions and syntax guidelines][conventions] |
| Common YAML frontmatter | [Runtime frontmatter guidelines][frontmatter] |
| Bounded parsed metadata API | [Shared frontmatter boundary](guides/FRONTMATTER.md) |
| CID, RAO, SVO and specification fields | [PRD/TAD/ADR guidelines][prd], [shared semantic schema][semantics] |
| `/`, `#`, `@` dictionary definitions and consumption | [Invocation dictionary owner](guides/INVOCATION-DICTIONARIES.md) |
| Executable harness invocation grammar | [Invocation contract](docs/INVOCATION.md) |
| Global development lifecycle | [ADLC guidelines](docs/adlc-guidelines.md) |
| Start or release work | [Start](docs/START-WORKFLOW.md), [release](docs/RELEASE-WORKFLOW.md) |
| Portable, capability-routed skills | [Canvas skill](skills/canvas/SKILL.md) |
| Architecture and repository composition | [Technology and ownership decisions](guides/TECH-STACK.md) |
| Implemented lifecycle features and specification | [Features](guides/FEATURES.md), [PRD/TAD/ADR](guides/PRD-TAD-ADR.md) |
| Executable check discovery and evidence | [Shared testing](test/README.md) |

The website's [guideline and schema map][guideline-map] owns its on-demand guideline inventory.
The [repository check catalog](test/repositories.json) owns check-owner membership and script/workflow references.
The [composition source lock](catalog/composition-source-lock.json) owns accepted composition revisions.
Follow those existing registries; this page does not repeat their inventories, commands, pins or verdicts.

## Repository concerns

Each row identifies a local documentation owner. Shared concerns above apply by reference;
a product's rules and executable validators stay beside its implementation.

| Repository | Local responsibility | Entry points |
|---|---|---|
| `agentic-os` | Shared lifecycle, reusable contracts, catalogs and skills | [README](README.md), shared concerns above |
| `huijoohwee.github.io` | Common authoring guidelines and semantic schemas | [Guidelines][guidelines], [schema map][guideline-map] |
| `agentic-commerce-os` | Commerce control plane, buyer loop and product readiness | [README][commerce], [MVP/GTM][gtm], [runtime][commerce-runtime] |
| `agentic-canvas-os` | Agent application contracts and local documentation control surface | [Docs index][canvas], [product rules][canvas-rules] |
| `agentic-graph` | Graph/browser execution and shared deployment orchestration | [README][graph], [readiness][graph-runtime], [collaboration][graph-collaboration] |
| `huijoohwee` | Generated production mirror and its local acceptance contract | [Mirror routing][mirror], [readiness][mirror-runtime] |
| `GameXR` | Spatial frontend, native adapter and source-artifact handoff | [README][game], [design][game-design], [release][game-release] |

Graph's protected release workflow owns generated mirror publication. Follow the mirror routing contract
back to Graph before changing generated output. A link to a repository is not deployment authorization.
Canvas application code, Graph execution and Commerce behavior do not move into `agentic-os`
merely because an agent uses them. Shared ownership follows responsibility, not the word "agent".

## Dictionary and guideline routing

Shared invocation definitions live only in [catalog/dictionaries](catalog/dictionaries):
[commands](catalog/dictionaries/DICTIONARY-COMMAND.md),
[semantics](catalog/dictionaries/DICTIONARY-SEMANTIC.md), and
[bindings](catalog/dictionaries/DICTIONARY-BINDING.md).
Canvas's [dictionary projections][canvas-dictionaries] preserve published raw-document paths;
their refresh command and byte-equality gate are owned there. Edit the upstream assets first.
Product terminology registers and field schemas remain local where they describe product behavior.
Common CID/RAO/SVO meanings remain in the shared semantic schema, separate from invocation tokens.

Guidelines describe common authoring rules; local contracts select product fields, syntax profiles
and executable validation. A local profile may narrow the shared contract, not fork its definitions.
Source checks and authored readiness requirements remain separate from observed runtime evidence.

## Resolution and maintenance

`DOCUMENTS.md` is the sole workspace routing page. Keep existing local `README.md` entry points;
do not add a parallel workspace `INDEX.md` or copy this table into each repository.
Local indexes may link here and list their own product documents. Navigation backlinks do not
create an authority dependency: follow each concern to its defining source and stop there.

Cross-repository links below select an explicit repository and path for human navigation.
Their `main` URLs are mutable discovery links, not version pins or validation evidence.
For offline work, resolve that repository/path from an explicitly selected clone or installed
asset at the required revision. Do not scan sibling directories, auto-fetch missing owners,
or assume this page's presence upgrades an installed consumer dependency.

Package consumers may resolve `agentic-os/DOCUMENTS.md` from their exact installed revision.
This asset loads on demand; no runtime import, agent-provider registration or session prompt changes.
When moving an owner, update its inbound links in the same migration, retain only required
compatibility projections, and verify targets against the selected source revisions.

Validation: `npm run check` verifies the owning package. For navigation edits, also resolve
Markdown targets against the selected owner trees and inspect `npm pack --dry-run --json`
for this asset. Document checks establish source consistency only.

[documentation]: https://github.com/huijoohwee/huijoohwee.github.io/blob/main/guidelines/documentation-guidelines.md
[conventions]: https://github.com/huijoohwee/huijoohwee.github.io/blob/main/guidelines/conventions-and-syntax-guidelines.md
[frontmatter]: https://github.com/huijoohwee/huijoohwee.github.io/blob/main/guidelines/runtime-frontmatter-guidelines.md
[prd]: https://github.com/huijoohwee/huijoohwee.github.io/blob/main/guidelines/prd-tad-adr-guidelines.md
[semantics]: https://github.com/huijoohwee/huijoohwee.github.io/blob/main/schema/AgenticRAG/roles-actions-outcomes-schema.jsonld
[guidelines]: https://github.com/huijoohwee/huijoohwee.github.io/tree/main/guidelines
[guideline-map]: https://github.com/huijoohwee/huijoohwee.github.io/blob/main/schema/AgenticRAG/agenticrag-guidelines-and-surfaces-map.graph.jsonld
[commerce]: https://github.com/huijoohwee/agentic-commerce-os/blob/main/README.md
[gtm]: https://github.com/huijoohwee/agentic-commerce-os/blob/main/docs/mvp-gtm-handoff.md
[commerce-runtime]: https://github.com/huijoohwee/agentic-commerce-os/blob/main/docs/production-runtime.md
[canvas]: https://github.com/huijoohwee/agentic-canvas-os/blob/main/docs/README.md
[canvas-rules]: https://github.com/huijoohwee/agentic-canvas-os/blob/main/docs/PROJECT-RULES.md
[canvas-dictionaries]: https://github.com/huijoohwee/agentic-canvas-os/blob/main/docs/DICTIONARY-OWNERSHIP.md
[graph]: https://github.com/huijoohwee/agentic-graph/blob/main/README.md
[graph-runtime]: https://github.com/huijoohwee/agentic-graph/blob/main/docs/runtime-readiness-contract.md
[graph-collaboration]: https://github.com/huijoohwee/agentic-graph/blob/main/docs/collaboration-runtime-contract.md
[mirror]: https://github.com/huijoohwee/huijoohwee/blob/main/AGENTS.md
[mirror-runtime]: https://github.com/huijoohwee/huijoohwee/blob/main/docs/RUNTIME-READINESS.md
[game]: https://github.com/huijoohwee/GameXR/blob/main/README.md
[game-design]: https://github.com/huijoohwee/GameXR/blob/main/docs/GAME-DESIGN-TECHNICAL-ARCHITECTURE.md
[game-release]: https://github.com/huijoohwee/GameXR/blob/main/docs/RELEASE.md
