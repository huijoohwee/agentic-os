---
title: "Coordinated repository work without repeated closeout"
doc_type: PRD-TAD-ADR-MVP-GTM
version: 0.1.0
continuity_id: AGENTIC-OS-CROSS-REPO-ECONOMY-001
owner: agentic-os
date: 2026-11-11
load_policy: on-demand
upstream: PRD-TAD-ADR-ADLC-PIPELINE-001
---

# Coordinated repository work without repeated closeout

## PRD

**Pain:** A coordinated change across repositories can serialize independent edits, checks, approvals,
main syncs and cleanup, while remote drift triggers repeated whole-task review.

**Outcome:** One bounded execution plan groups independent repo work, requests exact uncovered effects
together, and limits drift rechecks to the affected repo.

### Acceptance

- One preflight inventory records each repo's canonical/base head, active lane or PR, paths, dependency
  order, required checks, and uncovered effects.
- Reuse one unpublished lane/open PR per repo and one required check run per final candidate. Split only
  when a real dependency or reserved-path conflict requires it; preserve published history.
- Batch disjoint edits and checks within resource caps. Merge exact reviewed heads in dependency order.
- Present all ready exact-effect approvals together. Reuse grants only for the same target, candidate,
  effect and parameters. Drift refreshes only the affected plan and checks.
- Sync each repo's canonical branch once after its final merge; perform one cleanup pass after merges,
  retaining every native per-effect receipt and user-authored byte.
- Keep protected checks, exact authority, effect separation, delivery gates and fail-closed behavior.

## TAD and ADR

Reuse START, existing per-lane `complete-adlc`, provider checks and native receipts. No coordinator,
multi-repo transaction, approval inference, new ledger, module, dependency or service is added: GitHub
merges, canonical syncs and local cleanup are independent effects and cannot be made atomic. The shared
runtime prompt is the sole universal rule; consumers use it instead of copying variants.

## MVP and resource cap

Update AOS agent instructions and release workflow only. Keep the always-loaded prompt at its existing
999-byte contract and total authored change below 5 KiB. Use required repo-owned
checks once on final source; do not add or run broad suites for unchanged repos. No new module,
dependency, paid capacity or background observer.

## GTM and rollback

Expected benefit is fewer operator waits and redundant checks; time, token and cash savings are unknown
until compared with another task of similar repo count and change scope. Free/FOSS only. Roll back with
an ordinary reviewed source revert, retaining prior work and receipts.
