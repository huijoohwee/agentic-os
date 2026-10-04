import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, renameSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositoryProfile, RETAIN_ALL_CLEANUP, governanceDigest, canonicalJson } from '../src/governance.mjs';
import { validateSuccessorPreservationReceipt, validateRetentionDispositionReceipt } from '../src/cleanup-records.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { successorIntegrationProof } from '../src/patch-identity.mjs';
import { planSuccessorPreservation, applySuccessorPreservation, verifySuccessorPreservation,
  planUserCleanup, applyUserCleanup } from '../bin/agentic-os-cleanup-user.mjs';
import { inspectCompletionStatus } from '../bin/agentic-os-completion-status.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const NOW = Date.parse('2026-09-14T00:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args,
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-successor-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root'), target = join(parent, 'old'), next = join(parent, 'next');
  mkdirSync(root); git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  const repository = 'example/GameXR', oldRef = 'agent/device/old', nextRef = 'agent/device/next';
  const profile = createRepositoryProfile({ repository: `github.com/${repository}`,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: ['test'], capabilities: ['integration-method:squash'],
    cleanup: { ...RETAIN_ALL_CLEANUP, worktreeProjection: 'quarantine', worktreeRegistration: 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, '.gitignore'), 'runtime/\n');
  writeFileSync(join(root, 'starter.py'), 'speed = 1\n');
  writeFileSync(join(root, 'scene.py'), 'draw()\n');
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); ensureRepositoryTrust(root, profile, { allowCreate: true });
  git(root, 'worktree', 'add', '--quiet', '-b', oldRef, target);
  writeFileSync(join(target, 'starter.py'), 'speed = 2\n');
  writeFileSync(join(target, 'scene.py'), 'draw_rover()\n');
  git(target, 'add', '.'); git(target, 'commit', '--quiet', '-m', 'old implementation');
  const oldHead = git(target, 'rev-parse', 'HEAD');
  git(root, 'worktree', 'add', '--quiet', '-b', nextRef, next, oldHead);
  writeFileSync(join(next, 'starter.py'), 'speed = 3\n');
  git(next, 'add', '.'); git(next, 'commit', '--quiet', '-m', 'reviewed replacement');
  const reviewedHead = git(next, 'rev-parse', 'HEAD');
  git(root, 'merge', '--squash', '--quiet', nextRef); git(root, 'commit', '--quiet', '-m', 'accepted review');
  const merge = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', merge);
  git(root, 'remote', 'add', 'origin', `https://github.com/${repository}.git`);
  git(root, 'config', '--local', 'agentic-os.userCleanup', 'quarantine-recovery');
  mkdirSync(join(target, 'runtime')); writeFileSync(join(target, 'runtime/notes.txt'), 'preserve me');
  const pr = 12, workflow = '.github/workflows/ci.yml';
  const pull = { number: pr, merged: true, state: 'closed', merged_at: '2026-09-13T00:00:00Z',
    merge_commit_sha: merge, html_url: `https://github.com/${repository}/pull/${pr}`,
    base: { ref: 'main', repo: { full_name: repository } },
    head: { sha: reviewedHead, ref: nextRef, repo: { full_name: repository } } };
  const check = { name: 'test', id: 123, head_sha: reviewedHead,
    app: { id: 15368, slug: 'github-actions' }, status: 'completed', conclusion: 'success',
    completed_at: '2026-09-12T23:59:00Z',
    details_url: `https://github.com/${repository}/actions/runs/456/job/123` };
  const run = { id: 456, head_sha: reviewedHead, head_branch: nextRef,
    repository: { full_name: repository }, head_repository: { full_name: repository },
    event: 'pull_request', path: workflow, run_attempt: 1, status: 'completed', conclusion: 'success' };
  const api = path => {
    if (path.endsWith(`/pulls/${pr}`)) return structuredClone(pull);
    if (path.includes('/check-runs?')) return { total_count: 1, check_runs: [structuredClone(check)] };
    if (path.endsWith('/actions/runs/456')) return structuredClone(run);
    assert.fail(`unexpected provider read: ${path}`);
  };
  const input = { cwd: root, target, pr, requiredChecks: ['test'], workflow, recovery: true,
    successor: { predecessorRef: oldRef, predecessorHead: oldHead, replacedPaths: ['starter.py'] } };
  const options = { api, now: () => NOW, observeRemote: () => `${merge}\trefs/heads/main` };
  return { root, target, next, nextRef, profile, oldRef, oldHead, reviewedHead, merge, input, options, check };
}

