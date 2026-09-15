import { createHash } from "node:crypto";
import { canonicalizeJson } from "../json-contract.mjs";

const BOUNDS = Object.freeze({ writeScopeItems: 128, textCharacters: 512 });

class ProductContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProductContractError(code, message);
}

function text(value, field) {
  if (typeof value !== "string") fail("invalid_request", `${field} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) fail("invalid_request", `${field} must not be empty`);
  if (normalized.length > BOUNDS.textCharacters) {
    fail("bound_exceeded", `${field} exceeds ${BOUNDS.textCharacters} characters`);
  }
  return normalized;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

export function digestValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizePathScope(rawValue) {
  let value = rawValue.replaceAll("\\", "/").normalize("NFC").trim();
  if (!value) fail("invalid_write_scope", "path scope must not be empty");
  if (/[*?[\]{}!]/u.test(value)) fail("invalid_write_scope", "wildcards are ambiguous write scopes");
  if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
    fail("invalid_write_scope", "path scope must be repository-relative");
  }
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") fail("invalid_write_scope", "path scope must not traverse its repository");
    segments.push(segment);
  }
  value = segments.length === 0 ? "." : segments.join("/");
  return `path:${value}`;
}

function normalizeSemanticScope(rawValue) {
  const value = rawValue.normalize("NFC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(value)) {
    fail("invalid_write_scope", "semantic scope must use letters, digits, dot, colon, slash, underscore, or dash");
  }
  return `semantic:${value}`;
}

export function normalizeWriteSet(values) {
  if (!Array.isArray(values) || values.length === 0) {
    fail("invalid_write_scope", "declaredWriteScope must be a non-empty array");
  }
  if (values.length > BOUNDS.writeScopeItems) {
    fail("bound_exceeded", `declaredWriteScope exceeds ${BOUNDS.writeScopeItems} items`);
  }
  const normalized = values.map((item, index) => {
    const value = text(item, `declaredWriteScope[${index}]`);
    if (value.startsWith("semantic:")) return normalizeSemanticScope(value.slice("semantic:".length));
    if (value.startsWith("path:")) return normalizePathScope(value.slice("path:".length));
    return normalizePathScope(value);
  });
  return [...new Set(normalized)].sort();
}

function pathScopesOverlap(left, right) {
  const leftPath = left.slice("path:".length);
  const rightPath = right.slice("path:".length);
  if (leftPath === "." || rightPath === ".") return true;
  return leftPath === rightPath
    || leftPath.startsWith(`${rightPath}/`)
    || rightPath.startsWith(`${leftPath}/`);
}

export function writeSetsOverlap(leftValues, rightValues) {
  const left = normalizeWriteSet(leftValues);
  const right = normalizeWriteSet(rightValues);
  return left.some((leftScope) => right.some((rightScope) => {
    if (leftScope.startsWith("path:") && rightScope.startsWith("path:")) {
      return pathScopesOverlap(leftScope, rightScope);
    }
    return leftScope === rightScope;
  }));
}
