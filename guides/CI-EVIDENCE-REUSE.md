---
title: Protected CI evidence reuse
doc_type: PRD-TAD-ADR-MVP-GTM
continuity_id: CI-EVIDENCE-001
version: 1.0.0
prd_revision: 1.0.0
tad_revision: 1.0.0
adr_revision: 1.0.0
mvp_revision: 1.0.0
gtm_revision: 1.0.0
owner: agentic-os
status: source-validated-consumer-integration-pending
load_policy: on-demand
---

# Protected CI evidence reuse

## PRD / CI-EVIDENCE-001

The release maintainer reuses one already-passed source check to reduce repeated CI compute.
Graph release run `34851156370` repeated `ci:integration` for 862 seconds on source
`413d798dfdec86d262eeacf03a2885bd658ca8d2` after its protected main Integration Gate passed.
This is an observed duplication, not a measured saving from this implementation.
The user authorized improving release, CI, Integration Gate and runtime economics on 2026-09-14.
Paid plans, extra services, widened permissions and automatic production approval are excluded.

| Criterion | Owner and validation |
|---|---|
| C1: skip a declared command only for exact inputs and successful protected execution | Shared helper; positive reuse test |
| C2: reject fork, stale, failed, skipped, partial and changed evidence | Provider/receipt rejection tests |
| C3: reobserve the provider after downloading evidence | Attempt and artifact drift tests |
| C4: unavailable evidence runs fresh validation | Consumer workflow fallback and CLI disposition |
| C5: build, browser, live runtime and human authorization remain separate | Consumer release workflow |

## TAD / CI-EVIDENCE-001

`bin/agentic-os-ci-evidence.mjs` is loaded only by an opted-in workflow. It reuses the
existing GitHub adapter, Git input reader, SHA-256 and canonical JSON. No dependency,
daemon, always-loaded module, artifact downloader or second validation runner is added.

The consumer owns `.agentic-os-ci-evidence.json`: repository, protected branch, workflow,
job, step, exact command, at most eight sibling Git dependencies, up to 32 relevant
environment names and maximum age (at most one day). Capture binds committed policy,
clean tracked source/dependency revisions and trees, exact Node version, OS/architecture,
GitHub-hosted runner image/version, helper bytes and a digest of declared environment values.
No environment values or credentials are serialized. Undeclared ignored inputs, mutable
external resources and live probes are not covered; those checks must remain fresh.

The producer captures before its check and seals only after unchanged-input success,
on a push to the selected branch. It uploads `evidence.json` under the helper's
run-and-attempt-specific artifact name. The consumer looks up the latest matching push;
it never walks backward past a failed, pending or cancelled run to find an older green run.
The branch must still be protected and at that exact source revision. The selected job and
step must pass, and the artifact must belong to the same repository, run, revision and attempt.

The existing pinned GitHub download action retrieves the selected artifact. Verification
reobserves current provider metadata, then compares the downloaded evidence with fresh local
inputs and the original lookup. An absent, expired, oversized or mismatched proof reports
`reused:false`; the consumer executes its original command. No result grants release authority.

CLI phases use `--name=value` options:

```sh
CI_EVIDENCE=node_modules/agentic-os/bin/agentic-os-ci-evidence.mjs
node "$CI_EVIDENCE" capture --policy=.agentic-os-ci-evidence.json --output=/tmp/before.json
node "$CI_EVIDENCE" seal --policy=.agentic-os-ci-evidence.json \
  --before=/tmp/before.json --output=/tmp/evidence.json
node "$CI_EVIDENCE" lookup --policy=.agentic-os-ci-evidence.json --output=/tmp/lookup.json
node "$CI_EVIDENCE" verify --policy=.agentic-os-ci-evidence.json \
  --lookup=/tmp/lookup.json --evidence=/tmp/download/evidence.json --output=/tmp/reuse.json
```

Records are limited to 64 KiB, run lookup to ten results, jobs/artifacts to 100 each,
and provider lookup to eight calls within 30 seconds using the existing bounded adapter.
Git reads retain existing ten-second and 16 MiB bounds. Artifact download remains consumer-owned.
Only GitHub-hosted workflows on github.com are supported initially; unsupported environments
retain the fresh path. This is explicit provider scope, not a universal provider claim.

## ADR / CI-EVIDENCE-001

Choose protected provider evidence over portable local result caches: local receipts cannot
prove another host's execution. Keep matching conservative rather than treating a commit alone
as sufficient. Use the existing artifact action instead of implementing archive extraction.
Do not modify an already-authorized production candidate. Graph adopts a reviewed, pinned OS
revision in a subsequent source change; existing integrations remain unchanged until adoption.

## MVP and GTM / CI-EVIDENCE-001

The first consumer is Graph's repeated release source check. Acceptance requires shared tests,
required OS CI, Graph workflow validation, and one real producer/consumer evidence reuse receipt.
Record actual elapsed lookup time and avoided command count only after that run. Buyer demand,
WTP and paid conversion are unverified. The immediate value is less waiting for a solo maintainer;
production availability and live sign-in remain separately measured release outcomes.

Validation source: `__tests__/ci-evidence.test.mjs`. GitHub provider contracts:
[artifact metadata](https://docs.github.com/en/rest/actions/artifacts) and
[artifact sharing](https://docs.github.com/en/actions/tutorials/store-and-share-data).

Local validation on 2026-09-14: the existing affected runner selected 12 of 109 suites;
all 86 tests and the fresh evaluators passed in 37.74 seconds. No production saving is
claimed by this result. Required protected CI and the Graph consumer receipt remain pending.
