import { createServer } from 'node:http';
import { createAgentSwarmWorker } from './worker.js';
import { dispatchRunOperation, RUN_INPUT_BYTES } from './invocation.js';
import { withDeadline } from './running-agent-contract.js';
import { AgentSwarmBlock } from './agent-swarm-contract.js';

const ROOT = '/api/agent-swarm/';
const OPERATIONS = new Set(['start', 'status', 'cancel', 'retry']);
const RESPONSE_BYTES = 256 * 1024;
const HOST_FAILURE = Symbol('host-failure');
const failure = (status, code) => Object.assign(new Error(code), { [HOST_FAILURE]: true, status, code });

async function readInput(request) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > RUN_INPUT_BYTES))
    throw failure(413, 'run_input_too_large');
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json')
    throw failure(415, 'json_required');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > RUN_INPUT_BYTES) throw failure(413, 'run_input_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure(400, 'invalid_json'); }
}

function respond(response, status, value) {
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body) > RESPONSE_BYTES) {
    status = 500; body = JSON.stringify({ code: 'run_response_too_large' });
  }
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function resultStatus(result) {
  if (result.reasonCode === 'run_forbidden') return 403;
  if (result.reasonCode === 'principal_expired') return 401;
  if (result.status === 'blocked') return 409;
  return ['completed', 'canceled'].includes(result.status) ? 200 : 202;
}

/** Explicit loopback process host. The caller owns model composition, current
 * authentication and store lifetime. Discovery/import performs no I/O. */
export async function startLocalAgentHost({ runtime, stateStore, authenticate, resolveContext,
  port = 0, concurrency = 1, maxRequests = 4, allowedOrigins = [], onEvent = () => {} } = {}) {
  if (typeof authenticate !== 'function' || typeof onEvent !== 'function'
    || !Number.isSafeInteger(port) || port < 0 || port > 65535
    || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 16
    || !Array.isArray(allowedOrigins) || allowedOrigins.length > 8)
    throw new TypeError('Local host requires explicit authentication and bounded options.');
  const origins = new Set(allowedOrigins.map(value => {
    const url = new URL(value);
    if (url.origin !== value || !['http:', 'https:'].includes(url.protocol))
      throw new TypeError('Allowed origins must be exact HTTP origins.');
    return value;
  }));
  const worker = createAgentSwarmWorker({ runtime, stateStore, resolveContext, concurrency });
  const controller = new AbortController(), requests = new Set();
  let stopped = false, timer = null, ticking = null, wakeAgain = false, endpoint = null;
  const emit = event => {
    try { Promise.resolve(onEvent(Object.freeze(event))).catch(() => {}); }
    catch { /* Observer cannot own execution. */ }
  };
  function schedule(at = Date.now()) {
    if (stopped) return;
    if (ticking) { wakeAgain = true; return; }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      ticking = worker.tick({ signal: controller.signal }).then(result => {
        emit({ type: 'worker', ...result });
        return result.nextEligibleAt;
      }, () => { emit({ type: 'worker', status: 'paused', reasonCode: 'worker_store_unavailable' }); return null; })
        .then(next => {
          ticking = null;
          if (wakeAgain) { wakeAgain = false; schedule(); }
          else if (next !== null) schedule(next);
        });
    }, Math.min(2_147_483_647, Math.max(0, at - Date.now())));
  }
  async function handle(request, response) {
    if (stopped) return respond(response, 503, { code: 'host_stopping' });
    try {
      const base = new URL(endpoint);
      if (request.headers.host !== base.host) throw failure(403, 'host_forbidden');
      const origin = request.headers.origin;
      if ((origin && !origins.has(origin)) || (!origin && request.headers['sec-fetch-site'] === 'cross-site'))
        throw failure(403, 'origin_forbidden');
      const url = new URL(request.url, base);
      if (url.origin !== base.origin) throw failure(403, 'host_forbidden');
      const operation = url.pathname.slice(ROOT.length);
      if (!url.pathname.startsWith(ROOT) || !OPERATIONS.has(operation) || url.search)
        throw failure(404, 'run_route_not_found');
      if (request.method !== 'POST') throw failure(405, 'post_required');
      // Authentication precedes input processing; the body cannot supply a principal.
      const authorization = new AbortController();
      const context = await withDeadline(() => authenticate(Object.freeze({
        headers: Object.freeze({ ...request.headers }), operation, signal: authorization.signal,
      })), controller.signal, 5_000, authorization);
      if (!context?.principalId || (context.principalExpiresAt !== undefined && context.principalExpiresAt <= Date.now()))
        throw failure(401, 'principal_expired');
      const input = await readInput(request);
      const attempt = new AbortController();
      const result = await withDeadline(() => dispatchRunOperation(runtime, operation, input, context,
        attempt.signal), controller.signal, 55_000, attempt);
      // A disconnected browser does not cancel its accepted, persisted operation.
      schedule();
      respond(response, resultStatus(result), result);
    } catch (error) {
      const access = error instanceof AgentSwarmBlock && ['run_forbidden', 'principal_expired'].includes(error.reasonCode);
      const status = error?.[HOST_FAILURE] ? error.status : access ? error.reasonCode === 'run_forbidden' ? 403 : 401
        : error instanceof TypeError || error instanceof RangeError ? 400 : 500;
      respond(response, status, { code: error?.[HOST_FAILURE] ? error.code : access ? error.reasonCode
        : status === 400 ? 'invalid_run_input' : 'run_host_failed' });
    }
  }
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 60_000 }, (req, res) => {
    if (requests.size >= maxRequests) return respond(res, 429, { code: 'run_request_capacity' });
    const task = handle(req, res).catch(() => {
      res.destroy(); emit({ type: 'request', status: 'failed', reasonCode: 'run_response_unavailable' });
    }).finally(() => requests.delete(task));
    requests.add(task);
  });
  server.maxConnections = maxRequests + 2;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  endpoint = `http://127.0.0.1:${server.address().port}${ROOT}`;
  origins.add(new URL(endpoint).origin);
  schedule();
  return Object.freeze({ endpoint, wake: () => schedule(),
    stats: () => Object.freeze({ listening: !stopped, activeRequests: requests.size,
      workerActive: ticking !== null, wakeScheduled: timer !== null }),
    async close() {
      if (stopped) return;
      stopped = true; controller.abort(); if (timer) { clearTimeout(timer); timer = null; }
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await Promise.allSettled([closed, ticking, ...requests]);
    } });
}
