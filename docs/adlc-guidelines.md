---
schema: agentic-os/adlc-guidelines/v1
title: ADLC Guidelines
doc_type: guidelines
version: 1.0.0
owner: agentic-os
universal_scope: true
supersedes: agentic-sdlc
runtime_contract: enforced
runtime_evaluator: npm run check
runtime_policy: fail-closed
lifecycle_status: active
---
# ADLC guidelines

ADLC supersedes Agentic SDLC lifecycle/cleanup. Consumers keep product/deploy/rollback/authority policy;
no competing controller.

- Universal, neutral, agnostic, headless, simple, adaptive, autonomous, modular; adapt providers.
- Use minimal proof; fix owner, remove replacements, avoid scenario controllers.
- Continue safe work; infer no scope, authority, destruction, promotion, deploy, or product choice.
- At start/resume, give a bounded active-work estimated time to completion (ETA), as a range/upper bound;
  refresh after material drift in scope, evidence, authority, checks, workload, or dependencies.
- External waits are not ETA: name the dependency/condition and next recheck; never invent completion.
- The global prompt is exact LF-terminated UTF-8 with a 1,000-byte hard ceiling; code-point count is
  secondary and token estimates are advisory because tokenizers vary by model/provider.
- New always-load guidance or module patterns declare projected byte/module delta and fit the configured
  budget; otherwise replace lower-value text, lazy-load it, or reject it as incomplete.
- Preserve bytes; inspect live state. Projections are evidence, not authority.
- Canonical is read-only. A lane binds branch, worktree, scope, review; disjoint lanes may concur.
- Bind exact candidates; protected integration only. Proof, retirement, cleanup, sync, deploy, and rollback
  each require an authorized receipt.
- Clean exact eligible targets only after value closure/detachment; no wildcards/ambiguity. Effects need exact
  byte/path/ref/race proof; structural health is advisory.

Run both workflows; local policy may narrow ADLC or select adapters.
