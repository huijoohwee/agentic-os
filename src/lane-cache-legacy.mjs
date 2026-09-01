/** Strict in-memory projection for the only retired v1 lane-cache field. */
import { isLaneRef } from './lane-id.mjs';

const ROOT_KEYS = new Set(['schema', 'lanes']);
const INVALID = Symbol('invalid legacy cache property');
const RECORD_KEYS = new Set([
  'ref', 'device', 'scope', 'state', 'base', 'baseSha', 'worktree', 'pr', 'createdAt',
  'head', 'handoff', 'mode', 'ejections',
]);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function enumerableValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : INVALID;
}

/**
 * Project the former non-authoritative `ejections` count only when the complete
 * legacy shape is otherwise an exact current-cache candidate. The caller still
 * validates the result with the current schema and never writes legacy bytes.
 */
export function projectLegacyLaneCache(value, schema) {
  if (!plainObject(value)) return null;
  const rootKeys = Reflect.ownKeys(value);
  if (rootKeys.length !== ROOT_KEYS.size || rootKeys.some((key) => !ROOT_KEYS.has(key))
    || enumerableValue(value, 'schema') !== schema) return null;
  const lanes = enumerableValue(value, 'lanes');
  if (!plainObject(lanes)) return null;
  const projected = { schema, lanes: Object.create(null) };
  let legacy = false;
  for (const ref of Reflect.ownKeys(lanes)) {
    if (typeof ref !== 'string' || !isLaneRef(ref)) return null;
    const record = enumerableValue(lanes, ref);
    if (!plainObject(record)) return null;
    const keys = Reflect.ownKeys(record);
    if (keys.some((key) => typeof key !== 'string' || !RECORD_KEYS.has(key))) return null;
    const ejections = enumerableValue(record, 'ejections');
    if (Object.hasOwn(record, 'ejections')) {
      if (!Number.isSafeInteger(ejections) || ejections < 0) return null;
      legacy = true;
    }
    const output = Object.create(null);
    for (const key of keys) {
      if (key === 'ejections') continue;
      const field = enumerableValue(record, key);
      if (field === INVALID) return null;
      output[key] = field;
    }
    projected.lanes[ref] = output;
  }
  return legacy ? projected : null;
}
