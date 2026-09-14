# Explicit no-CI local cleanup

This is a distinct, profileless local-consent mode for a private repository whose exact merged
pull-request head has **zero** GitHub check runs and **zero** legacy commit statuses. It does not
prove CI, branch protection, provider integration authority, claim retirement or distributed
writer exclusion. It is not available to a repository with a committed Agentic OS profile or
trust anchor, and does not change protected cleanup.

After user authorization for this weaker mode, enroll only the target clone with
`git config --local agentic-os.userCleanup quarantine-no-ci`. From that clone's clean canonical
root, run `node <reviewed-agentic-os>/bin/agentic-os-cleanup-no-ci.mjs plan
--target=<absolute-worktree> --pr=<number>`. Save the bounded JSON output outside the worktree.
The plan reobserves the merged same-repository PR, empty check and legacy-status sets, equal
candidate/merge trees, merge ancestry, clean current main and exact recoverable inventory.

Stop all writers, then run `node <reviewed-agentic-os>/bin/agentic-os-cleanup-no-ci.mjs apply
--plan=<saved-json> --authorize=agentic-os:user-cleanup:<planDigest> --stopped` before expiry.
Apply reobserves the same provider and local facts immediately before recoverable quarantine.
It never runs `git worktree remove/prune`, deletes a branch, mutates objects or synchronizes main.
Run one target at a time because each quarantine changes the next target's inventory.
