import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deriveCloseoutVerdict, inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { get, put } from '../src/lane-records.mjs';
import { governanceDigest } from '../src/governance.mjs';

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
  return { parent, root, lane, git, profile, policy, status };
}
function addDeliveryDisposition(subject, { disposition, evidencePath = 'docs/delivery-evidence.md', reason = null, candidateRevision = null } = {}) {
  const root = subject.root;
  candidateRevision ??= subject.git(root, 'rev-parse', 'HEAD');
  const laneHead = subject.git(root, 'rev-parse', `refs/heads/${REF}`);
  const paths = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', `refs/heads/main...${laneHead}`],
    { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const evidence = execFileSync('git', ['show', `${candidateRevision}:${evidencePath}`], { cwd: root, encoding: 'utf8' });
  const row = {
    schema: 'agentic-os/delivery-disposition/v1', ref: REF, laneHead, paths, disposition,
    candidateRevision, candidateDigest: 'a'.repeat(64),
    sourceReleaseReceiptDigest: disposition === 'deployed' ? 'b'.repeat(64) : null,
    deploymentReceiptDigest: disposition === 'deployed' ? 'c'.repeat(64) : null,
    runtimeVerificationReceiptDigest: disposition === 'deployed' ? 'd'.repeat(64) : null,
    evidencePath, evidenceDigest: createHash('sha256').update(evidence).digest('hex'),
    decisionRef: 'https://github.com/example/repository/issues/42', reason,
  };
  const body = { schema: 'agentic-os/delivery-disposition-set/v1', repository: subject.profile.repository,
    dispositions: [row] };
  const set = { ...body, receiptDigest: governanceDigest(body) };
  commitDispositionSet(subject, set);
  return set;
}
function commitDispositionSet(subject, set) {
  const root = subject.root;
  writeFileSync(join(root, '.agentic-os-delivery-dispositions.json'), `${JSON.stringify(set, null, 2)}\n`);
  subject.git(root, 'add', '.agentic-os-delivery-dispositions.json');
  subject.git(root, 'commit', '--quiet', '-m', 'record product delivery disposition');
  subject.git(root, 'update-ref', 'refs/remotes/origin/main', subject.git(root, 'rev-parse', 'HEAD'));
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
  assert.equal(after.closeout.completionScope, 'source-only');
  assert.equal(after.closeout.adlcState, 'source_complete');
  assert.equal(after.closeout.laneDisposition, 'retained');
  assert.equal(after.closeout.nextAction, null);
  assert.equal(subject.git(subject.root, 'rev-parse', 'HEAD'), after.canonicalRevision);
});

test('integrated successor cannot hide an unintegrated predecessor behind an unrelated commit', (t) => {
  const subject = fixture(t), predecessorRef = 'agent/device/unintegrated-source';
  const base = subject.git(subject.root, 'rev-parse', 'HEAD'), predecessorPath = join(subject.root, '..', 'predecessor');
  subject.git(subject.root, 'worktree', 'add', '--quiet', '-b', predecessorRef, predecessorPath, base);
  writeFileSync(join(predecessorPath, 'source.txt'), 'authored source\n');
  subject.git(predecessorPath, 'add', '.'); subject.git(predecessorPath, 'commit', '--quiet', '-m', 'authored source');
  const predecessorHead = subject.git(predecessorPath, 'rev-parse', 'HEAD');

  writeFileSync(join(subject.lane, 'ci-selector.txt'), 'selector-only change\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'unrelated CI selector');
  const successorHead = subject.git(subject.lane, 'rev-parse', 'HEAD');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merge unrelated CI selector');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  put({ ref: REF, state: 'published', head: successorHead, handoff: {
    schema: 'agentic-os-lane-successor/v1', predecessorRef, predecessorHead,
  } }, subject.root);

  const report = subject.status();
  assert.equal(report.lineage.integrated, false);
  assert.equal(report.integration, null);
  assert.ok(report.findings.some(item => item.code === 'predecessor-integration-not-classified'));
  assert.equal(report.closeout.missionState, 'continuable');
  assert.equal(report.closeout.nextAction.id, 'reap-predecessor');
  assert.equal(report.closeout.nextAction.command, `npm run reap -- --ref=${predecessorRef}`);
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

