import { verifySessionToken } from "./auth.js";
import { dispatchRunOperation, RUN_OPERATIONS } from "../agents/invocation.js";

function json(statusCode, body) {
  if (Buffer.byteLength(JSON.stringify(body)) > 256 * 1024) return json(500, { code: 'run_response_too_large' });
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function bearer(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const match = /^Bearer\s+(.+)$/i.exec(String(source.authorization || source.Authorization || ""));
  return match ? match[1].trim() : "";
}

function responseStatus(action, result) {
  if (result.reasonCode === "run_forbidden") return 403;
  if (result.reasonCode === "principal_expired") return 401;
  if (["completed", "failed", "insufficient-evidence"].includes(result.status)) return 200;
  if (result.status === "canceled") return 200;
  if (["planning", "running", "pending", "idle", "retryable", "synthesizing", "reconciling"].includes(result.status)) return 202;
  return 409;
}

export function createAgentSwarmHandlers({ secret, agentSwarm, now } = {}) {
  const swarmStats = agentSwarm && typeof agentSwarm.stats === "function" ? agentSwarm.stats() : {};
  const configured = Boolean(swarmStats.configured);

  function handler(action, operation) {
    return async function agentSwarmHandler(request = {}) {
      if (!secret) return json(501, { error: "auth not configured" });
      const verdict = verifySessionToken(bearer(request.headers), secret, { now });
      if (!verdict.valid) {
        return json(401, { error: "unauthorized" });
      }
      if (!configured) return json(501, { error: "agent swarm not configured" });
      try {
        const body = request.body || {};
        if (Object.hasOwn(body, "signal")) {
          throw new TypeError("request.signal is server-owned and cannot be supplied over HTTP.");
        }
        const operationBody = request.signal && ["work", "settle"].includes(action)
          ? { ...body, signal: request.signal }
          : body;
        const context = {
          principalId: verdict.claims.sub,
          principalExpiresAt: verdict.claims.exp * 1000,
        };
        const result = operation
          ? await operation(operationBody, context)
          : await dispatchRunOperation(agentSwarm, action, body, context, request.signal);
        return json(responseStatus(action, result), result);
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          return json(400, { error: "invalid request", reason: error.message });
        }
        const forbidden = error?.reasonCode === "run_forbidden";
        return json(forbidden ? 403 : 409, {
          error: forbidden ? "forbidden" : "agent swarm operation failed",
          code: forbidden ? "run_forbidden" : "swarm_operation_failed",
        });
      }
    };
  }

  return Object.freeze({
    ...Object.fromEntries(RUN_OPERATIONS.map(operation => [operation, handler(operation)])),
    work: handler('work', (body, context) => agentSwarm.work(body, context)),
    settle: handler('settle', (body, context) => agentSwarm.settle(body, context)),
  });
}
