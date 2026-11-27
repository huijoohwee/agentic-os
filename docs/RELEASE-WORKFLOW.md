# Release workflow

START: `npm run lane -- <scope> --write=<paths>`; work in its linked worktree.
LAND: run `npm run check`, then `npm run land -- --message="..."`.
Update the same unqueued PR with a fast-forward; preserve history.

END (canonical): `agentic-os complete-adlc --apply --ref=<lane> --stopped`
selects merge, sync and cleanup. Green checks/reviews gate merge; authority source
needs `--authority-head`.

END needs remote integration and canonical sync. Each effect has its own
receipt. Cleanup removes only a clean integrated worktree; branches,
refs, reflogs and objects stay. See [cleanup](../guides/CLEANUP-RESIDUE-DEFAULT.md)
and [recovery](../guides/USER-CLEANUP.md).
