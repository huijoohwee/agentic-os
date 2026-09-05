import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_PROOF_SCHEMA } from '../src/readiness-proof.mjs';
import {
  catalogDigest,
  dispatchInvocation,
  ENTRY_CONTRACTS,
  loadCatalog,
  resolveInvocation,
  validateCatalog,
} from '../bin/agentic-os-invocation.mjs';

export const READINESS_PROOF = Object.freeze({
  schema: CONTRACT_PROOF_SCHEMA,
  claims: ['sha256:1897165973e1f2024ee350a630d57ba2f67081821489763685ae87612771186f'],
});

const clone = (value) => structuredClone(value);

test('the packaged catalog has thirteen unique entries behind count and digest fences', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.entryCount, 13);
  assert.equal(catalog.digest, catalogDigest(catalog.entries));
  assert.deepEqual(validateCatalog(catalog), { ok: true, findings: [] });
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(pkg.files.includes('catalog'));
  assert.ok(pkg.files.includes('__tests__'));
});

test('lane invocation resolves to the existing guarded start command', () => {
  const result = resolveInvocation(['/lane', '#mutating', '@scope:pricing-table']);
  assert.equal(result.ok, true);
  assert.deepEqual(dispatchInvocation(result), {
    ok: true,
    command: 'start',
    argv: ['pricing-table'],
    semantic: 'mutating',
  });
  assert.ok(result.costRecords.every((record) => record.estimatedCostUsd === 0));
});

test('an argument binding maps to an existing option without interpreting its value', () => {
  const result = resolveInvocation(['/status', '@device:box-1.local']);
  assert.deepEqual(dispatchInvocation(result).argv, ['--device=box-1.local']);
});

test('dispatch re-resolves untrusted resolution objects before crossing the CLI boundary', () => {
  const mutated = resolveInvocation(['/reap', '#mutating']);
  mutated.entries.push({ kind: 'binding', canonical: '@scope:', argument: '--apply' });
  assert.deepEqual(dispatchInvocation(mutated), { ok: false, code: 'resolution-invalid' });
  assert.deepEqual(dispatchInvocation({ ok: true }), { ok: false, code: 'resolution-invalid' });
  assert.deepEqual(dispatchInvocation({ ok: true, schema: 'wrong', tokens: ['/help'] }), {
    ok: false,
    code: 'resolution-invalid',
  });
});

test('grammar failures are typed and fail closed', () => {
  const cases = [
    [['doctor'], 'malformed-token'],
    [['/'], 'malformed-token'],
    [[`/${'a'.repeat(129)}`], 'malformed-token'],
    [['/doctor:now'], 'malformed-token'],
    [['/lane', '@scope:'], 'malformed-token'],
    [['@scope:x', '@device:y', '/lane'], 'duplicate-prefix'],
    [['/doctor', '#read-only', '@device:x', '/help'], 'token-count'],
    [['/missing'], 'unresolved'],
    [['/doctor', '#mutating'], 'semantic-mismatch'],
    [['/doctor', '@scope:x'], 'binding-not-accepted'],
    [['/lane'], 'binding-required'],
  ];
  for (const [input, code] of cases) assert.equal(resolveInvocation(input).code, code, input.join(' '));
});

test('only the binding prefix may carry one bounded opaque argument', () => {
  assert.equal(resolveInvocation([`/doctor`, `@scope:${'x'.repeat(1025)}`]).code, 'malformed-token');
  const result = resolveInvocation(['/lane', '@scope:a:b/c']);
  assert.equal(result.ok, true);
  assert.deepEqual(dispatchInvocation(result).argv, ['a:b/c']);
});

test('catalog count, digest, and ambiguity drift are distinct', () => {
  const count = clone(loadCatalog());
  count.entryCount += 1;
  assert.equal(resolveInvocation('/doctor', { catalog: count }).code, 'catalog-invalid');
  assert.equal(validateCatalog(count).findings[0].code, 'count-drift');

  const digest = clone(loadCatalog());
  digest.entries[0].summary = 'drift';
  assert.equal(resolveInvocation('/doctor', { catalog: digest }).code, 'catalog-invalid');
  assert.ok(validateCatalog(digest).findings.some((finding) => finding.code === 'digest-drift'));

  const ambiguous = clone(loadCatalog());
  ambiguous.entries.push(clone(ambiguous.entries[0]));
  ambiguous.entryCount = ambiguous.entries.length;
  ambiguous.digest = catalogDigest(ambiguous.entries);
  assert.equal(resolveInvocation('/setup', { catalog: ambiguous }).code, 'ambiguous-entry');

  const shape = clone(loadCatalog());
  shape.entries[0].action = '../escape';
  shape.digest = catalogDigest(shape.entries);
  assert.ok(validateCatalog(shape).findings.some((finding) => finding.code === 'action-invalid'));

  const escalation = clone(loadCatalog());
  const help = escalation.entries.find((entry) => entry.token === '/help');
  help.action = 'queue';
  help.argv = ['apply', '--yes'];
  escalation.digest = catalogDigest(escalation.entries);
  const refused = resolveInvocation(['/help', '#read-only'], { catalog: escalation });
  assert.equal(refused.code, 'catalog-invalid');
  assert.equal(dispatchInvocation(refused).ok, false);

  const malformed = clone(loadCatalog());
  malformed.entries[0] = null;
  malformed.entries[1].argv = [{}];
  malformed.entries[2].requires = 'scope';
  malformed.entries[4].accepts = {};
  malformed.digest = catalogDigest(malformed.entries);
  assert.equal(validateCatalog(malformed).ok, false);
  assert.ok(validateCatalog(malformed).findings.some((finding) => finding.code === 'argv-element-invalid'));

  assert.throws(() => { ENTRY_CONTRACTS['/help'].action = 'queue'; }, TypeError);
  assert.throws(() => { ENTRY_CONTRACTS['/queue.show'].argv.push('apply'); }, TypeError);
});

test('catalog validation rejects proxies without executing their traps', () => {
  let touched = false;
  const proxy = new Proxy({}, { get() { touched = true; return null; } });
  const result = validateCatalog(proxy);
  assert.equal(result.ok, false);
  assert.equal(touched, false);
});

test('prefix order is a permutation-invariant property', () => {
  const permutations = [
    ['/lane', '#mutating', '@scope:x'],
    ['/lane', '@scope:x', '#mutating'],
    ['#mutating', '/lane', '@scope:x'],
    ['#mutating', '@scope:x', '/lane'],
    ['@scope:x', '/lane', '#mutating'],
    ['@scope:x', '#mutating', '/lane'],
  ];
  for (const tokens of permutations) {
    assert.deepEqual(dispatchInvocation(resolveInvocation(tokens)), {
      ok: true,
      command: 'start',
      argv: ['x'],
      semantic: 'mutating',
    });
  }
});

test('slash tokens are wired into the real CLI runtime path', () => {
  for (const args of [['/help'], ['#read-only', '/help']]) {
    const run = spawnSync(process.execPath, ['bin/agentic-os.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /agentic-os — ADLC harness/);
  }
});

test('help is repository-independent in a detached primary checkout', (t) => {
  const repository = mkdtempSync(join(tmpdir(), 'agentic-os-detached-help-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'detached-help@example.invalid'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Detached Help Test'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'fixture'], { cwd: repository });
  execFileSync('git', ['checkout', '--quiet', '--detach', 'HEAD'], { cwd: repository });

  const cli = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
  for (const args of [[], ['help'], ['--help'], ['/help']]) {
    const run = spawnSync(process.execPath, [cli, ...args], { cwd: repository, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /agentic-os — ADLC harness/);
  }
});
