# Autonomous Check-out / Check-in Loop

This optional wrapper reduces a focused change to two guarded lifecycle actions. It never writes the
canonical branch directly and never bypasses the repository's provider integration policy.

## Check-out

From the clean canonical worktree, reserve the owning path and create its isolated lane:

```sh
node bin/agentic-os-checkin-checkout.mjs checkout prd-tad-adr-update \
  --write=guidelines/prd-tad-adr-guidelines.md
```

The command delegates to `agentic-os start`: it fetches the protected base, checks concurrent scope
overlap, creates a registered worktree under the configured parent registry, and prints that path.

## Check-in

After the agent or author edits only the reserved path, run this from the printed lane:

```sh
node bin/agentic-os-checkin-checkout.mjs checkin \
  --message="docs: update PRD TAD ADR guideline"
```

Check-in requires an `agent/<device>/<scope>` branch, runs `npm test`, then delegates to `agentic-os land`.
`land` stages only reserved paths, creates the commit, pushes the immutable lane ref, and requests the
repository's protected provider handoff. The provider—not a local command—advances `origin/main` after its
required checks and merge policy succeed.

## Completion

After the provider merges, run `agentic-os finish --ref=<lane>` from canonical to prove exact integration and
remove the clean lane worktree. Then fetch and fast-forward the canonical checkout from `origin/main`.

If a check, reservation, provider observation, or protected merge blocks, preserve the lane bytes and use the
reported condition. Do not force-push, merge locally into canonical, or write `origin/main` directly.
