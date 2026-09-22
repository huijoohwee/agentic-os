import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCompletionScaffoldArguments, buildCompletionBundleScaffold, deriveLocallyAvailableFields } from '../bin/agentic-os-completion-scaffold.mjs';

const REF = 'agent/device/simplification';
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-simplification-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repository'), lane = join(parent, 'lane');
  mkdirSync(root);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'ADLC Test');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', git(root, 'rev-parse', 'HEAD'));
  git(root, 'worktree', 'add', '--quiet', '-b', REF, lane);
  const profile = { repository: 'github.com/example/repository', profileDigest: 'a'.repeat(64),
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' } };
  const policy = { protectedBranch: 'main' };
  const status = () => inspectCompletionStatus(root, REF, policy, profile);
  return { root, lane, git, status, profile, policy };
}

test('completion status classifies docs-only change class and marks authority findings inapplicable', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs'));
  writeFileSync(join(subject.lane, 'docs', 'plan.md'), '# Plan\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'docs');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged docs');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const report = subject.status();
  assert.equal(report.changeClass, 'docs-only');
  const providerFinding = report.findings.find((f) => f.code === 'provider-authority-unverified');
  const cleanupFinding = report.findings.find((f) => f.code === 'cleanup-receipt-unverified');
  // When the lane is not quarantine-profiled, these findings may not appear;
  // but if they do appear under docs-only, they must be marked inapplicable.
  if (providerFinding) {
    assert.equal(providerFinding.applicableToChangeClass.applicable, false);
    assert.match(providerFinding.applicableToChangeClass.reason, /docs-only/u);
  }
  if (cleanupFinding) {
    assert.equal(cleanupFinding.applicableToChangeClass.applicable, false);
  }
  // All findings must carry the applicableToChangeClass field
  for (const f of report.findings) {
    assert.ok(f.applicableToChangeClass, `finding ${f.code} missing applicableToChangeClass`);
    assert.equal(f.applicableToChangeClass.changeClass, 'docs-only');
  }
});

test('completion status classifies mixed change class and marks all findings applicable', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const report = subject.status();
  assert.equal(report.changeClass, 'mixed');
  for (const f of report.findings) {
    assert.ok(f.applicableToChangeClass);
    assert.equal(f.applicableToChangeClass.applicable, true);
  }
});

test('completion scaffold --derive flag parses correctly', () => {
  const args = validateCompletionScaffoldArguments(['--ref=agent/device/x', '--derive']);
  assert.equal(args.ref, 'agent/device/x');
  assert.equal(args.derive, true);
  const noDerive = validateCompletionScaffoldArguments(['--ref=agent/device/x']);
  assert.equal(noDerive.derive, false);
  assert.throws(() => validateCompletionScaffoldArguments(['--ref=agent/device/x', '--unknown']),
    /unknown argument/u);
});

test('deriveLocallyAvailableFields fills expiresAt and preserves authority placeholders', () => {
  const scaffold = {
    schema: 'agentic-os/completion-bundle-scaffold/v1',
    observationOnly: true,
    ref: REF,
    requiredPlaceholders: [
      'cleanup.plan.candidateDigest',
      'cleanup.plan.expiresAt',
      'integrationVerifier.workflowRun',
    ],
    bundleTemplate: {
      cleanup: {
        plan: {
          candidateDigest: 'REPLACE_WITH_CANDIDATE_DIGEST',
          expiresAt: 'REPLACE_WITH_CLEANUP_EXPIRES_AT',
        },
      },
      integrationVerifier: {
        workflowRun: 'REPLACE_WITH_INTEGRATION_WORKFLOW_RUN',
      },
    },
  };
  const status = { lane: { path: null } };
  const result = deriveLocallyAvailableFields(scaffold, status, '/nonexistent');
  assert.notEqual(result.bundleTemplate.cleanup.plan.expiresAt, 'REPLACE_WITH_CLEANUP_EXPIRES_AT');
  assert.match(result.bundleTemplate.cleanup.plan.expiresAt, /^\d/u); // ISO date
  // Authority placeholders must be preserved
  assert.equal(result.bundleTemplate.cleanup.plan.candidateDigest, 'REPLACE_WITH_CANDIDATE_DIGEST');
  assert.equal(result.bundleTemplate.integrationVerifier.workflowRun, 'REPLACE_WITH_INTEGRATION_WORKFLOW_RUN');
  assert.ok(result.remainingPlaceholders.includes('cleanup.plan.candidateDigest'));
  assert.ok(result.remainingPlaceholders.includes('integrationVerifier.workflowRun'));
  assert.ok(!result.remainingPlaceholders.includes('cleanup.plan.expiresAt'));
  assert.ok(result.derivedFields.includes('cleanup.plan.expiresAt'));
  assert.equal(result.deriveNote.includes('authenticated'), true);
});

test('sweep and unified cleanup are exported from cleanup-user module', async () => {
  const mod = await import('../bin/agentic-os-cleanup-user.mjs');
  assert.equal(typeof mod.runUserCleanup, 'function');
  assert.equal(typeof mod.runUnifiedCleanup, 'function');
  assert.equal(typeof mod.planUserCleanup, 'function');
  assert.equal(typeof mod.applyUserCleanup, 'function');
});

test('runUnifiedCleanup rejects unknown subcommand', async () => {
  const mod = await import('../bin/agentic-os-cleanup-user.mjs');
  assert.throws(() => mod.runUnifiedCleanup('/nonexistent', ['bogus'], () => {}),
    /cleanup-arguments/u);
});

test('cleanup-user plan rejects incompatible change-class with recovery', async () => {
  const mod = await import('../bin/agentic-os-cleanup-user.mjs');
  assert.throws(() => mod.planUserCleanup({
    cwd: '/nonexistent', target: '/nonexistent/lane', pr: 1,
    requiredChecks: ['check'], workflow: 'wf',
    recovery: true, changeClass: 'docs-only',
  }), /incompatible-modes/u);
});

test('cleanup-user plan rejects unsupported change-class', async () => {
  const mod = await import('../bin/agentic-os-cleanup-user.mjs');
  assert.throws(() => mod.planUserCleanup({
    cwd: '/nonexistent', target: '/nonexistent/lane', pr: 1,
    requiredChecks: ['check'], workflow: 'wf',
    changeClass: 'bogus-class',
  }), /unsupported-change-class/u);
});
