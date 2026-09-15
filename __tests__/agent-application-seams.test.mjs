import test from "node:test";
import assert from "node:assert/strict";
import { createAgentToolkitMemoryStore } from "../runtime/agents/agent-toolkit.js";
import { createAgentApiApp } from "../runtime/adapters/app.js";
import { createReasoningContinuityRegistry } from "agentic-os/context/continuity";
import { request, evidence, evaluatorOutcome } from "./agents/agent-toolkit.mjs";

test("reports production readiness only with every application-owned runtime seam", () => {
  const backing = createAgentToolkitMemoryStore();
  const durableStore = Object.freeze({
    ...backing,
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      horizontalRecovery: true,
      owner: "agent-toolkit",
    }),
  });
  const app = createAgentApiApp({
    env: { AGENT_API_JWT_SECRET: "production-contract-secret" },
    agentToolkitStore: durableStore,
    agentToolkitAuthorize: async () => ({ allowed: true, authorizationId: "revision-verified" }),
    agentToolkitEvaluate: async (call) => evaluatorOutcome(0.8, call.evidence.id),
    agentToolkitTelemetry: async () => {},
  });
  assert.equal(app.readiness().agentToolkit.productionReady, true);
  assert.equal(app.readiness().agentToolkit.revisionAuthorizerConfigured, true);
});

test("Agent API handlers authenticate Toolkit mutations and reject caller-owned signals", async () => {
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "toolkit-session-secret" } });
  assert.equal(app.readiness().agentToolkit.contractReady, true);
  assert.equal(app.readiness().agentToolkit.evidencePolicy.includes("metadata-only"), true);
  const unauthorized = await app.agentToolkitStart({ headers: {}, body: request("http-unauthorized") });
  assert.equal(unauthorized.statusCode, 401);
  const session = await app.authSession({ headers: {}, body: {} });
  const token = session.body.token;
  const headers = { authorization: `Bearer ${token}` };
  const started = await app.agentToolkitStart({ headers, body: request("http-run") });
  assert.equal(started.statusCode, 202);
  assert.equal(started.body.status, "running");
  const rejected = await app.agentToolkitEvaluate({
    headers,
    body: { runId: "http-run", operationId: "caller-signal", evidence: evidence("http"), signal: {} },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.reason.includes("server-owned"), true);
});

test("Application consumes upstream continuity with opaque response IDs and sanitized readiness", () => {
  const reasoningContinuity = createReasoningContinuityRegistry();
  const app = createAgentApiApp({ reasoningContinuity });
  assert.equal(app.reasoningContinuity, reasoningContinuity);
  const turn = app.reasoningContinuity.begin({ threadId: "caller/session", goals: ["Deliver MVP"],
    priorities: ["Correctness"], capabilities: { previousResponseId: true, reasoningContexts: [] } });
  app.reasoningContinuity.complete({ threadId: "caller/session", turnToken: turn.turnToken, responseId: "opaque-id" });
  assert.equal(app.readiness().reasoningContinuity.providerEffectiveContext, "unverified");
  assert.doesNotMatch(JSON.stringify(app.readiness().reasoningContinuity), /opaque-id/);
  assert.equal(createAgentApiApp().reasoningContinuity.stats().threads, 0);
});

