# Optional Cloudflare host

The explicit package entry `agentic-os/agents/cloudflare-entry` exports the generic
headless Worker, `CanvasRoom` and `AgentState`. The CLI and metadata discovery do
not load this entry. Commerce injects admission through the existing
`createCloudflareWorker({ createExtension })` factory and exports its compatible
`AgentState` subclass from its own entry.

Import `createCloudflareAgentConfig` from `agentic-os/agents/cloudflare-config` and
supply the consumer's explicit `name`, `main`, `authSessionNamespace` and
`canvasRoomNamespace`. Write the returned JSON to the consumer's release staging
directory for its pinned Wrangler. Product routes, assets, service bindings,
authority values and required product secrets remain consumer-owned. Never put
secret values in the generated configuration. Separate named environments need
their own bindings and namespace IDs. Generation performs no I/O or deployment.

The extracted configuration preserves the existing compatibility date, SQLite
class names, migration tags, rate bounds and sampled observability. It has no
CPU override, model provider, public route, cron or always-running service. A
free account and available quotas still require a live consumer release check.
Readiness is capability reporting, not proof of configured or authorized execution.

## Source cutover and recovery

Changing a source repository does not transfer state. For the existing deployment,
keep the Worker name and both class names; retain the migration history. Observe
the live version, bindings, namespace IDs and migration tag before deployment.
If a class has not yet been created, Wrangler's inactive version upload cannot
bootstrap it. A separately authorized deployment must apply that lifecycle change.
Rollback cannot cross a class lifecycle change: establish a compatible baseline,
preserve the prior source/version and data, and rehearse retained-record readback
after actual version restoration. A configuration test is not that provider proof.

The consumer's protected release, authority and rollback owners remain authoritative.
See [migration source records](MIGRATION-DEPLOYMENT.json).

Platform contracts: [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
and [Worker rollback constraints](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