test('restored active lane cannot be declared complete while missing checkout bytes are unresolved', t => {
  const subject = fixture(t);
  put({ ref: REF, state: 'active', recovery: {
    schema: 'agentic-os/lane-recovery/v1', dirtyState: 'unobservable-at-missing-path',
  } }, subject.root);
  const report = subject.status();
  assert.equal(report.lane.dirtyState, 'unobservable-at-missing-path');
  assert.ok(report.findings.some(item => item.code === 'lane-dirty-state-unknown'));
  assert.equal(report.closeout.missionState, 'blocked');
  assert.equal(report.closeout.adlcState, 'blocked');
  assert.equal(report.closeout.cleanupSatisfied, false);
  assert.equal(report.closeout.nextAction.id, 'resolve-unknown-lane-bytes');
});

test('accepted unrecoverable bytes are reported without granting cleanup or deployment', t => {
  const subject = fixture(t), head = subject.git(subject.root, 'rev-parse', `refs/heads/${REF}`);
  const worktree = subject.status().lane.path, disposition = {
    schema: 'agentic-os/lane-recovery-disposition/v1', outcome: 'unrecoverable-accepted',
    ref: REF, head, worktree, decision: 'accept-missing-checkout-bytes-as-unrecoverable',
    recordedAt: '2026-10-09T00:00:00.000Z', preserveCheckout: true, preserveRef: true,
    cleanupAuthorized: false, deploymentAuthorized: false,
  };
  put({ ref: REF, state: 'active', head, worktree, recovery: {
    schema: 'agentic-os/lane-recovery/v1', dirtyState: 'unobservable-at-missing-path', disposition,
  } }, subject.root);
  const report = subject.status();
  assert.equal(report.lane.dirtyState, 'unrecoverable-accepted');
  assert.equal(report.lane.recoveryDisposition.outcome, 'unrecoverable-accepted');
  assert.ok(!report.findings.some(item => item.code === 'lane-dirty-state-unknown'));
  assert.equal(report.grantsAuthority, false);
  assert.equal(report.authorizesEffects, false);
  assert.equal(report.cleanupVerified, false);
  assert.equal(report.providerVerified, false);
  assert.equal(get(REF, subject.root).recovery.dirtyState, 'unobservable-at-missing-path');
  assert.equal(get(REF, subject.root).recovery.disposition.cleanupAuthorized, false);
  assert.equal(get(REF, subject.root).recovery.disposition.deploymentAuthorized, false);
  assert.equal(report.lane.path, worktree);
  assert.equal(subject.git(subject.root, 'rev-parse', `refs/heads/${REF}`), head);
});

test('accepted missing bytes close source only when an exact clean successor checkout remains', t => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'source.txt'), 'predecessor source\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'source');
  const predecessorHead = subject.git(subject.lane, 'rev-parse', 'HEAD');
  subject.git(subject.lane, 'switch', '--quiet', '-c', 'agent/device/reviewed');
  writeFileSync(join(subject.lane, 'source.txt'), 'reviewed replacement\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'reviewed replacement');
  const reviewedHead = subject.git(subject.lane, 'rev-parse', 'HEAD');
  subject.git(subject.lane, 'switch', '--quiet', '-c', 'agent/device/retained', reviewedHead);
  put({ ref: REF, state: 'published', head: predecessorHead, worktree: subject.lane, recovery: {
    schema: 'agentic-os/lane-recertification/v1', dirtyState: 'unobservable-at-missing-path',
  } }, subject.root);
  const current = get(REF, subject.root), disposition = { schema: 'agentic-os/lane-recovery-disposition/v1',
    outcome: 'unrecoverable-accepted', ref: REF, head: predecessorHead, worktree: subject.lane,
    decision: 'accept-missing-checkout-bytes-as-unrecoverable', recordedAt: '2026-10-09T00:00:00.000Z',
    preserveCheckout: true, preserveRef: true, cleanupAuthorized: false, deploymentAuthorized: false };
  const recorded = put({ ...current, recovery: { ...current.recovery, disposition } }, subject.root);
  subject.git(subject.root, 'merge', '--squash', 'refs/heads/agent/device/reviewed');
  subject.git(subject.root, 'commit', '--quiet', '-m', 'integrate reviewed successor');
  const mergeHead = subject.git(subject.root, 'rev-parse', 'HEAD');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', mergeHead);
  assert.equal(recorded.recovery.disposition.preserveRef, true);
  const report = inspectCompletionStatus(subject.root, REF, subject.policy, subject.profile, {
    successor: { predecessorHead, reviewedHead, merge: mergeHead, replacedPaths: ['source.txt'] },
  });
  assert.equal(report.integration.kind, 'reviewed-successor');
  assert.equal(report.lane.path, null);
  assert.equal(report.lane.retainedCheckout.path, realpathSync(subject.lane));
  assert.equal(report.lane.retainedCheckout.head, reviewedHead);
  assert.equal(report.lane.retainedCheckout.clean, true);
  assert.equal(report.lane.dirtyState, 'unrecoverable-accepted');
  assert.equal(report.recoveryDispositionSatisfied, true);
  assert.equal(report.preservationDispositionVerified, false);
  assert.equal(report.preservationSatisfied, false);
  assert.equal(report.closeout.sourceIntegrated, true);
  assert.equal(report.closeout.missionState, 'source_complete');
  assert.equal(report.closeout.laneDisposition, 'retained-unrecoverable-accepted');
  assert.equal(report.closeout.cleanupSatisfied, false);
  assert.equal(report.closeout.completionScope, 'source-only');
  assert.equal(report.closeout.adlcState, 'source_complete');
  assert.equal(report.cleanupVerified, false);
  assert.equal(report.providerVerified, false);
  assert.equal(report.authorizesEffects, false);
  assert.ok(!report.findings.some(item => ['lane-registration-detached', 'lane-dirty-state-unknown',
    'provider-authority-unverified', 'cleanup-receipt-unverified'].includes(item.code)));
});

