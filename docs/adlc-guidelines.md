---
schema: agentic-os/adlc-guidelines/v1
title: ADLC Guidelines
doc_type: guidelines
version: 1.4.0
owner: agentic-os
universal_scope: true
supersedes: agentic-sdlc
runtime_contract: enforced
runtime_evaluator: npm run evals
execution_policy: lean-time-bound-budget-driven-sprints
load_policy: lazy-beyond-always-load
integration_policy: minimal-diff-protected-merge
runtime_policy: fail-closed
lifecycle_status: active
---
# ADLC guidelines

ADLC supersedes Agentic SDLC. Consumers own product/deploy/rollback/authority.

- PRD-TAD-ADR ID + exact revision owns scope/acceptance/design/decision per transition.
  Reference it; stale joins block only that transition.
- Zero spend; require FOSS. No paid tiers/overages; free hosting is not FOSS. Unknown cost/license blocks.
- START/resume opens Mission: link current codebase/workflow manifests; reuse unchanged evidence.
- START -> RELEASE -> DEPLOY is universal; consumers bind local mechanics.
- Minimize time-to-production: smallest valuable vertical diff; fix owner, remove replacements.
- Continue covered authority across turns; preflight before asking; never infer new authority.
- Lean bounded sprints state TTP ETA and time/byte/module caps; refresh on drift. External waits state
  dependency/condition/recheck, never ETA.
- Global prompt: exact LF-terminated UTF-8, at most 1,000 bytes; code points secondary, tokens advisory.
- New always-load guidance/modules declare deltas; otherwise replace, lazy-load, or reject.
- Run root/upstream `npm run evals` continuously in CI; consumers reference, never copy, it.
- Lazy-load `../guides/AUTONOMOUS-GOAL-PURSUIT.md` for delivery planning or repeated mechanical failure,
  `../guides/PRD-TAD-ADR-MVP-GTM.md` (pipeline) for a transition's owner/check.
- Canonical is read-only. Edit owner files in disjoint path-scoped lanes; overlaps wait. Land stages,
  commits, and publishes reserved paths. Land the exact committed diff by protected merge.
- Exact candidates; proof/retirement/cleanup target/sync/deploy/rollback each need an authorized receipt.
- Cleanup: exact eligible targets after value closure; no wildcards. Prove bytes/paths/refs/races.
