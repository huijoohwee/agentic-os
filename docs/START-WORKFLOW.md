# Start

Run START only from the primary canonical checkout:
`npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
START locks, fetches and checks scope; it reuses or creates a registered worktree under
`.worktrees/<repo>/<device>--<lane>` (or configured root). Edit there. Worktrees share Git objects/refs, not files or
index. Independent clones cannot start lanes.
Routine work needs no mission; navigation never enrolls a task. Resume an open, unqueued PR with history intact.
Scope expansion is explicit.

Use `--plan` for material work: protected PRD or untracked regular Markdown draft ≤128,000 B, absent from protected
source. Bind repo/base/path/bytes; plans grant no effects. Use `--mission` to resume. A native allocation can recover
a missing cache row; conflicts or unknown bytes need recovery.

At capacity, continue in the matching worktree if scope fits, or resume/reconcile its allocation. Independent work
needs a distinct scope and its own protected PRD or untracked regular Markdown draft via `--plan`; it gets a separate
mission with the default one-checkout budget, subject to the repository ceiling. Never raise limits or borrow an
allocation.

Workspace, memory, fleet, recovery and deployment are on demand. START never publishes, deploys or cleans up.
