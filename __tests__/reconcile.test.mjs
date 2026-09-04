import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { planCanonicalSync } from '../src/canonical-sync.mjs';
import { git } from '../src/git.mjs';
import { canonicalClaimScope, classifyCanonicalReconciliation } from '../src/canonical-resources.mjs';

const RECEIPT = 'a'.repeat(64);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-reconcile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args) => git(args, { cwd: root });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'test']);
  writeFileSync(join(root, 'value.txt'), 'base\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'base']);
  const base = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', base]);
  return { root, run, base };
}

function classify(root, scope = 'canonical-reconcile') {
  return classifyCanonicalReconciliation({
    cwd: root, branch: 'main', targetRef: 'refs/remotes/origin/main', scope,
  });
}

test('claim scope always joins exact paths with one semantic scope', () => {
  assert.deepEqual(canonicalClaimScope('canonical-reconcile', ['z.txt', 'a.txt', 'a.txt']), [
    'path:a.txt', 'path:z.txt', 'semantic:canonical-reconcile',
  ]);
  assert.throws(() => canonicalClaimScope('Canonical', ['a.txt']),
    /blocked-invalid-semantic-scope/u);
});

test('canonical relation distinguishes synchronized, behind, and ahead states', (t) => {
  const synchronized = fixture(t);
  assert.equal(classify(synchronized.root).status, 'synced');

  const behind = fixture(t);
  behind.run(['switch', '--quiet', '--detach']);
  writeFileSync(join(behind.root, 'remote.txt'), 'remote\n');
  behind.run(['add', '.']); behind.run(['commit', '--quiet', '--message', 'remote']);
  behind.run(['update-ref', 'refs/remotes/origin/main', behind.run(['rev-parse', 'HEAD'])]);
  behind.run(['switch', '--quiet', 'main']);
  assert.equal(classify(behind.root).status, 'behind-fast-forwardable');

  const ahead = fixture(t);
  writeFileSync(join(ahead.root, 'local.txt'), 'local\n');
  ahead.run(['add', '.']); ahead.run(['commit', '--quiet', '--message', 'local']);
  const result = classify(ahead.root);
  assert.equal(result.status, 'ahead-needs-pr');
  assert.deepEqual(result.claimScope, ['path:local.txt', 'semantic:canonical-reconcile']);
});

test('squash-equivalent divergence needs and binds an integration receipt', (t) => {
  const { root, run, base } = fixture(t);
  writeFileSync(join(root, 'value.txt'), 'integrated\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'local authored change']);
  const local = run(['rev-parse', 'HEAD']);
  run(['switch', '--quiet', '--detach', base]);
  writeFileSync(join(root, 'value.txt'), 'integrated\n');
  writeFileSync(join(root, 'remote.txt'), 'remote advance\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'squash and remote advance']);
  run(['update-ref', 'refs/remotes/origin/main', run(['rev-parse', 'HEAD'])]);
  run(['switch', '--quiet', 'main']);
  assert.equal(run(['rev-parse', 'HEAD']), local);
  assert.equal(classify(root).status, 'squash-integrated-divergence');
  assert.throws(() => planCanonicalSync({
    cwd: root, branch: 'main', targetRef: 'refs/remotes/origin/main',
  }), /blocked-non-fast-forward/u);
  const plan = planCanonicalSync({
    cwd: root, branch: 'main', targetRef: 'refs/remotes/origin/main',
    integrationReceiptDigest: RECEIPT,
  });
  assert.equal(plan.relation, 'squash-integrated-divergence');
  assert.equal(plan.reconciliation.integrationReceiptDigest, RECEIPT);
  assert.equal(plan.reconciliation.proof.head, local);
});

test('conflicting divergence remains blocked despite a receipt-shaped value', (t) => {
  const { root, run, base } = fixture(t);
  writeFileSync(join(root, 'value.txt'), 'local\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'local']);
  run(['switch', '--quiet', '--detach', base]);
  writeFileSync(join(root, 'value.txt'), 'remote\n');
  run(['add', '.']); run(['commit', '--quiet', '--message', 'remote']);
  run(['update-ref', 'refs/remotes/origin/main', run(['rev-parse', 'HEAD'])]);
  run(['switch', '--quiet', 'main']);
  assert.equal(classify(root).status, 'true-conflict');
  assert.throws(() => planCanonicalSync({
    cwd: root, branch: 'main', targetRef: 'refs/remotes/origin/main',
    integrationReceiptDigest: RECEIPT,
  }), /blocked-non-fast-forward/u);
});
