import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLaneRebind, cmdStart, planLaneRebind } from '../bin/agentic-os-admission.mjs';
import { git, headSha, worktrees } from '../src/git.mjs';
import * as records from '../src/lane-records.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { CACHE_LIMITS, load, save, SCHEMA } from '../src/lane-records.mjs';
import {
  formatDoctorConclusion, formatLocal, formatStatus,
} from '../bin/agentic-os-report.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('local reporting requires explicit canonical identity', () => {
  assert.throws(() => formatLocal({}), /explicit canonical branch and remote-tracking ref/u);
});

test('doctor conclusion distinguishes structural health from exact cleanliness', () => {
  assert.equal(formatDoctorConclusion(0, true),
    'shallow harness invariants hold; tracked content identity was not evaluated.');
  assert.equal(formatDoctorConclusion(0, false), 'harness invariants hold.');
  assert.equal(formatDoctorConclusion(2, true),
    '2 finding(s) need attention. Nothing was changed.');
});

test('status preserves a missing registered lane instead of inspecting its absent directory', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-stale-status-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const lane = join(parent, 'lane');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repo',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(root, 'add', '.agentic-os.json');
  runGit(root, 'commit', '--quiet', '--message', 'fixture');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  runGit(root, 'worktree', 'add', '--quiet', '-b', 'agent/test/stale', lane, 'main');
  rmSync(lane, { recursive: true });

  const result = spawnSync(process.execPath, [CLI, 'status', '--device=test'], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent\/test\/stale/u);
  assert.match(result.stdout, /stale registration preserved/u);
  assert.match(result.stdout, new RegExp(lane.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('device traversal is refused before branch, worktree, or external path effects', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-device-traversal-'));
  const root = join(parent, 'repo');
  const bare = join(parent, 'remote.git');
  const escaped = join(parent, 'outside--scope');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(root);
  runGit(parent, 'init', '--quiet', '--bare', bare);
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  runGit(root, 'config', 'user.name', 'Fixture');
  runGit(root, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repo',
    canonical: {
      localRef: 'refs/heads/main',
      remoteRef: 'refs/remotes/origin/main',
    },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(root, 'add', '.agentic-os.json');
  runGit(root, 'commit', '--quiet', '--message', 'fixture');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  runGit(root, 'remote', 'add', 'origin', bare);
  runGit(root, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  const protectedBefore = runGit(root, 'rev-parse', 'refs/remotes/origin/main');
  const refsBefore = runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads');
  const worktreesBefore = runGit(root, 'worktree', 'list', '--porcelain');
  for (const args of [
    ['start', 'scope', '--devcie=other'],
    ['start', 'scope', 'extra'],
    ['start', 'scope', '--device=one', '--device=two'],
  ]) {
    const refused = spawnSync(process.execPath, [CLI, ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env },
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /blocked-invalid-arguments/u);
    assert.equal(runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads'), refsBefore);
    assert.equal(runGit(root, 'worktree', 'list', '--porcelain'), worktreesBefore);
  }
  const result = spawnSync(process.execPath, [
    CLI, 'start', 'scope', '--device=../../outside',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid device/u);
  assert.equal(existsSync(escaped), false);
  assert.equal(existsSync(join(root, '.git', 'agentic-os-start.lock')), false);
  assert.equal(runGit(root, 'rev-parse', 'refs/remotes/origin/main'), protectedBefore);
  assert.equal(runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads'), refsBefore);
  assert.equal(runGit(root, 'worktree', 'list', '--porcelain'), worktreesBefore);

  const cache = join(root, '.git', 'agentic-os', 'lanes.json');
  mkdirSync(join(root, '.git', 'agentic-os'), { recursive: true });
  writeFileSync(cache, '{"schema":"invalid","lanes":{}}\n');
  const invalidCache = spawnSync(process.execPath, [
    CLI, 'start', 'cache-preflight', '--device=test-device',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(invalidCache.status, 1);
  assert.match(invalidCache.stderr, /blocked-lane-cache-invalid/u);
  assert.equal(runGit(root, 'for-each-ref', '--format=%(refname)', 'refs/heads'), refsBefore);
  assert.equal(runGit(root, 'worktree', 'list', '--porcelain'), worktreesBefore);
  rmSync(cache); // retire only the invalid fixture authored by this test

  const lanes = Object.create(null);
  for (let index = 0; index < CACHE_LIMITS.lanes; index += 1) {
    const ref = `agent/retained-${index}/cache`;
    lanes[ref] = { ref, state: 'integrated' };
  }
  save({ schema: SCHEMA, lanes }, root);
  const saturated = spawnSync(process.execPath, [
    CLI, 'start', 'cache-overflow', '--device=test-device',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(saturated.status, 0, saturated.stderr);
  assert.match(saturated.stdout, /lane agent\/test-device\/cache-overflow/u);
  assert.match(saturated.stdout, /worktree .*test-device--cache-overflow/u);
  assert.match(saturated.stderr, /warning-lane-cache-degraded/u);
  assert.notEqual(runGit(root, 'rev-parse', '--verify',
    'refs/heads/agent/test-device/cache-overflow'), '');
  assert.equal(Object.keys(load(root).lanes).length, CACHE_LIMITS.lanes);
});

test('incomplete provider observation renders queue state as bounded UNKNOWN', () => {
  const rendered = formatStatus({
    device: 'test',
    lanes: [],
    queue: {
      available: true,
      queueEnabled: false,
      openPrs: null,
      observationErrors: [
        'rulesets',
        `network ${'sensitive'.repeat(20)}`,
        'three', 'four', 'five', 'six',
      ],
    },
  });
  assert.match(rendered, /provider observation UNKNOWN\/incomplete/u);
  assert.match(rendered, /merge queue UNKNOWN/u);
  assert.match(rendered, /\+1 more/u);
  assert.doesNotMatch(rendered, /merge queue NOT ENABLED/u);
  assert.equal(rendered.includes('sensitive'.repeat(8)), false);
});

test('an unavailable selected provider is reported instead of omitted', () => {
  const rendered = formatStatus({ device: 'test', lanes: [], queue: { available: false } });
  assert.match(rendered, /provider observation UNKNOWN\/unavailable/u);
  assert.match(rendered, /merge queue UNKNOWN/u);
  assert.doesNotMatch(rendered, /merge queue NOT ENABLED/u);
});

test('an unsupported selected provider retains local status and reports UNKNOWN', () => {
  const rendered = formatStatus({
    device: 'test',
    lanes: [{ ref: 'agent/test/lane', state: 'active', commits: 1, untracked: 0, next: [] }],
    queue: { available: false, reason: 'unsupported' },
  });
  assert.match(rendered, /agent\/test\/lane/u);
  assert.match(rendered, /provider observation UNKNOWN\/unsupported/u);
  assert.match(rendered, /merge queue UNKNOWN/u);
});

function mountedRecoveryFixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'mounted-lane-recovery-'))), root = join(parent, 'repo');
  t.after(() => rmSync(parent, { recursive: true, force: true })); mkdirSync(root);
  const run = (...args) => git(args, { cwd: root });
  run('init', '--quiet', '--initial-branch=main');
  run('config', 'user.name', 'Fixture'); run('config', 'user.email', 'fixture@example.invalid');
  const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
  const profile = createRepositoryProfile({ repository: 'example.invalid/owner/repo',
    canonical: { localRef: 'refs/heads/main', remoteRef: policy.protectedRef },
    adapters: { repository: { id: 'git', version: '1' }, provider: null } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'owned.txt'), 'base\n');
  writeFileSync(join(root, 'native-prd-tad-adr-mvp-gtm.md'), '# Recovery plan\n');
  run('add', '.'); run('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base');
  const remote = join(parent, 'remote.git'); run('init', '--quiet', '--bare', remote);
  run('remote', 'add', 'origin', remote); run('push', '--quiet', '-u', 'origin', 'main');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const ref = 'agent/test/retained', lane = join(parent, 'test--retained');
  run('worktree', 'add', '--quiet', '-b', ref, lane, 'main');
  const head = headSha('HEAD', root), authored = 'retained authored bytes\n';
  writeFileSync(join(lane, 'owned.txt'), authored);
  const events = [], services = { out: line => events.push(line), err: line => events.push(line),
    effectReceipt: (_operation, receipt) => receipt, projectCache: records.put,
    remoteName: () => 'origin', requireCanonical: () => assert.equal(run('branch', '--show-current'), 'main') };
  const start = (...flags) => cmdStart(root, ['retained', '--device=test', '--write=owned.txt', ...flags], policy, profile, services);
  const plan = () => planLaneRebind({ cwd: root, ref, mode: 'recertify', base: policy.protectedRef,
    baseSha: head, targetPath: lane, expectedHead: head });
  return { root, parent, ref, lane, head, authored, run, start, plan };
}

test('missing lane evidence names the existing recovery owner, then the same lane resumes with bytes preserved', async t => {
  const f = mountedRecoveryFixture(t), draft = join(f.root, 'retained-draft.md'), draftBytes = '# User planning bytes\n';
  writeFileSync(draft, draftBytes);
  const status = spawnSync(process.execPath, [CLI, 'status', '--device=test'], { cwd: f.root, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /agent\/test\/retained\s+unregistered/u);
  assert.doesNotMatch(status.stdout, /author, publish, integrate/u);
  assert.match(status.stdout, /recover lane record/u);
  for (const flags of [[], ['--plan=native-prd-tad-adr-mvp-gtm.md']]) {
    await assert.rejects(f.start(...flags), error => error.reason === 'blocked-admission-existing-identity'
      && error.message.includes(`rebind plan --ref=${f.ref} --mode=recertify`));
    assert.equal(records.get(f.ref, f.root), null);
  }
  const plan = f.plan(), planPath = join(f.parent, 'rebind-plan.json');
  writeFileSync(planPath, JSON.stringify(plan));
  const receipt = applyLaneRebind({ cwd: f.root, planPath,
    authorization: `agentic-os:lane-rebind:${plan.digest}`, stopped: true });
  assert.equal(receipt.authoredBytesPreserved, true);
  assert.equal(receipt.restoredDirtyState, 'exact-local-inventory');
  assert.equal(await f.start(), 0);
  assert.deepEqual(records.get(f.ref, f.root).writePaths, ['owned.txt']);
  assert.equal(readFileSync(draft, 'utf8'), draftBytes);
  assert.equal(readFileSync(join(f.lane, 'owned.txt'), 'utf8'), f.authored);
  assert.equal(headSha(`refs/heads/${f.ref}`, f.root), f.head);
  assert.equal(worktrees(f.root).length, 2);
});

test('mounted recovery still rejects tracked canonical edits and drift after planning', t => {
  const f = mountedRecoveryFixture(t);
  writeFileSync(join(f.root, 'owned.txt'), 'preserve tracked canonical edit\n');
  assert.throws(f.plan, /recertification must run from clean canonical main/u);
  assert.equal(records.get(f.ref, f.root), null);
  f.run('restore', 'owned.txt');
  const plan = f.plan(), planPath = join(f.parent, 'rebind-plan.json');
  writeFileSync(planPath, JSON.stringify(plan));
  writeFileSync(join(f.lane, 'owned.txt'), 'changed after planning\n');
  assert.throws(() => applyLaneRebind({ cwd: f.root, planPath,
    authorization: `agentic-os:lane-rebind:${plan.digest}`, stopped: true }), /changed after planning/u);
  assert.equal(records.get(f.ref, f.root), null);
  assert.equal(readFileSync(join(f.lane, 'owned.txt'), 'utf8'), 'changed after planning\n');
});
