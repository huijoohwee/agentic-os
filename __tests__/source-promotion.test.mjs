import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put } from '../src/lane-records.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { runSourcePromotion, sourcePromotionChecks, validateSourcePromotionPlan,
  sourcePromotionCheckProgress, sourcePromotionOrdering, SOURCE_PROMOTION_SCHEMA }
from '../bin/agentic-os-release-common-complete.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required = ['test', 'budgets'];
const run = (name, id, conclusion, started) => ({ name, id, app: { slug: 'github-actions', id: 15368 },
  status: conclusion === null ? 'in_progress' : 'completed', conclusion, started_at: started,
  completed_at: conclusion === null ? null : started });

test('source promotion accepts only newest complete successful required runs', () => {
  const checks = [run('test', 1, 'success', '2026-10-05T10:00:00Z'),
    run('test', 2, null, '2026-10-05T11:00:00Z'), run('budgets', 3, 'success', '2026-10-05T10:30:00Z')];
  assert.throws(() => sourcePromotionChecks(checks, required), /test is pending/u);
  checks[1] = run('test', 2, 'failure', '2026-10-05T11:00:00Z');
  assert.throws(() => sourcePromotionChecks(checks, required), /test is failed/u);
  checks[1] = run('test', 2, 'success', '2026-10-05T11:00:00Z');
  assert.deepEqual(sourcePromotionChecks(checks, required).map(({ name }) => name), ['budgets', 'test']);
});

test('source promotion plan digest binds repo, source, base and required policy', () => {
  const core = { schema: SOURCE_PROMOTION_SCHEMA, repository: 'owner/repo', ref: 'agent/device/task',
    pr: 7, head: 'a'.repeat(40), base: 'b'.repeat(40), profileDigest: 'c'.repeat(64), authorityClass: 'docs-only',
    requiredChecks: ['budgets', 'test'], checks: [], mode: 'direct', ordering: null,
    method: 'squash', createdAt: 1, expiresAt: 300001 };
  const plan = { ...core, digest: sha(core) };
  assert.equal(validateSourcePromotionPlan(plan, { repository: core.repository, ref: core.ref,
    head: core.head, base: core.base, profileDigest: core.profileDigest, requiredChecks: ['test', 'budgets'] }), plan);
  assert.throws(() => validateSourcePromotionPlan({ ...plan, base: 'd'.repeat(40) }, {
    repository: core.repository, ref: core.ref, head: core.head, base: core.base,
    profileDigest: core.profileDigest, requiredChecks: required,
  }), /plan does not match/u);
});

test('source promotion admits only monotonic exact check progress under observed auto-merge protection', () => {
  const planned = [{ name: 'test', id: 4, status: 'in_progress', conclusion: null,
    startedAt: '2026-10-05T10:00:00Z', completedAt: null }];
  const completed = [{ ...planned[0], status: 'completed', conclusion: 'success',
    completedAt: '2026-10-05T10:01:00Z' }];
  assert.deepEqual(sourcePromotionCheckProgress(planned, completed), completed);
  const queued = [{ ...planned[0], status: 'queued', startedAt: null }];
  assert.equal(sourcePromotionCheckProgress(queued, [completed[0]]).length, 1);
  assert.throws(() => sourcePromotionCheckProgress(planned, [{ ...completed[0], id: 5 }]), /identity or progress changed/u);
  const profile = { repository: 'github.com/owner/repo', requiredChecks: ['test'] };
  const observation = { available: true, identityBound: true, repo: profile.repository,
    observationErrors: [], autoMerge: true, strict: true, requiredChecks: ['test'],
    queueEnabled: false, queuePolicySatisfied: false, mergeGroupSupported: null };
  assert.equal(sourcePromotionOrdering(observation, profile).mode, 'fresh-base');
  assert.throws(() => sourcePromotionOrdering({ ...observation, strict: false }, profile), /fresh-base or tested queue/u);
});

test('release-common exposes only explicit plan and confirmed apply grammars', () => {
  assert.equal(validateCommandArguments('release-common', ['promote', 'plan', '--ref=agent/device/task']), null);
  assert.equal(validateCommandArguments('release-common', ['promote', 'apply', '--plan=p', '--authorize=sha256:x']), null);
  assert.match(validateCommandArguments('release-common', ['promote', 'apply', '--plan=p']), /missing --authorize/u);
  assert.match(validateCommandArguments('release-common', ['promote', 'apply', '--plan=p', '--authorize=x', '--admin']), /unknown/u);
});

