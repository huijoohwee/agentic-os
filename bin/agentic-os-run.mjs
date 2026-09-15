import { readBoundedFile } from '../src/catalog-input.mjs';
import { option } from './agentic-os-argv.mjs';
import { createAgentRunClient, RUN_INPUT_BYTES } from '../runtime/agents/invocation.js';

async function readInput(path) {
  if (path !== '-') return readBoundedFile(path, RUN_INPUT_BYTES, 'run input');
  const chunks = []; let size = 0;
  const timeout = setTimeout(() => process.stdin.destroy(new Error('Run input timed out.')), 5_000);
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length; if (size > RUN_INPUT_BYTES) throw new RangeError('Run input exceeds its byte bound.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timeout); }
}

export async function runAgentCommand(argv, out = console.log, environment = process.env) {
  try {
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readInput(option(argv, 'input'))));
    if (!environment.AGENTIC_OS_RUN_ENDPOINT) throw Object.assign(new Error('Configure an authenticated run endpoint.'), { reasonCode: 'run_endpoint_missing' });
    const client = createAgentRunClient({ endpoint: environment.AGENTIC_OS_RUN_ENDPOINT,
      getHeaders: () => environment.AGENTIC_OS_RUN_TOKEN ? { authorization: `Bearer ${environment.AGENTIC_OS_RUN_TOKEN}` } : {} });
    const result = await client.invoke(argv[0], input); out(JSON.stringify(result));
    return result.status === 'blocked' ? 1 : 0;
  } catch (error) {
    out(JSON.stringify({ status: 'blocked', reasonCode: error.reasonCode ?? 'invalid_run_request',
      ...(error.writeResultUnknown ? { writeResultUnknown: true } : {}) }));
    return 1;
  }
}
