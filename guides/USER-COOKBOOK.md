# User Cookbook

Use the smallest path that preserves source ownership, reviewability, and protected integration. Substitute
the repository's configured remote, canonical branch, checks, and review provider.

## Autonomous default

Declare the exact files or directories the lane may write. Disjoint lanes run concurrently; overlaps wait
without interrupting or finishing existing work.

```sh
npm run doctor
npm run status
npm run lane -- <scope> --write=<owning-file[,owning-directory...]>
# Edit owning files directly in the printed worktree, then run bounded checks.
npm run land -- --message="docs: describe the focused change"
```

`land` verifies the reservation against active lanes, stages only reserved paths, commits, pushes the exact
new lane ref, and starts the configured protected-integration handoff. It refuses unreserved bytes, overlap,
remote-ref drift, or incomplete provider evidence.

## Manual fallback

Use this only when the repository explicitly permits its manual equivalent. Never author on the canonical
branch, force-push, or update a protected remote branch directly.

```sh
git fetch origin
git switch --create agent/<device>/<scope> origin/<canonical-branch>
# Edit one owning file and run bounded checks.
git diff --check
git add -- <owning-file>
git commit -m "docs: describe the focused change"
git push --set-upstream origin HEAD
```

After protected integration, refresh canonical with `git fetch origin` followed by
`git merge --ff-only origin/<canonical-branch>`. If fast-forward refuses, preserve local commits on a review
branch and inspect the divergence; never overwrite authored or remote history to manufacture readiness.
