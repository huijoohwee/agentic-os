# Start

Run START from the primary canonical checkout only:
`npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
START locks, fetches and checks exact scope; it reuses its matching registered worktree or creates one under
`.worktrees/<repository>/<device>--<lane>` (or the configured worktree root). Edit only there. Do not create a
separate repository clone for a lane; it adds another clone state and lane registry, while the linked
worktree reuses the canonical repository's Git data.
Routine work needs no mission document; unrelated navigation never enrolls a task. Resume an open, unqueued PR
with its published history intact. Scope expansion remains explicit.

Use `--plan` for material changes: a protected PRD or an untracked, regular Markdown draft ≤128,000 B, absent
from protected source. Bind repo/base/path/bytes; plans grant no effects. Use `--mission` for exact resumption.
A native allocation can recover a missing initial cache row; conflicts or unknown bytes require recovery.

At capacity, continue in the matching worktree when its scope fits, or resume/reconcile the exact allocation.
Independent work needs a distinct scope and its own protected PRD or untracked regular Markdown draft via `--plan`;
it starts a separate mission with the default one-checkout budget, subject to the repository ceiling. Never raise an
existing mission's limit or borrow another task's allocation.

Workspace, memory, fleet, recovery and deployment are on demand. START never publishes, deploys or cleans up.
