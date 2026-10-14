import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { get, put } from '../src/lane-records.mjs';
import { applyProviderLaneRefresh, planProviderLaneRefresh } from '../bin/agentic-os-lane-alignment.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 }).trim();
const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
};
function fixture(t, { collidingUntracked = false, wrongTree = false } = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'provider-rebind-'))), root = join(parent, 'repo'), lane = join(parent, 'lane');
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  git(root, 'init', '--quiet', '--initial-branch=main');
  for (const [key, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid'], ['commit.gpgsign', 'false']])
    git(root, 'config', key, value);
  git(root, 'remote', 'add', 'origin', 'https://github.com/example/agentic-os.git');
  write(root, 'base.txt', 'base\n'); git(root, 'add', '--all'); git(root, 'commit', '--quiet', '-m', 'base');
  const base0 = git(root, 'rev-parse', 'HEAD'), ref = 'agent/test-device/provider-refresh';
  git(root, 'worktree', 'add', '--quiet', '-b', ref, lane, base0);
  write(lane, 'owned/feature.txt', 'feature\n'); git(lane, 'add', '--all'); git(lane, 'commit', '--quiet', '-m', 'published candidate');
  const oldHead = git(lane, 'rev-parse', 'HEAD');
  write(root, 'base.txt', 'advanced base\n');
  if (collidingUntracked) write(root, 'provider-added.txt', 'new base file\n');
  git(root, 'add', '--all'); git(root, 'commit', '--quiet', '-m', 'protected base update');
  const base1 = git(root, 'rev-parse', 'HEAD');
  const mergeTree = git(root, 'merge-tree', '--write-tree', oldHead, base1).split('\n')[0];
  const tree = wrongTree ? git(root, 'rev-parse', `${base1}^{tree}`) : mergeTree;
  const head = git(root, 'commit-tree', tree, '-p', oldHead, '-p', base1, '-m', 'provider base update');
  git(root, 'update-ref', 'refs/remotes/origin/main', base1);
  git(root, 'update-ref', `refs/remotes/origin/${ref}`, head);
  if (collidingUntracked) write(lane, 'provider-added.txt', 'local bytes\n');
  const record = { ref, device: 'test-device', scope: 'provider-refresh', state: 'published',
    base: 'refs/remotes/origin/main', baseSha: base0, worktree: lane, pr: 428,
    createdAt: '2026-10-13T00:00:00.000Z', head: oldHead, writePaths: ['owned'] };
  put(record, root);
  const profile = { repository: 'github.com/example/agentic-os', profileDigest: 'f'.repeat(64),
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' } };
  const review = { number: 428, state: 'open',
    head: { sha: head, ref, repo: { full_name: 'example/agentic-os' } },
    base: { sha: base1, ref: 'main', repo: { full_name: 'example/agentic-os' } } };
  const provider = () => review, remoteReader = () => head;
  return { parent, root, lane, ref, base0, base1, oldHead, head, record, profile, provider, remoteReader };
}
function plan(f) {
  return planProviderLaneRefresh({ cwd: f.root, ref: f.ref, pr: 428, expectedHead: f.head,
    expectedBase: f.base1, profile: f.profile, provider: f.provider, remoteReader: f.remoteReader });
}
function save(f, value) {
  const path = join(f.parent, 'provider-rebind-plan.json'); writeFileSync(path, JSON.stringify(value)); return path;
}

test('provider refresh CLI accepts only exact branch and PR bindings', () => {
  const sha = 'a'.repeat(40), valid = ['rebind', 'plan', '--ref=agent/test-device/provider-refresh',
    '--mode=provider-refresh', '--pr=428', `--expected-head=${sha}`, `--expected-base=${sha}`];
  assert.equal(validateCommandArguments('release-common', valid), null);
  assert.notEqual(validateCommandArguments('release-common', [...valid, '--cleanup']), null);
  assert.notEqual(validateCommandArguments('release-common', valid.map(value => value.replace(`--expected-base=${sha}`, '--expected-base=short'))), null);
});

test('provider refresh verifies the exact PR merge, fast-forwards the mounted lane and preserves unrelated untracked bytes', t => {
  const f = fixture(t); write(f.lane, 'local-note.txt', 'leave in place\n');
  const planValue = plan(f), planPath = save(f, planValue);
  const before = git(f.root, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes');
  const receipt = applyProviderLaneRefresh({ cwd: f.root, planPath, profile: f.profile,
    provider: f.provider, remoteReader: f.remoteReader, authorization: `agentic-os:provider-lane-rebind:${planValue.digest}`, stopped: true });
  assert.equal(receipt.providerVerified, true); assert.equal(receipt.providerAuthority, false);
  assert.equal(receipt.integrationProof, false); assert.equal(receipt.cleanupAuthority, false);
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.head);
  assert.equal(get(f.ref, f.root).head, f.head); assert.equal(get(f.ref, f.root).baseSha, f.base1);
  assert.equal(readFileSync(join(f.lane, 'local-note.txt'), 'utf8'), 'leave in place\n');
  assert.equal(before.includes(`refs/heads/${f.ref} ${f.oldHead}`), true);
  assert.equal(git(f.root, 'rev-parse', `refs/heads/${f.ref}`), f.head);
});

test('provider refresh rejects a merge commit with a tree different from the exact local merge', t => {
  const f = fixture(t, { wrongTree: true });
  assert.throws(() => plan(f), error => error.reason === 'blocked-lane-provider-rebind-merge-tree');
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.oldHead);
  assert.equal(get(f.ref, f.root).head, f.oldHead);
});

test('provider refresh binds to the live remote head when the local tracking ref is stale', t => {
  const f = fixture(t);
  git(f.root, 'update-ref', `refs/remotes/origin/${f.ref}`, f.oldHead);
  const planValue = plan(f);
  assert.equal(planValue.head, f.head);
  assert.equal(planValue.expectedRefs.some(([ref]) => ref === `refs/remotes/origin/${f.ref}`), false);
});

test('provider refresh rejects a target-tree collision with an ignored or visible local path', t => {
  const f = fixture(t, { collidingUntracked: true });
  assert.throws(() => plan(f), error => error.reason === 'blocked-lane-provider-rebind-untracked-collision');
  assert.equal(readFileSync(join(f.lane, 'provider-added.txt'), 'utf8'), 'local bytes\n');
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.oldHead);
});

