import { MAX_RECORD_CHARS, identifier, requireNamespace, boundedRecord, operate } from "./durable-object-transport.js";

export function createDurableObjectSwarmRunStore({ namespace, maxRecordChars = MAX_RECORD_CHARS } = {}) {
  const owner = requireNamespace(namespace);
  const scope = (runId) => `swarm-run:${identifier(runId, "runId")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "swarmRun", maxRecordChars);
      const result = await operate(owner, scope(record.runId), "put", { record });
      return result.stored === true;
    },
    async get(runId) {
      const result = await operate(owner, scope(runId), "get", {});
      return result.record ?? null;
    },
    async claim(runId, claimId, claimExpiresAt) {
      const result = await operate(owner, scope(runId), "claim", {
        claimId: identifier(claimId, "claimId"),
        claimExpiresAt,
      });
      return result.record ?? null;
    },
    async replace(runId, claimId, value) {
      const record = boundedRecord(value, "swarmRun", maxRecordChars);
      const result = await operate(owner, scope(runId), "replace", {
        claimId: identifier(claimId, "claimId"),
        record,
      });
      return result.replaced === true;
    },
    async release(runId, claimId) {
      const result = await operate(owner, scope(runId), "release", {
        claimId: identifier(claimId, "claimId"),
      });
      return result.released === true;
    },
    async commit(runId, claimId) {
      const result = await operate(owner, scope(runId), "commit", {
        claimId: identifier(claimId, "claimId"),
      });
      return result.committed === true;
    },
    async delete(runId) {
      const result = await operate(owner, scope(runId), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      horizontalRecovery: true,
      owner: "agent-swarm",
      activeRuns: null,
    }),
  });
}

export function createDurableObjectAgentToolkitStore({ namespace, maxRecordChars = MAX_RECORD_CHARS } = {}) {
  const owner = requireNamespace(namespace);
  const scope = (recordId) => `agent-toolkit:${identifier(recordId, "recordId")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "agentToolkitRecord", maxRecordChars);
      const result = await operate(owner, scope(record.recordId), "put", { record });
      return result.stored === true;
    },
    async get(recordId) {
      const result = await operate(owner, scope(recordId), "get", {});
      return result.record ?? null;
    },
    async claim(recordId, claimId, claimExpiresAt) {
      const result = await operate(owner, scope(recordId), "claim", {
        claimId: identifier(claimId, "claimId"),
        claimExpiresAt,
      });
      return result.record ?? null;
    },
    async replace(recordId, claimId, value) {
      const record = boundedRecord(value, "agentToolkitRecord", maxRecordChars);
      const result = await operate(owner, scope(recordId), "replace", {
        claimId: identifier(claimId, "claimId"),
        record,
      });
      return result.replaced === true;
    },
    async release(recordId, claimId) {
      const result = await operate(owner, scope(recordId), "release", {
        claimId: identifier(claimId, "claimId"),
      });
      return result.released === true;
    },
    async delete(recordId) {
      const result = await operate(owner, scope(recordId), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      horizontalRecovery: true,
      owner: "agent-toolkit",
      records: null,
    }),
  });
}

