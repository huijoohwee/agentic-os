import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { deriveCloseoutVerdict, inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
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

test('merged retained lane is source_complete without invented cleanup authority', (t) => {
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
  assert.ok(!after.findings.some((item) => item.code === 'provider-authority-unverified'));
  assert.ok(!after.findings.some((item) => item.code === 'cleanup-receipt-unverified'));
  assert.equal(after.closeout.missionState, 'source_complete');
  assert.equal(after.closeout.adlcState, 'complete');
  assert.equal(after.closeout.laneDisposition, 'retained');
  assert.equal(after.closeout.nextAction, null);
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
  assert.equal(report.closeout.missionState, 'blocked');
  assert.equal(report.closeout.nextAction.id, 'preserve-lane-bytes');
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

test('closeout ranks canonical-sync and deploy without granting those effects', () => {
  const base = {
    sourceIntegrated: true, canonicalCurrent: true, laneMounted: true, laneClean: true,
    laneHead: true, quarantineProfile: false, quarantineObserved: false, deployBound: false,
    localPolicyCandidate: false, findingCodes: [],
  };
  const complete = deriveCloseoutVerdict(base);
  assert.equal(complete.missionState, 'source_complete');
  assert.equal(complete.nextAction, null);
  const sync = deriveCloseoutVerdict({
    ...base, canonicalCurrent: false, findingCodes: ['canonical-not-current-clean'],
  });
  assert.equal(sync.missionState, 'continuable');
  assert.equal(sync.nextAction.id, 'canonical-sync-plan');
  const deploy = deriveCloseoutVerdict({ ...base, deployBound: true });
  assert.equal(deploy.missionState, 'source_complete');
  assert.equal(deploy.adlcState, 'delivery_pending');
  assert.equal(deploy.nextAction.id, 'deploy-workflow');
  assert.equal(deploy.authorizesEffects, false);
  const docs = deriveCloseoutVerdict({ ...base, deployBound: true, changeClass: 'docs-only' });
  assert.equal(docs.missionState, 'source_complete');
  assert.equal(docs.adlcState, 'delivery_scope_pending');
  assert.equal(docs.nextAction.id, 'assess-delivery-scope');
  assert.equal(docs.authorizesEffects, false);
  const cleanup = deriveCloseoutVerdict({
    ...base, quarantineProfile: true, findingCodes: ['cleanup-receipt-unverified'],
  });
  assert.equal(cleanup.laneDisposition, 'awaiting-cleanup');
  assert.equal(cleanup.nextAction.id, 'release-common-complete');
});

test('quarantine profile reports cleanup as unfinished until a coordinate is observed', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main',
    subject.git(subject.root, 'rev-parse', 'HEAD'));
  const profile = { repository: 'github.com/example/repository', profileDigest: 'a'.repeat(64),
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    cleanup: { localBranch: 'retain', remoteBranch: 'retain', remoteTrackingRef: 'retain',
      unreachableObjects: 'retain', worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } };
  const report = inspectCompletionStatus(subject.root, REF, { protectedBranch: 'main' }, profile);
  assert.equal(report.closeout.laneDisposition, 'awaiting-cleanup');
  assert.equal(report.closeout.missionState, 'continuable');
  assert.equal(report.closeout.nextAction.id, 'release-common-complete');
  assert.ok(report.findings.some((item) => item.code === 'cleanup-receipt-unverified'));
  assert.ok(!report.findings.some((item) => item.code === 'provider-authority-unverified'));
});

test('quarantine directory names and HEAD alone do not prove completed cleanup', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main',
    subject.git(subject.root, 'rev-parse', 'HEAD'));
  subject.git(subject.root, 'worktree', 'remove', '--force', subject.lane);
  const base = join(subject.root, '.git', 'agentic-os-cleanup-quarantine');
  mkdirSync(base);
  for (let index = 0; index < 40; index += 1) {
    const name = index.toString(16).padStart(64, '0');
    mkdirSync(join(base, name, 'projection'), { recursive: true });
    mkdirSync(join(base, name, 'registration'), { recursive: true });
    writeFileSync(join(base, name, 'registration', 'HEAD'), `ref: refs/heads/agent/other/${index}\n`);
  }
  const match = 'ab'.repeat(32);
  mkdirSync(join(base, match, 'projection'), { recursive: true });
  mkdirSync(join(base, match, 'registration'), { recursive: true });
  writeFileSync(join(base, match, 'registration', 'HEAD'), `ref: refs/heads/${REF}\n`);
  const profile = { repository: 'github.com/example/repository', profileDigest: 'a'.repeat(64),
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    cleanup: { localBranch: 'retain', remoteBranch: 'retain', remoteTrackingRef: 'retain',
      unreachableObjects: 'retain', worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } };
  const report = inspectCompletionStatus(subject.root, REF, { protectedBranch: 'main' }, profile);
  assert.equal(report.cleanupVerified, false);
  assert.equal(report.closeout.laneDisposition, 'unmounted');
  assert.equal(report.closeout.cleanupSatisfied, false);
  assert.equal(report.closeout.missionState, 'continuable');
  assert.ok(report.findings.some((item) => item.code === 'lane-registration-detached'));
  assert.ok(report.findings.some((item) => item.code === 'cleanup-receipt-unverified'));
});

test('enrolled production-activation is a deploy nextAction after source complete', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({
    operations: ['publication', 'production-activation'],
  }));
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'flight');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main',
    subject.git(subject.root, 'rev-parse', 'HEAD'));
  const after = subject.status();
  assert.equal(after.closeout.missionState, 'source_complete');
  assert.equal(after.closeout.adlcState, 'delivery_pending');
  assert.equal(after.closeout.nextAction.id, 'deploy-workflow');
  assert.equal(after.closeout.deployBinding.present, true);
});

test('docs-only lane in a production-bound repo requires product delivery-scope assessment', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs'));
  writeFileSync(join(subject.lane, 'docs', 'handover.md'), '# Handover\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'document handover');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({
    operations: ['publication', 'production-activation'],
  }));
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'flight');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main',
    subject.git(subject.root, 'rev-parse', 'HEAD'));
  const report = subject.status();
  assert.equal(report.changeClass, 'docs-only');
  assert.equal(report.closeout.missionState, 'source_complete');
  assert.equal(report.closeout.adlcState, 'delivery_scope_pending');
  assert.equal(report.closeout.nextAction.id, 'assess-delivery-scope');
  assert.equal(report.closeout.authorizesEffects, false);
});
