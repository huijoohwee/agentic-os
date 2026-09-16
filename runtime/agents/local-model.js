import { normalizeJson } from '../json-contract.mjs';
import { AgentSwarmFailure } from './agent-swarm-contract.js';

/** Optional local inference adapter. The host verifies the licensed model and
 * executable digests before construction. No download, paid API or process starts here. */
export function createLocalModelExecutor({ endpoint, modelDigest, imageDigest, fetchImpl = globalThis.fetch,
  getHeaders = () => ({}), timeoutMs = 50_000, maxTokens = 512, inputTokenLimit } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.hash || url.search
    || !/^[a-f0-9]{64}$/.test(modelDigest) || !/^sha256:[a-f0-9]{64}$/.test(imageDigest)
    || typeof fetchImpl !== 'function' || typeof getHeaders !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 50_000
    || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 2_048
    || (inputTokenLimit !== undefined && (!Number.isSafeInteger(inputTokenLimit) || inputTokenLimit < 1 || inputTokenLimit > 1_000_000)))
    throw new TypeError('Local inference requires loopback HTTP, exact artifacts and bounded execution.');
  const model = `sha256:${modelDigest}`;
  return async function executeTask({ input, execution, signal, resourceBounds }) {
    // The host binds this upper bound to the verified server context-size configuration.
    if (resourceBounds && (!inputTokenLimit || resourceBounds.inputTokens < inputTokenLimit || resourceBounds.outputTokens < 1))
      throw new AgentSwarmFailure('local_budget_ineligible', { kind: 'permanent', effectState: 'absent' });
    const content = JSON.stringify(normalizeJson(input, 'local model input'));
    if (Buffer.byteLength(content) > 16_000) throw new AgentSwarmFailure('local_input_too_large', { kind: 'permanent', effectState: 'absent' });
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, Math.min(timeoutMs, resourceBounds?.elapsedMs ?? timeoutMs));
    try {
      const headers = new Headers(await getHeaders());
      headers.set('content-type', 'application/json'); headers.set('idempotency-key', execution.idempotencyKey);
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0,
          max_tokens: Math.min(maxTokens, resourceBounds?.outputTokens ?? maxTokens), stream: false, chat_template_kwargs: { enable_thinking: false } }) });
      if (!response.ok) throw new AgentSwarmFailure('local_model_rejected', {
        kind: response.status === 429 || response.status >= 500 ? 'transient' : 'permanent', effectState: 'absent' });
      const reader = response.body?.getReader();
      if (!reader || !response.headers.get('content-type')?.includes('application/json')) throw Error('Invalid local response');
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > 256_000) throw Error('Local output too large'); chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const text = result.choices?.[0]?.message?.content;
      if (result.model !== model || typeof text !== 'string' || !text.trim() || text.length > 32_000
        || result.choices.length !== 1 || result.choices[0].finish_reason !== 'stop') throw Error('Incomplete or mismatched local output');
      const usage = result.usage;
      const knownTokens = usage && ['prompt_tokens', 'completion_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
        ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : null;
      return { status: 'completed', effect: 'read-only', output: { text,
        executor: { modelRevision: model, imageRevision: imageDigest },
        usage: knownTokens, costUsd: null } };
    } catch (error) {
      if (error instanceof AgentSwarmFailure) throw error;
      throw new AgentSwarmFailure('local_model_unavailable', { kind: 'transient', effectState: 'absent' });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}