test('reviewed successor closes a clean predecessor while preserving recovery bytes and branch', t => {
  const s = fixture(t);
  const proof = successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    ['starter.py'], { cwd: s.root });
  assert.equal(proof.kind, 'reviewed-successor');
  assert.equal(proof.pathCount, 2);
  const plan = planUserCleanup(s.input, s.options);
  assert.deepEqual(plan.integration, proof);
  const before = inspectCompletionStatus(s.root, s.oldRef, { protectedBranch: 'main' }, s.profile,
    { successor: { ...s.input.successor, reviewedHead: s.reviewedHead, merge: s.merge } });
  assert.equal(before.integration.kind, 'reviewed-successor');
  const receipt = applyUserCleanup(plan, { cwd: s.root, ...s.options,
    authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true });
  assert.equal(existsSync(s.target), false);
  assert.equal(git(s.root, 'rev-parse', s.oldRef), s.oldHead);
  assert.equal(readFileSync(join(receipt.projectionQuarantinePath, 'runtime/notes.txt'), 'utf8'), 'preserve me');
  assert.equal(receipt.providerAuthority, false);
  const after = inspectCompletionStatus(s.root, s.oldRef, { protectedBranch: 'main' }, s.profile,
    { successor: { ...s.input.successor, reviewedHead: s.reviewedHead, merge: s.merge } });
  assert.equal(after.closeout.missionState, 'source_complete');
  assert.equal(after.lane.mounted, false);
  assert.equal(after.integration.kind, 'reviewed-successor');
  const replay = applyUserCleanup(plan, { cwd: s.root, ...s.options,
    authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true,
    now: () => NOW + 900001 });
  assert.equal(replay.replayed, true);
  writeFileSync(join(s.root, 'later.txt'), 'later change\n');
  git(s.root, 'add', '.'); git(s.root, 'commit', '--quiet', '-m', 'later main edit');
  assert.deepEqual(successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    ['starter.py'], { cwd: s.root }), proof);
});

test('successor rejects omitted replacements, failed checks, changed target and unreviewed ancestry', t => {
  const s = fixture(t);
  assert.equal(successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    [], { cwd: s.root }), null);
  assert.equal(successorIntegrationProof(s.merge, s.oldHead, s.reviewedHead,
    ['scene.py'], { cwd: s.root }), null);
  assert.equal(successorIntegrationProof(s.merge, s.reviewedHead, s.oldHead,
    ['starter.py'], { cwd: s.root }), null);
  s.check.conclusion = 'failure';
  assert.throws(() => planUserCleanup(s.input, s.options), /check-not-successful/);
  s.check.conclusion = 'success';
  assert.throws(() => planUserCleanup({ ...s.input, successor: { ...s.input.successor,
    predecessorHead: s.reviewedHead } }, s.options), /successor-target-drift/);
  assert.equal(validateCommandArguments('release-common', ['complete', `--ref=${s.oldRef}`,
    '--via-pr=12', '--replaced=starter.py', '--stopped']), null);
  assert.ok(validateCommandArguments('release-common', ['complete', `--ref=${s.oldRef}`,
    '--via-pr=12', '--replaced=starter.py']));
});

