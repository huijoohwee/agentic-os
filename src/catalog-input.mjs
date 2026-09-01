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

export function snapshotCatalogInput(input) {
  const findings = [];
  const seen = new WeakSet();
  let root;
  let nodes = 0;
  let stringBytes = 0;
  const stack = [{ source: input, depth: 0, assign: (value) => { root = value; } }];

  try {
    while (stack.length > 0) {
      const { source, depth, assign } = stack.pop();
      nodes += 1;
      if (nodes > MAX_CATALOG_NODES) {
        findings.push(finding('catalog-node-budget-exceeded', `${nodes}>${MAX_CATALOG_NODES}`));
        break;
      }
      if (depth > MAX_CATALOG_DEPTH) {
        findings.push(finding('catalog-depth-budget-exceeded', `${depth}>${MAX_CATALOG_DEPTH}`));
        break;
      }
      if (typeof source === 'string') {
        if (source.length > MAX_STRING_BYTES) {
          findings.push(finding('string-budget-exceeded', `${source.length}>${MAX_STRING_BYTES}`));
          break;
        }
        const measuredBytes = Buffer.byteLength(source, 'utf8');
        if (measuredBytes > MAX_STRING_BYTES) {
          findings.push(finding('string-budget-exceeded', `${measuredBytes}>${MAX_STRING_BYTES}`));
          break;
        }
        stringBytes += measuredBytes;
        if (stringBytes > MAX_CATALOG_STRING_BYTES) {
          findings.push(finding(
            'catalog-string-budget-exceeded',
            `${stringBytes}>${MAX_CATALOG_STRING_BYTES}`,
          ));
          break;
        }
        assign(source);
        continue;
      }
      if (source === null || typeof source === 'boolean' || typeof source === 'number') {
        assign(source);
        continue;
      }
      if (typeof source !== 'object') {
        findings.push(finding('catalog-value-invalid', typeof source));
        break;
      }
      if (types.isProxy(source)) {
        findings.push(finding('proxy-object-invalid'));
        break;
      }
      if (seen.has(source)) {
        findings.push(finding('catalog-alias-invalid'));
        break;
      }
      seen.add(source);

      if (Array.isArray(source)) {
        if (source.length > MAX_ARGUMENTS) {
          findings.push(finding(
            'catalog-collection-budget-exceeded',
            `${source.length}>${MAX_ARGUMENTS}`,
          ));
          break;
        }
        const keys = Reflect.ownKeys(source);
        const expectedKeys = new Set(['length']);
        for (let index = 0; index < source.length; index += 1) expectedKeys.add(String(index));
        if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
          findings.push(finding('array-property-invalid'));
          break;
        }
        const target = new Array(source.length);
        assign(target);
        for (let index = source.length - 1; index >= 0; index -= 1) {
          const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            findings.push(finding(descriptor ? 'accessor-property-invalid' : 'sparse-array-invalid'));
            break;
          }
          stack.push({
            source: descriptor.value,
            depth: depth + 1,
            assign: (value) => { target[index] = value; },
          });
        }
        if (findings.length > 0) break;
        continue;
      }

      const prototype = Object.getPrototypeOf(source);
      if (prototype !== Object.prototype && prototype !== null) {
        findings.push(finding('object-prototype-invalid'));
        break;
      }
      const keys = Reflect.ownKeys(source);
      if (keys.length > MAX_REFS_PER_FIELD) {
        findings.push(finding('catalog-object-budget-exceeded',
          `${keys.length}>${MAX_REFS_PER_FIELD}`));
        break;
      }
      if (keys.some((key) => typeof key !== 'string')) {
        findings.push(finding('symbol-property-invalid'));
        break;
      }
      let keyBudgetFailed = false;
      for (const key of keys) {
        if (key.length > MAX_STRING_BYTES) {
          findings.push(finding('string-budget-exceeded'));
          keyBudgetFailed = true;
          break;
        }
        const measuredBytes = Buffer.byteLength(key, 'utf8');
        if (measuredBytes > MAX_STRING_BYTES) {
          findings.push(finding('string-budget-exceeded'));
          keyBudgetFailed = true;
          break;
        }
        stringBytes += measuredBytes;
        if (stringBytes > MAX_CATALOG_STRING_BYTES) {
          findings.push(finding('catalog-string-budget-exceeded'));
          keyBudgetFailed = true;
          break;
        }
      }
      if (keyBudgetFailed) break;
      const target = Object.create(null);
      assign(target);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor?.enumerable) {
          findings.push(finding('nonenumerable-property-invalid', key));
          break;
        }
        if (!Object.hasOwn(descriptor, 'value')) {
          findings.push(finding('accessor-property-invalid', key));
          break;
        }
        stack.push({
          source: descriptor.value,
          depth: depth + 1,
          assign: (value) => { target[key] = value; },
        });
      }
      if (findings.length > 0) break;
    }
  } catch (error) {
    findings.push(finding('catalog-inspection-failed', error.code ?? error.name));
  }

  return { ok: findings.length === 0, value: findings.length === 0 ? root : null, findings };
}

/** Race-bounded regular-file read shared by catalog and evidence ingestion. */
export function readBoundedFile(path, maxBytes, label = 'file', {
  expectedIdentity,
  expectedPath,
} = {}) {
  const flags = constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(path, flags);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`);
    if (expectedIdentity
      && (metadata.dev !== expectedIdentity.dev || metadata.ino !== expectedIdentity.ino)) {
      throw new Error(`${label} identity changed`);
    }
    if (expectedPath) {
      const confirmedPath = realpathSync(path);
      const confirmed = statSync(confirmedPath);
      if (confirmedPath !== expectedPath
        || confirmed.dev !== metadata.dev || confirmed.ino !== metadata.ino) {
        throw new Error(`${label} identity changed`);
      }
    }
    if (metadata.size > maxBytes) throw new Error(`${label} byte budget exceeded`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error(`${label} byte budget exceeded`);
    const exact = Buffer.allocUnsafeSlow(offset);
    buffer.copy(exact, 0, 0, offset);
    return exact;
  } finally {
    closeSync(descriptor);
  }
}
