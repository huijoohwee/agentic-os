/**
 * Compute a candidate's autonomy class from its write set.
 *
 * The candidate never declares its own class. Mixed changes resolve upward,
 * and authority-controlling changes always require promotion outside a
 * standing grant. No clock, network, provider, repository name, or model call
 * participates in the decision.
 */

import { observeGit } from './git.mjs';

export const AUTONOMY_CLASS_SCHEMA = 'agentic-os/autonomy-class/v1';
export const CLASS_DOCS_ONLY = 'docs-only';
export const CLASS_TEST_ONLY = 'test-only';
export const CLASS_ADDITIVE_CONTRACT = 'additive-contract';
export const CLASS_BEHAVIORAL = 'behavioral';
export const CLASS_AUTHORITY_CONTROLLING = 'authority-controlling';

export const CLASS_ORDER = Object.freeze([
  CLASS_DOCS_ONLY,
  CLASS_TEST_ONLY,
  CLASS_ADDITIVE_CONTRACT,
  CLASS_BEHAVIORAL,
  CLASS_AUTHORITY_CONTROLLING,
]);

export const ESCALATING_CLASSES = Object.freeze([CLASS_AUTHORITY_CONTROLLING]);

/** Executable agentic-os surfaces that can widen who may write, land, or retire. */
export const AGENTIC_OS_AUTHORITY_PATHS = Object.freeze([
  '.agentic-os.json',
  '.gitattributes',
  '.gitignore',
  'AGENTS.md',
  'package.json',
  'bin/agentic-os-auxiliary.mjs',
  'bin/agentic-os-authority.mjs',
  'bin/agentic-os-argv.mjs',
  'bin/agentic-os-config.mjs',
  'bin/agentic-os-doc-budget.mjs',
  'bin/agentic-os-filter-compare.mjs',
  'bin/agentic-os-filter-materialize.mjs',
  'bin/agentic-os-hooks.mjs',
  'bin/agentic-os-report.mjs',
  'bin/agentic-os.mjs',
  'bin/agentic-os-mcp.mjs',
  'bin/agentic-os-module-budget.mjs',
  'catalog/invocation.json',
  'src/autonomy-class.mjs',
  'src/authority-record.mjs',
  'src/canonical-recovery.mjs',
  'src/canonical-staging.mjs',
  'src/canonical-sync.mjs',
  'src/canonical-resources.mjs',
  'src/catalog-input.mjs',
  'src/file-integrity.mjs',
  'src/git.mjs',
  'src/git-repository.mjs',
  'src/git-tracked.mjs',
  'src/governance.mjs',
  'src/guard-main.mjs',
  'bin/agentic-os-hook-runtime.mjs',
  'src/invocation.mjs',
  'src/lane-id.mjs',
  'src/lane-records.mjs',
  'src/lane-state.mjs',
  'src/mcp-server.mjs',
  'src/mcp-stdio.mjs',
  'src/patch-identity.mjs',
  'src/protected-workflows.mjs',
  'src/queue.mjs',
  'src/quarantine.mjs',
  'src/readiness-proof.mjs',
  'src/github-provider.mjs',
  'src/github-authority.mjs',
  'src/github-authority-issuer.mjs',
  'src/github-authority-operation.mjs',
  'src/recovery-candidate.mjs',
  'src/recovery-inventory.mjs',
  'src/worktree.mjs',
]);

/** Common authority surfaces; embeddings may add code-owned patterns. */
export const AUTHORITY_PATTERNS = Object.freeze([
  /^\.githooks\//u,
  /^\.github\/(?:actions|workflows)\//u,
  /^\.circleci\//u,
  /^\.buildkite\//u,
  /^\.gitlab-ci\.ya?ml$/u,
  /^azure-pipelines\.ya?ml$/u,
  /^(?:\.github\/)?CODEOWNERS$/u,
  /^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/u,
  /^(?:bin|lib|scripts|src|tools)\/.*(?:guard|authority|authorization|lease|admission|queue|release|publish|deploy|policy).*$/u,
  /(?:^|\/)(?:credentials|secrets)(?:\.|\/|$)/u,
]);

