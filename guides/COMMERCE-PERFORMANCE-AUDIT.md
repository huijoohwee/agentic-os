# Commerce performance and readiness audit

Observed 2026-09-05. This on-demand report records source/check evidence, not deployment or payment authority.
Scope: six repositories; implement one upstream performance correction; audit consumer behavior without
copying external implementation, adding dependencies, or creating consumer worktrees.

## Snapshot and scope

All six canonical checkouts were clean and matched their observed remote main revision at audit start.
Each had one registered worktree. One path-reserved upstream worktree was admitted for this change.
Retained branches and open pull requests are separate inventories; neither implies disposable work.

| Repository | Audited revision |
|---|---|
| agentic-os | b22cb187392da50bf9eff2f31a7a77ef681fd075 |
| agentic-canvas-os | d64341cc69d4fbbfcacbecd4f9167e333e6c8f33 |
| agentic-commerce-os | 9e3b221434ca01cab1c489bf63466748233bbcc6 |
| agentic-graph | 0abb288171b7a3e0807aab324b64f4032ebed105 |
| huijoohwee.github.io | ef8ce948d4bf884d87284557bce0a92af9f24282 |
| huijoohwee | 73ecc8b3145e125f7eab5cab280ba2966419cc13 |

The current lifecycle owner is `agentic-os/docs/{START-WORKFLOW,RELEASE-WORKFLOW,adlc-guidelines}.md`.
The former ACOS workflow paths and site `agentic-sdlc-guidelines.md` are absent. Consumers generally route
through their installed upstream package. This report does not recreate superseded controllers.

## Implemented upstream correction

CID `integration-observation-economics`: the integration observer compares the exact committed state of
every lane-touched path with the protected target. Its output is an observation; cleanup consumes separate
authority and receipts. The requirement, design decision, tests, and measured outcome share this identity.

Before: squash classification started two `git ls-tree` processes per path and continued after a mismatch.
After: `src/patch-identity.mjs` reads at most 128 paths and 32 KiB of path arguments per batch, permits at
most 64 KiB of output per read, and stops on the first mismatch or invalid response. Parent/child selectors
are split because combining them changes Git traversal. Mode, type, full object ID, literal path bytes,
and absent/deleted state remain part of comparison. Failed, malformed or oversized reads produce no proof.

Reads are reused only within one immutable tree comparison. No persistent proof cache, new memory store,
provider cache, or cached authority is introduced. Existing callers recapture tips at their boundaries.
For N flat short paths, tree-query processes fall from 2N to 2*ceil(N/128); argument-byte and topology
splits may require more batches. This saves repeated process startup without weakening freshness.

Measured once on a disposable local Git fixture with 256 flat changed paths: the old loop used 512 tree
reads in 10,442 ms; batching used four in 122 ms (98.8% lower elapsed time in that run). This is a local
microbenchmark, not a CI latency guarantee. The permanent regression asserts process count, not timing:
258 paths require six tree reads rather than 516; a mismatch in the first batch needs only two.

Implementation bounds: one existing source module, one regression-test file, this lazy report; zero
runtime dependencies, zero new source modules, zero always-load guidance bytes. Each changed file stays
below 600 lines; the source module also stays below its existing 400-line cap. Initial sprint estimate:
45-75 minutes; reassess after 75 minutes. CI/provider waits are dependencies, not completion estimates.

## Prioritized findings

P1 means a correctness or production-readiness blocker; P2 means material cost, coverage, or requirement
gaps; P3 means documentation or avoidable execution overhead. Findings below are not automatically
authorized consumer changes. Paths are relative to the named repository and the snapshot above.

