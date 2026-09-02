# Lifecycle completion

Lifecycle records are operation-neutral and separate observation, provider authority, integration,
retirement, and cleanup. Every later operation joins exact earlier bytes and reobserves its live trust root.

## Stable package surfaces

- `agentic-os/records/completion` owns canonical effect plans and deterministic transition receipts.
- `agentic-os/adapters/github-authority-client` revalidates an initial GitHub authority issuance.
- `agentic-os/adapters/github-transition-client` validates read-only Actions inputs and run names.
- `agentic-os/adapters/github-transition-authority` prepares proof, publishes CAS, and replays winners.
- `agentic-os/adapters/github-transition-policy` validates the committed exact-target policy.
- `agentic-os/adapters/worktree-cleanup` assesses and executes quarantine-only cleanup.

An effect plan binds the exact target, candidate, snapshot, predecessor, authority, closed effects, and
parameters. Its request cites `effect-plan:sha256:<planByteDigest>` exactly once. Structural validators do
not authenticate GitHub; provider-live adapters do.

## Read-only authority dispatch

The ACOS Actions workflows validate authority inputs only. They have no publication token, network result,
artifact, or log authority. A transition takes exactly two required string inputs:

- `operation_payload`: exact canonical UTF-8 transition input bytes;
- `operation_input_digest`: lowercase SHA-256 of those exact bytes.

The payload is `{schema,request,plan,planByteDigest,predecessorIssuance}`. Integrate carries the exact initial
issuance; retire uses `null` and locates the prior winner by its source fence. No result fields are inputs.
The two-input object is bounded by GitHub's 65,535-character limit.

The exact run name is:

```yaml
run-name: ADLC transition ${{ inputs.operation_input_digest }} @ ${{ github.workflow_sha }}
```

`agentic-os-transition validate-event` reads only the bounded event file and the canonical committed policy.
It requires `workflow_dispatch`, attempt 1, identical `GITHUB_SHA` and `GITHUB_WORKFLOW_SHA`, and exact
repository, canonical ref, and workflow path. The policy contains an exact target repository allowlist;
prefix or payload-selected authority is invalid.

Dispatch with GitHub API version `2026-03-10`, `return_run_details:true`, and retain the provider-returned run
ID and URLs. Never discover authority by listing runs. Wait for that exact run to complete successfully.

## Local create-only transition authority

After terminal success, a local controller uses an authenticated `gh` user credential. It reads the exact
committed policy and target Administration evidence, then publishes one create-only child under
`refs/heads/adlc/authority/<coordinate>`. This flat namespace is covered by the immutable authority ruleset.
The workflow token never publishes. A first owner-local publication requires the authority canonical ref still equals
the workflow SHA; historical replay permits later canonical advancement.

The coordinate is keyed only by evidence repository, target repository, source claim, epoch, and fence. It
excludes operation, plan, request, and run, so one source has only one successor. Exact-input replay returns
the winner; different bytes conflict. Lost and non-201 create-ref responses trigger an immediate exact read.

The winner binds run timing, policy, provider proof, and publication. Integrate revalidates initial issuance,
PR head, canonical ancestry, exact checks, passing rule suite, ruleset versions, and merge method. Omitted
bypass actors are unobserved, never zero. V1 supports merge and squash only. Retire revalidates and sources
the exact integrate winner, including identities, scope, write set, candidate, snapshot, and repository.

The deterministic receipt advances the lease by exactly one and uses the CAS coordinate as its fence. Live
observation time is not hashed into the semantic receipt. Existing immutable winners can be reconstructed
after expiry, but that replay authorizes no new effect.

## Dirty worktree quarantine

Profiles retain every cleanup target by default. Quarantine is reachable only when the trusted committed
profile selects it for both `worktreeProjection` and `worktreeRegistration`. Branches, recovery refs,
reflogs, peer registrations, objects, and every other cleanup target remain retained.

Preservation and no-value records are local structural observations, not independent provider credentials.
Their exact digests are bound transitively by the live-authenticated retirement plan:
`parametersDigest -> cleanup plan bytes -> evidence digests`. The eligibility digest is explicit local
executor confirmation, not provider authority. Eligibility and execution both require immediate live replay
of the exact integrate and retire CAS winners and byte-equality with the supplied deterministic receipts.

The observer rechecks trusted profile, canonical revision, dirty inventory, admin, peers, refs, reflogs, and
objects. Alternates fail closed. Plans set byte and entry ceilings; no-follow reads recheck file identity.

Execution holds the clone-common operation lock and journals before effects. It renames the exact projection
into clone-private quarantine, proves the now-missing projection registration is exactly prunable, then
renames only that admin registration. These two renames are crash-recoverable, not atomic. The executor never
starts the journal or first rename after expiry; after the first rename it finishes that bounded journaled
operation or retains the partial coordinate. It never calls worktree remove/prune, updates refs, runs garbage
collection, deletes bytes, or quarantines canonical.

Replay requires both quarantines and shared state to match. Partial or drifting coordinates stay retained and
blocked. `operatingSystemExclusivityProven:false` disclaims exclusion of uncooperative same-user processes.
