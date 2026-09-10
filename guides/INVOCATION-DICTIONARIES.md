# Shared invocation dictionaries

`agentic-os/catalog/dictionaries/DICTIONARY-{COMMAND,SEMANTIC,BINDING}.md`
owns reusable `/`, `#`, and `@` metadata. Consumers retain execution, product
documents, approval, credential, deployment, and runtime-proof ownership.
The CLI's `catalog/invocation.json` is its executable dispatch map; dictionary
membership does not make a token executable or confer authority.

Install the existing `agentic-os` dependency at an exact reviewed Git revision.
Resolve each asset through `agentic-os/dictionaries/DICTIONARY-COMMAND.md`
(and the semantic/binding equivalents). Load only the needed asset on demand;
the shared `agentic-os/invocation` module imports no dictionary text or runtime.
Node adapters can use `import.meta.resolve` plus bounded file reads; browser
adapters can serve assets from that same installed revision for offline use.
Never require a sibling checkout or a network request to discover local metadata.

`DICTIONARY_DESCRIPTORS`, `collectCatalogEntries`, and
`validateDictionaryCatalogContract` are exported from `agentic-os/invocation`.
Pass a Map keyed by dictionary filename. Validation accepts a synchronous
`digestForInput` callback that computes lowercase SHA-256 over UTF-8 canonical
input; Node adapters use their existing crypto owner. An asynchronous crypto
adapter may hash `canonicalCatalogInput(collectCatalogEntries(documents).entries)`
first, then supply that digest for the same immutable document snapshot.
Reject all returned failures before using entries. Metadata validation proves
content consistency, not provenance, execution success, or approval.

The parser reads exactly three known keys and caps each text at 96 KiB UTF-8
and 800 lines, with at most 512 catalog entries. I/O adapters must enforce the
same byte limit before buffering, plus their existing deadline and cancellation.
Parsing has no cache, global result state, filesystem, network, or model calls.
If a consumer caches metadata, bind its bounded cache to upstream revision and
content digest; never reuse it as fresh authorization or publication evidence.

The migration preserves all 406 entries and their product context. Their
`sourcePath` now names the upstream asset, so the canonical catalog digest
changes. Product document references retain the declared Canvas reference root.
Evidence must record the dictionary's upstream revision separately from any
Canvas product-document revision. Do not label old downstream receipts as proof
of these new assets.

Release upstream first, then update consumer pins/readers and remove replaced
dictionary definitions and parsers in their owning source changes. A historical
docs path may retain a reference-only shim when a published contract requires it.
When an existing raw-Markdown consumer needs the complete text, a byte-identical
projection of the locked upstream asset is permitted until that consumer migrates.
The consumer must check every projected byte against the installed asset in CI,
identify the upstream owner and revision in its migration guide, and provide one
explicit projection-refresh command. Projections are never independently authored;
missing upstream assets fail closed. A locally recomputed digest alone is insufficient.
Until those consumer changes release, ecosystem migration remains incomplete.

Validation: run `npm run check` from the upstream source lane. Always-loaded
documentation delta is zero; core-module and dependency deltas are zero. The
three assets add about 210 KiB to the package and are loaded only when requested.
No runtime readiness or production deployment follows from these source checks.

## Validation diagnostics

Readiness proof failures retain the invalid-artifact verdict and identify the failed
native tests without replaying them. Diagnostics include at most eight test names
(256 characters each) and failure types (64 characters each), with control characters
removed. Raw assertion values, stack traces and child stderr are not published.
The existing 30-second execution deadline and 256 KiB child-output limit remain.
A diagnostic distinguishes runner, deadline, output-limit, assertion and proof-binding
failures; it grants no readiness or release authority.
