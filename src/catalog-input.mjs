/** Bounded, descriptor-safe snapshots for embedding-supplied catalogs and files. */

import {
  closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync,
} from 'node:fs';
import { types } from 'node:util';

export const MAX_CANDIDATES = 200;
export const MAX_ARGUMENTS = 1_000;
export const MAX_REFS_PER_FIELD = 64;
export const MAX_CATALOG_DEPTH = 12;
export const MAX_CATALOG_NODES = 250_000;
export const MAX_CATALOG_STRING_BYTES = 400_000;
export const MAX_STRING_BYTES = 16_384;

function finding(code, detail) {
  return { code, path: '$', ...(detail === undefined ? {} : { detail }) };
}

export class JsonSnapshotError extends TypeError {
  constructor(code, detail) {
    super(code);
    this.name = 'JsonSnapshotError';
    this.code = code;
    this.detail = detail;
  }
}

function reject(code, detail) { throw new JsonSnapshotError(code, detail); }

/** Descriptor-only JSON snapshot with caller-selected aggregate resource limits. */
export function snapshotBoundedJson(input, {
  maxDepth, maxNodes, maxStringBytes, maxAggregateStringBytes,
  maxArrayLength, maxObjectKeys, finiteNumbers = true, sortKeys = false,
  arrayBudgetCode = 'array-budget', budget = { nodes: 0, stringBytes: 0 },
}) {
  const seen = new WeakSet();
  let root;
  const reserve = (count) => {
    if (count > maxNodes - budget.nodes)
      reject('node-budget', `${budget.nodes + count}>${maxNodes}`);
    budget.nodes += count;
  };
  const measure = (value) => {
    if (value.length > maxStringBytes)
      reject('string-budget', `${value.length}>${maxStringBytes}`);
    const remaining = maxAggregateStringBytes - budget.stringBytes;
    if (value.length > remaining)
      reject('aggregate-string-budget', `${budget.stringBytes + value.length}>${maxAggregateStringBytes}`);
    const measured = Buffer.byteLength(value, 'utf8');
    if (measured > maxStringBytes)
      reject('string-budget', `${measured}>${maxStringBytes}`);
    if (measured > remaining)
      reject('aggregate-string-budget', `${budget.stringBytes + measured}>${maxAggregateStringBytes}`);
    budget.stringBytes += measured;
  };
  const stack = [{ source: input, depth: 0, assign: (value) => { root = value; } }];
  reserve(1);
  while (stack.length > 0) {
    const { source, depth, assign } = stack.pop();
    if (depth > maxDepth) reject('depth-budget', `${depth}>${maxDepth}`);
    if (typeof source === 'string') {
      measure(source);
      assign(source);
      continue;
    }
    if (source === null || typeof source === 'boolean' || typeof source === 'number') {
      if (finiteNumbers && typeof source === 'number' && !Number.isFinite(source))
        reject('number-invalid');
      assign(source);
      continue;
    }
    if (typeof source !== 'object') reject('json-value-invalid', typeof source);
    if (types.isProxy(source)) reject('proxy-object-invalid');
    if (seen.has(source)) reject('json-alias-invalid');
    seen.add(source);

    if (Array.isArray(source)) {
      const length = Object.getOwnPropertyDescriptor(source, 'length')?.value;
      if (!Number.isSafeInteger(length) || length < 0) reject('array-property-invalid');
      if (length > maxArrayLength) reject(arrayBudgetCode, `${length}>${maxArrayLength}`);
      reserve(length);
      const keys = Reflect.ownKeys(source);
      if (keys.length !== length + 1) reject('array-property-invalid');
      const target = new Array(length);
      assign(target);
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (!descriptor) reject('sparse-array-invalid');
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
          reject('array-accessor-invalid');
        stack.push({ source: descriptor.value, depth: depth + 1,
          assign: (value) => Object.defineProperty(target, index, {
            value, enumerable: true, writable: true, configurable: true,
          }) });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(source);
    if (prototype !== Object.prototype && prototype !== null)
      reject('object-prototype-invalid');
    const keys = Reflect.ownKeys(source);
    if (keys.length > maxObjectKeys)
      reject('object-budget', `${keys.length}>${maxObjectKeys}`);
    reserve(keys.length);
    if (keys.some((key) => typeof key !== 'string')) reject('symbol-property-invalid');
    keys.forEach(measure);
    if (sortKeys) keys.sort();
    const target = Object.create(null);
    assign(target);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor?.enumerable) reject('nonenumerable-property-invalid', key);
      if (!Object.hasOwn(descriptor, 'value')) reject('object-accessor-invalid', key);
      stack.push({ source: descriptor.value, depth: depth + 1,
        assign: (value) => { target[key] = value; } });
    }
  }
  return root;
}