test('source promotion applies one exact, protected merge only after current required checks pass', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'aos-source-promotion-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), ref = 'agent/test-device/source-promotion';
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const profile = createRepositoryProfile({ repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: ['budgets', 'test'], cleanup: { localBranch: 'retain', remoteBranch: 'retain',
      remoteTrackingRef: 'retain', unreachableObjects: 'retain', worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'README.md'), 'before\n');
  git('init', '--quiet', '--initial-branch=main'); git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('switch', '-qc', ref); writeFileSync(join(root, 'README.md'), 'after\n');
  git('add', 'README.md'); git('commit', '-qm', 'docs update');
  const head = git('rev-parse', 'HEAD');
  git('switch', '-q', 'main');
  put({ ref, device: 'test-device', scope: 'source-promotion', state: 'published', pr: 41,
    baseSha: base, head, createdAt: new Date(0).toISOString() }, root);
  let merged = false, calls = [];
  const pull = () => ({ number: 41, state: merged ? 'closed' : 'open', merged,
    head: { sha: head, repo: { full_name: 'owner/repo' } },
    base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } },
    merge_commit_sha: merged ? head : null });
  const checks = { total_count: 2, check_runs: [run('test', 1, 'success', '2026-10-05T10:00:00Z'),
    run('budgets', 2, 'success', '2026-10-05T10:01:00Z')] };
  const provider = (args, json = true) => {
    calls.push(args);
    if (args[0] === 'api' && args[1].includes('/pulls/')) return pull();
    if (args[0] === 'api' && args[1].includes('/check-runs')) return checks;
    if (args[0] === 'pr' && args[1] === 'merge') { merged = true; return json ? null : ''; }
    assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const output = [];
  assert.equal(await runSourcePromotion({ root, argv: ['plan', `--ref=${ref}`], profile, provider,
    out: (line) => output.push(JSON.parse(line)), now: () => 1000 }), 0);
  const saved = output[0];
  const planPath = join(parent, 'plan.json');
  writeFileSync(planPath, JSON.stringify(saved));
  assert.equal(await runSourcePromotion({ root, argv: ['apply', `--plan=${planPath}`,
    `--authorize=${saved.confirmation}`], profile, provider, out: (line) => output.push(JSON.parse(line)),
  now: () => 1001 }), 0);
  assert.equal(output.at(-1).state, 'merged');
  assert.equal(calls.filter((args) => args[0] === 'pr' && args[1] === 'merge').length, 1);
  assert.deepEqual(calls.find((args) => args[0] === 'pr' && args[1] === 'merge'),
    ['pr', 'merge', '41', '--repo', 'owner/repo', '--squash', '--match-head-commit', head]);
  assert.equal(readFileSync(planPath, 'utf8').includes(head), true);
});

test('source promotion arms one exact native auto-merge while required checks are pending', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'aos-source-auto-merge-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), ref = 'agent/test-device/authorized-auto-merge';
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const profile = createRepositoryProfile({ repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    requiredChecks: ['budgets', 'test'], cleanup: { localBranch: 'retain', remoteBranch: 'retain',
      remoteTrackingRef: 'retain', unreachableObjects: 'retain', worktreeProjection: 'quarantine',
      worktreeRegistration: 'quarantine' } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'README.md'), 'before\n');
  git('init', '--quiet', '--initial-branch=main'); git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('switch', '-qc', ref); writeFileSync(join(root, 'README.md'), 'after\n');
  git('add', 'README.md'); git('commit', '-qm', 'docs update');
  const head = git('rev-parse', 'HEAD'); git('switch', '-q', 'main');
  put({ ref, device: 'test-device', scope: 'authorized-auto-merge', state: 'published', pr: 42,
    baseSha: base, head, createdAt: new Date(0).toISOString() }, root);
  let armed = false;
  const checks = { total_count: 2, check_runs: [run('test', 4, null, '2026-10-05T10:00:00Z'),
    run('budgets', 5, 'success', '2026-10-05T10:01:00Z')] };
  const pull = () => ({ number: 42, state: 'open', merged: false,
    head: { sha: head, repo: { full_name: 'owner/repo' } },
    base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } },
    auto_merge: armed ? { enabled_by: { login: 'fixture' } } : null });
  const calls = [];
  const provider = (args) => {
    calls.push(args);
    if (args[0] === 'api' && args[1].includes('/pulls/')) return pull();
    if (args[0] === 'api' && args[1].includes('/check-runs')) return checks;
    if (args[0] === 'pr' && args[1] === 'merge') { armed = true; return ''; }
    assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const ordering = { available: true, identityBound: true, repo: profile.repository, observationErrors: [],
    autoMerge: true, strict: true, requiredChecks: ['budgets', 'test'], queueEnabled: false,
    queuePolicySatisfied: false, mergeGroupSupported: null };
  const observe = () => ordering, output = [], planPath = join(parent, 'plan.json');
  assert.equal(await runSourcePromotion({ root, argv: ['plan', `--ref=${ref}`], profile, provider,
    orderingObserver: observe, out: (line) => output.push(JSON.parse(line)), now: () => 1000 }), 0);
  const saved = output[0];
  assert.equal(saved.plan.mode, 'auto');
  writeFileSync(planPath, JSON.stringify(saved));
  assert.equal(await runSourcePromotion({ root, argv: ['apply', `--plan=${planPath}`,
    `--authorize=${saved.confirmation}`], profile, provider, orderingObserver: observe,
    out: (line) => output.push(JSON.parse(line)), now: () => 1001 }), 0);
  assert.equal(output.at(-1).state, 'auto-merge-armed');
  assert.deepEqual(calls.find((args) => args[0] === 'pr' && args[1] === 'merge'),
    ['pr', 'merge', '42', '--repo', 'owner/repo', '--auto', '--squash', '--match-head-commit', head]);
});
