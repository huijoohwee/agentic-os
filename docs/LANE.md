# Lane State Machine

A lane is the ADLC unit. `src/lane-state.mjs` is this document's I/O-free executable copy and owns
every scenario. Add scenarios as table rows, never new controllers, adapters, evidence writers, or
stores.

## Identity

A lane is `agent/<device>/<scope>`:

- `device` — lowercase host namespace used only for collision-resistant branch identity.
- `scope` — lowercase hyphenated write-set label; it does not grant or exclude authority.

Branches, pull requests, and local records are provider projections, not authority. Devices may
reuse a scope under distinct refs. Cross-device exclusion requires an external authenticated,
fenced compare-and-swap claim, which this compatibility machine does not provide.

Lane records are non-authoritative hints stored as immutable Git blobs behind the direct clone-common
`refs/agentic-os/cache/lanes-v1`, advanced only by exact old-object compare-and-swap. Pre-v1
`agentic-os/lanes.json` is read only before that ref exists, identity-bound through first publication,
and retained afterward. Neither cache grants authority. The sole accepted legacy projection is the
retired nonnegative `ejections` count, dropped in memory without rewriting the legacy bytes; any other
malformed or unknown shapes fail closed.

Lane survey inventory is bounded to 256 local `refs/heads/agent/*` branches. At the first overflow
it refuses before classifying or retiring anything; recovery must first partition the retained refs
under authenticated consumer authority.

## States

| State | Meaning | Terminal |
|---|---|---|
| `planned` | Lane or successor activation is pending | no |
| `active` | Worktree registered, branch bound, work in progress | no |
| `published` | Exact remote lane ref present; selected review projection may exist | no |
| `queued` | PR accepted into the merge queue | no |
| `integrated` | Content proven present on the profile's canonical remote ref | no |

## Events and legal transitions

| From | Event | To | Guards |
|---|---|---|---|
| `planned` | `provision` | `active` | `baseFetched` |
| `active` | `author` | `active` | `onLaneWorktree` |
| `active` | `publish` | `published` | `clean`, `hasCommits`, `pushed` |
| `published` | `enqueue` | `queued` | `orderingDelegated`, exact `providerHandoff` receipt |
| `published` | `successor` | `published` | onLaneWorktree, clean, predecessorExact, descendant, destinationAbsent |
| `queued` | `integrate` | `integrated` | `integratedProof` |
| `active` | `integrate` | `integrated` | `integratedProof` |
| `published` | `integrate` | `integrated` | `integratedProof` |

Anything absent from this table is illegal and returns a typed refusal.

## Computed autonomy class

`npm run autonomy:class` derives a committed candidate's promotion ceiling from the merge-base of
the profile's canonical remote ref and `HEAD`; `-- --base=<revision> --head=<revision> --json`
binds another exact range.
Mixed write sets resolve upward through docs-only, test-only, additive-contract, behavioral, and
authority-controlling. A standing grant never covers authority-controlling changes. Modifying,
deleting, or renaming an existing test is authority-controlling; only a newly added test is
test-only. The classifier is deterministic evidence, not a security boundary when executed from
candidate bytes. Candidate-side `land` never arms ordering. A consumer must evaluate promotion
with trusted code and credentials outside the candidate before protected integration.

## Tested provider ordering

`queued` is reached only when an externally authorized adapter re-observes the exact pull-request
head in a native merge queue. An auto-merge request alone is not tested protected ordering, so it
remains `published`. No `restack` or `eject` event is implemented; absent events fail closed.

## Typed refusals

Every blocked transition returns one of these. They name the upstream owner, never a cleanup task.

| Reason | Meaning |
|---|---|
| `blocked-illegal-transition` | The event is not defined for this state |
| `blocked-canonical-authoring` | The write target is the profile's canonical branch worktree |
| `blocked-dirty` | Uncommitted tracked changes in the lane worktree |
| `blocked-no-queue` | The merge queue is not enabled on the protected branch |
| `blocked-not-pushed` | Local commits are not on the remote lane ref |
| `blocked-provider-handoff` | Exact provider head or tested-ordering receipt is absent |
| `blocked-not-integrated` | No integration proof, so nothing may be deleted |
| `blocked-successor-predecessor` | Published predecessor identity is invalid |
| `blocked-successor-descendant` | Local head is not its descendant |
| `blocked-successor-destination` | Successor destination already exists |

## Integration proof

`integrated` is reachable only with one of two exact proofs, in falling strength:

1. `ancestor` — the lane head is an ancestor of the profile's canonical remote ref.
2. `exact-tree-projection` — every path changed by the lane has the exact same Git mode, object type,
   and object ID at the lane head and the observed canonical remote head.

Squash merges destroy proof 1, so proof 2 compares resulting repository content instead of commit
shape. Git patch IDs deliberately ignore some whitespace and therefore remain diagnostic only.
`Source-Head` binds review observations to a requested revision but is forgeable correlation, never
integration or retirement proof.

This compatibility machine has no cleanup transition. `reap` only computes these projections.
The global form retains a strict bounded ref inventory; `reap --ref=<lane>` surveys one exact local
lane ref without treating unrelated retained refs as active authority.
Authenticated `retire(claim)`, clean detachment, and target-specific filesystem cleanup remain
separate public governance operations and receipts.

No other signal counts: not review state, not mergeability, not branch age, not a passing check, not
the absence of a diff in a UI.

## Owned untracked state

A file first observed after the lane baseline is authored state, not residue. It stays byte-for-byte
in its owning worktree. Publication rejects visible untracked paths because they are absent from the
candidate revision. Ignored paths are preserved and reported but do not block publication; dependency
trees and caches are not candidate bytes. Cleanup inventory remains conservative and includes ignored
paths. Do not stash, relocate, adopt, or delete another lane's owned state.

## Split work

A goal spanning repositories or write sets is dependency ordered. A blocked lane blocks itself and
its dependents only. Disjoint work may proceed, but no lane may clean, adopt, or move another lane's
bytes. Cross-device ownership must come from a governance adapter, never this local scope scan.