| Priority | Owner and evidence | Finding and smallest correction |
|---|---|---|
| P1 | Canvas `agent-api/src/cache-context.js:118-136` | Invalidation happens before an awaited digest; concurrent registrations can both insert. Reproduction retained two usable revisions with zero evictions; identical concurrent requests compiled twice. Perform final lookup/invalidation/insertion after asynchronous work with a defined revision fence. |
| P1 | Graph XRPL readiness; Commerce evidence gate | Graph has an empty payment payee and testnet configuration. Commerce terminal evidence reports `evidence_runtime_context_incomplete`. Supply owner-approved inputs and run authenticated proofs before claiming production payments. |
| P1 | Mirror `.well-known/runtime-readiness.json:4`, `scripts/runtime-readiness-projection.mjs:7-28` | Green mirror validation accepts legacy source `knowgrph@1f7b529d42b0f0cff2c7cd749842fdfe51755bed` and Canvas `110ffba7397fc9e28d6f47bb8a4cb9abe581495b`. Current commerce deployment is unproven; use Graph's protected release/publisher. |
| P2 | Canvas `web/index.html`, `web/build.mjs:337-351`, `scripts/authored-line-budget.mjs:17` | Tracked HTML is 7,289 lines/693,713 bytes; emitted HTML is 701,873 bytes. The line checker omits HTML. Split source/assets and enforce emitted chunk sizes. |
| P2 | Graph `scripts/hygiene-built-chunk-budget.mjs:6-14` | Actual app/settings/Monaco chunks are 1,259,017/1,954,690/2,787,037 bytes; seven JS chunks exceed 500,000 bytes. Repository exceptions permit them. Split/lazy-load the owning bundles and retire exceptions as each is corrected. |
| P2 | Graph `src/gate/guardrail-envelope-adapter.ts:88-107` | Balance confirmation serially reads KV, always reads the authoritative ledger, then writes KV. No other production cache reader was found. Remove redundant IO or use the cache only for advisory UI; retain authoritative spend validation. |
| P2 | Graph `src/bundle/reopt-dispatch.ts:29-64`, `src/cache/offer-cache.ts:123-140` | A Promise.race deadline does not abort the underlying fetch. Propagate cancellation to stop timed-out work and bound downstream cost. |
| P2 | Commerce `src/core/revenue-ledger.ts:67-86` | Revenue-period reads use an unbounded SELECT *. Aggregate in SQL or paginate within declared count/byte/time limits. |
| P2 | Commerce `src/edge/dashboard.ts:159-164`, `src/edge/client/browser-module.ts:144-152` | IndexedDB supports reconnect replay in an already loaded page; the no-store shell has no service worker. Offline reload/cold start remains unproven. Cache an explicit shell under a tested revision policy if required for the first paid loop. |
| P2 | Upstream `src/mcp-server.mjs:29-40,191-200`, `src/worktree.mjs:211-218` | MCP lane creation accepts scope without write paths, so it cannot declare the reservation required beside another active lane. Extend the existing invocation contract with write paths; do not add another lifecycle command. |
| P2 | Upstream `src/github-provider.mjs:83-88,120-128` | Direct GitHub CLI probes have no timeout; the MCP wrapper's time limit does not bound direct CLI use. Bound the owning subprocess and preserve unknown-effect outcomes. |
| P2 | Consumer package manifests | Canvas, site and mirror pin upstream `8c2650cefac8ba37435832adfa2314846725f21a`, behind four protected improvements at audit start. Adopt one reviewed upstream pin through consumer admission after upstream settles. |
| P2 | Site `.github/workflows/guideline-contract.yml:45`, `package.json:19` | Protected npm test omits existing Git-guideline and PRD/TAD/ADR/diagram/budget suites. Select relevant existing checks once; avoid a second overlapping umbrella. |
| P2 | Graph `canvas/src/tests/registry/postParserCases0.ts:368` | Full npm test stops at viewport.storyboardWidget.overlay.initCenteredGrid: Node cannot load CardMediaAlbum.css through the lazy React component. Repair the owning test loader/import boundary, then resume the stopped suite. |
| P3 | Site `docs/documents/hjh-topology-document.md:83`, `docs/documents/agentcos-tech-stack-document.md:503` | Replace references to deleted Canvas START-WORKFLOW with the current upstream owner. |
| P3 | Canvas `.github/workflows/ci.yml:50,125` | Shards and dedicated jobs repeat collaboration/budget/profile/dictionary coverage. Preserve required contexts by aggregation while executing each unchanged test input once. |
| P3 | Upstream status/inspection | Status repeats worktree enumeration per lane and materializes revision lists for counts. Reuse one observation within a read-only status pass; never reuse it across effects. |

## Requirement coverage and first revenue

