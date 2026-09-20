# Authoring posture

Protected clones (`protected-integration:pull-request`) still refuse commit and push on canonical
`main`. Unprotected clones with no overlapping lane worktree may author on canonical `main`.
A second writer, or any bound lane, restores the worktree requirement. Override remains
`AGENTIC_OS_ALLOW_CANONICAL_WRITE=1` for repository-owned operations only.
