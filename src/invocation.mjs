/** Shared invocation grammar and digest serialization; no runtime or authority dependencies. */

export const PREFIX_KINDS = Object.freeze({ '/': 'command', '#': 'semantic', '@': 'binding' });
const MAX_NAME = 128;
const MAX_ARGUMENT = 1024;
const KIND_ORDER = Object.freeze(['command', 'semantic', 'binding']);

/** Parse one exact token. Empty binding arguments are declarations; callers enforce invocation policy. */
export function parseInvocationToken(token) {
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
  if (!/^[a-z0-9.-]+$/u.test(name)) return { error: 'invalid-remainder-character' };
  if (argument !== null && argument.length > MAX_ARGUMENT) return { error: 'argument-too-long' };
  return { prefix, kind: PREFIX_KINDS[prefix], canonical: `${prefix}${name}${colon < 0 ? '' : ':'}`, argument };
}

/** Preserve the dictionary validation error vocabulary. */
export function malformedInvocationRuleFor(token) {
  const { error } = parseInvocationToken(token);
  return error === 'argument-prefix' ? 'invalid-remainder-character' : error ?? '';
}

/** Project a binding invocation to its declaration without interpreting its opaque argument. */
export function canonicalInvocationToken(token) {
  if (token.slice(0, 1) !== '@') return token;
  const colon = token.indexOf(':');
  return colon < 0 ? token : token.slice(0, colon + 1);
}

/** Classify a discovery prefix, including incomplete tokens; this does not validate invocation syntax. */
export function kindForInvocationToken(token) {
  const value = String(token || '').trim();
  return PREFIX_KINDS[value[0]] ?? '';
}

/** Dictionary digest bytes: kind order, ordinal tokens, unchanged fields, no trailing newline. */
export function canonicalCatalogInput(entries) {
  const sorted = [...entries].sort((left, right) => {
    const byKind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
    return byKind !== 0 ? byKind : (left.token < right.token ? -1 : left.token > right.token ? 1 : 0);
  });
  return JSON.stringify(sorted.map(({ token, kind, label, summary, sourcePath }) => ({
    token,
    kind,
    label,
    summary,
    sourcePath,
  })));
}

const normalizeDigestText = (value) => String(value || '').trim();

/** Discovery digest bytes retain their existing normalization, locale ordering, and final newline. */
export function serializeInvocationCatalogForDigest(catalog = []) {
  return `${JSON.stringify([...catalog]
    .map((entry) => ({
      token: normalizeDigestText(entry?.token),
      kind: normalizeDigestText(entry?.kind).toLowerCase(),
      label: normalizeDigestText(entry?.label),
      summary: normalizeDigestText(entry?.summary),
      sourcePath: normalizeDigestText(entry?.sourcePath),
    }))
    .sort((left, right) => left.token.localeCompare(right.token)))}\n`;
}

const normalizeRoutingTokens = (values, sigil = '') => [
  ...new Set((Array.isArray(values) ? values : [])
    .map(normalizeDigestText)
    .filter((value) => value && (!sigil || value.startsWith(sigil)))),
];

/** The caller owns the routing schema and authority; this function only serializes its digest input. */
export function serializeInvocationRoutingForDigest(catalog = [], schema) {
  if (typeof schema !== 'string' || !schema.trim()) {
    throw new TypeError('invocation routing schema must be a nonempty string');
  }
  return `${JSON.stringify({
    schema,
    routes: [...catalog]
      .map((entry) => ({
        token: normalizeDigestText(entry?.token),
        kind: normalizeDigestText(entry?.kind).toLowerCase(),
        sourcePath: normalizeDigestText(entry?.sourcePath),
        mcpTools: normalizeRoutingTokens(
          Array.isArray(entry?.mcpTools)
            ? entry.mcpTools
            : normalizeDigestText(entry?.mcpTool) ? [entry.mcpTool] : [],
        ),
        semantics: normalizeRoutingTokens(entry?.semantics, '#'),
        bindings: normalizeRoutingTokens(entry?.bindings, '@'),
      }))
      .sort((left, right) => left.token.localeCompare(right.token)),
  })}\n`;
}