| Requirement | Evidence and remaining boundary |
|---|---|
| Universal, neutral, modular, portable harness | Zero runtime dependencies, explicit Git/provider adapters, bounded modules and installed owner references. Consumer adoption lag remains. |
| ADLC and concurrent worktrees | Scoped local admission and preserved clean canonical checkouts pass. Authenticated cross-device ownership must come from its authority adapter; local refs are not ownership. MCP reservation gap remains. |
| MCP/WebMCP and / @ # invocation | Source contracts and tests exist. Live browser/provider execution and payment proof are separate obligations. |
| Cache/memory/time/cost | Existing bounded caches, budgets and telemetry are useful; race, redundant IO and cancellation findings prevent an unqualified compliance claim. This patch reduces source-observation process cost. |
| Mobile/web/offline first | Browser tests prove particular reconnect flows. They do not establish offline reload or all mobile/device behavior. Oversized Canvas output remains. |
| Constraints, argumentation, outranking | Upstream feature ranking has grounded constraints and argument records. Commerce routing uses weighted price/quality/latency scoring, not the entire requested reasoning pipeline. |
| Shared CID/RAO/SVO across PRD/TAD/ADR | Guidelines define the joins and independent checks pass. No complete cross-repository runtime receipt chain was established by this audit. This change uses one bounded requirement/design/evidence record above. |
| AI commerce and payment loop | Local request, selection, payment and delivery tests establish bounded behaviors. Production payee, external evaluator, deployed identity and independent buyer demand remain unresolved. |
| Cloudflare Wallets / GitHub Free Tier | No Cloudflare Wallets implementation reference was found in audited runtime/config/dependencies. Existing Stripe/StraitsX/EVM/XRPL/Solana seams are not evidence for that named provider. GitHub protected source gates work; actual account quota/cost headroom was not measured. |
| Low TCO and first dollar | Keep the existing paid-resource lane as the smallest candidate. Validate one named payer, paid artifact, current cost and acceptance criterion before adding marketplace breadth. No measured WTP is claimed. |

Commerce's demand evidence currently counts agent identities; distinct external paying principals are
not independently established. Graph's paid-resource PRD also explicitly leaves WTP unproven. Therefore
the paid-resource priority is an inference from existing implementation effort, not validated demand.
The next product decision should bind a payer and deliverable, then test one complete request → quote →
authorized payment → verified settlement → delivery → receipt/reconciliation loop, including retries.

The [Anthropic commerce reference](https://github.com/anthropics/commerce-agents) was inspected for design
inspiration only. Its shared role/tool contracts and backend boundaries are relevant reusable ideas.
Its examples do not charge cards or place orders, and merchant writes are staged for approval. It does
not supply production evidence for these repositories. No source, prompts, schemas, tests or dependencies
were copied. Keep model/provider adaptation behind existing contracts rather than importing its stack.

## Validation record

| Repository | Observed checks |
|---|---|
| agentic-os | Doctor/status passed before admission; existing projection suite 23/23 and new batching regressions 8/8 passed. Full npm run check passed 624/624 tests in 201.3 seconds, readiness and doc/module evaluators. Modules 46/46; source lines 13,959/15,000; always-load text unchanged at 39.9 KiB/40 KiB. Independent source review found no blocking issue. |
| Canvas | npm run check passed: 1,025 tests plus 11 budget tests, build and docs. |
| Site | npm test passed: 25 tests plus upstream evals; git-guidelines:test passed 224 tests; guideline:check and check passed. |
| Mirror | npm run check passed: upstream evals, 8 tests, artifact validation. Its legacy marker limits the readiness claim. |
| Commerce | Full npm run check:integration passed, including source/evidence contracts, types, tests, browser and guarded Dev/Production dry-runs. Domain 62/62, unit 228/228, task bounds 100/100, Worker 51/51, browser 11/11 passed. Terminal evidence unavailable as described above. |
| Graph | npm run ci:integration passed; clean-checkout affected selection chose zero scopes. Full runtime:test passed 2,230 tests plus 43 storage-relay tests. Full npm test completed 666 cases then failed on ERR_UNKNOWN_FILE_EXTENSION for CardMediaAlbum.css under Node 22.22.3/tsx, before standalone-export. Selected memory/offline/budget/settlement tests 79/79 and XRPL tests 67/67 passed. XRPL readiness failed on empty payee. |

Graph's affected selector reads uncommitted changes locally (`scripts/run-affected-ci.mjs:53-56`), so a
green integration invocation on clean main does not mean all runtime tests ran. The audit therefore
invokes the existing broad suites once. Commerce dry-runs do not deploy; its observed core/edge bundle
sizes were 196,679 and 487,850 bytes, respectively.

The full upstream suite exercises real Git repositories, publication, integration and cleanup behavior.
Local suites are not a substitute for authenticated production E2E. No deployment, payment, external
evaluator artifact, authority retirement, consumer pin update or cleanup is fabricated by this audit.
Measured performance is local process overhead; it is not a claimed model-token or cloud-cost saving.
