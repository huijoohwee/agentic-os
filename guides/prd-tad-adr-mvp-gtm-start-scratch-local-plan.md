---
title: "START supports explicit scratch clones and local PRD drafts"
doc_type: PRD-TAD-ADR-MVP-GTM
version: 0.2.0
continuity_id: AGENTIC-OS-START-DRAFT-PLAN-001
owner: agentic-os
date: 2026-10-31
local_rung: implementation-candidate
delivered_rung: undocumented
load_policy: on-demand
upstream: PRD-TAD-ADR-ADLC-PIPELINE-001@1.4.46
---

# START supports explicit scratch clones and local PRD drafts

## PRD

**Pain:** New source tasks may start from an isolated scratch clone and a concrete
local PRD draft. Requiring canonical checkout names and committed plans forces
unnecessary commits or blocks a bounded local task.

**Outcome:** START admits a precisely named scratch clone, binds a selected local
draft to the freshly fetched protected base, and stores immutable planning bytes
for resume and successor operations. Canonical source stays read-only.

### Acceptance

- **AC-1 — Checkout identity:** START accepts the canonical checkout or a clone
  named `<repository-slug>-<hyphenated-role>-scratch`. It rejects auxiliary,
  worktree, archive and mismatched roots before lane mutation; a scratch clone
  keeps its lane refs and checkouts local.
- **AC-2 — Draft admission:** `--plan=<path>` accepts a protected PRD or one
  explicit untracked local PRD. A draft must be regular, non-symlink Markdown,
  within the repository, no larger than 128,000 bytes, and absent from the exact
  fetched protected tree. START binds repository, fetched revision, relative path
  and SHA-256 of exact bytes, retaining those bytes in the immutable workflow root.
- **AC-3 — Resume and drift:** Resume and successors read the stored snapshot,
  never a mutable checkout copy. A changed explicit draft may rebind only one
  clean unpublished lane at the fetched base with the same ref, path and exact
  write reservation. The prior workflow remains readable; any binding drift
  refuses the rebind.
- **AC-4 — Existing gates:** The clone lock and protected fetch precede identity
  and mission checks, including reuse/refusal. Local `main` does not advance;
  fetch updates tracking only. A planning snapshot grants no commit, push, merge,
  publish, deploy, rollback, cleanup or remote-ref authority.
- **AC-5 — Resource limits:** Reuse existing owners and contracts. Add no runtime
  module, dependency, service, paid resource or always-load instruction. Keep all
  files below 600 lines, the always-load set below 40 KiB, and the diff below
  500 KiB.

### TAD and ADR

Reuse `repositoryCheckoutLocation` for exact checkout roles, START admission for
fetch/lock/reservation, and workflow collection for plan validation, snapshot
digests, resume and successor copying. Keep the plan-path selection explicit;
never auto-discover drafts or stage/commit draft bytes during START. Only allow a
changed plan to rebind when the full clean-lane/base/ref/path/reservation tuple
matches; otherwise fail closed and preserve both authored bytes and prior roots.

The scratch suffix makes local isolation visible and bounded while preserving
canonical ownership. An explicit draft is planning evidence, not an effect
grant. Existing publication, integration, product delivery, cleanup and rollback
owners remain unchanged.

## MVP and verification

Scope: 14 existing files across 7 existing source modules, 4 existing test files
and 3 guides, plus this planning record. Budget: 23,980 authored addition bytes excluding this plan, under 24 KiB total; zero new modules or
dependencies; 45 active minutes; USD 0 spend. Always-load total: 40,945 / 40,960 B.

Verify scratch naming/refusal, protected and untracked plan admission, exact
snapshot capture, drift handling, resume/successor preservation, start ordering,
docs/module budgets, and required `budgets`/`test` CI on the exact PR head. No
deployment or production-readiness claim is part of this source task. Product
delivery stays open until its owner records exact applicability evidence.

## GTM and rollback

This reduces local planning friction; customer demand and time saved remain
unmeasured. The CLI and all source controls remain Free/FOSS with no paid plans,
services or spend. Roll back through a protected revert of the exact source
candidate, retaining workflow snapshots and release/effect receipts.
