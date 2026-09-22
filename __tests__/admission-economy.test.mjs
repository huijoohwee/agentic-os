import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cmdStart } from '../bin/agentic-os-admission.mjs';
import { collectWorkflowValue, readSelectedWorkflow, startWorkflow } from '../bin/agentic-os-workflow.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { git, headSha, worktrees } from '../src/git.mjs';
import * as records from '../src/lane-records.mjs';
import { lanePath, runPublishedLaneSuccessor } from '../src/worktree.mjs';
import { hash } from '../bin/agentic-os-test-inputs.mjs';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'admission-economy-')), root = join(parent, 'repo');
  t.after(() => rmSync(parent, { recursive: true, force: true })); mkdirSync(root);
  const run = (...args) => git(args, { cwd: root });
  run('init', '--quiet', '--initial-branch=main'); run('config', 'user.name', 'Test'); run('config', 'user.email', 'test@example.invalid');
  const policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
  const profile = createRepositoryProfile({ repository: 'github.com/example/economy',
    canonical: { localRef: 'refs/heads/main', remoteRef: policy.protectedRef },
    adapters: { repository: { id: 'git', version: '1' }, provider: null } });
  const plan = 'native-prd-tad-adr-mvp-gtm.md';
  writeFileSync(join(root, plan), '# Existing joined plan\n');
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile));
  writeFileSync(join(root, 'owned.txt'), 'owned\n');
  run('add', '.'); run('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base');
  const remote = join(parent, 'remote.git'); run('init', '--quiet', '--bare', remote);
  run('remote', 'add', 'origin', remote); run('push', '--quiet', '-u', 'origin', 'main');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const events = [], effects = [];
  const services = { out: line => events.push(line), err: line => events.push(line),
    projectCache: (record, cwd) => records.put(record, cwd), effectReceipt: (operation, receipt) => { effects.push(operation); return receipt; },
    remoteName: () => 'origin', requireCanonical: () => assert.equal(run('branch', '--show-current'), 'main') };
  const start = (scope, ...flags) => cmdStart(root, [scope, '--device=test-device', '--write=owned.txt', ...flags], policy, profile, services);
  const selected = () => readSelectedWorkflow(root, profile.repository, { required: true });
  return { root, parent, run, plan, profile, policy, events, effects, start, selected, services };
}

test('missing and zero declared allowance fail before fetch, hydration or checkout', async t => {
  const f = fixture(t);
  await assert.rejects(f.start('one', `--plan=${f.plan}`), /Declare the mission checkout limit/);
  await assert.rejects(f.start('one', `--plan=${f.plan}`, '--checkout-limit=0'), /allowance is exhausted/);
  assert.deepEqual(f.effects, []); assert.equal(worktrees(f.root).length, 1);
  assert.equal(f.run('status', '--porcelain'), '');
});

test('same mission reuses dirty owned work and refuses another checkout at capacity', async t => {
  const f = fixture(t);
  assert.equal(await f.start('one', `--plan=${f.plan}`, '--checkout-limit=1'), 0);
  const first = f.selected(), firstBytes = readFileSync(first.path, 'utf8');
  const target = lanePath('one', 'test-device', f.root);
  writeFileSync(join(target, 'owned.txt'), 'unfinished owner bytes\n');
  const previousEffects = f.effects.length;
  assert.equal(await f.start('one', `--mission=${first.path}`), 0);
  assert.equal(f.effects.length, previousEffects);
  assert.equal(readFileSync(join(target, 'owned.txt'), 'utf8'), 'unfinished owner bytes\n');
  assert.equal(f.selected().digest, first.digest);
  await assert.rejects(f.start('two', `--mission=${first.path}`), /allowance is exhausted/);
  await assert.rejects(f.start('two', `--mission=${first.path}`, '--checkout-limit=2'), /cannot reset or enlarge/);
  assert.equal(f.effects.length, previousEffects); assert.equal(worktrees(f.root).length, 2);
  assert.equal(readFileSync(first.path, 'utf8'), firstBytes);
});