function preservedFixture(t) {
  const s = fixture(t);
  git(s.root, 'worktree', 'remove', s.next);
  git(s.target, 'checkout', '--quiet', s.nextRef);
  const physicalPlan = planUserCleanup({ ...s.input, successor: undefined }, s.options);
  const physical = applyUserCleanup(physicalPlan, { cwd: s.root, ...s.options,
    authorization: `agentic-os:user-cleanup:${physicalPlan.planDigest}`, stopped: true });
  const adoption = { schema: 'agentic-os/successor-preservation-adoption/v1',
    repository: 'github.com/example/GameXR', predecessorRef: s.oldRef, predecessorHead: s.oldHead,
    successorRef: s.nextRef, successorHead: s.reviewedHead, merge: s.merge,
    reviewLocator: 'https://github.com/example/GameXR/pull/12', replacedPaths: ['starter.py'],
    quarantineCoordinate: physical.planDigest, historicalSuccessionAuthorityProven: false };
  const transitionPolicy = { schema: 'agentic-os/github-transition-policy/v2',
    authorityRepository: adoption.repository, authorityRef: 'refs/heads/main',
    workflowPath: '.github/workflows/adlc-transition.yml', targetRepositories: [adoption.repository],
    evidenceRefPrefix: 'refs/heads/adlc/authority/', historicalIntegrations: [], preservationAdoptions: [adoption] };
  mkdirSync(join(s.root, '.agentic-os'));
  writeFileSync(join(s.root, '.agentic-os/github-transition-policy.json'), JSON.stringify(transitionPolicy));
  git(s.root, 'add', '.agentic-os'); git(s.root, 'commit', '--quiet', '-m', 'review current preservation adoption');
  const canonical = git(s.root, 'rev-parse', 'HEAD');
  git(s.root, 'update-ref', 'refs/remotes/origin/main', canonical);
  const options = { ...s.options, observeRemote: () => `${canonical}\trefs/heads/main` };
  const plan = planSuccessorPreservation({ cwd: s.root, adoption, policyRoot: s.root,
    workflow: '.github/workflows/ci.yml' }, options);
  const apply = overrides => applySuccessorPreservation(plan, { cwd: s.root, ...options,
    authorization: `agentic-os:successor-preservation:${plan.planDigest}`, stopped: true, ...overrides });
  return { ...s, adoption, physical, plan, options, apply };
}

test('current adoption preserves an unmounted predecessor without inventing physical cleanup or historical authority', t => {
  const s = preservedFixture(t), receipt = s.apply();
  for (const name of ['physicalCleanupPerformed', 'providerAuthority', 'claimRetired', 'historicalSuccessionAuthorityProven'])
    assert.equal(receipt[name], false);
  assert.equal(receipt.disposition, 'successor-preserved');
  assert.equal(readFileSync(join(s.physical.projectionQuarantinePath, 'runtime/notes.txt'), 'utf8'), 'preserve me');
  assert.equal(git(s.root, 'rev-parse', s.oldRef), s.oldHead);
  assert.equal(git(s.root, 'rev-parse', s.nextRef), s.reviewedHead);
  const observed = inspectCompletionStatus(s.root, s.oldRef, { protectedBranch: 'main' }, s.profile,
    { preservationReceipt: receipt });
  assert.equal(observed.cleanupVerified, false);
  assert.equal(observed.preservationDispositionVerified, true);
  assert.equal(observed.closeout.cleanupSatisfied, false);
  assert.equal(observed.closeout.preservationSatisfied, true);
  assert.equal(observed.closeout.missionState, 'source_complete');
  assert.equal(observed.closeout.adlcState, 'retirement_pending');
  const replay = s.apply({ now: () => NOW + 900001 });
  assert.deepEqual(replay, receipt);
  assert.equal(validateCommandArguments('cleanup-user', ['preservation-apply', '--plan=x', '--authorize=x', '--stopped']), null);
  assert.equal(validateCommandArguments('completion', ['status', `--ref=${s.oldRef}`, '--preservation=x']), null);
});

test('current preservation rejects policy, clock, ref and mounted-lane drift before recording', t => {
  const s = preservedFixture(t);
  const { planDigest, ...payload } = structuredClone(s.plan);
  payload.issuedAt = new Date(NOW - 900001).toISOString();
  const forged = { ...payload, planDigest: governanceDigest(payload) };
  assert.throws(() => applySuccessorPreservation(forged, { cwd: s.root, ...s.options,
    authorization: `agentic-os:successor-preservation:${forged.planDigest}`, stopped: true }), /ceiling/);
  assert.equal(existsSync(join(s.root, '.git/agentic-os-cleanup-quarantine', forged.planDigest)), false);
  assert.throws(() => s.apply({ now: () => NOW + 900000 }), /preservation-expired/);
  assert.throws(() => s.apply({ authorization: 'invented' }), /preservation-authorization/);
  git(s.root, 'update-ref', `refs/heads/${s.oldRef}`, s.reviewedHead);
  assert.throws(() => s.apply(), /preservation-head-drift/);
  git(s.root, 'update-ref', `refs/heads/${s.oldRef}`, s.oldHead);
  git(s.root, 'worktree', 'add', '--quiet', s.target, s.oldRef);
  assert.throws(() => s.apply(), /preservation-mounted/);
});

