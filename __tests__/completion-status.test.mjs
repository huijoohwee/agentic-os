import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const REF = 'agent/device/completion-status';
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-completion-status-'));
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
  return { root, lane, git, status };
}

test('completion grammar accepts only one exact status target', () => {
  assert.equal(validateCommandArguments('completion', ['status', `--ref=${REF}`]), null);
  assert.match(validateCommandArguments('completion', ['status']), /missing --ref/u);
  assert.match(validateCommandArguments('completion', ['apply', `--ref=${REF}`]), /requires status/u);
});

test('merged tree remains observation-only and reports missing enrollment and authority', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  const before = subject.status();
  assert.equal(before.integration, null);
  assert.ok(before.findings.some((item) => item.code === 'integration-not-classified'));
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const after = subject.status();
  assert.equal(after.integration.kind, 'exact-tree-projection');
  assert.equal(after.authorizesEffects, false);
  assert.equal(after.providerVerified, false);
  assert.equal(after.cleanupVerified, false);
  assert.equal(after.enrollment.localPolicyCandidate, false);
  assert.ok(after.findings.some((item) => item.code === 'authority-repository-unresolved'));
  assert.ok(!after.findings.some((item) => item.code === 'enrollment-file-missing'));
  assert.ok(after.findings.some((item) => item.code === 'provider-authority-unverified'));
  assert.ok(after.findings.some((item) => item.code === 'cleanup-receipt-unverified'));
  assert.equal(subject.git(subject.root, 'rev-parse', 'HEAD'), after.canonicalRevision);
});

test('dirty lane and stale canonical tracking are separate blockers', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'untracked.txt'), 'preserve\n');
  // Advance main locally while retaining the older tracking ref.
  writeFileSync(join(subject.root, 'new.txt'), 'new\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'local advance');
  const report = subject.status();
  assert.equal(report.lane.clean, false);
  assert.ok(report.findings.some((item) => item.code === 'lane-dirty'));
  assert.ok(report.findings.some((item) => item.code === 'canonical-not-current-clean'));
});

test('an external authority policy does not require workflow files in the target', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.root, '.agentic-os'));
  writeFileSync(join(subject.root, '.agentic-os', 'github-transition-policy.json'), JSON.stringify({
    schema: 'agentic-os/github-transition-policy/v1',
    authorityRepository: 'github.com/example/authority', authorityRef: 'refs/heads/main',
    workflowPath: '.github/workflows/adlc-transition.yml',
    targetRepositories: ['github.com/example/repository'],
    evidenceRefPrefix: 'refs/heads/adlc/authority/',
  }));
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'select authority');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const report = subject.status();
  assert.equal(report.enrollment.authorityRepository, 'github.com/example/authority');
  assert.ok(report.findings.some((item) => item.code === 'external-authority-unverified'));
  assert.ok(!report.findings.some((item) => item.code === 'enrollment-file-missing'));
});
