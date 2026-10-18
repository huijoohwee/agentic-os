# Deploy, Dev-to-Prod promotion, and rollback workflow

Continuity `DEPLOY-WORKFLOW-001@1.0.1`.

This is the global DEPLOY protocol stage. It starts after exact source integration and governs
deploy, Dev-to-Prod promotion, readback, and rollback. Cleanup remains global but repo-local.
Consumers bind local controllers and targets.
Release CI and source merge do not authorize deployment, promotion, or rollback.

## Preconditions

- one exact integrated source candidate and its source release receipt
- one selected product owner, deploy controller, target environment, and route or identity surface
- one observed current deployed baseline and one retained rollback target
- current authorization for the intended environment effect; no inferred authority from earlier lanes
- free-tier and FOSS eligibility confirmed for the selected deploy path before execution

## Owner-operated sequence

1. Bind the exact source candidate, deploy inputs, target environment, and currently deployed baseline.
   Reobserve provider state before acting; do not deploy from a guessed ref, artifact, route, or image.
2. Deploy first to the lowest permitted environment in the owner policy, such as Dev or preview.
   Use the product's native deploy workflow or controller; `agentic-os` does not define a generic
   deploy command.
3. Read back the deployed identity from the live target: version, route, bound configuration,
   storage or schema state, and any required browser or runtime checks for that environment.
4. Promote to Prod only from the exact lower-environment candidate that already passed readback.
   Do not rebuild from a newer source revision between Dev and Prod and call it the same release.
5. Reobserve Prod after promotion and run the product's required runtime, route, browser, and
   settlement or replay checks for that surface.
6. Record the deployment receipt with the exact source revision, deployed identity, environment,
   verification evidence, and rollback predecessor. Deployment and promotion are separate effects
   when the owner controller treats them separately.
7. If verification fails or the owner declares regression, activate rollback only to the exact
   retained predecessor or to the owner's explicit forward-recovery target. Do not substitute Git
   cleanup, branch deletion, or source reset for runtime rollback.
8. Reobserve the post-rollback runtime. If the runtime is ambiguous, preserve the state, stop
   further promotion, and use the owner's recovery workflow instead of retrying blindly.

9. Complete the [planning release handover](./PRD-TAD-ADR-MVP-GTM.md#planning-release-handover):
   update the affected feature list and append the workspace TODO successor with separate Development,
   Production Release and Runtime evidence, remaining work and the next owner action. Record blocked
   or rolled-back outcomes just as explicitly as verified production.

## Boundaries

- Source release, deployment, Dev-to-Prod promotion, runtime verification, rollback, cleanup, and
  canonical sync each keep separate receipts; cleanup never becomes a generic global mechanic.
- Lower-environment success is necessary input to promotion, not production proof.
- CI proves only the selected source candidate and check surface; it does not prove deployed identity.
- A route switch, Worker activation, container rollout, schema migration, and payment replay may have
  different rollback rules; follow the product owner that controls that effect.
- If backward compatibility is unproven, block rollback until the owner supplies a verified recovery path.

## Source-control preflight

Before a consumer builds a Dev-to-Prod candidate, run its exact upstream source checkout:

```sh
node bin/agentic-os-pin.mjs --consumer=/absolute/consumer/root --revision=<full-40-hex-upstream-revision> --source-control
```

The preflight reads only the upstream commit identity, consumer canonical ref, compact tracked-worktree
state, and existing manifest/lock pin. It emits `agentic-os/source-control-preflight/v1`, which binds the
source revisions and trees used to build the candidate. It does not fetch, write a ref, create a checkout,
authorize an integration, or authorize Dev, Production, rollback, storage, or data effects.

Treat a nonzero result as blocked readiness, never as a pass. If a complete report names source drift,
repair the named pin, canonical revision, or tracked bytes and rerun. If no complete report is emitted,
keep the cause unknown until the local/provider observation is available. Retain the successful JSON record
as candidate evidence; the controller must still enforce its own build, Dev readback, same-candidate
promotion, Production readback, rollback, and receipt gates.

Keep the exact successful JSON bytes in the release's existing access-controlled candidate-evidence bundle
and bind their SHA-256 there alongside the upstream and consumer revisions/trees and exact package pin. Do
not create a second source ledger or copy the raw report into a public product artifact. Public provenance
views redact local checkout paths while preserving repository, revision, tree, and pin identity. Reuse
provider metadata already observed for the same candidate; do not fetch full history or repeat source scans
solely to restate an unchanged head, PR, check, tree, or pin. If required bytes are absent locally, hydrate
only the exact shallow source needed for that check. Offline local evidence remains usable for local
decisions, while provider freshness and remote effects remain unknown until their owner observes them.

The Dev deployment/readback and Production promotion/readback receipts must point to the same immutable
candidate digest and source-control report digest. Build once and promote the verified artifact. A rebuild,
pin change, tree change, or missing/mismatched provenance report is a new candidate: stop, rerun the required
source/build checks, and obtain any new effect-specific authorization. Do not carry deployment authority
across candidates.

After RELEASE closeout, `completion status` reports `closeout.nextAction.id` `deploy-workflow`
only when committed `.agentic-os-flight.json` names `production-activation`. Absent that binding,
OS stop is `source_complete`; do not invent a generic deploy command.
The closeout reports `completionScope=source-only` and `adlcState=source_complete` for that
lane. This describes its source and lane closeout only; it makes no delivery claim for another
lane or product.

For that enrolled repo, `closeout.missionState=source_complete` means only source and lane
closeout passed. `closeout.adlcState=delivery_pending` and progressive completion's
`deliveryPending` count keep END ADLC open until the product owner has separately verified
Dev deployment/readback, promotion of the same candidate to Prod, and Prod readback.
The product owner may record those results in `.agentic-os-delivery-dispositions.json` after
following the owner controller. The row binds the exact lane ref/head/paths, candidate revision
and digest, committed evidence path/digest and decision reference. A deployed disposition also
binds source-release, deployment and runtime-verification receipt digests. `completion status`
checks those current source bindings before clearing delivery pending. It does not authenticate
the receipt producer, authorize deploy/promotion/rollback, or turn a source receipt into a
runtime receipt. Retain the full Dev, Prod and Runtime evidence in the committed evidence file.
For a documentation-only lane, `delivery_scope_pending` instead asks the product owner to
check the exact changed paths against deployed artifact inputs. Some documentation is public
content. Keep ADLC open until the owner supplies a bound deploy or no-deploy disposition.
For delivery-bound lanes, `adlcState=complete` requires a valid disposition that closes the
enrolled delivery scope. A preservation lane also needs its bound retirement receipt pair;
`completionScope=retirement-bound` reports `retirement_pending` until that pair validates.
Status values apply to one exact lane and do not summarize siblings.
No-deploy requires a documented reason and is accepted for docs-only paths, or for the single
exact `.agentic-os-delivery-dispositions.json` path when the committed evidence digest binds the
product artifact boundary and the reason says the ledger is excluded from the product artifact.
Later changes to that same ledger may reuse this path-bound evidence after its source lane and
candidate are verified. Any additional path returns to the normal mixed-scope decision. This
observation grants neither a production effect nor a no-deploy exemption for other paths.

See [release workflow](../docs/RELEASE-WORKFLOW.md) for source integration and lane closeout,
[technology and ownership decisions](./TECH-STACK.md) for product-specific deploy boundaries, and
[PRD/TAD/ADR](./PRD-TAD-ADR-MVP-GTM.md) for transition and handover requirements.
