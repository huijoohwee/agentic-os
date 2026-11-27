---
title: "Measured budget update for unpublished lane abandonment"
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: agentic-os
continuity_id: UNPUBLISHED-LANE-BUDGET-001
prd_revision: 0.1.0
tad_revision: 0.1.0
adr_revision: 0.1.0
mvp_revision: 0.1.0
gtm_revision: 0.1.0
parent_decision: UNPUBLISHED-LANE-ABANDONMENT-001@1.0.0
date: "2026-10-31"
lang: en-US
frontmatter_contract: required
load_policy: on-demand
---

# Measured budget update for unpublished lane abandonment

## PRD

The unpublished-lane abandonment candidate adds a 283-line lazy CLI owner, 19 lines to the existing
cleanup-record owner, and 13 lines to completion status. The measured repository totals are 52 `src`
modules / 16,572 lines and 114 CLI modules / 25,153 lines. Existing aggregate guards stop the candidate.
Update only these measured caps; preserve the 450-line module cap, all runtime limits, the 258-suite
inventory, always-load bytes, and effect budgets.

## TAD

Change `bin/agentic-os-module-budget.mjs`, its existing `runtime-budgets` regression suite, and
`docs/BUDGETS.md`. Keep the new command owner under 450 lines. No module per-scenario pattern, new
suite, dependency, runtime copy, provider effect, or always-load growth is admitted.

## ADR

Set source lines to 16,572, CLI modules to 114, and CLI lines to 25,153, exactly matching the measured
candidate. Keep source module count at 52, per-module lines at 450, runtime at 97 / 23,023, and tests
at 258 suites. The module budget change adds one lazy command owner for recoverable abandonment; it
preserves all dirty bytes and refs, and does not retire branches or objects.

## MVP

Four reserved paths: module budget guard, its existing regression suite, budget documentation, and
this plan. No new `src` modules or tests; diff <=20 KiB; ETA 20 active minutes. Run the module guard,
focused runtime-budget suite, and then the feature lane's complete `npm run check` after integration.
No paid services, runtime/deployment changes, or always-loaded bytes.

## GTM

Internal source-maintenance change only. It claims no product activation, deployment, runtime benefit,
or storage savings.
