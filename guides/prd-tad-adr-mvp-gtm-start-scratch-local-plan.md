---
title: "START uses the canonical checkout and local PRD drafts"
doc_type: PRD-TAD-ADR-MVP-GTM
version: 0.3.0
continuity_id: AGENTIC-OS-START-DRAFT-PLAN-001
owner: agentic-os
date: 2026-11-12
local_rung: implementation-candidate
delivered_rung: undocumented
load_policy: on-demand
upstream: PRD-TAD-ADR-ADLC-PIPELINE-001@1.4.52
---

# START uses the canonical checkout and local PRD drafts

## PRD

**Pain:** Independent scratch clones add another clone state and lane registry,
or an alternate-object dependency to maintain. They increase stale-checkout and
cleanup risk without helping a task that can use a registered worktree.
Requiring a committed planning record for every bounded local task would still
add friction.

**Outcome:** START admits new source work only from the primary canonical
checkout and creates or reuses a registered linked worktree in the shared
`.worktrees/<repository>/<device>--<lane>` registry. It can still bind a selected
local draft to the freshly fetched protected base and store immutable planning
bytes for resume and successor operations. Canonical source stays read-only.

### Acceptance

- **AC-1 — Checkout identity:** START accepts the primary checkout whose name
  matches the path-qualified committed repository identity, regardless of Git
  host. It rejects identities without a checkout name, independent scratch
  clones, auxiliary, worktree, archive and mismatched roots before fetch or lane
  mutation. A lane is a registered linked worktree under the shared repository
  registry; it shares the canonical clone's object store and refs.
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
- **AC-4 — Existing gates:** Canonical identity and the clone-wide lock precede
  protected fetch and mission checks, including reuse/refusal. Local `main` does
  not advance; fetch updates tracking only. A planning snapshot grants no commit, push, merge,
  publish, deploy, rollback, cleanup or remote-ref authority.
- **AC-5 — Resource limits:** Reuse existing owners and contracts. Add no runtime
  module, dependency, service, paid resource or always-load instruction. Keep all
  files below 600 lines, the always-load set below 40 KiB, and the diff below
  500 KiB.

### TAD and ADR

Reuse `repositoryCheckoutLocation` to identify and diagnose scratch clones, but
make only the primary canonical checkout eligible for START. Keep worktree
provisioning in the shared `.worktrees/<repository>` registry. Reuse START
admission for lock/fetch/reservation and workflow collection for plan validation,
snapshot digests, resume and successor copying. Keep the plan-path selection explicit;
never auto-discover drafts or stage/commit draft bytes during START. Only allow a
changed plan to rebind when the full clean-lane/base/ref/path/reservation tuple
matches; otherwise fail closed and preserve both authored bytes and prior roots.

Existing scratch clones remain diagnosable and preservable during cleanup but
cannot start new lanes. An explicit draft is planning evidence, not an effect
grant. Existing publication, integration, product delivery, cleanup and rollback
owners remain unchanged.

## MVP and verification

Scope: existing checkout admission, doctor/help, workflow documentation, and the
existing checkout regression contract. Budget: 10 paths, zero new modules or
dependencies, under 24 KiB, 45 active minutes, USD 0 spend. Always-load total
must remain below 40,960 B.

Verify canonical admission, scratch-clone refusal before fetch, shared worktree
placement, protected and untracked plan admission, exact snapshot capture, drift
handling, resume/successor preservation, docs/module budgets, and required
`budgets`/`test` CI on the exact PR head. No
deployment or production-readiness claim is part of this source task. Product
delivery stays open until its owner records exact applicability evidence.

## GTM and rollback

This reduces local planning friction; customer demand and time saved remain
unmeasured. The CLI and all source controls remain Free/FOSS with no paid plans,
services or spend. Roll back through a protected revert of the exact source
candidate, retaining workflow snapshots and release/effect receipts.