test('current preservation exact replay rejects altered recovery bytes and relabeled receipt claims', t => {
  const s = preservedFixture(t), receipt = s.apply();
  const carrier = join(s.root, '.git/agentic-os-cleanup-quarantine', s.plan.planDigest, 'preservation.json');
  chmodSync(carrier, 0o644);
  assert.throws(() => verifySuccessorPreservation(s.root, receipt, s.options), /mode must be 0600/);
  chmodSync(carrier, 0o600);
  const api = s.options.api;
  assert.throws(() => verifySuccessorPreservation(s.root, receipt, { ...s.options, api: path => {
    const result = api(path);
    if (path.endsWith('/pulls/12')) chmodSync(carrier, 0o644);
    return result;
  } }), /mode must be 0600/);
  chmodSync(carrier, 0o600);
  assert.throws(() => verifySuccessorPreservation(s.root, { ...receipt, physicalCleanupPerformed: true }, s.options), /claims/);
  for (const name of ['review', 'integration', 'retention', 'state']) {
    const { receiptDigest, ...payload } = structuredClone(receipt);
    payload[name] = {};
    assert.throws(() => validateSuccessorPreservationReceipt({ ...payload,
      receiptDigest: governanceDigest(payload) }), /fields/);
  }
  const { receiptDigest, ...payload } = structuredClone(receipt);
  payload.expiresAt = new Date(NOW + 900001).toISOString();
  assert.throws(() => validateSuccessorPreservationReceipt({ ...payload,
    receiptDigest: governanceDigest(payload) }), /ceiling/);
  const metadataPath = join(s.physical.projectionQuarantinePath, '..', 'operation.json');
  const metadata = readFileSync(metadataPath), operation = JSON.parse(metadata);
  operation.executedAt = new Date(Date.parse(operation.executedAt) + 1).toISOString();
  writeFileSync(metadataPath, canonicalJson(operation));
  assert.throws(() => verifySuccessorPreservation(s.root, receipt, s.options), /preservation-drift/);
  writeFileSync(metadataPath, metadata);
  writeFileSync(join(s.physical.projectionQuarantinePath, 'runtime/notes.txt'), 'changed');
  assert.throws(() => s.apply({ now: () => NOW + 900001 }), /preservation-retention/);
});

test('preservation first issuance rechecks the monotonic clock after the observed provider review', t => {
  const s = preservedFixture(t); let reads = 0;
  assert.throws(() => s.apply({ now: () => reads++ === 0 ? NOW : NOW + 900000 }), /preservation-expired/);
  assert.equal(existsSync(join(s.root, '.git/agentic-os-cleanup-quarantine', s.plan.planDigest)), false);
});

test('preservation refuses a replaced private parent immediately before first publication', t => {
  const s = preservedFixture(t), base = join(s.root, '.git/agentic-os-cleanup-quarantine'); let reads = 0;
  assert.throws(() => s.apply({ now: () => {
    if (reads++ === 1) { renameSync(base, `${base}.retained`); mkdirSync(base, { mode: 0o700 }); }
    return NOW;
  } }), /preservation base identity changed/);
  assert.equal(existsSync(join(base, s.plan.planDigest)), false);
  const relative = s.physical.projectionQuarantinePath.slice(base.length + 1);
  assert.equal(readFileSync(join(`${base}.retained`, relative, 'runtime/notes.txt'), 'utf8'), 'preserve me');
});

test('preservation preparation rejects provider-induced ref and peer races', t => {
  const s = preservedFixture(t), api = s.options.api;
  const options = { ...s.options, api: path => {
    const result = api(path);
    if (path.endsWith('/pulls/12')) git(s.root, 'update-ref', `refs/heads/${s.oldRef}`, s.reviewedHead);
    return result;
  } };
  assert.throws(() => planSuccessorPreservation({ cwd: s.root, adoption: s.adoption,
    policyRoot: s.root, workflow: '.github/workflows/ci.yml' }, options), /preservation-observation-race|preservation-integration/);
});

