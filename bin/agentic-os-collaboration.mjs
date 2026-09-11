/** Cooperative work admission and handoffs, not authority or a model-execution loop. */
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { pathsOverlap, parseWritePaths } from '../src/worktree.mjs';
export const COLLAB_SCHEMA = 'agentic-os/collaboration/v1';
export const COLLAB_LIMITS = Object.freeze({ bytes: 65536, tasks: 32, active: 2, leaseMs: 600000 });
export const fail = reason => { throw new Error(`blocked-collaboration-${reason}`); };
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const STATES = ['pending', 'active', 'released', 'reported'];
const TASK_KEYS = 'id,repository,sourceRevision,contextRevision,objective,writePaths,maxSeconds,maxTokens,epoch,attempts,state,actor,startedAt,expiresAt,result';
export function keys(value, expected) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== expected.split(',').sort().join(',')) fail('shape');
}
function text(value, maximum = 128) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum
    || /[\x00-\x1f\x7f]/u.test(value)) fail('text');
}
function number(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('number');
}
function actor(value) {
  keys(value, 'device,agent,provider,model');
  for (const item of Object.values(value)) {
    text(item, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(item)) fail('actor');
  }
}
function result(value) {
  keys(value, 'outcome,summary,sourceRevision,refs,tokens,stopped');
  if (!['success', 'blocked'].includes(value.outcome) || !SHA.test(value.sourceRevision)
    || value.stopped !== true) fail('handoff');
  text(value.summary, 1024); number(value.tokens, 0, 1000000);
  if (!Array.isArray(value.refs) || value.refs.length > 8) fail('references');
  for (const ref of value.refs) {
    text(ref, 256);
    if (!/^https?:\/\//u.test(ref)) fail('reference-url');
    const url = new URL(ref); if (!url.hostname || url.username || url.password) fail('reference-url');
  }
}
function task(value) {
  keys(value, TASK_KEYS); text(value.id, 64);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value.id)) fail('task-id');
  text(value.repository, 256); text(value.objective, 1024);
  if (!SHA.test(value.sourceRevision) || !SHA.test(value.contextRevision)) fail('revision');
  if (!Array.isArray(value.writePaths) || value.writePaths.length > 32) fail('write-paths');
  if (value.writePaths.length) {
    for (const path of value.writePaths) {
      text(path, 256);
      if (!path.split('/').every(p => /^[A-Za-z0-9._-]+$/u.test(p) && !['.', '..', '.git'].includes(p)))
        fail('write-paths');
    }
    if (JSON.stringify(parseWritePaths(value.writePaths.join(','))) !== JSON.stringify(value.writePaths))
      fail('write-paths');
  }
  number(value.maxSeconds, 30, 3600); number(value.maxTokens, 1, 1000000);
  number(value.epoch, 0, Number.MAX_SAFE_INTEGER); number(value.attempts, 0, 3);
  if (!STATES.includes(value.state)) fail('state');
  if (value.actor !== null) actor(value.actor);
  for (const time of [value.startedAt, value.expiresAt]) if (time !== null) number(time, 0, Number.MAX_SAFE_INTEGER);
  if (value.state === 'pending' && (value.actor !== null || value.epoch || value.attempts || value.startedAt !== null
    || value.expiresAt !== null || value.result !== null)) fail('pending-state');
  if (value.state !== 'pending' && (!value.actor || !value.epoch || !value.attempts || value.startedAt === null
    || value.expiresAt === null || value.expiresAt <= value.startedAt
    || value.expiresAt > value.startedAt + value.maxSeconds * 1000)) fail('claim-state');
  if (value.result !== null) result(value.result);
  if ((value.state === 'reported') !== (value.result !== null)) fail('result-state');
}
export function validateBoard(input) {
  const bytes = canonicalJson(input); if (Buffer.byteLength(bytes) > COLLAB_LIMITS.bytes) fail('byte-budget');
  const value = JSON.parse(bytes); keys(value, 'schema,updatedAt,sequence,tasks');
  if (value.schema !== COLLAB_SCHEMA) fail('schema');
  number(value.updatedAt, 0, Number.MAX_SAFE_INTEGER);
  number(value.sequence, 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(value.tasks) || value.tasks.length > COLLAB_LIMITS.tasks) fail('task-budget');
  value.tasks.forEach(task);
  if (value.tasks.some(t => t.epoch > value.sequence)) fail('sequence');
  if (new Set(value.tasks.map(t => t.id)).size !== value.tasks.length) fail('duplicate-task');
  const active = value.tasks.filter(t => t.state === 'active');
  if (active.length > COLLAB_LIMITS.active) fail('active-budget');
  for (let i = 0; i < active.length; i++) for (const other of active.slice(i + 1))
    if (other.repository === active[i].repository && other.writePaths.some(p =>
      active[i].writePaths.some(q => pathsOverlap(p, q)))) fail('write-overlap');
  return value;
}
export const emptyBoard = () => ({ schema: COLLAB_SCHEMA, updatedAt: 0, sequence: 0, tasks: [] });
export function transitionBoard(input, operation, request, { repository, now = Date.now() }) {
  const board = validateBoard(input); canonicalJson(request); number(now, board.updatedAt, Number.MAX_SAFE_INTEGER);
  const common = 'expectedRevision,id';
  const fields = { submit: `${common},sourceRevision,contextRevision,objective,writePaths,maxSeconds,maxTokens`,
    claim: `${common},actor`, renew: `${common},actor,epoch`, release: `${common},actor,epoch,stopped`,
    report: `${common},actor,epoch,result`, archive: `${common},actor,epoch` }[operation];
  if (!fields) fail('operation'); keys(request, fields);
  if (request.expectedRevision !== 'absent' && !SHA.test(request.expectedRevision)) fail('expected-revision');
  let selected = board.tasks.find(t => t.id === request.id);
  if (operation === 'submit') {
    if (selected) fail('task-exists');
    const { expectedRevision, ...contract } = request;
    selected = { ...contract, repository, epoch: 0, attempts: 0, state: 'pending', actor: null,
      startedAt: null, expiresAt: null, result: null };
    board.tasks.push(selected);
  } else {
    if (!selected || selected.repository !== repository) fail('task-scope'); actor(request.actor);
    if (operation === 'claim') {
      if (!['pending', 'released'].includes(selected.state)) fail('already-claimed');
      if (selected.attempts >= 3) fail('attempt-budget');
      selected.actor = request.actor; selected.epoch = ++board.sequence; selected.attempts++; selected.startedAt = now;
      selected.expiresAt = Math.min(now + COLLAB_LIMITS.leaseMs, now + selected.maxSeconds * 1000);
      selected.state = 'active';
    } else {
      if (selected.state !== (operation === 'archive' ? 'reported' : 'active') || request.epoch !== selected.epoch
        || governanceDigest(request.actor) !== governanceDigest(selected.actor)) fail('fence');
      // Expiry never releases a writer: the old process may still be executing.
      if (!['release', 'archive'].includes(operation) && now >= selected.expiresAt) fail('expired-stop-and-release');
      if (operation === 'archive') board.tasks = board.tasks.filter(t => t.id !== selected.id);
      if (operation === 'renew') selected.expiresAt = Math.min(now + COLLAB_LIMITS.leaseMs,
        selected.startedAt + selected.maxSeconds * 1000);
      if (operation === 'release') {
        if (request.stopped !== true) fail('stop-ack-required'); selected.state = 'released';
      }
      if (operation === 'report') {
        result(request.result);
        if (request.result.tokens > selected.maxTokens) fail('token-budget-stop-and-release');
        if (request.result.outcome === 'success' && !selected.writePaths.length
          && request.result.sourceRevision !== selected.sourceRevision) fail('read-source-drift');
        selected.result = request.result; selected.state = 'reported';
      }
    }
  }
  board.updatedAt = now;
  return validateBoard(board);
}
