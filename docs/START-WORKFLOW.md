# Start

Use `release:common start <scope> --write=<paths> --plan=<PRD-path>` for one task. Plan: protected PRD or one
explicit in-repo untracked regular non-symlink Markdown draft (≤128,000 B) absent from the fetched protected tree.
Bind repo, fetched base, relative path, and exact-byte SHA-256; store immutable bytes for resume/successors. Changed
plans rebind only one clean unpublished lane at fetched base with the same ref, path, and reservation; drift refuses.
A snapshot grants no effect authority.

At most five worktrees per repo; canonical excluded; no nesting; one lane per task. No plan/mission: use clone.
Accept canonical checkout or exact `<repository>-<role>-scratch` clone; lanes stay local. Refuse auxiliary, worktree,
archive, and mismatched checkouts; reserve disjoint paths.

Lock/fetch protected ref before checks, including reuse/refusal. Failure stops before mutation; fetch updates tracking
only, not local main or release authority. See [recertification](../guides/LANE-RECERTIFICATION.md).
