---
title: "Durable workflows v0.2.0 — runtime handover"
doc_type: "Evidence"
version: "0.2.0"
date: "2026-09-16"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
load_policy: "on-demand"
upstream_continuity_id: "DURABLE-AGENT-WORKFLOWS-001"
upstream_revision: "0.2.0"
---

# Runtime handover

This evidence companion records E1 of the [approved five-role plan][plan]. It adds no requirements.
The 582-line plan cannot hold this source/validation handover within its 600-line bound. PRD, TAD,
ADR, MVP and GTM remain joined at `DURABLE-AGENT-WORKFLOWS-001@0.2.0` in that single owner.
The implementation grant is the user's 2026-09-16 `IMPLEMENT` selection of the v0.2.0 proposal.
E1 is a dependency checkpoint; Graph E2, Commerce E3 and production proof remain separate exits.

| Join | Implemented source boundary | Verification owner |
| --- | --- | --- |
| AC-D09 / TAD-D09 / ADR-D03 | `runtime/agents/agent-toolkit-contract.js` validates task/project/goal and exact repository/path/revision/digest/CID/five-role context. `agent-toolkit-admission.js` requires a fresh trusted resolver before each execution phase. Browser/tool inputs cannot install a resolver or allocation. | `__tests__/agent-economics.test.mjs`: malformed/stale context, changed window/policy, principal isolation |
| AC-D10 / TAD-D10 / ADR-D03 | Existing fenced store owns one atomic allocation record for project/agent/run dimensions. Known usage settles once; unknown/overrun usage holds capacity across process exit. Local executor binds input eligibility to the host-verified context limit and caps output/time. | Economics process-race/reopen/conservation cases; `__tests__/agent-durable-workflow.test.mjs` bounded local executor |
| AC-D13 / TAD-D13 / ADR-D04 | Swarm instrumentation joins run/task/attempt/effect to Toolkit spans. Admission indexes bounded principal queries; detail pages preserve causal links, partial coverage and unknown clock intervals. SQLite and Durable Object adapters reuse existing storage owners. | `__tests__/agent-trace-query.test.mjs`: fan-out/fan-in, paging, authorization, truncation, skew, overlap, effect deduplication and exporter timeout |
| AC-D14 / TAD-D14 / ADR-D04 | Existing evaluation leases bind immutable run/span digests, exact profiles and evidence. Plan-bound evaluation reserves resources. Cohort comparison uses the same eligible population for quality, latency and cost and retains excluded counts. | Toolkit integrity/replay/cohort tests plus trace subject mutation/replay tests |
| AC-D06 / AC-D11 transport prerequisite | Catalog-derived query/trace/compare are read-only; evaluate is idempotent and mutating. CLI, MCP, local host and edge share `runtime/agents/invocation.js`. Responses are bounded and uncached. | `__tests__/agent-run-invocation.test.mjs`, API/Worker tests, package import/closure tests |

The existing pain/market hypothesis is unchanged: a solo seller needs predictable execution and a
reviewable deliverable after interruption. Demand, willingness to pay, machine TCO and ROI remain
unmeasured. Zero incremental provider spend is enforced for these allocations; it is not zero total cost.
Scores cannot grant execution, alter budgets, approve a release or replace a payment receipt.

## Bounds and evidence

Measured implementation: 25 touched runtime files / 285,275 bytes; complete core 28 JavaScript modules /
299,909 bytes. E1's touched-source allowance is refreshed to 30 runtime files / 300,000 bytes because
shared validation, claims and storage protocols were consolidated instead of adding another owner.
The original core cap remains 28 modules / 300,000 bytes, with every authored core file below 600 lines.
Runtime dependencies and net core modules added: zero. Always-load documentation remains below 40 KiB.

Source validation uses `npm run check:affected`, which selects the full 211-suite applicable population
for this contract/catalog change and binds each result to its actual inputs. The earlier fresh-all run was
explicitly interrupted to add immutable run subjects; it is not a passing full-suite receipt. Current
native receipts are under the lane's Git-private `agentic-os-tests/last.json`; required CI attaches the
exact committed candidate's results. This document does not predict a check or integration outcome.
The eight-repository fleet observation found 550 planning artifacts, 17 responsibilities and no findings;
its local input digest is `39721ed9849ec71d0dd22a8d96e0b542179f77b5aa31dcbd8df7bd7cb6455369`.
Local observations confer no provider, cross-device lease or deployment authority.

## Adoption and recovery

Graph consumes the protected package revision through its existing dashboard, table/flow renderer and
same-origin run transport. Commerce supplies a current source resolver, explicit free allocation, verified
local executor, deterministic evaluator and job/receipt reference. Legacy callers remain available; they
cannot opt a plan-bound job out of resource admission. Optional exporters do not own execution accounting.

Preserve prior package/Worker versions and durable records. New allocation records retain unsettled
reservations without TTL refunds; expired execution leases do not prove non-execution. Restore the
admitted policy before resuming a mismatched job. Do not downgrade a host that can ignore active
allocations; prove reader/worker compatibility or retain the new owner while restoring presentation.
No Cloudflare namespace, production route, payment state or generated mirror was changed by E1.
The consumer browser, retained-job rollback, exact deployed version and sandbox receipt exits require
fresh evidence from their respective release owners. No real payment or public availability is claimed.

[plan]: https://github.com/huijoohwee/agentic-os/blob/672b21ebf583ff3d5918d5ddba7821cef2b098ee/guides/DURABLE-WORKFLOWS.md
