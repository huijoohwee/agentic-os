# Optional native capabilities

These are the first three application-transfer batches under
[`DURABLE-AGENT-WORKFLOWS-001@0.1.0`](../../guides/DURABLE-WORKFLOWS.md).
The three `MIGRATION*.json` manifests bind 57 modules to native source bytes
and destination hashes. Each batch has at most 20 modules and is below 300 KB;
every module is below 600 lines.

Each capability is loaded explicitly through `agentic-os/agents/<module-name>`.
Definitions, model selection, guardrails, skill proposals, deferred tool discovery,
function execution and sandbox contracts retain their injected execution owners.
Imports perform no provider calls, container starts or background work.

The original eight owner test files now live in OS and are available through
`agentic-os/tests/agents/<test-name>`. Their 55 tests passed at the source revision
and after relocation. Consumer test entry points can forward to these explicit
subpaths after pinning the protected package; they need no duplicate test bodies.

New skill proposals identify the OS package subpath as their implementation owner.
Existing proposal identities and stored historical provenance require their current
validators; relocation does not rewrite old records or infer approval.

The second batch transfers HTTP authentication, function gateways, bounded Podman
execution and optional provider adapters. Existing paid-provider compatibility
requires its explicit configuration and approval; it is never selected by the
free local executor. Offline adapter tests inject transport fixtures and spend nothing.

The third batch transfers optional application composition, the Graph MCP client,
browser embedding, collaboration rooms, and generic Durable Object storage.
`AgentState.handleExtension` rejects unknown operations by default. The product
adapter supplies Commerce admission rules; generic storage imports none of them.
The existing record keys, 30-day record limit and claim/alarm behavior are retained.

All 121 application tests passed at the native candidate and after transfer.
The extracted state class also passed 53 existing product/state integration tests
through a candidate-only loader. These checks do not replace a protected consumer
pin, Workers platform execution or namespace recovery proof.

Status: source transfer in progress. Canvas consumer pins, remaining application
adapters, assets, state composition and deployment proof are outstanding.
This batch does not establish application cutover or production readiness.
