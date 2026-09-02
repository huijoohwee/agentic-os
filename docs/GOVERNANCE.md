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

An External Authority Evidence v1 record binds one request to an adapter version, authenticated
subject, provider record, challenge and response, candidate inventory, validity window, and derived
replay key. `agentic-os/records/authority-evidence` validates its canonical structure. The record is
not authentication by itself: the selected adapter must re-observe the provider record and prove the
content-addressed replay fence before a consumer accepts the joined transition envelope.

`agentic-os/records/recovery-candidate` binds the observed and canonical branch names, repository,
review, revisions, and opaque inventory digests without local paths or authored bytes.
`collectRecoveryInventory({ cwd, canonicalRef })` from `agentic-os/adapters/recovery-inventory` computes
those digests from raw-byte Git paths and netstring-framed index, content, hidden-flag, and category records.
It compares two complete read-only collections plus HEAD, canonical ref, branch, porcelain-v2, and hidden
state, so ignored-byte or Git-state drift fails closed. `agentic-os/adapters/github-authority` binds it to a
committed target-owner namespace, exact dispatch-input digest, provider-start time, and protected-main
workflow identity. A claim requires the authenticated authority to be its owner and exactly one
digest-bound effect plan; claim ID, lease epoch, and root operation form the create-only CAS coordinate.
The stored bundle has no transition receipt. The issuer binds exact target repository, branch, revision,
pull-request, owner, status-context, Actions integration, and merge-method projections. Evidence creation
uses one active zero-bypass ruleset with exact update, deletion, and non-fast-forward immutability;
creation restrictions, extra rules or rulesets, and every bypass actor fail closed. Publication is an
absent-ref, create-only compare-and-swap. Its authenticity comes from the exact owner-bound
workflow run, bundle, commit, tree, blob, and live re-observation, not from the identity of the ref creator.
A repository writer can win the absent-ref race with a conflicting value and deny availability, but that
value cannot authenticate as the requested authority; an exact winner is only an idempotent replay. Only
after re-reading the canonical and evidence refs, provider commit revision and time, target state, stored
bytes, and unchanged protection does the issuer emit a publication-bound transition receipt.
Issuance record validation is structural only. JSON copied from a file, message, or prior run is never
transferable authority. A later consumer must obtain the exact owner-local issuance bound to the successful
read-only workflow run, call `verifyGitHubAuthorityIssuanceLive` to re-observe exact provider state with a
trusted current clock while `issuedAt <= now < expiresAt`, and separately resolve the digest-bound effect
plan to its exact bytes before considering any effect. Live verification does not approve that plan or
grant merge, deployment, retirement, cleanup, or target-repository writes; those remain separate
consumer decisions.

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

The v1 profile fixes runtime and release authority to `consumer`. Cleanup defaults all six targets to
`retain`. A profile may explicitly select `quarantine` only for both worktree projection and registration;
it then derives `quarantine-worktree-cleanup-opt-in` instead of `retain-all-cleanup`. Remote-tracking refs,
branches, and unreachable objects always remain retained. No adapter can promote itself or translate
legacy deletion into `retire`.

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

### Compatibility imports

The only declared migration imports are `agentic-os/compat/git`, `lane-id`, `lane-records`, and
`worktree`. They replace old unpublished `agentic-os/src/*` observation imports without creating
authority, release, integration, retirement, or cleanup effects. New consumers use the root records
API or the named Git/GitHub adapters; compatibility imports are narrow v1 contracts, not a second
lifecycle controller.

## Reference adapters

The Git adapter is read-only and binds every present registered worktree to the observed clone using
direct-directory, realpath, inode, repository-root, and common-directory checks. It validates the
configured fully qualified refs before passing them to Git. Default `shallow` observation retains its
v1 raw tracked-content contract and reports visible untracked ownership. `deep` additionally records
exact drift paths and ignored ownership. Doctor uses the separate `structural` health mode: it checks
raw HEAD-to-index state (including intent-to-add), structural deletion or mode/type changes, and hidden
index flags without reading tracked content or executing checkout filters. Same-type content, symlink
targets, and nested submodule state are deferred, so `operationallyClean` is `null` unless structural
evidence already makes it `false`. Owned paths
carry an explicit `ownedPathScope` and are a bounded sample, count, and digest; they do not make
`operationallyClean` false. Lane
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
