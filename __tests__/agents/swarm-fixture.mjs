import { createAgentSwarmRuntime } from "../../runtime/agents/agent-swarm.js";

export const COST = Object.freeze({ model: "offline-swarm-model", prompt_tokens: 3, completion_tokens: 2, cache_hits: 1, estimated_cost_usd: 0 });

export const REQUEST = Object.freeze({
  runId: "swarm-run",
  conversationId: "swarm-conversation",
  agent: Object.freeze({ agentId: "base-agent", revision: "base-agent-v1" }),
  goal: "Investigate the goal and return one verified answer.",
  input: Object.freeze({ source: "offline-fixture" }),
  maxParallel: 2,
});

export function task(taskId, dependencies = [], context = null) {
  return { taskId, objective: `Complete ${taskId}.`, dependencies, context };
}

export function createHarness({
  tasks = [task("alpha"), task("beta"), task("final", ["alpha", "beta"])],
  executeTask,
  synthesize,
  verifyReceipt,
  resolveAgent,
  stateStore,
  now,
  ...limits
} = {}) {
  const plannerCalls = [];
  const workerCalls = [];
  const synthesisCalls = [];
  const runtime = createAgentSwarmRuntime({
    resolveAgent: resolveAgent || (async ({ agent }) => ({ status: "ready", ...agent })),
    planTasks: async (call) => {
      plannerCalls.push(call);
      return { status: "completed", planId: "dynamic-plan-v1", tasks, costLog: COST };
    },
    executeTask: executeTask || (async (call) => {
      workerCalls.push(call);
      return { status: "completed", output: `${call.input.task.taskId}-result`, effect: "read-only", costLog: COST };
    }),
    synthesize: synthesize || (async (call) => {
      synthesisCalls.push(call);
      return { status: "completed", output: "one public answer", costLog: COST };
    }),
    verifyReceipt: verifyReceipt || (async ({ receipt }) => ({ verified: true, ...receipt })),
    authorize: async () => ({ allowed: true, approvalId: "offline-swarm-approval" }),
    ...(stateStore ? { stateStore } : {}),
    ...(now ? { now } : {}),
    ...limits,
  });
  return { runtime, plannerCalls, workerCalls, synthesisCalls };
}

