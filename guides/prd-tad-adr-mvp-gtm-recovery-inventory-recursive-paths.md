---
title: "Recovery inventory recursive paths"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
date: "2026-10-09"
lang: "en-US"
owner: "Agentic OS runtime maintainers"
frontmatter_contract: "required"
continuity_id: "AGENTIC-OS-RECOVERY-INVENTORY-RECURSIVE-PATHS-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
local_rung: "implementation-complete"
delivered_rung: "source-integration-pending"
lane: "runtime"
universal_scope: true
load_policy: "on-demand"
verification_scope: "Normalize byte paths once while expanding ignored directory records; preserve bounded traversal and race checks."
budget: "One existing source module and this record; zero new runtime modules, dependencies, paid services, or spend."
---

# Recovery inventory recursive paths

## PRD

### Problem

When Git reports a fully ignored directory with a trailing slash, recovery inventory expands it.
Nested directories need the same byte-exact path representation as files so closeout can finish
without repeating a whole repository scan or ignoring preserved runtime data.

### Minimum outcome

Inventory every descendant under a bounded traversal and produce stable byte-exact records. Unsafe
paths, unsupported entries, changing directories, and entry-ceiling violations remain fail-closed.

### Acceptance

- Top-level Git directory records lose their delimiter once, when queued.
- Nested directory paths remain unmodified as they pass through the queue.
- Files and symlinks retain their raw relative path bytes.
- Existing identity checks, entry ceilings, stable double collection, and digests remain unchanged.

## TAD

`src/recovery-inventory.mjs` owns Git path expansion. Queue entries store canonical relative path bytes
and a separate directory flag; traversal never infers or strips a delimiter after enqueueing. Reuse the
existing bounded queue, filesystem identity checks, and manifest hashing. Do not add a module or expand
the inventory ceiling.

## ADR

Normalize once at the Git boundary and retain type separately. This removes the nested-path truncation
without extra scans, lossy decoding, or changes to symlink and race handling. A failing CI check blocks
promotion; protected green source integration remains separate from cleanup and delivery authority.

## MVP and GTM

This is an internal lifecycle reliability improvement for local-first, multi-worktree development. The
value is one bounded, complete closeout pass over retained bytes, with no external service or spend.
Evidence is the exact source diff and protected CI; customer demand and deployment are out of scope.
