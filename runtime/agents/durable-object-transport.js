import { normalizeJson, serializedJsonLength } from "../json-contract.mjs";

const MAX_RECORD_CHARS = 500_000;
const INTERNAL_URL = "https://agent-state.internal/operation";

function identifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

function requireNamespace(namespace) {
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new TypeError("A Durable Object namespace is required.");
  }
  return namespace;
}

function boundedRecord(value, field, maxRecordChars) {
  const record = normalizeJson(value, field);
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError(`${field} must be an object.`);
  if (!Number.isFinite(record.expiresAt)) throw new TypeError(`${field}.expiresAt must be finite.`);
  if (serializedJsonLength(record) > maxRecordChars) throw new RangeError(`${field} exceeds ${maxRecordChars} characters.`);
  return record;
}

async function operate(namespace, scope, operation, value) {
  const id = namespace.idFromName(identifier(scope, "scope"));
  const stub = namespace.get(id);
  if (!stub || typeof stub.fetch !== "function") throw new TypeError("Durable Object stub is unavailable.");
  const response = await stub.fetch(INTERNAL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, value }),
  });
  if (!response || response.ok !== true) throw new TypeError(`Durable state operation ${operation} failed.`);
  const result = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError(`Durable state operation ${operation} returned invalid evidence.`);
  }
  return result;
}

export { MAX_RECORD_CHARS, identifier, requireNamespace, boundedRecord, operate };
