---
title: "Shared Frontmatter Boundary"
doc_type: "Guidelines"
version: "1.0.0"
date: "2026-09-10"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
---

# Shared frontmatter boundary

The authoring owner is `huijoohwee.github.io/guidelines/runtime-frontmatter-guidelines.md`.
It links the existing CID, RAO, SVO and readiness definitions; consumers do not fork them.
This module owns bounded parsed-data handling, not field meanings or product readiness.

Import `FRONTMATTER_LIMITS`, `snapshotFrontmatter` and `JsonSnapshotError` from
`agentic-os/frontmatter` at the consumer's exact locked package revision.
Pass the mapping returned by the existing local YAML parser. The result is a detached,
deeply frozen, null-prototype JSON mapping. Invalid values throw `JsonSnapshotError`
with a stable `code`; there is no repair, coercion, filesystem scan or remote schema lookup.

The envelope allows 500,000 document bytes, depth 12, 4,096 nodes, 16,384 bytes per
string, 65,536 aggregate key/value string bytes, 1,024 array entries and 256 mapping keys.
I/O adapters enforce the document byte limit before reading/buffering. Parsers enforce
their own dialect, duplicate-key, delimiter and alias rules before snapshotting.
The snapshot rejects object aliases/cycles, accessors, proxies, non-JSON objects and
non-finite numbers. It cannot recover duplicate keys already discarded by a parser.
Use the local schema validator on this snapshot; supply reviewed schemas explicitly.
Product schema requirements may narrow this envelope. A larger envelope needs a
separately reviewed upstream contract change.

The website's restricted guideline YAML and Graph's nested executable YAML remain
separate syntax profiles. Neither parser is silently substituted for the other.
Existing metadata is not automatically migrated or certified by installing this API.
New adopters need positive and negative fixtures for their actual parser and schema.

Graph owns `docs/runtime-readiness-contract.md`, `docs/collaboration-runtime-contract.md`
and their executable validators. Requirements, invocation policy, CI scopes and deploy
configuration stay there. A readiness string, schema pass or dictionary entry cannot
grant execution, payment, publication or cleanup authority. Observations bind the exact
source revision, environment, check and result separately from authored requirements.

## Source and verification

This reuses the descriptor-safe walker in `src/catalog-input.mjs`; the website adapter
adopts the envelope after its existing YAML parse. Run `npm run check` upstream and
the consumer's parser/profile tests before advancing its lockfile.
Always-load guidance delta: zero. Dependencies: zero. Source modules: zero additional;
the existing snapshot owner gains one bounded metadata entry point. Per-scenario
module multiplier: zero. No new parser, schema registry or lifecycle controller.
