<!-- readiness-proof kind=contract evidence=__tests__/evidence-doc.test.mjs -->

# Evidence

This checker is contract-ready. A readiness claim is a testable statement, not a maturity label.
`npm run readiness:check` scans every Markdown file and rejects a claim unless the document contains exactly
one marker:

```html
<!-- readiness-proof kind=contract evidence=__tests__/feature.test.mjs -->
```

The proof kind is one of:

- `live-provider` — a fresh structured receipt bound to source, target, claim bytes, and provider check;
- `contract` — a passing, claim-bound `__tests__/*.test.mjs` proof;
- `doc-parse` — an executable structural proof only;
- `none` — an explicit gap; it records blocked readiness and cannot support a readiness claim.

Strong claims require strong proof:

```text
runtime-ready  production-ready  deployment-ready  -> live-provider
contract-ready                                      -> contract or live-provider
doc-parse-ready                                     -> doc-parse, contract, or live-provider
```

`evidence` is a repository-relative file. Contract tests must be direct `__tests__/*.test.mjs` files executed by
`npm test`, export the contract-proof schema, and name the exact claim digest. A live receipt must name the exact
clean `HEAD`, an exact claim path and digest, a target, a successful
check receipt, and an observation no more than 30 days old. The receipt itself may be the sole untracked path so a
provider adapter can materialize it after testing the committed source.

The local checker validates those bindings and freshness. Live proof also requires an explicit code-owned
provider verifier; without one, even a structurally valid receipt fails closed as self-attested.
URLs, prose assertions, old command output, and a green check detached from the path are not evidence.

The checker ignores fenced examples so a contract can describe invalid input without making the claim itself.
It checks `AGENTS.md`, `README.md`, and all other Markdown recursively, including this document.
