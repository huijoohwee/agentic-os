import { MAX_RECORD_CHARS, identifier, requireNamespace, boundedRecord, operate } from "../agents/durable-object-transport.js";

export function createDurableObjectHumanReviewStore({ namespace, maxRecordChars = MAX_RECORD_CHARS } = {}) {
  const owner = requireNamespace(namespace);
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "reviewRecord", maxRecordChars);
      const result = await operate(owner, `review:${identifier(record.reviewId, "reviewRecord.reviewId")}`, "put", { record });
      return result.stored === true;
    },
    async take(reviewId) {
      const result = await operate(owner, `review:${identifier(reviewId, "reviewId")}`, "take", {});
      return result.record ?? null;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicConsume: true,
      pendingReviews: null,
    }),
  });
}

export function createDurableObjectPausedTurnStore({ namespace, maxRecordChars = MAX_RECORD_CHARS } = {}) {
  const owner = requireNamespace(namespace);
  const scope = (conversationId) => `paused-turn:${identifier(conversationId, "conversationId")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "pausedTurn", maxRecordChars);
      const result = await operate(owner, scope(record.conversationId), "put", { record });
      return result.stored === true;
    },
    async get(conversationId) {
      const result = await operate(owner, scope(conversationId), "get", {});
      return result.record ?? null;
    },
    async claim(conversationId, claimId, claimExpiresAt) {
      const result = await operate(owner, scope(conversationId), "claim", {
        claimId: identifier(claimId, "claimId"),
        claimExpiresAt,
      });
      return result.record ?? null;
    },
    async commit(conversationId, claimId) {
      const result = await operate(owner, scope(conversationId), "commit", { claimId: identifier(claimId, "claimId") });
      return result.committed === true;
    },
    async release(conversationId, claimId) {
      const result = await operate(owner, scope(conversationId), "release", { claimId: identifier(claimId, "claimId") });
      return result.released === true;
    },
    async replace(conversationId, claimId, value) {
      const record = boundedRecord(value, "pausedTurn", maxRecordChars);
      const result = await operate(owner, scope(conversationId), "replace", {
        claimId: identifier(claimId, "claimId"),
        record,
      });
      return result.replaced === true;
    },
    async delete(conversationId) {
      const result = await operate(owner, scope(conversationId), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      recovery: "cross-isolate",
    }),
  });
}

export function createDurableObjectFunctionContinuationStore({
  namespace,
  maxRecordChars = MAX_RECORD_CHARS,
} = {}) {
  const owner = requireNamespace(namespace);
  const scope = (runId) => `function-continuation:${identifier(runId, "runId")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "functionContinuation", maxRecordChars);
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
    async commit(runId, claimId) {
      const result = await operate(owner, scope(runId), "commit", { claimId: identifier(claimId, "claimId") });
      return result.committed === true;
    },
    async release(runId, claimId) {
      const result = await operate(owner, scope(runId), "release", { claimId: identifier(claimId, "claimId") });
      return result.released === true;
    },
    async replace(runId, claimId, value) {
      const record = boundedRecord(value, "functionContinuation", maxRecordChars);
      const result = await operate(owner, scope(runId), "replace", {
        claimId: identifier(claimId, "claimId"), record,
      });
      return result.replaced === true;
    },
    async delete(runId) {
      const result = await operate(owner, scope(runId), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      recovery: "cross-isolate",
      owner: "function-calling-manager",
    }),
  });
}