const DOCS_PATTERNS = Object.freeze([/^docs\//u, /\.md$/u, /^llms\.txt$/u]);
const TEST_PATTERNS = Object.freeze([/^__tests__\//u, /\.test\.mjs$/u, /^fixtures\//u]);
const STATUS_PATTERN = /^(?:[AMDTUXB]|[RC](?:100|0[0-9]{2}))$/u;

function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError('write-set path must be a non-empty NUL-free string');
  }
  const candidate = value.startsWith('./') ? value.slice(2) : value;
  if (!candidate || candidate.startsWith('/') || candidate.split('/').includes('..')) {
    throw new TypeError('write-set path must be repository-relative');
  }
  return candidate;
}

function authorityPatterns(options) {
  const additional = options.additionalAuthorityPatterns ?? [];
  if (
    !Array.isArray(additional)
    || additional.some((pattern) => !(pattern instanceof RegExp) || pattern.global || pattern.sticky)
  ) {
    throw new TypeError('additional authority patterns must be regular expressions');
  }
  return [...AUTHORITY_PATTERNS, ...additional];
}

export function classifyPath(relativePath, options = {}) {
  const candidate = normalizePath(relativePath);
  if (
    AGENTIC_OS_AUTHORITY_PATHS.includes(candidate)
    || authorityPatterns(options).some((pattern) => pattern.test(candidate))
  ) {
    return CLASS_AUTHORITY_CONTROLLING;
  }
  if (TEST_PATTERNS.some((pattern) => pattern.test(candidate))) return CLASS_TEST_ONLY;
  if (DOCS_PATTERNS.some((pattern) => pattern.test(candidate))) return CLASS_DOCS_ONLY;
  return null;
}

function classForEndpoint(path, added, options) {
  const classified = classifyPath(path, options);
  if (classified === CLASS_TEST_ONLY && !added) return CLASS_AUTHORITY_CONTROLLING;
  return classified ?? (added ? CLASS_ADDITIVE_CONTRACT : CLASS_BEHAVIORAL);
}

function strongerClass(left, right) {
  return CLASS_ORDER.indexOf(left) >= CLASS_ORDER.indexOf(right) ? left : right;
}

function normalizeEntry(entry, options) {
  const value = typeof entry === 'string' ? { path: entry, added: false } : entry;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('write-set entry must be a path string or object');
  }
  const path = normalizePath(value.path);
  const previousPath = value.previousPath === undefined
    ? null
    : normalizePath(value.previousPath);
  const added = value.added === true;
  let derived = classForEndpoint(path, added, options);
  if (previousPath !== null) {
    derived = strongerClass(derived, classForEndpoint(previousPath, false, options));
  }
  return Object.freeze({
    path,
    ...(previousPath === null ? {} : { previousPath }),
    ...(value.status === undefined ? {} : { status: value.status }),
    added,
    class: derived,
  });
}

export function classifyWriteSet(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TypeError('write set must be an array');
  const paths = Object.freeze(entries.map((entry) => normalizeEntry(entry, options)));
  const highest = paths.reduce(
    (rank, entry) => Math.max(rank, CLASS_ORDER.indexOf(entry.class)),
    -1,
  );
  const derived = highest < 0 ? CLASS_DOCS_ONLY : CLASS_ORDER[highest];
  const escalatingPaths = [];
  for (const entry of paths) {
    const candidates = [
      ...(entry.previousPath ? [{ path: entry.previousPath, added: false }] : []),
      { path: entry.path, added: entry.added },
    ];
    for (const candidate of candidates) {
      if (classForEndpoint(candidate.path, candidate.added, options) === CLASS_AUTHORITY_CONTROLLING)
        escalatingPaths.push(candidate.path);
    }
  }
  return Object.freeze({
    schema: AUTONOMY_CLASS_SCHEMA,
    class: derived,
    escalates: ESCALATING_CLASSES.includes(derived),
    paths,
    escalatingPaths: Object.freeze([...new Set(escalatingPaths)]),
  });
}

export function coversClass({ grantCeiling, derivedClass }) {
  const ceiling = CLASS_ORDER.indexOf(grantCeiling);
  const derived = CLASS_ORDER.indexOf(derivedClass);
  if (ceiling < 0 || derived < 0 || ESCALATING_CLASSES.includes(derivedClass)) return false;
  return derived <= ceiling;
}

function textOf(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8');
  if (typeof raw === 'string') return raw;
  throw new TypeError('git name-status output must be bytes or text');
}

/** Parse `git diff --name-status -z` without splitting paths on whitespace. */
export function parseNameStatusZ(raw) {
  const text = textOf(raw);
  if (text === '') return Object.freeze([]);
  if (!text.endsWith('\0')) throw new Error('git name-status output is not NUL-terminated');
  const fields = text.split('\0');
  fields.pop();
  const entries = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!STATUS_PATTERN.test(status)) throw new Error(`invalid git name-status code: ${status}`);
    const paired = status.startsWith('R') || status.startsWith('C');
    const previousPath = paired ? fields[index++] : null;
    const path = fields[index++];
    if (path === undefined || (paired && previousPath === undefined)) {
      throw new Error(`incomplete git name-status record: ${status}`);
    }
    const normalizedPrevious = paired ? normalizePath(previousPath) : null;
    entries.push(Object.freeze({
      path: normalizePath(path),
      ...(status.startsWith('R') ? { previousPath: normalizedPrevious } : {}),
      status,
      added: status === 'A' || status.startsWith('C'),
    }));
  }
  return Object.freeze(entries);
}

function executeGitRaw(args, { cwd }) {
  return observeGit(args, { cwd, binary: true, maxBuffer: 64 * 1024 * 1024 });
}

function revision(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || value.startsWith('-')
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded revision, not a Git option`);
  }
  return value;
}

export function collectWriteSet({ repository, base, head, runGit = executeGitRaw }) {
  if (typeof repository !== 'string' || repository.length === 0) {
    throw new TypeError('repository must be a path');
  }
  const baseRevision = revision(base, 'base');
  const headRevision = revision(head, 'head');
  const output = runGit(
    ['diff', '--name-status', '-z', '--find-renames', `${baseRevision}...${headRevision}`, '--'],
    { cwd: repository },
  );
  return parseNameStatusZ(output);
}
