#!/usr/bin/env node
/**
 * Always-loaded documentation budget in bytes.
 *
 * A line cap gets gamed: 600 lines of 3,000-character paragraphs reports
 * compliance while costing 97 KB of context. Tokens track bytes, so the budget
 * tracks bytes, plus a line length cap to keep diffs reviewable.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { workflowMergeGroupChecks } from '../src/protected-workflows.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');

export const BUDGET = Object.freeze({
  agentsFileBytes: 4 * 1024,
  perDocBytes: 12 * 1024,
  alwaysLoadBytes: 40 * 1024,
  maxLineChars: 120,
});

export const RUNTIME_PROMPT_CONTRACT = Object.freeze({
  path: 'templates/SYSTEM-PROMPT-RUNTIME.md',
  exactBytes: 1_000,
  maxBytes: 1_000,
  sha256: 'c72415b3f0c1886bc2e98cc8779e9561501f589cca726c1441c7b8dafc531ee0',
});

const EXPECTED_CI_BUDGETS_JOB = Object.freeze([
  '  budgets:',
  '    name: budgets',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 5',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: actions/setup-node@v4',
  '        with:',
  '          node-version: 22',
  '      - run: npm run evals',
  '        working-directory: ${{ github.workspace }}',
  '',
]);

const RUNTIME_FRONTMATTER_CONTRACT = Object.freeze({
  schema: 'agentic-os/adlc-guidelines/v1',
  title: 'ADLC Guidelines',
  doc_type: 'guidelines',
  version: '1.1.0',
  owner: 'agentic-os',
  universal_scope: 'true',
  supersedes: 'agentic-sdlc',
  runtime_contract: 'enforced',
  runtime_evaluator: 'npm run evals',
  execution_policy: 'lean-time-bound-budget-driven-sprints',
  load_policy: 'lazy-beyond-always-load',
  integration_policy: 'minimal-diff-protected-merge',
  runtime_policy: 'fail-closed',
  lifecycle_status: 'active',
});

export function ciBudgetsJobIsExact(document) {
  if (typeof document !== 'string') return false;
  const contexts = workflowMergeGroupChecks(document);
  if (contexts.length !== 2 || contexts[0] !== 'test' || contexts[1] !== 'budgets') return false;
  const lines = document.split('\n');
  const jobMappings = lines.flatMap((line, index) => line === 'jobs:' ? [index] : []);
  const starts = lines.flatMap((line, index) => line === '  budgets:' ? [index] : []);
  if (jobMappings.length !== 1 || starts.length !== 1) return false;
  const jobs = jobMappings[0];
  const start = starts[0];
  const jobsEnd = lines.findIndex((line, index) => index > jobs
    && line.trim() !== '' && !/^\s*#/u.test(line) && !/^\s/u.test(line));
  if (start <= jobs || (jobsEnd >= 0 && start >= jobsEnd)) return false;
  const next = lines.findIndex((line, index) => index > start
    && /^  [A-Za-z0-9_-]+:$/u.test(line));
  const job = lines.slice(start, next < 0 ? lines.length : next);
  return job.length === EXPECTED_CI_BUDGETS_JOB.length
    && job.every((line, index) => line === EXPECTED_CI_BUDGETS_JOB[index]);
}

const contractFailure = (kind, path, measured, expected, hint) =>
  ({ kind, path, measured, expected, hint });

export function runtimeContractViolations(root = ROOT) {
  const found = [];
  let bytes;
  try {
    bytes = readBoundedFile(join(root, RUNTIME_PROMPT_CONTRACT.path),
      RUNTIME_PROMPT_CONTRACT.maxBytes + 1, 'runtime prompt');
  } catch {
    found.push(contractFailure('runtime-prompt-unreadable', RUNTIME_PROMPT_CONTRACT.path,
      'unreadable', 'bounded regular file', 'restore the exact pinned upstream prompt'));
  }
  if (bytes && bytes.byteLength !== RUNTIME_PROMPT_CONTRACT.exactBytes) found.push(contractFailure(
    'runtime-prompt-exact-bytes', RUNTIME_PROMPT_CONTRACT.path, bytes.byteLength,
    RUNTIME_PROMPT_CONTRACT.exactBytes, 'review and pin every prompt byte delta',
  ));
  if (bytes && bytes.byteLength > RUNTIME_PROMPT_CONTRACT.maxBytes) found.push(contractFailure(
    'runtime-prompt-byte-cap', RUNTIME_PROMPT_CONTRACT.path, bytes.byteLength,
    `<= ${RUNTIME_PROMPT_CONTRACT.maxBytes}`, 'replace lower-value text; never raise the cap under pressure',
  ));
  const sha256 = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  if (bytes && sha256 !== RUNTIME_PROMPT_CONTRACT.sha256) found.push(contractFailure(
    'runtime-prompt-digest', RUNTIME_PROMPT_CONTRACT.path, sha256,
    RUNTIME_PROMPT_CONTRACT.sha256, 'update the exact reviewed contract and its evaluator together',
  ));
  let prompt;
  try {
    if (bytes) prompt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    found.push(contractFailure('runtime-prompt-utf8', RUNTIME_PROMPT_CONTRACT.path,
      'invalid', 'strict UTF-8', 'use exact UTF-8 source bytes'));
  }
  if (bytes?.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) found.push(contractFailure(
    'runtime-prompt-bom', RUNTIME_PROMPT_CONTRACT.path, 'present', 'absent', 'remove the UTF-8 BOM',
  ));
  if (prompt !== undefined) {
    if (prompt.includes('\r')) found.push(contractFailure(
      'runtime-prompt-line-ending', RUNTIME_PROMPT_CONTRACT.path, 'CR present', 'LF only',
      'normalize the prompt to LF',
    ));
    if (!prompt.endsWith('\n')) found.push(contractFailure(
      'runtime-prompt-final-lf', RUNTIME_PROMPT_CONTRACT.path, 'absent', 'present',
      'terminate the prompt with one LF',
    ));
    const codePoints = [...prompt].length;
    if (codePoints > RUNTIME_PROMPT_CONTRACT.maxBytes) found.push(contractFailure(
      'runtime-prompt-code-points', RUNTIME_PROMPT_CONTRACT.path, codePoints,
      `<= ${RUNTIME_PROMPT_CONTRACT.maxBytes}`, 'code points are secondary; bytes remain primary',
    ));
    const longestLine = Math.max(...prompt.split('\n').map((line) => [...line].length));
    if (longestLine > BUDGET.maxLineChars) found.push(contractFailure(
      'runtime-prompt-line-length', RUNTIME_PROMPT_CONTRACT.path, longestLine,
      `<= ${BUDGET.maxLineChars}`, 'wrap the line for review readability',
    ));
  }
  let guideline = '';
  try {
    guideline = new TextDecoder('utf-8', { fatal: true }).decode(readBoundedFile(
      join(root, 'docs/adlc-guidelines.md'), BUDGET.perDocBytes, 'ADLC guideline'));
  } catch {
    found.push(contractFailure('runtime-guideline-unreadable', 'docs/adlc-guidelines.md',
      'unreadable', 'bounded regular UTF-8 file', 'restore the exact pinned upstream guideline'));
  }
  const frontmatter = guideline.match(/^---\n([\s\S]+?)\n---\n/u)?.[1] ?? '';
  const fields = new Map();
  let validFields = frontmatter !== '';
  for (const line of frontmatter.split('\n')) {
    const field = line.match(/^([a-z_]+): (\S(?:.*\S)?)$/u);
    if (!field || fields.has(field[1])) { validFields = false; continue; }
    fields.set(field[1], field[2]);
  }
  const bindings = Object.entries(RUNTIME_FRONTMATTER_CONTRACT);
  if (!validFields || fields.size !== bindings.length) found.push(contractFailure(
    'runtime-frontmatter-shape', 'docs/adlc-guidelines.md', fields.size,
    `${bindings.length} unique exact fields`, 'remove unknown, duplicate, or malformed frontmatter fields',
  ));
  const bindingKinds = Object.freeze({
    runtime_evaluator: 'runtime-evaluator-binding',
    execution_policy: 'runtime-execution-policy',
    load_policy: 'runtime-load-policy',
    integration_policy: 'runtime-integration-policy',
  });
  for (const [field, expected] of bindings) {
    if (fields.get(field) !== expected) found.push(contractFailure(
      bindingKinds[field] ?? 'runtime-frontmatter-binding', 'docs/adlc-guidelines.md',
      `${field}=${fields.get(field) ?? 'missing'}`, `${field}=${expected}`,
      'bind the real unique YAML field to the reviewed upstream runtime contract',
    ));
  }
  const evalRule = '- Run root/upstream `npm run evals` continuously in CI; consumers reference, never copy, it.';
  if (!guideline.split('\n').includes(evalRule)) found.push(contractFailure(
    'runtime-evaluator-rule', 'docs/adlc-guidelines.md', 'missing active rule', evalRule,
    'keep one exact active routing rule outside comments',
  ));
  if (existsSync(join(root, '.git')) || existsSync(join(root, '.github'))) {
    let workflow = '';
    try {
      workflow = new TextDecoder('utf-8', { fatal: true }).decode(readBoundedFile(
        join(root, '.github/workflows/ci.yml'), 64 * 1024, 'root CI workflow'));
    } catch {
      found.push(contractFailure('runtime-ci-unreadable', '.github/workflows/ci.yml',
        'unreadable', 'bounded regular UTF-8 file', 'restore root-owned continuous evaluation'));
    }
    if (workflow && !ciBudgetsJobIsExact(workflow)) found.push(contractFailure(
      'runtime-ci-contract', '.github/workflows/ci.yml', 'drifted', 'exact root evaluation job',
      'run only the pinned upstream evaluator from the repository root',
    ));
  }
  return found;
}

export function alwaysLoadFiles(root = ROOT) {
  const files = [join(root, 'AGENTS.md')];
  const docs = join(root, 'docs');
  for (const name of readdirSync(docs).sort()) {
    if (name.endsWith('.md')) files.push(join(docs, name));
  }
  return files;
}

export function measure(root = ROOT) {
  const files = alwaysLoadFiles(root);
  const entries = files.map((file) => {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    let longest = 0;
    let longestLine = 0;
    lines.forEach((line, index) => {
      if (line.length > longest) {
        longest = line.length;
        longestLine = index + 1;
      }
    });
    return {
      path: relative(root, file),
      bytes: statSync(file).size,
      lines: lines.length,
      longest,
      longestLine,
    };
  });
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return { entries, total };
}

export function violations(root = ROOT) {
  const { entries, total } = measure(root);
  const found = runtimeContractViolations(root);

  for (const entry of entries) {
    const cap = entry.path === 'AGENTS.md' ? BUDGET.agentsFileBytes : BUDGET.perDocBytes;
    if (entry.bytes > cap) {
      found.push({
        kind: 'file-bytes',
        path: entry.path,
        measured: entry.bytes,
        cap,
        hint: 'move on-demand detail into a document that loads only when needed',
      });
    }
    if (entry.longest > BUDGET.maxLineChars) {
      found.push({
        kind: 'line-length',
        path: `${entry.path}:${entry.longestLine}`,
        measured: entry.longest,
        cap: BUDGET.maxLineChars,
        hint: 'wrap the line; long lines are how a line budget gets gamed',
      });
    }
  }

  if (total > BUDGET.alwaysLoadBytes) {
    found.push({
      kind: 'always-load-total',
      path: 'AGENTS.md + docs/',
      measured: total,
      cap: BUDGET.alwaysLoadBytes,
      hint: 'delete guidance with no repeated-error evidence behind it',
    });
  }

  return { found, total, entries };
}

function report() {
  const { found, total, entries } = violations();
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  for (const entry of entries) {
    const cap = entry.path === 'AGENTS.md' ? BUDGET.agentsFileBytes : BUDGET.perDocBytes;
    const mark = entry.bytes > cap || entry.longest > BUDGET.maxLineChars ? 'FAIL' : 'ok  ';
    process.stdout.write(
      `${mark} ${entry.path.padEnd(24)} ${kb(entry.bytes).padStart(9)} / ${kb(cap)}` +
        `  longest line ${String(entry.longest).padStart(3)}\n`,
    );
  }
  const totalMark = total > BUDGET.alwaysLoadBytes ? 'FAIL' : 'ok  ';
  process.stdout.write(
    `${totalMark} ${'always-load total'.padEnd(24)} ${kb(total).padStart(9)} / ` +
      `${kb(BUDGET.alwaysLoadBytes)}  (~${Math.round(total / 4)} tokens)\n`,
  );

  if (found.length === 0) return 0;
  process.stdout.write('\ndoc budget violations:\n');
  for (const item of found) {
    const relation = Object.hasOwn(item, 'expected')
      ? `; expected ${item.expected}` : ` > ${item.cap}`;
    process.stdout.write(`  ${item.kind}: ${item.path} = ${item.measured}${relation}\n`);
    process.stdout.write(`    ${item.hint}\n`);
  }
  process.stdout.write('\nRaising a cap requires a written reason in the same commit.\n');
  return 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  process.exit(report());
}
