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

/** Lazy dictionary metadata. Reading, hashing, caching and execution remain caller-owned. */
export const DICTIONARY_LIMITS = Object.freeze({ bytesPerFile: 96 * 1024, linesPerFile: 800, entries: 512 });

function dictionaryWithinBudget(text) {
  if (text.length > DICTIONARY_LIMITS.bytesPerFile) return false;
  let bytes = 0;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) lines += 1;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
    if (bytes > DICTIONARY_LIMITS.bytesPerFile || lines > DICTIONARY_LIMITS.linesPerFile) return false;
  }
  return true;
}

export const CATALOG_DIGEST_INPUT =
  "sha256:canonical-json:sorted(kind,token):token,kind,label,summary,sourcePath";
export const CATALOG_DIGEST_OWNER = "DICTIONARY-COMMAND.md";

export const DICTIONARY_DESCRIPTORS = Object.freeze([
  Object.freeze({
    kind: "command",
    prefix: "/",
    docsPath: "DICTIONARY-COMMAND.md",
    tableHeading: "Commands",
    sourcePath: "agentic-os/catalog/dictionaries/DICTIONARY-COMMAND.md",
  }),
  Object.freeze({
    kind: "semantic",
    prefix: "#",
    docsPath: "DICTIONARY-SEMANTIC.md",
    tableHeading: "Tags",
    sourcePath: "agentic-os/catalog/dictionaries/DICTIONARY-SEMANTIC.md",
  }),
  Object.freeze({
    kind: "binding",
    prefix: "@",
    docsPath: "DICTIONARY-BINDING.md",
    tableHeading: "Bindings",
    sourcePath: "agentic-os/catalog/dictionaries/DICTIONARY-BINDING.md",
  }),
]);

export function labelFromToken(token) {
  return token.slice(1);
}

export function collectCatalogEntries(documents) {
  const failures = [];
  const entries = [];

  for (const descriptor of DICTIONARY_DESCRIPTORS) {
    const text = documents.get(descriptor.docsPath);
    if (typeof text !== "string") {
      failures.push(`${descriptor.docsPath}: dictionary is absent from the docs artifact set`);
      continue;
    }
    const frontmatter = readFrontmatterLines(descriptor.docsPath, text, failures);
    if (!frontmatter) continue;

    const declaredPrefix = singleScalar(frontmatter, "prefix");
    if (declaredPrefix !== descriptor.prefix) {
      failures.push(
        `${descriptor.docsPath}: prefix must be exactly ${JSON.stringify(descriptor.prefix)}`,
      );
    }
    if (!singleScalar(frontmatter, "prefix_role")) {
      failures.push(`${descriptor.docsPath}: prefix_role must be declared exactly once`);
    }

    const listed = listedTokens(descriptor.docsPath, frontmatter, failures);
    const rows = tableEntries(descriptor, text, failures);
    entries.push(...reconcile(descriptor, listed, rows, failures));
  }

  if (entries.length > DICTIONARY_LIMITS.entries) failures.push("dictionary catalog exceeds entry budget");
  return { entries, failures };
}

export function validateDictionaryCatalogContract(documents, digestForInput) {
  const { entries, failures } = collectCatalogEntries(documents);
  if (failures.length > 0) return failures;

  const ownerText = documents.get(CATALOG_DIGEST_OWNER);
  const ownerFrontmatter = readFrontmatterLines(CATALOG_DIGEST_OWNER, ownerText, failures);
  if (!ownerFrontmatter) return failures;

  for (const descriptor of DICTIONARY_DESCRIPTORS) {
    if (descriptor.docsPath === CATALOG_DIGEST_OWNER) continue;
    const frontmatter = readFrontmatterLines(descriptor.docsPath, documents.get(descriptor.docsPath), failures);
    if (!frontmatter) continue;
    for (const key of ["catalog_digest", "catalog_entry_count", "catalog_digest_input"]) {
      if (singleScalar(frontmatter, key) !== null) {
        failures.push(
          `${descriptor.docsPath}: ${key} must be declared only in ${CATALOG_DIGEST_OWNER}`,
        );
      }
    }
  }

  const declaredInput = singleScalar(ownerFrontmatter, "catalog_digest_input");
  if (declaredInput !== CATALOG_DIGEST_INPUT) {
    failures.push(
      `${CATALOG_DIGEST_OWNER}: catalog_digest_input must be `
      + `${JSON.stringify(CATALOG_DIGEST_INPUT)}; found ${JSON.stringify(declaredInput)}`,
    );
  }

  const declaredCount = singleScalar(ownerFrontmatter, "catalog_entry_count");
  if (String(entries.length) !== declaredCount) {
    failures.push(
      `${CATALOG_DIGEST_OWNER}: catalog_entry_count declares ${declaredCount} `
      + `but the three dictionaries hold ${entries.length} entries`,
    );
  }

  const declaredDigest = singleScalar(ownerFrontmatter, "catalog_digest");
  if (typeof digestForInput !== "function") throw new TypeError("digestForInput must compute SHA-256 of canonical UTF-8 input");
  const computedDigest = digestForInput(canonicalCatalogInput(entries));
  if (typeof computedDigest !== "string" || !/^[a-f0-9]{64}$/.test(computedDigest)) {
    throw new TypeError("digestForInput must return a lowercase SHA-256 hex digest synchronously");
  }
  if (declaredDigest !== computedDigest) {
    failures.push(
      `${CATALOG_DIGEST_OWNER}: catalog_digest declares ${declaredDigest} `
      + `but the recomputed ${CATALOG_DIGEST_INPUT} digest is ${computedDigest}`,
    );
  }

  return failures;
}

