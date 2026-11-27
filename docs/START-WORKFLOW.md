# Start

Canonical checkout only. Run `npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`.
START locks, fetches and checks scope; it reuses or creates a registered worktree under
`.worktrees/<repo>/<device>--<lane>` (or configured root). Edit there.
Worktrees share Git objects and refs. Files and index are separate. Independent clones cannot start lanes.
Routine work needs no mission; navigation never enrolls a task.
Resume an open, unqueued PR with history intact. Scope expansion is explicit.
Reserve the owner or consumer fix per [fleet rules](../guides/prd-tad-adr-mvp-gtm-fleet-registry.md#operator-rules).

Material work takes `--plan` with a protected PRD or untracked regular Markdown draft ≤128,000 B absent from
protected source. Bind repo/base/path/bytes; plans grant no effects. Resume via `--mission`.
A native allocation can recover a missing cache row; conflicts or unknown bytes need recovery.

At capacity, reuse a matching scope or reconcile its allocation. Independent work needs its own scope, plan and
mission. Each gets one checkout within the repo ceiling. Never raise limits or borrow allocations.

Workspace, memory, fleet, recovery and deployment are on demand. START never publishes, deploys or cleans up.
