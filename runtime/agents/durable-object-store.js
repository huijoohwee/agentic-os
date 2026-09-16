import { MAX_RECORD_CHARS, identifier, requireNamespace, boundedRecord, operate } from "./durable-object-transport.js";

/** Both adapters share one claim protocol; their durable namespaces remain distinct. */
function createStore({ namespace, maxRecordChars = MAX_RECORD_CHARS }, ownerName, field, label) {
  const owner = requireNamespace(namespace);
  const scope = id => `${ownerName === 'agent-swarm' ? 'swarm-run' : ownerName}:${identifier(id, field)}`;
  const call = (id, operation, body = {}) => operate(owner, scope(id), operation, body);
  const fence = claimId => ({ claimId: identifier(claimId, 'claimId') });
  const store = {
    async put(value) {
      const record = boundedRecord(value, label, maxRecordChars);
      return (await call(record[field], 'put', { record })).stored === true;
    },
    async get(id) { return (await call(id, 'get')).record ?? null; },
    async claim(id, claimId, claimExpiresAt) {
      return (await call(id, 'claim', { ...fence(claimId), claimExpiresAt })).record ?? null;
    },
    async replace(id, claimId, value) {
      const record = boundedRecord(value, label, maxRecordChars);
      return (await call(id, 'replace', { ...fence(claimId), record })).replaced === true;
    },
    async release(id, claimId) { return (await call(id, 'release', fence(claimId))).released === true; },
    async delete(id) { return (await call(id, 'delete')).deleted === true; },
    stats: () => Object.freeze({ persistence: 'durable-object', atomicClaims: true, horizontalRecovery: true,
      owner: ownerName, [field === 'runId' ? 'activeRuns' : 'records']: null }),
  };
  if (field === 'runId') store.commit = async (id, claimId) => (await call(id, 'commit', fence(claimId))).committed === true;
  return Object.freeze(store);
}

export const createDurableObjectSwarmRunStore = (options = {}) => createStore(options, 'agent-swarm', 'runId', 'swarmRun');
export const createDurableObjectAgentToolkitStore = (options = {}) => createStore(options, 'agent-toolkit', 'recordId', 'agentToolkitRecord');