function currentQuarantineFixture(t) {
  const s = preservedFixture(t), adoption = { schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: s.adoption.repository, targetRef: s.nextRef, targetHead: s.reviewedHead,
    merge: s.merge, reviewLocator: s.adoption.reviewLocator, quarantineCoordinate: s.physical.planDigest,
    originalReceiptDigest: governanceDigest(s.physical), historicalQuarantineAuthorityProven: false };
  const path = join(s.root, '.agentic-os/github-transition-policy.json');
  const policy = { ...JSON.parse(readFileSync(path, 'utf8')), schema: 'agentic-os/github-transition-policy/v3', retentionAdoptions: [adoption] };
  writeFileSync(path, canonicalJson(policy)); git(s.root, 'add', '.agentic-os');
  git(s.root, 'commit', '--quiet', '-m', 'review current retained quarantine adoption');
  const canonical = git(s.root, 'rev-parse', 'HEAD'); git(s.root, 'update-ref', 'refs/remotes/origin/main', canonical);
  const options = { ...s.options, observeRemote: () => `${canonical}\trefs/heads/main` };
  const input = { cwd: s.root, adoption, originalReceipt: s.physical, policyRoot: s.root, workflow: '.github/workflows/ci.yml' };
  const plan = planSuccessorPreservation(input, options);
  const apply = overrides => applySuccessorPreservation(plan, { cwd: s.root, ...options, stopped: true,
    authorization: `agentic-os:successor-preservation:${plan.planDigest}`, ...overrides });
  return { ...s, adoption, options, input, plan, apply };
}

test('current quarantine disposition binds actual original receipt and retained index without repeating physical cleanup', t => {
  const s = currentQuarantineFixture(t), receipt = s.apply();
  assert.equal(receipt.schema, 'agentic-os/current-quarantine-retention-receipt/v1');
  assert.equal(receipt.disposition, 'current-quarantine-retained');
  assert.equal(receipt.retention.originalReceiptDigest, governanceDigest(s.physical));
  for (const key of ['retainedIndexInventoryDigest', 'recoveryInventoryDigest']) assert.match(receipt.retention[key], /^[a-f0-9]{64}$/u);
  for (const key of ['physicalCleanupPerformed', 'providerAuthority', 'claimRetired', 'historicalQuarantineAuthorityProven']) assert.equal(receipt[key], false);
  assert.deepEqual(validateRetentionDispositionReceipt(receipt), receipt);
  assert.throws(() => validateSuccessorPreservationReceipt(receipt), /fields|claims/);
  const status = inspectCompletionStatus(s.root, s.nextRef, { protectedBranch: 'main' }, s.profile, { preservationReceipt: receipt });
  assert.equal(status.closeout.laneDisposition, 'current-quarantine-retained');
  assert.equal(status.closeout.adlcState, 'retirement_pending');
  assert.equal(status.providerVerified, false);
  assert.deepEqual(s.apply({ now: () => NOW + 900001 }), receipt);
  assert.equal(readFileSync(join(s.physical.projectionQuarantinePath, 'runtime/notes.txt'), 'utf8'), 'preserve me');
});

test('current quarantine adoption rejects substituted original receipt, expired issuance and mounted source', t => {
  const s = currentQuarantineFixture(t);
  assert.throws(() => planSuccessorPreservation({ ...s.input, originalReceipt: { ...s.physical, executedAt: '2000-01-01T00:00:00Z' } }, s.options), /preservation-retention/);
  assert.throws(() => s.apply({ now: () => NOW + 900000 }), /preservation-expired/);
  git(s.root, 'worktree', 'add', '--quiet', s.next, s.nextRef);
  assert.throws(() => s.apply(), /preservation-mounted/);
  assert.equal(existsSync(join(s.root, '.git/agentic-os-cleanup-quarantine', s.plan.planDigest)), false);
});

test('current quarantine replay fails on altered retained index and provider-induced canonical drift', t => {
  const s = currentQuarantineFixture(t), receipt = s.apply();
  const api = s.options.api;
  assert.throws(() => verifySuccessorPreservation(s.root, receipt, { ...s.options, api: path => {
    const result = api(path);
    if (path.endsWith('/pulls/12')) git(s.root, 'update-ref', 'refs/remotes/origin/main', s.merge);
    return result;
  } }), /canonical-not-clean|preservation-observation-race/);
  git(s.root, 'update-ref', 'refs/remotes/origin/main', git(s.root, 'rev-parse', 'HEAD'));
  const index = join(s.physical.registrationQuarantinePath, 'index');
  writeFileSync(index, Buffer.concat([readFileSync(index), Buffer.from('tampered')]));
  assert.throws(() => verifySuccessorPreservation(s.root, receipt, s.options), /preservation-retention/);
});
