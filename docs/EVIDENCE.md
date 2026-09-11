<!-- readiness-proof kind=contract evidence=__tests__/evidence-doc.test.mjs -->

# Evidence

This checker is contract-ready. `npm run readiness:check` scans all Markdown, including `AGENTS.md`.
Fenced examples are ignored. Each readiness claim requires exactly one marker:

```html
<!-- readiness-proof kind=contract evidence=__tests__/feature.test.mjs -->
```

Proof kinds, strongest first:

- `live-provider`: fresh receipt bound to source, target, claim bytes and provider check.
- `contract`: passing, claim-bound `__tests__/*.test.mjs` source test.
- `doc-parse`: executable structural proof only.
- `none`: explicit gap; cannot support readiness.

Runtime, production and deployment readiness require live-provider proof. Contract and doc-parse
claims require their named kind or stronger. `evidence` names a contained repository-relative file.
Tests export the contract-proof schema and exact claim digest. Failures, skips, todo and absent
assertions invalidate proof.

A live receipt requires clean HEAD, exact claim path/digest, target, successful check receipt and age
from zero through 30 days. It may be the sole untracked file. A code-owned provider verifier must
authenticate it; self-attestation, URLs, prose, old output and detached green checks cannot.

## Execution contract

CID `ADLC-EVIDENCE-01`; RAO: harness evaluates source assertions; SVO: one worker reports binding and
results. PRD: eliminate duplicate execution without stale verdicts. TAD: preload the canonical test URL
in its Node worker; one module instance supplies binding and assertions. ADR: reuse reporter/loader;
no dependency, module or persistent result cache. Each call runs afresh.

Bounds: one subprocess, 30 seconds, 64 KiB binding, 128 KiB pending stdout frame, 256 KiB captured output.
Malformed, duplicate, incomplete or oversized bindings fail. Limits exclude program/Node buffers.
Affected: `npm run check`; full: `npm run check:all`. Test receipts grant no live proof.
The deadline covers module loads and assertions.
