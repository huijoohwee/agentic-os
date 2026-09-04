import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { git } from '../src/git.mjs';
import {
  LANE_BRANCH_LIMIT, laneBranches, laneBranchSummary, lanePath, reapLaneBranches, worktreeRoot,
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
