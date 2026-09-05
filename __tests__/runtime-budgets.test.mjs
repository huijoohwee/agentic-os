import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  BUDGET as DOC_BUDGET,
  alwaysLoadFiles,
  ciBudgetsJobIsExact,
  runtimeContractViolations,
  violations as docViolations,
} from '../bin/agentic-os-doc-budget.mjs';
import {
  BUDGET as MODULE_BUDGET,
  FORBIDDEN_SUFFIXES,
  violations as moduleViolations,
} from '../bin/agentic-os-module-budget.mjs';
import { workflowMergeGroupChecks } from '../src/queue.mjs';

test('this repository is inside its own documentation budget', (t) => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { found, total } = docViolations();
  assert.deepEqual(found, [], `doc budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.deepEqual(DOC_BUDGET, {
    agentsFileBytes: 4 * 1024,
    perDocBytes: 12 * 1024,
    alwaysLoadBytes: 40 * 1024,
    maxLineChars: 120,
  });
  assert.equal(total, 40_847, 'update this exact cost to expose every always-load byte delta');
  assert.ok(total <= DOC_BUDGET.alwaysLoadBytes);
  assert.equal(alwaysLoadFiles(root).includes(join(root, 'guides/AUTONOMOUS-GOAL-PURSUIT.md')), false);
  const fixture = mkdtempSync(join(tmpdir(), 'agentic-os-lazy-load-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(join(root, 'AGENTS.md'), join(fixture, 'AGENTS.md'));
  for (const directory of ['docs', 'templates']) cpSync(join(root, directory), join(fixture, directory),
    { recursive: true });
  cpSync(join(root, 'guides/AUTONOMOUS-GOAL-PURSUIT.md'),
    join(fixture, 'docs/AUTONOMOUS-GOAL-PURSUIT.md'));
  assert.ok(docViolations(fixture).found.some((item) => item.kind === 'always-load-total'));
});

test('the portable runtime system prompt is exact and within its native byte contract', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bytes = readFileSync(join(root, 'templates/SYSTEM-PROMPT-RUNTIME.md'));
  assert.equal(bytes.byteLength, 1_000, 'update this exact cost to expose every prompt byte delta');
  assert.ok(bytes.byteLength <= 1_000);
  const prompt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.equal([...prompt].length, 988);
  assert.ok([...prompt].length <= 1_000);
  assert.ok(prompt.split('\n').every((line) => [...line].length <= DOC_BUDGET.maxLineChars));
  assert.equal(bytes.includes(0x0d), false);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'c72415b3f0c1886bc2e98cc8779e9561501f589cca726c1441c7b8dafc531ee0');
});

test('ADLC binds lean time-to-production, budgets, and diff-only integration at every runtime boundary', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const compact = (path) => readFileSync(join(root, path), 'utf8').replace(/\s+/gu, ' ').trim();
  const requirements = new Map([
    ['docs/adlc-guidelines.md', [
      'Minimize time-to-production: smallest valuable vertical diff',
      'Lean bounded sprints state TTP ETA and time/byte/module caps',
      'refresh on drift. External waits state dependency/condition/recheck, never ETA.',
      'Global prompt: exact LF-terminated UTF-8, at most 1,000 bytes; code points secondary, tokens advisory.',
      'New always-load guidance/modules declare deltas; otherwise replace, lazy-load, or reject.',
      'Run root/upstream `npm run evals` continuously in CI; consumers reference, never copy, it.',
      'Lazy-load `../guides/AUTONOMOUS-GOAL-PURSUIT.md`',
      'Edit owner files in disjoint path-scoped lanes; overlaps wait.',
      'Land stages, commits, and publishes reserved paths.',
      'Land the exact committed diff by protected merge.',
      'proof/retirement/cleanup target/sync/deploy/rollback each need an authorized receipt',
    ]],
    ['docs/START-WORKFLOW.md', [
      "At start/resume, apply the global prompt's completion-estimate and external-wait rule.",
      'Continuously obey `templates/SYSTEM-PROMPT-RUNTIME.md` as the global SSOT.',
      '`node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md`); do not copy it.',
      '`agentic-os start <scope> --write=<paths>`',
      'Disjoint lanes run; overlaps wait.',
      '`agentic-os land --message=<message>` stages, commits, pushes',
      'Never copy lane files into canonical.',
    ]],
    ['docs/RELEASE-WORKFLOW.md', [
      "At release start/resume, apply the global prompt's completion-estimate and external-wait rule.",
      'exact committed diff lands by profile-selected protected integration.',
      'Never copy lane files into canonical.',
      'run `agentic-os finish --ref=<lane>` to prove integration and remove that clean worktree',
    ]],
    ['templates/SYSTEM-PROMPT-RUNTIME.md', [
      'Global SSOT=templates/SYSTEM-PROMPT-RUNTIME.md; obey always.',
      'Solo AI-native zero-infra/FOSS harness;',
      'min resource/token/time→prod/value;',
      'Simplify/fix owner/remove replacements; contract-only shims.',
      'Lean time-bound sprints: state ETA+time/byte/module caps;',
      'lazy-load beyond always-load; refresh on drift.',
      'External wait: blocker+recheck, not ETA.',
      'authority+green proof per effect/receipt; never infer.',
    ]],
    ['AGENTS.md', [
      'Continuously obey the global `templates/SYSTEM-PROMPT-RUNTIME.md`',
    ]],
    ['docs/BUDGETS.md', [
      'Universal runtime prompt | 1,000 UTF-8 bytes',
      'states its projected byte delta and fits the configured budget',
      'module pattern states its per-scenario multiplier and projected module delta',
      'token estimates are advisory because tokenizers vary by model and provider',
      'Caps do not rise under pressure.',
    ]],
  ]);
  for (const [path, markers] of requirements) {
    const text = compact(path);
    for (const marker of markers) assert.ok(text.includes(marker), `${path} missing: ${marker}`);
  }
  for (const path of ['docs/START-WORKFLOW.md', 'docs/RELEASE-WORKFLOW.md']) {
    assert.doesNotMatch(compact(path), /bounded active-work ETA/u,
      `${path} must reference rather than fork the global prompt rule`);
  }
});

test('the universal ADLC guideline has exact agent-runtime frontmatter', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const text = readFileSync(join(root, 'docs/adlc-guidelines.md'), 'utf8');
  const match = text.match(/^---\n([\s\S]+?)\n---\n/u);
  assert.ok(match, 'ADLC guideline requires YAML frontmatter');
  const entries = match[1].split('\n').map((line) => {
    const field = line.match(/^([a-z_]+): (\S(?:.*\S)?)$/u);
    assert.ok(field, `invalid ADLC frontmatter line: ${line}`);
    return [field[1], field[2]];
  });
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
  assert.deepEqual(Object.fromEntries(entries), {
    schema: 'agentic-os/adlc-guidelines/v1', title: 'ADLC Guidelines', doc_type: 'guidelines',
    version: '1.2.0', owner: 'agentic-os', universal_scope: 'true',
    supersedes: 'agentic-sdlc', runtime_contract: 'enforced',
    runtime_evaluator: 'npm run evals', execution_policy: 'lean-time-bound-budget-driven-sprints',
    load_policy: 'lazy-beyond-always-load', integration_policy: 'minimal-diff-protected-merge',
    runtime_policy: 'fail-closed',
    lifecycle_status: 'active',
  });
});

test('required CI continuously evaluates the root-owned ADLC contract', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const packageDocument = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageDocument.scripts.test,
    'node --test --test-concurrency=4 __tests__/*.test.mjs');
  assert.equal(packageDocument.scripts.check, 'npm test && npm run evals');
  assert.equal(packageDocument.scripts.evals,
    'npm run readiness:check && npm run docs:check && npm run modules:check');
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.equal(ciBudgetsJobIsExact(workflow), true);
  assert.deepEqual(workflowMergeGroupChecks(workflow), ['test', 'budgets']);
  assert.equal(ciBudgetsJobIsExact(workflow.replace('      - run: npm run evals',
    '      # - run: npm run evals')), false);
  assert.equal(ciBudgetsJobIsExact(workflow.replace('      - run: npm run evals', '') +
    '\n  decoy:\n    steps:\n      - run: npm run evals\n'), false);
  assert.equal(ciBudgetsJobIsExact(workflow.replace('      - run: npm run evals',
    '      - run: npm run evals\n        continue-on-error: true')), false);
  assert.equal(ciBudgetsJobIsExact(workflow.replace('      - run: npm run evals',
    '      - run: npm pkg set scripts.evals=true\n      - run: npm run evals')), false);
  assert.equal(ciBudgetsJobIsExact(workflow.replace('working-directory: ${{ github.workspace }}',
    'working-directory: fixture')), false);
  assert.equal(ciBudgetsJobIsExact(workflow.replace('      - run: npm run evals',
    '      - run: npm run evals\n        if : false')), false);
  const job = workflow.slice(workflow.indexOf('  budgets:'));
  assert.equal(ciBudgetsJobIsExact(`name: decoy\nx: |\n${job}`), false);
  assert.equal(ciBudgetsJobIsExact(`jobs:\n  test:\nroot: |\n${job}`), false);
  assert.equal(ciBudgetsJobIsExact(`jobs:\n  test:\n"root": |\n${job}`), false);
  const guide = readFileSync(join(root, 'guides/AUTONOMOUS-GOAL-PURSUIT.md'), 'utf8');
  assert.match(guide, /on-demand ADLC guide, not an always-load instruction/u);
  assert.match(guide, /smallest valuable vertical slice that can reach production within the sprint cap/u);
  assert.match(guide, /Whole-file replacement is valid only when the\s+whole file is the scoped change/u);
  assert.match(guide, /At the time cap, finish a safe atomic slice or replan from evidence/u);
  assert.match(guide, /After the same approach fails twice/u);
  assert.match(guide, /shared-state repair gets one attempt/u);
});

test('root-owned runtime evaluation fails closed on installed prompt or binding drift', (t) => {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-runtime-eval-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['docs', 'templates']) cpSync(join(source, directory), join(root, directory),
    { recursive: true });
  assert.deepEqual(runtimeContractViolations(root), []);
  const promptPath = join(root, 'templates/SYSTEM-PROMPT-RUNTIME.md');
  const driftedPrompt = Buffer.from(readFileSync(promptPath));
  driftedPrompt[0] = driftedPrompt[0] === 0x47 ? 0x67 : 0x47;
  writeFileSync(promptPath, driftedPrompt);
  assert.ok(runtimeContractViolations(root).some((item) => item.kind === 'runtime-prompt-digest'));
  writeFileSync(promptPath, readFileSync(join(source, 'templates/SYSTEM-PROMPT-RUNTIME.md')));
  const guidelinePath = join(root, 'docs/adlc-guidelines.md');
  writeFileSync(guidelinePath, readFileSync(guidelinePath, 'utf8')
    .replace('runtime_evaluator: npm run evals', 'runtime_evaluator: local-copy'));
  assert.ok(runtimeContractViolations(root)
    .some((item) => item.kind === 'runtime-evaluator-binding'));
  rmSync(promptPath);
  assert.deepEqual(runtimeContractViolations(root).map((item) => item.kind),
    ['runtime-prompt-unreadable', 'runtime-evaluator-binding']);
  writeFileSync(guidelinePath, readFileSync(join(source, 'docs/adlc-guidelines.md')));
  symlinkSync(join(source, 'templates/SYSTEM-PROMPT-RUNTIME.md'), promptPath);
  assert.ok(runtimeContractViolations(root)
    .some((item) => item.kind === 'runtime-prompt-unreadable'));
  rmSync(promptPath);
  writeFileSync(promptPath, readFileSync(join(source, 'templates/SYSTEM-PROMPT-RUNTIME.md')));
  writeFileSync(guidelinePath, readFileSync(guidelinePath, 'utf8') +
    '\n<!-- runtime_evaluator: npm run evals -->\n');
  assert.deepEqual(runtimeContractViolations(root), []);
  for (const [active, drift, kind] of [
    ['runtime_evaluator: npm run evals', 'runtime_evaluator: local-copy',
      'runtime-evaluator-binding'],
    ['execution_policy: lean-time-bound-budget-driven-sprints', 'execution_policy: unbounded',
      'runtime-execution-policy'],
    ['load_policy: lazy-beyond-always-load', 'load_policy: eager', 'runtime-load-policy'],
    ['integration_policy: minimal-diff-protected-merge', 'integration_policy: whole-file-copy',
      'runtime-integration-policy'],
  ]) {
    writeFileSync(guidelinePath, readFileSync(join(source, 'docs/adlc-guidelines.md'), 'utf8')
      .replace(active, drift));
    assert.ok(runtimeContractViolations(root).some((item) => item.kind === kind));
  }
  writeFileSync(guidelinePath, readFileSync(join(source, 'docs/adlc-guidelines.md'), 'utf8')
    .replace('lifecycle_status: active', 'unknown_policy: true\nlifecycle_status: active'));
  assert.ok(runtimeContractViolations(root).some((item) => item.kind === 'runtime-frontmatter-shape'));
  writeFileSync(guidelinePath, readFileSync(join(source, 'docs/adlc-guidelines.md')));
  cpSync(join(source, '.github'), join(root, '.github'), { recursive: true });
  writeFileSync(join(root, '.git'), 'gitdir: fixture\n');
  assert.deepEqual(runtimeContractViolations(root), []);
  const workflowPath = join(root, '.github/workflows/ci.yml');
  writeFileSync(workflowPath, readFileSync(workflowPath, 'utf8')
    .replace('working-directory: ${{ github.workspace }}', 'working-directory: fixture'));
  assert.ok(runtimeContractViolations(root).some((item) => item.kind === 'runtime-ci-contract'));
});

test('this repository is inside its own module budget', () => {
  const { found, entries, total } = moduleViolations();
  assert.deepEqual(found, [], `module budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.deepEqual(MODULE_BUDGET, { modules: 46, totalLines: 15_000, perModuleLines: 400 });
  assert.equal(entries.length, 46);
  assert.ok(entries.length <= MODULE_BUDGET.modules);
  assert.ok(total <= MODULE_BUDGET.totalLines);
  for (const path of [
    'src/authority-record.mjs',
    'src/recovery-candidate.mjs',
    'src/recovery-inventory.mjs',
    'src/github-authority.mjs',
    'src/github-authority-issuer.mjs',
    'src/github-authority-operation.mjs',
  ]) assert.ok(entries.some((entry) => entry.path === path), path);
});

test('the module budget rejects scenario multiplication without retaining historical ceremony', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const document = readFileSync(join(root, 'docs/BUDGETS.md'), 'utf8');
  assert.match(document,
    /per-scenario quadruple of\s+contract, controller, adapter, and evidence module multiplies/u);
  assert.match(document, /states its per-scenario multiplier and projected module delta/u);
  assert.match(document, /New behavior belongs in the state table or an existing responsibility owner/u);
  assert.doesNotMatch(document, /increase from \d+ to \d+/u);
});

test('per-scenario module families are forbidden by name', () => {
  assert.ok(FORBIDDEN_SUFFIXES.includes('-controller.mjs'));
  assert.ok(FORBIDDEN_SUFFIXES.includes('-repository-adapter.mjs'));
});
