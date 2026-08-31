<!-- readiness-proof kind=contract evidence=__tests__/readiness-proof.test.mjs -->

# Evidence

A readiness claim is a testable statement, not a maturity label. `npm run readiness:check` scans every
Markdown file and rejects a runtime-ready, production-ready, or deployment-ready claim unless the document
contains exactly one marker:

```html
<!-- readiness-proof kind=contract evidence=__tests__/feature.test.mjs -->
```

The proof kind is one of:

- `live-provider` — a retained receipt from the actual provider path;
- `contract` — executable behavior proof;
- `doc-parse` — structural proof only, which must not be described as live behavior;
- `none` — an explicit gap; it records blocked readiness and cannot support a readiness claim.

`evidence` is a repository-relative path. It must remain inside the repository and exist when the checker runs.
URLs, prose assertions, old command output, and a green check detached from the claimed path are not evidence.

The checker ignores fenced examples so a contract can describe invalid input without making the claim itself.
It checks `AGENTS.md`, `README.md`, and all other Markdown recursively, including this document.
