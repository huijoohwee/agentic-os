---
title: "Native design enforcement PRD-TAD-ADR-MVP-GTM"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.1.0"
date: "2026-09-24"
lang: "en-US"
owner: "Runtime maintainers"
continuity_id: "NATIVE-DESIGN-ENFORCEMENT"
prd_revision: "0.1.0"
tad_revision: "0.1.0"
adr_revision: "0.1.0"
mvp_revision: "0.1.0"
gtm_revision: "0.1.0"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: true
load_policy: "on-demand"
---
# Native design enforcement

## PRD

Design policy can drift from product source and planning revisions. The author needs one invocable,
bounded check that names missing owners, stale source and unjoined roles without pretending that
metadata proves visual quality. Reuse existing invocation, CLI and MCP owners; the portable export
supports the browser consumer. Theme changes themselves are outside this runtime enforcement slice.

VCC: valid bundles yield identical domain results through the pure function, CLI, slash tuple and MCP
dispatch; wrong digests, stale role/source revisions, duplicate owners, absent symbols, unknown claims,
oversized or non-JSON inputs fail. Named behavior checks are references, not executed by this tool.

## TAD

`src/design.mjs` owns the portable validator and JSON contract. `bin/agentic-os-design.mjs`
reads one bounded local file; CLI and MCP reuse it. `/design.check #read-only @input:record.json`
uses existing semantic and binding owners. MCP `design.check` accepts `{input: "record.json"}`.
The browser adapter imports `agentic-os/design` and supplies a bundle; no local path access in a browser.

Input `native-design-check/v1` contains a caller-pinned policy digest, canonical policy, joined record
and source bundle. Policy declares its own concern names; no application palette or brand is copied
here. The record joins PRD/TAD/ADR/MVP/GTM at one revision and binds each concern to one owner, source,
symbol and named check. Source bytes have exact revisions and SHA-256 digests. Policy digest bytes are
defined by `designPolicyBytes`; obtain the expected pin from the repository's reviewed policy owner,
not from a received untrusted bundle. A supplied digest proves content identity, never authenticity.

Result `native-design-result/v1` always reports `scope: supplied-source-contract`, `authority: false`
and `runtimeVerified: false`. `ok` means these structural joins passed, not that tests ran or that a
browser met contrast/typography requirements. It must not open a deploy boundary or authenticate a user.

No filesystem paths are opened from bundle contents. No shell, dynamic import, network, model or UI
effect occurs. Maximum 262,144 input bytes, 32 sources, 32 concerns, 65,536 bytes per source, depth 12 and 4,096 nodes.
Checks run once with deterministic ordered findings; no polling, retry loop or paid dependency.

Five flows: author supplies reviewed bundle → CLI/MCP/browser adapter → portable validation → bounded
findings → existing review/release owner. Data remains in the invoking process. System topology is the
existing local runtime and its browser consumer, with no new server or persistence layer.

## ADR

Extend the shared runtime with one portable checker. Alternatives: copy policy prose into multiple
agents (drift), build another settings engine (wrong owner), or rely on substring lint alone (no
revision/content binding). The selected checker validates structural references only; source parsing
and runtime behavior remain existing owner checks. Counterfeit but internally consistent bundles are
not authenticated. The trusted caller binds the expected policy digest and actual checked-out source.

Zero added service/license/model cost; authoring/maintenance time is unmeasured. Rollback removes the
route/export and restores the prior exact source pin; there is no migrated state to undo.

## MVP

Source slice: portable checker, native CLI + invocation catalog + MCP projection, consumer export,
negative tests and this plan. Runtime palette work stays in the product owner. Native settings,
typography, code typography, ideograms and illustration semantics are policy concerns at the guideline
owner. Lazy command import keeps the global prompt unchanged. No deployment is performed.

Validation: `node --test __tests__/design-contract.test.mjs`, affected invocation/MCP tests and
`npm run check`; focused proof passed (46 tests across the three files). The exact complete validation receipt is
owned by the native runner at publication; source publication and protected integration remain separate.
Revised active-work cap: 75 minutes across the requested enforcement extension; at most 15 files in this
owner, under 600 lines per file and 500 kB per chunk. External CI waits use condition/recheck receipts.

## GTM

This is internal delivery assurance for the existing product. Buyer value is fewer repeated design
fixes; demand, savings and payment remain unmeasured. Reuse the product's existing pilot/retention
path; no new service, price plan, outreach or monetization mechanism is introduced.

## Reference implementation

Global policy and the joined design proposal are owned by `huijoohwee.github.io/guidelines/` and its
`NATIVE-DESIGN-CONSISTENCY` record. `agentic-graph` owns MainPanel Settings, palettes, typography,
ideograms and the Tropical Playground illustration. `agentic-canvas-os` consumes this export for
headless/browser enforcement; it must not fork the validator or install an unrelated appearance system.

Budget decision: this requested portable policy capability has two concrete consumers (CLI/MCP and
browser), so it receives one `src/design.mjs` and one lazy CLI adapter. The module gate records
47 source modules / 15,050 lines and 111 CLI modules / 23,175 lines. Existing runtime caps and
forbidden lifecycle scenario families remain unchanged. This is an explicit measured budget change.

## Observed implementation evidence

On 2026-09-24, native CLI, `/design.check #read-only @input:record.json`, actual MCP stdio and the
injected Canvas WebMCP adapter produced the same passing structural result for four Graph files
at `414ca9afcea332c7e5f357a850caa9463bb837c5`, six policy concerns and a 56,784-byte input bundle.
Reviewed policy digest: `28d40ad252ad067e0fd6f0d51c16c4c4d4dc76bbffc80f26101bf0e341e7abce`.
The website owner generates the bundle from its reviewed Markdown and exact Git source bytes.
This one-shot integration did not adopt an upstream package or prove browser registration in the app.

Module check passes at 47 source modules / 15,047 lines and 111 CLI modules / 23,159 lines;
runtime module/line caps remain unchanged. The first complete check exposed a missing local test
dependency, fixed by installing the existing lockfile. A later pass stopped on source drift while
bounds were being tightened. The frozen broad run stopped after 163 completed suites on the unchanged budget snapshot
assertion. That assertion and its owning budget table now match the explicit module declaration.
The affected gate is rerun locally; full green proof remains the published candidate's required CI.
The Canvas locked dependency lacks this export; activation waits for protected source admission.
No palette, MainPanel setting, live application, external service or deployment was changed.
