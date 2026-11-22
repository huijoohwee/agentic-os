---
title: Cleanup residue default
doc_type: guide
status: implementation-candidate
---

# Cleanup residue default

`agentic-os` treats stale workspace residue as debt to eliminate, not a neutral steady state.

## Default

- Eliminate residue when the exact lane is already integrated and no new local bytes need to be preserved.
- Prefer the cheapest native planner that proves the cleanup path instead of keeping an idle checkout mounted.
- Use `agentic-os cleanup auto` to select the matching planner from current local facts.
- Repository profiles that omit `cleanup` now default to `remove-clean` for worktree projection and registration while leaving branch and object cleanup retained.

## Exceptions

Retention is the exception. Keep residue only when one of these is true:

- the repository cleanup policy intentionally retains the worktree,
- the lane still contains unresolved authored or untracked bytes,
- a current preservation or discard receipt is still being bound,
- the checkout is required for an exact active operation that has not finished.

## Operator cues

- `completion status` now reports `closeout.residueDisposition`.
- `stale-mounted` and `stale-unmounted` mean cleanup is still owed.
- `deliberate-retained` means the lane is mounted by policy, not by residue drift.

## Commands

Plan the cheapest exact cleanup path for a lane:

```bash
agentic-os cleanup auto --ref=<lane>
```

Plan cleanup for a clean detached canonical snapshot:

```bash
agentic-os cleanup auto --target=<absolute-worktree-path>
```
