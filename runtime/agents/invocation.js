import { normalizeJson } from '../json-contract.mjs';
import { AGENT_SWARM_DEFAULTS, assertExactKeys, assertIdentifier, normalizeRunOperation,
  normalizeStartRequest } from './agent-swarm-contract.js';
import { normalizeTraceQuery, normalizeEvaluateRequest, normalizeCompareRequest, AGENT_TOOLKIT_DEFAULTS } from './agent-toolkit-contract.js';

export const RUN_OPERATIONS = Object.freeze(['start', 'status', 'cancel', 'retry', 'query', 'trace', 'evaluate', 'compare']);
const OPERATIONS = new Set(RUN_OPERATIONS);
const readOnly = operation => ['status', 'query', 'trace', 'compare'].includes(operation);
export const RUN_INPUT_BYTES = 200_000;
export function validateRunInput(operation, input) {
  if (!OPERATIONS.has(operation)) throw new TypeError('Unknown durable run operation.');
  const value = normalizeJson(input, 'run input');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > RUN_INPUT_BYTES) throw new RangeError('Run input exceeds its byte bound.');
  if (Object.hasOwn(value ?? {}, 'signal')) throw new TypeError('signal is owned by the transport.');
  if (operation === 'query' || operation === 'trace') normalizeTraceQuery(value, operation === 'trace');
  else if (operation === 'evaluate') normalizeEvaluateRequest(value);
  else if (operation === 'compare') normalizeCompareRequest(value, AGENT_TOOLKIT_DEFAULTS.comparison);
  else if (operation === 'start') normalizeStartRequest(value, AGENT_SWARM_DEFAULTS);
  else if (operation === 'status') { assertExactKeys(value, ['runId'], 'request'); assertIdentifier(value.runId, 'runId'); }
  else if (operation === 'cancel') normalizeRunOperation(value, { reason: true });
  else {
    assertExactKeys(value, ['runId', 'taskId', 'operationId'], 'request');
    for (const key of ['runId', 'taskId', 'operationId']) assertIdentifier(value[key], key);
  }
  return value;
}

/** Context is supplied by the authenticated host, never by tool JSON. */
export async function dispatchRunOperation(runtime, operation, input, context, signal) {
  const value = validateRunInput(operation, input);
  if (typeof runtime?.[operation] !== 'function') throw new TypeError('Durable run operation is unavailable.');
  if (operation === 'status') return runtime.status(value.runId, context);
  if (['query', 'trace', 'compare'].includes(operation)) return runtime[operation](value, context);
  return runtime[operation]({ ...value, ...(signal && operation !== 'cancel' ? { signal } : {}) }, context);
}

function trustedUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    throw new TypeError('Run endpoint requires HTTPS or local HTTP without embedded credentials, query or fragment.');
  return new URL(url.href.replace(/\/?$/, '/'));
}

/** Optional browser/CLI transport. Construction performs no I/O, discovery or polling. */
export function createAgentRunClient({ endpoint, fetchImpl = globalThis.fetch, getHeaders = () => ({}), timeoutMs = 55_000 } = {}) {
  const base = trustedUrl(endpoint);
  if (typeof fetchImpl !== 'function' || typeof getHeaders !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 55_000) throw new TypeError('Invalid bounded run transport.');
  return Object.freeze({ async invoke(operation, input, { signal } = {}) {
    const value = validateRunInput(operation, input), controller = new AbortController();
    let dispatched = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const headers = new Headers(await getHeaders()); headers.set('content-type', 'application/json');
      if (controller.signal.aborted) throw new Error('request aborted');
      dispatched = true;
      const response = await fetchImpl(new URL(operation, base).href, { method: 'POST', headers,
        body: JSON.stringify(value), signal: controller.signal, redirect: 'manual', credentials: 'same-origin', cache: 'no-store' });
      // Edge runtimes support manual redirects; browsers may expose an opaque redirect.
      // Neither form may replay an authenticated operation at a different location.
      if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
        await response.body?.cancel(); throw new TypeError('Run endpoint redirected.');
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new TypeError('Run endpoint returned a non-JSON response.');
      const reader = response.body?.getReader();
      if (!reader) throw new TypeError('Run response body is missing.');
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value: chunk } = await reader.read(); if (done) break;
          size += chunk.byteLength;
          if (size > 256 * 1024) throw new RangeError('Run response exceeds its byte bound.');
          chunks.push(chunk);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Run response must be an object.');
      if (!response.ok) return Object.freeze({ status: 'blocked', stage: 'agent-swarm', runId: value.runId,
        reasonCode: response.status === 401 ? 'principal_expired' : response.status === 403 ? 'run_forbidden'
          : typeof result.reasonCode === 'string' ? result.reasonCode : typeof result.code === 'string' ? result.code : 'run_request_rejected',
        httpStatus: response.status, ...(response.status >= 500 && !readOnly(operation) ? { writeResultUnknown: true } : {}) });
      if ((value.runId !== undefined && result.runId !== value.runId)
        || !['planning', 'running', 'completed', 'blocked', 'canceled', 'pending', 'idle', 'reconciling', 'synthesizing', 'failed', 'insufficient-evidence'].includes(result.status))
        throw new TypeError('Run response identity or status is invalid.');
      return normalizeJson(result, 'run response');
    } catch {
      throw Object.assign(new Error('Run transport failed; inspect the same run before retrying.'), {
        reasonCode: 'run_transport_failed', writeResultUnknown: dispatched && !readOnly(operation) });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  } });
}
