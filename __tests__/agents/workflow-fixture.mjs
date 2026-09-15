import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAgentSwarmRuntime } from '../../runtime/agents/agent-swarm.js';
import { createAgentSwarmSqliteStore } from '../../runtime/agents/sqlite-store.js';

export const cost = { model: 'deterministic-fixture', prompt_tokens: 0, completion_tokens: 0,
  cache_hits: 0, estimated_cost_usd: 0 };
export const request = { runId: 'durable-job', conversationId: 'seller-draft',
  agent: { agentId: 'listing', revision: 'fixture-v1' }, goal: 'Prepare a listing', input: { a: 1, b: 2 }, maxParallel: 1 };
export const context = { principalId: 'seller' };
export const output = { status: 'completed', output: 'listing fixture', effect: 'read-only', costLog: cost };
export function fixture(options = {}) {
  return createAgentSwarmRuntime({ now: () => 1_000, taskTimeoutMs: 50, taskLeaseMs: 100,
    storeClaimTtlMs: 10, runTtlMs: 10_000, retentionMs: 20_000, retryBaseMs: 20, retryMaxMs: 100,
    resolveAgent: async ({ agent }) => ({ status: 'ready', ...agent }),
    authorize: async () => ({ allowed: true, approvalId: 'fixture-approval' }),
    planTasks: async () => ({ status: 'completed', planId: 'listing-plan-v1',
      tasks: [{ taskId: 'listing', objective: 'Prepare the listing', dependencies: [], context: null }], costLog: cost }),
    executeTask: async () => output,
    synthesize: async () => ({ status: 'completed', output: 'reviewed listing fixture', costLog: cost }),
    verifyReceipt: async ({ receipt }) => ({ verified: true, ...receipt }), ...options });
}
export const work = (runtime, operationId = 'work') => runtime.work({ runId: request.runId, workerId: 'worker', operationId }, context);
export const retry = runtime => runtime.retry({ runId: request.runId, taskId: 'listing', operationId: 'retry' }, context);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { directory, effectPath, planning } = JSON.parse(process.argv[2]);
  const store = await createAgentSwarmSqliteStore({ directory, now: () => 1_000 });
  const runtime = fixture({ stateStore: store, ...(planning ? { planningEffect: 'read-only', planTasks: async () => {
    process.send({ planning: 'persisted' }); return new Promise(() => {});
  } } : {}), executeTask: async call => {
    writeFileSync(effectPath, JSON.stringify({ idempotencyKey: call.execution.idempotencyKey, receiptId: 'effect-once' }),
      { flag: 'wx', mode: 0o600, flush: true });
    process.send({ effect: 'committed' });
    return new Promise(() => {});
  } });
  if (planning) await runtime.start(request, context); else await work(runtime);
  store.close();
}
