# Lane recertification after cache loss

Use this only when the clone-common lane cache has no record for one retained `agent/<device>/<scope>` ref.
Ordinary `rebind --mode=restore` still requires an existing record. Recertification reconstructs a record
from retained Git identity under a new plan and leaves integration, provider, retirement, and cleanup
authority unproven.

## Preconditions

- Run from a clean canonical `main` whose commit exactly matches the selected remote tracking `main`.
- Confirm the lane's local ref and live remote branch point to the same exact commit.
- Select the exact base SHA from trusted release evidence. For a PR lane, inspect the PR's base commit;
  do not infer the admitted base from the current merge base.
- Choose an absent absolute worktree path with an existing, non-symlink parent.
- Stop all writers to the lane. The plan and `--stopped` apply bind this acknowledgement.

## Plan and apply

```sh
npm run release:common -- rebind plan \
  --ref=<lane> --mode=recertify --base=refs/remotes/origin/main \
  --base-sha=<trusted-base-sha> --worktree=<absent-absolute-path> \
  --expected-head=<exact-40-character-sha> [--pr=<number>]
npm run release:common -- rebind apply --plan=<saved-plan.json> \
  --authorize=agentic-os:lane-rebind:<plan-digest> --stopped
```

The plan binds the exact lane ref, protected base, base SHA, head, live remote head, destination, and
reservation. Apply recomputes these observations under a clone-common operation lock. It mounts the
existing branch without advancing or deleting refs and verifies the new checkout is clean. Cache
publication uses exact absent-record compare-and-swap.

## Limits and closeout

Each plan or apply reads one local changed-path range (maximum 1,024 paths) and makes one exact live
remote-ref query. It does not fetch, list unrelated branches, or call provider APIs. The exact `--pr`
value is correlation metadata; this command does not verify it or its checks.

The command can restore committed bytes reachable from the exact retained ref. It cannot observe dirty
or ignored bytes that existed only in the missing checkout. The cache record therefore marks those
bytes `unobservable-at-missing-path`; completion, release-common closeout, and both cleanup paths block
while the marker remains. Recover the missing files and obtain an owner-reviewed disposition before
any closeout. Never claim the restored clean checkout proves the missing checkout was clean.
