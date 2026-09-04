---
schema: agentic-os/adlc-guidelines/v1
title: ADLC Guidelines
doc_type: guidelines
version: 1.2.0
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

ADLC supersedes Agentic SDLC lifecycle/cleanup. Consumers keep product/deploy/rollback/authority policy,
never a competing controller.

- Universal, neutral, agnostic, headless, simple, adaptive, autonomous, modular; adapt providers.
- Minimize time-to-production: smallest valuable vertical diff; fix owner/remove replacements; no scenario
  controllers.
- Continue safe work; infer no scope/authority/destruction/promotion/deploy/product choice.
- Lean bounded sprints state TTP ETA and time/byte/module caps; refresh on drift. External waits state
  dependency/condition/recheck, never ETA.
- Global prompt: exact LF-terminated UTF-8, at most 1,000 bytes; code points secondary, tokens advisory.
- New always-load guidance/modules declare deltas; otherwise replace, lazy-load, or reject.
- Run root/upstream `npm run evals` continuously in CI; consumers reference, never copy, it.
- Lazy-load `../guides/AUTONOMOUS-GOAL-PURSUIT.md` for delivery planning or repeated mechanical failure.
- Preserve bytes; inspect live state. Projections are evidence, not authority.
- Canonical is read-only. Edit owner files in disjoint path-scoped lanes; overlaps wait. Land stages,
  commits, and publishes reserved paths.
- Land the exact committed diff by protected merge. Lane binds branch/worktree/scope/review.
- Exact candidates; proof/retirement/cleanup target/sync/deploy/rollback each need an authorized receipt.
- Clean exact eligible targets only after value closure/detachment; no wildcards. Effects need exact
  byte/path/ref/race proof; structural health is advisory.

Run both workflows; local policy may narrow ADLC or select adapters.
