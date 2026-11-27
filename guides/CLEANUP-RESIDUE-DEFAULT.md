---
title: Cleanup residue default
doc_type: guide
status: active
---

# Cleanup residue default

`agentic-os` treats stale workspace residue as debt to eliminate, not a neutral steady state.

## Default

- On END, remove the exact integrated worktree and Git registration when the checkout has no local-only bytes.
- Retain the local branch, reflogs, and Git objects; no force removal or garbage collection.
- Prefer the cheapest native planner that proves the cleanup path instead of keeping an idle checkout mounted.
- Use `agentic-os cleanup auto` to select the matching planner from current local facts.
- Profiles that omit `cleanup` select `remove-clean` for the worktree projection and registration. Explicit quarantine remains available.

## Exceptions

Preserve or stop for recovery when one of these is true:

- the repository cleanup policy intentionally retains the worktree,
- the lane still contains unresolved authored or untracked bytes,
- a current preservation or discard receipt is still being bound,
- the checkout is required for an exact active operation that has not finished.

Ignored files, untracked files, hidden entries, active readers, incomplete scans, or inventory drift prevent clean
removal. Captured ignored bytes use the recoverable quarantine path; unresolved authored or unobservable bytes stay
mounted until recovery. A cleanup receipt never proves provider authority or claim retirement.

## Operator cues

- `completion status` now reports `closeout.residueDisposition`.
- `stale-mounted` and `stale-unmounted` mean cleanup is still owed.
- `deliberate-retained` means the profile explicitly selects retention or the lane remains mounted for recovery.

## Commands

Plan the cheapest exact cleanup path for a lane:

```bash
agentic-os cleanup auto --ref=<lane>
```

Plan cleanup for a clean detached canonical snapshot:

```bash
agentic-os cleanup auto --target=<absolute-worktree-path>
```
