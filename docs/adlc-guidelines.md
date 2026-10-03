---
schema: agentic-os/adlc-guidelines/v1
title: ADLC Guidelines
doc_type: guidelines
version: 1.4.1
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

- Exact PRD/TAD/ADR ID/revision owns scope/acceptance/design/decision; stale joins block its transition.
- Zero spend/FOSS; no paid tiers/overages. Free hosting is not FOSS; unknown cost/license blocks.
- START/resume Mission: link current codebase/workflow manifests; reuse evidence.
- Universal START -> RELEASE -> DEPLOY; global cleanup, local mechanics.
- Minimize time-to-production: smallest useful diff; fix owner/remove replacements.
- Reuse covered authority; preflight first; never infer grants.
- Sprint: TTP ETA, time/byte/module caps; refresh on drift. External: blocker/condition/recheck, no ETA.
- One owner/candidate/effect; disjoint decision-changing work; reuse proof/event waits.
  Bounded stale rechecks: `../guides/VALIDATION-ECONOMY-EXECUTION.md` on demand.
- Batch material changes/handoffs in implemented PRD/TAD/ADR/MVP/GTM; unchanged turns need no records.
- Prompt: LF UTF-8 <=1,000 bytes; code points secondary; tokens advisory.
- Declare always-load deltas; replace/lazy-load/reject.
- Run root/upstream `npm run evals` continuously in CI; consumers reference, never copy, it.
- On demand: `../guides/AUTONOMOUS-GOAL-PURSUIT.md` (delivery/failure),
  `../guides/PRD-TAD-ADR-MVP-GTM.md` (transition owner/check).
- Canonical read-only; disjoint owner paths; overlaps wait. Land stages/commits/publishes reserved
  paths; integrate the exact committed diff by protected merge.
- Exact candidates; proof/retirement/cleanup target/sync/deploy/rollback each need an authorized receipt.
- Cleanup: global/repo-local, exact eligible targets, no wildcards; prove bytes/paths/refs.
