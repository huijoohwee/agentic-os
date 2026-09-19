---
title: "Stream observations to Markdown dashboards"
doc_type: "Runtime Contract"
version: "1.0.0"
owner: "agentic-os"
load_policy: "on-demand"
frontmatter_contract: "required"
---

# Stream observations to Markdown dashboards

An observation producer owns its JSON schema, identity, ordering and evidence. A consumer may
project validated observations through an authored Markdown template into a portable dashboard
snapshot. Projection is deterministic and grants no execution, evaluation, payment or release
authority. Reuse the native observation protocol; a display snapshot never replaces its manifest.

## Producer and consumer boundary

- Agentic OS retains immutable workflow manifests, referenced archives and existing bounded SSE
  observation responses. Collection, freshness, access checks and measurement semantics stay here.
- The product owns template bindings, Markdown serialization, widget layout, Editor/Viewer rendering
  and explicit workspace saves. See the Graph reference implementation's
  [product plans](https://github.com/huijoohwee/agentic-graph/tree/main/docs/documents), specifically
  `agentic-graph-stream-dashboard-prd-tad-adr-mvp-gtm.md`.
- A transport adapter consumes complete JSON values after framing. TCP/read chunks are not JSON
  records. Reuse the shared SSE parser; refuse truncated frames, unsupported events and overflow.
- Apply complete snapshots atomically. Bind source identity, ordered revision and observed time;
  identical replay is a no-op, conflicting replay and backward revisions fail. A snapshot stream
  needs no patch reducer. Continuous reconnect, cursor recovery and delta semantics need separately
  specified producer contracts; do not silently infer them from bounded snapshot support.

## Portable output and authoring

Templates carry stable identity/version, bindings and presentation defaults. They contain no live
credentials or captured run identities. Generated Markdown carries resolved values, coverage,
template identity and source revision; missing values remain unknown and measured zero remains zero.
The template and native archive remain unchanged. Source observations are data, never invocations.

The product's existing configuration parser validates layout metadata. Its existing Markdown
parser and table serializer own readable output. One document owns a saved dashboard's layout;
do not also write that layout to a global sidecar. Generated blocks have explicit boundaries;
edits outside them survive configuration changes and concurrent source edits cause a conflict.

Live private observations retain their original expiry and memory-only policy. A deliberate export
creates a historical, non-authoritative user document. It conveys no session or automatic reconnect
capability. No automatic cloud upload accompanies export. Existing authenticated document transfer
can sync the Markdown snapshot; full run portability still requires its digest-verified archives.

## Acceptance at each owner

Producer checks continue to prove native run identity, source digest, bounds and complete pages.
Consumer checks cover split UTF-8/SSE frames, duplicate/conflicting/backward revisions, abort and
truncation; template binding and literal-data escaping; zero/unknown values; offline reopen; layout
round-trip; and preservation of authored text and concurrent changes. Source tests establish their
actual scope only. Protected integration and deployed runtime evidence remain separate receipts.
