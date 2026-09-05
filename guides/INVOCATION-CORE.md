# Shared invocation core

`agentic-os/invocation` owns reusable `/`, `#`, and `@` token rules and catalog serialization.
It is a pure ES module: no filesystem, provider, network, Node builtins, runtime dependencies,
mutable registry, or model calls. Browser and native consumers import the same protected package pin.
Importing it does not load the CLI or lifecycle catalog.

## Ownership

| Owner | Responsibility |
|---|---|
| `src/invocation.mjs` | Token parsing, prefix classification, canonical token, catalog serialization |
| `bin/agentic-os-invocation.mjs` | Lifecycle catalog IO/hash, exact dispatch policy, argument requirements |
| Agentic Canvas OS | Application dictionaries, Markdown loading, product safety and invocation proof |
| Agentic Graph | Product routes, document projections, browser interaction and MCP/WebMCP registration |
| Agentic Commerce OS | Commerce capabilities, payment authorization and transaction evidence |

Keep product documentation in its owning repository. This extraction does not move the Canvas `docs/`
tree or make the `agentic-os-mcp` checkout a documentation authority. Consumers depend on the core;
the core has no dependency on product repositories.

## Contracts

- `parseInvocationToken(token)` returns prefix, kind, canonical token and opaque argument, or an error.
  Names use lowercase ASCII letters, digits, dots and hyphens, up to 128 characters. Only `@` accepts
  an argument, up to 1,024 characters. Empty arguments are valid dictionary declarations; callers own
  execution requirements.
- `malformedInvocationRuleFor(token)` retains the dictionary validator's error vocabulary.
- `canonicalInvocationToken(token)` removes an argument from `@name:value`, yielding `@name:`.
  Canonicalization is not validation or authorization.
- `kindForInvocationToken(token)` classifies prefixes, including incomplete tokens during editing.
- `canonicalCatalogInput(entries)` preserves dictionary digest input: kind order command, semantic,
  binding; ordinal token order; original field values; no trailing newline.
- `serializeInvocationCatalogForDigest(entries)` preserves projected catalog input: trimmed fields,
  lowercase kind, token locale ordering and a trailing newline.
- `serializeInvocationRoutingForDigest(entries, schema)` preserves projected routes and their order,
  with the product's explicit schema. The core never invents that schema.

These digest input formats are deliberately distinct existing wire contracts. Hashing and verification
remain with each caller's native crypto implementation. Changing formats requires a versioned product
migration; merely sharing implementation must not change catalog digests or source revision claims.

Token grammar does not impose tuple cardinality. Lifecycle and dictionary resolvers currently allow
one token per prefix. Structured Graph invocation allows multiple semantics/bindings under its own
stricter name profile. Markdown editing syntax remains a product concern. Neither profile is silently
broadened or replaced by the other.

## Validation and adoption

Run core grammar/serializer tests and lifecycle CLI tests, then the upstream full check. Consumer
adoption follows the protected upstream commit: update its exact package pin and lock integrity,
remove replaced helper bodies, preserve catalog identity, then run native MCP and browser checks.
No live payment or production readiness is implied by source integration.

Budget: no always-load text added; 46 source modules retained. Lifecycle policy moves to its CLI
adapter while the existing source module becomes reusable. This is one shared extraction, with no
per-product controller family or additional external dependency.
