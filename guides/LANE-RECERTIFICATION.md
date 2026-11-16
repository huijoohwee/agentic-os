# Lane recertification after cache loss

Use this only when the clone-common lane cache has no record for one retained `agent/<device>/<scope>` ref.
Ordinary `rebind --mode=restore` still requires an existing record. Recertification reconstructs a record
from retained Git identity under a new plan and leaves integration, provider, retirement, and cleanup
authority unproven.

## Preconditions

- Run from canonical `main` with clean tracked source and a commit matching the selected remote tracking `main`. Unrelated untracked files remain in place.
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

## Mounted unpublished lane

The same `recertify` plan/apply commands also accept the exact existing registered worktree
when its lane record is absent and its remote branch is unpublished. Bind its trusted base
SHA, current head and existing path. The planner inventories committed and local authored
paths, checks disjoint scope, and apply rechecks those exact bytes before restoring the cache
row. It preserves the worktree, index, unrelated canonical drafts and all refs. A mounted
receipt reports `restoredDirtyState: exact-local-inventory`; it does not invent missing bytes.

`status` reports a missing record as `unregistered` without suggesting publication events.
START reuses exact mission recovery when its evidence exists; otherwise it names this rebind
owner. After rebind, continue the same lane and its reserved work through LAND and END.

## Limits and closeout

Each plan or apply reads one local changed-path range (maximum 1,024 paths) and makes one exact live
remote-ref query. It does not fetch, list unrelated branches, or call provider APIs. The exact `--pr`
value is correlation metadata; this command does not verify it or its checks.

The command can restore committed bytes reachable from the exact retained ref. It cannot observe dirty
or ignored bytes that existed only in the missing checkout. The cache record therefore marks those
bytes `unobservable-at-missing-path`; completion, release-common closeout, and both cleanup paths block
while the marker remains. Recover the missing files and obtain an owner-reviewed disposition before
any closeout. Never claim the restored clean checkout proves the missing checkout was clean.

## Provider-verified refresh after a strict-base update

Use this only when a published, mounted PR branch was updated by the provider to satisfy strict
protected-branch checks. It accepts only an open same-repository PR whose exact new head is a
two-parent merge of the recorded lane head and the current protected base. The provider head must
match the exact advertised branch ref, and its tree must match the local merge-tree result. The PR's
current base-to-head paths must remain inside the lane's existing reservation.

```sh
npm run release:common -- rebind plan \
  --ref=<lane> --mode=provider-refresh --pr=<number> \
  --expected-head=<provider-head-sha> --expected-base=<protected-base-sha>
npm run release:common -- rebind apply --mode=provider-refresh \
  --plan=<saved-plan.json> \
  --authorize=agentic-os:provider-lane-rebind:<plan-digest> --stopped
```

Plan and apply each make one exact PR read and one exact remote-ref query. Apply compare-and-swaps
the local lane ref, resets only the stopped mounted checkout to the verified merge head, and then
compare-and-swaps the non-authoritative lane cache. It preserves unrelated visible and ignored
paths, and refuses if an updated tracked path collides with one. The receipt proves local identity
refresh only: it grants no merge, integration, check, cleanup, deployment, or provider-write authority.
