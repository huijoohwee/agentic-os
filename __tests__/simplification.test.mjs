import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCompletionScaffoldArguments, buildCompletionBundleScaffold,
  deriveLocallyAvailableFields } from '../bin/agentic-os-completion-scaffold.mjs';
import { materializeCompletionCloseBundle } from '../bin/agentic-os-completion-close.mjs';

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
  assert.throws(() => validateCompletionScaffoldArguments(['--ref=agent/device/x', '--from=/tmp/scaffold.json']),
    { reason: 'blocked-completion-arguments' });
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
    hydrationInputs: ['integrationVerifier.workflowRun'],
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
  assert.ok(!result.remainingPlaceholders.includes('cleanup.plan.candidateDigest'));
  assert.ok(result.remainingPlaceholders.includes('integrationVerifier.workflowRun'));
  assert.ok(!result.remainingPlaceholders.includes('cleanup.plan.expiresAt'));
  assert.ok(result.derivedFields.includes('cleanup.plan.expiresAt'));
  assert.equal(result.deriveNote.includes('completion:plan'), true);
});

test('completion plan refuses a scaffold whose lane head changed after derivation', (t) => {
  const subject = fixture(t), observed = subject.status(), now = Date.now();
  const status = { ...observed, ref: REF, repository: subject.profile.repository,
    lane: { ...observed.lane, path: subject.lane, mounted: true, clean: true },
    integration: { kind: 'exact-tree-projection', pathCount: 0 }, enrollment: {
      authorityRepository: subject.profile.repository, files: {}, localPolicyCandidate: true,
    }, findings: [], canonicalRoot: subject.root };
  const current = buildCompletionBundleScaffold(status, subject.profile, {
    transitionPolicy: { schema: 'agentic-os/github-transition-policy/v1' }, integratedReview: null,
  });
  const scaffold = deriveLocallyAvailableFields(current, status, subject.root, { now: () => now });
  const drifted = { ...scaffold, lane: { ...scaffold.lane, head: '0'.repeat(40) } };
  assert.throws(() => materializeCompletionCloseBundle(drifted,
    { now: () => now, status, profile: subject.profile }), { reason: 'blocked-completion-target-mismatch' });
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

test('normal END canonical sync preserves unrelated large user files in place without inspecting their bytes', async t => {
  const { openSync, closeSync, ftruncateSync, statSync } = await import('node:fs');
  const { planCanonicalSync, applyCanonicalSync } = await import('../src/canonical-sync.mjs');
  const f = fixture(t), userPath = join(f.root, 'private-user-data.bin');
  writeFileSync(join(f.lane, 'base.txt'), 'updated source\n');
  f.git(f.lane, 'commit', '-am', 'source update');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', f.git(f.lane, 'rev-parse', 'HEAD'));
  const descriptor = openSync(userPath, 'wx', 0o600); ftruncateSync(descriptor, 1024 ** 3); closeSync(descriptor);
  const before = statSync(userPath), plan = planCanonicalSync({ cwd: f.root, branch: 'main', targetRef: 'refs/remotes/origin/main', preserveUntracked: true });
  assert.deepEqual(plan.inventory, []); assert.equal(plan.retainedUntracked.length, 1);
  const receipt = applyCanonicalSync(plan, { cwd: f.root, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization });
  const after = statSync(userPath); assert.equal(after.ino, before.ino); assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(receipt.retainedUntrackedCount, 1);
  assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), plan.expectedTargetSha);
  const status = inspectCompletionStatus(f.root, REF, f.policy, f.profile, { allowUntrackedCanonical: true });
  assert.equal(status.canonicalClean, true); assert.equal(f.status().canonicalClean, false);
});
test('canonical retention refuses collisions and any user-file identity drift before effect', async t => {
  const { planCanonicalSync, applyCanonicalSync } = await import('../src/canonical-sync.mjs');
  for (const collision of [true, false]) {
    const f = fixture(t), initial = f.git(f.root, 'rev-parse', 'HEAD');
    writeFileSync(join(f.lane, collision ? 'user.txt' : 'base.txt'), 'protected bytes\n');
    f.git(f.lane, 'add', '.'); f.git(f.lane, 'commit', '-m', 'source update');
    f.git(f.root, 'update-ref', 'refs/remotes/origin/main', f.git(f.lane, 'rev-parse', 'HEAD'));
    writeFileSync(join(f.root, 'user.txt'), 'local bytes\n');
    const plan = () => planCanonicalSync({ cwd: f.root, branch: 'main', targetRef: 'refs/remotes/origin/main', preserveUntracked: true });
    if (collision) assert.throws(plan, { reason: 'blocked-ignored-target-collision' });
    else {
      const selected = plan(); writeFileSync(join(f.root, 'user.txt'), 'changed local bytes\n');
      assert.throws(() => applyCanonicalSync(selected, { cwd: f.root, authorization: selected.authorization, exclusive: selected.exclusiveAuthorization }), { reason: 'blocked-plan-drift' });
    }
    assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), initial);
  }
});

test('ordinary START reuses its standalone lane and does not inherit unrelated mission navigation', async t => {
  const { cmdStart } = await import('../bin/agentic-os-admission.mjs');
  const { createRepositoryProfile } = await import('../src/governance.mjs');
  const { ensureRepositoryTrust } = await import('../src/git-repository.mjs');
  const records = await import('../src/lane-records.mjs');
  const f = fixture(t), remote = join(f.root, '..', 'remote.git'), events = [];
  f.git(f.root, 'worktree', 'remove', f.lane);
  const profile = createRepositoryProfile({ repository: 'github.com/example/repository', canonical: f.profile.canonical,
    adapters: { repository: { id: 'git', version: '1' }, provider: null } });
  writeFileSync(join(f.root, '.agentic-os.json'), JSON.stringify(profile));
  f.git(f.root, 'add', '.'); f.git(f.root, 'commit', '-m', 'profile');
  f.git(f.root, 'init', '--bare', remote); f.git(f.root, 'remote', 'add', 'origin', remote); f.git(f.root, 'push', 'origin', 'main');
  ensureRepositoryTrust(f.root, profile, { allowCreate: true });
  const services = { out: line => events.push(line), err: line => events.push(line), projectCache: (record, cwd) => records.put(record, cwd),
    effectReceipt: (_operation, receipt) => receipt, remoteName: () => 'origin', requireCanonical: () => {} };
  const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
  const args = ['routine', '--device=device', '--write=base.txt'];
  assert.equal(await cmdStart(f.root, args, policy, profile, services), 0);
  const count = f.git(f.root, 'worktree', 'list', '--porcelain');
  f.git(f.root, 'config', 'agentic-os.workflowManifest', '/unrelated/missing/mission.json');
  assert.equal(await cmdStart(f.root, args, policy, profile, services), 0);
  assert.equal(f.git(f.root, 'worktree', 'list', '--porcelain'), count);
  assert.ok(events.some(line => line.includes('"status":"reused"')));
});
