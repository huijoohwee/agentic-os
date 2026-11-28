# Lifecycle completion

Completion separates observation, authority, integration, retirement, and cleanup.
Under canonical-dev, a lane is not finished until content is proven on the canonical remote ref and the
local canonical checkout is synced to that fetched revision.
`agentic-os completion status --ref=<lane>` is read-only and grants no new receipts.
Guides: [authority](../guides/CLEANUP-AUTHORITY.md), [local](../guides/USER-CLEANUP.md).

## Stable package surfaces

Owned surfaces: `agentic-os/records/completion`, `agentic-os/adapters/github-authority-client`,
`agentic-os/adapters/github-transition-client`, `agentic-os/adapters/github-transition-authority`,
`agentic-os/adapters/github-transition-policy`, and `agentic-os/adapters/worktree-cleanup`.

Effect plans bind target, candidate, snapshot, predecessor, authority, closed effects, and parameters.
Requests cite `effect-plan:sha256:<planByteDigest>` once. Only live adapters authenticate GitHub with bound policy.

Effect plan v4 requires current provider-verified cost evidence; details: [COSTS](../guides/COSTS.md).

## Read-only authority dispatch

ACOS Actions validate authority inputs only. They have no publication token or result authority.
A transition takes exactly two required string inputs:

- `operation_payload`: exact canonical UTF-8 transition input bytes;
- `operation_input_digest`: lowercase SHA-256 of those exact bytes.

Payload: `{schema,request,plan,planByteDigest,predecessorIssuance}`; no results.
Integrate may add `integrationMode` (`retrospective-recovery` or `retrospective-content-inclusion`);
retire uses `null` or fresh `predecessorAuthority` bound to the integration receipt; record-only excludes cleanup.
GitHub limit: 65,535 chars.

The run name:

```yaml
run-name: ADLC transition ${{ inputs.operation_input_digest }} @ ${{ github.workflow_sha }}
```

`agentic-os-transition validate-event` reads only the bounded event file and the committed policy.
It requires `workflow_dispatch`, attempt 1, identical `GITHUB_SHA` and `GITHUB_WORKFLOW_SHA`, and exact
repository, canonical ref, and workflow path. Authority validation is also silent, tokenless, and exact;
prefix or payload-selected authority is invalid.

Dispatch with GitHub API version `2026-03-10`, `return_run_details:true`, retain the returned run ID and URLs,
never discover authority by listing runs, and wait for that exact run to complete successfully.

## Local create-only authority

After exact-run success, local `gh` credentials call `agentic-os-authority issue-github` with exact event,
policy, `--repository`, and dispatch-returned `--run-id`; listing is forbidden. Before create-only publication
it binds active workflow ID/path, equal ref/SHA, completion time, and bearer `/user`. Workflow tokens never
publish. First publication requires canonical ref equals workflow SHA; replay permits later advancement.

The coordinate is keyed only by evidence repository, target repository, source claim, epoch, and fence.
It excludes operation, plan, request, and run, so one source has one successor. Exact-input replay returns
the winner; different bytes conflict. Lost and non-201 create-ref responses trigger an immediate exact read.

Winner binds run, policy, proof, and publication. Integrate rechecks issuance, head, ancestry, rules/checks,
suite, and merge. Canonical-dev completion then requires separate `sync` so the canonical checkout matches the
observed canonical remote ref before retirement or cleanup can describe the lane as ended. Recovery uses
`retrospective-recovery` for a pre-authority merged squash with exact base/head/event, equal trees, live-main
ancestry, and historical suite/check IDs. It rechecks current protection but does not claim those parameters
existed at merge; bootstrap cannot authorize effects. Retire rechecks exact winner identity, scope, candidate,
and repository.

The deterministic receipt advances the lease by exactly one and uses the CAS coordinate as its fence.
Live observation time is not hashed into the semantic receipt. Existing immutable winners can be reconstructed
after expiry, but that replay authorizes no new effect.

## Clean removal and dirty worktree quarantine

The Agentic OS profile selects paired `remove-clean`, retaining refs, reflogs, and objects. Cleanup stays
separately authorized: fresh inventory and reader scans permit no-force removal only when clean; captured
dirty bytes are quarantined, while uncertain state, active readers, or incomplete scans block. Cleanup runs
no garbage collection; use incremental Git maintenance separately. Cleanup-only closeout does not establish
END ADLC; END ADLC requires prior remote integration proof plus canonical sync back to the fetched remote head.

Retirement plans bind preservation evidence. Eligibility digest is local proof only. Git
cleanup or preservation never implies a provider claim; status waits for retirement only with exact integration
proof. Invalid explicit receipts fail closed; status grants no authority.

The observer binds profile and canonical revision and inventories the target, admin, peers, refs, reflogs, and
objects. Alternates fail closed; bounded no-follow reads recheck file identity.

Under the clone-common lock, execution replays winners before effects. Clean removal rechecks inventory and
proves the exact target/admin absent with refs, peers, and objects unchanged. Quarantine journals and renames
only the projection and exact prunable admin registration; those renames are crash-recoverable, not atomic.
Neither mode prunes refs, alters branches, runs garbage collection, or targets canonical.

Replay requires quarantine and shared state to match. Partial or drifting coordinates stay blocked.
`operatingSystemExclusivityProven:false` disclaims uncooperative same-user process exclusion.
