# Public governance contract

`agentic-os` exposes a small provider-neutral coordination boundary. The pure package root and
`agentic-os/records` export deterministic JSON helpers plus four request constructors:
`claim`, `continue`, `integrate`, and `retire`. Repository and review projections are optional
adapters at `agentic-os/adapters/git` and `agentic-os/adapters/github`.

## Trust boundary

The four root operations construct unsigned Coordination Requests. They perform no I/O, acquire no
lease, move no ref, call no provider, and grant no runtime, release, integration, retirement, or
cleanup authority.

`createAuthorityTransitionReceiptEnvelope` and
`validateAuthorityTransitionReceiptEnvelope` create and check a structural JSON envelope only.
Their local SHA-256 digests prove canonical byte integrity, not actor identity or authority.
`isExactReplay` and `findExactReplay` prove exact request-to-envelope linkage, not authentication.
An embedding must verify the operation receipt with its authenticated, fenced compare-and-swap
authority before treating an Authority Transition Receipt as evidence. A locally created or merely
schema-valid envelope is never sufficient to integrate, retire, delete, or clean anything.

## Stable records

A Coordination Request v1 has exactly these fields:

```text
schema repository authoritySubject ownerSubject scope writeSetDigest claimId leaseEpoch
fenceRevision immutableRevision reviewLocator blocker requestedTransition dependentWork
replyLocator observedAt expiresAt requestDigest
```

An Authority Transition Receipt v1 has exactly these fields:

```text
schema repository authoritySubject requestDigest requestedTransition sourceClaimId
sourceLeaseEpoch sourceFenceRevision resultClaimId resultLeaseEpoch resultFenceRevision
resultState immutableRevision reviewLocator operationReceiptDigest transitionedAt receiptDigest
```

Validators reject unknown, missing, noncanonical, accessor-backed, aliased, cyclic, oversized, or
wrong-schema data. Set-like arrays are sorted and duplicate-free. Receipt replay is request-digest,
repository, subject, immutable-revision, review, claim, fence, lease, operation, and time-window
exact. A conflicting replay fails loudly.

`retire` additionally requires a `dependentWork` entry of the form
`effect-plan:sha256:<64-lowercase-hex>`. This binds a bounded effect plan; it does not approve the
plan. Cleanup remains a separate consumer decision and separate receipt family.

## Repository profile

Each governed repository keeps one canonical `.agentic-os.json` at its Git root. The profile names
the canonical local and remote refs, exact adapter IDs and versions, required checks, capabilities,
and configured repository identity. `profileDigest` binds the canonical JSON payload. Use
`loadRepositoryProfile` rather than an implicit environment or sibling-repository configuration.
Every repository-bound CLI command requires this committed profile; only help and repository-free
Coordination Request construction run without one. The harness never invents legacy GitHub,
`main`, `origin`, check-name, or queue defaults.

### Clone-common repository trust

`setup` is the only trust-on-first-use entry point. From the primary worktree on the profile's
canonical branch, it validates the committed profile and setup preconditions before establishing
`<git-common-dir>/agentic-os/repository-trust.json`. An operator must verify the repository identity
and canonical refs before that first setup. The record has schema
`agentic-os/repository-trust/v1` and pins exactly the configured repository identity plus canonical
local and remote refs.

The anchor lives in Git's common directory, not a worktree, so every registered worktree in one
clone observes the same identity. It intentionally omits `profileDigest`: the canonical profile may
adapt its capabilities, required checks, and adapter selection while retaining the same repository
and canonical refs. A repository-name or canonical-ref change is an identity rotation, not ordinary
profile evolution. The v1 harness provides no implicit rotation or recovery path; a missing,
malformed, unsafe, or conflicting anchor blocks repository-bound commands, setup will not replace a
conflicting record, and no lane profile, sibling repository, remote metadata, or environment value
may reconstruct it implicitly.

This anchor answers only which local clone identity may supply repository policy. It is not an
authenticated authority source and grants no claim, lease, fence, review, integration, runtime,
release, retirement, deletion, or cleanup permission. Those decisions remain at the external
authenticated authority and receipt boundary described above.

The v1 profile fixes runtime and release authority to `consumer`. Its cleanup policy fixes all six
effects to `retain`: worktree projection, worktree registration, remote-tracking ref, local branch,
remote branch, and unreachable objects. No adapter can promote itself or translate legacy forced
branch deletion into `retire`.

Provider-policy capabilities are optional and explicit: pull-request integration, merge-queue
ordering, strict fresh-base checks, squash-only integration, and linear history are selected per
consumer rather than imposed by the harness. Merge-queue ordering and strict checks conflict and
cannot be selected together. Required check names and canonical refs always come from the profile.
The v1 capability vocabulary is closed: unknown names are rejected rather than silently ignored;
new semantics require an explicit contract revision. Provider-bound capabilities and required
checks cannot be declared when no provider adapter is selected.

`agentic-os observe` emits a shallow, profile-bound repository observation as JSON; `--deep` opts
into raw tracked-byte hashing and `--provider` adds a provider projection. `agentic-os request
<operation> --input=<json>` canonicalizes an unsigned Coordination Request only. Neither command
acquires authority or performs cleanup. Provider observation dispatches only the exact adapter ID
and version selected by the profile; unsupported adapters fail before provider access. Request
construction is repository-independent and does not access Git or adapter state.

## Reference adapters

The Git adapter is read-only and binds every present registered worktree to the observed clone using
direct-directory, realpath, inode, repository-root, and common-directory checks. It validates the
configured fully qualified refs before passing them to Git. Default `shallow` observation checks the
Git raw HEAD-to-index and index-to-working-tree status, mode, and object-ID fields plus hidden index
flags without hashing every working-tree byte. These fields expose index-only additions, deletions,
and Git-observed mode changes; an all-zero working-tree object field is not a byte identity, and Git
configuration may suppress mode observation. Owned untracked and ignored paths are reported
separately as a bounded sample, count, and digest but do not make `operationallyClean` false. Lane
publication separately rejects visible untracked paths while preserving and skipping ignored-only
ownership such as dependency trees and caches. Opt-in
`deep` mode performs the slower raw tracked-byte audit.

The GitHub adapter derives the remote name from the profile's canonical remote ref. It binds the
host-qualified repository to one unambiguous fetch URL and one equal push URL before provider
access. Review identity also binds the exact source revision, source branch, and profile-derived
canonical base branch; unsafe source-ref argv fails before access.
Review mutation rechecks the exact remote source immediately before each provider write. The
branch-named provider API cannot make that check and write atomic; a raced write is returned as a
`written-but-identity-failed` review-required artifact with its URL when observable, never described
as side-effect-free refusal.
The compatibility `enqueue` export may create or refresh that exact review and recognize an
externally created queue entry; it never arms auto-merge or grants protected-integration authority.
Neither reference adapter owns consumer runtime or release authority, and neither performs cleanup.
Transport success, HTTP success, a green check, or a merged review is only a projection until the
consumer records its authenticated authority transition.
