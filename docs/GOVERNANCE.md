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
committed target-owner namespace, exact canonical input/policy bytes, run start/completion, active workflow,
and equal protected ref/workflow revisions. A claim requires its authenticated owner and exactly one
digest-bound effect plan; claim ID, lease epoch, and root operation form the create-only CAS coordinate.
The stored bundle has no transition receipt. The issuer binds exact target repository, branch, revision,
pull-request, owner, status-context, Actions integration, and merge-method projections. Evidence creation
uses one active zero-bypass ruleset with exact update, deletion, and non-fast-forward immutability;
creation restrictions, extra rules or rulesets, and every bypass actor fail closed. Publication is an
absent-ref, create-only compare-and-swap. Its authenticity comes from the exact owner-bound
workflow run, bundle, commit, tree, blob, and live re-observation, not from the identity of the ref creator.
A repository writer can win the absent-ref race with a conflicting value and deny availability, but that
value cannot authenticate as the requested authority; an exact winner is only an idempotent replay. Only
after re-reading the run completion, canonical and evidence refs, commit time, target state, stored
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

The anchor lives in Git's common directory, so every worktree of one clone observes the same
identity. It omits `profileDigest`, so capabilities, checks, and adapters may evolve; a repository-name
or canonical-ref change is an identity rotation. v1 has no implicit rotation or recovery: a missing,
malformed, unsafe, or conflicting anchor blocks repository-bound commands, setup never replaces it,
and no lane profile, sibling repository, remote metadata, or environment value may reconstruct it.
The anchor only selects which clone may supply policy; it grants no authority (see Trust boundary).

The v1 profile fixes runtime and release authority to `consumer`. Cleanup defaults all six targets to
`retain`. A profile may explicitly select `quarantine` only for both worktree projection and registration;
it then derives `quarantine-worktree-cleanup-opt-in` instead of `retain-all-cleanup`. Remote-tracking refs,
branches, and unreachable objects always remain retained. No adapter can promote itself or translate
legacy deletion into `retire`.

Provider-policy capabilities are explicit per consumer: pull-request integration, merge-queue
ordering, strict checks, squash-only or squash-preferred integration, and linear history. Merge-queue
ordering and strict checks conflict. Check names and canonical refs come from the profile. The v1
vocabulary is closed: unknown names are rejected; new semantics need a contract revision. Provider-bound
capabilities and required checks need a selected provider adapter.

`agentic-os observe` emits a shallow, profile-bound repository observation as JSON; `--deep` opts
into raw tracked-byte hashing and `--provider` adds a provider projection. `agentic-os request
<operation> --input=<json>` canonicalizes an unsigned Coordination Request without Git or adapter
access. Neither command acquires authority or performs cleanup. Provider observation dispatches only
the profile's exact adapter ID and version; unsupported adapters fail before provider access.

### Compatibility imports

The only declared migration imports are `agentic-os/compat/git`, `lane-id`, `lane-records`, and
`worktree`. They replace old unpublished `agentic-os/src/*` observation imports without effects.
New consumers use the root records API or named adapters; these are not a second lifecycle controller.

## Reference adapters

The Git adapter is read-only and binds every present registered worktree to the observed clone using
direct-directory, realpath, inode, repository-root, and common-directory checks. It validates the
configured fully qualified refs before passing them to Git. Default `shallow` observation retains its
v1 raw tracked-content contract and reports visible untracked ownership. `deep` additionally records
exact drift paths and ignored ownership. Doctor uses the separate `structural` health mode: it checks
raw HEAD-to-index state (including intent-to-add), structural deletion or mode/type changes, and hidden
index flags without reading tracked content or executing checkout filters. Same-type content, symlink
targets, and nested submodule state are deferred, so `operationallyClean` is `null` unless structural
evidence makes it `false`. Owned paths carry an explicit `ownedPathScope` (bounded sample, count, and
digest) and never make it false. Lane publication rejects visible untracked paths but skips ignored-only
ownership such as dependency trees and caches.

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
Neither adapter owns runtime or release authority or performs cleanup. Transport or HTTP success, a
green check, or a merged review is only a projection until the consumer records its authenticated
authority transition.
