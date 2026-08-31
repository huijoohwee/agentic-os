<!-- readiness-proof kind=contract evidence=__tests__/readiness-proof.test.mjs -->

# Evidence

This checker is contract-ready. A readiness claim is a testable statement, not a maturity label.
`npm run readiness:check` scans every Markdown file and rejects a claim unless the document contains exactly
one marker:

```html
<!-- readiness-proof kind=contract evidence=__tests__/feature.test.mjs -->
```

The proof kind is one of:

- `live-provider` — a structured passed receipt from the actual provider path;
- `contract` — an executable `__tests__/*.test.mjs` behavior proof;
- `doc-parse` — an executable structural proof only;
- `none` — an explicit gap; it records blocked readiness and cannot support a readiness claim.

Strong claims require strong proof:

```text
runtime-ready  production-ready  deployment-ready  -> live-provider
contract-ready                                      -> contract or live-provider
doc-parse-ready                                     -> doc-parse, contract, or live-provider
```

`evidence` is a repository-relative file. It must remain inside the repository and match its proof kind.
URLs, prose assertions, old command output, and a green check detached from the path are not evidence.

The checker ignores fenced examples so a contract can describe invalid input without making the claim itself.
It checks `AGENTS.md`, `README.md`, and all other Markdown recursively, including this document.
