# Lane State Machine

The lane is the unit of the Agent Development Lifecycle (ADLC). One machine owns every lane scenario.
`src/lane-state.mjs` is the executable copy of this document and holds no I/O. Adding a scenario
means adding a row here and a row in the table there, never a new controller, adapter, evidence
writer, and store.

## Identity

A lane is `agent/<device>/<scope>`:

- `device` — lowercase host segment, so two machines cannot collide on one scope.
- `scope` — lowercase hyphenated noun for the write set, unique among open lanes.

The branch name is the whole coordination surface. There is no lease registry, no fence epoch, and
no compare-and-swap ledger. The merge queue is the serialization point; the PR is the claim.

## States

| State | Meaning | Terminal |
|---|---|---|
| `planned` | Lane recorded, no worktree or branch yet | no |
| `active` | Worktree registered, branch bound, work in progress | no |
| `published` | Branch pushed, PR open, not yet enqueued | no |
| `queued` | PR accepted into the merge queue | no |
| `integrated` | Content proven present on `origin/main` | no |
| `retired` | Worktree removed, branch deleted | yes |

## Events and legal transitions

| From | Event | To | Guards |
|---|---|---|---|
| `planned` | `provision` | `active` | `wipWithinCap`, `baseFetched`, `scopeFree` |
| `active` | `author` | `active` | `onLaneWorktree` |
| `active` | `publish` | `published` | `clean`, `hasCommits`, `pushed` |
| `published` | `enqueue` | `queued` | `queueEnabled`, `prOpen`, `checksNotStale` |
| `published` | `restack` | `published` | `ejectedOnce` |
| `queued` | `eject` | `published` | none |
| `queued` | `integrate` | `integrated` | `integratedProof` |
| `active` | `integrate` | `integrated` | `integratedProof` |
| `published` | `integrate` | `integrated` | `integratedProof` |
| `integrated` | `reap` | `retired` | `integratedProof`, `noOwnedUntracked` |

Anything absent from this table is illegal and returns a typed refusal.

## The two transitions that remove the livelock

`queued` has no `restack`. A queued lane never moves its own base. The queue tests the lane on a
speculative branch ahead of `main`, so an out-of-date base is the queue's problem, not the author's.

`published --restack--> published` requires `ejectedOnce`. One ejection buys exactly one restack.
A lane cannot circle: restack, requeue, fall behind, restack again. If it is ejected twice, the
lane is wrong, not stale, and the refusal says so.

## Typed refusals

Every blocked transition returns one of these. They name the upstream owner, never a cleanup task.

| Reason | Meaning |
|---|---|
| `blocked-illegal-transition` | The event is not defined for this state |
| `blocked-wip-cap` | Device is at the open-lane cap; land something first |
| `blocked-stack-depth` | Stack is at the depth cap; land the bottom of the stack |
| `blocked-main-authoring` | The write target is the canonical `main` worktree |
| `blocked-dirty` | Uncommitted tracked changes in the lane worktree |
| `blocked-owned-untracked` | Untracked authored files exist; they stay in place, lane cannot retire |
| `blocked-no-queue` | The merge queue is not enabled on the protected branch |
| `blocked-not-pushed` | Local commits are not on the remote lane ref |
| `blocked-no-pr` | No open PR for the lane ref |
| `blocked-stale-checks` | Required checks have not run on the current head |
| `blocked-not-integrated` | No integration proof, so nothing may be deleted |
| `blocked-restack-exhausted` | A second restack was requested; escalate instead |
| `blocked-scope-taken` | Another open lane already owns this scope |

## Integration proof

`retired` is reachable only with one of three proofs, in falling strength:

1. `ancestor` — the lane head is an ancestor of `origin/main`.
2. `source-head-trailer` — a commit on `origin/main` carries `Source-Head: <lane-head-sha>`.
3. `patch-identity` — every lane commit is patch-equivalent to a commit on `origin/main`.

Squash merges destroy proof 1, which is why proofs 2 and 3 exist. Proof 2 is deterministic and comes
free once the queue's squash message carries the trailer. Proof 3 is the fallback for history that
predates the trailer. No other signal counts: not review state, not mergeability, not branch age,
not a passing check, not the absence of a diff in a UI.

## Owned untracked state

A file first observed after the lane baseline is authored state, not residue. It stays byte-for-byte
in its owning worktree. `reap` refuses the lane, and the refusal is `blocked-owned-untracked`. Do
not stash, ignore-mask, relocate to `main`, or adopt it under another lane.

## Split work

A goal spanning repositories or write sets is a dependency-ordered set of lanes, never one lane with
a wide scope. A blocked lane blocks itself and its dependents only. A disjoint lane may proceed and
may record that it observed the blocker, but may not clean, adopt, or move another lane's bytes.