export function snapshotCatalogInput(input) {
  try {
    const value = snapshotBoundedJson(input, {
      maxDepth: MAX_CATALOG_DEPTH,
      maxNodes: MAX_CATALOG_NODES,
      maxStringBytes: MAX_STRING_BYTES,
      maxAggregateStringBytes: MAX_CATALOG_STRING_BYTES,
      maxArrayLength: MAX_ARGUMENTS,
      maxObjectKeys: MAX_REFS_PER_FIELD,
      finiteNumbers: false,
    });
    return { ok: true, value, findings: [] };
  } catch (error) {
    if (!(error instanceof JsonSnapshotError)) {
      return { ok: false, value: null,
        findings: [finding('catalog-inspection-failed', error.code ?? error.name)] };
    }
    const code = ({
      'node-budget': 'catalog-node-budget-exceeded',
      'depth-budget': 'catalog-depth-budget-exceeded',
      'string-budget': 'string-budget-exceeded',
      'aggregate-string-budget': 'catalog-string-budget-exceeded',
      'array-budget': 'catalog-collection-budget-exceeded',
      'json-value-invalid': 'catalog-value-invalid',
      'json-alias-invalid': 'catalog-alias-invalid',
      'array-accessor-invalid': 'accessor-property-invalid',
      'object-accessor-invalid': 'accessor-property-invalid',
    })[error.code] ?? error.code;
    return { ok: false, value: null, findings: [finding(code, error.detail)] };
  }
}

/** Race-bounded regular-file read shared by catalog and evidence ingestion. */
export function readBoundedFile(path, maxBytes, label = 'file', {
  expectedIdentity,
  expectedPath,
} = {}) {
  const flags = constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(path, flags);
  try {
    const metadata = fstatSync(descriptor, { bigint: true });
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`);
    if (expectedIdentity
      && (metadata.dev !== BigInt(expectedIdentity.dev)
        || metadata.ino !== BigInt(expectedIdentity.ino))) {
      throw new Error(`${label} identity changed`);
    }
    if (expectedPath) {
      const confirmedPath = realpathSync(path);
      const confirmed = statSync(confirmedPath);
      if (confirmedPath !== expectedPath
        || confirmed.dev !== Number(metadata.dev) || confirmed.ino !== Number(metadata.ino)) {
        throw new Error(`${label} identity changed`);
      }
    }
    const expectedSize = Number(metadata.size);
    if (!Number.isSafeInteger(expectedSize) || expectedSize > maxBytes)
      throw new Error(`${label} byte budget exceeded`);
    const buffer = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error(`${label} byte budget exceeded`);
    const after = fstatSync(descriptor, { bigint: true });
    if (after.dev !== metadata.dev || after.ino !== metadata.ino || after.size !== BigInt(offset)
      || after.size !== metadata.size || after.mode !== metadata.mode || after.nlink !== metadata.nlink
      || after.mtimeNs !== metadata.mtimeNs || after.ctimeNs !== metadata.ctimeNs)
      throw new Error(`${label} changed during inspection`);
    const exact = Buffer.allocUnsafeSlow(offset);
    buffer.copy(exact, 0, 0, offset);
    return exact;
  } finally {
    closeSync(descriptor);
  }
}
