---
title: "Budget guards for exact branch retirement"
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

# Budget guards for exact branch retirement

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

## TAD

Change only the existing module-budget and test-impact owners. Extend their existing regression suites
and keep the budget table synchronized. The feature owner is neutral and exact: an opt-in policy,
per-ref expiring plans, compare-and-delete apply, and separate effect receipts. The new source module
is one lifecycle responsibility, stays under 400 lines, and replaces no existing owner. Its ten-line
CLI addition is the only executable growth outside `src/`. Test inventory grows by one because the
feature has its own durable safety suite. No runtime copy, dependency, provider integration, or
always-loaded prompt expansion is needed.

## ADR

Authorize only the measured limits required by the parent decision: 52 source modules, 16,553 source
lines, 24,866 CLI lines, and 258 test suites. Keep all other caps unchanged. Do not loosen the test
inventory guard beyond one additional suite, and do not weaken the 450-line per-module cap. Place the
reason for this cap adjustment in this on-demand decision record; preserve the always-loaded budget
by making only equal-length corrections in its existing cap table.

## MVP

Six reserved paths: two existing CLI budget guards, their two existing regression suites, the existing
budget table, and this plan. Maximum 60 active minutes and 12 KiB authored diff. Zero new modules,
dependencies, runtime changes, provider calls, paid services, or always-loaded byte increase. Run the
focused guard suites and `npm run check`. Stop and replan if measured feature deltas differ from the
values above. Rollback is a protected revert of the guard and table changes; it grants no branch or
workspace cleanup authority.

## GTM

This is an internal maintainability change that keeps exact cleanup capability inside explicit code,
test, and review budgets. No runtime speed, disk savings, or commercial demand is claimed. The
feature's operator value must be measured from exact refs retired and time spent; branch counts alone
do not prove reclaimed storage.
