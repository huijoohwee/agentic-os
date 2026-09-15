import { appendFileSync } from 'node:fs';
import { startLocalAgentHost } from '../../runtime/agents/local-host.js';
import { createAgentSwarmSqliteStore } from '../../runtime/agents/sqlite-store.js';
import { AgentSwarmFailure } from '../../runtime/agents/agent-swarm.js';
import { fixture, request, context, output } from './workflow-fixture.mjs';

const { path, effectPath, mode } = JSON.parse(process.argv[2]);
const stateStore = await createAgentSwarmSqliteStore({ directory: path });
const runtime = fixture({ stateStore, now: Date.now, taskTimeoutMs: 500, taskLeaseMs: 1_000,
  retryBaseMs: 1_500, retryMaxMs: 1_500, taskEffect: 'read-only',
  executeTask: async () => {
    if (mode === 'fail-once') throw new AgentSwarmFailure('temporary-fixture-failure', { kind: 'transient', effectState: 'absent' });
    appendFileSync(effectPath, 'completed\n', { mode: 0o600 }); return output;
  } });
let notified = false;
const host = await startLocalAgentHost({ runtime, stateStore,
  authenticate: ({ headers }) => headers.authorization === 'Bearer local-test' ? context : null,
  resolveContext: async () => context,
  onEvent: event => {
    if (notified) return;
    if (mode === 'fail-once' && event.runs?.some(run => run.status === 'retryable')) {
      notified = true; process.send({ retry: 'persisted' });
    } else if (mode === 'resume') {
      runtime.status(request.runId, context).then(result => {
        if (!notified && result.status === 'completed') { notified = true; process.send({ status: 'completed' }); }
      });
    }
  } });
process.send({ endpoint: host.endpoint });
process.on('SIGTERM', async () => { await host.close(); stateStore.close(); process.exit(0); });
