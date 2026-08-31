/** Exact `/`, `#`, and `@` invocation grammar backed by a digest-fenced JSON catalog. */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');
export const CATALOG_PATH = join(ROOT, 'catalog', 'invocation.json');
export const CATALOG_SCHEMA = 'agentic-os-invocation-catalog/v1';
export const RESOLUTION_SCHEMA = 'agentic-os-invocation-resolution/v1';
export const PREFIX_KINDS = Object.freeze({ '/': 'command', '#': 'semantic', '@': 'binding' });
const MAX_NAME = 128;
const MAX_ARGUMENT = 1024;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const ENTRY_CONTRACTS = deepFreeze({
  '/setup': { kind: 'command', action: 'setup', argv: [], semantic: 'mutating', accepts: [], requires: [] },
  '/doctor': { kind: 'command', action: 'doctor', argv: [], semantic: 'read-only', accepts: [], requires: [] },
  '/lane': { kind: 'command', action: 'start', argv: [], semantic: 'mutating', accepts: ['scope'], requires: ['scope'] },
  '/land': { kind: 'command', action: 'land', argv: [], semantic: 'mutating', accepts: [], requires: [] },
  '/status': { kind: 'command', action: 'status', argv: [], semantic: 'read-only', accepts: ['device'], requires: [] },
  '/reap': { kind: 'command', action: 'reap', argv: [], semantic: 'mutating', accepts: [], requires: [] },
  '/queue.show': { kind: 'command', action: 'queue', argv: ['show'], semantic: 'read-only', accepts: [], requires: [] },
  '/help': { kind: 'command', action: 'help', argv: [], semantic: 'read-only', accepts: [], requires: [] },
  '#read-only': { kind: 'semantic', value: 'read-only' },
  '#mutating': { kind: 'semantic', value: 'mutating' },
  '@scope:': { kind: 'binding', name: 'scope', mode: 'positional' },
  '@device:': { kind: 'binding', name: 'device', mode: 'option' },
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function catalogDigest(entries) {
  const ordered = [...entries].sort((left, right) => String(left?.token ?? '').localeCompare(String(right?.token ?? '')));
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(ordered))).digest('hex')}`;
}

export function loadCatalog(path = CATALOG_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseToken(token, declaration = false) {
  if (typeof token !== 'string' || !PREFIX_KINDS[token[0]]) return { error: 'invalid-prefix' };
  const prefix = token[0];
  const remainder = token.slice(1);
  if (!remainder) return { error: 'empty-remainder' };
  const colon = remainder.indexOf(':');
  if (colon >= 0 && prefix !== '@') return { error: 'argument-prefix' };
  const name = colon < 0 ? remainder : remainder.slice(0, colon);
  const argument = colon < 0 ? null : remainder.slice(colon + 1);
  if (!name) return { error: 'empty-remainder' };
  if (name.length > MAX_NAME) return { error: 'remainder-too-long' };
  if (!/^[a-z0-9.-]+$/.test(name)) return { error: 'invalid-remainder-character' };
  if (!declaration && argument === '') return { error: 'argument-empty' };
  if (argument !== null && argument.length > MAX_ARGUMENT) return { error: 'argument-too-long' };
  if (declaration && argument !== null && argument !== '') return { error: 'catalog-argument' };
  return { prefix, kind: PREFIX_KINDS[prefix], canonical: `${prefix}${name}${colon < 0 ? '' : ':'}`, argument };
}

export function validateCatalog(catalog) {
  const findings = [];
  if (catalog?.schema !== CATALOG_SCHEMA) findings.push({ code: 'schema-drift' });
  if (!Array.isArray(catalog?.entries)) return { ok: false, findings: [...findings, { code: 'entries-missing' }] };
  if (catalog.entryCount !== catalog.entries.length) {
    findings.push({ code: 'count-drift', expected: catalog.entries.length, actual: catalog.entryCount });
  }
  const expectedDigest = catalogDigest(catalog.entries);
  if (catalog.digest !== expectedDigest) findings.push({ code: 'digest-drift', expected: expectedDigest });

  const seen = new Map();
  for (const entry of catalog.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      findings.push({ code: 'malformed-entry', token: null, reason: 'entry-object-required' });
      continue;
    }
    const parsed = parseToken(entry?.token, true);
    if (parsed.error) findings.push({ code: 'malformed-entry', token: entry?.token, reason: parsed.error });
    else if (entry?.kind !== parsed.kind) findings.push({ code: 'kind-drift', token: entry.token });
    if (typeof entry?.summary !== 'string' || entry.summary.length === 0) {
      findings.push({ code: 'summary-missing', token: entry?.token });
    }
    if (entry?.kind === 'command') {
      if (!/^[a-z][a-z-]*$/.test(entry.action ?? '')) findings.push({ code: 'action-invalid', token: entry.token });
      if (!['read-only', 'mutating'].includes(entry.semantic)) {
        findings.push({ code: 'semantic-invalid', token: entry.token });
      }
      for (const field of ['accepts', 'requires', 'argv']) {
        if (entry[field] !== undefined && !Array.isArray(entry[field])) {
          findings.push({ code: `${field}-invalid`, token: entry.token });
        } else if (entry[field]?.some((value) => typeof value !== 'string' || value.length === 0)) {
          findings.push({ code: `${field}-element-invalid`, token: entry.token });
        } else if (new Set(entry[field] ?? []).size !== (entry[field] ?? []).length) {
          findings.push({ code: `${field}-duplicate`, token: entry.token });
        }
      }
      if (Array.isArray(entry.requires)
        && Array.isArray(entry.accepts)
        && entry.requires.some((name) => !entry.accepts.includes(name))) {
        findings.push({ code: 'requirement-not-accepted', token: entry.token });
      }
    }
    if (entry?.kind === 'semantic' && !['read-only', 'mutating'].includes(entry.value)) {
      findings.push({ code: 'semantic-value-invalid', token: entry.token });
    }
    if (entry?.kind === 'binding') {
      if (entry.token !== `@${entry.name}:`) findings.push({ code: 'binding-name-drift', token: entry.token });
      if (!['positional', 'option'].includes(entry.mode)) findings.push({ code: 'binding-mode-invalid', token: entry.token });
    }
    const matches = [...(seen.get(entry?.token) ?? []), entry];
    seen.set(entry?.token, matches);

    const expected = ENTRY_CONTRACTS[entry.token];
    if (!expected) findings.push({ code: 'unsupported-entry', token: entry.token });
    else {
      const actual = entry.kind === 'command'
        ? {
            kind: entry.kind,
            action: entry.action,
            argv: entry.argv ?? [],
            semantic: entry.semantic,
            accepts: entry.accepts ?? [],
            requires: entry.requires ?? [],
          }
        : entry.kind === 'semantic'
          ? { kind: entry.kind, value: entry.value }
          : { kind: entry.kind, name: entry.name, mode: entry.mode };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        findings.push({ code: 'dispatch-contract-drift', token: entry.token });
      }
    }
  }
  for (const [token, matches] of seen) {
    if (matches.length > 1) findings.push({ code: 'ambiguous-entry', token, count: matches.length });
  }
  for (const token of Object.keys(ENTRY_CONTRACTS)) {
    if (!seen.has(token)) findings.push({ code: 'entry-missing', token });
  }
  return { ok: findings.length === 0, findings };
}

function normalize(input) {
  if (Array.isArray(input)) return input.map((token) => String(token));
  if (typeof input !== 'string') return [String(input ?? '')];
  return input.trim() ? input.trim().split(/\s+/) : [];
}

const zeroCost = (token) => ({
  token,
  modelIdentity: null,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

function rejected(tokens, code, detail = {}) {
  return {
    schema: RESOLUTION_SCHEMA,
    ok: false,
    status: 'rejected',
    code,
    tokens,
    detail,
    costRecords: tokens.map(zeroCost),
  };
}

export function resolveInvocation(input, { catalog = loadCatalog() } = {}) {
  const tokens = normalize(input);
  const validation = validateCatalog(catalog);
  const ambiguous = validation.findings.find((finding) => finding.code === 'ambiguous-entry');
  if (ambiguous) return rejected(tokens, 'ambiguous-entry', ambiguous);
  if (!validation.ok) return rejected(tokens, 'catalog-invalid', { findings: validation.findings });
  if (tokens.length === 0 || tokens.length > 3) return rejected(tokens, 'token-count');

  const parsed = tokens.map((token) => ({ token, ...parseToken(token) }));
  const malformed = parsed.find((token) => token.error);
  if (malformed) return rejected(tokens, 'malformed-token', malformed);
  const duplicated = Object.keys(PREFIX_KINDS).find(
    (prefix) => parsed.filter((token) => token.prefix === prefix).length > 1,
  );
  if (duplicated) return rejected(tokens, 'duplicate-prefix', { prefix: duplicated });

  const resolved = parsed.map((token) => ({
    ...token,
    matches: catalog.entries.filter((entry) => entry.token === token.canonical),
  }));
  const missing = resolved.find((entry) => entry.matches.length === 0);
  if (missing) {
    return { ...rejected(tokens, 'unresolved', { token: missing.token }), status: 'unresolved' };
  }
  const multiple = resolved.find((entry) => entry.matches.length > 1);
  if (multiple) return rejected(tokens, 'ambiguous-entry', { token: multiple.token });

  const entries = resolved.map(({ matches, ...token }) => ({ ...token, entry: matches[0] }));
  const command = entries.find((entry) => entry.kind === 'command')?.entry;
  if (!command) return rejected(tokens, 'command-missing');
  const semantic = entries.find((entry) => entry.kind === 'semantic')?.entry;
  if (semantic && semantic.value !== command.semantic) {
    return rejected(tokens, 'semantic-mismatch', { expected: command.semantic, actual: semantic.value });
  }
  const binding = entries.find((entry) => entry.kind === 'binding');
  if (binding && !(command.accepts ?? []).includes(binding.entry.name)) {
    return rejected(tokens, 'binding-not-accepted', { binding: binding.entry.name });
  }
  const supplied = binding ? [binding.entry.name] : [];
  const required = (command.requires ?? []).find((name) => !supplied.includes(name));
  if (required) return rejected(tokens, 'binding-required', { binding: required });

  return {
    schema: RESOLUTION_SCHEMA,
    ok: true,
    status: 'resolved',
    tokens,
    entries,
    costRecords: tokens.map(zeroCost),
  };
}

export function isInvocationTuple(input) {
  const tokens = normalize(input);
  return tokens.length > 0 && tokens.every((token) => PREFIX_KINDS[token[0]]);
}

export function dispatchInvocation(resolution) {
  if (!resolution?.ok) return { ok: false, code: resolution?.code ?? 'unresolved' };
  if (resolution.schema !== RESOLUTION_SCHEMA || !Array.isArray(resolution.tokens)) {
    return { ok: false, code: 'resolution-invalid' };
  }
  const current = resolveInvocation(resolution.tokens);
  if (!current.ok) return { ok: false, code: current.code };
  try {
    if (JSON.stringify(canonical(resolution.entries)) !== JSON.stringify(canonical(current.entries))) {
      return { ok: false, code: 'resolution-invalid' };
    }
  } catch {
    return { ok: false, code: 'resolution-invalid' };
  }
  const selected = current.entries.find((entry) => entry.kind === 'command');
  const command = ENTRY_CONTRACTS[selected?.canonical];
  if (command?.kind !== 'command') return { ok: false, code: 'dispatch-contract-missing' };
  const binding = current.entries.find((entry) => entry.kind === 'binding');
  const bindingContract = binding ? ENTRY_CONTRACTS[binding.canonical] : null;
  if (binding && bindingContract?.kind !== 'binding') return { ok: false, code: 'dispatch-contract-missing' };
  const argv = [...command.argv];
  if (bindingContract?.mode === 'positional') argv.push(binding.argument);
  if (bindingContract?.mode === 'option') argv.push(`--${bindingContract.name}=${binding.argument}`);
  return { ok: true, command: command.action, argv, semantic: command.semantic };
}
