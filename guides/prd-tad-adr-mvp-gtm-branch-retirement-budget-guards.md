---
title: "Budget guards and exact branch retirement"
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: agentic-os
continuity_id: BRANCH-RETIREMENT-BUDGET-001
prd_revision: 0.1.0
tad_revision: 0.1.0
adr_revision: 0.1.0
mvp_revision: 0.1.0
gtm_revision: 0.1.0
parent_decision: BRANCH-RETIREMENT-001@0.1.0
date: "2026-10-31"
lang: en-US
frontmatter_contract: required
load_policy: on-demand
---

# Budget guards and exact branch retirement

## PRD

The exact branch-retirement capability is authorized under `BRANCH-RETIREMENT-001@0.1.0`.
The implementation adds one 372-line lifecycle module and 20 lines to the existing governance
owner, for 392 source lines total. It adds ten net CLI lines and one committed regression suite.
Existing guards stop that useful, bounded feature at 51 source modules,
16,161 source lines, 24,856 CLI lines, and 257 test suites. Keep those limits useful by updating each
only to the measured feature boundary and retaining strict over-limit failures.

### Acceptance criteria

- BG-01: Source limits admit exactly 52 modules and 16,553 lines; the unchanged 450-line per-file
  ceiling admits the 372-line owner. Runtime module and line limits remain unchanged.
- BG-02: The existing CLI line limit rises by the measured ten lines to 24,866; CLI module count,
  dependencies, and always-loaded guidance bytes remain unchanged.
- BG-03: Test impact admits 258 suites and fails closed at 259. Retain all other selection behavior.
- BG-04: Existing budget and test-impact suites assert the limits, the maximum accepted inventory,
  and rejection immediately above it.
- BG-05: `docs/BUDGETS.md` agrees with enforced source limits. The documentation-budget test proves
  the always-loaded byte total does not grow.
- BG-06: The original five-path branch-retirement lane remains untouched. No branch refs, objects,
  worktrees outside START, or provider state are modified by these budget changes.
- BG-07: The first shared-governance run selected 258 suites (3,030.8 estimated command-seconds)
  and exhausted 540 seconds after 41 suites. The 900-second rerun recorded 208 passing suites and
  stopped at 903.6 seconds with 46 unstarted; its four reported timeouts were the batch deadline.
  The cold candidate run then reached 1,081.3 seconds against the 1,080-second window and timed out
  only the final packaging suite. Set the shared-contract window to 1,200 seconds; each suite stays
  capped at 540 seconds, concurrency stays four, and all input and receipt checks remain enabled.

## TAD

Change the existing module and test-impact budgets, plus the measured shared-contract batch window.
Extend existing regression suites and keep the budget table synchronized. The feature owner remains
neutral and exact: an opt-in policy, per-ref expiring plans, compare-and-delete apply, and separate
effect receipts. The new source module is one lifecycle responsibility, stays under 400 lines, and
replaces no existing owner. Its ten-line CLI addition is the only executable growth outside `src/`.
Test inventory grows by one because the feature has its own durable safety suite. No runtime copy,
dependency, provider integration, or always-loaded prompt expansion is needed.

## ADR

Authorize only the measured limits required by the parent decision: 52 source modules, 16,553 source
lines, 24,866 CLI lines, 258 test suites, and a 1,200-second batch ceiling only for shared-contract
plans. Keep ordinary batch and per-suite limits at 540 seconds. Do not loosen the test inventory
guard beyond one additional suite, or weaken the 450-line per-module cap. Preserve the always-loaded
budget by making only equal-length corrections in its existing cap table.

## MVP

Thirteen reserved paths in this re-planned candidate: the branch-retirement owner and safety suite,
governance and CLI integration, hook and documentation-budget regressions, existing module and
test-impact budgets, the test runner and its inputs, and this plan. Cap work at 60 active minutes and
96 KiB authored diff. Keep the new lifecycle module under 400 lines and the test inventory at 258
suites. Add no dependencies, runtime copy, provider calls, paid services, or always-loaded bytes. Run
focused retirement and budget regressions plus `npm run check` and its evaluators. Stop if measured
feature deltas exceed these bounds. Rollback is a protected scoped revert; this grants no branch
retirement or workspace cleanup effect.

## GTM

This is an internal maintainability change that keeps exact cleanup capability inside explicit code,
test, and review budgets. No runtime speed, disk savings, or commercial demand is claimed. The
feature's operator value must be measured from exact refs retired and time spent; branch counts alone
do not prove reclaimed storage.
