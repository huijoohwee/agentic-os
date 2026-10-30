---
title: "Reference implementation — Source-Equivalent Local Validation Reuse"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
date: "2026-10-09"
lang: "en-US"
frontmatter_contract: "required"
owner: "Agentic OS validation"
continuity_id: "LOCAL-SOURCE-VALIDATION-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
local_rung: "implementation"
delivered_rung: "unintegrated"
lane: "authoring"
universal_scope: false
load_policy: "on-demand"
worktree_id: "device-0232231d4a19--source-equivalent-validation-reuse"
agent_id: "codex-source-equivalent-validation-reuse"
guideline_revision: "3.4.0"
reviewed_source_revision: "9588777ae8dd145c9f5b1fa7130276ea328cefb2"
implementation_authority: "2026-10-09 user request to improve source validation time and resource economy"
---

# Source-equivalent local validation reuse

This reference implementation reduces repeated local check execution when a commit changes
Git provenance but leaves every check input and the selected plan unchanged. It does not reduce
or replace protected CI, deployment verification, or other production evidence.

## PRD

**Pain.** A maintainer can run a broad source plan, commit the exact same bytes, and then repeat
the plan because local receipts bind the candidate revision or committed mode disables reuse.
This adds avoidable command time, CPU, memory, output, and context-switch cost. A previous task
observed a repeated post-commit plan with zero reusable receipts; retained timings were unavailable,
so this plan makes no elapsed-time or cash-saving claim.

**Users.** Solo builders and release maintainers need one exact local result per source input set,
while retaining fresh protected CI and clear provenance. Economic buyer pain and willingness to pay
remain unvalidated; USD 1 is a hypothesis, not a result.

**Minimum outcome.** Reuse only a passed local check whose command, source inputs, full source plan,
base, owner policy, runtime, environment and log still match. Preserve the prior validation time;
record the current candidate revision separately. Any changed input executes again or remains blocked.

| Criterion | Acceptance / owner check |
|---|---|
| C1 · committed local check | After a local affected check passes, commit the exact checked tree; `--committed` verifies HEAD equality, reuses only matching checks, retains prior `validatedAt`, and reports the new source revision. `__tests__/test-runner.test.mjs`. |
| C2 · whole-source plan | An opted-in `local-plan` receipt remains reusable across a commit with identical source, exact base and same changed-path selection. A changed source, base, selection, policy, runtime or environment invalidates it. `__tests__/repository-validation-process.test.mjs` and `__tests__/repository-validation.test.mjs`. |
| C3 · freshness boundary | CI, `--fresh`, explicit `all`, provider/runtime observations and `reuse: never` execute fresh. Local reuse has `authority: false` and cannot stand in for integration or delivery proof. |
| C4 · time preservation | Reuse never rewrites the original `validatedAt`, extends expiry, or records skipped work as fresh resource consumption. Existing exact logs and one-hour expiry remain required. |

## TAD

The existing two validation owners separate source provenance from check inputs:

- The repository test runner's committed snapshot verifies the complete working source equals
  `HEAD`; eligible per-check receipts continue to bind their declared source digest, command,
  policy, runner, environment, platform and log.
- A consumer `local-plan` receipt binds full source content and modes, the requested and merge-base
  revisions, changed-path selection, owner policy, toolchain and environment. It omits candidate
  commit SHA and index state because those do not change the bytes the declared plan consumes.
- Aggregate receipts retain the current source revision. Reused child results retain their original
  validation time and are labeled reused; no successful check is promoted to provider authority.

Checks that read commit metadata, history, index staging, ignored generated files, mutable services,
or undeclared inputs must use `reuse: never`. `local` keeps its narrower declared-input identity.
Fresh CI and explicit diagnostic modes are unchanged.

## ADR

**Decision:** refine existing local reuse at its two owners instead of adding a cache, mode, module,
daemon, service, dependency, or consumer-specific runner. Keep exact content, baseline, plan, policy,
environment, toolchain and log checks. Reuse is local and bounded by the existing one-hour expiry.

**Rejected:** loosening checks by matching commit names alone; persistent content caches; reusing CI
from local artifacts; disabling a full validation job; caching command results with undeclared inputs.

**Recovery:** a mismatch runs the original local plan. `--fresh` bypasses all local receipts. Revert
the source changes to restore the prior rule; preserve receipts and their logs.

## MVP

Scope is nine existing/new paths, at most 20 KiB added, no new module/dependency, no always-loaded
bytes, one affected local validation run. All files stay below 600 lines. Acceptance covers same-tree
commit reuse, source/base/environment drift, unchanged validation timestamps, and fresh CI behavior.
Protected checks remain the only source integration evidence.

Grounding in the inspected source snapshots:

| Repository | Revision | Existing behavior |
|---|---|---|
| Agentic OS | `9588777ae8dd145c9f5b1fa7130276ea328cefb2` | `bin/agentic-os-validation.mjs` included full Git identity in `local-plan`; `bin/agentic-os-tests.mjs` disabled receipt reuse for `--committed`. |
| Agentic Graph | `a593e2d59e8db70c64e375099c77f4d128509c6f` | `.agentic-os-validation.json` already opts affected source partitions into `local-plan` with `inputs: ["*"]`. |
| Agentic Canvas OS | `45c132b6c9297141dc3b63427427e83ea6df8b34` | `.agentic-os-validation.json` marks its test, build, docs and collaboration checks `reuse: "never"`; this change does not widen those policies. |

## GTM

Free/FOSS local improvement, with no paid plan, add-on, overage, new service or hosting dependency.
Initial proof is the number of commands safely reused and the unchanged evidence timestamps. Compare
elapsed time only from compatible before/after observations. No revenue, production-readiness or
customer-demand claim follows from a passing source check.