test('explicit active re-admission extends scope without publishing or replacing dirty bytes', async t => {
  const f = fixture(t);
  await f.start('one', `--plan=${f.plan}`, '--checkout-limit=1');
  const before = f.selected(), target = lanePath('one', 'test-device', f.root), head = headSha('HEAD', target);
  const ref = 'agent/test-device/one', prior = records.get(ref, f.root);
  writeFileSync(join(target, 'owned.txt'), 'retained draft\n');
  await assert.rejects(cmdStart(f.root, ['one', '--device=test-device', '--write=additional.txt', `--mission=${before.path}`], f.policy, f.profile, f.services), /Use explicit active readmit/);
  assert.equal(await cmdStart(f.root, ['one', '--device=test-device', '--write=additional.txt', `--mission=${before.path}`, '--readmit', `--expected-head=${head}`], f.policy, f.profile, f.services), 0);
  assert.deepEqual(records.get(ref, f.root).writePaths, ['additional.txt', 'owned.txt']);
  assert.equal(readFileSync(join(target, 'owned.txt'), 'utf8'), 'retained draft\n');
  assert.equal(worktrees(f.root).length, 2);
  assert.equal(f.run('ls-remote', '--refs', 'origin', `refs/heads/${ref}`), '');
  const after = f.selected(); assert.notEqual(after.digest, before.digest);
  assert.equal(after.manifest.allocations[0].state, 'active');
  assert.equal(after.manifest.allocations[0].operation, 'readmit');
  assert.equal(after.manifest.allocations[0].writeDigest, hash(JSON.stringify(['additional.txt', 'owned.txt'])));
  assert.deepEqual(prior.writePaths, ['owned.txt']);
  await assert.rejects(f.start('one', `--mission=${before.path}`), /stale|drift|selected/i);
});

test('retained pending allocation blocks replay and consumes the final slot', async t => {
  const f = fixture(t), revision = headSha('HEAD', f.root), worktreeId = 'test-device--one';
  startWorkflow(f.root, f.profile.repository, { revision, planningPath: f.plan, worktreeId,
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } });
  const selected = f.selected();
  collectWorkflowValue(f.root, f.profile.repository, { ...selected.manifest,
    members: selected.members.map(row => ({ ...row.ref, file: row.path })),
    previous: { file: selected.path, digest: selected.digest },
    allocations: [{ worktreeId, ref: 'agent/test-device/one', path: lanePath('one', 'test-device', f.root),
      baseRevision: revision, headRevision: revision, writeDigest: hash(JSON.stringify(['owned.txt'])), state: 'pending', operation: 'create' }] }, resolve(f.root, 'workflow-input.json'));
  const pending = f.selected();
  await assert.rejects(f.start('one', `--mission=${pending.path}`), /retained allocation/);
  await assert.rejects(f.start('two', `--mission=${pending.path}`), /allowance is exhausted/);
  assert.deepEqual(f.effects, []); assert.equal(worktrees(f.root).length, 1);
  assert.equal(f.selected().digest, pending.digest);
});

test('two real START contenders cannot both consume one declared slot', async t => {
  const f = fixture(t), revision = headSha('HEAD', f.root);
  startWorkflow(f.root, f.profile.repository, { revision, planningPath: f.plan, worktreeId: 'test-device--one',
    execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } });
  const selected = f.selected();
  const invoke = scope => exec(process.execPath, [cli, 'start', scope, '--device=test-device', '--write=owned.txt', `--mission=${selected.path}`], { cwd: f.root }).then(() => 0, error => error.code);
  const result = await Promise.all([invoke('one'), invoke('two')]);
  assert.equal(result.filter(code => code === 0).length, 1, JSON.stringify(result));
  assert.equal(worktrees(f.root).length, 2); assert.equal(f.selected().manifest.allocations.length, 1);
});

test('absent cache and changed expected head cannot turn an existing lane into new authority', async t => {
  const f = fixture(t); await f.start('one', `--plan=${f.plan}`, '--checkout-limit=1');
  const selected = f.selected(), beforeEffects = f.effects.length;
  await assert.rejects(f.start('one', `--mission=${selected.path}`, `--expected-head=${'0'.repeat(40)}`), /expected head/);
  records.remove('agent/test-device/one', f.root);
  await assert.rejects(f.start('one', `--mission=${selected.path}`), /live bound active unpublished lane/);
  assert.equal(worktrees(f.root).length, 2); assert.equal(f.effects.length, beforeEffects);
});

