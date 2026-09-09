---
schema: agentic-os/adlc-guidelines/v1
title: ADLC Guidelines
doc_type: guidelines
version: 1.3.0
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

ADLC supersedes Agentic SDLC. Consumers own product/deploy/rollback/authority policy, no controllers.

- PRD-TAD-ADR (continuity ID + exact revision) is the SSOT for scope, acceptance, design, and decision of
  every 0→1 transition; other docs only reference it; a stale join blocks that transition only.
- Free tiers only; zero spend, no paid plans/addons/overages. Software must be FOSS; free hosting is not
  FOSS; unknown cost/license blocks adoption.
- Minimize time-to-production: smallest valuable vertical diff; fix owner, remove replacements.
- Continue safe work; infer no scope/authority/destruction/promotion/deploy/product choice.
- Lean bounded sprints state TTP ETA and time/byte/module caps; refresh on drift. External waits state
  dependency/condition/recheck, never ETA.
- Global prompt: exact LF-terminated UTF-8, at most 1,000 bytes; code points secondary, tokens advisory.
- New always-load guidance/modules declare deltas; otherwise replace, lazy-load, or reject.
- Run root/upstream `npm run evals` continuously in CI; consumers reference, never copy, it.
- Lazy-load `../guides/AUTONOMOUS-GOAL-PURSUIT.md` for delivery planning or repeated mechanical failure,
  `../guides/PRD-TAD-ADR.md` (pipeline) for a transition's owner/check.
- Canonical is read-only. Edit owner files in disjoint path-scoped lanes; overlaps wait. Land stages,
  commits, and publishes reserved paths. Land the exact committed diff by protected merge.
- Exact candidates; proof/retirement/cleanup target/sync/deploy/rollback each need an authorized receipt.
- Clean exact eligible targets only after value closure; no wildcards. Effects need exact byte/path/ref/race
  proofs; structure is advisory.
