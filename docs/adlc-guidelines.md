---
schema: agentic-os/adlc-guidelines/v1
title: ADLC Guidelines
doc_type: guidelines
version: 1.4.4
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

- Exact PRD/TAD/ADR ID+revision binds scope, acceptance, design and decision; stale joins block.
- Global repo/worktree: USD 0/effect/budget; FOSS/free; verified license; no paid/add-ons/overages/upgrades.
- Each effect needs exact current provider proof: hard $0 cap or deny at quota exhaustion.
  Free allowances/snapshots/alerts fail; unknown cost/headroom blocks.
- START/resume Mission binds current code/workflow; reuse evidence.
- START -> RELEASE -> DEPLOY; global cleanup, local mechanics.
- Minimize time-to-production: smallest useful diff; fix owners, remove replacements.
- Reuse covered authority; preflight; never infer grants.
- Sprint: TTP ETA+time/byte/module caps; refresh on drift. External: blocker/condition/recheck, no ETA.
- One owner/candidate/effect; disjoint work; reuse proof/event waits.
  Bounded stale checks: `../guides/VALIDATION-ECONOMY-EXECUTION.md`.
- Batch material PRD/TAD/ADR/MVP/GTM updates; no per-turn records.
- Prompt: LF UTF-8 <=1KB; code points secondary; tokens advisory.
- Declare always-load deltas; replace/lazy-load/reject.
- Root/upstream `npm run evals` runs continuously in CI; consumers reference, never copy.
- On demand: `../guides/AUTONOMOUS-GOAL-PURSUIT.md` and `../guides/PRD-TAD-ADR-MVP-GTM.md`.
- Post-release Maintain loop: website `guidelines/adlc-artifact-continuity.md` owns it (pinned in the PRD guide).
- Canonical read-only; disjoint paths; exact reserved diffs land by protected merge.
- Exact candidate; separate receipt per proof, retire, cleanup, sync, deploy and rollback.
- Cleanup: exact global/local targets, no wildcards; prove bytes/paths/refs.
