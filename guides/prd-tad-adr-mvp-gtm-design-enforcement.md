---
title: "Native design enforcement PRD-TAD-ADR-MVP-GTM"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.2.0"
date: "2026-10-05"
lang: "en-US"
owner: "Runtime maintainers"
continuity_id: "NATIVE-DESIGN-ENFORCEMENT"
prd_revision: "0.2.0"
tad_revision: "0.2.0"
adr_revision: "0.2.0"
mvp_revision: "0.2.0"
gtm_revision: "0.2.0"
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

Declared shared components, adapters, utilities and styles can acquire competing owners or cyclic
dependencies; generated output can outlive its producer inputs. The optional reuse check rejects
those inconsistencies in supplied evidence. It does not detect undeclared copies, compare appearance,
parse imports, select a UI library or establish that a declared source is deployed.

VCC: valid bundles yield identical domain results through the pure function, CLI, slash tuple and MCP
dispatch; wrong digests, stale role/source revisions, duplicate owners, absent symbols, unknown claims,
oversized or non-JSON inputs fail. Named behavior checks are references, not executed by this tool.
Reuse VCC: declared concern ownership agrees with the joined record; module and generated-source
graphs are acyclic; producer closure, input, recipe and output drift invalidate a generation receipt.
Legacy v1 bundles remain valid without reuse evidence; the same domain result reaches every existing transport.

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

Optional `reuse` on `native-design-check/v1` has exact keys `schema`, `modules`, `generated` and schema
`native-design-reuse/v1`. At most 64 modules and 32 generation records share the existing input bounds.
Each module declares `{id, source, symbol, owns, uses}`: source is an opaque supplied source ID; symbol
must occur in its text; owns lists concern IDs; uses lists module IDs. Both lists are unique and bounded.
Every joined concern has one matching declared owner ID and source; aliases of one source/symbol and
competing concern owners fail. Adapters consume the owner's module through uses rather than declaring
another owner. The checker evaluates these declarations, not actual imports or semantic equivalence.

Each generated record declares `{output, producer, inputs, recipe, inputDigest, outputDigest}`.
Output, inputs and recipe reference supplied sources; producer references a declared module. Inputs
are a nonempty unique list. Recipe text must record the consumer's complete tool versions, options,
lockfile identity and relevant public environment settings; that completeness remains the source owner's duty.
`designGenerationBytes(input, output)` canonicalizes the output ID and producer's reachable module graph (IDs, symbols,
uses and source revision/digest bindings), sorted input bindings and recipe binding. After shape-valid
evidence is assembled, hash these bytes with `designDigest` to pin a generation receipt. Output digest
must match its supplied source bytes. Output dependencies include recipe, inputs and every producer
dependency source; cycles and duplicate output receipts fail. Reordered declarations do not change the key.
Changing any bound revision, source, tool/options recipe or output invalidates the old receipt.

The caller pins reviewed evidence from actual source; recomputing untrusted digests does not authenticate it.
Input is snapshotted before asynchronous hashing. No generated bytes are built, loaded or written by this
check. `duplicate-owner`, `unresolvable-reference`, `unimplemented-guideline`, `unguided-artifact`,
`stale-evidence` and `malformed-document` retain their existing meanings; cycles are malformed documents.

Five flows: author supplies reviewed bundle → CLI/MCP/browser adapter → portable validation → bounded
findings → existing review/release owner. Data remains in the invoking process. System topology is the
existing local runtime and its browser consumer, with no new server or persistence layer.

## ADR

Extend the shared runtime with one portable checker. Alternatives: copy policy prose into multiple
agents (drift), build another settings engine (wrong owner), or rely on substring lint alone (no
revision/content binding). The selected checker validates structural references only; source parsing
and runtime behavior remain existing owner checks. Counterfeit but internally consistent bundles are
not authenticated. The trusted caller binds the expected policy digest and actual checked-out source.

Keep optional reuse in the same pure checker and the existing `/design.check #read-only @input:record.json`
route. No additional command grammar, browser engine, provider adapter, UI library or persistence owner
is introduced. Generation effects remain the existing [bounded generation owner](./GENERATION.md).
Consumers expose their own evidence adapters and native visual runtime; global enforcement must not
become a product-specific renderer or a parallel theme/settings implementation.

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

The 0.2.0 increment is bounded to 15–25 active minutes, five existing files, 35 kB authored delta and zero
new runtime modules/dependencies. It adds 105 lines to the existing portable owner. The measured source
total grows from 15,049 to 15,154 lines; the evaluator cap changes only from 15,050 to 15,154, preserving
47 modules and the stricter 400-line source-file cap. CLI module/line and runtime caps stay unchanged.
Always-load prompt delta is zero. Rollback removes optional reuse support and restores the prior source
pin; existing v1 bundles, transport grammar and the separate generation cache retain their contracts.

Current increment checks: `node --test __tests__/design-contract.test.mjs` covers legacy and optional
inputs, ownership conflicts, cycles, bounded/malformed evidence, generation invalidation, snapshot races
and CLI/slash/MCP result parity. `npm run check` and `npm run evals` remain required before handoff.
No browser fidelity, accessibility, production, user-study or deployed adoption claim follows from them.

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
The published candidate CI identified two old packaging/path smoke assertions pinned to
`46/46`; both now assert that the budget evaluator ran and reported a module count, while its
zero exit still proves the declared cap. The exact cap remains owned by the evaluator. The
successor reran the two affected suites (5/5 passing), evaluators, and the local broad
gate. The broad gate exceeded its 540-second command budget after most selected suites
passed; four unfinished suites timed out, so it is not reported as green. Provider CI
must provide the full gate result for this successor.
The Canvas locked dependency lacks this export; activation waits for protected source admission.
No palette, MainPanel setting, live application, external service or deployment was changed.
