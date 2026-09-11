/** Portable JSON snapshots migrated from Canvas; no host, provider or I/O dependency. */
export const JSON_LIMITS = Object.freeze({ depth: 32, nodes: 50_000, chars: 1_000_000 });

export function canonicalizeJson(value, path = "value") {
  const seen = new Set();
  let nodes = 0, chars = 0;
  const measure = text => {
    chars += text.length;
    if (chars > JSON_LIMITS.chars) throw new RangeError(`${path} exceeds the JSON character budget.`);
  };
  function visit(source, depth) {
    if (++nodes > JSON_LIMITS.nodes || depth > JSON_LIMITS.depth)
      throw new RangeError(`${path} exceeds the JSON structure budget.`);
    if (typeof source === "string") { measure(source); return source; }
    if (source === null || typeof source === "boolean") return source;
    if (typeof source === "number") {
      if (!Number.isFinite(source)) throw new TypeError(`${path} must contain only finite numbers.`);
      return source;
    }
    if (typeof source !== "object") throw new TypeError(`${path} must be JSON-compatible.`);
    if (seen.has(source)) throw new TypeError(`${path} must not contain cycles.`);
    const array = Array.isArray(source);
    const prototype = Object.getPrototypeOf(source);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new TypeError(`${path} must contain only plain objects.`);
    const keys = Reflect.ownKeys(source);
    const length = array ? Object.getOwnPropertyDescriptor(source, "length").value : keys.length;
    if (length > JSON_LIMITS.nodes - nodes || keys.length > JSON_LIMITS.nodes)
      throw new RangeError(`${path} exceeds the JSON structure budget.`);
    if (array && keys.length !== length + 1) throw new TypeError(`${path} must contain dense arrays.`);
    seen.add(source);
    const result = array ? [] : {};
    const selected = array ? Array.from({ length }, (_, index) => String(index)) : keys.sort();
    for (const key of selected) {
      if (typeof key !== "string") throw new TypeError(`${path} must contain only string keys.`);
      measure(key);
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new TypeError(`${path} must contain data properties, without accessors or sparse arrays.`);
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1),
        enumerable: true, configurable: true, writable: true });
    }
    seen.delete(source);
    return result;
  }
  return visit(value, 0);
}

export function freezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

export function normalizeJson(value, path = "value") {
  return freezeJson(canonicalizeJson(value, path));
}

export function serializedJsonLength(value) {
  return JSON.stringify(value).length;
}
