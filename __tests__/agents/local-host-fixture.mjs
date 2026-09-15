import { appendFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { startLocalAgentHost } from '../../runtime/agents/local-host.js';
import { createAgentSwarmSqliteStore } from '../../runtime/agents/sqlite-store.js';
import { AgentSwarmFailure } from '../../runtime/agents/agent-swarm.js';
import { fixture, request, context, output } from './workflow-fixture.mjs';

const { path, effectPath, mode } = JSON.parse(process.argv[2]);
const sqlite = await createAgentSwarmSqliteStore({ directory: path });
// Exercise real I/O scheduling beyond the fake-clock fixture's 10 ms claim lease.
const stateStore = { ...sqlite, async claim(...args) {
  const record = await sqlite.claim(...args); await pause(25); return record;
} };
const runtime = fixture({ stateStore, now: Date.now, taskTimeoutMs: 500, taskLeaseMs: 1_500, storeClaimTtlMs: 500,
  retryBaseMs: 1_500, retryMaxMs: 1_500, taskEffect: 'read-only',
  executeTask: async () => {
    if (mode === 'fail-once') throw new AgentSwarmFailure('temporary-fixture-failure', { kind: 'transient', effectState: 'absent' });
    appendFileSync(effectPath, 'completed\n', { mode: 0o600 }); return output;
  } });
let notified = false;
function notify(message) {
  if (notified) return;
  notified = true; process.send(message);
  // Deliberately report completion before readiness to make IPC ordering coverage deterministic.
  if (mode === 'resume') process.send({ endpoint: host.endpoint });
}
const host = await startLocalAgentHost({ runtime, stateStore,
  authenticate: ({ headers }) => headers.authorization === 'Bearer local-test' ? context : null,
  resolveContext: async () => context,
  onEvent: event => {
    if (notified) return;
    const failed = event.runs?.find(run => ['paused', 'blocked'].includes(run.status));
    if (failed || event.status === 'paused') {
      notify({ status: 'failed', reasonCode: failed?.reasonCode ?? event.reasonCode }); return;
    }
    if (mode === 'fail-once' && event.runs?.some(run => run.status === 'retryable')) {
      notify({ retry: 'persisted' });
    } else if (mode === 'resume') {
      runtime.status(request.runId, context).then(result => {
        if (result.status === 'completed') notify({ status: 'completed' });
        else if (result.status === 'blocked') notify({ status: 'failed', reasonCode: result.reasonCode });
      }).catch(error => notify({ status: 'failed', reasonCode: error.reasonCode ?? error.name }));
    }
  } });
if (mode !== 'resume') process.send({ endpoint: host.endpoint });
process.on('SIGTERM', async () => { await host.close(); stateStore.close(); process.exit(0); });
