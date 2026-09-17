---
title: Protected CI evidence reuse
doc_type: PRD-TAD-ADR-MVP-GTM
continuity_id: CI-EVIDENCE-001
version: 1.1.0
prd_revision: 1.1.0
tad_revision: 1.1.0
adr_revision: 1.1.0
mvp_revision: 1.1.0
gtm_revision: 1.1.0
owner: agentic-os
status: protected-consumer-reuse-observed
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
all 86 tests and the fresh evaluators passed in 37.74 seconds. This local observation
does not establish a production saving.

Protected consumer observation on 2026-09-14: OS [PR #154](https://github.com/huijoohwee/agentic-os/pull/154)
passed its required checks and merged as `4a8aaa70174a4892612b1d219518db37a287cf75`.
Graph [producer run 34867024729](https://github.com/huijoohwee/agentic-graph/actions/runs/34867024729)
passed canonical integration in 226 seconds and XR review checks in 291 seconds on
`9bc10287428cdb487e96f9a7c68ae4981fbdc697`. Its sealed evidence is 1,535 bytes.
[Consumer run 34868416813](https://github.com/huijoohwee/agentic-graph/actions/runs/34868416813)
verified that evidence in a 10-second composite step and skipped one duplicate
`npm run ci:integration` command. Receipt input digest:
`57a213472e189101ab3a8a6f36d4d92f4af57481e02555d97bfd6fb1910df0b0`;
producer artifact ID `10357158557`; `reused:true`, `authority:false`.
These are observed step durations and one avoided command, not a general speed benchmark.
The consumer subsequently failed source-to-mirror parity because the schema document map
lacked the new guide; deployment did not run. Build, parity, browser, human authorization,
production availability and live sign-in retain separate results.


## Merged source-plan reuse / CI-EVIDENCE-002

PRD: the same Graph tree was validated by PR run 35202961742 and main run 35205041378.
Mission validation took 518 and 567 seconds respectively; neither repetition nor a faster single
sample establishes improvement. The release maintainer should execute a stable source plan once,
then explain reuse through its original run while retaining current commit-specific checks.

TAD: opt into `agentic-os/ci-evidence-policy/v2` with `reuse: merged-pr-tree` for a declared
source-only command. Version 1 remains the exact-revision release contract. This is one shared
owner with two explicit input-binding contracts, not a second cache or runner. Version 2 seals
same-repository PR merge-checkout evidence and names its artifact
`agentic-os-ci-source-evidence-<run>-<attempt>`. Main lookup requires the current protected tip,
one exact merged PR, matching repository identities, the latest successful PR run/attempt, a
successful named job/step, and current artifact identity. Verification reobserves all provider
facts and resolves the tested merge commit's tree and both parents against the merged PR.
Only the primary source revision may differ; tree, policy, helper bytes, dependencies, runner
image, tools and declared environment remain exact. No fuzzy match or older-pass fallback exists.

Consumer ownership: classify source-only checks and bind the exact expanded command selection.
Keep PR metadata, merge/branch identity, mutable services, production/runtime readiness and
approval gates outside the reusable plan. Do not omit an input simply to obtain a hit. A mismatch
runs the original plan and reports the failed binding. Provider reads are capped at twelve calls
and thirty seconds; the existing pinned download action still owns archive handling.

ADR: reuse same-tree PR evidence only by explicit opt-in and a provider-verified merge join.
Do not promote unsigned local receipts into provider proof. `recordCiStageReuse` projects only a
verified result into the existing stage store: original run/revision linkage, current target,
per-stage reused status, no fresh execution duration and unknown resource consumption. It does
not add old CPU, memory, tokens or cash to current totals or train performance feedback on reuse.
Existing JSON/SSE, CLI and MCP observation paths read that single stage store.

MVP: tests cover distinct revisions with equal trees, parent/merge/fork mismatch, newer failures,
changed tools/dependencies/environment, preserved exact-revision semantics and native reused
observations. Adoption requires the protected OS revision and source-owner workflow checks.
GTM: measure avoided command executions and lookup overhead on a real PR-to-main transition.
There is no paid infrastructure, production authority, guaranteed latency or cash-saving claim.
