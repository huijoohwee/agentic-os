# Bounded commerce execution

CID: `commerce-execution-economics`. Context: concurrent commerce tasks spend time repeating local
observations and waiting for provider processes. Intent: reduce avoidable work without caching authority.
Directive: keep every write scoped, every wait bounded, and every uncertain effect explicit.

## Requirement, design and acceptance

| ID | Requirement and design decision | Independent check |
|---|---|---|
| CE-1 | Reuse the registration list within one status call; ask Git for a count, not every commit ID. Never retain that observation across calls or effects. | `__tests__/status-observation-economics.test.mjs`: one enumeration, fresh subsequent count, malformed/oversized output refused; existing stale-registration suite. |
| CE-2 | Bound direct provider processes with hard termination; preserve failed writes as unknown until reobserved. Do not retry a mutation on a timeout. | `__tests__/provider-timeouts.test.mjs`; provider handoff and receipt regressions. |
| CE-3 | MCP lane requests may supply explicit write paths through the existing admission controller. Reject malformed or oversized reservations before running the CLI. | `__tests__/mcp-server.test.mjs`: reservation propagation, invalid inputs, existing dispatch cases. |

RAO: the harness owns observation and invocation; the provider owns remote truth; each product owns its
cache, payment and delivery semantics. SVO: the harness reuses one observation; the adapter bounds one
subprocess; the caller declares write paths; independent tests evaluate behavior.

Decision: improve existing modules rather than add persistent memory, another cache, or another lifecycle
controller. Status now uses one registry read for N lanes instead of N+1. Commit-history output is bounded
to 64 bytes per count instead of materializing N object IDs. These are process/byte reductions, not a
measured model-token saving or a production latency guarantee. No model call is needed.

The optional MCP `lane` argument is `writePaths`, an array of repository-relative paths.
For example, `{ "scope": "catalog-cache", "writePaths": ["src/cache", "test/cache.test.mjs"] }`.
The existing overlap, ownership and admission rules still decide whether the lane can start.

GitHub calls default to a 15-second process deadline; the availability probe uses two seconds. Timeout
means no confirmed result. An attempted write retains its unknown-effect receipt and requires readback.
This bounds each process, not the whole multi-call operation or remote service execution.

## Downstream scope

The same sprint fixes current owners: Canvas cache registration races; Commerce revenue-read allocation;
Graph request cancellation and redundant balance-cache IO; the documentation site's omitted existing
checks and stale workflow references; and the runtime mirror's pinned harness tooling. Product memory
remains in its current owner. Generated mirror assets require Graph's protected publisher.

The existing paid-resource loop is the smallest implemented revenue candidate. No independent buyer/WTP
proof is established by these efficiency changes. Real settlement, delivery and reconciliation require
current provider configuration and independently issued runtime evidence.

Budget: zero new source modules, runtime dependencies, model calls or always-load guidance bytes.
Each changed source stays within its existing module cap; tests and this report are loaded on demand.
Verification uses the root full check and each changed consumer's native full/source/browser suites once;
failed or externally gated checks are recorded separately from successful source checks.

Upstream validation on 2026-09-06: `npm run check` passed 640/640 tests in 284.6 seconds, plus readiness,
documentation and module evaluators. Source remains 46/46 modules and 13,809/15,000 lines; always-load
guidance remains 39.9 KiB/40 KiB. Independent source review found no remaining actionable issue.
This is source behavior evidence; protected integration, consumer adoption and production remain
separate receipts. In particular, source tests do not issue payment or deployment authority.
