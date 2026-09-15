/** Optional headless Worker entry. Importing the OS CLI never loads it. */
import { createCloudflareWorker } from './cloudflare-worker.js';
export { CanvasRoom } from './canvas-room.js';
export { AgentState } from './agent-state.js';
export default createCloudflareWorker();