function reconcile(descriptor, listed, rows, failures) {
  const rowsByToken = new Map();
  for (const row of rows) {
    if (rowsByToken.has(row.token)) {
      failures.push(`${descriptor.docsPath}: token ${row.token} has more than one table row`);
      continue;
    }
    rowsByToken.set(row.token, row);
  }

  const seen = new Set();
  const entries = [];
  for (const token of listed) {
    if (seen.has(token)) {
      failures.push(`${descriptor.docsPath}: token ${token} is listed more than once`);
      continue;
    }
    seen.add(token);

    if (!token.startsWith(descriptor.prefix)) {
      failures.push(
        `${descriptor.docsPath}: token ${token} does not carry the ${descriptor.prefix} prefix`,
      );
      continue;
    }
    const violatedRule = malformedInvocationRuleFor(token);
    if (violatedRule) {
      failures.push(
        `${descriptor.docsPath}: token ${token} cannot resolve through the shared `
        + `invocation grammar (${violatedRule})`,
      );
      continue;
    }
    const row = rowsByToken.get(token);
    if (!row) {
      failures.push(`${descriptor.docsPath}: token ${token} is listed but has no table row`);
      continue;
    }
    if (!row.summary) {
      failures.push(`${descriptor.docsPath}: token ${token} has an empty summary cell`);
      continue;
    }
    entries.push(Object.freeze({
      token,
      kind: descriptor.kind,
      label: labelFromToken(token),
      summary: row.summary,
      sourcePath: descriptor.sourcePath,
    }));
  }

  for (const token of rowsByToken.keys()) {
    if (!seen.has(token)) {
      failures.push(`${descriptor.docsPath}: token ${token} has a table row but is not listed`);
    }
  }
  return entries;
}

function listedTokens(docsPath, frontmatter, failures) {
  const starts = frontmatter
    .map((line, index) => /^dictionary_entries:\s*$/.test(line) ? index : -1)
    .filter((index) => index >= 0);
  if (starts.length !== 1) {
    failures.push(`${docsPath}: dictionary_entries must be declared exactly once`);
    return [];
  }
  const tokens = [];
  for (const line of frontmatter.slice(starts[0] + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) break;
    const match = line.match(/^\s{2}-\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/);
    const token = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    if (token) tokens.push(token);
  }
  if (tokens.length === 0) failures.push(`${docsPath}: dictionary_entries is empty`);
  return tokens;
}

function tableEntries(descriptor, text, failures) {
  const lines = text.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => line.trim() === `## ${descriptor.tableHeading}` ? index : -1)
    .filter((index) => index >= 0);
  if (headingIndexes.length !== 1) {
    failures.push(
      `${descriptor.docsPath}: heading "## ${descriptor.tableHeading}" must appear exactly once`,
    );
    return [];
  }
  const headingIndex = headingIndexes[0];
  const offset = lines.slice(headingIndex + 1).findIndex((line) => /^##\s+/.test(line));
  const sectionEnd = offset < 0 ? lines.length : headingIndex + 1 + offset;

  const rows = [];
  for (const line of lines.slice(headingIndex + 1, sectionEnd)) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (!match) continue;
    const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
    rows.push({
      token: match[1],
      summary: (cells[1] ?? "").replace(/\s+/g, " ").trim(),
      index: rows.length,
    });
  }
  return rows;
}

function readFrontmatterLines(docsPath, text, failures) {
  if (typeof text !== "string") {
    failures.push(`${docsPath}: dictionary is absent from the docs artifact set`);
    return null;
  }
  if (!dictionaryWithinBudget(text)) {
    failures.push(`${docsPath}: dictionary exceeds byte or line budget`);
    return null;
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    failures.push(`${docsPath}: frontmatter is missing`);
    return null;
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    failures.push(`${docsPath}: frontmatter is unterminated`);
    return null;
  }
  return lines.slice(1, end);
}

function singleScalar(frontmatterLines, key) {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`);
  const matches = frontmatterLines
    .map((line) => line.match(pattern))
    .filter((match) => match !== null);
  if (matches.length !== 1) return null;
  const raw = matches[0][1].trim();
  const quoted = raw.match(/^(?:"([^"]*)"|'([^']*)')$/);
  const value = (quoted?.[1] ?? quoted?.[2] ?? raw).trim();
  return value || null;
}
