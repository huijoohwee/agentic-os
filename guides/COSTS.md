---
title: "Reference Implementation — Portfolio Cost Index"
doc_type: "Cost Index"
version: "1.0.0"
date: "2026-09-23"
lang: "en-US"
owner: "agentic-os"
load_policy: "on-demand"
lifecycle_status: "active"
---

# Portfolio cost index

[`catalog/costs.json`](../catalog/costs.json) joins the [feature roadmap](../catalog/feature-roadmap.json)
to product cost sources. Feature IDs remain stable across past, current and future views. Each feature
resolves to one cost scope, one owner plan and its exact `continuity_id@revision`. A shared cost scope
appears once in portfolio totals; feature rows that share it need an owner allocation before any
feature-level monetary total is stated. The register contains references and evidence gaps, not a
second execution ledger.

The [authoring guideline][guideline] and [Venture Record][venture] at pinned revisions define
financial assumptions, scenarios, cash versus imputed cost and the ADLC Cost Ledger. Each product
plan retains its own pinned guideline revision in the feature roadmap; this central index does not
silently upgrade an older plan. [ADLC Guidelines][adlc] own execution budgets and receipts. Product
owners own TAD budgets, GTM assumptions, serving costs and financial models. Existing
[`docs/BUDGETS.md`](../docs/BUDGETS.md) governs document and module sizes.

## Current pilot

| View | Feature | Cost scope | Owner evidence | Actual / forecast |
|---|---|---|---|---|
| Past | None admitted | — | No retired feature in the roadmap | Unknown, not zero |
| Current | `adlc-scoped-lanes` | `os-scoped-lanes` | [Workflow observation contract][os-cost] | Receipts unlinked / forecast unknown |
| Current | `graph-python-learning` | `graph-python-learning` | [Discovery model and authoring ledger][python-cost] | Development cost unmetered / model incomplete |
| Current | `graph-source-cloud-entry` | `graph-storage-sync` | [Storage TCO assumptions][storage-cost] | Actuals unreported / forecast unknown |
| Future | `graph-local-browser-signin` | `graph-storage-sync` | Same owner TCO source | No separate allocation or scenario |

The Python plan labels its B1–B8 assumptions and Base/Downside/Upside outputs unknown or incomplete;
its authoring ledger records source reads and checks but leaves active minutes, tokens and cash
unmetered. The OS workflow adapter can carry resource observations, including explicit nulls; its
presence is not an actual-cost receipt. The storage TCO source compares optional paid variants; they
are outside this index's zero incremental paid-spend constraint. The Graph owner must select a
free path and measure its quota before delivery admission. No row proves a
payment, free-quota headroom or a complete financial model.

## Cost continuity and budget view

For each cost scope, follow `feature ID → owner plan + continuity ID + exact revision → cost source →
dated receipt or assumption → financial projection`. The [cost register](../catalog/costs.json) pins
the first three joins. A future receipt reference must identify its unique event ID, owner, exact
source revision, task/change ID, period, cost class, unit, actual/estimate label and digest. Check
that reference at its owner before reporting a number. Do not commit private billing or customer
records to this public catalog.

| Measure | Source of record | Missing input |
|---|---|---|
| Development effort and tokens | ADLC task and harness observations | Unknown; do not convert an estimate to actual |
| Provider CI execution and wait | Provider observation at an exact run | Keep execution and waiting separate |
| Serving tokens and infrastructure | Product harness and deployment-model TCO | Unknown COGS; no assumed free capacity |
| Cash paid and collected | Product billing and payment evidence | Unknown; no first-dollar claim |
| Operator opportunity cost | Dated time and stated rate | Unknown imputed cost, separate from cash |

The paid-spend ceiling is **USD 0 incremental** under the [ADLC policy][adlc]. It is a constraint,
not an observed expense. Track free-quota limit, usage, reset and remaining headroom by owner and
period. If any are unknown, remaining headroom is unknown. The owner stops, reduces scope or uses
its local/offline fallback before exhausting free capacity. Budget reporting never authorizes a
paid plan, add-on or overage.

## Financial projection readiness

| Scope | Assumptions | Base / Downside / Upside | Linked monthly statements | Audience-ready |
|---|---|---|---|---|
| `os-scoped-lanes` | Not recorded | Unknown | Not recorded | No |
| `graph-python-learning` | B1–B8 incomplete at owner | All outputs unknown | Owner sketch only | No |
| `graph-storage-sync` | TCO variants only; paid option unresolved | Unknown | Not recorded | No |

This table is a readiness projection, not a financial statement. For an audience model, the owner
must resolve currency, dated assumptions, actuals cut-off, opening balances and accounting basis;
then calculate 12 monthly periods, unit economics, cash flow, balance sheet, runway and three
scenarios using the [Venture Record][venture]. Cash, quota consumption, estimated economic cost
and imputed labor remain distinct. Serving cost enters COGS once; development and recovery cost
enter operating cost once. A shared scope requires an allocation whose weights total one before
per-feature contribution is calculated. Undefined ratios and missing inputs stay unknown.

## Refresh and checks

1. Recheck the exact owner-plan, guideline and cost-source blobs when a feature pin changes.
2. Add receipt references only after owner identity, period, unit, status and digest can be checked.
   Include failed checks, retries and abandoned work when incurred; a merge is not needed to
   recognize development cost.
3. Compare observed usage with the matching period and budget. Keep actual, forecast and reserved
   capacity separate. Reconcile allocations and currencies before a portfolio total.
4. Refresh this view and the model only after the owner updates its assumptions or observations.
   A source check or model calculation grants no integration, spending or deployment authority.

Run `node --test __tests__/cost-index.test.mjs` for the register joins and pinned source checks;
`npm run check` remains the repository gate. The register has no hosted service, runtime model call
or additional production dependency.

[guideline]: https://github.com/huijoohwee/huijoohwee.github.io/blob/993eb0e28a6d2e9427364df98c39c8a5e10910b4/guidelines/prd-tad-adr-mvp-gtm-guidelines.md
[venture]: https://github.com/huijoohwee/huijoohwee.github.io/blob/993eb0e28a6d2e9427364df98c39c8a5e10910b4/guidelines/prd-tad-adr-mvp-gtm-venture.md
[adlc]: https://github.com/huijoohwee/agentic-os/blob/ac9ea610d8ad3771618caa4d528c703908611639/docs/adlc-guidelines.md
[os-cost]: https://github.com/huijoohwee/agentic-os/blob/ac9ea610d8ad3771618caa4d528c703908611639/bin/agentic-os-workflow-observation.mjs
[python-cost]: https://github.com/huijoohwee/agentic-graph/blob/86924949a292949a8aa90d56188c7f625cd0319f/docs/documents/prd-tad-adr-mvp-gtm-offline-python-learning-workspace.md#discovery-financial-model
[storage-cost]: https://github.com/huijoohwee/agentic-graph/blob/86924949a292949a8aa90d56188c7f625cd0319f/docs/documents/agentic-graph-storage-sync-prd-tad-adr-mvp-gtm.part-01.md#tco-comparison