function changeRoot(f, changes) {
  const prior = f.selected();
  collectWorkflowValue(f.root, f.profile.repository, { ...prior.manifest, ...changes,
    members: prior.members.map(row => ({ ...row.ref, file: row.path })),
    previous: { file: prior.path, digest: prior.digest } }, resolve(f.root, 'workflow-input.json'));
  return f.selected();
}
test('invalid planning fails before any fetch, and legacy standalone leaves an unrelated root intact', async t => {
  const f = fixture(t);
  await assert.rejects(f.start('one', '--plan=missing-prd-tad-adr-mvp-gtm.md', '--checkout-limit=1'), /planning/);
  assert.deepEqual(f.effects, []);
  startWorkflow(f.root, f.profile.repository, { revision: headSha('HEAD', f.root), planningPath: f.plan, worktreeId: 'prior-task' });
  const prior = f.selected();
  assert.equal(await f.start('one'), 0);
  assert.equal(f.selected().digest, prior.digest);
  assert.equal(worktrees(f.root).length, 2);
});
test('legacy adoption counts mounted member lanes and zero allows exact reuse only', async t => {
  const f = fixture(t); await f.start('one');
  const target = lanePath('one', 'test-device', f.root), revision = headSha('HEAD', target);
  startWorkflow(f.root, f.profile.repository, { revision, planningPath: f.plan, worktreeId: basename(target) });
  const legacy = f.selected(), effects = f.effects.length;
  await assert.rejects(f.start('two', `--mission=${legacy.path}`, '--checkout-limit=1'), /allowance is exhausted/);
  assert.equal(f.effects.length, effects);
  assert.equal(await f.start('one', `--mission=${legacy.path}`, '--checkout-limit=0', `--expected-head=${revision}`), 0);
  const adopted = f.selected();
  await assert.rejects(f.start('two', `--mission=${adopted.path}`), /allowance is exhausted/);
  assert.equal(worktrees(f.root).length, 2);
});
test('private committed revision refresh is explicit and committed unreserved bytes fail closed', async t => {
  const f = fixture(t); await f.start('one', `--plan=${f.plan}`, '--checkout-limit=1');
  const target = lanePath('one', 'test-device', f.root), before = f.selected();
  writeFileSync(join(target, 'owned.txt'), 'committed edit\n');
  git(['add', 'owned.txt'], { cwd: target }); git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'owned'], { cwd: target });
  let head = headSha('HEAD', target);
  await assert.rejects(f.start('one', `--mission=${before.path}`), /candidate-revision-drift/);
  assert.equal(await f.start('one', `--mission=${before.path}`, `--expected-head=${head}`), 0);
  const after = f.selected(); assert.notEqual(after.digest, before.digest);
  assert.equal(after.manifest.allocations[0].headRevision, head);
  writeFileSync(join(target, 'unreserved.txt'), 'retain\n');
  git(['add', 'unreserved.txt'], { cwd: target }); git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'outside'], { cwd: target });
  head = headSha('HEAD', target);
  await assert.rejects(f.start('one', `--mission=${after.path}`, `--expected-head=${head}`, '--readmit'), /outside the current reservation/);
  assert.equal(readFileSync(join(target, 'unreserved.txt'), 'utf8'), 'retain\n');
});
for (const publishedCache of [false, true]) test(`interrupted readmission recovers exact scope ${publishedCache ? 'after' : 'before'} cache CAS`, async t => {
  const f = fixture(t); await f.start('one', `--plan=${f.plan}`, '--checkout-limit=1');
  const ref = 'agent/test-device/one', record = records.get(ref, f.root), before = f.selected();
  const old = before.manifest.allocations[0], writePaths = ['additional.txt', 'owned.txt'];
  const pending = { ...old, operation: 'readmit', state: 'pending', previousWriteDigest: old.writeDigest,
    writeDigest: hash(JSON.stringify(writePaths)) };
  const selected = changeRoot(f, { allocations: [pending] });
  if (publishedCache) records.putExact({ ...record, writePaths }, record, f.root);
  const effects = f.effects.length;
  await assert.rejects(cmdStart(f.root, ['one', '--device=test-device', '--write=different.txt', `--mission=${selected.path}`, '--readmit', `--expected-head=${old.headRevision}`], f.policy, f.profile, f.services), /exact pending/);
  assert.equal(await cmdStart(f.root, ['one', '--device=test-device', '--write=additional.txt', `--mission=${selected.path}`, '--readmit', `--expected-head=${old.headRevision}`], f.policy, f.profile, f.services), 0);
  assert.deepEqual(records.get(ref, f.root).writePaths, writePaths);
  assert.equal(f.selected().manifest.allocations[0].state, 'active');
  assert.equal(f.effects.length, effects); assert.equal(worktrees(f.root).length, 2);
});
test('native published successor reuses the retained checkout and the same mission slot', async t => {
  const f = fixture(t); await f.start('one', `--plan=${f.plan}`, '--checkout-limit=1');
  const target = lanePath('one', 'test-device', f.root), ref = 'agent/test-device/one', head = headSha('HEAD', target);
  f.run('push', 'origin', `refs/heads/${ref}:refs/heads/${ref}`);
  assert.equal(runPublishedLaneSuccessor({ cwd: target, predecessorRef: ref, scope: 'next', explicitHead: head,
    remote: 'origin', protectedRef: f.policy.protectedRef, out: () => {}, expandedWritePaths: ['additional.txt'] }), 0);
  const before = f.selected();
  assert.equal(await cmdStart(f.root, ['next', '--device=test-device', '--write=additional.txt', `--mission=${before.path}`, '--readmit', `--expected-head=${head}`], f.policy, f.profile, f.services), 0);
  const after = f.selected();
  assert.equal(worktrees(f.root).length, 2); assert.equal(after.manifest.allocations.length, 1);
  assert.equal(after.manifest.allocations[0].path, target);
  assert.equal(after.manifest.allocations[0].ref, 'agent/test-device/next');
  assert.equal(after.manifest.allocations[0].predecessorRef, ref);
  await assert.rejects(f.start('two', `--mission=${after.path}`), /allowance is exhausted/);
});
