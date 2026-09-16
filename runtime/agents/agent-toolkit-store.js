import { assertIdentifier } from "./agent-toolkit-contract.js";
import { createMemoryRecordStore } from "./agent-swarm-store.js";

/** Contract adapter; both owners share the same atomic claim implementation. */
export function createAgentToolkitMemoryStore({ now = () => Date.now() } = {}) {
  const { commit, ...store } = createMemoryRecordStore({ now, identityField: 'recordId', validate: assertIdentifier, countField: 'records' });
  return Object.freeze(store);
}
