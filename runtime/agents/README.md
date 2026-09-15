# Native agent runtime

Implementation authority: approved `DURABLE-AGENT-WORKFLOWS-001@0.1.0`,
[source plan](../../guides/DURABLE-WORKFLOWS.md). This package owns the native core.
Consumer cutover, remaining application assets and production proof are separate gates.
`MIGRATION.json` records the native source revision and original file hashes.

## Current ownership handoff

The approved plan remains `DURABLE-AGENT-WORKFLOWS-001@0.1.0`; its acceptance criteria
are unchanged. This dated source handoff supplements the historical P1 observations below.

| Protected source, observed 2026-09-15 | Completed scope |
| --- | --- |
| [OS PR #167](https://github.com/huijoohwee/agentic-os/pull/167), `69c869816885c754fb1ee3d131d2b45e63b9896b` | Generic execution, persistence, optional adapters, Worker factory and local application host; [required source checks](https://github.com/huijoohwee/agentic-os/actions/runs/34970128434). |
| [Canvas PR #931](https://github.com/huijoohwee/agentic-canvas-os/pull/931), `8460fc01c7dbd8af6880d346a71829e20887c44e` | Callers import the protected OS package and the Commerce admission extension; [consumer checks](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/34974395012). |
| [Commerce PR #54](https://github.com/huijoohwee/agentic-commerce-os/pull/54), `38662008dae8b3fc20905c7fb09d67036c878611` | Durable fulfillment and compatible draft reader; new workflow writes require executor availability; [consumer checks](https://github.com/huijoohwee/agentic-commerce-os/actions/runs/34975131015). |
| [Graph PR #1017](https://github.com/huijoohwee/agentic-graph/pull/1017), `3b424d9e80f113dbab93b195798bd9521241aafe` | Four browser run operations and the private Dev bridge; [consumer checks](https://github.com/huijoohwee/agentic-graph/actions/runs/34972814915). |

Nineteen native contracts and catalogs are available as explicit
`agentic-os/agent-docs/<NAME>.md` package assets. Resolve only the requested asset;
discovery imports no executor and starts no process. [MIGRATION-DOCS.json](MIGRATION-DOCS.json)
records each original digest, resulting digest and source revision. Historical proof
remains attached to its original source; relocation supplies no new provider proof.
The migrated status vocabulary and literal invocation templates are metadata.

Consumer document cutover and old-body removal are pending. The main plan and fleet
registry remain reserved by their existing lanes. Remaining Canvas renderer, asset,
lifecycle and deployment sources still require individual ownership assignment and
cutover. Public executor activation, version-bound state recovery, generated mirror
publication and final public E2E verification remain unfinished. These source receipts
do not establish production completion, payment collection or customer demand.

Import only the capability required by the caller:

| Package path | Responsibility |
| --- | --- |
| `agentic-os/agents/running` | Bounded agent execution |
| `agentic-os/agents/orchestration` | Manager and specialist delegation |
| `agentic-os/agents/swarm` | Task planning, fenced work and synthesis |
| `agentic-os/agents/toolkit` | Metadata observations, evaluation and proposals |
| `agentic-os/agents/composition` | Injected runtime composition |
| `agentic-os/agents/durable-object-store` | Optional existing edge state transport |
| `agentic-os/agents/sqlite-store` | Local persistent claims and checkpoints |
| `agentic-os/agents/worker` | One bounded wake using the existing runtime and store |
| `agentic-os/agents/local-model` | Optional loopback inference with pinned artifacts |
| `agentic-os/agents/local-host` | Explicit authenticated local HTTP process and scheduled wakes |

Imports start no worker, provider call, background timer or store connection. The
root lifecycle API does not import these modules. Execution adapters, authorization,
cost evidence and persistent stores are explicit inputs. Memory stores are for
single-process fixtures; their records cannot survive a process exit.

The edge adapter preserves `swarm-run:` and `agent-toolkit:` namespaces and the
existing claim/replace protocol. It creates no binding or namespace and contains
no Commerce admission policy. Wire compatibility alone is not a migration receipt.
Keep existing state and recovery revisions until consumer and deployment checks pass.

Runtime tests are owned by OS. HTTP, product readiness and composed provider tests
remain with their current application owners until those adapters move.

## Local persistence

Explicitly call `await createAgentSwarmSqliteStore({ directory })` and inject its
result as the swarm runtime's `stateStore`. The optional adapter requires
[Node.js 22.13 or newer](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html).
Use one private directory on a local filesystem. Call `close()` when the worker
stops; closing does not delete state. No database opens during module discovery.

The adapter uses SQLite transactions and full synchronous commits, preserving
the existing store methods and claim expiry semantics. Defaults cap retained
records at 128, records per principal at 32, record bytes at 499,999, active tasks
at 8 globally and 4 per principal, and lock waits at one second. Configuration is
persisted; changed limits require an explicit state migration. Existing ledgers
keep their current expiry policy. This adapter alone does not extend run duration.

All processes use the same store and caller-generated unique claim IDs. Admission
recomputes expired peer execution counts in the same transaction, preserving the
original checkpoint. Cross-device transfer and remote filesystem locking are unproved.

## P1 handoff

The operator approved implementation of the linked five-role plan at revision
`0.1.0` on 2026-09-15. Its preserved proposal status records the earlier review;
this implementation does not change its requirements or infer a deployment grant.
P1 implements the package and storage prerequisites for T01/T02 and ADR-D01.
The following checks are evidence for those prerequisites, not completion of all
AC-D01–D08. The full plan, payer hypothesis and unvalidated demand remain unchanged.

| Criterion | Local check and observed scope |
| --- | --- |
| AC-D01 | `__tests__/agent-package.test.mjs`: closed acyclic package, lazy root loading, packed imports and module/byte bounds; 40 native core tests pass. |
| AC-D02–D04 | `__tests__/agent-durable-store.test.mjs`: killed-process checkpoint retention, competing-process claims, expired-fence rejection, atomic queue/execution caps and invalid-state preservation. |
| AC-D08 prerequisite | Unchanged Canvas caller suite at the manifest source revision: 70 tests pass with the transferred core; edge transport retains existing scopes and operation bodies. |

The evaluator was the local Node 22.22.3 process on macOS. Repository-wide checks
use `npm run check`; protected checks bind the published candidate separately.
Canvas must adopt the protected OS revision before its replaced bodies are removed.
Delayed retries, effect reconciliation, per-attempt authority, invocation/browser
parity, the sandbox fulfillment loop, remaining Canvas assets and live deployment
proof remain P2–P4 work. No AI-quality, WTP, revenue or production claim follows.

## Durable recovery and invocation

P1 source transfer and the Canvas caller cutover are protected by OS PR #162 and
Canvas PR #930. P2 is partitioned into dependency-closed recovery, invocation and
application slices. Each slice keeps the approved 12-module/150-KB bound; the
application/mobile demonstration and provider setup remain separate exit checks.

New jobs use `agent-swarm-run/v2`. Their immutable digest binds the normalized
request, principal and exact agent revision; an altered request cannot reuse its
run ID. Admission persists the execution policy, deadline and a fixed retention
deadline (one day beyond execution by default). Reads never extend retention.
One run may last at most seven days, in bounded attempts, with at most 30 days of
additional retention. Storage capacity can reject new jobs; it never evicts a
live receipt to make room. No new service, paid adapter or always-loaded executor
is introduced. Queue/concurrency caps belong to the selected persistent store.

Unknown effects enter `reconciling`. Supply a trusted `reconcileTask` reader that
binds the original idempotency key and an evidence reference. Verified completion
also needs the existing receipt verifier. An absent effect permits another attempt
only when the reader confirms that the old executor cannot still emit an effect
(`quiescent: true`). Pending/unknown readback releases the lease, persists its next
read time and remains bounded by `maxReconciliations`. No response is an absence proof.

Trusted adapters may throw `AgentSwarmFailure` with transient/permanent failure and
explicitly known absent effect. Other thrown errors preserve uncertainty unless
the host declares the whole executor read-only. Every dispatched attempt and accepted
result rechecks current authorization; execution leases cannot outlive the supplied
session. Model definition resolution remains pinned. Cancellation suppresses late
results while retaining unknown effect state. Synthesis is an output-only adapter.

The in-process `run()` convenience method returns when eligibility is in the future
or reconciliation is needed. Use `nextEligibleAt` to schedule the next wake; waiting
does not occupy a worker or start a polling timer. `work()` executes one eligible
step. `retry()` performs one bounded reconciliation, never an unreviewed blind replay.

Planning also persists the normalized request and a fenced lease. Only an explicitly
read-only planner (`planningEffect: 'read-only'`) may repeat after a crash, within the
original deadline and attempt cap. Unknown planning outcomes stop for review. A
canceled planning reservation cannot accept a late plan. Initial acceptance rechecks
authorization after planning.

`createAgentSwarmWorker({ runtime, stateStore, resolveContext })` performs one `tick()`:
it scans at most 128 retained jobs and dispatches at most eight concurrent operations
(one by default). It reacquires current principal authority through the injected
resolver. SQLite remains the queue and capacity owner. Returned `nextEligibleAt`
lets an explicit host schedule its next wake, with a one-second minimum stalled-job
delay. Missing or expired current authority pauses that job without idle polling;
an explicit host wake rechecks authority. Construction starts no loop. Edge alarm
hosting and fleet capacity still require their deployment adapter. Tick results
omit prompts and outputs.

`startLocalAgentHost({ runtime, stateStore, authenticate, resolveContext })` starts
an explicit process host on `127.0.0.1` with an ephemeral port by default. It serves
the four operations below and starts one bounded wake to resume persisted work.
It schedules another wake only when work is pending. An accepted job continues
after the browser leaves. Authentication and current worker authority are injected
by the product; neither comes from request JSON. Authentication has a five-second
deadline, HTTP operations have a 55-second bound, and four concurrent requests are
allowed by default. Host, origin, JSON and request/response byte checks fail closed.
No cross-origin access is enabled by default. Explicit allowed origins still need
the same authentication; the host emits no CORS grant.

Call `await host.close()` before closing the store. Shutdown cancels timers,
aborts bounded attempts and drains their promises without deleting records.
`host.wake()` rechecks queued jobs after authority becomes available. Its six
tests cover CLI/MCP/HTTP parity, process-kill retry recovery without another start,
idle/unauthorized suspension, wrong-owner denial, request capacity and bounded
shutdown. Shared deadlines release listeners even when an executor never settles.
This process host is local runtime evidence; it is not a public deployment.

`createLocalModelExecutor` accepts a loopback endpoint and exact model/image digests.
The host must verify the FOSS artifact license and bytes, run the isolated server,
and supply authentication through `getHeaders`. Input is capped at 16 KB, output at
256 KB, completion at 2,048 tokens and timeout at 50 seconds. Partial/mismatched
results fail; no network retry occurs inside the adapter. Known token counts and
executor revisions accompany the private result. Monetary cost remains null, and
the runtime cost aggregate remains unknown. No paid endpoint or download is implicit.

The refreshed local package cap is 28 modules / 300 KB across the completed core,
recovery, invocation, local executor and explicit process host. Optional application
adapters have separate per-batch caps documented in `../adapters/README.md`.
Graph registers the four tools through its existing registry and the exported OS
catalog. Its authenticated same-origin HTTP host is a separate required integration.

Legacy v1 ledgers remain readable. A stopped-writer cutover can explicitly call
`migrate({ runId, operationId, expectedDigest }, authenticatedContext)` before old
retention expires. The authorizer must allow `agent.swarm.migrate`; the expected
SHA-256 uses canonical JSON. Migration preserves original effect keys and treats
unfinished old effects as unknown. Changed bytes, unknown schemas or an attempted
new read-only assertion fail closed. This administrative seam is not a model tool.

The existing catalog owns `/run.start`, `/run.status`, `/run.cancel`, `/run.retry`:

```sh
agentic-os /run.start @input:request.json '#mutating'
agentic-os /run.status @input:status.json '#read-only'
```

Configure `AGENTIC_OS_RUN_ENDPOINT` to an authenticated `/api/agent-swarm/` endpoint
and optionally `AGENTIC_OS_RUN_TOKEN` in the host environment. MCP exposes the same
four names with typed JSON input, passed to CLI stdin. Tool input cannot supply
endpoints, principals, tokens or executable code. `agentic-os/agents/invocation`
exports the shared validator/dispatcher and optional portable HTTP client for
browser adapters. Construction performs no I/O. Transport failure never retries
automatically; uncertain mutations carry `writeResultUnknown`.

Evidence: `agent-durable-workflow.test.mjs` kills a process after an effect but
before checkpoint, reopens SQLite, reconciles one receipt, and verifies zero repeat
executions. It also covers delay, exhaustion, retention, revoked authorization,
source-bound legacy conversion and fencing. `agent-run-invocation.test.mjs` joins
the catalog, real CLI subprocesses, MCP, authenticated HTTP and portable client.
These deterministic tests establish recovery/transport behavior, not AI quality,
browser/offline completion, live deployment or payment evidence.
