# Native agent runtime

Implementation authority: approved `DURABLE-AGENT-WORKFLOWS-001@0.1.0`,
[source plan](../../guides/DURABLE-WORKFLOWS.md). This is the P1 core transfer.
Consumer cutover, remaining application assets and production proof are separate gates.
`MIGRATION.json` records the native source revision and original file hashes.

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

All processes use the same store and caller-generated unique claim IDs. Expired
execution counts can conservatively block new work until the owning ledger is
recovered. Cross-device state transfer and remote filesystem locking are unproved.

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
