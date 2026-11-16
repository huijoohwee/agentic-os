---
doc_type: PRD-TAD-ADR-MVP-GTM
owner: agentic-os
status: draft
---

# Reliable lane-cache continuation

## Problem

The workspace lane cache documents an 8 MB aggregate payload, but cache normalization applies a 420 KB
aggregate unique-string limit. A mature cache can load near that threshold and then reject a normal lane
publication that adds a small amount of metadata. Mission recovery also treats unrelated untracked Markdown
planning drafts in canonical as source corruption, preventing safe continuation when those drafts must be
preserved.

## PRD

Keep lane-cache validation bounded by the existing per-string, node, record, index, and aggregate payload
limits. Permit the full documented workspace payload without requiring historical lane eviction. Allow
mission recovery with unrelated untracked planning drafts while preserving exact mission, allocation, branch,
protected-head, and worktree bindings; tracked canonical edits must continue to fail closed.

## TAD

Align the aggregate string guard with the 8 MB workspace payload cap, and make mission recovery inspect
tracked canonical changes separately from preserved untracked files. Add regressions for a populated cache
that still accepts a normal metadata update, for preserving an unrelated untracked Markdown draft during
exact mission recovery, and for rejecting tracked canonical edits. Do not delete or rewrite cache records,
worktrees, refs, or authored plans.

## ADR

The lane cache remains non-authoritative. Its existing exact digests, CAS publication, per-record and index
size limits, node/array limits, and 8 MB aggregate payload cap remain in force. Recovery may disregard
untracked canonical bytes because it neither copies nor commits them; it must continue to reject tracked
changes and any mission, path, ref, branch, or head drift.

## MVP and verification

Acceptance: normal lane publication succeeds at the documented cache capacity; bounded cache overflow still
fails before replacing the active index; exact mission recovery preserves unrelated untracked Markdown bytes;
tracked canonical changes remain rejected. Run focused lane-cache and admission regressions, then
`npm run evals` and the registered `npm run land` workflow.
