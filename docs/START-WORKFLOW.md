# Start

## Default path

From the canonical checkout or approved `<repository>-<role>-scratch` clone, run
`npm run lane -- <scope> --write=<paths> [--plan=<PRD-path>]`. Name exact relative paths. START locks and fetches
the protected ref, checks checkout and scope, then creates one local worktree. Make changes only there.

Use `--plan` for material requirement or design changes. Eligible plans are protected PRDs or untracked regular,
non-symlink Markdown drafts ≤128,000 B absent from the fetched protected tree. START binds repo, base, path, and
exact bytes; a plan grants no effect authority. Use `--mission` to resume; recertify if a bound plan changes.

Workspace or memory context is on demand: run `node bin/agentic-os.mjs workspace` or `memory` when needed. Load
mobile/offline, recovery, cleanup, fleet, deployment, or rollback procedures only when the task or repo policy
requires them. START provisions locally; it does not publish, deploy, or clean up.
