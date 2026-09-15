---
title: "Agentic Canvas OS Cache Context Contract"
graphId: "md:agentic-canvas-os-cache-context"
doc_type: "Runtime Cache Context Contract"
date: "2026-09-11"
lang: "en-US"
schema: "agentic-cache-context/v1"
frontmatter_contract: "required"
status: "source-migrated-consumer-cutover-pending"
authority: "Canvas integration of the pinned OS stable-prefix runtime"
runtime_scope: "Agent-API volatile cache-context registry"
runtime_claim: "Implementation and local test owners are linked below; deployed capability is unverified for this migration"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_proof: "https://github.com/huijoohwee/agentic-canvas-os/blob/8460fc01c7dbd8af6880d346a71829e20887c44e/docs/RUNTIME-PROOF.md"
external_pattern_sources:
  - "https://developers.openai.com/api/docs/guides/prompt-caching"
owner: "agentic-os"
load_policy: "on-demand"
migration_source_revision: "8460fc01c7dbd8af6880d346a71829e20887c44e"
---

# Cache Context

This on-demand contract is owned by `agentic-os` under
[DURABLE-AGENT-WORKFLOWS-001@0.1.0](../../../guides/DURABLE-WORKFLOWS.md).
The [migration record](../MIGRATION-DOCS.json) binds its native source. Runtime and
live-provider observations below retain their original scope; historical proof
links remain pinned to that source. Current package checks run with `npm run check:all`.

The portable implementation and API contract moved to `agentic-os/context/prefix`.
Read the pinned `node_modules/agentic-os/guides/CONTEXT.md` on demand for
`NATIVE-CONTEXT-001@1.0.0`, API shapes, limits, migration provenance and source checks.
The OS guide is the shared owner; this document owns only Canvas integration.

`agent-api/src/app.js` imports the public package subpath and accepts an injected
registry. The Worker retains one bounded registry per environment isolate. The
readiness response exposes sanitized policy/counters and keeps provider evidence
unverified. Model capability mapping and actual provider response evidence remain
with the downstream model owner. Scope registries to the caller authorization boundary.

The lockfile pins the exact OS source revision. There is no fallback implementation
or remote code loader. `agent-api/src/json-contract.js` preserves existing Canvas
JSON imports as a tested re-export of `agentic-os/context/json`; normalization has
one authored implementation upstream. No product deployment topology changes.

## Validation

Run `npm run cache-context:check` for Canvas application injection and readiness.
The migrated behavior suite is packaged in OS; run its `npm run context:check`.
Run Canvas `npm run check` for all local suites, web build and document/line budgets.
Worker bundle validation establishes platform compatibility only. Provider cache
hits, effective reasoning context and production readiness still require owner
evidence. Dev integration grants no production mirror, Cloudflare or payment effect.