export function createDurableObjectFunctionExecutionReceiptStore({
  namespace,
  maxRecordChars = MAX_RECORD_CHARS,
} = {}) {
  const owner = requireNamespace(namespace);
  const scope = (receiptKey) => `function-execution:${identifier(receiptKey, "receiptKey")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "functionExecutionReceipt", maxRecordChars);
      const result = await operate(owner, scope(record.receiptKey), "put", { record });
      return result.stored === true;
    },
    async get(receiptKey) {
      const result = await operate(owner, scope(receiptKey), "get", {});
      return result.record ?? null;
    },
    async claim(receiptKey, claimId, claimExpiresAt) {
      const result = await operate(owner, scope(receiptKey), "claim", {
        claimId: identifier(claimId, "claimId"), claimExpiresAt,
      });
      return result.record ?? null;
    },
    async replace(receiptKey, claimId, value) {
      const record = boundedRecord(value, "functionExecutionReceipt", maxRecordChars);
      const result = await operate(owner, scope(receiptKey), "replace", {
        claimId: identifier(claimId, "claimId"), record,
      });
      return result.replaced === true;
    },
    async release(receiptKey, claimId) {
      const result = await operate(owner, scope(receiptKey), "release", {
        claimId: identifier(claimId, "claimId"),
      });
      return result.released === true;
    },
    async delete(receiptKey) {
      const result = await operate(owner, scope(receiptKey), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      recovery: "cross-isolate",
      owner: "function-tool-gateway",
    }),
  });
}

export { createDurableObjectSwarmRunStore, createDurableObjectAgentToolkitStore }
  from '../agents/durable-object-store.js';

// Skill draft store for the native skill creation harness. Reuses the AGENT_STATE
// Durable Object with the reserved key namespaces skill-draft:{draft_id} and
// skill-draft-index:{adapter_id}; adds no Cloudflare binding. Draft lifetime is
// capped at 30 days because worker/agent-state.js enforces MAX_RECORD_TTL_MS.
export const SKILL_DRAFT_STORE_DEFAULTS = Object.freeze({
  maxDraftsPerAdapter: 64,
  maxIndexTtlMs: 30 * 24 * 60 * 60 * 1000,
});

export function createDurableObjectSkillDraftStore({
  namespace,
  maxRecordChars = MAX_RECORD_CHARS,
  maxDraftsPerAdapter = SKILL_DRAFT_STORE_DEFAULTS.maxDraftsPerAdapter,
} = {}) {
  const owner = requireNamespace(namespace);
  const draftScope = (draftId) => `skill-draft:${identifier(draftId, "draftId")}`;
  const indexScope = (adapterId) => `skill-draft-index:${identifier(adapterId, "adapterId")}`;

  // One atomic claim-then-replace cycle is the only multi-step mutation; both
  // steps run inside the Durable Object transaction boundary.
  async function upsertIndexed(scope, claimId, buildRecord) {
    const claimed = await operate(owner, scope, "claim", {
      claimId,
      claimExpiresAt: Date.now() + 60_000,
    });
    if (claimed.record) {
      let replacement;
      try {
        replacement = boundedRecord(buildRecord(claimed.record), "skillDraftRecord", maxRecordChars);
      } catch (error) {
        // Release the claim so an invalid consume does not wedge the record
        // until the claim lease expires.
        await operate(owner, scope, "release", { claimId });
        throw error;
      }
      const replaced = await operate(owner, scope, "replace", { claimId, record: replacement });
      if (!replaced.replaced) {
        await operate(owner, scope, "release", { claimId });
        throw new TypeError("Durable state skill draft replace failed.");
      }
      return true;
    }
    const record = boundedRecord(buildRecord(null), "skillDraftRecord", maxRecordChars);
    const result = await operate(owner, scope, "put", { record });
    if (!result.stored) throw new TypeError("Durable state skill draft put failed.");
    return true;
  }

  return Object.freeze({
    // Exactly one put per draft write: physical atomicity is inherited from the
    // Durable Object transact boundary, not rebuilt here.
    async put(value) {
      if (!value || typeof value !== "object") throw new TypeError("skillDraftRecord must be an object.");
      const draftId = identifier(value.draft_id, "skillDraftRecord.draft_id");
      if (value.status !== "proposed") throw new TypeError("skillDraftRecord.status must be proposed.");
      if (value.consumed !== false) throw new TypeError("skillDraftRecord.consumed must start false.");
      const expiresAt = Number.isFinite(value.expires_at_ms)
        ? value.expires_at_ms
        : Date.now() + SKILL_DRAFT_STORE_DEFAULTS.maxIndexTtlMs;
      const record = boundedRecord({ ...value, draft_id: draftId, expiresAt }, "skillDraftRecord", maxRecordChars);
      const result = await operate(owner, draftScope(draftId), "put", { record });
      return result.stored === true;
    },
    async peek(draftId) {
      const result = await operate(owner, draftScope(draftId), "get", {});
      const record = result.record ?? null;
      // The Durable Object already drops expired records; the guard keeps the
      // contract local so a stale read can never reach the promotion gate.
      return record && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now() ? record : null;
    },
    // The only mutation the promotion gate needs: an atomic consume that moves
    // consumed to true under a claim, so a retry cannot double-promote.
    async markConsumed(draftId) {
      const claimId = `skill-draft-consume:${draftId}:${Date.now()}`;
      return upsertIndexed(draftScope(draftId), claimId, (existing) => {
        if (!existing || existing.consumed) throw new TypeError("Durable state skill draft is not consumable.");
        return { ...existing, consumed: true, expiresAt: existing.expiresAt };
      });
    },
    async indexAppend(adapterId, draftId) {
      return upsertIndexed(indexScope(adapterId), `skill-draft-index:${adapterId}:${Date.now()}`, (existing) => {
        const draftIds = existing?.draftIds ? [...existing.draftIds] : [];
        if (!draftIds.includes(draftId)) draftIds.push(draftId);
        if (draftIds.length > maxDraftsPerAdapter) {
          throw new RangeError(`skill draft index is limited to ${maxDraftsPerAdapter} drafts per adapter.`);
        }
        return {
          adapterId: identifier(adapterId, "adapterId"),
          draftIds,
          expiresAt: Date.now() + SKILL_DRAFT_STORE_DEFAULTS.maxIndexTtlMs,
        };
      });
    },
    async indexList(adapterId) {
      const result = await operate(owner, indexScope(adapterId), "get", {});
      const record = result.record ?? null;
      return record && Array.isArray(record.draftIds) ? [...record.draftIds] : [];
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicConsume: true,
      owner: "native-skill-harness",
      keyNamespace: "skill-draft:",
      bindingsAdded: 0,
      drafts: null,
    }),
  });
}

export const DURABLE_OBJECT_STATE_DEFAULTS = Object.freeze({ maxRecordChars: MAX_RECORD_CHARS });