test('completion binds merged predecessor replacement to the recorded successor lineage', t => {
  const subject = fixture(t), predecessorRef = 'agent/device/lineage-predecessor';
  writeFileSync(join(subject.lane, 'source.txt'), 'predecessor source\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'predecessor source');
  const predecessorHead = subject.git(subject.lane, 'rev-parse', 'HEAD');
  subject.git(subject.lane, 'branch', predecessorRef);
  writeFileSync(join(subject.lane, 'source.txt'), 'reviewed source\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'reviewed successor');
  const reviewedHead = subject.git(subject.lane, 'rev-parse', 'HEAD');
  subject.git(subject.lane, 'switch', '--quiet', '-c', 'agent/device/lineage-retained', reviewedHead);
  writeFileSync(join(subject.lane, 'successor.txt'), 'retained successor\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'successor continuation');
  const laneHead = subject.git(subject.lane, 'rev-parse', 'HEAD');
  subject.git(subject.root, 'merge', '--squash', 'agent/device/lineage-retained');
  subject.git(subject.root, 'commit', '--quiet', '-m', 'integrate successor');
  const merge = subject.git(subject.root, 'rev-parse', 'HEAD');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', merge);
  subject.git(subject.root, 'update-ref', `refs/heads/${REF}`, laneHead);
  put({ ref: REF, state: 'published', head: laneHead, worktree: subject.lane,
    handoff: { schema: 'agentic-os-lane-successor/v1', predecessorRef, predecessorHead },
    recovery: { schema: 'agentic-os/lane-recovery/v1', dirtyState: 'unobservable-at-missing-path',
      disposition: { schema: 'agentic-os/lane-recovery-disposition/v1', outcome: 'unrecoverable-accepted',
        ref: REF, head: laneHead, worktree: subject.lane, decision: 'accept-missing-checkout-bytes-as-unrecoverable',
        recordedAt: '2026-10-09T00:00:00.000Z', preserveCheckout: true, preserveRef: true,
        cleanupAuthorized: false, deploymentAuthorized: false } } }, subject.root);
  const report = inspectCompletionStatus(subject.root, REF, subject.policy, subject.profile, { successor: {
    predecessorRef, predecessorHead, reviewedHead, merge, replacedPaths: ['source.txt'],
  } });
  assert.equal(report.lineage.integrated, true);
  assert.equal(report.integration.kind, 'exact-tree-projection');
  assert.equal(report.recoveryDispositionSatisfied, true);
  assert.equal(report.closeout.missionState, 'source_complete');
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

test('completion status reads each commit-addressed policy object once per invocation', (t) => {
  const subject = fixture(t), support = join(subject.root, '..', 'git-wrapper');
  mkdirSync(join(subject.root, '.agentic-os'), { recursive: true });
  mkdirSync(join(subject.root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(subject.root, '.agentic-os', 'github-transition-policy.json'), JSON.stringify({
    schema: 'agentic-os/github-transition-policy/v1',
    authorityRepository: subject.profile.repository, authorityRef: 'refs/heads/main',
    workflowPath: '.github/workflows/adlc-transition.yml',
    targetRepositories: [subject.profile.repository], evidenceRefPrefix: 'refs/heads/adlc/authority/',
  }));
  writeFileSync(join(subject.root, '.github', 'adlc-authority-policy.json'), JSON.stringify({
    targetRepositoryPrefix: 'github.com/example/', workflowPath: '.github/workflows/adlc-authority.yml',
  }));
  writeFileSync(join(subject.root, '.github', 'workflows', 'adlc-authority.yml'), 'name: authority\n');
  writeFileSync(join(subject.root, '.github', 'workflows', 'adlc-transition.yml'), 'name: transition\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'enroll local authority');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));

  mkdirSync(support);
  const logPath = join(support, 'calls.txt'), wrapper = join(support, 'git');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
  writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${quote(logPath)}\nexec ${quote(realGit)} "$@"\n`, { mode: 0o755 });
  const priorPath = process.env.PATH;
  let report;
  try {
    process.env.PATH = `${support}:${priorPath}`;
    report = subject.status();
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  }

  const shows = readFileSync(logPath, 'utf8').trim().split('\n').filter((line) => line.startsWith('show '));
  assert.equal(report.enrollment.localPolicyCandidate, true);
  assert.equal(new Set(shows).size, shows.length, 'a commit:path object should be read once per status invocation');
  assert.equal(shows.length, 6, 'four enrollment objects and two optional bindings fit the read cache');
});

test('closeout ranks canonical-sync and deploy without granting those effects', () => {
  const base = {
    sourceIntegrated: true, canonicalCurrent: true, laneMounted: true, laneClean: true,
    laneHead: true, quarantineProfile: false, quarantineObserved: false, deployBound: false,
    localPolicyCandidate: false, findingCodes: [],
  };
  const complete = deriveCloseoutVerdict(base);
  assert.equal(complete.missionState, 'source_complete');
  assert.equal(complete.completionScope, 'source-only');
  assert.equal(complete.adlcState, 'source_complete');
  assert.equal(complete.nextAction, null);
  const sync = deriveCloseoutVerdict({
    ...base, canonicalCurrent: false, findingCodes: ['canonical-not-current-clean'],
  });
  assert.equal(sync.missionState, 'continuable');
  assert.equal(sync.nextAction.id, 'canonical-sync-plan');
  const deploy = deriveCloseoutVerdict({ ...base, deployBound: true });
  assert.equal(deploy.missionState, 'source_complete');
  assert.equal(deploy.completionScope, 'delivery-bound');
  assert.equal(deploy.adlcState, 'delivery_pending');
  assert.equal(deploy.nextAction.id, 'deploy-workflow');
  assert.equal(deploy.authorizesEffects, false);
  const acceptedRetained = deriveCloseoutVerdict({ ...base, laneMounted: false, laneClean: null,
    quarantineProfile: true, recoveryDispositionSatisfied: true, deployBound: true });
  assert.equal(acceptedRetained.missionState, 'source_complete');
  assert.equal(acceptedRetained.laneDisposition, 'retained-unrecoverable-accepted');
  assert.equal(acceptedRetained.cleanupSatisfied, false);
  assert.equal(acceptedRetained.preservationSatisfied, false);
  assert.equal(acceptedRetained.adlcState, 'delivery_pending');
  assert.equal(acceptedRetained.nextAction.id, 'deploy-workflow');
  assert.equal(acceptedRetained.authorizesEffects, false);
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

test('integrated zero-scope lane closes without quarantine evidence after its last claim is released', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  const laneHead = subject.git(subject.root, 'rev-parse', `refs/heads/${REF}`);
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main',
    subject.git(subject.root, 'rev-parse', 'HEAD'));
  subject.git(subject.root, 'worktree', 'remove', '--force', subject.lane);
  put({ ref: REF, state: 'integrated', head: laneHead, worktree: subject.lane, writePaths: [] }, subject.root);
  const profile = { repository: 'github.com/example/repository', profileDigest: 'a'.repeat(64),
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    cleanup: { localBranch: 'retain', remoteBranch: 'retain', remoteTrackingRef: 'retain',
      unreachableObjects: 'retain', worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } };
  const report = inspectCompletionStatus(subject.root, REF, { protectedBranch: 'main' }, profile);
  assert.equal(report.cleanupVerified, false);
  assert.equal(report.closeout.laneDisposition, 'released');
  assert.equal(report.closeout.cleanupSatisfied, true);
  assert.equal(report.closeout.retentionState, 'not-required');
  assert.equal(report.closeout.sourceState, 'source_complete');
  assert.equal(report.closeout.missionState, 'source_complete');
  assert.equal(report.closeout.adlcState, 'source_complete');
  assert.ok(!report.findings.some((item) => item.code === 'lane-registration-detached'));
  assert.ok(!report.findings.some((item) => item.code === 'cleanup-receipt-unverified'));
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

test('exact deployed delivery receipt closes ADLC without granting effect authority', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, 'feature.txt'), 'feature\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'feature');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  mkdirSync(join(subject.root, 'docs'));
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  writeFileSync(join(subject.root, 'docs', 'delivery-evidence.md'), '# Production delivery\nExact Dev, Prod, and Runtime readback receipts are retained.\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record product delivery evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const receipt = addDeliveryDisposition(subject, { disposition: 'deployed' });
  const report = subject.status();
  assert.ok(report.deliveryDisposition, report.deliveryDispositionError);
  assert.equal(report.deliveryDisposition.disposition, 'deployed');
  assert.equal(report.deliveryDisposition.setDigest, receipt.receiptDigest);
  assert.equal(report.deliveryDisposition.producerAuthorityVerified, false);
  assert.equal(report.closeout.deliveryDisposition.disposition, 'deployed');
  assert.equal(report.closeout.completionScope, 'delivery-bound');
  assert.equal(report.closeout.adlcState, 'complete');
  assert.equal(report.closeout.nextAction, null);
  assert.equal(report.authorizesEffects, false);
  assert.equal(report.grantsAuthority, false);
});

test('exact docs-only no-deploy receipt closes delivery scope and retains decision evidence', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs'));
  writeFileSync(join(subject.lane, 'docs', 'handover.md'), '# Handover\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'document handover');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  mkdirSync(join(subject.root, 'docs'), { recursive: true });
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  writeFileSync(join(subject.root, 'docs', 'delivery-evidence.md'), '# Scope decision\nThe exact docs path is not an input to the deployed artifact.\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record delivery scope evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const receipt = addDeliveryDisposition(subject, { disposition: 'no-deploy', reason: 'The exact documentation path is not consumed by deployed artifacts.' });
  const report = subject.status();
  assert.equal(report.changeClass, 'docs-only');
  assert.ok(report.deliveryDisposition, report.deliveryDispositionError);
  assert.equal(report.deliveryDisposition.disposition, 'no-deploy');
  assert.equal(report.deliveryDisposition.receiptDigest, governanceDigest(receipt.dispositions[0]));
  assert.equal(report.closeout.completionScope, 'delivery-bound');
  assert.equal(report.closeout.adlcState, 'complete');
  assert.equal(report.closeout.deliveryDisposition.disposition, 'no-deploy');
  assert.equal(report.closeout.nextAction, null);
  assert.equal(report.authorizesEffects, false);
});

test('exact control-ledger no-deploy proof closes scope and supports later ledger-only maintenance', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, '.agentic-os-delivery-dispositions.json'), '{}\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'record delivery disposition');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  mkdirSync(join(subject.root, 'docs'), { recursive: true });
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  writeFileSync(join(subject.root, 'docs', 'delivery-evidence.md'),
    '# Artifact boundary\nThe product stager copies only its explicit artifact entries; the delivery ledger is excluded from the product artifact.\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record artifact boundary evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const receipt = addDeliveryDisposition(subject, { disposition: 'no-deploy', evidencePath: 'docs/delivery-evidence.md',
    reason: 'The delivery ledger is excluded from the product artifact.' });
  const report = subject.status();
  assert.equal(report.changeClass, 'control-ledger-only');
  assert.equal(report.deliveryDisposition.disposition, 'no-deploy');
  assert.equal(report.deliveryDisposition.receiptDigest, governanceDigest(receipt.dispositions[0]));
  assert.equal(report.closeout.completionScope, 'delivery-bound');
  assert.equal(report.closeout.adlcState, 'complete');
  assert.equal(report.authorizesEffects, false);

  const maintenanceRef = 'agent/device/control-ledger-maintenance', maintenance = join(subject.parent, 'maintenance');
  subject.git(subject.root, 'worktree', 'add', '--quiet', '-b', maintenanceRef, maintenance);
  const ledgerPath = join(subject.root, '.agentic-os-delivery-dispositions.json');
  writeFileSync(join(maintenance, '.agentic-os-delivery-dispositions.json'), `${readFileSync(ledgerPath, 'utf8')} `);
  subject.git(maintenance, 'add', '.agentic-os-delivery-dispositions.json');
  subject.git(maintenance, 'commit', '--quiet', '-m', 'maintain delivery ledger');
  subject.git(subject.root, 'merge', '--squash', maintenanceRef);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged ledger maintenance');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const maintenanceReport = inspectCompletionStatus(subject.root, maintenanceRef, subject.policy, subject.profile);
  assert.equal(maintenanceReport.changeClass, 'control-ledger-only');
  assert.equal(maintenanceReport.deliveryDisposition.scopeRule, 'exact-control-ledger-artifact-exclusion');
  assert.equal(maintenanceReport.deliveryDisposition.evidenceForRef, REF);
  assert.equal(maintenanceReport.closeout.completionScope, 'delivery-bound');
  assert.equal(maintenanceReport.closeout.adlcState, 'complete');
});

test('delivery evidence and ledger paths close only with artifact-exclusion no-deploy evidence', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs', 'reports'), { recursive: true });
  writeFileSync(join(subject.lane, 'docs', 'reports', 'delivery.json'), '{"release":"verified"}\n');
  writeFileSync(join(subject.lane, '.agentic-os-delivery-dispositions.json'), '{}\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'record delivery evidence');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merge delivery evidence');
  mkdirSync(join(subject.root, 'docs', 'reports'), { recursive: true });
  writeFileSync(join(subject.root, 'docs', 'reports', 'artifact-boundary.json'), '{"productArtifact":"explicit allowlist"}\n');
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record artifact boundary evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const receipt = addDeliveryDisposition(subject, { disposition: 'no-deploy', evidencePath: 'docs/reports/artifact-boundary.json',
    reason: 'The delivery report and disposition record are excluded from the product artifact.' });
  const report = subject.status();
  assert.equal(report.changeClass, 'delivery-evidence-only');
  assert.ok(report.deliveryDisposition, report.deliveryDispositionError);
  assert.equal(report.deliveryDisposition.disposition, 'no-deploy');
  assert.equal(report.deliveryDisposition.scopeRule, 'delivery-evidence-artifact-exclusion');
  assert.equal(report.deliveryDisposition.receiptDigest, governanceDigest(receipt.dispositions[0]));
  assert.equal(report.closeout.completionScope, 'delivery-bound');
  assert.equal(report.closeout.adlcState, 'complete');
  assert.equal(report.authorizesEffects, false);
});

test('delivery evidence classifier rejects unrelated runtime paths', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs', 'reports'), { recursive: true });
  writeFileSync(join(subject.lane, 'docs', 'reports', 'delivery.json'), '{"release":"verified"}\n');
  writeFileSync(join(subject.lane, 'runtime.js'), 'export const runtime = true;\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'mix report and runtime');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merge mixed lane');
  mkdirSync(join(subject.root, 'docs', 'reports'), { recursive: true });
  writeFileSync(join(subject.root, 'docs', 'reports', 'artifact-boundary.json'), '{"productArtifact":"explicit allowlist"}\n');
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record artifact boundary evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  addDeliveryDisposition(subject, { disposition: 'no-deploy', evidencePath: 'docs/reports/artifact-boundary.json',
    reason: 'The report is excluded from the product artifact.' });
  const report = subject.status();
  assert.equal(report.changeClass, 'mixed');
  assert.equal(report.deliveryDisposition, null);
  assert.equal(report.deliveryDispositionError, 'blocked-delivery-disposition-disposition-scope');
  assert.equal(report.closeout.adlcState, 'delivery_pending');
});

test('delivery evidence-only lane cannot claim product deployment', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs', 'reports'), { recursive: true });
  writeFileSync(join(subject.lane, 'docs', 'reports', 'delivery.json'), '{"release":"verified"}\n');
  writeFileSync(join(subject.lane, '.agentic-os-delivery-dispositions.json'), '{}\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'record delivery evidence');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merge delivery evidence');
  mkdirSync(join(subject.root, 'docs', 'reports'), { recursive: true });
  writeFileSync(join(subject.root, 'docs', 'reports', 'artifact-boundary.json'), '{"productArtifact":"explicit allowlist"}\n');
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record artifact boundary evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  addDeliveryDisposition(subject, { disposition: 'deployed', evidencePath: 'docs/reports/artifact-boundary.json' });
  const report = subject.status();
  assert.equal(report.changeClass, 'delivery-evidence-only');
  assert.equal(report.deliveryDisposition, null);
  assert.equal(report.deliveryDispositionError, 'blocked-delivery-disposition-disposition-scope');
  assert.equal(report.closeout.adlcState, 'delivery_pending');
});

test('control-ledger no-deploy rule rejects any additional changed path', (t) => {
  const subject = fixture(t);
  writeFileSync(join(subject.lane, '.agentic-os-delivery-dispositions.json'), '{}\n');
  writeFileSync(join(subject.lane, 'runtime.js'), 'export const runtime = true;\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'mix ledger and runtime');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  mkdirSync(join(subject.root, 'docs'), { recursive: true });
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  writeFileSync(join(subject.root, 'docs', 'delivery-evidence.md'), 'artifact boundary\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record artifact boundary evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  addDeliveryDisposition(subject, { disposition: 'no-deploy', evidencePath: 'docs/delivery-evidence.md',
    reason: 'The ledger is excluded from the product artifact.' });
  const report = subject.status();
  assert.equal(report.changeClass, 'mixed');
  assert.equal(report.deliveryDisposition, null);
  assert.equal(report.deliveryDispositionError, 'blocked-delivery-disposition-disposition-scope');
  assert.equal(report.closeout.adlcState, 'delivery_pending');
});

test('stale lane paths in a re-sealed disposition remain pending and fail loud', (t) => {
  const subject = fixture(t);
  mkdirSync(join(subject.lane, 'docs'));
  writeFileSync(join(subject.lane, 'docs', 'handover.md'), '# Handover\n');
  subject.git(subject.lane, 'add', '.'); subject.git(subject.lane, 'commit', '--quiet', '-m', 'document handover');
  subject.git(subject.root, 'merge', '--squash', REF);
  subject.git(subject.root, 'commit', '--quiet', '-m', 'merged');
  mkdirSync(join(subject.root, 'docs'), { recursive: true });
  writeFileSync(join(subject.root, '.agentic-os-flight.json'), JSON.stringify({ operations: ['production-activation'] }));
  writeFileSync(join(subject.root, 'docs', 'delivery-evidence.md'), '# Scope decision\n');
  subject.git(subject.root, 'add', '.'); subject.git(subject.root, 'commit', '--quiet', '-m', 'record delivery scope evidence');
  subject.git(subject.root, 'update-ref', 'refs/remotes/origin/main', subject.git(subject.root, 'rev-parse', 'HEAD'));
  const receipt = addDeliveryDisposition(subject, { disposition: 'no-deploy', reason: 'Docs path excluded from deployed artifact.' });
  receipt.dispositions[0].paths = ['docs/other.md'];
  const { receiptDigest: _oldDigest, ...body } = receipt;
  const invalid = { ...body, receiptDigest: governanceDigest(body) };
  commitDispositionSet(subject, invalid);
  const report = subject.status();
  assert.equal(report.deliveryDisposition, null);
  assert.equal(report.deliveryDispositionError, 'blocked-delivery-disposition-lane-binding');
  assert.equal(report.closeout.adlcState, 'delivery_scope_pending');
  assert.equal(report.closeout.nextAction.id, 'repair-delivery-disposition');
  assert.ok(report.findings.some(item => item.code === 'delivery-disposition-invalid'));
});
