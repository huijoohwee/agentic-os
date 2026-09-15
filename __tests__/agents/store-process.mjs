import { createAgentSwarmSqliteStore } from '../../runtime/agents/sqlite-store.js';

const input = JSON.parse(process.argv[2]);
const store = await createAgentSwarmSqliteStore({ directory: input.directory, now: () => 1_000 });
process.send({ type: 'ready' });
process.once('message', async () => {
  try {
    if (input.action === 'checkpoint') {
      await store.put({ runId: 'restart', ownerPrincipalId: 'owner', expiresAt: 10_000,
        checkpoint: { step: 2, effectKey: 'stable-effect', receiptId: 'accepted-receipt' } });
    }
    const record = await store.claim(input.runId ?? 'restart', input.claimId, 2_000);
    process.send({ type: 'result', acquired: Boolean(record) });
    if (input.action !== 'checkpoint') { store.close(); process.disconnect(); }
  } catch (error) {
    process.send({ type: 'error', message: error.message });
    store.close(); process.disconnect(); process.exitCode = 1;
  }
});