test('provider refresh rechecks the PR and ref at apply and refuses stale plans without moving the lane', t => {
  const f = fixture(t), planValue = plan(f), planPath = save(f, planValue);
  f.provider = () => ({ ...planValue.providerReview, head: { ...planValue.providerReview.head, sha: 'a'.repeat(40) } });
  assert.throws(() => applyProviderLaneRefresh({ cwd: f.root, planPath, profile: f.profile,
    provider: f.provider, remoteReader: f.remoteReader, authorization: `agentic-os:provider-lane-rebind:${planValue.digest}`, stopped: true }),
  error => error.reason === 'blocked-lane-provider-rebind-stale-plan');
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.oldHead);
  assert.equal(get(f.ref, f.root).head, f.oldHead);
});

test('provider refresh resumes after the lane ref advanced but before checkout and cache updates', t => {
  const f = fixture(t), planValue = plan(f), planPath = save(f, planValue);
  git(f.root, 'update-ref', `refs/heads/${f.ref}`, f.head, f.oldHead);
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.head);
  assert.equal(get(f.ref, f.root).head, f.oldHead);
  const receipt = applyProviderLaneRefresh({ cwd: f.root, planPath, profile: f.profile,
    provider: f.provider, remoteReader: f.remoteReader, authorization: `agentic-os:provider-lane-rebind:${planValue.digest}`, stopped: true });
  assert.equal(receipt.resumed, true);
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.head);
  assert.equal(git(f.lane, 'show', 'HEAD:base.txt'), 'advanced base');
  assert.equal(get(f.ref, f.root).head, f.head);
  assert.equal(get(f.ref, f.root).baseSha, f.base1);
});

test('provider refresh recovery preserves concurrent tracked edits on paths changed by the provider update', t => {
  const f = fixture(t), planValue = plan(f), planPath = save(f, planValue);
  git(f.root, 'update-ref', `refs/heads/${f.ref}`, f.head, f.oldHead);
  const localBytes = 'concurrent local edit\n';
  write(f.lane, 'base.txt', localBytes);
  const args = { cwd: f.root, planPath, profile: f.profile, provider: f.provider,
    remoteReader: f.remoteReader, authorization: `agentic-os:provider-lane-rebind:${planValue.digest}`, stopped: true };
  assert.throws(() => applyProviderLaneRefresh(args), { reason: 'blocked-lane-provider-rebind-recovery-bytes' });
  assert.equal(readFileSync(join(f.lane, 'base.txt'), 'utf8'), localBytes);
  assert.equal(get(f.ref, f.root).head, f.oldHead);
});

test('provider refresh keeps a colliding path intact and resumes after the path is reviewed', t => {
  const f = fixture(t, { collidingUntracked: true }), path = join(f.lane, 'provider-added.txt'); rmSync(path);
  const planValue = plan(f), planPath = save(f, planValue);
  git(f.root, 'update-ref', `refs/heads/${f.ref}`, f.head, f.oldHead);
  write(f.lane, 'provider-added.txt', 'concurrent local bytes\n');
  const args = { cwd: f.root, planPath, profile: f.profile, provider: f.provider,
    remoteReader: f.remoteReader, authorization: `agentic-os:provider-lane-rebind:${planValue.digest}`, stopped: true };
  assert.throws(() => applyProviderLaneRefresh(args), { reason: 'blocked-lane-provider-rebind-untracked-collision' });
  assert.equal(readFileSync(path, 'utf8'), 'concurrent local bytes\n');
  assert.equal(get(f.ref, f.root).head, f.oldHead);
  rmSync(path);
  const receipt = applyProviderLaneRefresh(args);
  assert.equal(receipt.resumed, true);
  assert.equal(get(f.ref, f.root).head, f.head);
});
