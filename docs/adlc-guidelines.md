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

ADLC supersedes legacy Agentic SDLC execution and cleanup. Consumers retain product, deployment,
rollback, and authorization policy, but no competing lifecycle controller.

- Keep contracts universal, neutral, agnostic, headless, simple, adaptive, autonomous, and modular;
  isolate providers behind adapters.
- Use the smallest bounded proof. Fix the owning source, remove replacements, and avoid scenario or
  recovery controllers.
- Continue safe in-scope mechanics, but never infer scope, authority, destruction, promotion,
  deployment, or a product choice.
- Preserve authored bytes and inspect live state before effects. Local and provider projections are
  evidence, not authority.
- Keep canonical read-only. One admitted lane binds one branch, worktree, scope, and any selected review; disjoint
  lanes may proceed concurrently.
- Bind candidates exactly and use protected integration. Keep proof, retirement, every cleanup target,
  canonical sync, deployment, and rollback as separate authorized receipts.
- Cleanup only an exact eligible target after value closure and clean detachment; never use wildcards or
  discard ambiguity. Structural health is advisory; effects require exact byte, path, ref, and race proof.

Run `START-WORKFLOW.md` and `RELEASE-WORKFLOW.md`; local policy may narrow ADLC or select adapters.
