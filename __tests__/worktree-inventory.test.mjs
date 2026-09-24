import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { git } from '../src/git.mjs';
import {
  LANE_BRANCH_LIMIT, laneBranches, laneBranchSummary, lanePath, reapLaneBranches, worktreeRoot, assertProvisionable, provision,
} from '../src/worktree.mjs';

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-lane-inventory-'));
  const root = join(parent, 'repository-one');
  mkdirSync(root);
  const run = (args) => git(args, { cwd: root });
  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '--quiet', '--message', 'base']);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, run };
}

test('one registry parent isolates every repository and lane', (t) => {
  const { parent, root, run } = fixture(t);
  const canonicalRoot = run(['rev-parse', '--show-toplevel']);
  const sibling = join(parent, 'repository-two');
  mkdirSync(sibling);
  git(['init', '--quiet', '--initial-branch=main'], { cwd: sibling });
  const prior = process.env.AGENTIC_OS_WORKTREE_ROOT;
  t.after(() => {
    if (prior === undefined) delete process.env.AGENTIC_OS_WORKTREE_ROOT;
    else process.env.AGENTIC_OS_WORKTREE_ROOT = prior;
  });

  delete process.env.AGENTIC_OS_WORKTREE_ROOT;
  assert.equal(worktreeRoot(root),
    join(dirname(canonicalRoot), '.worktrees', basename(canonicalRoot)));
  const registry = join(parent, 'shared-worktree-registry');
  process.env.AGENTIC_OS_WORKTREE_ROOT = registry;
  assert.equal(worktreeRoot(root), join(registry, basename(root)));
  assert.equal(worktreeRoot(sibling), join(registry, basename(sibling)));
  assert.notEqual(worktreeRoot(root), worktreeRoot(sibling));
  assert.equal(lanePath('focused-change', 'device', root),
    join(registry, basename(root), 'device--focused-change'));
});

test('lane inventory is bounded before reap can classify an unbounded legacy branch set', (t) => {
  const { root, run } = fixture(t);
  const head = run(['rev-parse', 'HEAD']);
  for (let index = 0; index < LANE_BRANCH_LIMIT; index += 1) {
    const ref = `refs/heads/agent/device/${String(index).padStart(3, '0')}`;
    run(['update-ref', ref, head]);
  }
  assert.equal(laneBranches(root).length, LANE_BRANCH_LIMIT);

  const overflow = `refs/heads/agent/device/${String(LANE_BRANCH_LIMIT).padStart(3, '0')}`;
  run(['update-ref', overflow, head]);
  assert.deepEqual(laneBranchSummary(root), {
    count: LANE_BRANCH_LIMIT + 1,
    truncated: true,
  });
  assert.deepEqual(reapLaneBranches(`agent/device/${String(LANE_BRANCH_LIMIT).padStart(3, '0')}`,
    root), [`agent/device/${String(LANE_BRANCH_LIMIT).padStart(3, '0')}`]);
  assert.throws(() => laneBranches(root), (error) => {
    assert.equal(error.reason, 'blocked-lane-inventory-over-budget');
    return true;
  });
  assert.throws(() => reapLaneBranches('../escape', root), (error) => {
    assert.equal(error.reason, 'blocked-invalid-lane-ref');
    return true;
  });
  assert.equal(run(['rev-parse', overflow]), head);
});

test('linked worktrees resolve the same flat registry as their canonical owner', t => {
  const { root, parent, run } = fixture(t), task = join(parent, 'task');
  run(['worktree', 'add', '--detach', task, 'HEAD']);
  assert.equal(worktreeRoot(task), worktreeRoot(root));
  assert.equal(lanePath('next', 'device', task), lanePath('next', 'device', root));
});

test('an ancestor metadata directory that is not a Git repository is not a checkout', t => {
  const { root, parent } = fixture(t);
  mkdirSync(join(parent, '.git', 'administrative-state'), { recursive: true });
  assert.doesNotThrow(() => assertProvisionable({ ref: 'agent/device/next', scope: 'next', device: 'device', cwd: root }));
});

test('five task registrations are allowed; detached and missing registrations count', t => {
  const { root, parent, run } = fixture(t), candidate = { ref: 'agent/device/next', scope: 'next', device: 'device', cwd: root };
  for (let index = 0; index < 5; index++) {
    assert.doesNotThrow(() => assertProvisionable(candidate));
    run(['worktree', 'add', '--detach', join(parent, `task-${index}`), 'HEAD']);
  }
  const blocked = () => assert.throws(() => provision({ ...candidate, baseSha: run(['rev-parse', 'HEAD']) }), error => {
    assert.equal(error.reason, 'blocked-repository-checkout-capacity');
    assert.equal(error.consumed, 5); assert.equal(error.limit, 5); return true;
  });
  blocked();
  rmSync(join(parent, 'task-4'), { recursive: true, force: true });
  blocked();
  assert.equal(existsSync(lanePath('next', 'device', root)), false);
  assert.equal(run(['branch', '--list', 'agent/device/next']), '');
});

test('nested registry overrides fail before writes, including other clones and symlink aliases', t => {
  const { root, parent, run } = fixture(t), task = join(parent, 'task'), other = join(parent, 'other');
  run(['worktree', 'add', '--detach', task, 'HEAD']);
  mkdirSync(other); git(['init', '--quiet'], { cwd: other });
  const alias = join(parent, 'alias'); symlinkSync(other, alias, 'dir');
  const previous = process.env.AGENTIC_OS_WORKTREE_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENTIC_OS_WORKTREE_ROOT;
    else process.env.AGENTIC_OS_WORKTREE_ROOT = previous;
  });
  for (const owner of [root, task, other, alias]) {
    process.env.AGENTIC_OS_WORKTREE_ROOT = join(owner, 'nested');
    assert.throws(() => assertProvisionable({ ref: 'agent/device/next', scope: 'next', device: 'device', cwd: root }),
      { reason: 'blocked-nested-checkout' });
    assert.equal(existsSync(join(owner, 'nested')), false);
  }
});

test('an existing nested checkout blocks new provisioning without deleting it', t => {
  const { root, run } = fixture(t), nested = join(root, 'nested');
  run(['worktree', 'add', '--detach', nested, 'HEAD']);
  assert.throws(() => assertProvisionable({ ref: 'agent/device/next', scope: 'next', device: 'device', cwd: root }),
    { reason: 'blocked-nested-checkout' });
  assert.equal(existsSync(join(nested, 'base.txt')), true);
});
